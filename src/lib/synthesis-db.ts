import { supabase } from "@/integrations/supabase/client";
import type { CaseSynthesis, MatterSynthesisRow } from "./analysis-types";

function rowToSynthesis(r: {
  id: string;
  matter_id: string;
  result: unknown;
  case_ids: string[];
  created_at: string;
  status: string;
  progress: number;
  progress_message: string | null;
  error: string | null;
  failed_sections?: unknown;
}): MatterSynthesisRow {
  return {
    id: r.id,
    matterId: r.matter_id,
    result: (r.result as CaseSynthesis | null) ?? null,
    caseIds: r.case_ids ?? [],
    createdAt: new Date(r.created_at).getTime(),
    status: (r.status as MatterSynthesisRow["status"]) ?? "pending",
    progress: r.progress ?? 0,
    progressMessage: r.progress_message,
    error: r.error,
    failedSections: Array.isArray(r.failed_sections)
      ? (r.failed_sections as string[])
      : [],
  };
}

export async function getSynthesisFromDb(
  id: string,
): Promise<MatterSynthesisRow | null> {
  const { data, error } = await supabase
    .from("matter_syntheses")
    .select(
      "id, matter_id, result, case_ids, created_at, status, progress, progress_message, error, failed_sections",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return rowToSynthesis(data);
}

export async function getLatestSynthesisForMatter(
  matterId: string,
): Promise<MatterSynthesisRow | null> {
  const { data, error } = await supabase
    .from("matter_syntheses")
    .select(
      "id, matter_id, result, case_ids, created_at, status, progress, progress_message, error, failed_sections",
    )
    .eq("matter_id", matterId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return rowToSynthesis(data);
}

export async function markSynthesisProcessorNeverStarted(id: string): Promise<void> {
  const { error } = await supabase
    .from("matter_syntheses")
    .update({
      status: "error",
      error: "Synthesis processor never started. Click Re-run to try again.",
      progress_message: "Synthesis failed.",
    })
    .eq("id", id)
    .eq("status", "pending")
    .eq("progress", 0);
  if (error) throw error;
}

export async function deleteSynthesisFromDb(id: string): Promise<void> {
  const { error } = await supabase.from("matter_syntheses").delete().eq("id", id);
  if (error) throw error;
}

export async function submitSynthesis(matterId: string): Promise<string> {
  const res = await fetch("/api/synthesize/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matterId }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    synthesisId?: string;
    error?: string;
  };
  if (!res.ok || !json.synthesisId) {
    throw new Error(json.error ?? "Failed to start synthesis.");
  }
  return json.synthesisId;
}