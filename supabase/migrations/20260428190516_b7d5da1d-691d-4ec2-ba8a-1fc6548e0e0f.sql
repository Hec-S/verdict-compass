alter table public.analysis_jobs add column if not exists debug_trace jsonb;
alter table public.cases add column if not exists debug_trace jsonb;