import { useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2,
  XCircle,
  Target,
  Users,
  Gavel,
  ScrollText,
  Lightbulb,
  FileText,
  Download,
  Plus,
  AlertTriangle,
} from "lucide-react";
import { Panel, Cite, CategoryTag } from "./Panel";
import type { StoredCase, Credibility } from "@/lib/analysis-types";

const credibilityStyle: Record<Credibility, string> = {
  Strong: "bg-success/15 text-success border-success/40",
  Mixed: "bg-warning/15 text-warning border-warning/40",
  Weak: "bg-destructive/15 text-destructive border-destructive/40",
};

function rulingStyle(r: string) {
  const v = r.toLowerCase();
  if (v.includes("sustain")) return "bg-success/15 text-success border-success/40";
  if (v.includes("overrul")) return "bg-destructive/15 text-destructive border-destructive/40";
  return "bg-secondary text-muted-foreground border-border";
}

export function Dashboard({ stored }: { stored: StoredCase }) {
  const navigate = useNavigate();
  const r = stored.result;
  const snap = r.caseSnapshot ?? ({} as any);

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-6 print:py-2 print:max-w-none">
      {/* Top Snapshot */}
      <div className="rounded-2xl border border-gold/30 bg-card/70 backdrop-blur-sm p-8 shadow-gold">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex-1 min-w-[260px]">
            <p className="text-[11px] uppercase tracking-[0.25em] text-gold mb-2">Case Snapshot</p>
            <h1 className="font-serif text-4xl md:text-5xl mb-3 leading-tight">
              {snap.caseName || stored.caseName}
            </h1>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
              {snap.court && <span><span className="text-foreground/60">Court:</span> {snap.court}</span>}
              {snap.parties && <span><span className="text-foreground/60">Parties:</span> {snap.parties}</span>}
            </div>
            {snap.outcome && (
              <div className="mt-4">
                <span className="text-[11px] uppercase tracking-wider text-foreground/60">Outcome</span>
                <p className="text-base mt-0.5">{snap.outcome}</p>
              </div>
            )}
          </div>
          <div className="flex gap-2 print:hidden">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border bg-secondary hover:bg-secondary/70 text-sm transition"
            >
              <Download className="w-4 h-4" /> Download Report
            </button>
            <button
              onClick={() => navigate({ to: "/" })}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-gradient-gold text-navy-deep font-semibold text-sm hover:opacity-90 transition"
            >
              <Plus className="w-4 h-4" /> New Case
            </button>
          </div>
        </div>
        {snap.bottomLine && (
          <div className="mt-6 pt-6 border-t border-border/60">
            <p className="text-[11px] uppercase tracking-[0.25em] text-gold mb-2">Bottom Line</p>
            <p className="font-serif text-xl md:text-2xl italic leading-snug">"{snap.bottomLine}"</p>
          </div>
        )}
        {stored.truncated && (
          <div className="mt-4 flex items-start gap-2 text-xs text-warning">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>Transcript exceeded 150,000 characters and was truncated for analysis.</span>
          </div>
        )}
      </div>

      {/* What Went Well */}
      <Panel
        icon={<CheckCircle2 className="w-5 h-5" />}
        title="What Went Well"
        subtitle="Effective tactics, strong moments, and strategic wins"
        count={r.wentWell?.length ?? 0}
        accent="success"
      >
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          {r.wentWell?.map((c, i) => (
            <div
              key={i}
              className="rounded-lg bg-secondary/40 border border-border border-l-4 border-l-success p-5"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <CategoryTag>{c.category}</CategoryTag>
                <Cite>{c.cite}</Cite>
              </div>
              <h3 className="font-serif text-lg mb-1.5 leading-snug">{c.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{c.detail}</p>
            </div>
          )) || null}
        </div>
      </Panel>

      {/* What Didn't Go Well */}
      <Panel
        icon={<XCircle className="w-5 h-5" />}
        title="What Didn't Go Well"
        subtitle="Missteps, missed opportunities, and what hurt the case"
        count={r.wentPoorly?.length ?? 0}
        accent="destructive"
      >
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          {r.wentPoorly?.map((c, i) => (
            <div
              key={i}
              className="rounded-lg bg-secondary/40 border border-border border-l-4 border-l-destructive p-5"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <CategoryTag>{c.category}</CategoryTag>
                <Cite>{c.cite}</Cite>
              </div>
              <h3 className="font-serif text-lg mb-1.5 leading-snug">{c.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">{c.detail}</p>
              {c.fix && (
                <div className="mt-2 px-3 py-2 rounded bg-warning/10 border border-warning/30 text-xs text-warning leading-relaxed">
                  <span className="font-semibold uppercase tracking-wider mr-1">Fix:</span>
                  {c.fix}
                </div>
              )}
            </div>
          )) || null}
        </div>
      </Panel>

      {/* Critical Moments */}
      <Panel
        icon={<Target className="w-5 h-5" />}
        title="Critical Moments"
        subtitle="Pivotal turning points that swung the case"
        count={r.criticalMoments?.length ?? 0}
        accent="gold"
      >
        <ol className="relative mt-6 ml-3 border-l-2 border-gold/40 space-y-6">
          {r.criticalMoments?.map((m, i) => (
            <li key={i} className="pl-6 relative">
              <span className="absolute -left-[9px] top-1.5 w-4 h-4 rounded-full bg-gradient-gold border-2 border-background" />
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <Cite>{m.page}</Cite>
                <span className="text-xs text-muted-foreground">{m.parties}</span>
              </div>
              <p className="font-serif text-lg leading-snug mb-1">{m.what}</p>
              <p className="text-sm text-muted-foreground italic">{m.why}</p>
            </li>
          )) || null}
        </ol>
      </Panel>

      {/* Witnesses */}
      <Panel
        icon={<Users className="w-5 h-5" />}
        title="Witness Performance"
        subtitle="Credibility and strategic value of each witness"
        count={r.witnesses?.length ?? 0}
      >
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          {r.witnesses?.map((w, i) => (
            <div key={i} className="rounded-lg bg-secondary/40 border border-border p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 className="font-serif text-lg leading-tight">{w.name}</h3>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">
                    {w.role}
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider border ${credibilityStyle[w.credibility] ?? credibilityStyle.Mixed}`}
                >
                  {w.credibility}
                </span>
              </div>
              <div className="space-y-2.5 text-sm">
                <div>
                  <span className="text-success text-[11px] uppercase tracking-wider font-semibold">Best moment</span>
                  <p className="text-muted-foreground mt-0.5">{w.bestMoment}</p>
                </div>
                <div>
                  <span className="text-destructive text-[11px] uppercase tracking-wider font-semibold">Worst moment</span>
                  <p className="text-muted-foreground mt-0.5">{w.worstMoment}</p>
                </div>
                <div className="pt-2 border-t border-border/60">
                  <span className="text-gold text-[11px] uppercase tracking-wider font-semibold">Strategic value</span>
                  <p className="text-muted-foreground mt-0.5">{w.strategicValue}</p>
                </div>
              </div>
            </div>
          )) || null}
        </div>
      </Panel>

      {/* Objections */}
      <Panel
        icon={<Gavel className="w-5 h-5" />}
        title="Objections & Rulings"
        subtitle="Every objection logged with strategic significance"
        count={r.objections?.length ?? 0}
      >
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Party</th>
                <th className="text-left px-4 py-3 font-semibold">Grounds</th>
                <th className="text-left px-4 py-3 font-semibold">Ruling</th>
                <th className="text-left px-4 py-3 font-semibold">Significance</th>
              </tr>
            </thead>
            <tbody>
              {r.objections?.map((o, i) => (
                <tr key={i} className="border-t border-border/60 align-top">
                  <td className="px-4 py-3 font-medium">{o.party}</td>
                  <td className="px-4 py-3 text-muted-foreground">{o.grounds}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${rulingStyle(o.ruling)}`}>
                      {o.ruling}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{o.significance}</td>
                </tr>
              )) || null}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Jury Charge */}
      <Panel
        icon={<ScrollText className="w-5 h-5" />}
        title="Jury Charge Issues"
        subtitle="Disputes raised at the charge conference"
        count={r.juryChargeIssues?.length ?? 0}
      >
        <div className="space-y-4 mt-4">
          {r.juryChargeIssues?.map((j, i) => (
            <div key={i} className="rounded-lg bg-secondary/40 border border-border p-5">
              <h3 className="font-serif text-lg mb-3">{j.dispute}</h3>
              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <div className="rounded bg-card/60 border border-border p-3">
                  <p className="text-[11px] uppercase tracking-wider text-foreground/60 mb-1">Plaintiff</p>
                  <p className="text-muted-foreground">{j.plaintiffArg}</p>
                </div>
                <div className="rounded bg-card/60 border border-border p-3">
                  <p className="text-[11px] uppercase tracking-wider text-foreground/60 mb-1">Defense</p>
                  <p className="text-muted-foreground">{j.defenseArg}</p>
                </div>
              </div>
              <div className="mt-3 grid md:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-gold mb-1">Resolution</p>
                  <p>{j.resolution}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-gold mb-1">Strategic Impact</p>
                  <p className="text-muted-foreground italic">{j.impact}</p>
                </div>
              </div>
            </div>
          )) || null}
        </div>
      </Panel>

      {/* Recommendations */}
      <Panel
        icon={<Lightbulb className="w-5 h-5" />}
        title="Strategic Recommendations"
        subtitle="Direct attorney advice for retrial or appeal"
        count={r.recommendations?.length ?? 0}
        accent="gold"
      >
        <ul className="space-y-3 mt-4">
          {r.recommendations?.map((rec, i) => (
            <li
              key={i}
              className="flex gap-4 p-4 rounded-lg bg-secondary/40 border border-border border-l-4 border-l-gold"
            >
              <span className="font-serif text-2xl text-gold leading-none mt-0.5">{i + 1}.</span>
              <p className="text-sm leading-relaxed pt-1">{rec}</p>
            </li>
          )) || null}
        </ul>
      </Panel>

      <p className="text-center text-xs text-muted-foreground pt-4 flex items-center justify-center gap-1.5">
        <FileText className="w-3.5 h-3.5" /> Analysis generated by VerdictIQ &middot;{" "}
        {new Date(stored.createdAt).toLocaleString()}
      </p>
    </div>
  );
}