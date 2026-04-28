import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles, ShieldCheck, Zap, AlertTriangle } from "lucide-react";
import { SiteHeader } from "@/components/verdict/SiteHeader";
import { UploadZone } from "@/components/verdict/UploadZone";
import { extractPdfText, combineAndCap } from "@/lib/pdf-extract";
import { analyzeTranscript } from "@/server/analyze.functions";
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

function Index() {
  const navigate = useNavigate();
  const analyze = useServerFn(analyzeTranscript);
  const [files, setFiles] = useState<File[]>([]);
  const [caseName, setCaseName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleAnalyze() {
    setError(null);
    if (!caseName.trim()) {
      setError("Please enter a case name.");
      return;
    }
    if (!files.length) {
      setError("Please upload at least one transcript PDF.");
      return;
    }

    setBusy(true);
    try {
      setStatus("Extracting text from PDFs…");
      const extracted = await Promise.all(files.map((f) => extractPdfText(f)));
      const { text, truncated } = combineAndCap(extracted);

      // Cycle status messages
      let i = 0;
      setStatus(STATUS_MESSAGES[0]);
      const ticker = window.setInterval(() => {
        i = (i + 1) % STATUS_MESSAGES.length;
        setStatus(STATUS_MESSAGES[i]);
      }, 3500);

      try {
        const { result } = await analyze({ data: { caseName: caseName.trim(), transcript: text } });
        const id = crypto.randomUUID();
        saveCase({
          id,
          caseName: caseName.trim(),
          createdAt: Date.now(),
          truncated,
          result: result as unknown as AnalysisResult,
        });
        navigate({ to: "/report/$id", params: { id } });
      } finally {
        window.clearInterval(ticker);
      }
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="max-w-5xl mx-auto px-6 pt-20 pb-10 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gold/30 bg-gold/5 text-xs text-gold mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            Powered by Claude Sonnet 4
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

            {error && (
              <div className="mt-5 flex items-start gap-2 px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/40 text-sm text-destructive">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
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
              Files processed securely. Cap of ~150,000 characters per analysis.
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
