-- Create matters table
CREATE TABLE public.matters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived boolean NOT NULL DEFAULT false,
  CONSTRAINT matters_name_length CHECK (char_length(name) BETWEEN 1 AND 300)
);

ALTER TABLE public.matters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can read matters"
  ON public.matters FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "anon can insert matters"
  ON public.matters FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "anon can update matters"
  ON public.matters FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "anon can delete matters"
  ON public.matters FOR DELETE
  TO anon, authenticated
  USING (true);

-- Add matter_id to cases
ALTER TABLE public.cases
  ADD COLUMN matter_id uuid REFERENCES public.matters(id) ON DELETE SET NULL;

CREATE INDEX idx_cases_matter_id ON public.cases(matter_id);

-- Add matter_id to analysis_jobs
ALTER TABLE public.analysis_jobs
  ADD COLUMN matter_id uuid REFERENCES public.matters(id) ON DELETE SET NULL;

CREATE INDEX idx_analysis_jobs_matter_id ON public.analysis_jobs(matter_id);
