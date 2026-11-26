-- Closes the database functions of the alternative path (KKS_SECRET, 0001_kks_storage.sql).
--
-- The active deployment reaches the data only through the kks-store function (supabase/functions/kks-store),
-- which checks Vercel's identity token and works on the tables with the service role - it calls none of these
-- functions. Once this runs, nothing in the database can be called from outside, not even with a guessed secret:
-- the functions answer no one, and no secret is stored for them to compare with.
--
-- Run it only on a deployment that uses kks-store (KKS_STORE_URL, no KKS_SECRET in Vercel).
-- To go back to the secret path: grant execute on the six functions to anon again and store a new secret
-- (README, "דרך חלופית").

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.kks_version(text)',
    'public.kks_load(text)',
    'public.kks_save(text, bigint, text)',
    'public.kks_put_file(text, text, text)',
    'public.kks_get_file(text, text)',
    'public.kks_delete_file(text, text)',
    'public.kks_check(text)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
    end if;
  end loop;
end $$;

-- no stored secret: kks_check refuses every call, whatever is granted later by mistake
do $$
begin
  if to_regclass('public.kks_secret') is not null then
    delete from public.kks_secret;
  end if;
end $$;
