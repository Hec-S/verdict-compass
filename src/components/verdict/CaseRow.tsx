import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Pencil, Trash2, Check, X, FolderInput } from "lucide-react";
import { toast } from "sonner";
import {
  updateCaseNameInDb,
  deleteCaseFromDb,
  assignCaseToMatter,
  type CaseListRow,
} from "@/lib/cases-db";
import type { MatterWithCount } from "@/lib/matters-db";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function outcomeTone(outcome: string | null): "positive" | "negative" | "neutral" {
  if (!outcome) return "neutral";
  const v = outcome.toLowerCase();
  if (
    /(defense|defendant)\s*(verdict|win)/.test(v) ||
    /dismiss|directed verdict|take[- ]?nothing/.test(v)
  )
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

export interface CaseRowListProps {
  cases: CaseListRow[];
  /** Other matters available for "Move to…". Pass [] to hide the move action. */
  matters?: MatterWithCount[];
  /** Called when a case is renamed/deleted/moved so caller can refresh. */
  onChange?: (next: CaseListRow[]) => void;
}

export function CaseRowList({ cases, matters = [], onChange }: CaseRowListProps) {
  const [rows, setRows] = useState<CaseListRow[]>(cases);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CaseListRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setRows(cases), [cases]);
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  function update(next: CaseListRow[]) {
    setRows(next);
    onChange?.(next);
  }

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
    update(rows.map((r) => (r.id === c.id ? { ...r, caseName: trimmed } : r)));
    setEditingId(null);
    setEditError(null);
    try {
      await updateCaseNameInDb(c.id, trimmed);
    } catch (e) {
      update(rows.map((r) => (r.id === c.id ? { ...r, caseName: previous } : r)));
      toast.error(e instanceof Error ? e.message : "Failed to update name.");
    } finally {
      setSavingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const snapshot = rows;
    setDeleting(true);
    update(rows.filter((r) => r.id !== target.id));
    try {
      await deleteCaseFromDb(target.id);
      toast.success("Case deleted.");
      setDeleteTarget(null);
    } catch (e) {
      update(snapshot);
      toast.error(e instanceof Error ? e.message : "Failed to delete case.");
    } finally {
      setDeleting(false);
    }
  }

  async function moveTo(c: CaseListRow, matterId: string | null) {
    const snapshot = rows;
    update(rows.map((r) => (r.id === c.id ? { ...r, matterId } : r)));
    try {
      await assignCaseToMatter(c.id, matterId);
      toast.success(matterId ? "Case moved." : "Case unfiled.");
    } catch (e) {
      update(snapshot);
      toast.error(e instanceof Error ? e.message : "Failed to move case.");
    }
  }

  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground py-6">No cases here yet.</p>
    );
  }

  return (
    <>
      <ul className="border-t border-border">
        {rows.map((c) => {
          const tone = outcomeTone(c.outcome);
          const parties =
            c.snapshot?.plaintiff && c.snapshot?.defendant
              ? `${c.snapshot.plaintiff} v. ${c.snapshot.defendant}`
              : "";
          const isEditing = editingId === c.id;
          const moveOptions = matters.filter((m) => m.id !== c.matterId);
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
                  {matters.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label="Move case to another matter"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          className="inline-flex items-center justify-center h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
                        >
                          <FolderInput className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel>Move to…</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {c.matterId !== null && (
                          <DropdownMenuItem
                            onSelect={(e) => {
                              e.preventDefault();
                              moveTo(c, null);
                            }}
                          >
                            Unfile
                          </DropdownMenuItem>
                        )}
                        {moveOptions.length === 0 && c.matterId === null && (
                          <DropdownMenuItem disabled>No other matters</DropdownMenuItem>
                        )}
                        {moveOptions.map((m) => (
                          <DropdownMenuItem
                            key={m.id}
                            onSelect={(e) => {
                              e.preventDefault();
                              moveTo(c, m.id);
                            }}
                          >
                            <span className="truncate">{m.name}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
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
    </>
  );
}