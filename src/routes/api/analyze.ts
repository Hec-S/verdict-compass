import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const config = { runtime: "edge" };

const TRANSCRIPT_CHAR_LIMIT = 60_000;

const InputSchema = z.object({
  caseName: z.string().min(1).max(300),
  transcript: z.string().min(50).max(110_000).optional(),
  // When provided, skip Call 0 (compression) and re-use this summary for analysis calls.
  summary: z.string().min(50).max(20_000).optional(),
}).refine((v) => v.transcript || v.summary, {
  message: "Either transcript or summary must be provided",
});

const SYSTEM_PROMPT = `You are a senior trial attorney with 25 years of civil litigation experience analyzing litigation transcripts.

Respond with ONLY a valid JSON object. Do not include any markdown, do not wrap the response in code fences, do not include any text before or after the JSON object. Your entire response must begin with { and end with }.

"credibility" must be exactly one of: "Strong", "Mixed", "Weak".
"ruling" must be "Sustained" or "Overruled" (or describe briefly if neither applies).

If you cannot complete a section, return the requested JSON shape with empty arrays/strings rather than prose.`;

interface SectionSpec {
  key: string;
  label: string;
  schema: string;
  fallback: Record<string, unknown>;
}

const SECTIONS: SectionSpec[] = [
  {
    key: "snapshot",
    label: "Identifying key moments…",
    schema: `{
  "caseSnapshot": { "caseName": "", "court": "", "parties": "", "outcome": "", "bottomLine": "" },
  "criticalMoments": [ { "page": "", "parties": "", "what": "", "why": "" } ]
}`,
    fallback: { caseSnapshot: { caseName: "", court: "", parties: "", outcome: "", bottomLine: "" }, criticalMoments: [] },
  },
  {
    key: "findings",
    label: "Evaluating wins and losses…",
    schema: `{
  "wentWell": [ { "category": "", "title": "", "detail": "", "cite": "" } ],
  "wentPoorly": [ { "category": "", "title": "", "detail": "", "cite": "", "fix": "" } ]
}`,
    fallback: { wentWell: [], wentPoorly: [] },
  },
  {
    key: "witnesses",
    label: "Scoring witnesses…",
    schema: `{
  "witnesses": [ { "name": "", "role": "", "credibility": "", "bestMoment": "", "worstMoment": "", "strategicValue": "" } ],
  "objections": [ { "party": "", "grounds": "", "ruling": "", "significance": "" } ]
}`,
    fallback: { witnesses: [], objections: [] },
  },
  {
    key: "recommendations",
    label: "Building recommendations…",
    schema: `{
  "juryChargeIssues": [ { "dispute": "", "plaintiffArg": "", "defenseArg": "", "resolution": "", "impact": "" } ],
  "recommendations": [ "" ]
}`,
    fallback: { juryChargeIssues: [], recommendations: [] },
  },
];

function extractJSON(raw: string): Record<string, unknown> {
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("No JSON object found in Claude response");
  }
  cleaned = cleaned.slice(start, end + 1);
  return JSON.parse(cleaned);
}

async function callClaude(
  apiKey: string,
  system: string,
  userMessage: string,
  maxTokens: number,
  timeoutMs = 25_000,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Anthropic API error (${res.status}): ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text;
    if (typeof text !== "string") throw new Error("Anthropic returned no text content");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

const COMPRESSION_PROMPT = `You are a litigation analyst. Read this court transcript and produce a dense structured summary that preserves all legally significant content. Include:
- Every witness name, role, and key statements they made
- Every objection, the grounds stated, and the ruling
- Every admission or damaging concession made by any witness
- All evidence and exhibits referenced
- The full jury charge conference discussion
- Any directed verdict motions and rulings
- Exact page and line references for every item above

Write this as dense prose paragraphs, not bullet points. Be thorough — a trial attorney will use this summary as the sole basis for a post-trial analysis. Do not summarize away details. Return only the summary text, no JSON, no preamble.`;

export const Route = createFileRoute("/api/analyze")({
  // @ts-expect-error - TanStack server route typing
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        console.log("Edge function started");
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          return Response.json(
            { error: true, message: "ANTHROPIC_API_KEY is not configured.", stage: "configuration" },
            { status: 500 },
          );
        }

        let parsedInput: z.infer<typeof InputSchema>;
        try {
          const body = await request.json();
          console.log("Payload size received:", JSON.stringify(body).length, "characters");
          parsedInput = InputSchema.parse(body);
        } catch (e) {
          return Response.json(
            { error: true, message: e instanceof Error ? e.message : "Invalid request body", stage: "validation" },
            { status: 400 },
          );
        }

        const encoder = new TextEncoder();

        // NDJSON progress stream: one JSON object per line.
        // {type:"progress", step, total, label}
        // {type:"section_failed", key}
        // {type:"done", result}
        // {type:"error", message}
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (obj: unknown) => {
              controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
            };

            const merged: Record<string, unknown> = {};
            const failed: string[] = [];
            const timedOutSections: string[] = [];
            let summary: string = parsedInput.summary ?? "";

            try {
              const totalSteps = 1 + SECTIONS.length;

              // ===== Call 0: compression pre-pass (skip if summary was provided) =====
              if (!summary) {
                send({ type: "progress", step: 1, total: totalSteps, label: "Reading the transcript…" });
                const rawTranscript = (parsedInput.transcript ?? "").slice(0, 80_000);
                try {
                  const raw = await callClaude(
                    apiKey,
                    "You produce dense, faithful litigation summaries.",
                    `${COMPRESSION_PROMPT}\n\nCase label: ${parsedInput.caseName}\n\nTranscript:\n${rawTranscript}`,
                    2000,
                  );
                  console.log(`[analyze] compression raw length=${raw.length}`);
                  summary = raw.trim();
                } catch (err) {
                  console.error("[analyze] compression failed:", err);
                  // Fallback: use a trimmed slice of the raw transcript so analysis can still run
                  summary = (parsedInput.transcript ?? "").slice(0, 20_000);
                  send({ type: "section_failed", key: "compression" });
                }
                send({ type: "summary", summary });
              } else {
                send({ type: "progress", step: 1, total: totalSteps, label: "Reusing cached summary…" });
              }

              // ===== Calls 1-4: analysis sections, all against the compressed summary =====
              for (let i = 0; i < SECTIONS.length; i++) {
                const section = SECTIONS[i];
                send({ type: "progress", step: i + 2, total: totalSteps, label: section.label });

                const userMessage = `Analyze this litigation transcript summary and return ONLY this JSON structure with no other text:\n${section.schema}\n\nCase label: ${parsedInput.caseName}\n\nSummary:\n${summary}`;

                try {
                  const raw = await callClaude(apiKey, SYSTEM_PROMPT, userMessage, 1500);
                  console.log(`[analyze] section=${section.key} raw response:`, raw);
                  const parsed = extractJSON(raw);
                  Object.assign(merged, parsed);
                } catch (err) {
                  const aborted = err instanceof Error && err.name === "AbortError";
                  console.error(`[analyze] section=${section.key} failed${aborted ? " (timeout)" : ""}:`, err);
                  Object.assign(merged, section.fallback);
                  failed.push(section.key);
                  if (aborted) timedOutSections.push(section.key);
                  send({ type: "section_failed", key: section.key });
                }
              }

              send({
                type: "done",
                result: merged,
                failedSections: failed,
                timedOutSections,
                summary,
              });
              controller.close();
            } catch (e) {
              console.error("[analyze] fatal:", e);
              send({ type: "error", message: e instanceof Error ? e.message : "Unknown error" });
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "application/x-ndjson; charset=utf-8",
            "cache-control": "no-store",
            "x-accel-buffering": "no",
          },
        });
      },
    },
  },
});