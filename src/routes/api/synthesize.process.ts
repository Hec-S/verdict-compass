import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { callClaude } from "./analyze.process";
import type {
  DepositionCard,
  CaseSynthesis,
  AnalysisResult,
  CaseSnapshot,
  FailedSection,
} from "@/lib/analysis-types";

const InputSchema = z.object({
  synthesisId: z.string().uuid(),
  retrySections: z.array(z.string()).optional(),
});

function getEnv(key: string): string | undefined {
  const g = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
    Deno?: { env?: { get?: (k: string) => string | undefined } };
  };
  return g.process?.env?.[key] ?? g.Deno?.env?.get?.(key);
}

// ---------------- Rate limiting & 429 retry ----------------
//
// Anthropic enforces an input-tokens-per-minute (ITPM) ceiling. Stage B fires
// 7 sub-calls back-to-back, each carrying the full deposition card list, and
// can blow through 30k ITPM in well under a minute. We track recent input
// token usage in a sliding 60s window and sleep before any sub-call that
// would push us over the safe ceiling. We also auto-retry 429 responses with
// the duration the server suggests via retry-after.

const ITPM_LIMIT = 28_000; // 2K buffer below Anthropic's 30K/min
const RATE_WINDOW_MS = 60_000;

interface TokenUsageEntry {
  ts: number;
  tokens: number;
}
const tokenUsageWindow: TokenUsageEntry[] = [];

function approxTokenCount(s: string): number {
  // Rough approximation that's close enough for Claude (~4 chars/token).
  return Math.ceil(s.length / 4);
}

function pruneRateWindow(now: number) {
  while (
    tokenUsageWindow.length > 0 &&
    now - tokenUsageWindow[0].ts > RATE_WINDOW_MS
  ) {
    tokenUsageWindow.shift();
  }
}

function tokensInWindow(now: number): number {
  pruneRateWindow(now);
  return tokenUsageWindow.reduce((acc, e) => acc + e.tokens, 0);
}

async function awaitRateLimitCapacity(label: string, plannedTokens: number) {
  // Plan for the worst — if this single call alone exceeds the limit we still
  // have to issue it. Wait until *prior* usage drains enough to leave room.
  const target = Math.min(plannedTokens, ITPM_LIMIT);
  // Loop because the head of the queue may be far in the past; one prune may
  // not be enough if multiple older entries remain.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = Date.now();
    const used = tokensInWindow(now);
    if (used + target <= ITPM_LIMIT) return;
    // Sleep until the oldest entry falls out of the window.
    const oldest = tokenUsageWindow[0];
    if (!oldest) return;
    const waitMs = Math.max(250, RATE_WINDOW_MS - (now - oldest.ts) + 50);
    console.log(
      `[rate-limit] ${label}: ${used} tokens used in window, planned=${plannedTokens}, sleeping ${waitMs}ms`,
    );
    await sleep(waitMs);
  }
}

function recordTokenUsage(tokens: number) {
  tokenUsageWindow.push({ ts: Date.now(), tokens });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wraps callClaude with: ITPM-aware pre-throttle and exponential-backoff
 *  retry on 429. Up to 2 retries (3 attempts total). */
async function callClaudeThrottled(
  apiKey: string,
  system: string,
  user: string,
  maxTokens: number,
  label: string,
): Promise<string> {
  const inputTokens = approxTokenCount(system) + approxTokenCount(user);
  await awaitRateLimitCapacity(label, inputTokens);

  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      recordTokenUsage(inputTokens);
      return await callClaude(apiKey, system, user, maxTokens);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const is429 = /\b429\b|rate_limit|rate limit/i.test(msg);
      if (!is429 || attempt === maxAttempts) throw err;
      // Try to extract a retry-after seconds value from the error body.
      const m = msg.match(/retry[-_ ]?after[^0-9]{0,8}(\d+)/i);
      const retryAfterSec = m ? parseInt(m[1], 10) : 30;
      const waitMs = Math.max(1000, retryAfterSec * 1000);
      console.warn(
        `[${label}] rate limited, retrying in ${retryAfterSec}s (attempt ${attempt} of ${maxAttempts})`,
      );
      await sleep(waitMs);
      // After waiting, re-check our local window too.
      await awaitRateLimitCapacity(label, inputTokens);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

interface CaseRow {
  id: string;
  case_name: string;
  result: unknown;
  case_snapshot: unknown;
  deposition_card: DepositionCard | null;
}

interface MatterRow {
  id: string;
  name: string;
  description: string | null;
}

// ---------------- JSON helpers ----------------

function extractJSON(raw: string, label = "section"): Record<string, unknown> {
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`[${label}] No JSON in response: ${cleaned.slice(0, 200)}`);
  }
  const slice = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Surface the byte position so we can see exactly where the model broke
    // the JSON (e.g. "position 31378").
    console.warn(
      `[synthesize.process] ${label} JSON.parse failed at ${errMsg}; total length=${slice.length}. Trying tolerant cleanup.`,
    );
    // Tolerant pass 1: strip trailing commas before } or ] (a common Claude
    // failure mode) and retry.
    const noTrailingCommas = slice.replace(/,(\s*[}\]])/g, "$1");
    if (noTrailingCommas !== slice) {
      try {
        return JSON.parse(noTrailingCommas);
      } catch (err2) {
        console.warn(
          `[synthesize.process] ${label} retry after stripping trailing commas failed:`,
          err2 instanceof Error ? err2.message : String(err2),
        );
      }
    }
    // Tolerant pass 2: best-effort recovery by trimming partial content and
    // closing open arrays/objects.
    const recovered = tryRecoverJSON(slice);
    if (recovered) return recovered;
    // Tolerant pass 3: try parsing just the first complete top-level object.
    const firstObj = extractFirstCompleteObject(slice);
    if (firstObj) {
      try {
        return JSON.parse(firstObj);
      } catch {
        /* fall through */
      }
    }
    throw err;
  }
}

/** Returns the substring containing the first complete balanced JSON object,
 *  or null if no such object exists. Respects strings/escapes. */
function extractFirstCompleteObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function tryRecoverJSON(s: string): Record<string, unknown> | null {
  // Very conservative: walk the string and balance braces/brackets, then
  // strip dangling commas. Good enough for "model truncated mid-array".
  let depthCurly = 0;
  let depthSquare = 0;
  let inString = false;
  let escape = false;
  let lastSafe = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depthCurly++;
    else if (c === "}") depthCurly--;
    else if (c === "[") depthSquare++;
    else if (c === "]") depthSquare--;
    if (depthCurly >= 1 && depthSquare >= 0) lastSafe = i;
  }
  if (lastSafe === -1) return null;
  let trimmed = s.slice(0, lastSafe + 1).replace(/,\s*$/, "");
  while (depthSquare > 0) {
    trimmed += "]";
    depthSquare--;
  }
  while (depthCurly > 0) {
    trimmed += "}";
    depthCurly--;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

// ---------------- Schemas (literal JSON shapes shown to the model) ----------------

const DEPOSITION_CARD_SCHEMA = `{
  "caseId": "string - the case id (will be filled in server-side, leave empty)",
  "deponentName": "string",
  "deponentRole": "Plaintiff | Defendant | Treating physician | Retained expert | Fact witness | Third party | other free-text",
  "dateTaken": "string",
  "keyAdmissions": [ { "topic": "", "admission": "", "cite": "", "impeachmentValue": "high|medium|low" } ],
  "vulnerabilities": [ { "issue": "", "detail": "", "cite": "" } ],
  "methodologyIssues": [ "" ],
  "biasIndicators": [ { "type": "", "detail": "", "cite": "" } ],
  "contradictionsWithOtherWitnesses": [ "" ],
  "priorConditionsDisclosed": [ "" ],
  "unresolvedQuestions": [ "" ],
  "dangerToDefense": "high|medium|low",
  "dangerRationale": ""
}`;

const CASE_SYNTHESIS_SCHEMA = `{
  "matterId": "string - leave empty, server fills in",
  "execSummary": {
    "defenseTheory": "",
    "caseStrength": "strong|favorable|mixed|unfavorable|weak",
    "strengthRationale": "",
    "topThreats": [ "" ],
    "topOpportunities": [ "" ],
    "recommendedPosture": "trial|settle_low|settle_midrange|settle_high|more_discovery",
    "postureRationale": ""
  },
  "witnessThreatRanking": [ { "caseId": "", "deponentName": "", "rank": 0, "threatLevel": "high|medium|low", "summary": "", "crossPriorities": [ "" ] } ],
  "contradictionMatrix": [ { "topic": "", "witnesses": [ { "caseId": "", "deponentName": "", "position": "", "cite": "" } ], "exploitability": "high|medium|low", "defenseUse": "" } ],
  "unifiedAdmissionsInventory": [ { "topic": "", "admissions": [ { "caseId": "", "deponentName": "", "admission": "", "cite": "" } ], "trialUse": "" } ],
  "causationAnalysis": { "baselineConditions": [ "" ], "priorAccidentSequelae": [ "" ], "accidentMechanism": "", "apportionmentArguments": [ "" ], "weakestCausationLink": "" },
  "methodologyChallenges": [ { "targetWitness": "", "caseId": "", "basis": "", "motionType": "Daubert|motion_in_limine|limit_testimony|exclude", "supportingCites": [ "" ] } ],
  "biasNarrative": { "pipelineMap": "", "financialRelationships": [ "" ], "repeatPlayerPatterns": [ "" ], "trialNarrative": "" },
  "motionsInLimine": [ { "motion": "", "basis": "", "supportingCites": [ "" ], "priority": "must_file|should_file|consider" } ],
  "discoveryGaps": [ { "gap": "", "impact": "", "recommendedAction": "", "priority": "high|medium|low" } ],
  "trialThemes": [ { "theme": "", "supportingWitnesses": [ "" ], "supportingFacts": [ "" ], "voirDireAngle": "" } ],
  "whatWeMessedUp": [ { "deposition": "", "caseId": "", "missedOpportunity": "", "wouldHaveHelped": "", "canStillFix": false, "fixAction": "" } ],
  "whatToDoNext": [ { "action": "", "priority": "this_week|before_trial|consider", "rationale": "" } ]
}`;

// ---------------- Stage A — Deposition card extraction ----------------

const DEPOSITION_CARD_SYSTEM = `You are a senior defense litigation attorney with 25 years of personal injury defense experience in Nevada state courts. You are extracting a structured intelligence card from one deposition's analysis to be used in case-level synthesis across multiple depositions in the same matter. You write from the defense perspective. You are precise, opinionated, and never neutral. Respond with ONLY a valid JSON object matching the schema provided. No markdown, no preamble, no commentary.`;

export async function extractDepositionCard(
  apiKey: string,
  caseRow: CaseRow,
): Promise<DepositionCard> {
  const result = (caseRow.result ?? {}) as Partial<AnalysisResult>;
  const snapshot =
    (caseRow.case_snapshot as Partial<CaseSnapshot> | null) ?? null;

  const userMessage = `Extract a deposition intelligence card from this single deposition analysis. The card will be combined with cards from other depositions in the same matter to produce a case-level defense synthesis.

DEPONENT: ${snapshot?.caseName ?? caseRow.case_name ?? ""}
ROLE IN CASE: infer from the analysis — plaintiff, defendant, treating physician, retained expert, fact witness, third-party, etc.
COURT/JURISDICTION: ${snapshot?.court ?? ""}
DEPOSITION DATE: ${snapshot?.filed ?? ""}

Return ONLY this JSON:
${DEPOSITION_CARD_SCHEMA}

Specific guidance for each field:
- keyAdmissions: every admission this witness made that the defense can use. impeachmentValue is high if the admission is dispositive or near-dispositive on a contested element; medium if it materially weakens plaintiff's position; low if it's helpful but cumulative.
- vulnerabilities: things this deposition revealed that HURT the defense — favorable plaintiff testimony, defense missteps, expert opinions the witness will support at trial.
- methodologyIssues: only for experts and treating providers. Specifically look for: testing administered without proper foundation, reliance on patient self-report without independent verification, translator/language issues, fee/bias indicators, scope-of-practice problems, departure from accepted protocols, gaps in record review.
- biasIndicators: referral pipeline relationships (who referred this witness, who they refer to), percentage of practice that is litigation, prior expert testimony patterns, financial relationships with plaintiff's firm or other plaintiff-side providers, repeat-player patterns.
- contradictionsWithOtherWitnesses: anything this witness said that appears to contradict known facts, prior testimony, or what other treating providers/experts in this same case have testified to. Raw observations only — the synthesis stage will resolve cross-references.
- priorConditionsDisclosed: every pre-existing condition, prior injury, prior accident, or baseline pathology this witness touched. Critical for causation apportionment.
- unresolvedQuestions: what this witness could not or did not answer that the defense still needs.
- dangerToDefense: high if this witness will be a major problem at trial; medium if mixed; low if neutral or favorable to defense. dangerRationale: 1-2 sentences.

DEPOSITION ANALYSIS:
caseSnapshot: ${JSON.stringify(snapshot ?? {})}
wentWell: ${JSON.stringify(result.wentWell ?? [])}
wentPoorly: ${JSON.stringify(result.wentPoorly ?? [])}
criticalMoments: ${JSON.stringify(result.criticalMoments ?? [])}
witnesses: ${JSON.stringify(result.witnesses ?? [])}
objections: ${JSON.stringify(result.objections ?? [])}
juryChargeIssues: ${JSON.stringify(result.juryChargeIssues ?? [])}
recommendations: ${JSON.stringify(result.recommendations ?? [])}`;

  const t = Date.now();
  const raw = await callClaude(apiKey, DEPOSITION_CARD_SYSTEM, userMessage, 4000);
  console.log(
    `[synthesize.process] extractDepositionCard ${caseRow.id} ok in ${Date.now() - t}ms (${raw.length} chars)`,
  );
  const parsed = extractJSON(raw, `card:${caseRow.id}`) as Partial<DepositionCard>;

  // Server-side fill-ins / defensive defaults.
  const card: DepositionCard = {
    caseId: caseRow.id,
    deponentName:
      parsed.deponentName ||
      snapshot?.caseName ||
      caseRow.case_name ||
      "Unknown deponent",
    deponentRole: parsed.deponentRole || "Fact witness",
    dateTaken: parsed.dateTaken || snapshot?.filed || "",
    keyAdmissions: Array.isArray(parsed.keyAdmissions) ? parsed.keyAdmissions : [],
    vulnerabilities: Array.isArray(parsed.vulnerabilities)
      ? parsed.vulnerabilities
      : [],
    methodologyIssues: Array.isArray(parsed.methodologyIssues)
      ? parsed.methodologyIssues
      : [],
    biasIndicators: Array.isArray(parsed.biasIndicators) ? parsed.biasIndicators : [],
    contradictionsWithOtherWitnesses: Array.isArray(
      parsed.contradictionsWithOtherWitnesses,
    )
      ? parsed.contradictionsWithOtherWitnesses
      : [],
    priorConditionsDisclosed: Array.isArray(parsed.priorConditionsDisclosed)
      ? parsed.priorConditionsDisclosed
      : [],
    unresolvedQuestions: Array.isArray(parsed.unresolvedQuestions)
      ? parsed.unresolvedQuestions
      : [],
    dangerToDefense:
      parsed.dangerToDefense === "high" || parsed.dangerToDefense === "low"
        ? parsed.dangerToDefense
        : "medium",
    dangerRationale: parsed.dangerRationale || "",
  };
  return card;
}

// ---------------- Stage B — Case-level synthesis (six sub-calls) ----------------

const CASE_SYNTHESIS_SYSTEM = `You are a senior defense litigation attorney and trial strategist with 25 years of personal injury defense experience in Nevada state courts. You are producing a case-level defense intelligence report from the deposition cards of every witness deposed in this matter. This report will be the operative defense playbook through trial.

You are opinionated, specific, and grounded in the record. You name the defense theory. You rank witnesses by how dangerous they are to the defense at trial. You identify the strongest contradictions, the weakest links in plaintiff's causation chain, the methodology challenges that could exclude or limit expert testimony, and the bias narrative that explains the litigation pipeline behind plaintiff's case.

You write for a defense partner who is preparing for trial. You do not hedge. You do not produce generic advice. Every observation is tied to specific deposition testimony with citations. You identify what the defense missed in deposition that can still be fixed and what cannot.

Domain priors you operate from:
1. In Nevada PI cases with extensive pre-existing pathology, the defense theory almost always centers on causation apportionment — separating accident-caused harm from baseline disease and prior-injury sequelae. Look first for this pattern.
2. Nevada plaintiff PI firms (De Castroverde, Prince, Richard Harris, Eglet, etc.) work with a known stable of treating providers and retained experts. Referral pipelines from a treating physician to a chiropractor to a pain management specialist to a surgeon to a psychologist, all of whom are repeat referrals from the same firm or its co-counsel, are a litigation indicator a Nevada jury will respond to when the connections are made plain. Look for this structure across witnesses.
3. Treating providers who rely on patient self-report through plaintiff-firm-provided translators or interpreters with no independent qualification create methodology problems that can be attacked under NRS 50.275 and Daubert/Hallmark. Flag any such issues across all witnesses, not just one.
4. The Beck Depression Inventory, Beck Anxiety Inventory, and Pain Patient Profile, when administered through unqualified translators or in a language other than the testing instrument's validated language, produce results that are arguably inadmissible under Hallmark. Flag this if it appears.
5. Nevada juries respond to defense narratives that are factual, concrete, and respect the plaintiff's prior real injuries. Do not produce trial themes that attack the plaintiff personally; produce themes that attack the gap between what the accident actually caused and what plaintiff's providers are claiming.
6. NRCP 30(b) depositions, NRS Chapter 50 evidence rules, and Nevada state court procedure govern. Reference accordingly.

Respond with ONLY a valid JSON object containing the requested keys. No markdown, no preamble, no commentary.`;

function buildSharedInput(matter: MatterRow, cards: DepositionCard[]): string {
  return `MATTER: ${matter.name}
DESCRIPTION: ${matter.description ?? ""}

DEPOSITION CARDS (${cards.length} witnesses):
${JSON.stringify(cards, null, 2)}`;
}

// ---------------- Per-section card trimming ----------------
//
// Each Stage B sub-call only needs a subset of the DepositionCard fields.
// Sending the full card to every sub-call inflates input tokens by 40-60%
// and is the main driver of our 429s on the admissions/contradictions calls.
// trimCardForSection returns a minimal projection per section.

type SectionKey =
  | "execSummary"
  | "biasNarrative"
  | "trialThemes"
  | "witnessThreats"
  | "contradictions"
  | "admissionsInventory"
  | "causationAnalysis"
  | "methodologyChallenges"
  | "motionsInLimine"
  | "discoveryGaps"
  | "whatWeMessedUp"
  | "whatToDoNext";

function trimCardForSection(
  card: DepositionCard,
  section: SectionKey,
): Partial<DepositionCard> & { caseId: string; deponentName: string } {
  const base = { caseId: card.caseId, deponentName: card.deponentName };
  switch (section) {
    case "execSummary":
    case "witnessThreats":
      // Headline analyses get the full card.
      return card;
    case "biasNarrative":
      return {
        ...base,
        deponentRole: card.deponentRole,
        biasIndicators: card.biasIndicators,
        methodologyIssues: card.methodologyIssues,
      };
    case "trialThemes":
      return {
        ...base,
        deponentRole: card.deponentRole,
        keyAdmissions: card.keyAdmissions,
        biasIndicators: card.biasIndicators,
        priorConditionsDisclosed: card.priorConditionsDisclosed,
      };
    case "contradictions":
      return {
        ...base,
        deponentRole: card.deponentRole,
        keyAdmissions: card.keyAdmissions,
        contradictionsWithOtherWitnesses: card.contradictionsWithOtherWitnesses,
        priorConditionsDisclosed: card.priorConditionsDisclosed,
      };
    case "admissionsInventory":
      return {
        ...base,
        deponentRole: card.deponentRole,
        keyAdmissions: card.keyAdmissions,
        priorConditionsDisclosed: card.priorConditionsDisclosed,
        vulnerabilities: card.vulnerabilities,
      };
    case "causationAnalysis":
      return {
        ...base,
        deponentRole: card.deponentRole,
        priorConditionsDisclosed: card.priorConditionsDisclosed,
        contradictionsWithOtherWitnesses: card.contradictionsWithOtherWitnesses,
        vulnerabilities: card.vulnerabilities,
      };
    case "methodologyChallenges":
      return {
        ...base,
        deponentRole: card.deponentRole,
        methodologyIssues: card.methodologyIssues,
        biasIndicators: card.biasIndicators,
        vulnerabilities: card.vulnerabilities,
      };
    case "motionsInLimine":
      return {
        ...base,
        deponentRole: card.deponentRole,
        methodologyIssues: card.methodologyIssues,
        biasIndicators: card.biasIndicators,
        vulnerabilities: card.vulnerabilities,
        keyAdmissions: card.keyAdmissions,
        unresolvedQuestions: card.unresolvedQuestions,
      };
    case "discoveryGaps":
      return {
        ...base,
        deponentRole: card.deponentRole,
        unresolvedQuestions: card.unresolvedQuestions,
        priorConditionsDisclosed: card.priorConditionsDisclosed,
        biasIndicators: card.biasIndicators,
      };
    case "whatWeMessedUp":
      return {
        ...base,
        vulnerabilities: card.vulnerabilities,
        unresolvedQuestions: card.unresolvedQuestions,
      };
    case "whatToDoNext":
      return {
        ...base,
        deponentRole: card.deponentRole,
        vulnerabilities: card.vulnerabilities,
        unresolvedQuestions: card.unresolvedQuestions,
        methodologyIssues: card.methodologyIssues,
      };
  }
}

function buildSectionInput(
  matter: MatterRow,
  cards: DepositionCard[],
  section: SectionKey,
): string {
  const trimmed = cards.map((c) => trimCardForSection(c, section));
  return `MATTER: ${matter.name}
DESCRIPTION: ${matter.description ?? ""}

DEPOSITION CARDS (${cards.length} witnesses):
${JSON.stringify(trimmed, null, 2)}`;
}

async function runSubSynthesis(
  apiKey: string,
  label: string,
  userMessage: string,
  maxTokens: number,
): Promise<Record<string, unknown>> {
  const t = Date.now();
  const raw = await callClaudeThrottled(
    apiKey,
    CASE_SYNTHESIS_SYSTEM,
    userMessage,
    maxTokens,
    label,
  );
  console.log(
    `[synthesize.process] sub:${label} ok in ${Date.now() - t}ms (${raw.length} chars)`,
  );
  try {
    return extractJSON(raw, `sub:${label}`);
  } catch (err) {
    console.error(
      `[synthesize.process] sub:${label} JSON parse failed:`,
      err instanceof Error ? err.message : String(err),
    );
    return {};
  }
}

export async function synthesizeExecSummary(
  apiKey: string,
  matter: MatterRow,
  cards: DepositionCard[],
): Promise<Record<string, unknown>> {
  const shared = buildSectionInput(matter, cards, "execSummary");
  const userMessage = `Produce ONLY the EXECUTIVE SUMMARY for this matter. No other keys.

${shared}

Return ONLY this JSON shape:
{
  "execSummary": {
    "defenseTheory": "2-3 sentences. State the operative defense theory grounded in this record (causation apportionment, credibility attack, methodology challenge, etc.). Do not produce a generic theory.",
    "caseStrength": "strong|favorable|mixed|unfavorable|weak",
    "strengthRationale": "2-3 sentences justifying the strength rating with specifics from the record.",
    "topThreats": [ "specific threat with witness/cite, max 25 words" ],
    "topOpportunities": [ "specific opportunity with witness/cite, max 25 words" ],
    "recommendedPosture": "trial|settle_low|settle_midrange|settle_high|more_discovery",
    "postureRationale": "Be specific about a dollar range tied to Nevada verdict patterns for the injury type at issue."
  }
}

Rules:
- topThreats: 3-5 items
- topOpportunities: 3-5 items
- Every claim must be grounded in the deposition cards
- Do not include any other top-level keys`;
  return runSubSynthesis(apiKey, "execSummary", userMessage, 2500);
}

export async function synthesizeBiasNarrative(
  apiKey: string,
  matter: MatterRow,
  cards: DepositionCard[],
): Promise<Record<string, unknown>> {
  const shared = buildSectionInput(matter, cards, "biasNarrative");
  const userMessage = `Produce ONLY the BIAS NARRATIVE for this matter. No other keys.

${shared}

Return ONLY this JSON shape:
{
  "biasNarrative": {
    "pipelineMap": "Trace who referred whom in the order it happened. Tell the litigation-pipeline story as a narrative usable in opening/closing.",
    "financialRelationships": [ "specific financial relationship with cite, max 30 words" ],
    "repeatPlayerPatterns": [ "specific repeat-player pattern with cite, max 30 words" ],
    "trialNarrative": "2-4 sentences delivering the bias story to a Nevada jury."
  }
}

Rules:
- financialRelationships: 3+ items if the record supports it
- repeatPlayerPatterns: 2+ items
- Ground every entry in the deposition cards' biasIndicators / methodologyIssues
- Do not include any other top-level keys`;
  return runSubSynthesis(apiKey, "biasNarrative", userMessage, 2000);
}

export async function synthesizeTrialThemes(
  apiKey: string,
  matter: MatterRow,
  cards: DepositionCard[],
): Promise<Record<string, unknown>> {
  const shared = buildSectionInput(matter, cards, "trialThemes");
  const userMessage = `From the deposition cards below, identify the 3-5 strongest defense trial themes for this matter. Each theme must be supported by at least 3 witnesses or 3 specific facts grounded in the record. Themes supported by only one witness do not belong here.

Trial themes are the 3-5 sentences a defense attorney delivers in opening and closing — they tell the jury the story of why our client should win. They are NOT issue lists; they are narrative claims.

Examples of strong defense trial themes for personal injury matters:
- 'This case is about a 2014 injury, not a 2019 accident.'
- 'Plaintiff's medical providers all work for plaintiff.'
- 'The accident sped up what was already happening.'

Return ONLY this JSON:
{
  "trialThemes": [
    {
      "theme": "one-sentence theme statement, max 20 words",
      "supportingWitnesses": ["deponent name 1", "deponent name 2", "deponent name 3"],
      "supportingFacts": [
        "specific fact with cite, max 25 words",
        "specific fact with cite, max 25 words",
        "specific fact with cite, max 25 words"
      ],
      "voirDireAngle": "how to frame this theme during voir dire to prime the jury, max 30 words"
    }
  ]
}

Rules:
- Return between 3 and 5 themes
- Each theme must have at least 3 supporting witnesses listed by name
- Each theme must have at least 3 supporting facts with cites
- Themes must be defense narratives, not neutral observations
- Do not produce trial themes that attack the plaintiff personally; produce themes that attack the gap between what the accident caused and what plaintiff's providers claim

${shared}`;
  return runSubSynthesis(apiKey, "trialThemes", userMessage, 2500);
}

export async function synthesizeWitnessThreats(
  apiKey: string,
  matter: MatterRow,
  cards: DepositionCard[],
): Promise<Record<string, unknown>> {
  const shared = buildSectionInput(matter, cards, "witnessThreats");
  const userMessage = `Produce the WITNESS THREAT RANKING slice of the case-level defense synthesis.

${shared}

Return ONLY the following JSON keys and nothing else: witnessThreatRanking.

Schema:
{
  "witnessThreatRanking": [
    { "caseId": "", "deponentName": "", "rank": 0, "threatLevel": "high|medium|low", "summary": "", "crossPriorities": [ "" ] }
  ]
}

Rank EVERY deponent by how dangerous they are to the defense at trial. rank=1 is the most dangerous. crossPriorities are 3-5 specific cross themes per witness, written as direct instructions to defense counsel. Use the exact caseId from each deposition card.`;
  return runSubSynthesis(apiKey, "witnessThreats", userMessage, 4000);
}

export async function synthesizeContradictions(
  apiKey: string,
  matter: MatterRow,
  cards: DepositionCard[],
): Promise<Record<string, unknown>> {
  const shared = buildSectionInput(matter, cards, "contradictions");
  const userMessage = `From the deposition cards below, identify every meaningful contradiction across witnesses where two or more witnesses gave incompatible testimony on the same factual point. Return ONLY this JSON shape with no other content:

{
  "contradictionMatrix": [
    {
      "topic": "short topic label, max 6 words",
      "witnesses": [
        {"caseId": "<id>", "deponentName": "<name>", "position": "<what they said, max 25 words>", "cite": "<page/line cite>"}
      ],
      "exploitability": "high|medium|low",
      "defenseUse": "how defense uses this contradiction at trial, max 30 words"
    }
  ]
}

Rules:
- Return at most 6 contradictions, prioritized by exploitability.
- Each contradiction must have at least 2 witnesses.
- topic: 6 words max. position: 25 words max. defenseUse: 30 words max.
- If you cannot find any meaningful contradictions, return an empty array. Do not invent contradictions to fill the array.

Example of correct output format:
{
  "contradictionMatrix": [
    {
      "topic": "Phone use at impact",
      "witnesses": [
        {"caseId": "abc-123", "deponentName": "Plaintiff", "position": "defendant was on phone immediately before collision", "cite": "p.18 lines 3-7"},
        {"caseId": "def-456", "deponentName": "Defendant", "position": "checked phone after impact to note time", "cite": "p.32 lines 11-15"}
      ],
      "exploitability": "medium",
      "defenseUse": "impeach plaintiff's claim defendant was distracted before collision"
    }
  ]
}

Your response must end with the closing brace } of the contradictionMatrix wrapper. Verify the JSON is complete and valid before responding. If you cannot fit all desired contradictions within the response length, return fewer contradictions rather than truncated JSON.

${shared}`;

  console.log(
    `[CONTRADICTIONS] starting, sending ${userMessage.length} chars to Claude`,
  );
  const t = Date.now();
  let raw: string;
  try {
    raw = await callClaudeThrottled(
      apiKey,
      CASE_SYNTHESIS_SYSTEM,
      userMessage,
      3000,
      "contradictions",
    );
  } catch (err) {
    console.error(
      `[CONTRADICTIONS] Claude call failed:`,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
  console.log(
    `[CONTRADICTIONS] received response, length=${raw.length} (in ${Date.now() - t}ms)`,
  );
  console.log(`[CONTRADICTIONS] first 500 chars of response: ${raw.slice(0, 500)}`);
  console.log(`[CONTRADICTIONS] last 500 chars of response: ${raw.slice(-500)}`);
  console.log(`[CONTRADICTIONS] parse attempt...`);
  try {
    const parsed = extractJSON(raw, "sub:contradictions");
    console.log(`[CONTRADICTIONS] parsed successfully`);
    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[CONTRADICTIONS] parse failed: ${msg}`);
    throw new Error(`Contradictions parse failed: ${msg}`);
  }
}

export async function synthesizeAdmissionsInventory(
  apiKey: string,
  matter: MatterRow,
  cards: DepositionCard[],
): Promise<Record<string, unknown>> {
  const shared = buildSectionInput(matter, cards, "admissionsInventory");
  const userMessage = `From the deposition cards below, build a topic-grouped inventory of admissions that defense can use at trial. Group admissions by topic, not by witness. Topics with multi-witness support are highest priority. Return ONLY this JSON shape with no other content:

{
  "unifiedAdmissionsInventory": [
    {
      "topic": "specific topic label, max 10 words (e.g. 'Pre-existing L5-S1 fusion (2014)')",
      "admissions": [
        {"caseId": "<id>", "deponentName": "<name>", "admission": "<what they admitted, max 30 words>", "cite": "<page/line cite>"}
      ],
      "trialUse": "how to deploy this admission at trial, max 40 words"
    }
  ]
}

Rules:
- Return at most 12 admission topics, prioritized by multi-witness support
- Each admission entry must be 30 words or less
- Each trialUse must be 40 words or less
- Topics supported by 3+ witnesses come first
- If you cannot find substantive admissions, return an empty array. Do not invent admissions to fill the array.

${shared}`;

  console.log(
    `[ADMISSIONS] starting, sending ${userMessage.length} chars to Claude`,
  );
  const t = Date.now();
  let raw: string;
  try {
    raw = await callClaudeThrottled(
      apiKey,
      CASE_SYNTHESIS_SYSTEM,
      userMessage,
      3000,
      "admissionsInventory",
    );
  } catch (err) {
    console.error(
      `[ADMISSIONS] Claude call failed:`,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
  console.log(
    `[ADMISSIONS] received response, length=${raw.length} (in ${Date.now() - t}ms)`,
  );
  console.log(`[ADMISSIONS] first 500 chars of response: ${raw.slice(0, 500)}`);
  console.log(`[ADMISSIONS] last 500 chars of response: ${raw.slice(-500)}`);
  console.log(`[ADMISSIONS] parse attempt...`);
  try {
    const parsed = extractJSON(raw, "sub:admissionsInventory");
    console.log(`[ADMISSIONS] parsed successfully`);
    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ADMISSIONS] parse failed: ${msg}`);
    throw new Error(`Admissions inventory parse failed: ${msg}`);
  }
}

export async function synthesizeCausationAnalysis(
  apiKey: string,
  matter: MatterRow,
  cards: DepositionCard[],
): Promise<Record<string, unknown>> {
  const shared = buildSectionInput(matter, cards, "causationAnalysis");
  const userMessage = `Produce ONLY the CAUSATION ANALYSIS for this matter. No other keys. Most PI cases are won or lost on causation — be specific and grounded in the record.

${shared}

Return ONLY this JSON shape:
{
  "causationAnalysis": {
    "baselineConditions": [ "specific pre-accident condition with witness/cite, max 25 words" ],
    "priorAccidentSequelae": [ "specific prior-accident sequela with witness/cite, max 25 words" ],
    "accidentMechanism": "Narrative prose describing what the record establishes about THIS accident's mechanism and severity, with embedded inline (p.X lines Y-Z) citations. Plain prose, no JSON, no markdown.",
    "apportionmentArguments": [ "specific apportionment argument tied to baseline vs sequela, max 40 words" ],
    "weakestCausationLink": "Name the exact testimony or gap defense should drive at trial."
  }
}

Rules:
- baselineConditions: 3+ items if the record supports it
- priorAccidentSequelae: 2+ items if the record supports it
- apportionmentArguments: 3-6 items
- Do not include any other top-level keys`;
  return runSubSynthesis(apiKey, "causationAnalysis", userMessage, 3000);
}

export async function synthesizeMethodologyChallenges(
  apiKey: string,
  matter: MatterRow,
  cards: DepositionCard[],
): Promise<Record<string, unknown>> {
  const shared = buildSectionInput(matter, cards, "methodologyChallenges");
  const userMessage = `From the deposition cards below, identify every available methodology challenge to plaintiff's experts and treating providers, framed as motions. These are Daubert/Hallmark grounds the defense can deploy pretrial.

Common methodology challenge categories in PI cases:
- Testing administered through unqualified translators
- Reliance on patient self-report without objective verification
- No independent record review before forming opinions
- Scope-of-practice violations
- Departure from accepted protocols
- Foundation gaps for testimony given
- Bias indicators rendering opinions unreliable

Return ONLY this JSON:
{
  "methodologyChallenges": [
    {
      "targetWitness": "deponent name",
      "caseId": "<id>",
      "basis": "specific methodology problem with detail, max 50 words",
      "motionType": "Daubert | motion_in_limine | limit_testimony | exclude",
      "supportingCites": ["p.X, lines Y-Z", "p.A, lines B-C"]
    }
  ]
}

Rules:
- Return at least one methodology challenge for each plaintiff-side expert and treating provider in the cards (typically 4-8 challenges for a 12-witness PI matter)
- Each challenge must specify a concrete methodology problem, not a generic credibility concern
- supportingCites must include at least 2 specific page/line cites
- motionType must be one of the four enum values listed
- If a witness has no defensible methodology challenge, omit them — do not produce weak filler
- Use the exact caseId from each deposition card

${shared}`;
  return runSubSynthesis(apiKey, "methodologyChallenges", userMessage, 2500);
}

export async function synthesizeMotionsInLimine(
  apiKey: string,
  matter: MatterRow,
  cards: DepositionCard[],
): Promise<Record<string, unknown>> {
  const shared = buildSectionInput(matter, cards, "motionsInLimine");
  const userMessage = `Produce ONLY the MOTIONS IN LIMINE roadmap for this matter. No other keys.

${shared}

Return ONLY this JSON:
{
  "motionsInLimine": [
    {
      "motion": "specific motion title, max 15 words",
      "basis": "legal/factual basis with specific cites, max 50 words",
      "supportingCites": ["p.X, lines Y-Z"],
      "priority": "must_file | should_file | consider"
    }
  ]
}

Rules:
- Return 5-10 motions for a typical multi-witness PI matter
- must_file = case-defining; should_file = significant tactical advantage; consider = useful if budget allows
- Every motion must reference specific deposition testimony or admissions
- Do not include any other top-level keys`;
  return runSubSynthesis(apiKey, "motionsInLimine", userMessage, 3000);
}

export async function synthesizeDiscoveryGaps(
  apiKey: string,
  matter: MatterRow,
  cards: DepositionCard[],
): Promise<Record<string, unknown>> {
  const shared = buildSectionInput(matter, cards, "discoveryGaps");
  const userMessage = `From the deposition cards below, identify everything missing from the record that defense still needs but does not yet have. These are discovery gaps the defense should close before trial.

Discovery gap categories to look for:
- Pre-accident medical records that would establish baseline
- Prior accident records (workers' comp, prior MVAs)
- Provider financial records (lien amounts, fee histories, 1099s)
- Imaging/testing not yet obtained
- Witness statements or contact information not pursued
- Documents referenced in testimony but not produced
- Subsequent treatment records (post-deposition treatment)

Return ONLY this JSON:
{
  "discoveryGaps": [
    {
      "gap": "specific missing item, max 20 words",
      "impact": "why this matters to defense, max 40 words",
      "recommendedAction": "specific subpoena/RFP/deposition needed, max 30 words",
      "priority": "high | medium | low"
    }
  ]
}

Rules:
- Return at least 5 discovery gaps for a typical multi-witness PI matter (defense always has gaps)
- 'high' priority = needed before MSJ deadline
- 'medium' priority = needed before pretrial conference
- 'low' priority = useful for trial prep but not critical
- Each gap must reference something concrete from the deposition cards (a witness mentioned a record, an unanswered question, a financial relationship not quantified)
- Do not list things defense already has — only true gaps

${shared}`;
  return runSubSynthesis(apiKey, "discoveryGaps", userMessage, 2000);
}

export async function synthesizeWhatWeMessedUp(
  apiKey: string,
  matter: MatterRow,
  cards: DepositionCard[],
): Promise<Record<string, unknown>> {
  const shared = buildSectionInput(matter, cards, "whatWeMessedUp");
  const userMessage = `Produce ONLY the MISSED OPPORTUNITIES retrospective for this matter. No other keys. Real critique — what defense counsel failed to do in deposition that mattered.

${shared}

Return ONLY this JSON:
{
  "whatWeMessedUp": [
    {
      "deposition": "deponent name",
      "caseId": "<id>",
      "missedOpportunity": "specific question or topic that should have been pursued, max 40 words",
      "wouldHaveHelped": "what defense would have gained, max 30 words",
      "canStillFix": true,
      "fixAction": "specific follow-up deposition, supplemental discovery, or motion that recovers it; empty string if not fixable"
    }
  ]
}

Rules:
- Return 5-10 missed opportunities for a typical multi-witness PI matter
- canStillFix = true if a follow-up deposition, supplemental discovery, or motion can recover
- canStillFix = false if the moment has passed (e.g. trial is imminent, witness unavailable)
- Use the exact caseId from each deposition card
- Do not include any other top-level keys`;
  return runSubSynthesis(apiKey, "whatWeMessedUp", userMessage, 3000);
}

export async function synthesizeWhatToDoNext(
  apiKey: string,
  matter: MatterRow,
  cards: DepositionCard[],
): Promise<Record<string, unknown>> {
  const shared = buildSectionInput(matter, cards, "whatToDoNext");
  const userMessage = `From the deposition cards below and the rest of the synthesis context, produce a prioritized action list for defense counsel. What should defense actually do this week, before trial, and optionally?

Next-step categories:
- File specific motion (with deadline)
- Take supplemental deposition of [witness] on [topic]
- Subpoena specific records from specific party
- Retain expert in specific specialty
- Draft jury instruction on specific issue
- Prepare specific exhibit (chart, timeline, comparison)
- Settlement conference / mediation prep with specific exposure analysis

Return ONLY this JSON:
{
  "whatToDoNext": [
    {
      "action": "specific actionable instruction, max 30 words",
      "priority": "this_week | before_trial | consider",
      "rationale": "why this matters and how it advances the defense, max 40 words"
    }
  ]
}

Rules:
- Return at least 8 actions for a typical multi-witness PI matter
- 'this_week' = drop everything and do this; tied to a near-term deadline or strategic urgency
- 'before_trial' = put on pretrial checklist
- 'consider' = useful if time/budget allows
- Each action must be a specific, executable instruction — not generic advice
- Actions should connect to specific findings (e.g., 'File Daubert motion against Baumann based on translator methodology issue')
- Mix of motion practice, additional discovery, expert retention, exhibit preparation, and trial prep

${shared}`;
  return runSubSynthesis(apiKey, "whatToDoNext", userMessage, 2000);
}

function mergeSynthesis(
  matter: MatterRow,
  parts: Record<string, unknown>,
): CaseSynthesis {
  const parsed = parts as Partial<CaseSynthesis>;
  const exec = (parsed.execSummary ?? {}) as Partial<CaseSynthesis["execSummary"]>;
  const causation = (parsed.causationAnalysis ?? {}) as Partial<
    CaseSynthesis["causationAnalysis"]
  >;
  const bias = (parsed.biasNarrative ?? {}) as Partial<CaseSynthesis["biasNarrative"]>;

  return {
    matterId: matter.id,
    execSummary: {
      defenseTheory: exec.defenseTheory ?? "",
      caseStrength: ([
        "strong",
        "favorable",
        "mixed",
        "unfavorable",
        "weak",
      ].includes(exec.caseStrength as string)
        ? (exec.caseStrength as CaseSynthesis["execSummary"]["caseStrength"])
        : "mixed"),
      strengthRationale: exec.strengthRationale ?? "",
      topThreats: Array.isArray(exec.topThreats) ? exec.topThreats : [],
      topOpportunities: Array.isArray(exec.topOpportunities)
        ? exec.topOpportunities
        : [],
      recommendedPosture: ([
        "trial",
        "settle_low",
        "settle_midrange",
        "settle_high",
        "more_discovery",
      ].includes(exec.recommendedPosture as string)
        ? (exec.recommendedPosture as CaseSynthesis["execSummary"]["recommendedPosture"])
        : "more_discovery"),
      postureRationale: exec.postureRationale ?? "",
    },
    witnessThreatRanking: Array.isArray(parsed.witnessThreatRanking)
      ? parsed.witnessThreatRanking
      : [],
    contradictionMatrix: Array.isArray(parsed.contradictionMatrix)
      ? parsed.contradictionMatrix
      : [],
    unifiedAdmissionsInventory: Array.isArray(parsed.unifiedAdmissionsInventory)
      ? parsed.unifiedAdmissionsInventory
      : [],
    causationAnalysis: {
      baselineConditions: Array.isArray(causation.baselineConditions)
        ? causation.baselineConditions
        : [],
      priorAccidentSequelae: Array.isArray(causation.priorAccidentSequelae)
        ? causation.priorAccidentSequelae
        : [],
      accidentMechanism: causation.accidentMechanism ?? "",
      apportionmentArguments: Array.isArray(causation.apportionmentArguments)
        ? causation.apportionmentArguments
        : [],
      weakestCausationLink: causation.weakestCausationLink ?? "",
    },
    methodologyChallenges: Array.isArray(parsed.methodologyChallenges)
      ? parsed.methodologyChallenges
      : [],
    biasNarrative: {
      pipelineMap: bias.pipelineMap ?? "",
      financialRelationships: Array.isArray(bias.financialRelationships)
        ? bias.financialRelationships
        : [],
      repeatPlayerPatterns: Array.isArray(bias.repeatPlayerPatterns)
        ? bias.repeatPlayerPatterns
        : [],
      trialNarrative: bias.trialNarrative ?? "",
    },
    motionsInLimine: Array.isArray(parsed.motionsInLimine)
      ? parsed.motionsInLimine
      : [],
    discoveryGaps: Array.isArray(parsed.discoveryGaps) ? parsed.discoveryGaps : [],
    trialThemes: Array.isArray(parsed.trialThemes) ? parsed.trialThemes : [],
    whatWeMessedUp: Array.isArray(parsed.whatWeMessedUp)
      ? parsed.whatWeMessedUp
      : [],
    whatToDoNext: Array.isArray(parsed.whatToDoNext) ? parsed.whatToDoNext : [],
  };
}

interface SubCall {
  key: string;
  label: string;
  progress: number;
  message: string;
  /** Top-level CaseSynthesis keys this sub-call populates. Used during
   *  partial reruns to overlay only the sections the sub-call owns. */
  resultKeys: Array<keyof CaseSynthesis>;
  fn: (
    apiKey: string,
    matter: MatterRow,
    cards: DepositionCard[],
  ) => Promise<Record<string, unknown>>;
}

const SUB_CALLS: SubCall[] = [
  { key: "execSummary", label: "Executive Summary", progress: 86, message: "Synthesizing executive summary", resultKeys: ["execSummary"], fn: synthesizeExecSummary },
  { key: "biasNarrative", label: "Bias Narrative", progress: 87, message: "Building bias narrative", resultKeys: ["biasNarrative"], fn: synthesizeBiasNarrative },
  { key: "trialThemes", label: "Trial Themes", progress: 88, message: "Identifying trial themes", resultKeys: ["trialThemes"], fn: synthesizeTrialThemes },
  { key: "witnessThreats", label: "Witness Threats", progress: 90, message: "Ranking witness threats", resultKeys: ["witnessThreatRanking"], fn: synthesizeWitnessThreats },
  { key: "contradictions", label: "Contradictions", progress: 91, message: "Mapping contradictions", resultKeys: ["contradictionMatrix"], fn: synthesizeContradictions },
  { key: "admissionsInventory", label: "Admissions Inventory", progress: 92, message: "Building admissions inventory", resultKeys: ["unifiedAdmissionsInventory"], fn: synthesizeAdmissionsInventory },
  { key: "causationAnalysis", label: "Causation Analysis", progress: 93, message: "Analyzing causation", resultKeys: ["causationAnalysis"], fn: synthesizeCausationAnalysis },
  { key: "methodologyChallenges", label: "Methodology Challenges", progress: 94, message: "Identifying methodology challenges", resultKeys: ["methodologyChallenges"], fn: synthesizeMethodologyChallenges },
  { key: "motionsInLimine", label: "Motions in Limine", progress: 95, message: "Drafting motions in limine", resultKeys: ["motionsInLimine"], fn: synthesizeMotionsInLimine },
  { key: "discoveryGaps", label: "Discovery Gaps", progress: 96, message: "Identifying discovery gaps", resultKeys: ["discoveryGaps"], fn: synthesizeDiscoveryGaps },
  { key: "whatWeMessedUp", label: "Missed Opportunities", progress: 97, message: "Identifying missed opportunities", resultKeys: ["whatWeMessedUp"], fn: synthesizeWhatWeMessedUp },
  { key: "whatToDoNext", label: "Next Steps", progress: 98, message: "Building action list", resultKeys: ["whatToDoNext"], fn: synthesizeWhatToDoNext },
];

export async function synthesizeMatter(
  apiKey: string,
  matter: MatterRow,
  cards: DepositionCard[],
  onProgress?: (p: { progress: number; message: string }) => Promise<void>,
  onlyKeys?: string[],
): Promise<{
  result: CaseSynthesis;
  failedSections: FailedSection[];
  successCount: number;
  attemptedKeys: string[];
  succeededKeys: string[];
}> {
  const merged: Record<string, unknown> = {};
  const failedSections: FailedSection[] = [];
  let successCount = 0;
  const attemptedKeys: string[] = [];
  const succeededKeys: string[] = [];
  const subset = onlyKeys && onlyKeys.length > 0
    ? SUB_CALLS.filter((s) => onlyKeys.includes(s.key))
    : SUB_CALLS;

  for (const sub of subset) {
    attemptedKeys.push(sub.key);
    if (onProgress) {
      await onProgress({ progress: sub.progress, message: sub.message });
    }
    try {
      const part = await sub.fn(apiKey, matter, cards);
      if (part && Object.keys(part).length > 0) {
        Object.assign(merged, part);
        successCount += 1;
        succeededKeys.push(sub.key);
      } else {
        failedSections.push({
          section: sub.key,
          error: "Sub-call returned an empty response (likely JSON parse failure).",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[synthesize.process] sub:${sub.key} failed:`, message);
      failedSections.push({ section: sub.key, error: message });
    }
  }

  return {
    result: mergeSynthesis(matter, merged),
    failedSections,
    successCount,
    attemptedKeys,
    succeededKeys,
  };
}

async function updateSynthesis(
  supabase: SupabaseClient,
  id: string,
  fields: Record<string, unknown>,
) {
  const { error } = await supabase.from("matter_syntheses").update(fields).eq("id", id);
  if (error) console.error("[synthesize.process] updateSynthesis error:", error.message);
}

function createSynthesisClient(): SupabaseClient {
  const SUPABASE_URL = getEnv("SUPABASE_URL") ?? getEnv("VITE_SUPABASE_URL");
  const SUPABASE_KEY =
    getEnv("SUPABASE_SERVICE_ROLE_KEY") ??
    getEnv("SUPABASE_PUBLISHABLE_KEY") ??
    getEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Backend not configured");
  }
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

function labelCase(c: CaseRow): string {
  const snapshot = (c.case_snapshot as Partial<CaseSnapshot> | null) ?? null;
  return snapshot?.caseName || c.case_name || c.id.slice(0, 8);
}

export async function runSynthesis(synthesisId: string) {
  console.log(`[synthesize.process] starting ${synthesisId}`);
  let supabase: SupabaseClient | null = null;
  try {
    supabase = createSynthesisClient();
    const apiKey = getEnv("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("Anthropic API key not configured");

    const { data: row, error: rErr } = await supabase
      .from("matter_syntheses")
      .select("id, matter_id, status, case_ids")
      .eq("id", synthesisId)
      .single();
    if (rErr || !row) throw new Error(rErr?.message ?? "Synthesis not found");
    if (row.status !== "pending") {
      console.log(`[synthesize.process] already ${row.status}, skipping`);
      return;
    }

    await updateSynthesis(supabase, synthesisId, {
      status: "processing",
      progress: 1,
      progress_message: "Starting synthesis...",
      error: null,
    });

    const { data: matter, error: mErr } = await supabase
      .from("matters")
      .select("id, name, description")
      .eq("id", row.matter_id)
      .single();
    if (mErr || !matter) throw new Error(mErr?.message ?? "Matter not found");

    const { data: cases, error: cErr } = await supabase
      .from("cases")
      .select("id, case_name, result, case_snapshot, deposition_card")
      .in("id", row.case_ids as string[]);
    if (cErr) throw new Error(cErr.message);
    const caseRows = (cases ?? []) as CaseRow[];
    if (caseRows.length === 0) throw new Error("No cases found for synthesis.");

    // Stage A — extract any missing deposition cards.
    const cards: DepositionCard[] = [];
    let idx = 0;
    for (const c of caseRows) {
      idx += 1;
      if (c.deposition_card) {
        cards.push(c.deposition_card);
        continue;
      }
      await updateSynthesis(supabase, synthesisId, {
        progress: Math.min(10 + Math.floor((idx / caseRows.length) * 70), 80),
        progress_message: `Extracting card ${idx} of ${caseRows.length}: ${labelCase(c)}`,
      });
      const card = await extractDepositionCard(apiKey, c);
      const { error: upErr } = await supabase
        .from("cases")
        .update({ deposition_card: card })
        .eq("id", c.id);
      if (upErr) {
        console.error(
          `[synthesize.process] failed to persist deposition_card for ${c.id}:`,
          upErr.message,
        );
      }
      cards.push(card);
    }

    // Stage B — synthesize.
    await updateSynthesis(supabase, synthesisId, {
      progress: 85,
      progress_message: "Running case-level synthesis",
      failed_sections: [],
    });
    const { result, failedSections, successCount } = await synthesizeMatter(
      apiKey,
      matter as MatterRow,
      cards,
      async ({ progress, message }) => {
        await updateSynthesis(supabase!, synthesisId, {
          progress,
          progress_message: message,
        });
      },
    );

    let finalStatus: "complete" | "complete_with_errors" | "error";
    let finalMessage: string;
    if (successCount === 0) {
      finalStatus = "error";
      finalMessage = "Synthesis failed: every section call failed.";
    } else if (failedSections.length > 0) {
      finalStatus = "complete_with_errors";
      finalMessage = `Synthesis complete with errors (${failedSections.length} section${failedSections.length === 1 ? "" : "s"} failed).`;
    } else {
      finalStatus = "complete";
      finalMessage = "Synthesis complete.";
    }

    await updateSynthesis(supabase, synthesisId, {
      status: finalStatus,
      progress: 100,
      progress_message: finalMessage,
      result,
      failed_sections: failedSections,
      error: finalStatus === "error" ? finalMessage : null,
    });
    console.log(
      `[synthesize.process] ${synthesisId} ${finalStatus} (${successCount}/${SUB_CALLS.length} sub-calls succeeded)`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[synthesize.process] ${synthesisId} fatal:`, message);
    if (supabase) {
      await updateSynthesis(supabase, synthesisId, {
        status: "error",
        error: message,
        progress_message: "Synthesis failed.",
      });
    }
  }
}

/**
 * Re-runs only the specified sub-calls on an existing synthesis row, merging
 * the new results into the existing CaseSynthesis. Successfully completed
 * sub-calls are left untouched.
 */
export async function runSynthesisRetrySections(
  synthesisId: string,
  sectionKeys: string[],
) {
  console.log(
    `[synthesize.process] retry ${synthesisId} sections=${sectionKeys.join(",")}`,
  );
  let supabase: SupabaseClient | null = null;
  try {
    supabase = createSynthesisClient();
    const apiKey = getEnv("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("Anthropic API key not configured");

    // Map any legacy section keys to their current equivalents. Several
    // combined sub-calls have been split into single-deliverable ones; when a
    // user asks to retry an old key, expand it to the full set of new keys
    // that replaced it.
    const remapped = sectionKeys.flatMap((k) => {
      if (k === "contradictionsAdmissions") {
        return ["contradictions", "admissionsInventory"];
      }
      if (k === "strategicOverview") {
        return ["execSummary", "biasNarrative", "trialThemes"];
      }
      if (k === "causationMethodology") {
        return ["causationAnalysis", "methodologyChallenges"];
      }
      if (k === "motionsDiscovery") {
        return ["motionsInLimine", "discoveryGaps"];
      }
      if (k === "retrospective") {
        return ["whatWeMessedUp", "whatToDoNext"];
      }
      return [k];
    });
    const validKeys = Array.from(
      new Set(remapped.filter((k) => SUB_CALLS.some((s) => s.key === k))),
    );
    if (validKeys.length === 0) {
      throw new Error("No valid section keys to retry.");
    }

    const { data: row, error: rErr } = await supabase
      .from("matter_syntheses")
      .select(
        "id, matter_id, status, case_ids, result, failed_sections",
      )
      .eq("id", synthesisId)
      .single();
    if (rErr || !row) throw new Error(rErr?.message ?? "Synthesis not found");

    await updateSynthesis(supabase, synthesisId, {
      status: "processing",
      progress: 5,
      progress_message: `Re-running ${validKeys.length} section${validKeys.length === 1 ? "" : "s"}...`,
      error: null,
    });

    const { data: matter, error: mErr } = await supabase
      .from("matters")
      .select("id, name, description")
      .eq("id", row.matter_id)
      .single();
    if (mErr || !matter) throw new Error(mErr?.message ?? "Matter not found");

    const { data: cases, error: cErr } = await supabase
      .from("cases")
      .select("id, case_name, result, case_snapshot, deposition_card")
      .in("id", row.case_ids as string[]);
    if (cErr) throw new Error(cErr.message);
    const caseRows = (cases ?? []) as CaseRow[];

    const cards: DepositionCard[] = [];
    for (const c of caseRows) {
      if (c.deposition_card) {
        cards.push(c.deposition_card);
      } else {
        // Fallback: extract on the fly. (Should rarely happen on retry.)
        const card = await extractDepositionCard(apiKey, c);
        await supabase
          .from("cases")
          .update({ deposition_card: card })
          .eq("id", c.id);
        cards.push(card);
      }
    }

    const {
      result: partialResult,
      failedSections: newFailures,
      succeededKeys,
      attemptedKeys,
    } = await synthesizeMatter(
      apiKey,
      matter as MatterRow,
      cards,
      async ({ progress, message }) => {
        await updateSynthesis(supabase!, synthesisId, {
          progress,
          progress_message: message,
        });
      },
      validKeys,
    );

    // Merge: start from existing result, overlay only the resultKeys for
    // sub-calls that succeeded this time. Anything that failed again or was
    // not attempted keeps the prior value.
    const existing = (row.result as CaseSynthesis | null) ?? null;
    const merged: CaseSynthesis = existing
      ? { ...existing }
      : partialResult; // no prior result — use what we just produced
    if (existing) {
      for (const key of succeededKeys) {
        const sub = SUB_CALLS.find((s) => s.key === key);
        if (!sub) continue;
        for (const rk of sub.resultKeys) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (merged as any)[rk] = (partialResult as any)[rk];
        }
      }
    }

    // Compute updated failed_sections: drop any prior failures whose section
    // we just retried successfully; add new failures from this run.
    const priorFailures = Array.isArray(row.failed_sections)
      ? (row.failed_sections as unknown[])
      : [];
    const priorNormalized: FailedSection[] = priorFailures
      .map((entry) => {
        if (typeof entry === "string") {
          return { section: entry, error: "Unknown error (legacy run)." };
        }
        if (entry && typeof entry === "object") {
          const e = entry as { section?: unknown; error?: unknown };
          return {
            section: typeof e.section === "string" ? e.section : "",
            error: typeof e.error === "string" ? e.error : "Unknown error.",
          };
        }
        return { section: "", error: "" };
      })
      .filter((f) => f.section);
    const remainingPrior = priorNormalized.filter(
      (f) => {
        // Drop legacy section keys that no longer exist in SUB_CALLS — they
        // are dead entries from prior pipeline versions and should never be
        // resurfaced (e.g. the old combined "contradictionsAdmissions").
        if (!SUB_CALLS.some((s) => s.key === f.section)) return false;
        // Drop entries we just retried (whether they succeeded or failed
        // again — failures are re-added below from newFailures).
        if (attemptedKeys.includes(f.section)) return false;
        if (succeededKeys.includes(f.section)) return false;
        return true;
      },
    );
    const updatedFailures: FailedSection[] = [...remainingPrior, ...newFailures];

    let finalStatus: "complete" | "complete_with_errors";
    if (updatedFailures.length === 0) {
      finalStatus = "complete";
    } else {
      finalStatus = "complete_with_errors";
    }

    await updateSynthesis(supabase, synthesisId, {
      status: finalStatus,
      progress: 100,
      progress_message:
        finalStatus === "complete"
          ? "Synthesis complete."
          : `Synthesis complete with errors (${updatedFailures.length} section${updatedFailures.length === 1 ? "" : "s"} still failing).`,
      result: merged,
      failed_sections: updatedFailures,
      error: null,
    });
    console.log(
      `[synthesize.process] retry ${synthesisId} ${finalStatus}: ${succeededKeys.length}/${attemptedKeys.length} succeeded`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[synthesize.process] retry ${synthesisId} fatal:`, message);
    if (supabase) {
      await updateSynthesis(supabase, synthesisId, {
        status: "error",
        error: message,
        progress_message: "Retry failed.",
      });
    }
  }
}

export const Route = createFileRoute("/api/synthesize/process")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        let parsed: z.infer<typeof InputSchema>;
        try {
          parsed = InputSchema.parse(await request.json());
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "Invalid input" },
            { status: 400 },
          );
        }
        await runSynthesis(parsed.synthesisId);
        return Response.json({ ok: true });
      },
    },
  },
});