# Fundamental Screener

[![CI](https://github.com/Nabulizi/fundamental-screener/actions/workflows/ci.yml/badge.svg)](https://github.com/Nabulizi/fundamental-screener/actions/workflows/ci.yml)

A small Next.js web app that compares fundamentals across a watchlist of stock
tickers. Enter one or more tickers and get a sortable table of industry, market
cap, 52-week range, trailing P/E, and dividend yield.

> This tool is for informational purposes only. It does **not** provide buy,
> sell, or hold recommendations. Unavailable data is shown as **“N/A”**, never as
> zero.

## Features

- **Scan** a watchlist; per-ticker progress ("Scanning 3 of 8") with removable input chips.
- **Five core metrics** per company: industry, market cap, 52-week low/high, trailing P/E, dividend yield — plus current price and a 52-week range indicator.
- **Filters** (client-side, no extra requests): industry, market-cap, P/E, min dividend yield, 52-week position. Missing values fail an active filter by default, with an opt-in "include unavailable" toggle, per-filter chips, a match count, and one-click reset.
- **Saved watchlists** in localStorage (create/rename/delete/add/remove/load) with corrupt-data tolerance — no account or database.
- **Freshness:** each row is flagged fresh / cached / stale; **Refresh** re-fetches bypassing the cache; cached rows keep their original retrieval time.
- **Export & share:** download the displayed (filtered + sorted) rows as CSV with timestamps; copy a shareable URL that encodes tickers + filters (never any secret).
- Sortable, accessible table; responsive desktop/mobile; not investment advice.

## Stack

- Next.js 14 (App Router) + TypeScript
- A server-only API route (`/api/scan`) that holds the API key
- [Finnhub](https://finnhub.io) as the data provider, behind a swappable
  `QuoteProvider` interface
- Vitest for unit tests

## Configure the data API

1. Create a free Finnhub account and copy your API key:
   https://finnhub.io/register
2. Copy the env template and paste your key:

   ```bash
   cp .env.example .env.local
   # then edit .env.local and set FINNHUB_API_KEY=your_key
   ```

   The key is read **only** on the server (`app/api/scan/route.ts`) and is never
   sent to the browser. `.env.local` is git-ignored.

| Variable              | Default | Purpose                                      |
| --------------------- | ------- | -------------------------------------------- |
| `FINNHUB_API_KEY`      | —       | Required. Server-only Finnhub key.           |
| `ALPHAVANTAGE_API_KEY` | —       | Optional. Enables Alpha Vantage failover (server-only). |
| `MAX_TICKERS`          | `20`    | Max tickers accepted per scan (server).      |
| `NEXT_PUBLIC_MAX_TICKERS` | `20` | Client-side input cap; match `MAX_TICKERS`.  |
| `CACHE_TTL_SECONDS`    | `60`    | Server cache TTL. `0` disables caching.      |

### Failover provider (optional)

Finnhub is primary. If `ALPHAVANTAGE_API_KEY` is set, [Alpha Vantage](https://www.alphavantage.co/)
becomes an automatic **per-ticker failover**: when Finnhub rate-limits (HTTP 429)
or errors on a ticker, that ticker is retried against Alpha Vantage; a `NOT_FOUND`
is **not** retried (the symbol genuinely doesn't exist). With no Alpha Vantage
key, behavior is unchanged (Finnhub only). Provider logic stays inside each
adapter (`lib/finnhub.ts`, `lib/alphavantage.ts`) behind the `QuoteProvider`
interface; `lib/fallbackProvider.ts` composes them.

Alpha Vantage returns **full fundamentals** for free via one `OVERVIEW` call
(name, sector/industry, market cap, P/E, dividend yield, 52-week range) plus
`GLOBAL_QUOTE` for current price. Its units are isolated in
`normalizeAlphaVantage()`: **market cap is raw units** (not millions) and
**dividend yield is a decimal** (×100 for percent). Run `npm run probe` with both
keys set to confirm these against live data.

> **Free-tier limits (verified by probe):** Alpha Vantage's free tier is roughly
> **25 requests/day** *and* a **~1 request/second burst limit**. `OVERVIEW`
> (fundamentals) is fetched first and on its own; `GLOBAL_QUOTE` (current price)
> is fetched **best-effort** afterward — if the burst limit throttles it, the
> failover still returns full fundamentals and just leaves current price / 52-week
> position as N/A (rather than discarding the row). If `OVERVIEW` itself is
> limited, that ticker surfaces as `RATE_LIMITED` without dropping the others.
> Net: good for *occasional* failover; it will throttle under heavy concurrent
> failover. Field map confirmed live — market cap raw, dividend yield decimal
> (×100).

## Run

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts:

```bash
npm run probe      # live Finnhub field-map probe (needs FINNHUB_API_KEY)
npm test           # unit tests
npm run typecheck  # tsc --noEmit
npm run lint       # next lint
npm run build      # production build
```

## Provider field map (Finnhub)

Run `npm run probe` to confirm these against live data. The two unit-sensitive
conversions are isolated in `normalizeFinnhub()` (`lib/finnhub.ts`).

| App field              | Endpoint            | Finnhub field                  | Notes                                    |
| ---------------------- | ------------------- | ------------------------------ | ---------------------------------------- |
| `companyName`          | `/stock/profile2`   | `name`                         |                                          |
| `industry`             | `/stock/profile2`   | `finnhubIndustry`              |                                          |
| `marketCap`            | `/stock/profile2`   | `marketCapitalization`         | **In millions** → multiplied by 1e6.     |
| `currency`             | `/stock/profile2`   | `currency`                     | Used for price/cap formatting.           |
| `week52High`           | `/stock/metric`     | `metric.52WeekHigh`            |                                          |
| `week52Low`            | `/stock/metric`     | `metric.52WeekLow`            |                                          |
| `trailingPE`           | `/stock/metric`     | `metric.peTTM`                 | Non-positive → `null` (no meaningful PE).|
| `dividendYieldPercent` | `/stock/metric`     | `metric.dividendYieldIndicatedAnnual` | **Already a percentage** (3.05 = 3.05%). |
| `currentPrice`         | `/quote`            | `c`                            | Trading currency; non-positive → `null`. Best-effort. |

`rangePosition` is derived: `(currentPrice − 52WeekLow) / (52WeekHigh − 52WeekLow)`,
stored raw (null when price/range missing or `high ≤ low`) and clamped to 0–100% only for display.

## Missing-data behavior

- Every field is always present in the normalized row. `null` means the provider
  gave no usable value and renders as **“N/A”**.
- A genuine `0` is preserved: a company that truly pays no dividend shows
  **“0.00%”**, which is distinct from a missing yield (**“N/A”**).
- Unprofitable companies (negative/zero trailing P/E) show **“N/A”** for P/E.
- Sorting always pushes missing values to the end, so “N/A” never poses as the
  smallest or largest value.

## Reliability

- **Per-ticker isolation:** one ticker failing (not found, rate limited, error)
  never discards the others. Failures are reported alongside successful rows.
- **Caching:** results are cached server-side for `CACHE_TTL_SECONDS`. Cached
  rows keep their original retrieval timestamp, so “last updated” stays honest.
  Note: the in-memory cache is **best-effort on serverless** — each cold start /
  instance has its own cache, so hits are not guaranteed across requests.
- **Rate limits:** on HTTP 429 the app retries **once**, honoring `Retry-After`
  (seconds or HTTP-date), capped with small jitter to avoid retry storms.

## Known provider limitations

- Finnhub free tier is roughly 60 requests/minute (plan-dependent and subject to
  change). Each ticker uses **three** requests (profile2 + metric + quote), so
  scans are capped (`MAX_TICKERS`, default 20) with bounded concurrency, and the
  client scans tickers a few at a time. A 429 triggers a single Retry-After-aware
  retry; otherwise that ticker fails on its own without dropping the others.
- Some metrics (P/E, dividend yield, 52-week range) may be unavailable for
  international, OTC, fund, or newly listed symbols — these render as “N/A”.
- Fundamentals may update on a different cadence than live quotes. “Last updated”
  reflects server retrieval time, not a claim that every underlying figure
  changed at that moment.
