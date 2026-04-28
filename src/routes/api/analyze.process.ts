import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const InputSchema = z.object({ jobId: z.string().uuid() });

function getEnv(key: string): string | undefined {
  const g = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
    Deno?: { env?: { get?: (k: string) => string | undefined } };
  };
  return g.process?.env?.[key] ?? g.Deno?.env?.get?.(key);
}

const SYSTEM_PROMPT = `You are a senior trial attorney with 25 years of civil litigation experience analyzing litigation transcripts.

Respond with ONLY a valid JSON object. Do not include any markdown, do not wrap the response in code fences, do not include any text before or after the JSON object. Your entire response must begin with { and end with }.

"credibility" must be exactly one of: "Strong", "Mixed", "Weak".
"ruling" must be "Sustained" or "Overruled" (or describe briefly if neither applies).

If you cannot complete a section, return the requested JSON shape with empty arrays/strings rather than prose.`;

const COMPRESSION_PROMPT = `You are a litigation analyst. Read this court transcript and produce a dense structured summary that preserves all legally significant content. Include:
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
    "bottomLine": "string - ONE sentence, max 25 words, plain English, lead with core fact not procedure. No medical details, expert names, or procedural history."
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
      const userMessage = `Analyze this litigation transcript summary and return ONLY this JSON structure with no other text:\n${section.schema}\n\nCase label: ${caseName}\n\nSummary:\n${summary}`;
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

    await updateJob(supabase, jobId, {
      status: "complete",
      progress: 100,
      progress_message: "Analysis complete.",
      result: merged,
      failed_sections: failed,
      transcript_text: null,
    });
    console.log(`[process] job ${jobId} complete (failed: ${failed.join(",") || "none"})`);
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