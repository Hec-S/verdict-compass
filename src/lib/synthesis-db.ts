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
  };
}

export async function getSynthesisFromDb(
  id: string,
): Promise<MatterSynthesisRow | null> {
  const { data, error } = await supabase
    .from("matter_syntheses")
    .select(
      "id, matter_id, result, case_ids, created_at, status, progress, progress_message, error",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return rowToSynthesis(data);
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