-- Storage for the serverless deployment (server/src/cloud.ts): the course's
-- SQLite database as one versioned row, and uploaded files. Nothing here is
-- reachable directly: row level security is on with no policies, and the
-- functions below work only with the deployment's secret (KKS_SECRET), whose
-- SHA-256 hash is stored in kks_secret.

create table if not exists public.kks_state (
  id int primary key check (id = 1),
  version bigint not null,
  data text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.kks_files (
  name text primary key,
  data text not null,
  size int not null,
  created_at timestamptz not null default now()
);

create table if not exists public.kks_secret (
  id int primary key check (id = 1),
  hash text not null
);

alter table public.kks_state enable row level security;
alter table public.kks_files enable row level security;
alter table public.kks_secret enable row level security;
revoke all on public.kks_state, public.kks_files, public.kks_secret from anon, authenticated;

create or replace function public.kks_check(p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or not exists (
    select 1 from public.kks_secret where id = 1 and hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')
  ) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
end $$;

create or replace function public.kks_version(p_secret text) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  perform public.kks_check(p_secret);
  return (select version from public.kks_state where id = 1);
end $$;

create or replace function public.kks_load(p_secret text) returns table (version bigint, data text)
language plpgsql security definer set search_path = public as $$
begin
  perform public.kks_check(p_secret);
  return query select s.version, s.data from public.kks_state s where s.id = 1;
end $$;

-- saves only if nobody saved since p_expected (0: the first save)
create or replace function public.kks_save(p_secret text, p_expected bigint, p_data text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public.kks_check(p_secret);
  if p_expected = 0 then
    insert into public.kks_state (id, version, data) values (1, 1, p_data) on conflict (id) do nothing;
    return found;
  end if;
  update public.kks_state set version = version + 1, data = p_data, updated_at = now()
    where id = 1 and version = p_expected;
  return found;
end $$;

create or replace function public.kks_put_file(p_secret text, p_name text, p_data text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.kks_check(p_secret);
  insert into public.kks_files (name, data, size) values (p_name, p_data, length(p_data))
    on conflict (name) do update set data = excluded.data, size = excluded.size;
end $$;

create or replace function public.kks_get_file(p_secret text, p_name text) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform public.kks_check(p_secret);
  return (select data from public.kks_files where name = p_name);
end $$;

create or replace function public.kks_delete_file(p_secret text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.kks_check(p_secret);
  delete from public.kks_files where name = p_name;
end $$;

revoke execute on function public.kks_check(text) from public, anon, authenticated;
revoke execute on function public.kks_version(text), public.kks_load(text), public.kks_save(text, bigint, text),
  public.kks_put_file(text, text, text), public.kks_get_file(text, text), public.kks_delete_file(text, text) from public;
grant execute on function public.kks_version(text), public.kks_load(text), public.kks_save(text, bigint, text),
  public.kks_put_file(text, text, text), public.kks_get_file(text, text), public.kks_delete_file(text, text) to anon;
