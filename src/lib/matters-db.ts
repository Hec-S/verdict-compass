import { supabase } from "@/integrations/supabase/client";
import type { CaseListRow } from "./cases-db";
import type { CaseSnapshot } from "./analysis-types";

export interface MatterRow {
  id: string;
  name: string;
  description: string | null;
  createdAt: number;
  archived: boolean;
}

export interface MatterWithCount extends MatterRow {
  caseCount: number;
}

function rowToMatter(r: {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  archived: boolean;
}): MatterRow {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    createdAt: new Date(r.created_at).getTime(),
    archived: r.archived,
  };
}

export async function listMattersFromDb(): Promise<MatterWithCount[]> {
  const { data: matters, error } = await supabase
    .from("matters")
    .select("id, name, description, created_at, archived")
    .eq("archived", false)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  if (!matters || matters.length === 0) return [];

  const ids = matters.map((m) => m.id);
  const { data: cases, error: casesErr } = await supabase
    .from("cases")
    .select("matter_id")
    .eq("archived", false)
    .in("matter_id", ids);
  if (casesErr) throw casesErr;

  const counts = new Map<string, number>();
  for (const c of cases ?? []) {
    if (!c.matter_id) continue;
    counts.set(c.matter_id, (counts.get(c.matter_id) ?? 0) + 1);
  }

  return matters.map((m) => ({
    ...rowToMatter(m),
    caseCount: counts.get(m.id) ?? 0,
  }));
}

export async function countUnfiledCasesFromDb(): Promise<number> {
  const { count, error } = await supabase
    .from("cases")
    .select("id", { count: "exact", head: true })
    .eq("archived", false)
    .is("matter_id", null);
  if (error) throw error;
  return count ?? 0;
}

export async function getMatterFromDb(
  id: string,
): Promise<{ matter: MatterRow; cases: CaseListRow[] } | null> {
  const { data: matter, error } = await supabase
    .from("matters")
    .select("id, name, description, created_at, archived")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!matter) return null;

  const { data: cases, error: casesErr } = await supabase
    .from("cases")
    .select("id, case_name, created_at, case_snapshot, outcome, matter_id")
    .eq("archived", false)
    .eq("matter_id", id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (casesErr) throw casesErr;

  return {
    matter: rowToMatter(matter),
    cases: (cases ?? []).map((r) => ({
      id: r.id,
      caseName: r.case_name,
      createdAt: new Date(r.created_at).getTime(),
      snapshot: (r.case_snapshot as CaseSnapshot | null) ?? null,
      outcome: r.outcome,
      matterId: r.matter_id,
    })),
  };
}

export async function createMatterInDb(
  name: string,
  description?: string | null,
): Promise<MatterRow> {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 300) {
    throw new Error("Matter name must be 1–300 characters.");
  }
  const { data, error } = await supabase
    .from("matters")
    .insert({ name: trimmed, description: description?.trim() || null })
    .select("id, name, description, created_at, archived")
    .single();
  if (error || !data) throw error ?? new Error("Failed to create matter.");
  return rowToMatter(data);
}

export async function updateMatterInDb(
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<void> {
  const update: { name?: string; description?: string | null } = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (trimmed.length < 1 || trimmed.length > 300) {
      throw new Error("Matter name must be 1–300 characters.");
    }
    update.name = trimmed;
  }
  if (patch.description !== undefined) {
    update.description = patch.description?.trim() || null;
  }
  if (Object.keys(update).length === 0) return;
  const { error } = await supabase.from("matters").update(update).eq("id", id);
  if (error) throw error;
}

export async function deleteMatterFromDb(id: string): Promise<void> {
  const { error } = await supabase.from("matters").delete().eq("id", id);
  if (error) throw error;
}