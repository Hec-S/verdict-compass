import { supabase } from "@/integrations/supabase/client";

export interface JobProgress {
  progress: number;
  message: string;
}

export interface JobResult {
  result: Record<string, unknown>;
  failedSections: string[];
  caseId: string | null;
}

export class AnalysisFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisFailedError";
  }
}

export class AnalysisTimeoutError extends Error {
  constructor() {
    super("Analysis took too long. Please try again.");
    this.name = "AnalysisTimeoutError";
  }
}

/** Submit a transcript and trigger background processing. Returns the jobId immediately. */
export async function submitAnalysis(
  caseName: string,
  transcript: string,
): Promise<string> {
  const submitRes = await fetch("/api/analyze/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caseName, transcript }),
  });
  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => "");
    throw new AnalysisFailedError(`Failed to submit job: ${text || submitRes.status}`);
  }
  const { jobId, error: submitError } = (await submitRes.json()) as {
    jobId?: string;
    error?: string;
  };
  if (!jobId) throw new AnalysisFailedError(submitError ?? "Submit returned no jobId");

  fetch("/api/analyze/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId }),
    keepalive: true,
  }).catch((err) => console.warn("[analyze] process trigger error:", err));

  return jobId;
}

/** Poll an existing job until terminal state. */
export function pollJob(
  jobId: string,
  onProgress?: (p: JobProgress) => void,
): Promise<JobResult> {
  return new Promise<JobResult>((resolve, reject) => {
    const POLL_MS = 3000;
    const TIMEOUT_MS = 5 * 60 * 1000;
    const started = Date.now();

    const interval = window.setInterval(async () => {
      if (Date.now() - started > TIMEOUT_MS) {
        window.clearInterval(interval);
        reject(new AnalysisTimeoutError());
        return;
      }
      const { data, error } = await supabase
        .from("analysis_jobs")
        .select("status, progress, progress_message, result, failed_sections, error")
        .eq("id", jobId)
        .single();
      if (error || !data) return;

      onProgress?.({ progress: data.progress ?? 0, message: data.progress_message ?? "" });

      if (data.status === "complete") {
        window.clearInterval(interval);
        const fullResult = (data.result as Record<string, unknown>) ?? {};
        const caseId =
          typeof fullResult.__caseId === "string" ? (fullResult.__caseId as string) : null;
        if ("__caseId" in fullResult) delete fullResult.__caseId;
        resolve({
          result: fullResult,
          failedSections: Array.isArray(data.failed_sections)
            ? (data.failed_sections as string[])
            : [],
          caseId,
        });
      } else if (data.status === "error") {
        window.clearInterval(interval);
        reject(new AnalysisFailedError(data.error ?? "Analysis failed."));
      }
    }, POLL_MS);
  });
}

/**
 * Submit a transcript for analysis and poll the database until done.
 * - Inserts a job row via the submit route.
 * - Kicks off the background processor (unawaited fetch — the browser holds
 *   the connection open so the Worker stays alive while writing progress
 *   back to the database).
 * - Polls Supabase every 3s for status updates.
 */
export async function runAnalysis(
  caseName: string,
  transcript: string,
  onProgress?: (p: JobProgress) => void,
): Promise<JobResult> {
  // 1. Submit
  const submitRes = await fetch("/api/analyze/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caseName, transcript }),
  });
  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => "");
    throw new AnalysisFailedError(`Failed to submit job: ${text || submitRes.status}`);
  }
  const { jobId, error: submitError } = (await submitRes.json()) as {
    jobId?: string;
    error?: string;
  };
  if (!jobId) throw new AnalysisFailedError(submitError ?? "Submit returned no jobId");

  // 2. Kick off background processing — fire and forget. The browser keeps
  //    the connection alive so the Cloudflare Worker stays running.
  fetch("/api/analyze/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId }),
    keepalive: true,
  }).catch((err) => console.warn("[analyze] process trigger error:", err));

  // 3. Poll
  return await new Promise<JobResult>((resolve, reject) => {
    const POLL_MS = 3000;
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
    const started = Date.now();

    const interval = window.setInterval(async () => {
      if (Date.now() - started > TIMEOUT_MS) {
        window.clearInterval(interval);
        reject(new AnalysisTimeoutError());
        return;
      }

      const { data, error } = await supabase
        .from("analysis_jobs")
        .select("status, progress, progress_message, result, failed_sections, error")
        .eq("id", jobId)
        .single();

      if (error) {
        // transient — keep polling
        return;
      }
      if (!data) return;

      onProgress?.({ progress: data.progress ?? 0, message: data.progress_message ?? "" });

      if (data.status === "complete") {
        window.clearInterval(interval);
        const fullResult = (data.result as Record<string, unknown>) ?? {};
        const caseId =
          typeof fullResult.__caseId === "string" ? (fullResult.__caseId as string) : null;
        // Strip the helper field before handing back to the UI/normalizer.
        if ("__caseId" in fullResult) delete fullResult.__caseId;
        resolve({
          result: fullResult,
          failedSections: Array.isArray(data.failed_sections)
            ? (data.failed_sections as string[])
            : [],
          caseId,
        });
      } else if (data.status === "error") {
        window.clearInterval(interval);
        reject(new AnalysisFailedError(data.error ?? "Analysis failed."));
      }
    }, POLL_MS);
  });
}