-- First delivery: one private household per Google account, versioned state document.
-- Recipes are bundled in the client. Shared households/recipe publishing are later migrations.
begin;
create table public.households (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  state jsonb not null check (
    jsonb_typeof(state) = 'object' and state ?& array['version', 'household', 'plans'] and state @> '{"version":1}'::jsonb
    and jsonb_typeof(state->'household') = 'object'
    and jsonb_typeof(state->'plans') = 'array'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.households enable row level security;
revoke all on public.households from anon;
grant select, insert, update, delete on public.households to authenticated;
create policy "Owner reads household" on public.households for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owner creates household" on public.households for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Owner updates household" on public.households for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Owner deletes household" on public.households for delete to authenticated using (owner_id = (select auth.uid()));
create function public.touch_household_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger household_updated_at before update on public.households for each row execute function public.touch_household_updated_at();
commit;
