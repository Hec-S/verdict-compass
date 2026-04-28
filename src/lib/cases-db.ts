import { supabase } from "@/integrations/supabase/client";
import { normalizeResult } from "./normalize-result";
import type { CaseSnapshot, StoredCase } from "./analysis-types";
import type { ClientTraceEvent } from "./debug-trace";

export interface CaseListRow {
  id: string;
  caseName: string;
  createdAt: number;
  snapshot: CaseSnapshot | null;
  outcome: string | null;
  matterId: string | null;
}

export async function listCasesFromDb(): Promise<CaseListRow[]> {
  const { data, error } = await supabase
    .from("cases")
    .select("id, case_name, created_at, case_snapshot, outcome, matter_id")
    .eq("archived", false)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    caseName: r.case_name,
    createdAt: new Date(r.created_at).getTime(),
    snapshot: (r.case_snapshot as CaseSnapshot | null) ?? null,
    outcome: r.outcome,
    matterId: r.matter_id,
  }));
}

export async function listUnfiledCasesFromDb(): Promise<CaseListRow[]> {
  const { data, error } = await supabase
    .from("cases")
    .select("id, case_name, created_at, case_snapshot, outcome, matter_id")
    .eq("archived", false)
    .is("matter_id", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    caseName: r.case_name,
    createdAt: new Date(r.created_at).getTime(),
    snapshot: (r.case_snapshot as CaseSnapshot | null) ?? null,
    outcome: r.outcome,
    matterId: r.matter_id,
  }));
}

export async function listCasesByMatterFromDb(matterId: string): Promise<CaseListRow[]> {
  const { data, error } = await supabase
    .from("cases")
    .select("id, case_name, created_at, case_snapshot, outcome, matter_id")
    .eq("archived", false)
    .eq("matter_id", matterId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    caseName: r.case_name,
    createdAt: new Date(r.created_at).getTime(),
    snapshot: (r.case_snapshot as CaseSnapshot | null) ?? null,
    outcome: r.outcome,
    matterId: r.matter_id,
  }));
}

export async function assignCaseToMatter(
  caseId: string,
  matterId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("cases")
    .update({ matter_id: matterId })
    .eq("id", caseId);
  if (error) throw error;
}

export async function getCaseFromDb(id: string): Promise<StoredCase | null> {
  const { data, error } = await supabase
    .from("cases")
    .select("id, case_name, created_at, result, debug_trace")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { result, missing } = normalizeResult(data.result);
  const serverTrace = Array.isArray(data.debug_trace)
    ? (data.debug_trace as unknown as ClientTraceEvent[])
    : [];
  return {
    id: data.id,
    caseName: data.case_name,
    createdAt: new Date(data.created_at).getTime(),
    truncated: false,
    result,
    missingSections: missing,
    serverTrace,
  };
}

export async function updateCaseNameInDb(id: string, caseName: string): Promise<void> {
  const { error } = await supabase
    .from("cases")
    .update({ case_name: caseName })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteCaseFromDb(id: string): Promise<void> {
  const { data: row, error: fetchErr } = await supabase
    .from("cases")
    .select("job_id")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) throw fetchErr;

  const { error } = await supabase.from("cases").delete().eq("id", id);
  if (error) throw error;

  if (row?.job_id) {
    const { error: jobErr } = await supabase
      .from("analysis_jobs")
      .delete()
      .eq("id", row.job_id);
    if (jobErr) throw jobErr;
  }
}