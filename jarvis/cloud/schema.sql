-- Additive migration for the Jarvis desktop/mobile settings profile.
-- Existing project resources are intentionally not modified.
create table if not exists public.jarvis_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.jarvis_profiles enable row level security;

-- Re-runnable policies: only the owning authenticated user can access one row.
drop policy if exists jarvis_profiles_select_owner on public.jarvis_profiles;
drop policy if exists jarvis_profiles_insert_owner on public.jarvis_profiles;
drop policy if exists jarvis_profiles_update_owner on public.jarvis_profiles;
drop policy if exists jarvis_profiles_delete_owner on public.jarvis_profiles;
create policy jarvis_profiles_select_owner on public.jarvis_profiles for select to authenticated using (auth.uid() = id);
create policy jarvis_profiles_insert_owner on public.jarvis_profiles for insert to authenticated with check (auth.uid() = id);
create policy jarvis_profiles_update_owner on public.jarvis_profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy jarvis_profiles_delete_owner on public.jarvis_profiles for delete to authenticated using (auth.uid() = id);

grant select, insert, update, delete on table public.jarvis_profiles to authenticated;
revoke all on table public.jarvis_profiles from anon;
