import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const InputSchema = z.object({ matterId: z.string().uuid() });

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
        if (!SUPABASE_URL || !SUPABASE_KEY) {
          return Response.json({ error: "Backend not configured" }, { status: 500 });
        }
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

        // Fire-and-forget: kick off the process route.
        const url = new URL(request.url);
        const processUrl = `${url.origin}/api/synthesize/process`;
        try {
          // Don't await — same fire-and-forget pattern as analyze.submit.
          void fetch(processUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ synthesisId: inserted.id }),
          }).catch((err) => {
            console.error("[synthesize.submit] background fetch error:", err);
          });
        } catch (err) {
          console.error("[synthesize.submit] dispatch failed:", err);
        }

        return Response.json({ synthesisId: inserted.id });
      },
    },
  },
});