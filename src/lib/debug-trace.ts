// Browser-side helpers for the debug trace feature.
// The server worker writes its trace to analysis_jobs.debug_trace and
// cases.debug_trace. The browser captures the raw PDF extraction step
// (which the server never sees because PDFs are parsed client-side) and
// stashes it in sessionStorage keyed by jobId, then merges it with the
// server trace when the user lands on /case/:id.

export interface ClientTraceEvent {
  ts: string;
  stage: string;
  data: Record<string, unknown>;
}

const KEY = (jobId: string) => `vq:client-trace:${jobId}`;

export function saveClientTrace(jobId: string, events: ClientTraceEvent[]): void {
  try {
    sessionStorage.setItem(KEY(jobId), JSON.stringify(events));
  } catch {
    // sessionStorage may be unavailable (private mode quota); silently ignore.
  }
}

export function loadClientTrace(jobId: string): ClientTraceEvent[] | null {
  try {
    const raw = sessionStorage.getItem(KEY(jobId));
    if (!raw) return null;
    return JSON.parse(raw) as ClientTraceEvent[];
  } catch {
    return null;
  }
}

/**
 * Map a caseId back to the jobId that produced it so the case page can
 * locate any stashed client-side trace events. Written on /analyzing
 * once the case row is created.
 */
export function linkCaseToJob(caseId: string, jobId: string): void {
  try {
    sessionStorage.setItem(`vq:case-job:${caseId}`, jobId);
  } catch {
    /* noop */
  }
}
export function jobIdForCase(caseId: string): string | null {
  try {
    return sessionStorage.getItem(`vq:case-job:${caseId}`);
  } catch {
    return null;
  }
}

export function formatTraceText(opts: {
  caseName: string;
  caseId: string | null;
  jobId: string | null;
  client: ClientTraceEvent[];
  server: ClientTraceEvent[];
}): string {
  const lines: string[] = [];
  lines.push("=".repeat(72));
  lines.push(`VerdictIQ Debug Trace`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Case name: ${opts.caseName}`);
  if (opts.caseId) lines.push(`Case ID:   ${opts.caseId}`);
  if (opts.jobId) lines.push(`Job ID:    ${opts.jobId}`);
  lines.push("=".repeat(72));
  lines.push("");
  const all: ClientTraceEvent[] = [...opts.client, ...opts.server].sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0,
  );
  for (const ev of all) {
    lines.push(`===== STAGE: ${ev.stage} =====`);
    lines.push(`ts: ${ev.ts}`);
    let body: string;
    try {
      body = JSON.stringify(ev.data, null, 2);
    } catch {
      body = String(ev.data);
    }
    lines.push(body);
    lines.push("");
  }
  return lines.join("\n");
}

export function downloadTraceFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}