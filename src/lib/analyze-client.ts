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

export interface ProgressEvent {
  step: number;
  total: number;
  label: string;
}

export interface AnalyzeResult {
  result: Record<string, unknown>;
  failedSections: string[];
}

export async function streamAnalyze(
  caseName: string,
  transcript: string,
  onProgress?: (p: ProgressEvent) => void,
): Promise<AnalyzeResult> {
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
  let buffer = "";
  const failedSections: string[] = [];
  let finalResult: Record<string, unknown> | null = null;
  let serverError: string | null = null;

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(line);
    } catch {
      console.warn("Could not parse NDJSON line:", line);
      return;
    }
    switch (evt.type) {
      case "progress":
        onProgress?.({
          step: evt.step as number,
          total: evt.total as number,
          label: evt.label as string,
        });
        break;
      case "section_failed":
        failedSections.push(evt.key as string);
        break;
      case "done":
        finalResult = evt.result as Record<string, unknown>;
        if (Array.isArray(evt.failedSections)) {
          for (const k of evt.failedSections) {
            if (!failedSections.includes(k as string)) failedSections.push(k as string);
          }
        }
        break;
      case "error":
        serverError = (evt.message as string) || "Server error";
        break;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      handleLine(line);
    }
  }
  if (buffer.trim()) handleLine(buffer);

  if (serverError) throw new Error(serverError);
  if (!finalResult) throw new TimeoutError();
  return { result: finalResult, failedSections };
}