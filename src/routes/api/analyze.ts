import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const InputSchema = z.object({
  caseName: z.string().min(1).max(300),
  transcript: z.string().min(50).max(110_000),
});

const SYSTEM_PROMPT = `You are a senior trial attorney analyzing litigation transcripts. You must respond with ONLY a valid JSON object. Do not include any markdown formatting, do not wrap the response in code fences, do not include any text before or after the JSON object. Your entire response must begin with { and end with }. If you cannot complete the analysis, still return a valid JSON object with an "error" key explaining why.

Analyze the provided transcript(s) with the following lens:
- Identify every moment where either side gained or lost strategic ground
- Evaluate witness examinations for effectiveness, credibility damage, and missed opportunities
- Flag objections that were well-placed or poorly handled
- Assess the jury charge conference for errors or wins
- Note any admissions, contradictions, or damaging testimony
- Consider how the evidence presented (or not presented) shaped the jury's perception

The JSON object must use exactly these top-level keys:
{
  "caseSnapshot": { "caseName", "court", "parties", "outcome", "bottomLine" },
  "wentWell": [ { "category", "title", "detail", "cite" } ],
  "wentPoorly": [ { "category", "title", "detail", "cite", "fix" } ],
  "criticalMoments": [ { "page", "parties", "what", "why" } ],
  "witnesses": [ { "name", "role", "credibility", "bestMoment", "worstMoment", "strategicValue" } ],
  "objections": [ { "party", "grounds", "ruling", "significance" } ],
  "juryChargeIssues": [ { "dispute", "plaintiffArg", "defenseArg", "resolution", "impact" } ],
  "recommendations": [ "string" ]
}

"credibility" must be exactly one of: "Strong", "Mixed", "Weak".
"ruling" must be "Sustained" or "Overruled" (or describe briefly if neither applies).`;

export const Route = createFileRoute("/api/analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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

        const userMessage = `Case label: ${parsedInput.caseName}\n\nTranscript(s):\n\n${parsedInput.transcript}`;

        const upstream = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-5",
            max_tokens: 4000,
            system: SYSTEM_PROMPT,
            stream: true,
            messages: [{ role: "user", content: userMessage }],
          }),
        });

        if (!upstream.ok || !upstream.body) {
          const errText = await upstream.text().catch(() => "");
          console.error("Anthropic error:", upstream.status, errText);
          return new Response(
            `Anthropic API error (${upstream.status})`,
            { status: upstream.status === 429 ? 429 : 502 },
          );
        }

        // Forward Anthropic SSE stream as plain text deltas to the client.
        // Client receives only the text content; final assembled JSON is parsed there.
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        const reader = upstream.body.getReader();

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            let buffer = "";
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                let nl: number;
                while ((nl = buffer.indexOf("\n")) !== -1) {
                  let line = buffer.slice(0, nl);
                  buffer = buffer.slice(nl + 1);
                  if (line.endsWith("\r")) line = line.slice(0, -1);
                  if (!line.startsWith("data:")) continue;
                  const data = line.slice(5).trim();
                  if (!data || data === "[DONE]") continue;
                  try {
                    const evt = JSON.parse(data);
                    if (
                      evt.type === "content_block_delta" &&
                      evt.delta?.type === "text_delta" &&
                      typeof evt.delta.text === "string"
                    ) {
                      controller.enqueue(encoder.encode(evt.delta.text));
                    }
                  } catch {
                    // skip malformed event
                  }
                }
              }
              controller.close();
            } catch (e) {
              console.error("Stream error:", e);
              controller.error(e);
            }
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
            "x-accel-buffering": "no",
          },
        });
      },
    },
  },
});