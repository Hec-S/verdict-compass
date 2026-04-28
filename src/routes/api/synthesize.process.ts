import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { callClaude } from "./analyze.process";
import type {
  DepositionCard,
  CaseSynthesis,
  AnalysisResult,
  CaseSnapshot,
} from "@/lib/analysis-types";

const InputSchema = z.object({ synthesisId: z.string().uuid() });

function getEnv(key: string): string | undefined {
  const g = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
    Deno?: { env?: { get?: (k: string) => string | undefined } };
  };
  return g.process?.env?.[key] ?? g.Deno?.env?.get?.(key);
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
    // Truncated JSON — attempt a best-effort recovery by trimming trailing
    // partial content and closing open arrays/objects.
    console.warn(
      `[synthesize.process] ${label} JSON.parse failed, attempting recovery:`,
      err instanceof Error ? err.message : String(err),
    );
    const recovered = tryRecoverJSON(slice);
    if (recovered) return recovered;
    throw err;
  }
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

// ---------------- Stage B — Case-level synthesis ----------------

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

Respond with ONLY a valid JSON object matching the CaseSynthesis schema. No markdown, no preamble, no commentary.`;

export async function synthesizeMatter(
  apiKey: string,
  matter: MatterRow,
  cards: DepositionCard[],
): Promise<CaseSynthesis> {
  const userMessage = `Produce the case-level defense synthesis for this matter.

MATTER: ${matter.name}
DESCRIPTION: ${matter.description ?? ""}

DEPOSITION CARDS (${cards.length} witnesses):
${JSON.stringify(cards, null, 2)}

Return ONLY this JSON:
${CASE_SYNTHESIS_SCHEMA}

Specific instructions for each section:
- execSummary.defenseTheory: 2-3 sentences. State the operative defense theory grounded in this record. If the record best supports causation apportionment, say so. If it best supports credibility attack, say so. If it best supports methodology challenge to plaintiff's experts, say so. Do not produce a generic theory.
- execSummary.caseStrength: your honest assessment based on the cards. Strong = defense wins on summary judgment or directed verdict. Favorable = defense wins at trial absent surprises. Mixed = jury question with reasonable defense verdict possible. Unfavorable = plaintiff wins absent settlement or strong trial performance. Weak = plaintiff wins.
- execSummary.recommendedPosture: trial / settle_low / settle_midrange / settle_high / more_discovery. Be specific in postureRationale about the dollar range you have in mind given Nevada verdict patterns for the injury type at issue.
- witnessThreatRanking: rank EVERY deponent by how dangerous they are to the defense at trial, 1 = most dangerous. crossPriorities are 3-5 specific cross themes per witness, written as direct instructions to defense counsel.
- contradictionMatrix: identify every meaningful contradiction across witnesses. exploitability is high if you can put two witnesses' deposition transcripts side-by-side at trial; medium if it requires setup; low if it is real but probably won't move the jury.
- unifiedAdmissionsInventory: group admissions by topic, not by witness. The most powerful admissions are the ones supported by multiple witnesses.
- causationAnalysis: this is where most PI cases are won or lost. Be specific about baselineConditions and priorAccidentSequelae established in the record. weakestCausationLink should name the exact testimony or gap that defense should drive at trial.
- methodologyChallenges: every available challenge to plaintiff's experts and treating providers, framed as motions. Include cites back to specific deposition admissions.
- biasNarrative: tell the litigation-pipeline story as a narrative that could become an opening or closing argument. pipelineMap should literally trace who referred whom in the order it happened.
- motionsInLimine: motions you should file pretrial. Priority: must_file = case-defining; should_file = significant tactical advantage; consider = useful if budget allows.
- discoveryGaps: what's missing from the record that defense still needs. priority high = before MSJ deadline; medium = before pretrial; low = useful but not critical.
- trialThemes: 3-5 themes max. Each must be supported by 3+ witnesses or 3+ specific facts. Themes supported by only one witness do not belong here.
- whatWeMessedUp: real critique. For each deposition, identify what defense counsel missed that they should have asked. canStillFix is true if a follow-up deposition, supplemental discovery, or motion can recover the missed opportunity; false if the moment has passed.
- whatToDoNext: prioritized action list. this_week = drop everything and do this; before_trial = put on the pretrial checklist; consider = if time/budget allows.`;

  const t = Date.now();
  const raw = await callClaude(apiKey, CASE_SYNTHESIS_SYSTEM, userMessage, 8000);
  console.log(
    `[synthesize.process] synthesizeMatter ${matter.id} ok in ${Date.now() - t}ms (${raw.length} chars)`,
  );

  // Detect possible truncation: closing brace not present at the very end.
  const trimmed = raw.trim();
  if (!trimmed.endsWith("}")) {
    console.warn(
      `[synthesize.process] synthesizeMatter output may be truncated (does not end with '}')`,
    );
  }

  const parsed = extractJSON(raw, `synthesis:${matter.id}`) as Partial<CaseSynthesis>;

  const exec = (parsed.execSummary ?? {}) as Partial<CaseSynthesis["execSummary"]>;
  const causation = (parsed.causationAnalysis ?? {}) as Partial<
    CaseSynthesis["causationAnalysis"]
  >;
  const bias = (parsed.biasNarrative ?? {}) as Partial<CaseSynthesis["biasNarrative"]>;

  const synthesis: CaseSynthesis = {
    matterId: matter.id,
    execSummary: {
      defenseTheory: exec.defenseTheory ?? "",
      caseStrength:
        (["strong", "favorable", "mixed", "unfavorable", "weak"].includes(
          exec.caseStrength as string,
        )
          ? (exec.caseStrength as CaseSynthesis["execSummary"]["caseStrength"])
          : "mixed"),
      strengthRationale: exec.strengthRationale ?? "",
      topThreats: Array.isArray(exec.topThreats) ? exec.topThreats : [],
      topOpportunities: Array.isArray(exec.topOpportunities)
        ? exec.topOpportunities
        : [],
      recommendedPosture:
        ([
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
  return synthesis;
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
  const supabase = createSynthesisClient();
  console.log(`[synthesize.process] starting ${synthesisId}`);
  try {
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
        progress_message: `Extracting deposition card ${idx} of ${caseRows.length}…`,
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
      progress_message: "Running case-level synthesis…",
    });
    const result = await synthesizeMatter(apiKey, matter as MatterRow, cards);

    await updateSynthesis(supabase, synthesisId, {
      status: "complete",
      progress: 100,
      progress_message: "Synthesis complete.",
      result,
    });
    console.log(`[synthesize.process] ${synthesisId} complete`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[synthesize.process] ${synthesisId} fatal:`, message);
    await updateSynthesis(supabase, synthesisId, {
      status: "error",
      error: message,
      progress_message: "Synthesis failed.",
    });
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
        const SUPABASE_URL = getEnv("SUPABASE_URL") ?? getEnv("VITE_SUPABASE_URL");
        const SUPABASE_KEY =
          getEnv("SUPABASE_PUBLISHABLE_KEY") ?? getEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
        const apiKey = getEnv("ANTHROPIC_API_KEY");
        if (!SUPABASE_URL || !SUPABASE_KEY || !apiKey) {
          return Response.json({ error: "Backend not configured" }, { status: 500 });
        }
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        await runSynthesis(supabase, parsed.synthesisId, apiKey);
        return Response.json({ ok: true });
      },
    },
  },
});