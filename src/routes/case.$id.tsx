import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/verdict/SiteHeader";
import { Dashboard } from "@/components/verdict/Dashboard";
import { getCaseFromDb } from "@/lib/cases-db";
import type { StoredCase } from "@/lib/analysis-types";

export const Route = createFileRoute("/case/$id")({
  head: () => ({
    meta: [{ title: "Case Analysis — VerdictIQ" }],
  }),
  component: CasePage,
});

function CasePage() {
  const { id } = Route.useParams();
  const [stored, setStored] = useState<StoredCase | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCaseFromDb(id)
      .then((c) => {
        if (!cancelled) setStored(c);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load case.");
          setStored(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (stored === undefined) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <div className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground">
          Loading…
        </div>
      </div>
    );
  }

  if (stored === null) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="flex-1">
          <section className="max-w-[680px] mx-auto px-8 pt-24 pb-10">
            <h1 className="text-[18px] font-medium mb-2">Case not found</h1>
            <p className="text-[13px] text-muted-foreground mb-6">
              {error ?? "This case may have been deleted."}
            </p>
            <Link
              to="/"
              className="inline-flex items-center h-8 px-3 text-[13px] text-foreground border border-foreground/80 hover:bg-foreground/[0.05] transition-colors"
            >
              Back to all cases
            </Link>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="print:hidden">
        <SiteHeader />
      </div>
      <main className="flex-1">
        <div className="max-w-[880px] mx-auto px-8 pt-6 print:hidden">
          <Link
            to="/"
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            ‹ All cases
          </Link>
        </div>
        <Dashboard stored={stored} />
      </main>
    </div>
  );
}