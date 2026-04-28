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

export class TimeoutError extends Error {
  constructor() {
    super("Analysis timed out — the transcript may be too long.");
    this.name = "TimeoutError";
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
    return extractJson(assembled);
  } catch {
    throw new Error("Claude returned malformed JSON. Please retry.");
  }
}