import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { Loader2, Sparkles, ShieldCheck, Zap, AlertTriangle, RotateCcw } from "lucide-react";
import { SiteHeader } from "@/components/verdict/SiteHeader";
import { UploadZone } from "@/components/verdict/UploadZone";
import { extractPdfText, combineAndCap, MAX_CHARS } from "@/lib/pdf-extract";
import { streamAnalyze, TimeoutError, MalformedJsonError } from "@/lib/analyze-client";
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
  const [progress, setProgress] = useState<{ step: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [parseFailed, setParseFailed] = useState(false);
  const [parseFailCount, setParseFailCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [truncatedNotice, setTruncatedNotice] = useState<string | null>(null);
  const [extractedInfo, setExtractedInfo] = useState<{ chars: number; truncated: boolean } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const lastPayload = useRef<PreparedPayload | null>(null);
  const cachedSummary = useRef<string | null>(null);

  // Extract + clean PDFs as soon as files are selected, so we can show char count.
  async function handleFilesChange(next: File[]) {
    setFiles(next);
    cachedSummary.current = null;
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

  async function runAnalysis(payload: PreparedPayload) {
    setError(null);
    setTimedOut(false);
    setParseFailed(false);
    setBusy(true);
    setProgress(null);
    setStatus("Preparing analysis…");

    try {
      const useSummary = cachedSummary.current;
      const { result, failedSections, summary } = await streamAnalyze(
        payload.caseName,
        useSummary ? { summary: useSummary } : { transcript: payload.transcript },
        (p) => {
          setProgress({ step: p.step, total: p.total });
          setStatus(`${p.label} (${p.step}/${p.total})`);
        },
      );
      // Cache the summary so retries skip the compression call.
      if (summary) cachedSummary.current = summary;
      setStatus("Analysis complete.");
      const { result: normalized, missing } = normalizeResult(result);
      // Merge server-reported failed sections with shape-validation misses
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
      setParseFailCount(0);
      navigate({ to: "/report/$id", params: { id } });
    } catch (e) {
      console.error(e);
      if (e instanceof TimeoutError) {
        setTimedOut(true);
        setError(
          "Analysis timed out — the transcript may be too long. You can retry or try uploading fewer pages.",
        );
      } else if (e instanceof MalformedJsonError) {
        setParseFailed(true);
        setParseFailCount((c) => c + 1);
        setError(
          "Analysis could not be parsed. This is usually a formatting issue — please retry.",
        );
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleAnalyze() {
    setError(null);
    setTimedOut(false);
    setParseFailed(false);
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
      cachedSummary.current = null; // fresh analysis = fresh summary
      await runAnalysis(payload);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Failed to read PDF.");
      setBusy(false);
      setStatus(null);
    }
  }

  function handleRetry() {
    if (lastPayload.current) runAnalysis(lastPayload.current);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="max-w-5xl mx-auto px-6 pt-20 pb-10 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gold/30 bg-gold/5 text-xs text-gold mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            Powered by Claude Sonnet 4.5
          </div>
          <h1 className="font-serif text-5xl md:text-7xl leading-[1.05] tracking-tight mb-5">
            Turn transcripts <br className="hidden md:block" />
            <span className="italic text-gold">into strategy.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Upload trial transcripts and get a senior litigator's post-trial breakdown — wins,
            missteps, witness scorecards, and what to do differently.
          </p>
        </section>

        <section className="max-w-3xl mx-auto px-6 pb-24">
          <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-sm p-6 md:p-8 shadow-elegant">
            <label className="block mb-6">
              <span className="text-[11px] uppercase tracking-[0.2em] text-gold font-semibold">
                Case Name
              </span>
              <input
                type="text"
                value={caseName}
                onChange={(e) => setCaseName(e.target.value)}
                disabled={busy}
                placeholder="e.g. Smith v. Acme Corp."
                className="mt-2 w-full bg-input border border-border rounded-lg px-4 py-3 text-base font-serif placeholder:text-muted-foreground/60 focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold transition disabled:opacity-60"
              />
            </label>

            <UploadZone files={files} onFiles={handleFilesChange} disabled={busy} />

            {extracting && (
              <p className="mt-3 text-xs text-muted-foreground">Reading PDF…</p>
            )}
            {extractedInfo && !extracting && (
              <p className="mt-3 text-xs text-muted-foreground">
                {extractedInfo.truncated ? (
                  <>
                    Transcript length: {extractedInfo.chars.toLocaleString()} characters — will be
                    trimmed to {MAX_CHARS.toLocaleString()} for analysis. For full coverage, split
                    into smaller uploads.
                  </>
                ) : (
                  <>
                    Transcript length: {extractedInfo.chars.toLocaleString()} characters — within
                    analysis limits.
                  </>
                )}
              </p>
            )}

            {truncatedNotice && (
              <div className="mt-5 flex items-start gap-2 px-4 py-3 rounded-lg bg-warning/10 border border-warning/40 text-sm text-warning">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{truncatedNotice}</span>
              </div>
            )}

            {error && (
              <div className="mt-5 flex items-start gap-2 px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/40 text-sm text-destructive">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p>{error}</p>
                  {parseFailed && parseFailCount >= 2 && (
                    <p className="mt-1 text-xs opacity-80">
                      If this keeps failing, try uploading fewer pages at once.
                    </p>
                  )}
                </div>
              </div>
            )}

            {(timedOut || parseFailed) && lastPayload.current && !busy && (
              <button
                onClick={handleRetry}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg border border-gold/40 bg-gold/10 text-gold font-semibold text-sm hover:bg-gold/20 transition"
              >
                <RotateCcw className="w-4 h-4" />
                Retry analysis
              </button>
            )}

            <button
              onClick={handleAnalyze}
              disabled={busy}
              className="mt-6 w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-lg bg-gradient-gold text-navy-deep font-semibold text-base shadow-gold hover:opacity-95 transition disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {busy ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {status ?? "Working…"}
                  {progress && (
                    <span className="font-mono text-xs opacity-70 ml-1">
                      ({progress.step}/{progress.total})
                    </span>
                  )}
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5" />
                  Analyze Transcript
                </>
              )}
            </button>

            <p className="mt-4 text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              Files processed securely. Cap of {MAX_CHARS.toLocaleString()} characters per analysis.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4 mt-10">
            {[
              { t: "Witness Scorecards", d: "Credibility, best & worst moments, strategic value." },
              { t: "Objection Log", d: "Every ruling cataloged with why it mattered." },
              { t: "Retrial Playbook", d: "Direct, attorney-grade recommendations." },
            ].map((f) => (
              <div key={f.t} className="rounded-lg border border-border bg-card/40 p-4">
                <p className="font-serif text-base text-gold mb-1">{f.t}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.d}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <footer className="border-t border-border/50 py-6 text-center text-xs text-muted-foreground">
        VerdictIQ &middot; For attorney work-product use only. Not legal advice.
      </footer>
    </div>
  );
}
