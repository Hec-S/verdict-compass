import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Pencil, Trash2, Check, X, FolderOpen, Inbox } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/verdict/SiteHeader";
import {
  listMattersFromDb,
  countUnfiledCasesFromDb,
  createMatterInDb,
  updateMatterInDb,
  deleteMatterFromDb,
  type MatterWithCount,
} from "@/lib/matters-db";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Matters — VerdictIQ" },
      {
        name: "description",
        content:
          "Your litigation matters — group depositions, transcripts, and analyses under a single engagement.",
      },
    ],
  }),
  component: MattersDashboard,
});

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function MattersDashboard() {
  const [matters, setMatters] = useState<MatterWithCount[] | null>(null);
  const [unfiledCount, setUnfiledCount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [deleteTarget, setDeleteTarget] = useState<MatterWithCount | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const [submittingNew, setSubmittingNew] = useState(false);

  function reload() {
    Promise.all([listMattersFromDb(), countUnfiledCasesFromDb()])
      .then(([m, u]) => {
        setMatters(m);
        setUnfiledCount(u);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load matters.");
        setMatters([]);
      });
  }

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  function startEdit(m: MatterWithCount) {
    setEditingId(m.id);
    setEditValue(m.name);
    setEditError(null);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
    setEditError(null);
  }
  async function saveEdit(m: MatterWithCount) {
    const trimmed = editValue.trim();
    if (trimmed.length < 1 || trimmed.length > 300) {
      setEditError("Name must be 1–300 characters.");
      return;
    }
    const previous = m.name;
    setSavingId(m.id);
    setMatters((prev) =>
      prev ? prev.map((row) => (row.id === m.id ? { ...row, name: trimmed } : row)) : prev,
    );
    setEditingId(null);
    setEditError(null);
    try {
      await updateMatterInDb(m.id, { name: trimmed });
    } catch (e) {
      setMatters((prev) =>
        prev ? prev.map((row) => (row.id === m.id ? { ...row, name: previous } : row)) : prev,
      );
      toast.error(e instanceof Error ? e.message : "Failed to update matter.");
    } finally {
      setSavingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const snapshot = matters;
    const unfiledBefore = unfiledCount;
    setDeleting(true);
    setMatters((prev) => (prev ? prev.filter((row) => row.id !== target.id) : prev));
    setUnfiledCount(unfiledBefore + target.caseCount);
    try {
      await deleteMatterFromDb(target.id);
      toast.success("Matter deleted. Cases unfiled.");
      setDeleteTarget(null);
    } catch (e) {
      setMatters(snapshot);
      setUnfiledCount(unfiledBefore);
      toast.error(e instanceof Error ? e.message : "Failed to delete matter.");
    } finally {
      setDeleting(false);
    }
  }

  async function submitNewMatter() {
    const trimmed = newName.trim();
    if (trimmed.length < 1 || trimmed.length > 300) {
      setNewError("Name must be 1–300 characters.");
      return;
    }
    setSubmittingNew(true);
    try {
      const created = await createMatterInDb(trimmed, newDesc);
      setMatters((prev) => [{ ...created, caseCount: 0 }, ...(prev ?? [])]);
      setCreating(false);
      setNewName("");
      setNewDesc("");
      setNewError(null);
    } catch (e) {
      setNewError(e instanceof Error ? e.message : "Failed to create matter.");
    } finally {
      setSubmittingNew(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="max-w-[880px] mx-auto px-8 pt-10">
          <div className="flex items-center justify-between">
            <h1 className="text-[18px] font-medium tracking-[-0.01em]">Matters</h1>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setNewError(null);
                  setNewName("");
                  setNewDesc("");
                  setCreating(true);
                }}
                className="inline-flex items-center h-8 px-3 text-[13px] font-normal text-foreground border border-foreground/80 hover:bg-foreground/[0.05] transition-colors"
              >
                New matter
              </button>
              <Link
                to="/new"
                className="inline-flex items-center h-8 px-3 text-[13px] font-normal text-background bg-foreground border border-foreground hover:opacity-90 transition-opacity"
              >
                New analysis
              </Link>
            </div>
          </div>
        </section>

        <section className="max-w-[880px] mx-auto px-8 pt-8 pb-24">
          {matters === null && (
            <p className="text-[13px] text-muted-foreground py-8">Loading…</p>
          )}

          {matters && (
            <ul className="border-t border-border">
              <li className="border-b border-border">
                <Link
                  to="/unfiled"
                  className="relative flex items-center gap-4 h-12 px-1 hover:bg-foreground/[0.02] transition-colors"
                  aria-label="Open unfiled cases"
                >
                  <span className="flex items-center gap-2 flex-[0_0_55%] min-w-0">
                    <Inbox className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-[14px] font-medium text-foreground truncate">
                      Unfiled cases
                    </span>
                  </span>
                  <span className="flex-1 text-[13px] text-muted-foreground truncate">
                    Cases not yet assigned to a matter
                  </span>
                  <span className="text-[12px] text-muted-foreground tabular-nums">
                    {unfiledCount} {unfiledCount === 1 ? "case" : "cases"}
                  </span>
                </Link>
              </li>

              {matters.length === 0 && (
                <li className="py-12 text-center">
                  <p className="text-[13px] text-muted-foreground">
                    {error ?? "No matters yet. Create one to group related analyses."}
                  </p>
                </li>
              )}

              {matters.map((m) => {
                const isEditing = editingId === m.id;
                return (
                  <li key={m.id} className="border-b border-border">
                    <div className="relative flex items-center gap-4 h-14 px-1 hover:bg-foreground/[0.02] transition-colors">
                      {!isEditing && (
                        <Link
                          to="/matter/$id"
                          params={{ id: m.id }}
                          aria-label={`Open ${m.name}`}
                          className="absolute inset-0"
                        />
                      )}
                      <span className="relative flex items-center gap-2 flex-[0_0_45%] min-w-0">
                        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {isEditing ? (
                          <span className="flex flex-col gap-1 flex-1 min-w-0">
                            <span className="flex items-center gap-2">
                              <input
                                ref={inputRef}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    saveEdit(m);
                                  } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    cancelEdit();
                                  }
                                }}
                                maxLength={300}
                                aria-label="Matter name"
                                aria-invalid={!!editError}
                                className="flex-1 min-w-0 h-7 px-2 text-[13px] font-normal bg-background border border-border focus:outline-none focus:border-foreground/60"
                              />
                              <button
                                type="button"
                                onClick={() => saveEdit(m)}
                                disabled={savingId === m.id}
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
                          <span className="text-[14px] font-medium text-foreground truncate">
                            {m.name}
                          </span>
                        )}
                      </span>
                      <span className="relative flex-1 min-w-0 text-[13px] text-muted-foreground truncate">
                        {m.description || ""}
                      </span>
                      <span className="relative text-[12px] text-muted-foreground tabular-nums whitespace-nowrap">
                        {m.caseCount} {m.caseCount === 1 ? "case" : "cases"}
                      </span>
                      <span className="relative flex-[0_0_88px] text-right text-[12px] text-muted-foreground">
                        {formatDate(m.createdAt)}
                      </span>
                      <span className="relative flex items-center gap-0.5 pl-1">
                        <button
                          type="button"
                          aria-label="Edit matter name"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!isEditing) startEdit(m);
                          }}
                          className="inline-flex items-center justify-center h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete matter"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDeleteTarget(m);
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
            <AlertDialogTitle>Delete this matter?</AlertDialogTitle>
            <AlertDialogDescription>
              The {deleteTarget?.caseCount ?? 0}{" "}
              {deleteTarget?.caseCount === 1 ? "case" : "cases"} inside will be unfiled
              but not deleted.
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

      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!open && !submittingNew) setCreating(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New matter</DialogTitle>
            <DialogDescription>
              Group related case analyses (depositions, transcripts) under a single litigation engagement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block">
              <span className="text-[12px] text-muted-foreground">Matter name</span>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitNewMatter();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    if (!submittingNew) setCreating(false);
                  }
                }}
                maxLength={300}
                placeholder="Smith v. Acme Corp."
                className="mt-1 w-full bg-transparent border-b border-border px-0 py-2 text-[14px] focus:outline-none focus:border-foreground transition-colors"
              />
            </label>
            <label className="block">
              <span className="text-[12px] text-muted-foreground">
                Description (optional)
              </span>
              <textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                rows={3}
                placeholder="Court, cause number, trial date, notes…"
                className="mt-1 w-full bg-transparent border border-border px-2 py-2 text-[13px] focus:outline-none focus:border-foreground transition-colors resize-none"
              />
            </label>
            {newError && <p className="text-[12px] text-destructive">{newError}</p>}
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setCreating(false)}
              disabled={submittingNew}
              className="inline-flex items-center h-8 px-3 text-[13px] text-foreground border border-border hover:bg-foreground/[0.05] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitNewMatter}
              disabled={submittingNew}
              className="inline-flex items-center h-8 px-3 text-[13px] text-background bg-foreground border border-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {submittingNew ? "Creating…" : "Create matter"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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