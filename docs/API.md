# FARMSTAT WEB API

Read-only JSON API behind the FarmStat web app. Run it locally with `python -m uvicorn api.main:app --port 8000`;
interactive docs are at `/docs`. On Vercel the same app is served from the site's own domain.

- **Methods:** `GET` only. No authentication; nothing can be written through this API.
- **Prices:** ₹ per quintal. Weeks are the Monday that starts them (`2026-07-20`).
- **Caching:** `/api/live*` responses may be cached for 10 minutes, other `/api/*` responses for 1 hour.
- **Compression:** responses over 800 bytes are gzipped when the client accepts it.
- **Errors:** `404 {"detail": "..."}` for an unknown crop, state or mandi; `422` for a bad query parameter.

## ENDPOINTS

| Endpoint | Returns |
|---|---|
| `GET /api/meta` | Crops, how many series each has per state, data dates, horizons, model version |
| `GET /api/mandis?crop=&state=` | Every active mandi for a weekly crop in one state, with forecasts, advice and a 12-week sparkline |
| `GET /api/series?crop=&state=&market=&weeks=104` | One mandi's history (8 to 520 weeks) and its 1/2/4-week forecast |
| `GET /api/national?crop=&variety=` | State medians and the highest-paying mandis in India; `variety` (optional, arecanut) matches the `(Variety)` part of series names |
| `GET /api/overview?crop=` | The crop across India: median price, 26-week trend, change on last week and last year, calls by type, prices by state, biggest expected rises and falls, top prices |
| `GET /api/index` | Every active series in one compact list, for search |
| `GET /api/cashew` | Cashew monthly state prices and forecasts |
| `GET /api/sugarcane` | Sugarcane FRP and mandi prices |
| `GET /api/accuracy` | Test results, plus `validation` from `scripts/evaluate.py` when it has been run |
| `GET /api/live?crop=&state=&market=` | The mandi's daily reports: the last 45 report days among its 400 most recent rows |
| `GET /api/live/status` | Last fetch, last retrain and latest price date in the live feed |

Weekly crops are `Onion`, `Tomato`, `Potato` and `Arecanut`. Arecanut series are named `Market (Variety)`, for example
`Sirsi (Rashi)`.

## EXAMPLES

```bash
curl "localhost:8000/api/series?crop=Onion&state=Maharashtra&market=Lasalgaon&weeks=8"
```

```json
{
  "latest": {"week": "2026-07-20", "market": "Lasalgaon", "district": "Nashik", "price": 2092.7, "arrivals": 5128.0,
             "prob_rise": 0.4734, "advice": "Your call", "advice_headline": "No clear signal",
             "p10_2": 1884.27, "p50_2": 2118.79, "p90_2": 2580.38, "live": false, "warming": false, "...": "..."},
  "history": [{"week": "2026-05-25", "price": 1369.0, "arrivals_t": 5610.0}, "..."],
  "forecast": [{"week": "2026-07-20", "h": 0, "p10": 2092.7, "p50": 2092.7, "p90": 2092.7},
               {"week": "2026-07-27", "h": 1, "p10": 1948.27, "p50": 2087.22, "p90": 2462.5}, "..."]
}
```

- `p10_h`, `p50_h`, `p90_h`: the likely range and median price `h` weeks ahead.
- `prob_rise`: chance of a 5%+ rise within 2 weeks.
- `naive: true`: no model is used for this series (arecanut, or a mandi warming up); the range is the usual movement.
- `live: true`: the latest week comes from the live daily feed. `warming: true`: live reports resumed after a gap and
  the series has fewer than 4 reported weeks out of the last 13, so no call is made.

```bash
curl "localhost:8000/api/index"
```

```json
{"columns": ["crop", "state", "market", "district", "price"],
 "rows": [["Arecanut", "Karnataka", "Honnavar (Ripe)", "Uttara Kannada", 38000.0], "..."]}
```

```bash
curl "localhost:8000/api/live?crop=Onion&state=Maharashtra&market=Jalgaon"
```

```json
{"available": true,
 "latest": {"date": "2026-11-12", "modal": 2750.0, "min": 850.0, "max": 4750.0, "varieties": 1},
 "days": [{"date": "2026-11-12", "modal": 2750.0, "min": 850.0, "max": 4750.0, "varieties": 1}]}
```

```bash
curl "localhost:8000/api/live/status"
```

```json
{"available": true,
 "last_fetch": {"started_at": "2026-11-12T18:21:01+00:00", "finished_at": "2026-11-12T18:21:11+00:00", "status": "ok",
                "rows_upserted": 322, "dates_covered": "2026-11-11..2026-11-11"},
 "last_retrain": null, "latest_price_date": "2026-11-12"}
```

When the mandi has no live reports, or Supabase can't be reached, the response is
`{"available": false, "reason": "..."}` with status 200, so the page can still show the weekly forecast.

## CONFIGURATION

| Variable | Used by | Default |
|---|---|---|
| `SUPABASE_URL` | `/api/live*` | the FarmStat project |
| `SUPABASE_KEY` | `/api/live*` | the project's publishable (read-only) key |
