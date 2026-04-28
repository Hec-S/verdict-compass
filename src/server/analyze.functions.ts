import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  caseName: z.string().min(1).max(300),
  transcript: z.string().min(50).max(160_000),
});

const SYSTEM_PROMPT = `You are a senior trial attorney with 25 years of experience in civil litigation. You are reviewing litigation transcripts to provide a detailed post-trial analysis.

Analyze the provided transcript(s) with the following lens:
- Identify every moment where either side gained or lost strategic ground
- Evaluate witness examinations for effectiveness, credibility damage, and missed opportunities
- Flag objections that were well-placed or poorly handled
- Assess the jury charge conference for errors or wins
- Note any admissions, contradictions, or damaging testimony
- Consider how the evidence presented (or not presented) shaped the jury's perception

Return your analysis as a JSON object with the following keys:
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
"ruling" must be "Sustained" or "Overruled" (or describe briefly if neither applies).
Return only valid JSON. No markdown, no preamble, no explanation outside the JSON object.`;

function extractJson(raw: string): unknown {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model returned no JSON object.");
  return JSON.parse(s.slice(start, end + 1));
}

export const analyzeTranscript = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured.");
    }

    const userMessage = `Case label: ${data.caseName}\n\nTranscript(s):\n\n${data.transcript}`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Anthropic API error:", res.status, errText);
      if (res.status === 401) throw new Error("Anthropic API key is invalid.");
      if (res.status === 429) throw new Error("Rate limit reached. Please try again shortly.");
      throw new Error(`Anthropic API error (${res.status}). Please try again.`);
    }

    const payload = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    const textBlock = payload.content?.find((c) => c.type === "text")?.text ?? "";
    if (!textBlock) throw new Error("Empty response from Claude.");

    let parsed: unknown;
    try {
      parsed = extractJson(textBlock);
    } catch (e) {
      console.error("JSON parse failure. Raw:", textBlock.slice(0, 500));
      throw new Error("Claude returned malformed JSON. Please retry.");
    }

    return { result: parsed };
  });