import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { SiteHeader } from "@/components/verdict/SiteHeader";
import { UploadZone } from "@/components/verdict/UploadZone";
import { Progress } from "@/components/ui/progress";
import { extractPdfText, combineAndCap, MAX_CHARS } from "@/lib/pdf-extract";
import {
  runAnalysis,
  AnalysisTimeoutError,
  AnalysisFailedError,
} from "@/lib/analyze-client";
import { saveCase } from "@/lib/case-store";
import { normalizeResult } from "@/lib/normalize-result";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VerdictIQ — Turn transcripts into strategy" },
      {
        name: "description",
        content:
          "Upload litigation transcripts and get a senior trial attorney's strategic breakdown — what worked, what didn't, and what to do next.",
      },
    ],
  }),
  component: Index,
});

interface PreparedPayload {
  caseName: string;
  transcript: string;
  truncated: boolean;
}

function Index() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [caseName, setCaseName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [truncatedNotice, setTruncatedNotice] = useState<string | null>(null);
  const [extractedInfo, setExtractedInfo] = useState<{ chars: number; truncated: boolean } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const lastPayload = useRef<PreparedPayload | null>(null);

  // Extract + clean PDFs as soon as files are selected, so we can show char count.
  async function handleFilesChange(next: File[]) {
    setFiles(next);
    lastPayload.current = null;
    setExtractedInfo(null);
    setError(null);
    if (!next.length) return;
    setExtracting(true);
    try {
      const extracted = await Promise.all(next.map((f) => extractPdfText(f)));
      const { text, truncated } = combineAndCap(extracted);
      setExtractedInfo({ chars: text.length, truncated });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read PDF.");
    } finally {
      setExtracting(false);
    }
  }

  async function preparePayload(): Promise<PreparedPayload> {
    const extracted = await Promise.all(files.map((f) => extractPdfText(f)));
    const { text, truncated } = combineAndCap(extracted);
    if (truncated) {
      setTruncatedNotice(
        `Transcript truncated to fit analysis limits (${MAX_CHARS.toLocaleString()} chars). Upload fewer pages for full coverage.`,
      );
    } else {
      setTruncatedNotice(null);
    }
    return { caseName: caseName.trim(), transcript: text, truncated };
  }

  async function startAnalysis(payload: PreparedPayload) {
    setError(null);
    setTimedOut(false);
    setBusy(true);
    setProgress(0);
    setStatus("Submitting transcript…");

    try {
      const { result, failedSections } = await runAnalysis(
        payload.caseName,
        payload.transcript,
        (p) => {
          setProgress(p.progress);
          if (p.message) setStatus(p.message);
        },
      );
      setStatus("Analysis complete.");
      setProgress(100);
      const { result: normalized, missing } = normalizeResult(result);
      const allMissing = Array.from(new Set([...(missing ?? []), ...failedSections]));
      const id = crypto.randomUUID();
      saveCase({
        id,
        caseName: payload.caseName,
        createdAt: Date.now(),
        truncated: payload.truncated,
        result: normalized,
        missingSections: allMissing,
      });
      navigate({ to: "/report/$id", params: { id } });
    } catch (e) {
      console.error(e);
      if (e instanceof AnalysisTimeoutError) {
        setTimedOut(true);
        setError(
          "Analysis timed out — the transcript may be too long. You can retry or try uploading fewer pages.",
        );
      } else if (e instanceof AnalysisFailedError) {
        setError(e.message);
        setTimedOut(true);
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setTimedOut(true);
      }
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleAnalyze() {
    setError(null);
    setTimedOut(false);
    if (!caseName.trim()) {
      setError("Please enter a case name.");
      return;
    }
    if (!files.length) {
      setError("Please upload at least one transcript PDF.");
      return;
    }
    setBusy(true);
    setStatus("Extracting text from PDFs…");
    try {
      const payload = await preparePayload();
      lastPayload.current = payload;
      await startAnalysis(payload);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Failed to read PDF.");
      setBusy(false);
      setStatus(null);
    }
  }

  function handleRetry() {
    if (lastPayload.current) startAnalysis(lastPayload.current);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="max-w-[680px] mx-auto px-8 pt-20 pb-10">
          <h1 className="text-[28px] font-medium tracking-[-0.01em] leading-tight mb-3">
            Turn transcripts into strategy.
          </h1>
          <p className="text-[14px] text-muted-foreground leading-[1.55] max-w-[560px]">
            Upload trial transcripts and receive a senior litigator's post-trial breakdown — wins,
            missteps, witness performance, and direct recommendations.
          </p>
        </section>

        <section className="max-w-[680px] mx-auto px-8 pb-24">
          <div className="border-t border-border pt-8 space-y-6">
            <label className="block">
              <span className="text-[12px] text-muted-foreground">Case name</span>
              <input
                type="text"
                value={caseName}
                onChange={(e) => setCaseName(e.target.value)}
                disabled={busy}
                placeholder="Smith v. Acme Corp."
                className="mt-1 w-full bg-transparent border-b border-border px-0 py-2 text-[14px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-foreground transition-colors disabled:opacity-60"
              />
            </label>

            <UploadZone files={files} onFiles={handleFilesChange} disabled={busy} />

            {extracting && (
              <p className="text-[12px] text-muted-foreground">Reading PDF…</p>
            )}
            {extractedInfo && !extracting && (
              <p className="text-[12px] text-muted-foreground">
                {extractedInfo.truncated ? (
                  <>
                    Transcript length: {extractedInfo.chars.toLocaleString()} characters — will be
                    trimmed to {MAX_CHARS.toLocaleString()} for analysis.
                  </>
                ) : (
                  <>
                    Transcript length: {extractedInfo.chars.toLocaleString()} characters — within limits.
                  </>
                )}
              </p>
            )}

            {truncatedNotice && (
              <p className="text-[13px] text-warning">{truncatedNotice}</p>
            )}

            {error && (
              <p className="text-[13px] text-destructive">{error}</p>
            )}

            {timedOut && lastPayload.current && !busy && (
              <button
                onClick={handleRetry}
                className="inline-flex items-center h-8 px-3 text-[13px] font-normal text-foreground border border-foreground/80 bg-transparent hover:bg-foreground/[0.05] transition-colors"
              >
                Retry analysis
              </button>
            )}

            {busy && progress !== null && (
              <div className="space-y-2">
                <Progress value={progress} className="h-[2px]" />
                <div className="flex items-center justify-between text-[12px] text-muted-foreground">
                  <span>{status ?? "Working…"}</span>
                  <span className="font-mono tabular-nums">{progress}%</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <p className="text-[12px] text-muted-foreground">
                Cap of {MAX_CHARS.toLocaleString()} characters per analysis.
              </p>
              <button
                onClick={handleAnalyze}
                disabled={busy}
                className="inline-flex items-center h-8 px-3 text-[13px] font-normal text-background bg-foreground border border-foreground hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? (status ?? "Working…") : "Analyze transcript"}
              </button>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-border py-4">
        <div className="max-w-[880px] mx-auto px-8">
          <p className="text-[11px] text-muted-foreground">
            VerdictIQ · For attorney work-product use only. Not legal advice.
          </p>
        </div>
      </footer>
    </div>
  );
}
