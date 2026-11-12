// FarmStat live ingest: pulls daily mandi prices from data.gov.in (Agmarknet) into public.daily_prices.
//
//   POST /functions/v1/ingest-mandi                      today's reports (Current Daily Price feed)
//   POST /functions/v1/ingest-mandi {"from":"2026-11-01","to":"2026-11-10"}   back-fill those dates
//        optional: {"commodities":["Onion"], "budget_s":110, "backfill":true}
//   With "backfill": true, each (day, crop) that loads completely is marked done in public.backfill_queue.
//
// Callers must send the x-ingest-token header (see farmstat_private.call_ingest); requests without it get 401.
// The API key comes from the DATA_GOV_IN_API_KEY secret. Without it the public sample key is used, which
// returns at most 10 records per request, so back-fills are slow; register a free key at data.gov.in.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SAMPLE_KEY = "579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b";
const LIVE = "9ef84268-d588-465a-a308-a864a43d0070";   // Current Daily Price of Various Commodities (today)
const HIST = "35985678-0d79-46b4-9ed6-6f13308a1d24";   // Variety-wise Daily Market Prices (any date)
// Agmarknet commodity -> the name FarmStat stores (same convention as src/farmstat/live.py).
// Exact matches only: the API's commodity filter also returns e.g. "Onion Green" for "Onion".
const CROP: Record<string, string> = {
  "Onion": "Onion", "Tomato": "Tomato", "Potato": "Potato", "Arecanut(Betelnut/Supari)": "Arecanut",
  "Cashewnuts": "Cashew", "Sugarcane": "Sugarcane",
};
const COMMODITIES = Object.keys(CROP);
const STATE_FIX: Record<string, string> = { Keralam: "Kerala", Chattisgarh: "Chhattisgarh", Delhi: "NCT of Delhi" };

type Row = {
  arrival_date: string; state: string; district: string; market: string; commodity: string;
  variety: string; grade: string; min_price: number | null; max_price: number | null; modal_price: number;
  source: string;
};

const apiKey = Deno.env.get("DATA_GOV_IN_API_KEY") || SAMPLE_KEY;
const PAGE = apiKey === SAMPLE_KEY ? 10 : 1000;
const PARALLEL = apiKey === SAMPLE_KEY ? 3 : 8;   // the sample key is throttled to a few requests at a time
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const isoDate = (d: string) => {           // "12/11/2026" -> "2026-11-12"
  const [dd, mm, yyyy] = d.split("/");
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
};
const apiDate = (iso: string) => {         // "2026-11-12" -> "12/11/2026"
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const cleanMarket = (s: unknown) => clean(String(s ?? "").replace(/APMC/g, " ")).replace(/^[\s,-]+|[\s,-]+$/g, "");

function toRow(r: Record<string, unknown>, source: string): Row | null {
  const g = (a: string, b: string) => r[a] ?? r[b];   // the two feeds spell fields differently
  const modal = num(g("modal_price", "Modal_Price"));
  const date = String(g("arrival_date", "Arrival_Date") ?? "");
  const crop = CROP[clean(g("commodity", "Commodity"))];
  if (!crop || !modal || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) return null;
  const state = clean(g("state", "State"));
  return {
    arrival_date: isoDate(date),
    state: STATE_FIX[state] ?? state,
    district: clean(g("district", "District")),
    market: cleanMarket(g("market", "Market")),
    commodity: crop,
    variety: clean(g("variety", "Variety")),
    grade: clean(g("grade", "Grade")),
    min_price: num(g("min_price", "Min_Price")),
    max_price: num(g("max_price", "Max_Price")),
    modal_price: modal,
    source,
  };
}

async function getPage(resource: string, filters: Record<string, string>, offset: number) {
  const u = new URL(`https://api.data.gov.in/resource/${resource}`);
  u.searchParams.set("api-key", apiKey);
  u.searchParams.set("format", "json");
  u.searchParams.set("limit", String(PAGE));
  u.searchParams.set("offset", String(offset));
  for (const [k, v] of Object.entries(filters)) u.searchParams.set(`filters[${k}]`, v);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const j = await res.json();
        return { total: Number(j.total ?? 0), records: (j.records ?? []) as Record<string, unknown>[] };
      }
    } catch (_) { /* throttled or slow: retry */ }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  return null;   // give up on this page; the run is marked partial and the next run fills it in
}

// All pages for one query, a few at a time, stopping early if the time budget runs out.
async function fetchAll(resource: string, filters: Record<string, string>, deadline: number) {
  const first = await getPage(resource, filters, 0);
  if (!first) return { records: [], total: 0, complete: false, missing: 1 };
  const records = [...first.records];
  let missing = 0;
  const offsets: number[] = [];
  for (let o = PAGE; o < first.total; o += PAGE) offsets.push(o);
  let complete = true;
  for (let i = 0; i < offsets.length; i += PARALLEL) {
    if (Date.now() > deadline) { complete = false; break; }
    const pages = await Promise.all(offsets.slice(i, i + PARALLEL).map((o) => getPage(resource, filters, o)));
    pages.forEach((p) => (p ? records.push(...p.records) : missing++));
  }
  return { records, total: first.total, complete: complete && missing === 0, missing };
}

async function upsert(rows: Row[]) {
  const key = (r: Row) => [r.arrival_date, r.state, r.district, r.market, r.commodity, r.variety, r.grade].join("|");
  const unique = [...new Map(rows.map((r) => [key(r), r])).values()];
  for (let i = 0; i < unique.length; i += 500) {
    const { error } = await db.from("daily_prices").upsert(unique.slice(i, i + 500), {
      onConflict: "arrival_date,state,district,market,commodity,variety,grade",
    });
    if (error) throw new Error(error.message);
  }
  return unique.length;
}

const MAX_DAYS = 31;   // a back-fill request covers at most a month

Deno.serve(async (req) => {
  // Only FarmStat's own schedules may run this: they send a random token kept in the database (farmstat_private.settings).
  // The anon key that passes the JWT check is public, so it is not enough on its own.
  const token = req.headers.get("x-ingest-token") ?? "";
  const { data: ok } = token ? await db.rpc("ingest_token_ok", { t: token }) : { data: false };
  if (ok !== true) return Response.json({ error: "missing or wrong x-ingest-token" }, { status: 401 });

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  // accept FarmStat names ("Arecanut") or Agmarknet names ("Arecanut(Betelnut/Supari)"); anything else is refused
  const byCrop = Object.fromEntries(Object.entries(CROP).map(([k, v]) => [v, k]));
  const asked = Array.isArray(body.commodities) ? body.commodities : COMMODITIES;
  const commodities: string[] = asked.map((c: unknown) => byCrop[String(c)] ?? String(c));
  const unknown = commodities.filter((c) => !(c in CROP));
  if (unknown.length) return Response.json({ error: `unknown commodities: ${unknown.join(", ")}` }, { status: 400 });
  const backfill = body.backfill === true;   // sent by the back-fill schedule: mark the day done when complete
  const deadline = Date.now() + 1000 * Math.min(Number(body.budget_s ?? 110), 140);

  const dates: string[] = [];
  if (body.from) {
    const span = (Date.parse(body.to ?? body.from) - Date.parse(body.from)) / 86_400_000;
    if (!(span >= 0 && span < MAX_DAYS)) {
      return Response.json({ error: `"from" and "to" must be valid dates at most ${MAX_DAYS} days apart` }, { status: 400 });
    }
    for (let d = new Date(body.from); d <= new Date(body.to ?? body.from); d.setUTCDate(d.getUTCDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }
  }

  // one back-fill at a time (today's pulls run on their own schedule and aren't blocked by it)
  if (dates.length) {
    const { data: busy } = await db.from("ingest_runs").select("id").eq("status", "running").neq("dates_covered", "today")
      .gte("started_at", new Date(Date.now() - 4 * 60 * 1000).toISOString()).limit(1);
    if (busy?.length) return Response.json({ skipped: "another back-fill is running" }, { status: 409 });
  }
  const { data: run } = await db.from("ingest_runs").insert({
    status: "running", dates_covered: dates.length ? `${dates[0]}..${dates.at(-1)}` : "today",
  }).select("id").single();

  let fetched = 0, upserted = 0;
  const notes: string[] = [];
  try {
    const jobs = dates.length
      ? dates.flatMap((d) => commodities.map((c) => ({ day: d, resource: HIST, filters: { Arrival_Date: apiDate(d), Commodity: c } as Record<string, string>, src: "data.gov.in/variety-wise" })))
      : commodities.map((c) => ({ day: "", resource: LIVE, filters: { commodity: c } as Record<string, string>, src: "data.gov.in/current-daily" }));
    for (const job of jobs) {
      if (Date.now() > deadline) { notes.push("stopped early: time budget"); break; }
      const { records, total, complete } = await fetchAll(job.resource, job.filters, deadline);
      fetched += records.length;
      const rows = records.map((r) => toRow(r, job.src)).filter((r): r is Row => r !== null);
      upserted += rows.length ? await upsert(rows) : 0;
      if (!complete) notes.push(`${Object.values(job.filters).join(" ")}: ${records.length} of ${total}`);
      if (backfill && job.day) {
        const crop = CROP[job.filters.Commodity];
        const { data: q } = await db.from("backfill_queue").select("attempts").eq("day", job.day).eq("crop", crop).maybeSingle();
        const tries = (q?.attempts ?? 0) + 1;
        await db.from("backfill_queue").update({
          attempts: tries,
          // done when complete, or after 4 tries (a few pages may never load with the throttled sample key)
          ...(complete || tries >= 4 ? { done_at: new Date().toISOString(), rows_upserted: rows.length } : {}),
        }).eq("day", job.day).eq("crop", crop);
      }
    }
    const status = notes.length ? "partial" : "ok";
    await db.from("ingest_runs").update({
      status, finished_at: new Date().toISOString(), rows_fetched: fetched, rows_upserted: upserted,
      message: [apiKey === SAMPLE_KEY ? "sample key (10 per request)" : "personal key", ...notes].join("; "),
    }).eq("id", run!.id);
    return Response.json({ run: run!.id, status, fetched, upserted, notes });
  } catch (e) {
    await db.from("ingest_runs").update({
      status: "error", finished_at: new Date().toISOString(), rows_fetched: fetched, rows_upserted: upserted,
      message: String(e).slice(0, 500),
    }).eq("id", run!.id);
    return Response.json({ run: run?.id, status: "error", error: String(e) }, { status: 500 });
  }
});
