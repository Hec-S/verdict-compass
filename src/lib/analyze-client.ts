export function extractJSON(raw: string): unknown {
  // Remove markdown code fences if present
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  // Find the first { and last } and extract everything between them
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("No JSON object found in Claude response");
  }
  cleaned = cleaned.slice(start, end + 1);
  return JSON.parse(cleaned);
}

export class TimeoutError extends Error {
  constructor() {
    super("Analysis timed out — the transcript may be too long.");
    this.name = "TimeoutError";
  }
}

export class MalformedJsonError extends Error {
  raw: string;
  constructor(raw: string) {
    super("Analysis could not be parsed. This is usually a formatting issue — please retry.");
    this.name = "MalformedJsonError";
    this.raw = raw;
  }
}

export async function streamAnalyze(
  caseName: string,
  transcript: string,
  onChunk?: (chars: number) => void,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseName, transcript }),
    });
  } catch (e) {
    throw new TimeoutError();
  }

  if (res.status === 504 || res.status === 502 || res.status === 503) {
    throw new TimeoutError();
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let assembled = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    assembled += chunk;
    onChunk?.(assembled.length);
  }

  if (!assembled.trim()) throw new TimeoutError();

  try {
    return extractJSON(assembled);
  } catch (e) {
    console.error("Raw Claude response (failed to parse):", assembled);
    console.error("Parse error:", e);
    throw new MalformedJsonError(assembled);
  }
}