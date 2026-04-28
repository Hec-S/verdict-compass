import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Pencil, Check, X, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/verdict/SiteHeader";
import { CaseRowList } from "@/components/verdict/CaseRow";
import { MatterSynthesisView } from "@/components/verdict/MatterSynthesisView";
import {
  getMatterFromDb,
  updateMatterInDb,
  listMattersFromDb,
  type MatterRow,
  type MatterWithCount,
} from "@/lib/matters-db";
import {
  listUnfiledCasesFromDb,
  assignCaseToMatter,
  type CaseListRow,
} from "@/lib/cases-db";
import {
  submitSynthesis,
  getSynthesisFromDb,
  getLatestSynthesisForMatter,
  markSynthesisProcessorNeverStarted,
  deleteSynthesisFromDb,
  retryFailedSections,
} from "@/lib/synthesis-db";
import type { MatterSynthesisRow } from "@/lib/analysis-types";
import { SYNTHESIS_SUB_CALLS } from "@/lib/analysis-types";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export const Route = createFileRoute("/matter/$id")({
  head: () => ({
    meta: [{ title: "Matter — VerdictIQ" }],
  }),
  component: MatterDetailPage,
});

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const SYNTHESIS_START_TIMEOUT_MS = 60 * 1000;

function MatterDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [matter, setMatter] = useState<MatterRow | null>(null);
  const [cases, setCases] = useState<CaseListRow[]>([]);
  const [otherMatters, setOtherMatters] = useState<MatterWithCount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // name edit
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  // description edit
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState("");
  const descRef = useRef<HTMLTextAreaElement>(null);

  // add-existing-case picker
  const [picking, setPicking] = useState(false);
  const [unfiled, setUnfiled] = useState<CaseListRow[] | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  // synthesis run state
  const [synthRunning, setSynthRunning] = useState(false);
  const [synthProgress, setSynthProgress] = useState(0);
  const [synthMessage, setSynthMessage] = useState<string>("");
  const [synthError, setSynthError] = useState<string | null>(null);
  const [latestSynthesis, setLatestSynthesis] = useState<MatterSynthesisRow | null>(null);
  const [retryingSynthesis, setRetryingSynthesis] = useState(false);
  const [confirmRetry, setConfirmRetry] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getMatterFromDb(id), listMattersFromDb(), getLatestSynthesisForMatter(id)])
      .then(([res, allMatters, latest]) => {
        if (cancelled) return;
        if (!res) {
          setError("Matter not found.");
        } else {
          setMatter(res.matter);
          setCases(res.cases);
          setOtherMatters(allMatters.filter((m) => m.id !== id));
          setLatestSynthesis(latest);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load matter.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (editingName && nameRef.current) {
      nameRef.current.focus();
      nameRef.current.select();
    }
  }, [editingName]);
  useEffect(() => {
    if (editingDesc && descRef.current) {
      descRef.current.focus();
    }
  }, [editingDesc]);

  useEffect(() => {
    if (!latestSynthesis) return;
    if (
      latestSynthesis.status === "complete" ||
      latestSynthesis.status === "complete_with_errors" ||
      latestSynthesis.status === "error"
    )
      return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const row = await getSynthesisFromDb(latestSynthesis.id);
        if (cancelled || !row) return;
        if (
          row.status === "pending" &&
          row.progress === 0 &&
          Date.now() - row.createdAt > SYNTHESIS_START_TIMEOUT_MS
        ) {
          await markSynthesisProcessorNeverStarted(row.id);
          setLatestSynthesis({
            ...row,
            status: "error",
            error: "Synthesis processor never started. Click Re-run to try again.",
            progressMessage: "Synthesis failed.",
          });
          return;
        }
        setLatestSynthesis(row);
      } catch (e) {
        console.error("[synthesis latest poll]", e);
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [latestSynthesis?.id, latestSynthesis?.status]);

  async function saveName() {
    if (!matter) return;
    const trimmed = nameValue.trim();
    if (trimmed.length < 1 || trimmed.length > 300) {
      toast.error("Name must be 1–300 characters.");
      return;
    }
    const previous = matter.name;
    setMatter({ ...matter, name: trimmed });
    setEditingName(false);
    try {
      await updateMatterInDb(matter.id, { name: trimmed });
    } catch (e) {
      setMatter({ ...matter, name: previous });
      toast.error(e instanceof Error ? e.message : "Failed to update name.");
    }
  }

  async function saveDesc() {
    if (!matter) return;
    const previous = matter.description;
    const next = descValue.trim() || null;
    setMatter({ ...matter, description: next });
    setEditingDesc(false);
    try {
      await updateMatterInDb(matter.id, { description: next });
    } catch (e) {
      setMatter({ ...matter, description: previous });
      toast.error(e instanceof Error ? e.message : "Failed to update description.");
    }
  }

  async function openPicker() {
    setPicking(true);
    setPickError(null);
    setUnfiled(null);
    try {
      const list = await listUnfiledCasesFromDb();
      setUnfiled(list);
    } catch (e) {
      setPickError(e instanceof Error ? e.message : "Failed to load cases.");
      setUnfiled([]);
    }
  }

  async function pickCase(c: CaseListRow) {
    if (!matter) return;
    setAssigningId(c.id);
    try {
      await assignCaseToMatter(c.id, matter.id);
      setCases((prev) => [{ ...c, matterId: matter.id }, ...prev]);
      setUnfiled((prev) => (prev ? prev.filter((r) => r.id !== c.id) : prev));
      toast.success("Case added to matter.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add case.");
    } finally {
      setAssigningId(null);
    }
  }

  async function runSynthesis() {
    if (!matter) return;
    if (cases.length < 2) {
      toast.error("Matter needs at least 2 cases to run synthesis.");
      return;
    }
    setSynthRunning(true);
    setSynthProgress(0);
    setSynthMessage("Submitting…");
    setSynthError(null);
    let synthesisId: string;
    try {
      synthesisId = await submitSynthesis(matter.id);
      const created = await getSynthesisFromDb(synthesisId);
      if (created) setLatestSynthesis(created);
    } catch (e) {
      setSynthError(e instanceof Error ? e.message : "Failed to start synthesis.");
      setSynthRunning(false);
      return;
    }
    // Poll every 3s until complete or error.
    const start = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000;
    while (Date.now() - start < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const row = await getSynthesisFromDb(synthesisId);
        if (!row) continue;
        if (
          row.status === "pending" &&
          row.progress === 0 &&
          Date.now() - row.createdAt > SYNTHESIS_START_TIMEOUT_MS
        ) {
          await markSynthesisProcessorNeverStarted(row.id);
          const message = "Synthesis processor never started. Click Re-run to try again.";
          setLatestSynthesis({ ...row, status: "error", error: message });
          setSynthError(message);
          setSynthRunning(false);
          return;
        }
        setLatestSynthesis(row);
        setSynthProgress(row.progress);
        if (row.progressMessage) setSynthMessage(row.progressMessage);
        if (row.status === "complete" || row.status === "complete_with_errors") {
          // Synthesis is rendered inline below — no navigation.
          setSynthRunning(false);
          return;
        }
        if (row.status === "error") {
          setSynthError(row.error ?? "Synthesis failed.");
          setSynthRunning(false);
          return;
        }
      } catch (e) {
        console.error("[synthesis poll]", e);
      }
    }
    setSynthError("Synthesis timed out. Please try again.");
    setSynthRunning(false);
  }

  async function retryErroredSynthesis() {
    if (!matter || !latestSynthesis || latestSynthesis.status !== "error") return;
    setRetryingSynthesis(true);
    setSynthError(null);
    try {
      await deleteSynthesisFromDb(latestSynthesis.id);
      setLatestSynthesis(null);
      await runSynthesis();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to retry synthesis.");
    } finally {
      setRetryingSynthesis(false);
    }
  }

  async function rerunFailedSubCalls() {
    if (!latestSynthesis) return;
    const keys = latestSynthesis.failedSections.map((f) => f.section);
    if (keys.length === 0) return;
    setRetryingSynthesis(true);
    try {
      await retryFailedSections(latestSynthesis.id, keys);
      // Mark as processing so the existing poller picks it up.
      const refreshed = await getSynthesisFromDb(latestSynthesis.id);
      if (refreshed) setLatestSynthesis(refreshed);
      toast.success("Re-running failed sections…");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to re-run sections.");
    } finally {
      setRetryingSynthesis(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="max-w-[880px] mx-auto px-8 pt-10 pb-2">
          <Link
            to="/"
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            ‹ All matters
          </Link>
        </section>

        <section className="max-w-[880px] mx-auto px-8 pt-6 pb-8">
          {loading && <p className="text-[13px] text-muted-foreground">Loading…</p>}
          {error && !loading && <p className="text-[13px] text-destructive">{error}</p>}

          {matter && !loading && (
            <>
              {/* Name */}
              <div className="flex items-start gap-3 mb-3">
                {editingName ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      ref={nameRef}
                      value={nameValue}
                      onChange={(e) => setNameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveName();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setEditingName(false);
                        }
                      }}
                      maxLength={300}
                      aria-label="Matter name"
                      className="flex-1 min-w-0 text-[22px] font-medium tracking-[-0.01em] bg-background border-b border-border focus:outline-none focus:border-foreground py-1"
                    />
                    <button
                      type="button"
                      onClick={saveName}
                      aria-label="Save name"
                      className="inline-flex items-center justify-center h-8 w-8 text-foreground hover:bg-foreground/[0.06] transition-colors"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingName(false)}
                      aria-label="Cancel edit"
                      className="inline-flex items-center justify-center h-8 w-8 text-muted-foreground hover:bg-foreground/[0.06] transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <h1 className="text-[22px] font-medium tracking-[-0.01em] flex-1 min-w-0 break-words">
                      {matter.name}
                    </h1>
                    <button
                      type="button"
                      aria-label="Edit matter name"
                      onClick={() => {
                        setNameValue(matter.name);
                        setEditingName(true);
                      }}
                      className="inline-flex items-center justify-center h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors mt-1"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>

              {/* Meta */}
              <p className="text-[12px] text-muted-foreground mb-4">
                {cases.length} {cases.length === 1 ? "case" : "cases"} · Created{" "}
                {formatDate(matter.createdAt)}
              </p>

              {/* Description */}
              <div className="mb-8">
                {editingDesc ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      ref={descRef}
                      value={descValue}
                      onChange={(e) => setDescValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          saveDesc();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setEditingDesc(false);
                        }
                      }}
                      rows={4}
                      placeholder="Court, cause number, trial date, notes…"
                      className="w-full bg-transparent border border-border px-2 py-2 text-[13px] focus:outline-none focus:border-foreground transition-colors resize-y"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={saveDesc}
                        className="inline-flex items-center h-7 px-3 text-[12px] text-background bg-foreground hover:opacity-90"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingDesc(false)}
                        className="inline-flex items-center h-7 px-3 text-[12px] text-foreground border border-border hover:bg-foreground/[0.05]"
                      >
                        Cancel
                      </button>
                      <span className="text-[11px] text-muted-foreground">
                        ⌘+Enter to save · Esc to cancel
                      </span>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setDescValue(matter.description ?? "");
                      setEditingDesc(true);
                    }}
                    className="block text-left w-full text-[13px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.02] px-1 py-2 -mx-1 rounded transition-colors"
                  >
                    {matter.description || (
                      <span className="italic">Add description (court, cause number, trial date, notes)…</span>
                    )}
                  </button>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 mb-6">
                <Link
                  to="/new"
                  search={{ matterId: matter.id }}
                  className="inline-flex items-center h-8 px-3 text-[13px] text-background bg-foreground border border-foreground hover:opacity-90 transition-opacity"
                >
                  New analysis in this matter
                </Link>
                <button
                  type="button"
                  onClick={openPicker}
                  className="inline-flex items-center h-8 px-3 text-[13px] text-foreground border border-foreground/80 hover:bg-foreground/[0.05] transition-colors"
                >
                  Add existing case
                </button>
                <button
                  type="button"
                  onClick={runSynthesis}
                  disabled={cases.length < 2 || synthRunning}
                  title={
                    cases.length < 2
                      ? "Add at least 2 cases to run synthesis"
                      : "Run multi-case synthesis"
                  }
                  className="inline-flex items-center h-8 px-3 text-[13px] text-foreground border border-foreground/80 hover:bg-foreground/[0.05] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {synthRunning ? "Running synthesis…" : "Run synthesis"}
                </button>
              </div>

              <SynthesisStatusBanner
                synthRunning={synthRunning}
                synthProgress={synthProgress}
                synthMessage={synthMessage}
                latestSynthesis={latestSynthesis}
                retryingSynthesis={retryingSynthesis}
                onRetry={() => setConfirmRetry(true)}
                onRerunFailed={() => void rerunFailedSubCalls()}
                onRerunAll={() => setConfirmRetry(true)}
              />

              {/* Cases list */}
              <CaseRowList
                cases={cases}
                matters={otherMatters}
                onChange={(next) => setCases(next)}
              />

              {/* Inline synthesis report */}
              {latestSynthesis &&
                (latestSynthesis.status === "complete" ||
                  latestSynthesis.status === "complete_with_errors") &&
                latestSynthesis.result && (
                  <div className="mt-10 pt-8 border-t border-border">
                    <div className="mb-4 flex items-baseline justify-between gap-4">
                      <h2 className="text-[16px] font-medium tracking-[-0.01em]">
                        Matter Synthesis
                      </h2>
                      <Link
                        to="/matter/$matterId/synthesis/$synthesisId"
                        params={{
                          matterId: matter.id,
                          synthesisId: latestSynthesis.id,
                        }}
                        className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Open full report ›
                      </Link>
                    </div>
                    <MatterSynthesisView
                      synthesis={latestSynthesis.result}
                      caseLabels={
                        new Map(
                          cases.map((c) => [
                            c.id,
                            c.snapshot?.caseName || c.caseName || c.id.slice(0, 8),
                          ]),
                        )
                      }
                      failedSubCallKeys={latestSynthesis.failedSections.map(
                        (f) => f.section,
                      )}
                      onRerun={() => setConfirmRetry(true)}
                      onRerunFailed={() => void rerunFailedSubCalls()}
                      rerunDisabled={retryingSynthesis || synthRunning}
                    />
                  </div>
                )}
            </>
          )}
        </section>
      </main>

      <Dialog open={picking} onOpenChange={(open) => !open && setPicking(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an existing case</DialogTitle>
            <DialogDescription>
              Pick an unfiled case to assign to this matter.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto -mx-6 px-6">
            {unfiled === null && !pickError && (
              <p className="text-[13px] text-muted-foreground py-4">Loading…</p>
            )}
            {pickError && <p className="text-[13px] text-destructive py-4">{pickError}</p>}
            {unfiled && unfiled.length === 0 && !pickError && (
              <p className="text-[13px] text-muted-foreground py-4">
                No unfiled cases available.
              </p>
            )}
            {unfiled && unfiled.length > 0 && (
              <ul className="border-t border-border">
                {unfiled.map((c) => (
                  <li key={c.id} className="border-b border-border">
                    <button
                      type="button"
                      disabled={assigningId === c.id}
                      onClick={() => pickCase(c)}
                      className="w-full flex items-center gap-3 py-2 px-1 text-left hover:bg-foreground/[0.04] transition-colors disabled:opacity-50"
                    >
                      <span className="flex-1 min-w-0 text-[13px] text-foreground truncate">
                        {c.caseName || c.snapshot?.caseName || "Untitled case"}
                      </span>
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                        {formatDate(c.createdAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPicking(false)}
              className="inline-flex items-center h-8 px-3 text-[13px] text-foreground border border-border hover:bg-foreground/[0.05] transition-colors"
            >
              Done
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                void retryErroredSynthesis();
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