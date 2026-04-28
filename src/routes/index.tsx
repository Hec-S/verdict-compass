import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { Loader2, Sparkles, ShieldCheck, Zap, AlertTriangle, RotateCcw } from "lucide-react";
import { SiteHeader } from "@/components/verdict/SiteHeader";
import { UploadZone } from "@/components/verdict/UploadZone";
import { extractPdfText, combineAndCap, MAX_CHARS } from "@/lib/pdf-extract";
import { streamAnalyze, TimeoutError } from "@/lib/analyze-client";
import { saveCase } from "@/lib/case-store";
import type { AnalysisResult } from "@/lib/analysis-types";

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

const STATUS_MESSAGES = [
  "Reviewing the record…",
  "Cross-referencing testimony…",
  "Cataloging objections and rulings…",
  "Drafting strategic findings…",
];

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
  const [streamedChars, setStreamedChars] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [truncatedNotice, setTruncatedNotice] = useState<string | null>(null);
  const lastPayload = useRef<PreparedPayload | null>(null);

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
    setBusy(true);
    setStreamedChars(0);

    let i = 0;
    setStatus(STATUS_MESSAGES[0]);
    const ticker = window.setInterval(() => {
      i = (i + 1) % STATUS_MESSAGES.length;
      setStatus(STATUS_MESSAGES[i]);
    }, 3500);

    try {
      const result = await streamAnalyze(
        payload.caseName,
        payload.transcript,
        (chars) => setStreamedChars(chars),
      );
      const id = crypto.randomUUID();
      saveCase({
        id,
        caseName: payload.caseName,
        createdAt: Date.now(),
        truncated: payload.truncated,
        result: result as unknown as AnalysisResult,
      });
      navigate({ to: "/report/$id", params: { id } });
    } catch (e) {
      console.error(e);
      if (e instanceof TimeoutError) {
        setTimedOut(true);
        setError(
          "Analysis timed out — the transcript may be too long. You can retry or try uploading fewer pages.",
        );
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
      setStatus(null);
    } finally {
      window.clearInterval(ticker);
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

            <UploadZone files={files} onFiles={setFiles} disabled={busy} />

            {truncatedNotice && (
              <div className="mt-5 flex items-start gap-2 px-4 py-3 rounded-lg bg-warning/10 border border-warning/40 text-sm text-warning">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{truncatedNotice}</span>
              </div>
            )}

            {error && (
              <div className="mt-5 flex items-start gap-2 px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/40 text-sm text-destructive">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {timedOut && lastPayload.current && !busy && (
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
                  {streamedChars > 0 && (
                    <span className="font-mono text-xs opacity-70 ml-1">
                      ({streamedChars.toLocaleString()} chars)
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
