create table public.cases (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  case_name text not null default '',
  job_id uuid references public.analysis_jobs(id) on delete set null,
  result jsonb not null,
  case_snapshot jsonb,
  outcome text,
  starred boolean not null default false,
  archived boolean not null default false
);

create index cases_created_idx on public.cases (created_at desc);
create index cases_user_created_idx on public.cases (user_id, created_at desc);

alter table public.cases enable row level security;

create policy "anon can read cases" on public.cases
  for select to anon, authenticated using (true);

create policy "anon can insert cases" on public.cases
  for insert to anon, authenticated with check (true);

create policy "anon can update cases" on public.cases
  for update to anon, authenticated using (true) with check (true);

create policy "anon can delete cases" on public.cases
  for delete to anon, authenticated using (true);