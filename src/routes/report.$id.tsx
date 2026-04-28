import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { SiteHeader } from "@/components/verdict/SiteHeader";
import { Dashboard } from "@/components/verdict/Dashboard";
import { getCase } from "@/lib/case-store";
import type { StoredCase } from "@/lib/analysis-types";

export const Route = createFileRoute("/report/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Case Analysis — VerdictIQ` },
      { name: "description", content: `Litigation transcript analysis (${params.id}).` },
    ],
  }),
  component: ReportPage,
});

function ReportPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [stored, setStored] = useState<StoredCase | null | undefined>(undefined);

  useEffect(() => {
    setStored(getCase(id));
  }, [id]);

  if (stored === undefined) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading…
        </div>
      </div>
    );
  }

  if (stored === null) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="max-w-md text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-warning/10 border border-warning/30 flex items-center justify-center mb-4">
              <AlertTriangle className="w-5 h-5 text-warning" />
            </div>
            <h1 className="font-serif text-3xl mb-2">Case not found</h1>
            <p className="text-sm text-muted-foreground mb-6">
              This analysis isn't stored on this device. Cases are saved locally in your browser.
            </p>
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-gradient-gold text-navy-deep font-semibold text-sm"
            >
              Start a new analysis
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="print:hidden">
        <SiteHeader />
      </div>
      <main className="flex-1">
        <Dashboard stored={stored} />
      </main>
    </div>
  );
}
