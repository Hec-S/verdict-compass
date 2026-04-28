import { useState } from "react";
import { ChevronDown } from "lucide-react";
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

// ---------------- Shared label maps ----------------

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

// ---------------- Section wrapper ----------------

interface SectionProps {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  children: React.ReactNode;
}
function Section({ title, count, defaultOpen = false, forceOpen, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = forceOpen ?? open;
  return (
    <section className="border-b border-border print:border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full h-12 flex items-center gap-3 text-left hover:bg-foreground/[0.03] transition-colors px-1 print:hidden"
      >
        <h2 className="flex-1 text-[14px] font-medium text-foreground">{title}</h2>
        {typeof count === "number" && (
          <span className="text-[12px] text-muted-foreground tabular-nums">{count}</span>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      <h2 className="hidden print:block text-[14px] font-semibold text-foreground py-2 border-b border-border">
        {title}
        {typeof count === "number" && (
          <span className="ml-2 text-muted-foreground font-normal">({count})</span>
        )}
      </h2>
      {(isOpen || true) && (
        <div className={`pb-6 pt-1 px-1 ${isOpen ? "block" : "hidden"} print:!block`}>
          {children}
        </div>
      )}
    </section>
  );
}

// ---------------- Main view ----------------

interface Props {
  synthesis: CaseSynthesis;
  /** Map of caseId -> deponentName for fallback display. */
  caseLabels?: Map<string, string>;
  onRerun?: () => void;
  rerunDisabled?: boolean;
  /** Internal sub-call keys that failed in the most recent run. Used to
   *  render "Section unavailable" placeholders for sections whose data
   *  could not be produced. */
  failedSubCallKeys?: string[];
  /** Invoked when the user clicks "Re-run failed sections" inside the report. */
  onRerunFailed?: () => void;
}

export function MatterSynthesisView({
  synthesis,
  caseLabels,
  onRerun,
  rerunDisabled,
  failedSubCallKeys = [],
  onRerunFailed,
}: Props) {
  const [confirmRerun, setConfirmRerun] = useState(false);
  const exec = synthesis.execSummary;
  const labelFor = (caseId: string, fallback?: string) =>
    fallback || caseLabels?.get(caseId) || caseId.slice(0, 8);

  const failed = new Set(failedSubCallKeys);
  const isFailed = (key: SynthesisSubCallKey) => failed.has(key);

  const Unavailable = ({ subCallKey }: { subCallKey: SynthesisSubCallKey }) => (
    <div className="border border-amber-500/40 bg-amber-500/5 p-4 text-[12.5px] text-foreground/90">
      <p className="mb-2">
        <span className="font-medium">Section unavailable</span> — the{" "}
        <span className="font-medium">{SYNTHESIS_SUB_CALLS[subCallKey].label}</span>{" "}
        sub-call failed during synthesis.
      </p>
      {onRerunFailed ? (
        <button
          type="button"
          onClick={onRerunFailed}
          className="inline-flex items-center h-7 px-3 text-[12px] text-foreground border border-foreground/80 hover:bg-foreground/[0.05] transition-colors"
        >
          Re-run failed sections
        </button>
      ) : (
        <p className="text-muted-foreground">
          Click "Re-run failed sections" above to retry.
        </p>
      )}
    </div>
  );

  const handleDownloadPdf = () => {
    if (typeof window !== "undefined") window.print();
  };

  return (
    <div className="synthesis-view">
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-2 mb-4 print:hidden">
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

      {/* ExecSummary panel */}
      <section className="border border-border p-5 mb-6 print:p-0 print:border-0 print:mb-4">
        {isFailed("strategicOverview") ? (
          <Unavailable subCallKey="strategicOverview" />
        ) : (
          <>
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-2">
          Defense theory
        </div>
        <p className="text-[18px] leading-snug font-medium text-foreground mb-5 print:text-[14px]">
          {exec.defenseTheory || "No defense theory produced."}
        </p>

        <div className="flex flex-wrap items-start gap-x-8 gap-y-4 mb-6">
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1">
              Case strength
            </div>
            <Badge tone={STRENGTH_TONE[exec.caseStrength]}>
              {STRENGTH_LABEL[exec.caseStrength]}
            </Badge>
            {exec.strengthRationale && (
              <p className="text-[12px] text-muted-foreground mt-1 max-w-md">
                {exec.strengthRationale}
              </p>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1">
              Recommended posture
            </div>
            <Badge tone="bg-foreground text-background">
              {POSTURE_LABEL[exec.recommendedPosture]}
            </Badge>
            {exec.postureRationale && (
              <p className="text-[12px] text-muted-foreground mt-1 max-w-md">
                {exec.postureRationale}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print:grid-cols-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-2">
              Top threats
            </div>
            <ul className="space-y-2">
              {exec.topThreats.length === 0 && (
                <li className="text-[12px] text-muted-foreground italic">None identified.</li>
              )}
              {exec.topThreats.map((t, i) => (
                <li key={i} className="text-[13px] text-foreground leading-relaxed flex gap-2">
                  <span className="text-muted-foreground tabular-nums">{i + 1}.</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-2">
              Top opportunities
            </div>
            <ul className="space-y-2">
              {exec.topOpportunities.length === 0 && (
                <li className="text-[12px] text-muted-foreground italic">None identified.</li>
              )}
              {exec.topOpportunities.map((t, i) => (
                <li key={i} className="text-[13px] text-foreground leading-relaxed flex gap-2">
                  <span className="text-muted-foreground tabular-nums">{i + 1}.</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
          </>
        )}
      </section>

      {/* Witness Threat Ranking */}
      <Section
        title="Witness threat ranking"
        count={synthesis.witnessThreatRanking.length}
        defaultOpen
      >
        {isFailed("witnessThreats") ? (
          <Unavailable subCallKey="witnessThreats" />
        ) : (
        <div className="space-y-3">
          {synthesis.witnessThreatRanking.length === 0 && (
            <p className="text-[13px] text-muted-foreground italic">No witnesses ranked.</p>
          )}
          {synthesis.witnessThreatRanking
            .slice()
            .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
            .map((w, i) => (
              <div
                key={`${w.caseId}-${i}`}
                className="border border-border p-3 print:break-inside-avoid"
              >
                <div className="flex items-start gap-3 mb-2">
                  <span className="text-[18px] font-semibold tabular-nums text-foreground w-6 shrink-0">
                    {w.rank}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-medium text-foreground">
                        {w.deponentName}
                      </span>
                      <Badge tone={THREAT_TONE[w.threatLevel] ?? THREAT_TONE.medium}>
                        {w.threatLevel} threat
                      </Badge>
                      <Cite>{labelFor(w.caseId, w.deponentName)}</Cite>
                    </div>
                    {w.summary && (
                      <p className="text-[13px] text-foreground/90 mt-1.5 leading-relaxed">
                        {w.summary}
                      </p>
                    )}
                  </div>
                </div>
                {w.crossPriorities && w.crossPriorities.length > 0 && (
                  <div className="mt-2 ml-9">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1">
                      Cross priorities
                    </div>
                    <ul className="space-y-1">
                      {w.crossPriorities.map((cp, j) => (
                        <li
                          key={j}
                          className="text-[12.5px] text-foreground/85 leading-snug flex gap-2"
                        >
                          <span className="text-muted-foreground">›</span>
                          <span>{cp}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
        </div>
        )}
      </Section>

      {/* Contradiction Matrix */}
      <Section title="Contradiction matrix" count={synthesis.contradictionMatrix.length}>
        {isFailed("contradictionsAdmissions") ? (
          <Unavailable subCallKey="contradictionsAdmissions" />
        ) : (
        <div className="space-y-4">
          {synthesis.contradictionMatrix.length === 0 && (
            <p className="text-[13px] text-muted-foreground italic">No contradictions identified.</p>
          )}
          {synthesis.contradictionMatrix.map((row, i) => (
            <div key={i} className="border border-border p-3 print:break-inside-avoid">
              <div className="flex items-start gap-2 mb-2">
                <h3 className="flex-1 text-[13px] font-medium text-foreground">{row.topic}</h3>
                <Badge tone={THREAT_TONE[row.exploitability] ?? THREAT_TONE.medium}>
                  {row.exploitability} exploitability
                </Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px] border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-1.5 pr-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-medium">Witness</th>
                      <th className="text-left py-1.5 pr-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-medium">Position</th>
                      <th className="text-left py-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-medium">Cite</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.witnesses.map((w, j) => (
                      <tr key={j} className="border-b border-border/60 last:border-0 align-top">
                        <td className="py-1.5 pr-3 font-medium text-foreground whitespace-nowrap">
                          {w.deponentName}
                        </td>
                        <td className="py-1.5 pr-3 text-foreground/90">{w.position}</td>
                        <td className="py-1.5 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                          {w.cite}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {row.defenseUse && (
                <p className="text-[12.5px] text-foreground/90 mt-2 leading-relaxed">
                  <span className="text-muted-foreground">Defense use: </span>
                  {row.defenseUse}
                </p>
              )}
            </div>
          ))}
        </div>
        )}
      </Section>

      {/* Unified Admissions Inventory */}
      <Section
        title="Unified admissions inventory"
        count={synthesis.unifiedAdmissionsInventory.length}
      >
        {isFailed("contradictionsAdmissions") ? (
          <Unavailable subCallKey="contradictionsAdmissions" />
        ) : (
        <div className="space-y-3">
          {synthesis.unifiedAdmissionsInventory.length === 0 && (
            <p className="text-[13px] text-muted-foreground italic">No admissions inventoried.</p>
          )}
          {synthesis.unifiedAdmissionsInventory.map((row, i) => (
            <div key={i} className="border border-border p-3 print:break-inside-avoid">
              <h3 className="text-[13px] font-medium text-foreground mb-2">{row.topic}</h3>
              <ul className="space-y-1.5 mb-2">
                {row.admissions.map((a, j) => (
                  <li key={j} className="text-[12.5px] leading-snug">
                    <span className="font-medium text-foreground">{a.deponentName}:</span>{" "}
                    <span className="text-foreground/90">{a.admission}</span>
                    {a.cite && <Cite>{a.cite}</Cite>}
                  </li>
                ))}
              </ul>
              {row.trialUse && (
                <p className="text-[12.5px] text-foreground/90 leading-relaxed">
                  <span className="text-muted-foreground">Trial use: </span>
                  {row.trialUse}
                </p>
              )}
            </div>
          ))}
        </div>
        )}
      </Section>

      {/* Causation Analysis */}
      <Section title="Causation analysis" defaultOpen>
        {isFailed("causationMethodology") ? (
          <Unavailable subCallKey="causationMethodology" />
        ) : (
        <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
              Baseline conditions
            </div>
            <ul className="space-y-1">
              {synthesis.causationAnalysis.baselineConditions.length === 0 && (
                <li className="text-[12.5px] text-muted-foreground italic">None identified.</li>
              )}
              {synthesis.causationAnalysis.baselineConditions.map((c, i) => (
                <li key={i} className="text-[12.5px] text-foreground/90 flex gap-2">
                  <span className="text-muted-foreground">›</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
              Prior accident sequelae
            </div>
            <ul className="space-y-1">
              {synthesis.causationAnalysis.priorAccidentSequelae.length === 0 && (
                <li className="text-[12.5px] text-muted-foreground italic">None identified.</li>
              )}
              {synthesis.causationAnalysis.priorAccidentSequelae.map((c, i) => (
                <li key={i} className="text-[12.5px] text-foreground/90 flex gap-2">
                  <span className="text-muted-foreground">›</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {synthesis.causationAnalysis.accidentMechanism && (
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
              Accident mechanism
            </div>
            <p className="text-[13px] text-foreground/90 leading-relaxed">
              {synthesis.causationAnalysis.accidentMechanism}
            </p>
          </div>
        )}
        {synthesis.causationAnalysis.apportionmentArguments.length > 0 && (
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
              Apportionment arguments
            </div>
            <ul className="space-y-1.5">
              {synthesis.causationAnalysis.apportionmentArguments.map((a, i) => (
                <li key={i} className="text-[13px] text-foreground/90 flex gap-2 leading-relaxed">
                  <span className="text-muted-foreground tabular-nums">{i + 1}.</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {synthesis.causationAnalysis.weakestCausationLink && (
          <div className="mt-4 border-l-2 border-foreground pl-3">
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1">
              Weakest causation link
            </div>
            <p className="text-[13px] text-foreground leading-relaxed">
              {synthesis.causationAnalysis.weakestCausationLink}
            </p>
          </div>
        )}
        </>
        )}
      </Section>

      {/* Methodology Challenges */}
      <Section
        title="Methodology challenges"
        count={synthesis.methodologyChallenges.length}
      >
        {isFailed("causationMethodology") ? (
          <Unavailable subCallKey="causationMethodology" />
        ) : (
        <div className="space-y-3">
          {synthesis.methodologyChallenges.length === 0 && (
            <p className="text-[13px] text-muted-foreground italic">None identified.</p>
          )}
          {synthesis.methodologyChallenges.map((m, i) => (
            <div key={i} className="border border-border p-3 print:break-inside-avoid">
              <div className="flex items-start gap-2 mb-1.5 flex-wrap">
                <span className="text-[13px] font-medium text-foreground">{m.targetWitness}</span>
                <Badge tone="bg-foreground/10 text-foreground">{m.motionType}</Badge>
                <Cite>{labelFor(m.caseId, m.targetWitness)}</Cite>
              </div>
              <p className="text-[12.5px] text-foreground/90 leading-relaxed">{m.basis}</p>
              {m.supportingCites && m.supportingCites.length > 0 && (
                <p className="mt-1.5 text-[11px] font-mono text-muted-foreground">
                  {m.supportingCites.join(" · ")}
                </p>
              )}
            </div>
          ))}
        </div>
        )}
      </Section>

      {/* Bias Narrative */}
      <Section title="Bias narrative">
        {isFailed("strategicOverview") ? (
          <Unavailable subCallKey="strategicOverview" />
        ) : (
        <>
        {synthesis.biasNarrative.pipelineMap && (
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
              Pipeline map
            </div>
            <p className="text-[13px] text-foreground/90 leading-relaxed">
              {synthesis.biasNarrative.pipelineMap}
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-2 mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
              Financial relationships
            </div>
            <ul className="space-y-1">
              {synthesis.biasNarrative.financialRelationships.length === 0 && (
                <li className="text-[12.5px] text-muted-foreground italic">None identified.</li>
              )}
              {synthesis.biasNarrative.financialRelationships.map((c, i) => (
                <li key={i} className="text-[12.5px] text-foreground/90 flex gap-2">
                  <span className="text-muted-foreground">›</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
              Repeat-player patterns
            </div>
            <ul className="space-y-1">
              {synthesis.biasNarrative.repeatPlayerPatterns.length === 0 && (
                <li className="text-[12.5px] text-muted-foreground italic">None identified.</li>
              )}
              {synthesis.biasNarrative.repeatPlayerPatterns.map((c, i) => (
                <li key={i} className="text-[12.5px] text-foreground/90 flex gap-2">
                  <span className="text-muted-foreground">›</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {synthesis.biasNarrative.trialNarrative && (
          <div className="border-l-2 border-foreground pl-3">
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1">
              Trial narrative
            </div>
            <p className="text-[13px] text-foreground leading-relaxed">
              {synthesis.biasNarrative.trialNarrative}
            </p>
          </div>
        )}
        </>
        )}
      </Section>

      {/* Motions in Limine */}
      <Section title="Motions in limine" count={synthesis.motionsInLimine.length}>
        {isFailed("motionsDiscovery") ? (
          <Unavailable subCallKey="motionsDiscovery" />
        ) : (
        <div className="space-y-2">
          {synthesis.motionsInLimine.length === 0 && (
            <p className="text-[13px] text-muted-foreground italic">None recommended.</p>
          )}
          {synthesis.motionsInLimine.map((m, i) => (
            <div key={i} className="border border-border p-3 print:break-inside-avoid">
              <div className="flex items-start gap-2 mb-1 flex-wrap">
                <h3 className="flex-1 text-[13px] font-medium text-foreground">{m.motion}</h3>
                <Badge tone={PRIORITY_TONE[m.priority] ?? PRIORITY_TONE.consider}>
                  {m.priority.replace(/_/g, " ")}
                </Badge>
              </div>
              <p className="text-[12.5px] text-foreground/90 leading-relaxed">{m.basis}</p>
              {m.supportingCites && m.supportingCites.length > 0 && (
                <p className="mt-1.5 text-[11px] font-mono text-muted-foreground">
                  {m.supportingCites.join(" · ")}
                </p>
              )}
            </div>
          ))}
        </div>
        )}
      </Section>

      {/* Discovery Gaps */}
      <Section title="Discovery gaps" count={synthesis.discoveryGaps.length}>
        {isFailed("motionsDiscovery") ? (
          <Unavailable subCallKey="motionsDiscovery" />
        ) : (
        <div className="space-y-2">
          {synthesis.discoveryGaps.length === 0 && (
            <p className="text-[13px] text-muted-foreground italic">No gaps identified.</p>
          )}
          {synthesis.discoveryGaps.map((g, i) => (
            <div key={i} className="border border-border p-3 print:break-inside-avoid">
              <div className="flex items-start gap-2 mb-1 flex-wrap">
                <h3 className="flex-1 text-[13px] font-medium text-foreground">{g.gap}</h3>
                <Badge tone={PRIORITY_TONE[g.priority] ?? PRIORITY_TONE.medium}>
                  {g.priority}
                </Badge>
              </div>
              {g.impact && (
                <p className="text-[12.5px] text-foreground/90 leading-relaxed">
                  <span className="text-muted-foreground">Impact: </span>
                  {g.impact}
                </p>
              )}
              {g.recommendedAction && (
                <p className="text-[12.5px] text-foreground/90 leading-relaxed mt-1">
                  <span className="text-muted-foreground">Action: </span>
                  {g.recommendedAction}
                </p>
              )}
            </div>
          ))}
        </div>
        )}
      </Section>

      {/* Trial Themes */}
      <Section title="Trial themes" count={synthesis.trialThemes.length}>
        {isFailed("strategicOverview") ? (
          <Unavailable subCallKey="strategicOverview" />
        ) : (
        <div className="space-y-3">
          {synthesis.trialThemes.length === 0 && (
            <p className="text-[13px] text-muted-foreground italic">No themes identified.</p>
          )}
          {synthesis.trialThemes.map((t, i) => (
            <div key={i} className="border border-border p-3 print:break-inside-avoid">
              <h3 className="text-[14px] font-medium text-foreground mb-2">{t.theme}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 print:grid-cols-2">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1">
                    Supporting witnesses
                  </div>
                  <ul className="space-y-0.5">
                    {t.supportingWitnesses.map((w, j) => (
                      <li key={j} className="text-[12.5px] text-foreground/90">
                        · {w}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1">
                    Supporting facts
                  </div>
                  <ul className="space-y-0.5">
                    {t.supportingFacts.map((f, j) => (
                      <li key={j} className="text-[12.5px] text-foreground/90">
                        · {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              {t.voirDireAngle && (
                <p className="mt-2 text-[12.5px] text-foreground/90 leading-relaxed">
                  <span className="text-muted-foreground">Voir dire angle: </span>
                  {t.voirDireAngle}
                </p>
              )}
            </div>
          ))}
        </div>
        )}
      </Section>

      {/* What We Missed */}
      <Section title="What we missed" count={synthesis.whatWeMessedUp.length}>
        {isFailed("retrospective") ? (
          <Unavailable subCallKey="retrospective" />
        ) : (
        <div className="space-y-2">
          {synthesis.whatWeMessedUp.length === 0 && (
            <p className="text-[13px] text-muted-foreground italic">Nothing flagged.</p>
          )}
          {synthesis.whatWeMessedUp.map((m, i) => (
            <div key={i} className="border border-border p-3 print:break-inside-avoid">
              <div className="flex items-start gap-2 mb-1 flex-wrap">
                <h3 className="flex-1 text-[13px] font-medium text-foreground">{m.deposition}</h3>
                <Badge
                  tone={
                    m.canStillFix
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  }
                >
                  {m.canStillFix ? "Can still fix" : "Cannot fix"}
                </Badge>
              </div>
              <p className="text-[12.5px] text-foreground/90 leading-relaxed">
                <span className="text-muted-foreground">Missed: </span>
                {m.missedOpportunity}
              </p>
              {m.wouldHaveHelped && (
                <p className="text-[12.5px] text-foreground/90 leading-relaxed mt-1">
                  <span className="text-muted-foreground">Would have helped: </span>
                  {m.wouldHaveHelped}
                </p>
              )}
              {m.canStillFix && m.fixAction && (
                <p className="text-[12.5px] text-foreground leading-relaxed mt-1">
                  <span className="text-muted-foreground">Fix: </span>
                  {m.fixAction}
                </p>
              )}
            </div>
          ))}
        </div>
        )}
      </Section>

      {/* What To Do Next */}
      <Section title="What to do next" count={synthesis.whatToDoNext.length} defaultOpen>
        {isFailed("retrospective") ? (
          <Unavailable subCallKey="retrospective" />
        ) : (
        <div className="space-y-2">
          {synthesis.whatToDoNext.length === 0 && (
            <p className="text-[13px] text-muted-foreground italic">No actions queued.</p>
          )}
          {synthesis.whatToDoNext.map((a, i) => (
            <div
              key={i}
              className="flex items-start gap-3 border border-border p-3 print:break-inside-avoid"
            >
              <Badge tone={PRIORITY_TONE[a.priority] ?? PRIORITY_TONE.consider}>
                {a.priority.replace(/_/g, " ")}
              </Badge>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-foreground leading-snug">{a.action}</p>
                {a.rationale && (
                  <p className="text-[12.5px] text-muted-foreground leading-relaxed mt-0.5">
                    {a.rationale}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
        )}
      </Section>

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