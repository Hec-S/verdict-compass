import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const TRANSCRIPT_CHAR_LIMIT = 60_000;

const InputSchema = z.object({
  caseName: z.string().min(1).max(300),
  transcript: z.string().min(50).max(120_000),
});

function getEnv(key: string): string | undefined {
  const g = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
    Deno?: { env?: { get?: (k: string) => string | undefined } };
  };
  return g.process?.env?.[key] ?? g.Deno?.env?.get?.(key);
}

function cleanTranscript(raw: string): string {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => !/^\d{1,4}$/.test(l))
    .filter((l) => l.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, TRANSCRIPT_CHAR_LIMIT);
}

export const Route = createFileRoute("/api/analyze/submit")({
  // @ts-expect-error - TanStack server route typing
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

        const cleaned = cleanTranscript(parsed.transcript);

        const { data, error } = await supabase
          .from("analysis_jobs")
          .insert({
            case_name: parsed.caseName,
            transcript_text: cleaned,
            status: "pending",
            progress: 0,
            progress_message: "Queued…",
          })
          .select("id")
          .single();

        if (error || !data) {
          return Response.json(
            { error: error?.message ?? "Failed to create job" },
            { status: 500 },
          );
        }

        return Response.json({ jobId: data.id });
      },
    },
  },
});