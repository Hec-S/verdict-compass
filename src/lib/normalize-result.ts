import type { AnalysisResult } from "./analysis-types";

const ARRAY_KEYS = [
  "wentWell",
  "wentPoorly",
  "criticalMoments",
  "witnesses",
  "objections",
  "juryChargeIssues",
  "recommendations",
] as const;

export function normalizeResult(raw: unknown): {
  result: AnalysisResult;
  missing: string[];
} {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const missing: string[] = [];

  const snap = (obj.caseSnapshot && typeof obj.caseSnapshot === "object"
    ? obj.caseSnapshot
    : {}) as Record<string, unknown>;
  if (!obj.caseSnapshot) missing.push("caseSnapshot");

  const result = {
    caseSnapshot: {
      caseName: String(snap.caseName ?? ""),
      court: String(snap.court ?? ""),
      posture: String(snap.posture ?? ""),
      plaintiff: String(snap.plaintiff ?? ""),
      defendant: String(snap.defendant ?? ""),
      filed: String(snap.filed ?? ""),
      outcome: String(snap.outcome ?? ""),
      bottomLine: String(snap.bottomLine ?? ""),
    },
  } as AnalysisResult;

  for (const key of ARRAY_KEYS) {
    const val = obj[key];
    if (Array.isArray(val)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[key] = val;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[key] = [];
      missing.push(key);
    }
  }

  return { result, missing };
}