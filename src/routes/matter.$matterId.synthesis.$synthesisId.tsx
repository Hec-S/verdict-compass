import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/verdict/SiteHeader";
import { MatterSynthesisView } from "@/components/verdict/MatterSynthesisView";
import { Progress } from "@/components/ui/progress";
import {
  deleteSynthesisFromDb,
  getSynthesisFromDb,
  markSynthesisProcessorNeverStarted,
  submitSynthesis,
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
  component: MatterSynthesisPage,
});

const SYNTHESIS_START_TIMEOUT_MS = 60 * 1000;

function MatterSynthesisPage() {
  const { matterId, synthesisId } = Route.useParams();
  const navigate = useNavigate();
  const [synth, setSynth] = useState<MatterSynthesisRow | null>(null);
  const [cases, setCases] = useState<CaseListRow[]>([]);
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
    if (synth.status === "complete" || synth.status === "error") return;
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
        if (row.status === "complete" || row.status === "error") {
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

  return (
    <div className="min-h-screen flex flex-col">
      <div className="print:hidden">
        <SiteHeader />
      </div>
      <main className="flex-1">
        <section className="max-w-[880px] mx-auto px-8 pt-10 pb-2 print:hidden">
          <Link
            to="/matter/$id"
            params={{ id: matterId }}
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            ‹ Back to matter
          </Link>
        </section>
        <section className="max-w-[880px] mx-auto px-8 pt-6 pb-8 print:max-w-none print:px-6 print:pt-2">
          {loading && <p className="text-[13px] text-muted-foreground">Loading…</p>}
          {error && !loading && (
            <p className="text-[13px] text-destructive">{error}</p>
          )}
          {synth && !loading && (
            <>
              <h1 className="text-[22px] font-medium tracking-[-0.01em] mb-2 print:text-[18px]">
                Matter Synthesis
              </h1>
              <p className="text-[12px] text-muted-foreground mb-6">
                Status: {synth.status} · {synth.caseIds.length}{" "}
                {synth.caseIds.length === 1 ? "case" : "cases"} included
              </p>
              {synth.status !== "complete" && synth.status !== "error" && (
                <div className="mb-6 border border-border p-4">
                  <p className="text-[13px] text-foreground mb-2">
                    {synth.progressMessage ?? "Preparing…"}
                  </p>
                  <Progress value={synth.progress} />
                </div>
              )}
              {synth.status === "error" && synth.error && (
                <p className="text-[13px] text-destructive mt-2">{synth.error}</p>
              )}
              {synth.status === "complete" && synth.result && (
                <MatterSynthesisView
                  synthesis={synth.result}
                  caseLabels={caseLabels}
                  onRerun={handleRerun}
                  rerunDisabled={rerunning}
                />
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}