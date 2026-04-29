import { useMemo, useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
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

/** Width-constrained container for tab content. */
function TabContainer({
  width = "narrow",
  children,
}: {
  width?: "narrow" | "wide";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`mx-auto w-full ${
        width === "wide" ? "max-w-[1040px]" : "max-w-[760px]"
      }`}
    >
      {children}
    </div>
  );
}

/** Small uppercase muted section label. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground font-medium">
      {children}
    </div>
  );
}

/** Larger pill/badge used for headline status (case strength, posture). */
function HeadlinePill({
  tone,
  size = "default",
  children,
}: {
  tone: string;
  size?: "default" | "lg";
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ${
        size === "lg"
          ? "px-4 h-8 text-[13px]"
          : "px-3 h-7 text-[12px]"
      } ${tone}`}
    >
      {children}
    </span>
  );
}

// ---------------- Tab config ----------------

export type SynthesisTabId =
  | "overview"
  | "witnesses"
  | "causation"
  | "motions"
  | "methodology"
  | "contradictions"
  | "admissions"
  | "bias"
  | "themes"
  | "discovery"
  | "missed"
  | "next";

interface TabDef {
  id: SynthesisTabId;
  label: string;
  count?: number;
  unavailableLabel?: string;
  subCall: SynthesisSubCallKey;
}

// ---------------- Unavailable placeholder ----------------

function UnavailableInline({
  subCallKey,
  onRerunFailed,
  block = false,
}: {
  subCallKey: SynthesisSubCallKey;
  onRerunFailed?: () => void;
  block?: boolean;
}) {
  return (
    <div
      className={`border border-amber-500/40 bg-amber-500/5 p-${block ? 6 : 4} text-[14px] text-foreground/90 flex items-start gap-3`}
    >
      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
      <div className="flex-1">
        <p className="mb-3">
          <span className="font-medium">This section could not be generated.</span>{" "}
          The <span className="font-medium">{SYNTHESIS_SUB_CALLS[subCallKey].label}</span>{" "}
          sub-call failed during synthesis. Click "Re-run failed sections" to retry.
        </p>
        {onRerunFailed && (
          <button
            type="button"
            onClick={onRerunFailed}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-[13px] text-foreground border border-foreground/80 hover:bg-foreground/[0.05] transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Re-run failed sections
          </button>
        )}
      </div>
    </div>
  );
}

function TabSectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 mb-6 pb-3 border-b border-border">
      <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-foreground">
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

// ---------------- Main view ----------------

interface Props {
  synthesis: CaseSynthesis;
  caseLabels?: Map<string, string>;
  onRerun?: () => void;
  rerunDisabled?: boolean;
  failedSubCallKeys?: string[];
  onRerunFailed?: () => void;
  matterName?: string;
  statusLabel?: string;
  lastRunAt?: number;
  embedded?: boolean;
  /** Controlled active tab. If omitted, uses internal state. */
  activeTab?: SynthesisTabId;
  onTabChange?: (tab: SynthesisTabId) => void;
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
  activeTab,
  onTabChange,
}: Props) {
  const [confirmRerun, setConfirmRerun] = useState(false);
  const exec = synthesis.execSummary;
  const labelFor = (caseId: string, fallback?: string) =>
    fallback || caseLabels?.get(caseId) || caseId.slice(0, 8);

  const failed = new Set(failedSubCallKeys);
  const isFailed = (key: SynthesisSubCallKey) => failed.has(key);

  const tabs: TabDef[] = useMemo(() => {
    const contradictionsFailed = failed.has("contradictionsAdmissions");
    return [
      { id: "overview", label: "Overview", subCall: "strategicOverview" },
      {
        id: "witnesses",
        label: "Witnesses",
        count: synthesis.witnessThreatRanking.length,
        subCall: "witnessThreats",
      },
      { id: "causation", label: "Causation", subCall: "causationMethodology" },
      {
        id: "motions",
        label: "Motions",
        count: synthesis.motionsInLimine.length,
        subCall: "motionsDiscovery",
      },
      {
        id: "methodology",
        label: "Methodology",
        count: synthesis.methodologyChallenges.length,
        subCall: "causationMethodology",
      },
      {
        id: "contradictions",
        label: "Contradictions",
        count: contradictionsFailed ? undefined : synthesis.contradictionMatrix.length,
        unavailableLabel: contradictionsFailed ? "unavailable" : undefined,
        subCall: "contradictionsAdmissions",
      },
      {
        id: "admissions",
        label: "Admissions",
        count: contradictionsFailed
          ? undefined
          : synthesis.unifiedAdmissionsInventory.length,
        unavailableLabel: contradictionsFailed ? "unavailable" : undefined,
        subCall: "contradictionsAdmissions",
      },
      { id: "bias", label: "Bias Narrative", subCall: "strategicOverview" },
      {
        id: "themes",
        label: "Trial Themes",
        count: synthesis.trialThemes.length,
        subCall: "strategicOverview",
      },
      {
        id: "discovery",
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
    ];
  }, [synthesis, failed]);

  const [internalTab, setInternalTab] = useState<SynthesisTabId>("overview");
  const currentTab = activeTab ?? internalTab;
  const setTab = (id: SynthesisTabId) => {
    if (onTabChange) onTabChange(id);
    else setInternalTab(id);
  };

  const handleDownloadPdf = () => {
    if (typeof window !== "undefined") window.print();
  };

  const formatRunTime = (ts: number) =>
    new Date(ts).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  const statusTone =
    statusLabel === "complete"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : statusLabel === "complete_with_errors"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : "bg-muted text-muted-foreground";

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

  // ---------- Tab content renderers ----------
  const renderTab = (id: SynthesisTabId) => {
    switch (id) {
      case "overview":
        return (
          <OverviewTab
            exec={exec}
            isFailed={isFailed("strategicOverview")}
            onRerunFailed={onRerunFailed}
          />
        );
      case "witnesses":
        return (
          <WitnessesTab
            data={synthesis.witnessThreatRanking}
            isFailed={isFailed("witnessThreats")}
            onRerunFailed={onRerunFailed}
            labelFor={labelFor}
          />
        );
      case "causation":
        return (
          <CausationTab
            data={synthesis.causationAnalysis}
            isFailed={isFailed("causationMethodology")}
            onRerunFailed={onRerunFailed}
          />
        );
      case "motions":
        return (
          <MotionsTab
            data={synthesis.motionsInLimine}
            isFailed={isFailed("motionsDiscovery")}
            onRerunFailed={onRerunFailed}
          />
        );
      case "methodology":
        return (
          <MethodologyTab
            data={synthesis.methodologyChallenges}
            isFailed={isFailed("causationMethodology")}
            onRerunFailed={onRerunFailed}
            labelFor={labelFor}
          />
        );
      case "contradictions":
        return (
          <ContradictionsTab
            data={synthesis.contradictionMatrix}
            isFailed={isFailed("contradictionsAdmissions")}
            onRerunFailed={onRerunFailed}
          />
        );
      case "admissions":
        return (
          <AdmissionsTab
            data={synthesis.unifiedAdmissionsInventory}
            isFailed={isFailed("contradictionsAdmissions")}
            onRerunFailed={onRerunFailed}
          />
        );
      case "bias":
        return (
          <BiasTab
            data={synthesis.biasNarrative}
            isFailed={isFailed("strategicOverview")}
            onRerunFailed={onRerunFailed}
          />
        );
      case "themes":
        return (
          <ThemesTab
            data={synthesis.trialThemes}
            isFailed={isFailed("strategicOverview")}
            onRerunFailed={onRerunFailed}
          />
        );
      case "discovery":
        return (
          <DiscoveryGapsTab
            data={synthesis.discoveryGaps}
            isFailed={isFailed("motionsDiscovery")}
            onRerunFailed={onRerunFailed}
          />
        );
      case "missed":
        return (
          <MissedTab
            data={synthesis.whatWeMessedUp}
            isFailed={isFailed("retrospective")}
            onRerunFailed={onRerunFailed}
          />
        );
      case "next":
        return (
          <NextTab
            data={synthesis.whatToDoNext}
            isFailed={isFailed("retrospective")}
            onRerunFailed={onRerunFailed}
          />
        );
    }
  };

  const tabLabelFor = (id: SynthesisTabId) =>
    tabs.find((t) => t.id === id)?.label ?? id;

  return (
    <div className="synthesis-view">
      {/* Top header bar */}
      <header className="border-b border-border bg-background/95 sticky top-0 z-20 backdrop-blur supports-[backdrop-filter]:bg-background/85 print:hidden">
        <div className="flex items-center gap-4 px-1 py-3 flex-wrap min-h-[64px]">
          <div className="flex-1 min-w-0">
            <h1 className="text-[15px] font-medium text-foreground truncate">
              {matterName || "Matter Synthesis"}
            </h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {lastRunAt ? `Last run: ${formatRunTime(lastRunAt)}` : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {statusLabel && (
              <Badge tone={statusTone}>{statusLabel.replace(/_/g, " ")}</Badge>
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

        {/* Tab strip — desktop */}
        <div className="hidden md:block">
          <div className="flex items-center gap-1 overflow-x-auto -mx-1 px-1 scrollbar-thin">
            {tabs.map((t) => {
              const unavailable = isFailed(t.subCall);
              const active = currentTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`relative shrink-0 inline-flex items-center gap-1.5 px-3 h-10 text-[13px] transition-colors border-b-2 ${
                    active
                      ? "border-foreground text-foreground font-medium"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span>{t.label}</span>
                  {unavailable ? (
                    <span className="text-[11px] italic text-muted-foreground/70">
                      unavailable
                    </span>
                  ) : typeof t.count === "number" ? (
                    <span
                      className={`text-[11px] tabular-nums ${
                        t.count === 0 ? "text-muted-foreground/50" : "text-muted-foreground"
                      }`}
                    >
                      {t.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab strip — mobile dropdown */}
        <div className="md:hidden pb-3">
          <select
            value={currentTab}
            onChange={(e) => setTab(e.target.value as SynthesisTabId)}
            className="w-full h-9 text-[13px] bg-background border border-border px-2 focus:outline-none focus:border-foreground"
            aria-label="Select section"
          >
            {tabs.map((t) => {
              const unavailable = isFailed(t.subCall);
              return (
                <option key={t.id} value={t.id}>
                  {t.label}
                  {typeof t.count === "number" && !unavailable ? ` (${t.count})` : ""}
                  {unavailable ? " — unavailable" : ""}
                </option>
              );
            })}
          </select>
        </div>
      </header>

      {/* Active tab content (screen) */}
      <main className="print:hidden">
        <div className="px-6 py-12">
          <div key={currentTab}>{renderTab(currentTab)}</div>
        </div>
      </main>

      {/* Print: render every tab sequentially */}
      <div className="hidden print:block">
        {tabs.map((t) => (
          <section
            key={t.id}
            className="break-before-page first:break-before-auto py-6"
          >
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-2">
              {tabLabelFor(t.id)}
            </div>
            {renderTab(t.id)}
          </section>
        ))}
      </div>

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

// ============================================================
// Tab components
// ============================================================

function OverviewTab({
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
      <TabContainer>
        <UnavailableInline subCallKey="strategicOverview" onRerunFailed={onRerunFailed} block />
      </TabContainer>
    );
  }

  const STRENGTH_HEADLINE_TONE: Record<
    CaseSynthesis["execSummary"]["caseStrength"],
    string
  > = {
    strong: "bg-emerald-600 text-white",
    favorable: "bg-emerald-600 text-white",
    mixed: "bg-amber-500 text-white",
    unfavorable: "bg-orange-600 text-white",
    weak: "bg-red-600 text-white",
  };

  return (
    <>
      {/* Single-column upper sections */}
      <TabContainer>
        {/* Defense theory */}
        <section>
          <SectionLabel>Defense theory</SectionLabel>
          <p className="mt-4 text-[18px] leading-[1.6] text-foreground">
            {safeText(exec.defenseTheory) || "No defense theory produced."}
          </p>
        </section>

        {/* Case strength */}
        <section className="mt-16">
          <SectionLabel>Case strength</SectionLabel>
          <div className="mt-4">
            <HeadlinePill
              tone={STRENGTH_HEADLINE_TONE[exec.caseStrength]}
              size="default"
            >
              {STRENGTH_LABEL[exec.caseStrength]}
            </HeadlinePill>
          </div>
          {exec.strengthRationale && (
            <p className="mt-4 text-[16px] leading-[1.6] text-foreground">
              {safeText(exec.strengthRationale)}
            </p>
          )}
        </section>

        {/* Recommended posture */}
        <section className="mt-16">
          <SectionLabel>Recommended posture</SectionLabel>
          <div className="mt-4">
            <HeadlinePill tone="bg-foreground text-background" size="lg">
              {POSTURE_LABEL[exec.recommendedPosture]}
            </HeadlinePill>
          </div>
          {exec.postureRationale && (
            <p className="mt-4 text-[16px] leading-[1.6] text-foreground">
              {safeText(exec.postureRationale)}
            </p>
          )}
        </section>
      </TabContainer>

      {/* Two-column threats / opportunities — wider container */}
      <TabContainer width="wide">
        <div className="mt-16 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-12">
          <NumberedEditorialList
            label="Top threats"
            items={exec.topThreats.map((t) => safeText(t))}
            emptyText="None identified."
          />
          <NumberedEditorialList
            label="Top opportunities"
            items={exec.topOpportunities.map((t) => safeText(t))}
            emptyText="None identified."
          />
        </div>
      </TabContainer>
    </>
  );
}

/**
 * Clean numbered editorial list — large muted number + headline first
 * sentence + explanation. Items separated by a 1px divider.
 */
function NumberedEditorialList({
  label,
  items,
  emptyText,
}: {
  label: string;
  items: string[];
  emptyText: string;
}) {
  if (items.length === 0) {
    return (
      <div>
        <SectionLabel>{label}</SectionLabel>
        <p className="mt-4 text-[14px] text-muted-foreground italic">{emptyText}</p>
      </div>
    );
  }
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <ol className="mt-4">
        {items.map((text, i) => {
          const last = i === items.length - 1;
          // Split into headline (first sentence/clause) + remainder.
          const match = text.match(/^([^.!?—–-]+[.!?]?)(\s+)([\s\S]*)$/);
          const headline = match ? match[1].trim() : text;
          const remainder = match ? match[3].trim() : "";
          return (
            <li
              key={i}
              className={`flex gap-5 pb-6 ${last ? "" : "mb-6 border-b border-border"}`}
            >
              <span className="text-[24px] leading-[1.2] tabular-nums text-muted-foreground shrink-0 w-8">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0 text-[15px] leading-[1.5] text-foreground">
                <span className="font-medium">{headline}</span>
                {remainder ? <span className="text-foreground/85"> {remainder}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Kept for the embedded preview on the matter overview page.
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
    return <UnavailableInline subCallKey="strategicOverview" onRerunFailed={onRerunFailed} />;
  }
  return (
    <div className="border border-border p-6">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-3">
        Defense theory
      </div>
      <p className="text-[18px] leading-[1.55] text-foreground mb-6 max-w-[68ch]">
        {safeText(exec.defenseTheory) || "No defense theory produced."}
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <Badge tone={STRENGTH_TONE[exec.caseStrength]}>
          {STRENGTH_LABEL[exec.caseStrength]}
        </Badge>
        <Badge tone="bg-foreground text-background">
          {POSTURE_LABEL[exec.recommendedPosture]}
        </Badge>
      </div>
    </div>
  );
}

function WitnessesTab({
  data,
  isFailed,
  onRerunFailed,
  labelFor,
}: {
  data: CaseSynthesis["witnessThreatRanking"];
  isFailed: boolean;
  onRerunFailed?: () => void;
  labelFor: (caseId: string, fallback?: string) => string;
}) {
  const [filter, setFilter] = useState<"all" | "high" | "medium" | "low">("all");

  if (isFailed) {
    return (
      <TabContainer>
        <TabSectionHeader title="Witness threat ranking" />
        <UnavailableInline subCallKey="witnessThreats" onRerunFailed={onRerunFailed} block />
      </TabContainer>
    );
  }

  const sorted = data.slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const filtered =
    filter === "all" ? sorted : sorted.filter((w) => w.threatLevel === filter);

  const filters: Array<{ id: typeof filter; label: string }> = [
    { id: "all", label: "All" },
    { id: "high", label: "High threat" },
    { id: "medium", label: "Medium threat" },
    { id: "low", label: "Low threat" },
  ];

  return (
    <TabContainer>
      <TabSectionHeader title="Witness threat ranking" count={data.length} />
      {data.length === 0 ? (
        <p className="text-[14px] text-muted-foreground italic">No witnesses ranked.</p>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-6 flex-wrap print:hidden">
            <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mr-1">
              Filter
            </span>
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`h-7 px-3 text-[12px] border transition-colors ${
                  filter === f.id
                    ? "border-foreground text-foreground bg-foreground/[0.04]"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="space-y-4">
            {filtered.map((w, i) => {
              const top = (w.rank ?? i + 1) === 1;
              return (
                <article
                  key={`${w.caseId}-${i}`}
                  className={`border p-5 print:break-inside-avoid ${
                    top ? "border-foreground/50" : "border-border"
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
                        <p className="text-[16px] text-foreground/90 leading-relaxed mb-3">
                          {safeText(w.summary)}
                        </p>
                      )}
                      {w.crossPriorities && w.crossPriorities.length > 0 && (
                        <div className="mt-3">
                          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-2">
                            Cross priorities
                          </div>
                          <ol className="space-y-2 list-none">
                            {w.crossPriorities.map((cp, j) => (
                              <li
                                key={j}
                                className="text-[15px] text-foreground/90 leading-relaxed flex gap-3"
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
            {filtered.length === 0 && (
              <p className="text-[14px] text-muted-foreground italic">
                No witnesses match this filter.
              </p>
            )}
          </div>
        </>
      )}
    </TabContainer>
  );
}

function CausationTab({
  data,
  isFailed,
  onRerunFailed,
}: {
  data: CaseSynthesis["causationAnalysis"];
  isFailed: boolean;
  onRerunFailed?: () => void;
}) {
  if (isFailed) {
    return (
      <>
        <TabSectionHeader title="Causation analysis" />
        <UnavailableInline
          subCallKey="causationMethodology"
          onRerunFailed={onRerunFailed}
          block
        />
      </>
    );
  }
  return (
    <>
      <TabSectionHeader title="Causation analysis" />
      <div className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-border p-5">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-3">
              Baseline conditions
            </div>
            <ul className="space-y-2">
              {data.baselineConditions.length === 0 && (
                <li className="text-[14px] text-muted-foreground italic">None identified.</li>
              )}
              {data.baselineConditions.map((c, i) => (
                <li
                  key={i}
                  className="text-[15px] text-foreground/90 flex gap-2 leading-relaxed"
                >
                  <span className="text-muted-foreground">›</span>
                  <span>{safeText(c)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="border border-border p-5">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-3">
              Prior accident sequelae
            </div>
            <ul className="space-y-2">
              {data.priorAccidentSequelae.length === 0 && (
                <li className="text-[14px] text-muted-foreground italic">None identified.</li>
              )}
              {data.priorAccidentSequelae.map((c, i) => (
                <li
                  key={i}
                  className="text-[15px] text-foreground/90 flex gap-2 leading-relaxed"
                >
                  <span className="text-muted-foreground">›</span>
                  <span>{safeText(c)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {data.accidentMechanism && (
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-2">
              Accident mechanism
            </div>
            <p className="text-[16px] text-foreground/90 leading-relaxed">
              {safeText(data.accidentMechanism)}
            </p>
          </div>
        )}
        {data.apportionmentArguments.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-3">
              Apportionment arguments
            </div>
            <ol className="space-y-3 list-none">
              {data.apportionmentArguments.map((a, i) => (
                <li
                  key={i}
                  className="text-[16px] text-foreground/90 flex gap-3 leading-relaxed"
                >
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {i + 1}.
                  </span>
                  <span>{safeText(a)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {data.weakestCausationLink && (
          <div className="border-l-4 border-foreground bg-foreground/[0.03] pl-5 pr-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-2">
              Weakest causation link
            </div>
            <p className="text-[17px] text-foreground leading-relaxed font-medium">
              {safeText(data.weakestCausationLink)}
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function MotionsTab({
  data,
  isFailed,
  onRerunFailed,
}: {
  data: CaseSynthesis["motionsInLimine"];
  isFailed: boolean;
  onRerunFailed?: () => void;
}) {
  if (isFailed) {
    return (
      <>
        <TabSectionHeader title="Motions in limine" />
        <UnavailableInline
          subCallKey="motionsDiscovery"
          onRerunFailed={onRerunFailed}
          block
        />
      </>
    );
  }
  const priorityRank: Record<string, number> = {
    must_file: 0,
    should_file: 1,
    consider: 2,
  };
  const sorted = data.slice().sort((a, b) => {
    const pa = priorityRank[a.priority] ?? 3;
    const pb = priorityRank[b.priority] ?? 3;
    return pa - pb;
  });
  return (
    <>
      <TabSectionHeader title="Motions in limine" count={data.length} />
      {data.length === 0 ? (
        <p className="text-[14px] text-muted-foreground italic">None recommended.</p>
      ) : (
        <div className="space-y-4">
          {sorted.map((m, i) => (
            <article
              key={i}
              className="border border-border p-5 print:break-inside-avoid"
            >
              <div className="flex items-start gap-3 mb-3 flex-wrap">
                <h3 className="flex-1 text-[16px] font-medium text-foreground">
                  {safeText(m.motion)}
                </h3>
                <Badge tone={PRIORITY_TONE[m.priority] ?? PRIORITY_TONE.consider}>
                  {m.priority.replace(/_/g, " ")}
                </Badge>
              </div>
              <p className="text-[16px] text-foreground/90 leading-relaxed">
                {safeText(m.basis)}
              </p>
              {m.supportingCites && m.supportingCites.length > 0 && (
                <pre className="mt-4 p-3 bg-muted/40 text-[12px] font-mono text-muted-foreground whitespace-pre-wrap break-words border border-border/50">
                  {m.supportingCites.map((c) => safeText(c)).join("\n")}
                </pre>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function MethodologyTab({
  data,
  isFailed,
  onRerunFailed,
  labelFor,
}: {
  data: CaseSynthesis["methodologyChallenges"];
  isFailed: boolean;
  onRerunFailed?: () => void;
  labelFor: (caseId: string, fallback?: string) => string;
}) {
  if (isFailed) {
    return (
      <>
        <TabSectionHeader title="Methodology challenges" />
        <UnavailableInline
          subCallKey="causationMethodology"
          onRerunFailed={onRerunFailed}
          block
        />
      </>
    );
  }
  return (
    <>
      <TabSectionHeader title="Methodology challenges" count={data.length} />
      {data.length === 0 ? (
        <p className="text-[14px] text-muted-foreground italic">None identified.</p>
      ) : (
        <div className="space-y-4">
          {data.map((m, i) => (
            <article key={i} className="border border-border p-5 print:break-inside-avoid">
              <div className="flex items-start gap-2 mb-3 flex-wrap">
                <span className="text-[16px] font-medium text-foreground">
                  {safeText(m.targetWitness)}
                </span>
                <Badge tone="bg-foreground/10 text-foreground">{m.motionType}</Badge>
                <Cite>{labelFor(m.caseId, m.targetWitness)}</Cite>
              </div>
              <p className="text-[16px] text-foreground/90 leading-relaxed">
                {safeText(m.basis)}
              </p>
              {m.supportingCites && m.supportingCites.length > 0 && (
                <pre className="mt-4 p-3 bg-muted/40 text-[12px] font-mono text-muted-foreground whitespace-pre-wrap break-words border border-border/50">
                  {m.supportingCites.map((c) => safeText(c)).join("\n")}
                </pre>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function ContradictionsTab({
  data,
  isFailed,
  onRerunFailed,
}: {
  data: CaseSynthesis["contradictionMatrix"];
  isFailed: boolean;
  onRerunFailed?: () => void;
}) {
  if (isFailed) {
    return (
      <>
        <TabSectionHeader title="Contradiction matrix" />
        <UnavailableInline
          subCallKey="contradictionsAdmissions"
          onRerunFailed={onRerunFailed}
          block
        />
      </>
    );
  }
  return (
    <>
      <TabSectionHeader title="Contradiction matrix" count={data.length} />
      {data.length === 0 ? (
        <p className="text-[14px] text-muted-foreground italic">
          No contradictions identified.
        </p>
      ) : (
        <div className="space-y-4">
          {data.map((row, i) => (
            <article key={i} className="border border-border p-5 print:break-inside-avoid">
              <div className="flex items-start gap-2 mb-3 flex-wrap">
                <h3 className="flex-1 text-[16px] font-medium text-foreground">
                  {safeText(row.topic)}
                </h3>
                <Badge tone={THREAT_TONE[row.exploitability] ?? THREAT_TONE.medium}>
                  {row.exploitability} exploitability
                </Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[14px] border-collapse">
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
                      <tr
                        key={j}
                        className="border-b border-border/60 last:border-0 align-top"
                      >
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
                <p className="text-[15px] text-foreground/90 mt-3 leading-relaxed">
                  <span className="text-muted-foreground">Defense use: </span>
                  {safeText(row.defenseUse)}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function AdmissionsTab({
  data,
  isFailed,
  onRerunFailed,
}: {
  data: CaseSynthesis["unifiedAdmissionsInventory"];
  isFailed: boolean;
  onRerunFailed?: () => void;
}) {
  if (isFailed) {
    return (
      <>
        <TabSectionHeader title="Unified admissions inventory" />
        <UnavailableInline
          subCallKey="contradictionsAdmissions"
          onRerunFailed={onRerunFailed}
          block
        />
      </>
    );
  }
  return (
    <>
      <TabSectionHeader title="Unified admissions inventory" count={data.length} />
      {data.length === 0 ? (
        <p className="text-[14px] text-muted-foreground italic">No admissions inventoried.</p>
      ) : (
        <div className="space-y-4">
          {data.map((row, i) => (
            <article key={i} className="border border-border p-5 print:break-inside-avoid">
              <h3 className="text-[16px] font-medium text-foreground mb-3">
                {safeText(row.topic)}
              </h3>
              <ul className="space-y-2 mb-3">
                {row.admissions.map((a, j) => (
                  <li key={j} className="text-[15px] leading-relaxed">
                    <span className="font-medium text-foreground">
                      {safeText(a.deponentName)}:
                    </span>{" "}
                    <span className="text-foreground/90">{safeText(a.admission)}</span>
                    {a.cite && <Cite>{safeText(a.cite)}</Cite>}
                  </li>
                ))}
              </ul>
              {row.trialUse && (
                <p className="text-[15px] text-foreground/90 leading-relaxed">
                  <span className="text-muted-foreground">Trial use: </span>
                  {safeText(row.trialUse)}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function BiasTab({
  data,
  isFailed,
  onRerunFailed,
}: {
  data: CaseSynthesis["biasNarrative"];
  isFailed: boolean;
  onRerunFailed?: () => void;
}) {
  if (isFailed) {
    return (
      <>
        <TabSectionHeader title="Bias narrative" />
        <UnavailableInline
          subCallKey="strategicOverview"
          onRerunFailed={onRerunFailed}
          block
        />
      </>
    );
  }
  return (
    <>
      <TabSectionHeader title="Bias narrative" />
      <div className="space-y-8 max-w-[68ch]">
        {data.pipelineMap && (
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-2">
              Pipeline map
            </div>
            <p className="text-[16px] text-foreground/90 leading-relaxed">
              {safeText(data.pipelineMap)}
            </p>
          </div>
        )}
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-3">
            Financial relationships
          </div>
          <ul className="space-y-2">
            {data.financialRelationships.length === 0 && (
              <li className="text-[14px] text-muted-foreground italic">None identified.</li>
            )}
            {data.financialRelationships.map((c, i) => (
              <li
                key={i}
                className="text-[15px] text-foreground/90 flex gap-2 leading-relaxed"
              >
                <span className="text-muted-foreground">›</span>
                <span>{safeText(c)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-3">
            Repeat-player patterns
          </div>
          <ul className="space-y-2">
            {data.repeatPlayerPatterns.length === 0 && (
              <li className="text-[14px] text-muted-foreground italic">None identified.</li>
            )}
            {data.repeatPlayerPatterns.map((c, i) => (
              <li
                key={i}
                className="text-[15px] text-foreground/90 flex gap-2 leading-relaxed"
              >
                <span className="text-muted-foreground">›</span>
                <span>{safeText(c)}</span>
              </li>
            ))}
          </ul>
        </div>
        {data.trialNarrative && (
          <div className="border-l-2 border-foreground pl-4 py-1">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-2">
              Trial narrative
            </div>
            <p className="text-[17px] text-foreground leading-relaxed">
              {safeText(data.trialNarrative)}
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function ThemesTab({
  data,
  isFailed,
  onRerunFailed,
}: {
  data: CaseSynthesis["trialThemes"];
  isFailed: boolean;
  onRerunFailed?: () => void;
}) {
  if (isFailed) {
    return (
      <>
        <TabSectionHeader title="Trial themes" />
        <UnavailableInline
          subCallKey="strategicOverview"
          onRerunFailed={onRerunFailed}
          block
        />
      </>
    );
  }
  return (
    <>
      <TabSectionHeader title="Trial themes" count={data.length} />
      {data.length === 0 ? (
        <p className="text-[14px] text-muted-foreground italic">No themes identified.</p>
      ) : (
        <div className="space-y-4">
          {data.map((t, i) => (
            <article key={i} className="border border-border p-5 print:break-inside-avoid">
              <h3 className="text-[17px] font-medium text-foreground mb-4">
                {safeText(t.theme)}
              </h3>
              {t.supportingWitnesses.length > 0 && (
                <div className="mb-4">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-2">
                    Supporting witnesses
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {t.supportingWitnesses.map((w, j) => (
                      <span
                        key={j}
                        className="inline-flex items-center px-2 h-6 text-[12px] bg-foreground/[0.05] text-foreground/90 border border-border"
                      >
                        {safeText(w)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {t.supportingFacts.length > 0 && (
                <div className="mb-4">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-2">
                    Supporting facts
                  </div>
                  <ul className="space-y-1.5">
                    {t.supportingFacts.map((f, j) => (
                      <li
                        key={j}
                        className="text-[15px] text-foreground/90 leading-relaxed flex gap-2"
                      >
                        <span className="text-muted-foreground">›</span>
                        <span>{safeText(f)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {t.voirDireAngle && (
                <div className="border-l-2 border-foreground/60 pl-3 py-1 mt-3">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-1">
                    Voir dire angle
                  </div>
                  <p className="text-[15px] text-foreground/90 leading-relaxed">
                    {safeText(t.voirDireAngle)}
                  </p>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function DiscoveryGapsTab({
  data,
  isFailed,
  onRerunFailed,
}: {
  data: CaseSynthesis["discoveryGaps"];
  isFailed: boolean;
  onRerunFailed?: () => void;
}) {
  if (isFailed) {
    return (
      <>
        <TabSectionHeader title="Discovery gaps" />
        <UnavailableInline
          subCallKey="motionsDiscovery"
          onRerunFailed={onRerunFailed}
          block
        />
      </>
    );
  }
  return (
    <>
      <TabSectionHeader title="Discovery gaps" count={data.length} />
      {data.length === 0 ? (
        <p className="text-[14px] text-muted-foreground italic">No gaps identified.</p>
      ) : (
        <div className="space-y-3">
          {data.map((g, i) => (
            <article key={i} className="border border-border p-5 print:break-inside-avoid">
              <div className="flex items-start gap-3 mb-3 flex-wrap">
                <h3 className="flex-1 text-[16px] font-medium text-foreground">
                  {safeText(g.gap)}
                </h3>
                <Badge tone={PRIORITY_TONE[g.priority] ?? PRIORITY_TONE.medium}>
                  {g.priority}
                </Badge>
              </div>
              {g.impact && (
                <p className="text-[15px] text-foreground/90 leading-relaxed">
                  <span className="text-muted-foreground">Impact: </span>
                  {safeText(g.impact)}
                </p>
              )}
              {g.recommendedAction && (
                <p className="text-[15px] text-foreground/90 leading-relaxed mt-2">
                  <span className="text-muted-foreground">Action: </span>
                  {safeText(g.recommendedAction)}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function MissedTab({
  data,
  isFailed,
  onRerunFailed,
}: {
  data: CaseSynthesis["whatWeMessedUp"];
  isFailed: boolean;
  onRerunFailed?: () => void;
}) {
  if (isFailed) {
    return (
      <>
        <TabSectionHeader title="What we missed" />
        <UnavailableInline
          subCallKey="retrospective"
          onRerunFailed={onRerunFailed}
          block
        />
      </>
    );
  }
  const sorted = data.slice().sort((a, b) => {
    if (!!a.canStillFix === !!b.canStillFix) {
      return safeText(a.deposition).localeCompare(safeText(b.deposition));
    }
    return a.canStillFix ? -1 : 1;
  });
  return (
    <>
      <TabSectionHeader title="What we missed" count={data.length} />
      {data.length === 0 ? (
        <p className="text-[14px] text-muted-foreground italic">Nothing flagged.</p>
      ) : (
        <div className="space-y-4">
          {sorted.map((m, i) => (
            <article
              key={i}
              className="border border-border p-5 print:break-inside-avoid relative"
            >
              {m.canStillFix && (
                <span className="absolute top-4 right-4">
                  <Badge tone="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                    Can still fix
                  </Badge>
                </span>
              )}
              <h3 className="text-[16px] font-medium text-foreground mb-4 pr-28">
                {safeText(m.deposition)}
              </h3>
              <div className="space-y-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-1">
                    Missed
                  </div>
                  <p className="text-[15px] text-foreground/90 leading-relaxed">
                    {safeText(m.missedOpportunity)}
                  </p>
                </div>
                {m.wouldHaveHelped && (
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-1">
                      Would have helped
                    </div>
                    <p className="text-[15px] text-foreground/90 leading-relaxed">
                      {safeText(m.wouldHaveHelped)}
                    </p>
                  </div>
                )}
                {m.canStillFix && m.fixAction && (
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-1">
                      Fix
                    </div>
                    <p className="text-[15px] text-foreground leading-relaxed">
                      {safeText(m.fixAction)}
                    </p>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function NextTab({
  data,
  isFailed,
  onRerunFailed,
}: {
  data: CaseSynthesis["whatToDoNext"];
  isFailed: boolean;
  onRerunFailed?: () => void;
}) {
  if (isFailed) {
    return (
      <>
        <TabSectionHeader title="What to do next" />
        <UnavailableInline
          subCallKey="retrospective"
          onRerunFailed={onRerunFailed}
          block
        />
      </>
    );
  }
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
    <>
      <TabSectionHeader title="What to do next" count={data.length} />
      {data.length === 0 ? (
        <p className="text-[14px] text-muted-foreground italic">No actions queued.</p>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => {
            const items = data.filter((a) => a.priority === g.key);
            if (items.length === 0) return null;
            return (
              <div key={g.key}>
                <div className="flex items-center gap-2 mb-3">
                  <Badge tone={g.tone}>{g.label}</Badge>
                  <span className="text-[12px] text-muted-foreground tabular-nums">
                    {items.length}
                  </span>
                </div>
                <ul className="space-y-3">
                  {items.map((a, i) => (
                    <li
                      key={i}
                      className={`border-l-2 ${g.accent} pl-4 py-1.5 print:break-inside-avoid`}
                    >
                      <p className="text-[16px] font-medium text-foreground leading-snug">
                        {safeText(a.action)}
                      </p>
                      {a.rationale && (
                        <p className="text-[15px] text-foreground/80 leading-relaxed mt-1">
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
      )}
    </>
  );
}
