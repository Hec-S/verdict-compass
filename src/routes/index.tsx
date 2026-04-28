import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/verdict/SiteHeader";
import {
  listCasesFromDb,
  updateCaseNameInDb,
  deleteCaseFromDb,
  type CaseListRow,
} from "@/lib/cases-db";
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

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cases — VerdictIQ" },
      {
        name: "description",
        content:
          "Your library of analyzed litigation transcripts — open, review, or start a new analysis.",
      },
    ],
  }),
  component: CasesDashboard,
});

function outcomeTone(outcome: string | null): "positive" | "negative" | "neutral" {
  if (!outcome) return "neutral";
  const v = outcome.toLowerCase();
  if (/(defense|defendant)\s*(verdict|win)/.test(v) || /dismiss|directed verdict|take[- ]?nothing/.test(v))
    return "positive";
  if (/(plaintiff)\s*(verdict|win)/.test(v) || /judgment for plaintiff|award|damages/.test(v))
    return "negative";
  return "neutral";
}

const toneBar: Record<"positive" | "negative" | "neutral", string> = {
  positive: "before:bg-success",
  negative: "before:bg-destructive",
  neutral: "before:bg-border",
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function CasesDashboard() {
  const [cases, setCases] = useState<CaseListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CaseListRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    listCasesFromDb()
      .then((rows) => {
        if (!cancelled) setCases(rows);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load cases.");
          setCases([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  function startEdit(c: CaseListRow) {
    setEditingId(c.id);
    setEditValue(c.caseName || c.snapshot?.caseName || "");
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
    setEditError(null);
  }

  async function saveEdit(c: CaseListRow) {
    const trimmed = editValue.trim();
    if (trimmed.length < 1 || trimmed.length > 300) {
      setEditError("Name must be 1–300 characters.");
      return;
    }
    const previous = c.caseName;
    setSavingId(c.id);
    setCases((prev) =>
      prev ? prev.map((row) => (row.id === c.id ? { ...row, caseName: trimmed } : row)) : prev,
    );
    setEditingId(null);
    setEditError(null);
    try {
      await updateCaseNameInDb(c.id, trimmed);
    } catch (e) {
      setCases((prev) =>
        prev ? prev.map((row) => (row.id === c.id ? { ...row, caseName: previous } : row)) : prev,
      );
      toast.error(e instanceof Error ? e.message : "Failed to update name.");
    } finally {
      setSavingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const snapshot = cases;
    setDeleting(true);
    setCases((prev) => (prev ? prev.filter((row) => row.id !== target.id) : prev));
    try {
      await deleteCaseFromDb(target.id);
      toast.success("Case deleted.");
      setDeleteTarget(null);
    } catch (e) {
      setCases(snapshot);
      toast.error(e instanceof Error ? e.message : "Failed to delete case.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="max-w-[880px] mx-auto px-8 pt-10">
          <div className="flex items-center justify-between">
            <h1 className="text-[18px] font-medium tracking-[-0.01em]">Cases</h1>
            <Link
              to="/new"
              className="inline-flex items-center h-8 px-3 text-[13px] font-normal text-foreground border border-foreground/80 hover:bg-foreground/[0.05] transition-colors"
            >
              New analysis
            </Link>
          </div>
        </section>

        <section className="max-w-[880px] mx-auto px-8 pt-8 pb-24">
          {cases === null && (
            <p className="text-[13px] text-muted-foreground py-8">Loading…</p>
          )}

          {cases && cases.length === 0 && (
            <div className="border-t border-border pt-24 flex flex-col items-center text-center">
              <p className="text-[14px] text-muted-foreground mb-6">
                {error ?? "No cases yet."}
              </p>
              <Link
                to="/new"
                className="inline-flex items-center h-8 px-3 text-[13px] text-foreground border border-foreground/80 hover:bg-foreground/[0.05] transition-colors"
              >
                Analyze your first transcript
              </Link>
            </div>
          )}

          {cases && cases.length > 0 && (
            <>
              <p className="text-[12px] text-muted-foreground mb-3">
                Showing {cases.length} {cases.length === 1 ? "case" : "cases"}
              </p>
              <ul className="border-t border-border">
                {cases.map((c) => {
                  const tone = outcomeTone(c.outcome);
                  const parties =
                    c.snapshot?.plaintiff && c.snapshot?.defendant
                      ? `${c.snapshot.plaintiff} v. ${c.snapshot.defendant}`
                      : "";
                  const isEditing = editingId === c.id;
                  return (
                    <li key={c.id} className="border-b border-border">
                      <div className="relative flex items-center gap-4 h-12 px-1 hover:bg-foreground/[0.02] transition-colors">
                        {!isEditing && (
                          <Link
                            to="/case/$id"
                            params={{ id: c.id }}
                            aria-label={`Open ${c.caseName || "case"}`}
                            className="absolute inset-0"
                          />
                        )}
                        <span className="relative flex-[0_0_45%] min-w-0 text-[14px] font-medium text-foreground truncate">
                          {isEditing ? (
                            <span className="flex flex-col gap-1">
                              <span className="flex items-center gap-2">
                                <input
                                  ref={inputRef}
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      saveEdit(c);
                                    } else if (e.key === "Escape") {
                                      e.preventDefault();
                                      cancelEdit();
                                    }
                                  }}
                                  maxLength={300}
                                  aria-label="Case name"
                                  aria-invalid={!!editError}
                                  className="flex-1 min-w-0 h-7 px-2 text-[13px] font-normal bg-background border border-border focus:outline-none focus:border-foreground/60"
                                />
                                <button
                                  type="button"
                                  onClick={() => saveEdit(c)}
                                  disabled={savingId === c.id}
                                  aria-label="Save name"
                                  className="inline-flex items-center justify-center h-7 w-7 text-foreground hover:bg-foreground/[0.06] transition-colors disabled:opacity-50"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEdit}
                                  aria-label="Cancel edit"
                                  className="inline-flex items-center justify-center h-7 w-7 text-muted-foreground hover:bg-foreground/[0.06] transition-colors"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </span>
                              {editError && (
                                <span className="text-[11px] text-destructive font-normal">
                                  {editError}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="truncate block">
                              {c.caseName || c.snapshot?.caseName || "Untitled case"}
                            </span>
                          )}
                        </span>
                        <span className="flex-[0_0_25%] min-w-0 text-[13px] text-muted-foreground truncate">
                          {parties}
                        </span>
                        <span
                          className={`flex-[0_0_15%] min-w-0 relative pl-2 text-[13px] text-foreground truncate before:content-[''] before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[2px] ${toneBar[tone]}`}
                        >
                          {c.outcome || "—"}
                        </span>
                        <span className="flex-[0_0_10%] text-right text-[12px] text-muted-foreground">
                          {formatDate(c.createdAt)}
                        </span>
                        <span className="relative flex items-center gap-0.5 pl-1">
                          <button
                            type="button"
                            aria-label="Edit case name"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (!isEditing) startEdit(c);
                            }}
                            className="inline-flex items-center justify-center h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Delete case"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDeleteTarget(c);
                            }}
                            className="inline-flex items-center justify-center h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-foreground/[0.06] transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      </main>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this case?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes{" "}
              <span className="font-medium text-foreground">
                {deleteTarget?.caseName || deleteTarget?.snapshot?.caseName || "this case"}
              </span>{" "}
              and its analysis. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
