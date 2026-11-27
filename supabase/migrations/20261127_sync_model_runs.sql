-- Record each daily retrain in public.model_runs without a service key on GitHub.
-- scripts/retrain.py writes the run to models/metrics.json ("last_run"), which the daily job commits to the public
-- repo. Every hour this job reads the file's earlier fetch, inserts the run if it is new, and fetches the file again.

create table if not exists farmstat_private.model_fetch (
  req_id bigint primary key,
  requested_at timestamptz not null default now(),
  done boolean not null default false
);

create unique index if not exists model_runs_trained_at_key on public.model_runs (trained_at);

create or replace function farmstat_private.sync_model_runs() returns void
language plpgsql security definer set search_path = public, farmstat_private, extensions as $$
declare
  r record;
  run jsonb;
begin
  for r in
    select f.req_id, resp.status_code, resp.content
    from farmstat_private.model_fetch f join net._http_response resp on resp.id = f.req_id
    where not f.done
  loop
    if r.status_code = 200 then
      begin
        run := (r.content::jsonb) -> 'last_run';
      exception when others then
        run := null;
      end;
      if run is not null and run ? 'trained_at' then
        insert into public.model_runs (trained_at, version, data_until, holdout_from, champion_mae, challenger_mae,
                                       promoted, notes, metrics)
        values ((run ->> 'trained_at')::timestamptz, run ->> 'version', (run ->> 'data_until')::date,
                (run ->> 'holdout_from')::date, (run ->> 'champion_mae')::numeric,
                (run ->> 'challenger_mae')::numeric, coalesce((run ->> 'promoted')::boolean, false),
                run ->> 'notes', run -> 'metrics')
        on conflict (trained_at) do nothing;
      end if;
    end if;
    update farmstat_private.model_fetch set done = true where req_id = r.req_id;
  end loop;
  delete from farmstat_private.model_fetch where requested_at < now() - interval '1 day';
  insert into farmstat_private.model_fetch (req_id)
  values (net.http_get('https://raw.githubusercontent.com/Iamshi-vissa/FarmStat/main/models/metrics.json'));
end;
$$;

revoke all on function farmstat_private.sync_model_runs() from public, anon, authenticated;

select cron.unschedule('farmstat-sync-model-runs')
where exists (select 1 from cron.job where jobname = 'farmstat-sync-model-runs');
select cron.schedule('farmstat-sync-model-runs', '17 * * * *', 'select farmstat_private.sync_model_runs()');
