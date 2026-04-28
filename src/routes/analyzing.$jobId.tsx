import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/verdict/SiteHeader";
import { Progress } from "@/components/ui/progress";
import { pollJob, AnalysisFailedError, AnalysisTimeoutError } from "@/lib/analyze-client";
import { linkCaseToJob } from "@/lib/debug-trace";

export const Route = createFileRoute("/analyzing/$jobId")({
  head: () => ({
    meta: [{ title: "Analyzing… — VerdictIQ" }],
  }),
  component: AnalyzingPage,
});

function AnalyzingPage() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Working…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    pollJob(jobId, (p) => {
      if (cancelled) return;
      setProgress(p.progress);
      if (p.message) setMessage(p.message);
    })
      .then((res) => {
        if (cancelled) return;
        if (res.caseId) {
          linkCaseToJob(res.caseId, jobId);
          navigate({ to: "/case/$id", params: { id: res.caseId }, replace: true });
        } else {
          setError("Analysis finished but the case could not be saved. Try again.");
        }
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AnalysisTimeoutError) {
          setError("Analysis took too long. Please try again.");
        } else if (e instanceof AnalysisFailedError) {
          setError(e.message);
        } else {
          setError(e instanceof Error ? e.message : "Something went wrong.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, navigate]);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="max-w-[680px] mx-auto px-8 pt-24 pb-10">
          <h1 className="text-[18px] font-medium leading-tight mb-2">Analyzing transcript</h1>
          <p className="text-[13px] text-muted-foreground mb-8">
            This usually takes 60–120 seconds. Keep this tab open.
          </p>

          {!error ? (
            <div className="space-y-2">
              <Progress value={progress} className="h-[2px]" />
              <div className="flex items-center justify-between text-[12px] text-muted-foreground">
                <span>{message}</span>
                <span className="font-mono tabular-nums">{progress}%</span>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[13px] text-destructive">{error}</p>
              <Link
                to="/new"
                className="inline-flex items-center h-8 px-3 text-[13px] text-foreground border border-foreground/80 hover:bg-foreground/[0.05] transition-colors"
              >
                Try again
              </Link>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}