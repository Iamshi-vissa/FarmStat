-- FarmStat no longer covers cashew or sugarcane: the third daily pull fetches arecanut only.
-- (Existing cashew and sugarcane rows in daily_prices are left in place; nothing reads them.)
select cron.alter_job(
  (select jobid from cron.job where jobname = 'farmstat-today-others'),
  command := $$select farmstat_private.call_ingest('{"commodities":["Arecanut"],"budget_s":135}')$$
);
