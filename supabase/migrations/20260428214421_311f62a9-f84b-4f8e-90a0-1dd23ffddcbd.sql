ALTER TABLE public.matter_syntheses
  ADD COLUMN IF NOT EXISTS failed_sections jsonb NOT NULL DEFAULT '[]'::jsonb;