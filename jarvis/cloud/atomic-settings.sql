-- Additive migration: atomically merge only an authenticated owner's settings patch.
create or replace function public.jarvis_merge_settings(p_patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_settings jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Patch must be a non-empty object' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('voice','weatherCity','alwaysOnTop','wakeEnabled','brainProvider','localModel','groqModel') limit 1) then
    raise exception 'Unknown settings key' using errcode = '22023';
  end if;
  if p_patch ? 'voice' and (jsonb_typeof(p_patch->'voice') <> 'string'
      or btrim(p_patch->>'voice') = '' or length(p_patch->>'voice') > 64
      or p_patch->>'voice' !~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$') then
    raise exception 'Invalid voice' using errcode = '22023';
  end if;
  if p_patch ? 'weatherCity' and (jsonb_typeof(p_patch->'weatherCity') <> 'string'
      or btrim(p_patch->>'weatherCity') = '' or length(p_patch->>'weatherCity') > 200) then
    raise exception 'Invalid weatherCity' using errcode = '22023';
  end if;
  if p_patch ? 'alwaysOnTop' and jsonb_typeof(p_patch->'alwaysOnTop') <> 'boolean' then
    raise exception 'Invalid alwaysOnTop' using errcode = '22023';
  end if;
  if p_patch ? 'wakeEnabled' and jsonb_typeof(p_patch->'wakeEnabled') <> 'boolean' then
    raise exception 'Invalid wakeEnabled' using errcode = '22023';
  end if;
  if p_patch ? 'brainProvider' and (jsonb_typeof(p_patch->'brainProvider') <> 'string'
      or p_patch->>'brainProvider' not in ('local','groq')) then
    raise exception 'Invalid brainProvider' using errcode = '22023';
  end if;
  if p_patch ? 'localModel' and (jsonb_typeof(p_patch->'localModel') <> 'string'
      or btrim(p_patch->>'localModel') = '' or length(p_patch->>'localModel') > 200) then
    raise exception 'Invalid localModel' using errcode = '22023';
  end if;
  if p_patch ? 'groqModel' and (jsonb_typeof(p_patch->'groqModel') <> 'string'
      or btrim(p_patch->>'groqModel') = '' or length(p_patch->>'groqModel') > 200) then
    raise exception 'Invalid groqModel' using errcode = '22023';
  end if;

  insert into public.jarvis_profiles as p (id, settings, updated_at)
  values (v_uid, p_patch, now())
  on conflict (id) do update
    set settings = coalesce(p.settings, '{}'::jsonb) || excluded.settings,
        updated_at = now()
  returning settings into v_settings;
  return v_settings;
end;
$$;

revoke execute on function public.jarvis_merge_settings(jsonb) from public, anon;
grant execute on function public.jarvis_merge_settings(jsonb) to authenticated;
