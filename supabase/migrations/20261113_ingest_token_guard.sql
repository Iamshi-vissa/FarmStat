-- Only FarmStat's own schedules may run the ingest Edge Function: they send a random token the function checks.
-- (Applied to the farmstat project on 13 Nov 2026. The token itself is generated in the database, never stored in git.)
create table if not exists farmstat_private.settings (key text primary key, value text not null);
revoke all on farmstat_private.settings from public, anon, authenticated;
insert into farmstat_private.settings (key, value)
values ('ingest_token', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

create or replace function public.ingest_token_ok(t text)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from farmstat_private.settings where key = 'ingest_token' and value = t) $$;
revoke all on function public.ingest_token_ok(text) from public, anon, authenticated;
grant execute on function public.ingest_token_ok(text) to service_role;

-- farmstat_private.call_ingest(body) posts to the function with the project's public anon key (Authorization) and
-- the header x-ingest-token = (select value from farmstat_private.settings where key = 'ingest_token').
