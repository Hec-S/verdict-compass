import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/verdict/SiteHeader";
import { getSynthesisFromDb } from "@/lib/synthesis-db";
import type { MatterSynthesisRow } from "@/lib/analysis-types";

export const Route = createFileRoute(
  "/matter/$matterId/synthesis/$synthesisId",
)({
  head: () => ({
    meta: [{ title: "Matter Synthesis — VerdictIQ" }],
  }),
  component: MatterSynthesisPage,
});

function MatterSynthesisPage() {
  const { matterId, synthesisId } = Route.useParams();
  const [synth, setSynth] = useState<MatterSynthesisRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getSynthesisFromDb(synthesisId)
      .then((row) => {
        if (cancelled) return;
        if (!row) setError("Synthesis not found.");
        else setSynth(row);
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
  }, [synthesisId]);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="max-w-[880px] mx-auto px-8 pt-10 pb-2">
          <Link
            to="/matter/$id"
            params={{ id: matterId }}
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            ‹ Back to matter
          </Link>
        </section>
        <section className="max-w-[880px] mx-auto px-8 pt-6 pb-8">
          {loading && <p className="text-[13px] text-muted-foreground">Loading…</p>}
          {error && !loading && (
            <p className="text-[13px] text-destructive">{error}</p>
          )}
          {synth && !loading && (
            <>
              <h1 className="text-[22px] font-medium tracking-[-0.01em] mb-2">
                Matter Synthesis
              </h1>
              <p className="text-[12px] text-muted-foreground mb-6">
                Status: {synth.status} · {synth.caseIds.length}{" "}
                {synth.caseIds.length === 1 ? "case" : "cases"} included
              </p>
              {synth.status !== "complete" && (
                <p className="text-[13px] text-muted-foreground">
                  {synth.progressMessage ?? "Preparing…"}
                </p>
              )}
              {synth.status === "error" && synth.error && (
                <p className="text-[13px] text-destructive mt-2">{synth.error}</p>
              )}
              {synth.status === "complete" && synth.result && (
                <div className="text-[13px] text-muted-foreground border border-border p-4 rounded">
                  <p className="mb-2">
                    Synthesis result loaded. The full <code>MatterSynthesisView</code>{" "}
                    component will render here in the next iteration.
                  </p>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-foreground">
                      Raw JSON
                    </summary>
                    <pre className="mt-2 max-h-[60vh] overflow-auto text-[11px] whitespace-pre-wrap break-words">
                      {JSON.stringify(synth.result, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}