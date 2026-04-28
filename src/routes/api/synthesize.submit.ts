import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { runSynthesis, runSynthesisRetrySections } from "./synthesize.process";

const InputSchema = z.union([
  z.object({ matterId: z.string().uuid() }),
  z.object({
    synthesisId: z.string().uuid(),
    retrySections: z.array(z.string()).min(1),
  }),
]);

type WaitUntilContext = { waitUntil?: (promise: Promise<unknown>) => void };

function getEnv(key: string): string | undefined {
  const g = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
    Deno?: { env?: { get?: (k: string) => string | undefined } };
  };
  return g.process?.env?.[key] ?? g.Deno?.env?.get?.(key);
}

export const Route = createFileRoute("/api/synthesize/submit")({
  server: {
    handlers: {
      POST: async ({ request, context }: { request: Request; context?: unknown }) => {
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
        if (!SUPABASE_URL || !SUPABASE_KEY) {
          return Response.json({ error: "Backend not configured" }, { status: 500 });
        }
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

        // ---------- Retry-failed-sections branch ----------
        if ("synthesisId" in parsed) {
          const task = runSynthesisRetrySections(
            parsed.synthesisId,
            parsed.retrySections,
          ).catch(async (err) => {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[synthesize.submit] retry failed:", message);
            await supabase
              .from("matter_syntheses")
              .update({
                status: "error",
                error: message,
                progress_message: "Retry failed.",
              })
              .eq("id", parsed.synthesisId);
          });
          const ctx = context as WaitUntilContext | undefined;
          if (typeof ctx?.waitUntil === "function") ctx.waitUntil(task);
          else void task;
          return Response.json({ synthesisId: parsed.synthesisId });
        }

        // Validate matter and ensure at least 2 cases
        const { data: matter, error: mErr } = await supabase
          .from("matters")
          .select("id")
          .eq("id", parsed.matterId)
          .maybeSingle();
        if (mErr) {
          return Response.json({ error: mErr.message }, { status: 500 });
        }
        if (!matter) {
          return Response.json({ error: "Matter not found" }, { status: 404 });
        }

        const { data: cases, error: cErr } = await supabase
          .from("cases")
          .select("id")
          .eq("matter_id", parsed.matterId)
          .eq("archived", false);
        if (cErr) {
          return Response.json({ error: cErr.message }, { status: 500 });
        }
        const caseIds = (cases ?? []).map((c) => c.id);
        if (caseIds.length < 2) {
          return Response.json(
            { error: "Matter needs at least 2 cases to run synthesis." },
            { status: 400 },
          );
        }

        const { data: inserted, error: iErr } = await supabase
          .from("matter_syntheses")
          .insert({
            matter_id: parsed.matterId,
            case_ids: caseIds,
            status: "pending",
            progress: 0,
            progress_message: "Queued…",
          })
          .select("id")
          .single();
        if (iErr || !inserted) {
          return Response.json(
            { error: iErr?.message ?? "Failed to create synthesis" },
            { status: 500 },
          );
        }

        const task = runSynthesis(inserted.id).catch(async (err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[synthesize.submit] background synthesis failed:", message);
          await supabase
            .from("matter_syntheses")
            .update({
              status: "error",
              error: message,
              progress_message: "Synthesis failed.",
            })
            .eq("id", inserted.id);
        });

        const ctx = context as WaitUntilContext | undefined;
        if (typeof ctx?.waitUntil === "function") {
          ctx.waitUntil(task);
        } else {
          void task;
        }

        return Response.json({ synthesisId: inserted.id });
      },
    },
  },
});