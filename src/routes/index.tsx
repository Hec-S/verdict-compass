import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/verdict/SiteHeader";
import { listCasesFromDb, type CaseListRow } from "@/lib/cases-db";

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
                  return (
                    <li key={c.id} className="border-b border-border">
                      <Link
                        to="/case/$id"
                        params={{ id: c.id }}
                        className="flex items-center gap-4 h-12 px-1 hover:bg-foreground/[0.02] transition-colors"
                      >
                        <span className="flex-[0_0_45%] min-w-0 text-[14px] font-medium text-foreground truncate">
                          {c.caseName || c.snapshot?.caseName || "Untitled case"}
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
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      </main>
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
