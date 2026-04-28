import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const InputSchema = z.object({
  caseName: z.string().min(1).max(300),
  transcript: z.string().min(50).max(110_000),
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
    label: "Reviewing the record…",
    schema: `{
  "caseSnapshot": { "caseName": "", "court": "", "parties": "", "outcome": "", "bottomLine": "" },
  "criticalMoments": [ { "page": "", "parties": "", "what": "", "why": "" } ]
}`,
    fallback: { caseSnapshot: { caseName: "", court: "", parties: "", outcome: "", bottomLine: "" }, criticalMoments: [] },
  },
  {
    key: "findings",
    label: "Identifying key moments…",
    schema: `{
  "wentWell": [ { "category": "", "title": "", "detail": "", "cite": "" } ],
  "wentPoorly": [ { "category": "", "title": "", "detail": "", "cite": "", "fix": "" } ]
}`,
    fallback: { wentWell: [], wentPoorly: [] },
  },
  {
    key: "witnesses",
    label: "Evaluating witnesses…",
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
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
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
}

export const Route = createFileRoute("/api/analyze")({
  // @ts-expect-error - TanStack server route typing
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          return new Response("ANTHROPIC_API_KEY is not configured.", { status: 500 });
        }

        let parsedInput: z.infer<typeof InputSchema>;
        try {
          const body = await request.json();
          parsedInput = InputSchema.parse(body);
        } catch (e) {
          return new Response(
            e instanceof Error ? e.message : "Invalid request body",
            { status: 400 },
          );
        }

        const transcriptBlock = `Case label: ${parsedInput.caseName}\n\nTranscript(s):\n\n${parsedInput.transcript}`;
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

            try {
              for (let i = 0; i < SECTIONS.length; i++) {
                const section = SECTIONS[i];
                send({ type: "progress", step: i + 1, total: SECTIONS.length, label: section.label });

                const userMessage = `Analyze this litigation transcript and return ONLY this JSON structure with no other text:\n${section.schema}\n\n${transcriptBlock}`;

                try {
                  const raw = await callClaude(apiKey, SYSTEM_PROMPT, userMessage);
                  console.log(`[analyze] section=${section.key} raw response:`, raw);
                  const parsed = extractJSON(raw);
                  Object.assign(merged, parsed);
                } catch (err) {
                  console.error(`[analyze] section=${section.key} failed:`, err);
                  Object.assign(merged, section.fallback);
                  failed.push(section.key);
                  send({ type: "section_failed", key: section.key });
                }
              }

              send({ type: "done", result: merged, failedSections: failed });
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