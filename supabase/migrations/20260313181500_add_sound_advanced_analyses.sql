create table if not exists public.sound_advanced_analyses (
  id uuid primary key default gen_random_uuid(),
  test_result_id uuid not null references public.module_test_results(id) on delete cascade,
  reference_or_attempt text not null check (reference_or_attempt in ('reference', 'attempt')),
  file_url text,
  analysis_version text not null default 'adv-sound-v1',
  label text,
  summary jsonb not null default '{}'::jsonb,
  pauses jsonb not null default '{}'::jsonb,
  phrasing jsonb not null default '{}'::jsonb,
  elongation jsonb not null default '{}'::jsonb,
  intonation jsonb not null default '{}'::jsonb,
  rhythm jsonb not null default '{}'::jsonb,
  llm_payload jsonb,
  visualization jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sound_advanced_analyses_test_result_id_idx
  on public.sound_advanced_analyses(test_result_id);

alter table public.sound_advanced_analyses enable row level security;

create policy "Users can manage own sound advanced analyses"
on public.sound_advanced_analyses
for all
to authenticated
using (
  exists (
    select 1
    from public.module_test_results r
    join public.module_tests t on t.id = r.test_id
    where r.id = test_result_id and t.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.module_test_results r
    join public.module_tests t on t.id = r.test_id
    where r.id = test_result_id and t.user_id = auth.uid()
  )
);

create policy "Admin can view all sound advanced analyses"
on public.sound_advanced_analyses
for select
to authenticated
using (public.has_role(auth.uid(), 'admin'));
