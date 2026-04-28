import { supabase } from "@/integrations/supabase/client";
import { normalizeResult } from "./normalize-result";
import type { CaseSnapshot, StoredCase } from "./analysis-types";

export interface CaseListRow {
  id: string;
  caseName: string;
  createdAt: number;
  snapshot: CaseSnapshot | null;
  outcome: string | null;
}

export async function listCasesFromDb(): Promise<CaseListRow[]> {
  const { data, error } = await supabase
    .from("cases")
    .select("id, case_name, created_at, case_snapshot, outcome")
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
  }));
}

export async function getCaseFromDb(id: string): Promise<StoredCase | null> {
  const { data, error } = await supabase
    .from("cases")
    .select("id, case_name, created_at, result")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { result, missing } = normalizeResult(data.result);
  return {
    id: data.id,
    caseName: data.case_name,
    createdAt: new Date(data.created_at).getTime(),
    truncated: false,
    result,
    missingSections: missing,
  };
}