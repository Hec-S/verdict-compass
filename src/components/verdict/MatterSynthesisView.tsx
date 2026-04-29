import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, RefreshCw, AlertTriangle } from "lucide-react";
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
import { Cite } from "./Panel";
import type { CaseSynthesis } from "@/lib/analysis-types";
import { SYNTHESIS_SUB_CALLS, type SynthesisSubCallKey } from "@/lib/analysis-types";

/** Coerce any AI-returned value to a renderable string. */
function safeText(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => safeText(v, "")).filter(Boolean).join(" · ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

// ---------------- Label maps ----------------

const STRENGTH_LABEL: Record<CaseSynthesis["execSummary"]["caseStrength"], string> = {
  strong: "Strong",
  favorable: "Favorable",
  mixed: "Mixed",
  unfavorable: "Unfavorable",
  weak: "Weak",
};
const STRENGTH_TONE: Record<CaseSynthesis["execSummary"]["caseStrength"], string> = {
  strong: "bg-emerald-600 text-white",
  favorable: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  mixed: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  unfavorable: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  weak: "bg-red-500/15 text-red-700 dark:text-red-400",
};
const POSTURE_LABEL: Record<CaseSynthesis["execSummary"]["recommendedPosture"], string> = {
  trial: "Try the case",
  settle_low: "Settle — low",
  settle_midrange: "Settle — midrange",
  settle_high: "Settle — high",
  more_discovery: "More discovery first",
};
const THREAT_TONE: Record<"high" | "medium" | "low", string> = {
  high: "bg-red-500/15 text-red-700 dark:text-red-400",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  low: "bg-muted text-muted-foreground",
};
const PRIORITY_TONE: Record<string, string> = {
  must_file: "bg-red-500/15 text-red-700 dark:text-red-400",
  should_file: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  consider: "bg-muted text-muted-foreground",
  high: "bg-red-500/15 text-red-700 dark:text-red-400",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  low: "bg-muted text-muted-foreground",
  this_week: "bg-red-500/15 text-red-700 dark:text-red-400",
  before_trial: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center px-2 h-5 text-[11px] font-medium rounded-sm ${tone}`}
    >
      {children}
    </span>
  );
}

// ---------------- Table-of-contents config ----------------

interface TocItem {
  id: string;
  label: string;
  count?: number;
  /** Sub-call key whose failure makes this section unavailable. */
  subCall: SynthesisSubCallKey;
}

// ---------------- Section header ----------------

function SectionHeader({
  id,
  title,
  count,
}: {
  id: string;
  title: string;
  count?: number;
}) {
  return (
    <div
      id={id}
      className="scroll-mt-24 flex items-baseline justify-between gap-4 mb-5 pb-2 border-b border-border print:scroll-mt-0 print:break-before-page print:first:break-before-auto"
    >
      <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-foreground print:text-[16px]">
        {title}
      </h2>
      {typeof count === "number" && (
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {count} {count === 1 ? "item" : "items"}
        </span>
      )}
    </div>
  );
}

// ---------------- Unavailable placeholder ----------------

function UnavailableInline({
  subCallKey,
  onRerunFailed,
}: {
  subCallKey: SynthesisSubCallKey;
  onRerunFailed?: () => void;
}) {
  return (
    <div className="border border-amber-500/40 bg-amber-500/5 p-4 text-[13px] text-foreground/90 flex items-start gap-3">
      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
      <div className="flex-1">
        <p className="mb-2">
          <span className="font-medium">Section unavailable</span> — the{" "}
          <span className="font-medium">{SYNTHESIS_SUB_CALLS[subCallKey].label}</span>{" "}
          sub-call failed during synthesis.
        </p>
        {onRerunFailed && (
          <button
            type="button"
            onClick={onRerunFailed}
            className="inline-flex items-center gap-1.5 h-7 px-3 text-[12px] text-foreground border border-foreground/80 hover:bg-foreground/[0.05] transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Re-run failed sections
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------- Main view ----------------

interface Props {
  synthesis: CaseSynthesis;
  caseLabels?: Map<string, string>;
  onRerun?: () => void;
  rerunDisabled?: boolean;
  failedSubCallKeys?: string[];
  onRerunFailed?: () => void;
  /** Optional matter name shown in the sticky header. */
  matterName?: string;
  /** Status pill text (e.g. "complete", "complete_with_errors"). */
  statusLabel?: string;
  /** Last-run timestamp (ms epoch) shown in the sticky header. */
  lastRunAt?: number;
  /** When true, render inline (no sticky bar / no sidebar nav).
   *  Used by the matter overview preview. */
  embedded?: boolean;
}

export function MatterSynthesisView({
  synthesis,
  caseLabels,
  onRerun,
  rerunDisabled,
  failedSubCallKeys = [],
  onRerunFailed,
  matterName,
  statusLabel,
  lastRunAt,
  embedded = false,
}: Props) {
  const [confirmRerun, setConfirmRerun] = useState(false);
  const exec = synthesis.execSummary;
  const labelFor = (caseId: string, fallback?: string) =>
    fallback || caseLabels?.get(caseId) || caseId.slice(0, 8);

  const failed = new Set(failedSubCallKeys);
  const isFailed = (key: SynthesisSubCallKey) => failed.has(key);

  // Build TOC.
  const toc: TocItem[] = useMemo(
    () => [
      { id: "defense-theory", label: "Defense Theory & Posture", subCall: "strategicOverview" },
      {
        id: "witness-threats",
        label: "Witness Threats",
        count: synthesis.witnessThreatRanking.length,
        subCall: "witnessThreats",
      },
      { id: "bias-narrative", label: "Bias Narrative", subCall: "strategicOverview" },
      { id: "causation", label: "Causation Analysis", subCall: "causationMethodology" },
      {
        id: "motions-in-limine",
        label: "Motions in Limine",
        count: synthesis.motionsInLimine.length,
        subCall: "motionsDiscovery",
      },
      {
        id: "methodology",
        label: "Methodology Challenges",
        count: synthesis.methodologyChallenges.length,
        subCall: "causationMethodology",
      },
      {
        id: "contradictions",
        label: "Contradiction Matrix",
        count: synthesis.contradictionMatrix.length,
        subCall: "contradictionsAdmissions",
      },
      {
        id: "admissions",
        label: "Unified Admissions",
        count: synthesis.unifiedAdmissionsInventory.length,
        subCall: "contradictionsAdmissions",
      },
      {
        id: "trial-themes",
        label: "Trial Themes",
        count: synthesis.trialThemes.length,
        subCall: "strategicOverview",
      },
      {
        id: "discovery-gaps",
        label: "Discovery Gaps",
        count: synthesis.discoveryGaps.length,
        subCall: "motionsDiscovery",
      },
      {
        id: "missed",
        label: "What We Missed",
        count: synthesis.whatWeMessedUp.length,
        subCall: "retrospective",
      },
      {
        id: "next",
        label: "What To Do Next",
        count: synthesis.whatToDoNext.length,
        subCall: "retrospective",
      },
    ],
    [synthesis],
  );

  // Active section tracking via IntersectionObserver.
  const [activeId, setActiveId] = useState<string>(toc[0].id);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (embedded) return;
    const ids = toc.map((t) => t.id);
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    if (elements.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-100px 0px -60% 0px", threshold: 0 },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [toc, embedded]);

  // "Jump to top" visibility.
  const [showJumpTop, setShowJumpTop] = useState(false);
  useEffect(() => {
    if (embedded) return;
    const onScroll = () => setShowJumpTop(window.scrollY > 800);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [embedded]);

  const handleDownloadPdf = () => {
    if (typeof window !== "undefined") window.print();
  };

  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const formatRunTime = (ts: number) =>
    new Date(ts).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  // ---------- Status pill tone ----------
  const statusTone =
    statusLabel === "complete"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : statusLabel === "complete_with_errors"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : "bg-muted text-muted-foreground";

  // ---------- Sticky header ----------
  const StickyHeader = () => (
    <div className="sticky top-0 z-20 -mx-1 mb-6 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border print:hidden">
      <div className="flex items-center gap-3 px-1 py-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[15px] font-medium text-foreground truncate">
              {matterName || "Matter Synthesis"}
            </h1>
            {statusLabel && (
              <Badge tone={statusTone}>{statusLabel.replace(/_/g, " ")}</Badge>
            )}
          </div>
          {lastRunAt && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Last run: {formatRunTime(lastRunAt)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadPdf}
            className="inline-flex items-center h-8 px-3 text-[13px] text-foreground border border-border hover:bg-foreground/[0.05] transition-colors"
          >
            Download as PDF
          </button>
          {onRerun && (
            <button
              type="button"
              onClick={() => setConfirmRerun(true)}
              disabled={rerunDisabled}
              className="inline-flex items-center h-8 px-3 text-[13px] text-foreground border border-foreground/80 hover:bg-foreground/[0.05] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Re-run synthesis
            </button>
          )}
        </div>
      </div>
      {/* Mobile / tablet section dropdown */}
      <div className="lg:hidden pb-3 px-1">
        <select
          value={activeId}
          onChange={(e) => jumpTo(e.target.value)}
          className="w-full h-9 text-[13px] bg-background border border-border px-2 focus:outline-none focus:border-foreground"
          aria-label="Jump to section"
        >
          {toc.map((t) => {
            const unavailable = isFailed(t.subCall);
            return (
              <option key={t.id} value={t.id}>
                {t.label}
                {typeof t.count === "number" ? ` (${t.count})` : ""}
                {unavailable ? " — unavailable" : ""}
              </option>
            );
          })}
        </select>
      </div>
    </div>
  );

  // ---------- TOC sidebar ----------
  const TocSidebar = () => (
    <aside className="hidden lg:block w-[260px] shrink-0 print:hidden">
      <nav className="sticky top-[88px] py-2">
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-3 px-2">
          Sections
        </div>
        <ul className="space-y-0.5">
          {toc.map((t) => {
            const unavailable = isFailed(t.subCall);
            const active = activeId === t.id;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => jumpTo(t.id)}
                  className={`w-full text-left flex items-center gap-2 px-2 py-1.5 text-[13px] transition-colors border-l-2 ${
                    active
                      ? "border-foreground text-foreground bg-foreground/[0.04] font-medium"
                      : unavailable
                        ? "border-transparent text-muted-foreground/60 hover:text-muted-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]"
                  }`}
                >
                  <span className="flex-1 truncate">
                    {t.label}
                    {unavailable && (
                      <span className="ml-1 text-[11px] italic">(unavailable)</span>
                    )}
                  </span>
                  {typeof t.count === "number" && !unavailable && (
                    <span className="text-[11px] tabular-nums opacity-70">{t.count}</span>
                  )}
                  {unavailable && onRerunFailed && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRerunFailed();
                      }}
                      aria-label="Re-run failed sections"
                      title="Re-run failed sections"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </button>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );

  // ---------- Embedded mode (matter overview preview) ----------
  if (embedded) {
    return (
      <div className="synthesis-view">
        <DefenseTheorySection
          exec={exec}
          isFailed={isFailed("strategicOverview")}
          onRerunFailed={onRerunFailed}
        />
      </div>
    );
  }

  // ---------- Full report ----------
  return (
    <div ref={containerRef} className="synthesis-view">
      <StickyHeader />

      <div className="flex gap-10 print:block">
        <TocSidebar />

        <div className="flex-1 min-w-0 max-w-full lg:max-w-[820px] space-y-14 lg:space-y-16 print:space-y-8">
          {/* Defense Theory hero */}
          <section className="scroll-mt-24" id="defense-theory">
            <DefenseTheorySection
              exec={exec}
              isFailed={isFailed("strategicOverview")}
              onRerunFailed={onRerunFailed}
            />
          </section>

          {/* Witness Threats */}
          <section className="print:break-before-page">
            <SectionHeader
              id="witness-threats"
              title="Witness threat ranking"
              count={synthesis.witnessThreatRanking.length}
            />
            {isFailed("witnessThreats") ? (
              <UnavailableInline subCallKey="witnessThreats" onRerunFailed={onRerunFailed} />
            ) : synthesis.witnessThreatRanking.length === 0 ? (
              <p className="text-[14px] text-muted-foreground italic">No witnesses ranked.</p>
            ) : (
              <div className="space-y-4">
                {synthesis.witnessThreatRanking
                  .slice()
                  .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
                  .map((w, i) => {
                    const top = (w.rank ?? i + 1) === 1;
                    return (
                      <article
                        key={`${w.caseId}-${i}`}
                        className={`border p-5 print:break-inside-avoid ${
                          top
                            ? "border-foreground/40 bg-foreground/[0.02] shadow-sm"
                            : "border-border"
                        }`}
                      >
                        <div className="flex items-start gap-5">
                          <div
                            className={`shrink-0 tabular-nums text-foreground/80 ${
                              top
                                ? "text-[40px] font-semibold leading-none"
                                : "text-[28px] font-medium leading-none"
                            }`}
                          >
                            {w.rank}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <h3
                                className={`font-medium text-foreground ${
                                  top ? "text-[18px]" : "text-[16px]"
                                }`}
                              >
                                {w.deponentName}
                              </h3>
                              <Badge tone={THREAT_TONE[w.threatLevel] ?? THREAT_TONE.medium}>
                                {w.threatLevel} threat
                              </Badge>
                              <Cite>{labelFor(w.caseId, w.deponentName)}</Cite>
                            </div>
                            {w.summary && (
                              <p className="text-[15px] text-foreground/90 leading-relaxed mb-3">
                                {safeText(w.summary)}
                              </p>
                            )}
                            {w.crossPriorities && w.crossPriorities.length > 0 && (
                              <div className="mt-3">
                                <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-2">
                                  Cross priorities
                                </div>
                                <ol className="space-y-1.5 list-none">
                                  {w.crossPriorities.map((cp, j) => (
                                    <li
                                      key={j}
                                      className="text-[14px] text-foreground/90 leading-relaxed flex gap-3"
                                    >
                                      <span className="text-muted-foreground tabular-nums shrink-0">
                                        {j + 1}.
                                      </span>
                                      <span>{safeText(cp)}</span>
                                    </li>
                                  ))}
                                </ol>
                              </div>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
              </div>
            )}
          </section>

          {/* Bias Narrative */}
          <section className="print:break-before-page">
            <SectionHeader id="bias-narrative" title="Bias narrative" />
            {isFailed("strategicOverview") ? (
              <UnavailableInline subCallKey="strategicOverview" onRerunFailed={onRerunFailed} />
            ) : (
              <div className="space-y-5">
                {synthesis.biasNarrative.pipelineMap && (
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
                      Pipeline map
                    </div>
                    <p className="text-[15px] text-foreground/90 leading-relaxed">
                      {safeText(synthesis.biasNarrative.pipelineMap)}
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-2">
                      Financial relationships
                    </div>
                    <ul className="space-y-1.5">
                      {synthesis.biasNarrative.financialRelationships.length === 0 && (
                        <li className="text-[13px] text-muted-foreground italic">None identified.</li>
                      )}
                      {synthesis.biasNarrative.financialRelationships.map((c, i) => (
                        <li key={i} className="text-[14px] text-foreground/90 flex gap-2 leading-relaxed">
                          <span className="text-muted-foreground">›</span>
                          <span>{safeText(c)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-2">
                      Repeat-player patterns
                    </div>
                    <ul className="space-y-1.5">
                      {synthesis.biasNarrative.repeatPlayerPatterns.length === 0 && (
                        <li className="text-[13px] text-muted-foreground italic">None identified.</li>
                      )}
                      {synthesis.biasNarrative.repeatPlayerPatterns.map((c, i) => (
                        <li key={i} className="text-[14px] text-foreground/90 flex gap-2 leading-relaxed">
                          <span className="text-muted-foreground">›</span>
                          <span>{safeText(c)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                {synthesis.biasNarrative.trialNarrative && (
                  <div className="border-l-2 border-foreground pl-4 py-1">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1">
                      Trial narrative
                    </div>
                    <p className="text-[15px] text-foreground leading-relaxed">
                      {safeText(synthesis.biasNarrative.trialNarrative)}
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Causation Analysis */}
          <section className="print:break-before-page">
            <SectionHeader id="causation" title="Causation analysis" />
            {isFailed("causationMethodology") ? (
              <UnavailableInline
                subCallKey="causationMethodology"
                onRerunFailed={onRerunFailed}
              />
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-border p-4">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-2">
                      Baseline conditions
                    </div>
                    <ul className="space-y-1.5">
                      {synthesis.causationAnalysis.baselineConditions.length === 0 && (
                        <li className="text-[13px] text-muted-foreground italic">None identified.</li>
                      )}
                      {synthesis.causationAnalysis.baselineConditions.map((c, i) => (
                        <li key={i} className="text-[14px] text-foreground/90 flex gap-2 leading-relaxed">
                          <span className="text-muted-foreground">›</span>
                          <span>{safeText(c)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="border border-border p-4">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-2">
                      Prior accident sequelae
                    </div>
                    <ul className="space-y-1.5">
                      {synthesis.causationAnalysis.priorAccidentSequelae.length === 0 && (
                        <li className="text-[13px] text-muted-foreground italic">None identified.</li>
                      )}
                      {synthesis.causationAnalysis.priorAccidentSequelae.map((c, i) => (
                        <li key={i} className="text-[14px] text-foreground/90 flex gap-2 leading-relaxed">
                          <span className="text-muted-foreground">›</span>
                          <span>{safeText(c)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                {synthesis.causationAnalysis.accidentMechanism && (
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
                      Accident mechanism
                    </div>
                    <p className="text-[15px] text-foreground/90 leading-relaxed">
                      {safeText(synthesis.causationAnalysis.accidentMechanism)}
                    </p>
                  </div>
                )}
                {synthesis.causationAnalysis.apportionmentArguments.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-2">
                      Apportionment arguments
                    </div>
                    <ol className="space-y-2.5 list-none">
                      {synthesis.causationAnalysis.apportionmentArguments.map((a, i) => (
                        <li key={i} className="text-[15px] text-foreground/90 flex gap-3 leading-relaxed">
                          <span className="text-muted-foreground tabular-nums shrink-0">{i + 1}.</span>
                          <span>{safeText(a)}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {synthesis.causationAnalysis.weakestCausationLink && (
                  <div className="border-l-4 border-foreground bg-foreground/[0.03] pl-4 pr-4 py-3">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
                      Weakest causation link
                    </div>
                    <p className="text-[15px] text-foreground leading-relaxed font-medium">
                      {safeText(synthesis.causationAnalysis.weakestCausationLink)}
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Motions in Limine */}
          <section className="print:break-before-page">
            <SectionHeader
              id="motions-in-limine"
              title="Motions in limine"
              count={synthesis.motionsInLimine.length}
            />
            {isFailed("motionsDiscovery") ? (
              <UnavailableInline subCallKey="motionsDiscovery" onRerunFailed={onRerunFailed} />
            ) : synthesis.motionsInLimine.length === 0 ? (
              <p className="text-[14px] text-muted-foreground italic">None recommended.</p>
            ) : (
              <div className="space-y-3">
                {synthesis.motionsInLimine.map((m, i) => (
                  <article
                    key={i}
                    className="border border-border p-4 print:break-inside-avoid"
                  >
                    <div className="flex items-start gap-2 mb-2 flex-wrap">
                      <h3 className="flex-1 text-[15px] font-medium text-foreground">
                        {safeText(m.motion)}
                      </h3>
                      <Badge tone={PRIORITY_TONE[m.priority] ?? PRIORITY_TONE.consider}>
                        {m.priority.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <p className="text-[15px] text-foreground/90 leading-relaxed">
                      {safeText(m.basis)}
                    </p>
                    {m.supportingCites && m.supportingCites.length > 0 && (
                      <pre className="mt-3 p-2 bg-muted/40 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-words border border-border/50">
                        {m.supportingCites.map((c) => safeText(c)).join("\n")}
                      </pre>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Methodology Challenges */}
          <section className="print:break-before-page">
            <SectionHeader
              id="methodology"
              title="Methodology challenges"
              count={synthesis.methodologyChallenges.length}
            />
            {isFailed("causationMethodology") ? (
              <UnavailableInline
                subCallKey="causationMethodology"
                onRerunFailed={onRerunFailed}
              />
            ) : synthesis.methodologyChallenges.length === 0 ? (
              <p className="text-[14px] text-muted-foreground italic">None identified.</p>
            ) : (
              <div className="space-y-3">
                {synthesis.methodologyChallenges.map((m, i) => (
                  <article key={i} className="border border-border p-4 print:break-inside-avoid">
                    <div className="flex items-start gap-2 mb-2 flex-wrap">
                      <span className="text-[15px] font-medium text-foreground">
                        {safeText(m.targetWitness)}
                      </span>
                      <Badge tone="bg-foreground/10 text-foreground">{m.motionType}</Badge>
                      <Cite>{labelFor(m.caseId, m.targetWitness)}</Cite>
                    </div>
                    <p className="text-[15px] text-foreground/90 leading-relaxed">
                      {safeText(m.basis)}
                    </p>
                    {m.supportingCites && m.supportingCites.length > 0 && (
                      <pre className="mt-3 p-2 bg-muted/40 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-words border border-border/50">
                        {m.supportingCites.map((c) => safeText(c)).join("\n")}
                      </pre>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Contradiction Matrix */}
          <section className="print:break-before-page">
            <SectionHeader
              id="contradictions"
              title="Contradiction matrix"
              count={synthesis.contradictionMatrix.length}
            />
            {isFailed("contradictionsAdmissions") ? (
              <UnavailableInline
                subCallKey="contradictionsAdmissions"
                onRerunFailed={onRerunFailed}
              />
            ) : synthesis.contradictionMatrix.length === 0 ? (
              <p className="text-[14px] text-muted-foreground italic">No contradictions identified.</p>
            ) : (
              <div className="space-y-4">
                {synthesis.contradictionMatrix.map((row, i) => (
                  <article key={i} className="border border-border p-4 print:break-inside-avoid">
                    <div className="flex items-start gap-2 mb-3 flex-wrap">
                      <h3 className="flex-1 text-[15px] font-medium text-foreground">
                        {safeText(row.topic)}
                      </h3>
                      <Badge tone={THREAT_TONE[row.exploitability] ?? THREAT_TONE.medium}>
                        {row.exploitability} exploitability
                      </Badge>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px] border-collapse">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-2 pr-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-medium">
                              Witness
                            </th>
                            <th className="text-left py-2 pr-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-medium">
                              Position
                            </th>
                            <th className="text-left py-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-medium">
                              Cite
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {row.witnesses.map((w, j) => (
                            <tr key={j} className="border-b border-border/60 last:border-0 align-top">
                              <td className="py-2 pr-3 font-medium text-foreground whitespace-nowrap">
                                {safeText(w.deponentName)}
                              </td>
                              <td className="py-2 pr-3 text-foreground/90 leading-relaxed">
                                {safeText(w.position)}
                              </td>
                              <td className="py-2 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                                {safeText(w.cite)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {row.defenseUse && (
                      <p className="text-[14px] text-foreground/90 mt-3 leading-relaxed">
                        <span className="text-muted-foreground">Defense use: </span>
                        {safeText(row.defenseUse)}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Unified Admissions Inventory */}
          <section className="print:break-before-page">
            <SectionHeader
              id="admissions"
              title="Unified admissions inventory"
              count={synthesis.unifiedAdmissionsInventory.length}
            />
            {isFailed("contradictionsAdmissions") ? (
              <UnavailableInline
                subCallKey="contradictionsAdmissions"
                onRerunFailed={onRerunFailed}
              />
            ) : synthesis.unifiedAdmissionsInventory.length === 0 ? (
              <p className="text-[14px] text-muted-foreground italic">No admissions inventoried.</p>
            ) : (
              <div className="space-y-4">
                {synthesis.unifiedAdmissionsInventory.map((row, i) => (
                  <article key={i} className="border border-border p-4 print:break-inside-avoid">
                    <h3 className="text-[15px] font-medium text-foreground mb-3">
                      {safeText(row.topic)}
                    </h3>
                    <ul className="space-y-2 mb-3">
                      {row.admissions.map((a, j) => (
                        <li key={j} className="text-[14px] leading-relaxed">
                          <span className="font-medium text-foreground">
                            {safeText(a.deponentName)}:
                          </span>{" "}
                          <span className="text-foreground/90">{safeText(a.admission)}</span>
                          {a.cite && <Cite>{safeText(a.cite)}</Cite>}
                        </li>
                      ))}
                    </ul>
                    {row.trialUse && (
                      <p className="text-[14px] text-foreground/90 leading-relaxed">
                        <span className="text-muted-foreground">Trial use: </span>
                        {safeText(row.trialUse)}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Trial Themes */}
          <section className="print:break-before-page">
            <SectionHeader
              id="trial-themes"
              title="Trial themes"
              count={synthesis.trialThemes.length}
            />
            {isFailed("strategicOverview") ? (
              <UnavailableInline subCallKey="strategicOverview" onRerunFailed={onRerunFailed} />
            ) : synthesis.trialThemes.length === 0 ? (
              <p className="text-[14px] text-muted-foreground italic">No themes identified.</p>
            ) : (
              <div className="space-y-4">
                {synthesis.trialThemes.map((t, i) => (
                  <article key={i} className="border border-border p-4 print:break-inside-avoid">
                    <h3 className="text-[16px] font-medium text-foreground mb-3">
                      {safeText(t.theme)}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
                          Supporting witnesses
                        </div>
                        <ul className="space-y-1">
                          {t.supportingWitnesses.map((w, j) => (
                            <li key={j} className="text-[14px] text-foreground/90 leading-relaxed">
                              · {safeText(w)}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
                          Supporting facts
                        </div>
                        <ul className="space-y-1">
                          {t.supportingFacts.map((f, j) => (
                            <li key={j} className="text-[14px] text-foreground/90 leading-relaxed">
                              · {safeText(f)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    {t.voirDireAngle && (
                      <p className="mt-3 text-[14px] text-foreground/90 leading-relaxed">
                        <span className="text-muted-foreground">Voir dire angle: </span>
                        {safeText(t.voirDireAngle)}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Discovery Gaps */}
          <section className="print:break-before-page">
            <SectionHeader
              id="discovery-gaps"
              title="Discovery gaps"
              count={synthesis.discoveryGaps.length}
            />
            {isFailed("motionsDiscovery") ? (
              <UnavailableInline subCallKey="motionsDiscovery" onRerunFailed={onRerunFailed} />
            ) : synthesis.discoveryGaps.length === 0 ? (
              <p className="text-[14px] text-muted-foreground italic">No gaps identified.</p>
            ) : (
              <div className="space-y-3">
                {synthesis.discoveryGaps.map((g, i) => (
                  <article key={i} className="border border-border p-4 print:break-inside-avoid">
                    <div className="flex items-start gap-2 mb-2 flex-wrap">
                      <h3 className="flex-1 text-[15px] font-medium text-foreground">
                        {safeText(g.gap)}
                      </h3>
                      <Badge tone={PRIORITY_TONE[g.priority] ?? PRIORITY_TONE.medium}>
                        {g.priority}
                      </Badge>
                    </div>
                    {g.impact && (
                      <p className="text-[14px] text-foreground/90 leading-relaxed">
                        <span className="text-muted-foreground">Impact: </span>
                        {safeText(g.impact)}
                      </p>
                    )}
                    {g.recommendedAction && (
                      <p className="text-[14px] text-foreground/90 leading-relaxed mt-1.5">
                        <span className="text-muted-foreground">Action: </span>
                        {safeText(g.recommendedAction)}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* What We Missed */}
          <section className="print:break-before-page">
            <SectionHeader
              id="missed"
              title="What we missed"
              count={synthesis.whatWeMessedUp.length}
            />
            {isFailed("retrospective") ? (
              <UnavailableInline subCallKey="retrospective" onRerunFailed={onRerunFailed} />
            ) : synthesis.whatWeMessedUp.length === 0 ? (
              <p className="text-[14px] text-muted-foreground italic">Nothing flagged.</p>
            ) : (
              <div className="space-y-3">
                {synthesis.whatWeMessedUp.map((m, i) => (
                  <article
                    key={i}
                    className="border border-border p-4 print:break-inside-avoid relative"
                  >
                    {m.canStillFix && (
                      <span className="absolute top-3 right-3">
                        <Badge tone="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                          Can still fix
                        </Badge>
                      </span>
                    )}
                    <h3 className="text-[15px] font-medium text-foreground mb-3 pr-24">
                      {safeText(m.deposition)}
                    </h3>
                    <div className="space-y-2.5">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-0.5">
                          Missed
                        </div>
                        <p className="text-[14px] text-foreground/90 leading-relaxed">
                          {safeText(m.missedOpportunity)}
                        </p>
                      </div>
                      {m.wouldHaveHelped && (
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-0.5">
                            Would have helped
                          </div>
                          <p className="text-[14px] text-foreground/90 leading-relaxed">
                            {safeText(m.wouldHaveHelped)}
                          </p>
                        </div>
                      )}
                      {m.canStillFix && m.fixAction && (
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-0.5">
                            Fix
                          </div>
                          <p className="text-[14px] text-foreground leading-relaxed">
                            {safeText(m.fixAction)}
                          </p>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* What To Do Next */}
          <section className="print:break-before-page">
            <SectionHeader
              id="next"
              title="What to do next"
              count={synthesis.whatToDoNext.length}
            />
            {isFailed("retrospective") ? (
              <UnavailableInline subCallKey="retrospective" onRerunFailed={onRerunFailed} />
            ) : synthesis.whatToDoNext.length === 0 ? (
              <p className="text-[14px] text-muted-foreground italic">No actions queued.</p>
            ) : (
              <NextActions actions={synthesis.whatToDoNext} />
            )}
          </section>
        </div>
      </div>

      {/* Jump to top */}
      {showJumpTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Jump to top"
          className="fixed bottom-6 right-6 z-30 inline-flex items-center justify-center w-10 h-10 bg-foreground text-background hover:opacity-90 shadow-lg print:hidden"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      )}

      <AlertDialog open={confirmRerun} onOpenChange={setConfirmRerun}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-run synthesis?</AlertDialogTitle>
            <AlertDialogDescription>
              This starts a new synthesis run across every case in this matter.
              Existing deposition cards are reused unless their underlying analysis
              changed. The current report stays available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRerun(false);
                onRerun?.();
              }}
            >
              Re-run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------- Defense Theory hero ----------------

function DefenseTheorySection({
  exec,
  isFailed,
  onRerunFailed,
}: {
  exec: CaseSynthesis["execSummary"];
  isFailed: boolean;
  onRerunFailed?: () => void;
}) {
  if (isFailed) {
    return (
      <div>
        <SectionHeader id="defense-theory-header" title="Defense theory & posture" />
        <UnavailableInline subCallKey="strategicOverview" onRerunFailed={onRerunFailed} />
      </div>
    );
  }
  return (
    <div className="border border-border p-6 lg:p-8 print:p-0 print:border-0">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-3">
        Defense theory
      </div>
      <p className="text-[19px] leading-[1.55] font-normal text-foreground mb-8 max-w-[68ch] print:text-[14px]">
        {safeText(exec.defenseTheory) || "No defense theory produced."}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 print:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-2">
            Case strength
          </div>
          <div className="flex items-start gap-3 flex-wrap">
            <Badge tone={STRENGTH_TONE[exec.caseStrength]}>
              {STRENGTH_LABEL[exec.caseStrength]}
            </Badge>
            {exec.strengthRationale && (
              <p className="text-[14px] text-foreground/85 leading-relaxed flex-1 min-w-[200px]">
                {safeText(exec.strengthRationale)}
              </p>
            )}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-2">
            Recommended posture
          </div>
          <div className="flex items-start gap-3 flex-wrap">
            <Badge tone="bg-foreground text-background">
              {POSTURE_LABEL[exec.recommendedPosture]}
            </Badge>
            {exec.postureRationale && (
              <p className="text-[14px] text-foreground/85 leading-relaxed flex-1 min-w-[200px]">
                {safeText(exec.postureRationale)}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-2">
            Top threats
          </div>
          <ul className="space-y-2">
            {exec.topThreats.length === 0 && (
              <li className="text-[13px] text-muted-foreground italic">None identified.</li>
            )}
            {exec.topThreats.map((t, i) => {
              const text = safeText(t);
              const words = text.split(/\s+/);
              const title = words.slice(0, 9).join(" ") + (words.length > 9 ? "…" : "");
              return (
                <li
                  key={i}
                  className="border border-red-500/25 bg-red-500/[0.04] p-3"
                >
                  <div className="flex gap-2.5">
                    <span className="text-red-700 dark:text-red-400 font-medium tabular-nums shrink-0 text-[13px]">
                      {i + 1}.
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-medium text-foreground mb-0.5 leading-snug">
                        {title}
                      </div>
                      <div className="text-[14px] text-foreground/85 leading-relaxed">
                        {text}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-2">
            Top opportunities
          </div>
          <ul className="space-y-2">
            {exec.topOpportunities.length === 0 && (
              <li className="text-[13px] text-muted-foreground italic">None identified.</li>
            )}
            {exec.topOpportunities.map((t, i) => {
              const text = safeText(t);
              const words = text.split(/\s+/);
              const title = words.slice(0, 9).join(" ") + (words.length > 9 ? "…" : "");
              return (
                <li
                  key={i}
                  className="border border-emerald-500/25 bg-emerald-500/[0.04] p-3"
                >
                  <div className="flex gap-2.5">
                    <span className="text-emerald-700 dark:text-emerald-400 font-medium tabular-nums shrink-0 text-[13px]">
                      {i + 1}.
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-medium text-foreground mb-0.5 leading-snug">
                        {title}
                      </div>
                      <div className="text-[14px] text-foreground/85 leading-relaxed">
                        {text}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ---------------- What To Do Next: grouped by priority ----------------

function NextActions({
  actions,
}: {
  actions: CaseSynthesis["whatToDoNext"];
}) {
  const groups: Array<{
    key: "this_week" | "before_trial" | "consider";
    label: string;
    tone: string;
    accent: string;
  }> = [
    {
      key: "this_week",
      label: "This week",
      tone: "bg-red-500/15 text-red-700 dark:text-red-400",
      accent: "border-red-500/40",
    },
    {
      key: "before_trial",
      label: "Before trial",
      tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
      accent: "border-amber-500/40",
    },
    {
      key: "consider",
      label: "Consider",
      tone: "bg-muted text-muted-foreground",
      accent: "border-border",
    },
  ];
  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const items = actions.filter((a) => a.priority === g.key);
        if (items.length === 0) return null;
        return (
          <div key={g.key}>
            <div className="flex items-center gap-2 mb-3">
              <Badge tone={g.tone}>{g.label}</Badge>
              <span className="text-[12px] text-muted-foreground tabular-nums">
                {items.length}
              </span>
            </div>
            <ul className="space-y-2">
              {items.map((a, i) => (
                <li
                  key={i}
                  className={`border-l-2 ${g.accent} pl-3 py-1 print:break-inside-avoid`}
                >
                  <p className="text-[15px] font-medium text-foreground leading-snug">
                    {safeText(a.action)}
                  </p>
                  {a.rationale && (
                    <p className="text-[14px] text-foreground/80 leading-relaxed mt-1">
                      {safeText(a.rationale)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
