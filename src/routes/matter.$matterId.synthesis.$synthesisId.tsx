import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { SiteHeader } from "@/components/verdict/SiteHeader";
import {
  MatterSynthesisView,
  type SynthesisTabId,
} from "@/components/verdict/MatterSynthesisView";
import { ErrorBoundary } from "@/components/verdict/ErrorBoundary";
import { Progress } from "@/components/ui/progress";
import {
  deleteSynthesisFromDb,
  getSynthesisFromDb,
  markSynthesisProcessorNeverStarted,
  submitSynthesis,
  retryFailedSections,
} from "@/lib/synthesis-db";
import { getMatterFromDb } from "@/lib/matters-db";
import type { MatterSynthesisRow } from "@/lib/analysis-types";
import type { CaseListRow } from "@/lib/cases-db";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute(
  "/matter/$matterId/synthesis/$synthesisId",
)({
  head: () => ({
    meta: [{ title: "Matter Synthesis — VerdictIQ" }],
  }),
  validateSearch: zodValidator(
    z.object({
      tab: fallback(
        z.enum([
          "overview",
          "witnesses",
          "causation",
          "motions",
          "methodology",
          "contradictions",
          "admissions",
          "bias",
          "themes",
          "discovery",
          "missed",
          "next",
        ]),
        "overview",
      ).default("overview"),
    }),
  ),
  component: MatterSynthesisPage,
});

const SYNTHESIS_START_TIMEOUT_MS = 60 * 1000;

function MatterSynthesisPage() {
  const { matterId, synthesisId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const [synth, setSynth] = useState<MatterSynthesisRow | null>(null);
  const [cases, setCases] = useState<CaseListRow[]>([]);
  const [matterName, setMatterName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning] = useState(false);
  const [confirmRetry, setConfirmRetry] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getSynthesisFromDb(synthesisId), getMatterFromDb(matterId)])
      .then(([row, matter]) => {
        if (cancelled) return;
        if (!row) {
          setError("Synthesis not found.");
        } else {
          setSynth(row);
          setCases(matter?.cases ?? []);
          setMatterName(matter?.matter.name ?? "");
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load synthesis.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [synthesisId, matterId]);

  // Poll while still processing.
  useEffect(() => {
    if (!synth) return;
    if (
      synth.status === "complete" ||
      synth.status === "complete_with_errors" ||
      synth.status === "error"
    )
      return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const row = await getSynthesisFromDb(synthesisId);
        if (cancelled || !row) return;
        if (
          row.status === "pending" &&
          row.progress === 0 &&
          Date.now() - row.createdAt > SYNTHESIS_START_TIMEOUT_MS
        ) {
          await markSynthesisProcessorNeverStarted(row.id);
          setSynth({
            ...row,
            status: "error",
            error: "Synthesis processor never started. Click Re-run to try again.",
            progressMessage: "Synthesis failed.",
          });
          clearInterval(interval);
          return;
        }
        setSynth(row);
        if (
          row.status === "complete" ||
          row.status === "complete_with_errors" ||
          row.status === "error"
        ) {
          clearInterval(interval);
        }
      } catch (e) {
        console.error("[synthesis poll]", e);
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [synth, synthesisId]);

  const caseLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cases) {
      m.set(c.id, c.snapshot?.caseName || c.caseName || c.id.slice(0, 8));
    }
    return m;
  }, [cases]);

  async function handleRerun() {
    setRerunning(true);
    try {
      if (synth?.status === "error") {
        await deleteSynthesisFromDb(synth.id);
      }
      const newId = await submitSynthesis(matterId);
      navigate({
        to: "/matter/$matterId/synthesis/$synthesisId",
        params: { matterId, synthesisId: newId },
        replace: true,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start re-run.");
      setRerunning(false);
    }
  }

  async function handleRerunFailed() {
    if (!synth) return;
    const keys = synth.failedSections.map((f) => f.section);
    if (keys.length === 0) return;
    setRerunning(true);
    try {
      await retryFailedSections(synth.id, keys);
      const refreshed = await getSynthesisFromDb(synth.id);
      if (refreshed) setSynth(refreshed);
      toast.success("Re-running failed sections…");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to re-run sections.");
    } finally {
      setRerunning(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="print:hidden">
        <SiteHeader />
      </div>
      <main className="flex-1">
        <section className="max-w-[1200px] mx-auto px-6 lg:px-8 pt-8 pb-2 print:hidden">
          <Link
            to="/matter/$id"
            params={{ id: matterId }}
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            ‹ Back to matter
          </Link>
        </section>
        <section className="max-w-[1200px] mx-auto px-6 lg:px-8 pt-4 pb-12 print:max-w-none print:px-6 print:pt-2">
          {loading && <p className="text-[13px] text-muted-foreground">Loading…</p>}
          {error && !loading && (
            <p className="text-[13px] text-destructive">{error}</p>
          )}
          {synth && !loading && (
            <>
              {synth.status !== "complete" &&
                synth.status !== "complete_with_errors" &&
                synth.status !== "error" && (
                  <div className="mb-6 border border-border p-4">
                    <p className="text-[13px] text-foreground mb-2">
                      {synth.progressMessage ?? "Preparing…"}
                    </p>
                    <Progress value={synth.progress} />
                  </div>
                )}
              {synth.status === "error" && synth.error && (
                <div className="mt-2 border border-destructive/30 p-4 print:hidden">
                  <p className="text-[13px] text-destructive mb-3">{synth.error}</p>
                  <button
                    type="button"
                    onClick={() => setConfirmRetry(true)}
                    disabled={rerunning}
                    className="inline-flex items-center h-8 px-3 text-[13px] text-foreground border border-foreground/80 hover:bg-foreground/[0.05] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {rerunning ? "Retrying…" : "Retry synthesis"}
                  </button>
                </div>
              )}
              {(synth.status === "complete" ||
                synth.status === "complete_with_errors") &&
                synth.result && (
                <>
                <ErrorBoundary label="the synthesis report">
                  <MatterSynthesisView
                    synthesis={synth.result}
                    caseLabels={caseLabels}
                    failedSubCallKeys={synth.failedSections.map((f) => f.section)}
                    onRerun={handleRerun}
                    onRerunFailed={() => void handleRerunFailed()}
                    rerunDisabled={rerunning}
                    matterName={matterName || "Matter Synthesis"}
                    statusLabel={synth.status}
                    lastRunAt={synth.createdAt}
                    activeTab={tab as SynthesisTabId}
                    onTabChange={(t) =>
                      navigate({
                        to: "/matter/$matterId/synthesis/$synthesisId",
                        params: { matterId, synthesisId },
                        search: { tab: t },
                        replace: true,
                      })
                    }
                  />
                </ErrorBoundary>
                </>
              )}
            </>
          )}
        </section>
      </main>

      <AlertDialog open={confirmRetry} onOpenChange={setConfirmRetry}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retry synthesis?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the failed synthesis row and starts a fresh run for this matter.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRetry(false);
                void handleRerun();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Retry synthesis
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}