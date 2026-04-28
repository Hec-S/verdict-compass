ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS deposition_card jsonb;

CREATE TABLE IF NOT EXISTS public.matter_syntheses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  result jsonb,
  case_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  progress int NOT NULL DEFAULT 0,
  progress_message text,
  error text
);

CREATE INDEX IF NOT EXISTS matter_syntheses_matter_id_idx
  ON public.matter_syntheses(matter_id, created_at DESC);

ALTER TABLE public.matter_syntheses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can read matter_syntheses"
  ON public.matter_syntheses FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "anon can insert matter_syntheses"
  ON public.matter_syntheses FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "anon can update matter_syntheses"
  ON public.matter_syntheses FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "anon can delete matter_syntheses"
  ON public.matter_syntheses FOR DELETE
  TO anon, authenticated
  USING (true);