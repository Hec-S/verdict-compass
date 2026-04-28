create table public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  case_name text not null default '',
  status text not null default 'pending',
  progress int not null default 0,
  progress_message text not null default 'Queued...',
  transcript_text text,
  result jsonb,
  failed_sections jsonb not null default '[]'::jsonb,
  error text
);

alter table public.analysis_jobs enable row level security;

-- Public app (no auth yet) — allow anonymous insert + select on rows you own by id.
-- Since the app has no auth, allow read/insert/update from anon role.
create policy "anon can insert jobs"
  on public.analysis_jobs for insert
  to anon, authenticated
  with check (true);

create policy "anon can read jobs"
  on public.analysis_jobs for select
  to anon, authenticated
  using (true);

create policy "anon can update jobs"
  on public.analysis_jobs for update
  to anon, authenticated
  using (true)
  with check (true);
