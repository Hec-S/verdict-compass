import { useNavigate } from "@tanstack/react-router";
import { Panel, Cite, CategoryTag } from "./Panel";
import type { StoredCase, Credibility } from "@/lib/analysis-types";

type ItemTone = "positive" | "negative" | "neutral";

const toneBar: Record<ItemTone, string> = {
  positive: "before:bg-success",
  negative: "before:bg-destructive",
  neutral: "before:bg-border",
};

function ListItem({
  tone = "neutral",
  category,
  title,
  detail,
  cite,
  extra,
}: {
  tone?: ItemTone;
  category?: string;
  title: string;
  detail?: string;
  cite?: string;
  extra?: React.ReactNode;
}) {
  return (
    <li
      className={`relative pl-4 py-3 border-b border-border last:border-b-0 before:content-[''] before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[2px] ${toneBar[tone]}`}
    >
      {category && (
        <p className="text-[11px] text-muted-foreground mb-0.5">{category}</p>
      )}
      <p className="text-[14px] font-medium text-foreground leading-snug">
        {title}
        {cite && <Cite>{cite}</Cite>}
      </p>
      {detail && (
        <p className="text-[13px] text-muted-foreground leading-[1.55] mt-1">{detail}</p>
      )}
      {extra}
    </li>
  );
}

const credibilityTone: Record<Credibility, ItemTone> = {
  Strong: "positive",
  Mixed: "neutral",
  Weak: "negative",
};

function rulingTone(r: string): ItemTone {
  const v = r.toLowerCase();
  if (v.includes("sustain")) return "positive";
  if (v.includes("overrul")) return "negative";
  return "neutral";
}

function OutlineButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center h-8 px-3 text-[13px] font-normal text-foreground border border-foreground/80 bg-transparent hover:bg-foreground/[0.05] transition-colors"
    >
      {children}
    </button>
  );
}

export function Dashboard({ stored }: { stored: StoredCase }) {
  const navigate = useNavigate();
  const r = stored.result;
  const snap = r.caseSnapshot ?? ({} as any);
  const missing = new Set(stored.missingSections ?? []);

  const metaFields: { label: string; value?: string }[] = [
    { label: "Court", value: snap.court },
    { label: "Posture", value: snap.posture },
    { label: "Plaintiff", value: snap.plaintiff },
    { label: "Defendant", value: snap.defendant },
    { label: "Filed", value: snap.filed },
    { label: "Outcome", value: snap.outcome },
  ];
  const hasMeta = metaFields.some((f) => f.value);

  return (
    <div className="max-w-[880px] mx-auto px-8 py-10 print:py-2 print:max-w-none">
      {/* Case snapshot */}
      <div className="pb-8 mb-2 border-b border-border">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex-1 min-w-[260px]">
            <p className="text-[12px] text-muted-foreground mb-1">Case</p>
            <h1 className="text-[22px] font-medium tracking-[-0.01em] leading-tight">
              {snap.caseName || stored.caseName}
            </h1>
            {hasMeta && (
              <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 max-w-[560px]">
                {metaFields.map((f) =>
                  f.value ? (
                    <div key={f.label}>
                      <dt className="text-[11px] text-muted-foreground">{f.label}</dt>
                      <dd className="text-[13px] text-foreground leading-[1.4] mt-0.5">
                        {f.value}
                      </dd>
                    </div>
                  ) : null,
                )}
              </dl>
            )}
            {snap.bottomLine && (
              <p className="text-[14px] text-foreground leading-[1.5] mt-5 max-w-[640px]">
                {snap.bottomLine}
              </p>
            )}
          </div>
          <div className="flex gap-2 print:hidden">
            <OutlineButton onClick={() => window.print()}>Download Report</OutlineButton>
            <OutlineButton onClick={() => navigate({ to: "/" })}>New Case</OutlineButton>
          </div>
        </div>
        {stored.truncated && (
          <p className="mt-4 text-[12px] text-muted-foreground">
            Transcript exceeded 150,000 characters and was truncated for analysis.
          </p>
        )}
      </div>

      {/* What Went Well */}
      <Panel title="What went well" count={r.wentWell?.length ?? 0} missing={missing.has("wentWell")}>
        <ul>
          {r.wentWell?.map((c, i) => (
            <ListItem
              key={i}
              tone="positive"
              category={c.category}
              title={c.title}
              detail={c.detail}
              cite={c.cite}
            />
          ))}
        </ul>
      </Panel>

      {/* What Didn't Go Well */}
      <Panel
        title="What didn't go well"
        count={r.wentPoorly?.length ?? 0}
        missing={missing.has("wentPoorly")}
      >
        <ul>
          {r.wentPoorly?.map((c, i) => (
            <ListItem
              key={i}
              tone="negative"
              category={c.category}
              title={c.title}
              detail={c.detail}
              cite={c.cite}
              extra={
                c.fix ? (
                  <p className="text-[13px] text-muted-foreground leading-[1.55] mt-2">
                    <span className="text-foreground">Fix. </span>
                    {c.fix}
                  </p>
                ) : null
              }
            />
          ))}
        </ul>
      </Panel>

      {/* Critical Moments */}
      <Panel
        title="Critical moments"
        count={r.criticalMoments?.length ?? 0}
        missing={missing.has("criticalMoments")}
      >
        <ul>
          {r.criticalMoments?.map((m, i) => (
            <ListItem
              key={i}
              tone="neutral"
              category={m.parties}
              title={m.what}
              detail={m.why}
              cite={m.page}
            />
          ))}
        </ul>
      </Panel>

      {/* Witnesses */}
      <Panel
        title="Witness performance"
        count={r.witnesses?.length ?? 0}
        missing={missing.has("witnesses")}
      >
        <ul>
          {r.witnesses?.map((w, i) => (
            <li
              key={i}
              className={`relative pl-4 py-3 border-b border-border last:border-b-0 before:content-[''] before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[2px] ${toneBar[credibilityTone[w.credibility] ?? "neutral"]}`}
            >
              <p className="text-[11px] text-muted-foreground mb-0.5">
                {w.role} · {w.credibility}
              </p>
              <p className="text-[14px] font-medium text-foreground leading-snug">{w.name}</p>
              <div className="text-[13px] text-muted-foreground leading-[1.55] mt-1 space-y-1">
                <p>
                  <span className="text-foreground">Best. </span>
                  {w.bestMoment}
                </p>
                <p>
                  <span className="text-foreground">Worst. </span>
                  {w.worstMoment}
                </p>
                <p>
                  <span className="text-foreground">Strategic value. </span>
                  {w.strategicValue}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {/* Objections */}
      <Panel
        title="Objections & rulings"
        count={r.objections?.length ?? 0}
        missing={missing.has("objections")}
      >
        <ul>
          {r.objections?.map((o, i) => (
            <ListItem
              key={i}
              tone={rulingTone(o.ruling)}
              category={`${o.party} · ${o.ruling}`}
              title={o.grounds}
              detail={o.significance}
            />
          ))}
        </ul>
      </Panel>

      {/* Jury Charge */}
      <Panel
        title="Jury charge issues"
        count={r.juryChargeIssues?.length ?? 0}
        missing={missing.has("juryChargeIssues")}
      >
        <ul>
          {r.juryChargeIssues?.map((j, i) => (
            <li
              key={i}
              className="relative pl-4 py-3 border-b border-border last:border-b-0 before:content-[''] before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[2px] before:bg-border"
            >
              <p className="text-[14px] font-medium text-foreground leading-snug">{j.dispute}</p>
              <div className="text-[13px] text-muted-foreground leading-[1.55] mt-1 space-y-1">
                <p>
                  <span className="text-foreground">Plaintiff. </span>
                  {j.plaintiffArg}
                </p>
                <p>
                  <span className="text-foreground">Defense. </span>
                  {j.defenseArg}
                </p>
                <p>
                  <span className="text-foreground">Resolution. </span>
                  {j.resolution}
                </p>
                <p>
                  <span className="text-foreground">Impact. </span>
                  {j.impact}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {/* Recommendations */}
      <Panel
        title="Strategic recommendations"
        count={r.recommendations?.length ?? 0}
        missing={missing.has("recommendations")}
      >
        <ul>
          {r.recommendations?.map((rec, i) => (
            <li
              key={i}
              className="relative pl-4 py-3 border-b border-border last:border-b-0 before:content-[''] before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[2px] before:bg-border"
            >
              <p className="text-[11px] text-muted-foreground mb-0.5 tabular-nums">
                {String(i + 1).padStart(2, "0")}
              </p>
              <p className="text-[14px] text-foreground leading-[1.55]">{rec}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="mt-10 pt-4 border-t border-border">
        <p className="text-[11px] text-muted-foreground">
          Analysis generated by VerdictIQ · {new Date(stored.createdAt).toLocaleString()}
        </p>
      </div>
    </div>
  );
}
