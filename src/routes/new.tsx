import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { SiteHeader } from "@/components/verdict/SiteHeader";
import { UploadZone } from "@/components/verdict/UploadZone";
import { extractPdfText, combineAndCap, MAX_CHARS } from "@/lib/pdf-extract";
import { submitAnalysis, AnalysisFailedError } from "@/lib/analyze-client";
import { saveClientTrace, type ClientTraceEvent } from "@/lib/debug-trace";

export const Route = createFileRoute("/new")({
  validateSearch: zodValidator(
    z.object({
      matterId: fallback(z.string().uuid().optional(), undefined),
    }),
  ),
  head: () => ({
    meta: [
      { title: "New analysis — VerdictIQ" },
      {
        name: "description",
        content: "Upload a litigation transcript to start a new analysis.",
      },
    ],
  }),
  component: NewAnalysisPage,
});

function NewAnalysisPage() {
  const navigate = useNavigate();
  const { matterId } = Route.useSearch();
  const [files, setFiles] = useState<File[]>([]);
  const [caseName, setCaseName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractedInfo, setExtractedInfo] = useState<{
    chars: number;
    truncated: boolean;
  } | null>(null);

  async function handleFilesChange(next: File[]) {
    setFiles(next);
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
      const extracted = await Promise.all(files.map((f) => extractPdfText(f)));
      const { text } = combineAndCap(extracted);
      const traceEvents: ClientTraceEvent[] = [];
      const log = (stage: string, data: Record<string, unknown>) => {
        const ev = { ts: new Date().toISOString(), stage, data };
        traceEvents.push(ev);
        try {
          console.log(
            `===== STAGE: ${stage} =====\n` + JSON.stringify(data, null, 2),
          );
        } catch {
          console.log(`===== STAGE: ${stage} ===== (unserializable)`);
        }
      };
      log("client_pdf_files", {
        caseName: caseName.trim(),
        files: files.map((f) => ({ name: f.name, sizeBytes: f.size })),
      });
      for (const part of extracted) {
        log("client_pdf_extracted", {
          name: part.name,
          pages: part.pages,
          totalLength: part.text.length,
          first2000: part.text.slice(0, 2000),
          last2000: part.text.slice(-2000),
        });
      }
      log("client_combined_capped", {
        totalLength: text.length,
        cap: MAX_CHARS,
        first2000: text.slice(0, 2000),
        last2000: text.slice(-2000),
      });
      const jobId = await submitAnalysis(caseName.trim(), text, matterId ?? null);
      log("client_submitted", { jobId });
      saveClientTrace(jobId, traceEvents);
      navigate({ to: "/analyzing/$jobId", params: { jobId } });
    } catch (e) {
      console.error(e);
      setError(
        e instanceof AnalysisFailedError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Something went wrong.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="max-w-[680px] mx-auto px-8 pt-10 pb-2">
          <Link
            to="/"
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            ‹ All cases
          </Link>
        </section>
        <section className="max-w-[680px] mx-auto px-8 pt-6 pb-10">
          <h1 className="text-[22px] font-medium tracking-[-0.01em] leading-tight mb-3">
            New analysis
          </h1>
          <p className="text-[14px] text-muted-foreground leading-[1.55] max-w-[560px]">
            Upload a trial transcript to receive a defense-side post-trial breakdown.
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
                Transcript length: {extractedInfo.chars.toLocaleString()} characters
                {extractedInfo.truncated
                  ? ` — will be trimmed to ${MAX_CHARS.toLocaleString()} for analysis.`
                  : " — within limits."}
              </p>
            )}

            {error && <p className="text-[13px] text-destructive">{error}</p>}

            <div className="flex items-center justify-between pt-2">
              <p className="text-[12px] text-muted-foreground">
                Cap of {MAX_CHARS.toLocaleString()} characters per analysis.
              </p>
              <button
                onClick={handleAnalyze}
                disabled={busy}
                className="inline-flex items-center h-8 px-3 text-[13px] font-normal text-background bg-foreground border border-foreground hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? "Submitting…" : "Analyze transcript"}
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}