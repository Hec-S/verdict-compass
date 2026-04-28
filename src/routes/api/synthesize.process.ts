import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { callClaude } from "./analyze.process";
import type { DepositionCard, CaseSynthesis } from "@/lib/analysis-types";

const InputSchema = z.object({ synthesisId: z.string().uuid() });

function getEnv(key: string): string | undefined {
  const g = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
    Deno?: { env?: { get?: (k: string) => string | undefined } };
  };
  return g.process?.env?.[key] ?? g.Deno?.env?.get?.(key);
}

interface CaseRow {
  id: string;
  case_name: string;
  result: unknown;
  case_snapshot: unknown;
  deposition_card: DepositionCard | null;
}

interface MatterRow {
  id: string;
  name: string;
  description: string | null;
}

/**
 * Stage A — Per-deposition extraction. Stub. Prompt 2 will fill in the
 * actual prompt and parsing. For now this throws "not implemented".
 */
export async function extractDepositionCard(
  _apiKey: string,
  _caseRow: CaseRow,
): Promise<DepositionCard> {
  // Reference callClaude so the import is retained when the stub is replaced.
  void callClaude;
  throw new Error("extractDepositionCard not implemented");
}

/**
 * Stage B — Case-level synthesis. Stub. Prompt 2 will fill this in.
 */
export async function synthesizeMatter(
  _apiKey: string,
  _matter: MatterRow,
  _cards: DepositionCard[],
): Promise<CaseSynthesis> {
  void callClaude;
  throw new Error("synthesizeMatter not implemented");
}

async function updateSynthesis(
  supabase: SupabaseClient,
  id: string,
  fields: Record<string, unknown>,
) {
  const { error } = await supabase.from("matter_syntheses").update(fields).eq("id", id);
  if (error) console.error("[synthesize.process] updateSynthesis error:", error.message);
}

async function runSynthesis(
  supabase: SupabaseClient,
  synthesisId: string,
  apiKey: string,
) {
  console.log(`[synthesize.process] starting ${synthesisId}`);
  try {
    const { data: row, error: rErr } = await supabase
      .from("matter_syntheses")
      .select("id, matter_id, status, case_ids")
      .eq("id", synthesisId)
      .single();
    if (rErr || !row) throw new Error(rErr?.message ?? "Synthesis not found");
    if (row.status !== "pending") {
      console.log(`[synthesize.process] already ${row.status}, skipping`);
      return;
    }

    await updateSynthesis(supabase, synthesisId, {
      status: "processing",
      progress: 5,
      progress_message: "Loading matter…",
    });

    const { data: matter, error: mErr } = await supabase
      .from("matters")
      .select("id, name, description")
      .eq("id", row.matter_id)
      .single();
    if (mErr || !matter) throw new Error(mErr?.message ?? "Matter not found");

    const { data: cases, error: cErr } = await supabase
      .from("cases")
      .select("id, case_name, result, case_snapshot, deposition_card")
      .in("id", row.case_ids as string[]);
    if (cErr) throw new Error(cErr.message);
    const caseRows = (cases ?? []) as CaseRow[];
    if (caseRows.length === 0) throw new Error("No cases found for synthesis.");

    // Stage A — extract any missing deposition cards.
    const cards: DepositionCard[] = [];
    let idx = 0;
    for (const c of caseRows) {
      idx += 1;
      if (c.deposition_card) {
        cards.push(c.deposition_card);
        continue;
      }
      await updateSynthesis(supabase, synthesisId, {
        progress: Math.min(10 + Math.floor((idx / caseRows.length) * 70), 80),
        progress_message: `Extracting deposition card ${idx} of ${caseRows.length}…`,
      });
      const card = await extractDepositionCard(apiKey, c);
      const { error: upErr } = await supabase
        .from("cases")
        .update({ deposition_card: card })
        .eq("id", c.id);
      if (upErr) {
        console.error(
          `[synthesize.process] failed to persist deposition_card for ${c.id}:`,
          upErr.message,
        );
      }
      cards.push(card);
    }

    // Stage B — synthesize.
    await updateSynthesis(supabase, synthesisId, {
      progress: 85,
      progress_message: "Running case-level synthesis…",
    });
    const result = await synthesizeMatter(apiKey, matter as MatterRow, cards);

    await updateSynthesis(supabase, synthesisId, {
      status: "complete",
      progress: 100,
      progress_message: "Synthesis complete.",
      result,
    });
    console.log(`[synthesize.process] ${synthesisId} complete`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[synthesize.process] ${synthesisId} fatal:`, message);
    await updateSynthesis(supabase, synthesisId, {
      status: "error",
      error: message,
      progress_message: "Synthesis failed.",
    });
  }
}

export const Route = createFileRoute("/api/synthesize/process")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        let parsed: z.infer<typeof InputSchema>;
        try {
          parsed = InputSchema.parse(await request.json());
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "Invalid input" },
            { status: 400 },
          );
        }
        const SUPABASE_URL = getEnv("SUPABASE_URL") ?? getEnv("VITE_SUPABASE_URL");
        const SUPABASE_KEY =
          getEnv("SUPABASE_PUBLISHABLE_KEY") ?? getEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
        const apiKey = getEnv("ANTHROPIC_API_KEY");
        if (!SUPABASE_URL || !SUPABASE_KEY || !apiKey) {
          return Response.json({ error: "Backend not configured" }, { status: 500 });
        }
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        await runSynthesis(supabase, parsed.synthesisId, apiKey);
        return Response.json({ ok: true });
      },
    },
  },
});