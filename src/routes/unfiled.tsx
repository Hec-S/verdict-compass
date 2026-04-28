import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/verdict/SiteHeader";
import { CaseRowList } from "@/components/verdict/CaseRow";
import { listUnfiledCasesFromDb, type CaseListRow } from "@/lib/cases-db";
import { listMattersFromDb, type MatterWithCount } from "@/lib/matters-db";

export const Route = createFileRoute("/unfiled")({
  head: () => ({
    meta: [
      { title: "Unfiled cases — VerdictIQ" },
      {
        name: "description",
        content: "Cases not yet assigned to a matter.",
      },
    ],
  }),
  component: UnfiledPage,
});

function UnfiledPage() {
  const [cases, setCases] = useState<CaseListRow[] | null>(null);
  const [matters, setMatters] = useState<MatterWithCount[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listUnfiledCasesFromDb(), listMattersFromDb()])
      .then(([c, m]) => {
        if (cancelled) return;
        setCases(c);
        setMatters(m);
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
        <section className="max-w-[880px] mx-auto px-8 pt-10 pb-2">
          <Link
            to="/"
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            ‹ All matters
          </Link>
        </section>
        <section className="max-w-[880px] mx-auto px-8 pt-6 pb-24">
          <h1 className="text-[22px] font-medium tracking-[-0.01em] mb-2">
            Unfiled cases
          </h1>
          <p className="text-[13px] text-muted-foreground mb-8">
            Cases not yet assigned to a matter. Use the move icon on each row to file them.
          </p>

          {cases === null && (
            <p className="text-[13px] text-muted-foreground">Loading…</p>
          )}
          {error && <p className="text-[13px] text-destructive">{error}</p>}
          {cases && (
            <CaseRowList cases={cases} matters={matters} onChange={(next) => setCases(next)} />
          )}
        </section>
      </main>
    </div>
  );
}