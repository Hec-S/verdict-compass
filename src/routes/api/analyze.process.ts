import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { USER_ROLE } from "@/lib/user-role";

const InputSchema = z.object({ jobId: z.string().uuid() });

function getEnv(key: string): string | undefined {
  const g = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
    Deno?: { env?: { get?: (k: string) => string | undefined } };
  };
  return g.process?.env?.[key] ?? g.Deno?.env?.get?.(key);
}

const DEFENSE_FRAMING = `CRITICAL FRAMING: The user of this analysis is DEFENSE COUNSEL. Every observation, evaluation, and recommendation must be written from the defense's perspective. "What went well" means what went well FOR THE DEFENSE. "What didn't go well" means what hurt the defense. Witness performance evaluates how each witness helped or hurt the defense's case. Strategic recommendations are written as direct advice to defense counsel for retrial, appeal, or future similar cases. Never write from the plaintiff's perspective. Never describe outcomes neutrally. The defense is "we" / "our client" — the plaintiff is "opposing counsel" / "the plaintiff."`;

const ROLE_FRAMING: Record<string, string> = {
  defense: DEFENSE_FRAMING,
};
const FRAMING = ROLE_FRAMING[USER_ROLE] ?? DEFENSE_FRAMING;

const SYSTEM_PROMPT = `You are a senior trial attorney with 25 years of civil litigation experience analyzing litigation transcripts.

${FRAMING}

Respond with ONLY a valid JSON object. Do not include any markdown, do not wrap the response in code fences, do not include any text before or after the JSON object. Your entire response must begin with { and end with }.

"credibility" must be exactly one of: "Strong", "Mixed", "Weak".
"ruling" must be "Sustained" or "Overruled" (or describe briefly if neither applies).

If you cannot complete a section, return the requested JSON shape with empty arrays/strings rather than prose.`;

const COMPRESSION_PROMPT = `You are a litigation analyst supporting DEFENSE COUNSEL. Read this court transcript and produce a dense structured summary that preserves all legally significant content. Flag every detail that helps or hurts the defense.

${FRAMING}

Include:
- Every witness name, role, and key statements they made
- Every objection, the grounds stated, and the ruling
- Every admission or damaging concession made by any witness
- All evidence and exhibits referenced
- The full jury charge conference discussion
- Any directed verdict motions and rulings
- Exact page and line references for every item above

Write this as dense prose paragraphs, not bullet points. Be thorough — a trial attorney will use this summary as the sole basis for a post-trial analysis. Do not summarize away details. Return only the summary text, no JSON, no preamble.`;

interface SectionSpec {
  key: string;
  label: string;
  progress: number;
  schema: string;
  fallback: Record<string, unknown>;
  instructions?: string;
}

const SECTIONS: SectionSpec[] = [
  {
    key: "snapshot",
    label: "Identifying key moments… (2/5)",
    progress: 30,
    schema: `{
  "caseSnapshot": {
    "caseName": "string - case name only, e.g. 'In Re Juan J. Cruz, No. 13-25-00460-CV'",
    "court": "string - court name only, no parties or posture, max 8 words",
    "posture": "string - procedural posture in 2-4 words, e.g. 'Mandamus proceeding' or 'Jury trial'",
    "plaintiff": "string - plaintiff or relator name only",
    "defendant": "string - defendant or real party in interest name only",
    "filed": "string - date the underlying incident or filing occurred, e.g. 'September 20, 2019'",
    "outcome": "string - final outcome in 2-5 words, e.g. 'Defense verdict (reinstated)'",
    "bottomLine": "string - ONE sentence, max 25 words, written from the DEFENSE perspective. If defense won, frame it as a win. If defense lost, frame it factually but neutrally — never celebrate a defense loss. This is the one-sentence headline a defense attorney would use to brief their partner on the case. Plain English, lead with core fact not procedure. No medical details, expert names, or procedural history."
  },
  "criticalMoments": [ { "page": "", "parties": "", "what": "", "why": "" } ]
}`,
    fallback: {
      caseSnapshot: {
        caseName: "",
        court: "",
        posture: "",
        plaintiff: "",
        defendant: "",
        filed: "",
        outcome: "",
        bottomLine: "",
      },
      criticalMoments: [],
    },
  },
  {
    key: "findings",
    label: "Evaluating wins and losses… (3/5)",
    progress: 50,
    instructions: `You are reviewing a litigation transcript summary for DEFENSE COUNSEL. Identify specific moments, tactics, evidence, rulings, and strategic decisions that affected the defense's position — both positively and negatively.

YOU MUST ALWAYS RETURN AT LEAST 3 ITEMS in wentWell AND AT LEAST 3 ITEMS in wentPoorly. Empty arrays are not acceptable.

If the defense WON the case, wentWell items are the specific reasons they won (good cross-examination, effective impeachment, favorable rulings, helpful admissions). wentPoorly items are areas where the defense could STILL have done better — missed opportunities, weak moments that almost hurt them, issues that nearly went the other way.

If the defense LOST the case, wentPoorly items are the specific reasons they lost. wentWell items are things the defense did well despite losing — strong moments, well-handled witnesses, preserved appellate issues.

Even in a clean defense win, there are always moments that could have been handled better — find them. Even in a defense loss, there are always things the defense did well — find them.

The "fix" field in wentPoorly is direct second-person advice to defense counsel ("On retrial, push harder on…", "You should have…").

Categories for wentWell: Cross-Examination | Impeachment | Evidence | Witness Testimony | Objection | Jury Charge | Strategy.
Categories for wentPoorly: Cross-Examination | Witness Preparation | Evidence | Objection | Strategy | Damages.
Title max 8 words. Detail 2-3 sentences with specific quotes or facts. Cite the page/volume reference.`,
    schema: `{
  "wentWell": [ { "category": "", "title": "", "detail": "", "cite": "" } ],
  "wentPoorly": [ { "category": "", "title": "", "detail": "", "cite": "", "fix": "" } ]
}`,
    fallback: { wentWell: [], wentPoorly: [] },
  },
  {
    key: "witnesses",
    label: "Scoring witnesses… (4/5)",
    progress: 70,
    instructions: `For each witness, evaluate their testimony from the DEFENSE'S perspective:
- "credibility" = how credible they appeared to the jury (Strong / Mixed / Weak).
- "bestMoment" = the moment in their testimony that was MOST HELPFUL TO THE DEFENSE (or least damaging).
- "worstMoment" = the moment in their testimony that was MOST DAMAGING TO THE DEFENSE.
- "strategicValue" = whether this witness helped or hurt the defense overall, and why.
For the defense's own witnesses, "bestMoment" is their strongest testimony for our side. For the plaintiff's witnesses, "bestMoment" is where they were impeached, contradicted, or made admissions favorable to us.

For each objection, evaluate from the DEFENSE'S perspective:
- If defense made the objection: was it well-placed and was the ruling favorable to us?
- If plaintiff made the objection: was their objection a strategic threat and did the court's ruling protect our position?
- "significance" = whether this objection or ruling helped or hurt the defense's trial position.

In the "role" field, identify which side called the witness using one of: "Defense witness", "Plaintiff witness", "Court witness". You may add a brief descriptor after a comma (e.g. "Defense witness, treating physician").`,
    schema: `{
  "witnesses": [ { "name": "", "role": "", "credibility": "", "bestMoment": "", "worstMoment": "", "strategicValue": "" } ],
  "objections": [ { "party": "", "grounds": "", "ruling": "", "significance": "" } ]
}`,
    fallback: { witnesses: [], objections: [] },
  },
  {
    key: "recommendations",
    label: "Building recommendations… (5/5)",
    progress: 90,
    instructions: `"recommendations" are direct strategic advice to DEFENSE COUNSEL only. Each recommendation should answer: "What should defense counsel do differently next time, on appeal, or in similar future cases?" Address the defense directly — use phrases like "On retrial, defense should…" or "For future similar cases, consider…". Do NOT include recommendations directed at the plaintiff. Do NOT recommend things the defense already did well.`,
    schema: `{
  "juryChargeIssues": [ { "dispute": "", "plaintiffArg": "", "defenseArg": "", "resolution": "", "impact": "" } ],
  "recommendations": [ "" ]
}`,
    fallback: { juryChargeIssues: [], recommendations: [] },
  },
];

function extractJSON(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in response: " + cleaned.slice(0, 200));
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callClaude(
  apiKey: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error("Anthropic returned no text");
  return text;
}

async function updateJob(
  supabase: SupabaseClient,
  jobId: string,
  fields: Record<string, unknown>,
) {
  const { error } = await supabase.from("analysis_jobs").update(fields).eq("id", jobId);
  if (error) console.error("[process] updateJob error:", error.message);
}

async function runJob(supabase: SupabaseClient, jobId: string, apiKey: string) {
  console.log(`[process] starting job ${jobId}`);
  try {
    const { data: job, error: fetchErr } = await supabase
      .from("analysis_jobs")
      .select("transcript_text, case_name, status")
      .eq("id", jobId)
      .single();
    if (fetchErr || !job) throw new Error(fetchErr?.message ?? "Job not found");
    if (job.status !== "pending") {
      console.log(`[process] job ${jobId} already ${job.status}, skipping`);
      return;
    }
    const transcript = job.transcript_text ?? "";
    const caseName = job.case_name ?? "";

    // Call 0 — compression
    await updateJob(supabase, jobId, {
      status: "processing",
      progress: 10,
      progress_message: "Reading the transcript… (1/5)",
    });
    let summary = "";
    try {
      const t = Date.now();
      summary = (
        await callClaude(
          apiKey,
          "You produce dense, faithful litigation summaries.",
          `${COMPRESSION_PROMPT}\n\nCase label: ${caseName}\n\nTranscript:\n${transcript}`,
          2000,
        )
      ).trim();
      console.log(`[process] compression ok in ${Date.now() - t}ms (${summary.length} chars)`);
    } catch (err) {
      console.error("[process] compression failed, using raw slice:", err);
      summary = transcript.slice(0, 20_000);
    }

    const merged: Record<string, unknown> = {};
    const failed: string[] = [];

    for (const section of SECTIONS) {
      await updateJob(supabase, jobId, {
        progress: section.progress,
        progress_message: section.label,
      });
      const userMessage = `${FRAMING}\n\n${section.instructions ? section.instructions + "\n\n" : ""}Analyze this litigation transcript summary and return ONLY this JSON structure with no other text:\n${section.schema}\n\nCase label: ${caseName}\n\nSummary:\n${summary}`;
      try {
        const t = Date.now();
        const raw = await callClaude(apiKey, SYSTEM_PROMPT, userMessage, 3000);
        console.log(`[process] section=${section.key} ok in ${Date.now() - t}ms`);
        Object.assign(merged, extractJSON(raw));
      } catch (err) {
        console.error(`[process] section=${section.key} failed:`, err);
        Object.assign(merged, section.fallback);
        failed.push(section.key);
      }
    }

    // Persist the completed analysis to the cases library so it's available
    // from the dashboard and via /case/:id.
    let caseId: string | null = null;
    try {
      const snapshot = (merged as Record<string, unknown>).caseSnapshot as
        | Record<string, unknown>
        | undefined;
      const { data: inserted, error: insertErr } = await supabase
        .from("cases")
        .insert({
          case_name: caseName,
          job_id: jobId,
          result: merged,
          case_snapshot: snapshot ?? null,
          outcome:
            typeof snapshot?.outcome === "string" ? (snapshot.outcome as string) : null,
        })
        .select("id")
        .single();
      if (insertErr) {
        console.error("[process] case insert failed:", insertErr.message);
      } else {
        caseId = inserted?.id ?? null;
      }
    } catch (err) {
      console.error("[process] case insert exception:", err);
    }

    await updateJob(supabase, jobId, {
      status: "complete",
      progress: 100,
      progress_message: "Analysis complete.",
      result: caseId ? { ...merged, __caseId: caseId } : merged,
      failed_sections: failed,
      transcript_text: null,
    });
    console.log(
      `[process] job ${jobId} complete (case=${caseId ?? "none"}, failed: ${failed.join(",") || "none"})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[process] job ${jobId} fatal:`, message);
    await updateJob(supabase, jobId, {
      status: "error",
      error: message,
      progress_message: "Analysis failed.",
    });
  }
}

export const Route = createFileRoute("/api/analyze/process")({
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

        // Run the work in this same request. The browser holds the connection
        // open so the Worker stays alive until it finishes (or the client polls
        // independently and this request can be cut without losing progress —
        // each section writes back to the DB).
        await runJob(supabase, parsed.jobId, apiKey);
        return Response.json({ ok: true });
      },
    },
  },
});