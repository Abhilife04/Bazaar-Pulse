# BazaarPulse — NSE/BSE Momentum Desk

A live-data dashboard for Netlify with three modules:

1. **Momentum screener** — volume surge (vs 20-day average) + intraday price change + news-headline sentiment, blended into a 0–100 momentum score per stock.
2. **Mutual fund flows** — upload your Excel (Fund Name / Stock Name / Position / Change in Position), parsed entirely in the browser; shows net accumulation/distribution per stock, fund conviction, and per-fund detail.
3. **Option chain** — live chain via Upstox with Put/Call ratio, max pain, highest OI strikes (support/resistance heuristics) and an OI-by-strike chart.

The app now runs on **100% free sources by default — no API keys, no broker account**:

| Data | Free source | Notes |
|---|---|---|
| Quotes, volume, 20-day avg volume | Yahoo Finance public API | Reliable, ~15-min delayed for NSE |
| News + sentiment | Google News RSS | Free, no key |
| Option chain | NSE website JSON API | Free but NSE blocks cloud IPs intermittently; falls back to demo data when blocked |

Adding an `UPSTOX_ACCESS_TOKEN` env var is **optional** — it upgrades quotes and (reliably) the option chain to real-time broker data.

---

## 1. Deploy on Netlify (no local setup needed)

1. Upload this folder's contents to a new GitHub repo (github.com → New repository → "uploading an existing file"). `package.json` and `netlify.toml` must be at the repo root.
2. On app.netlify.com: **Add new site → Import an existing project → GitHub** → pick the repo → Deploy. `netlify.toml` configures everything automatically.
3. Done — your site is live with free data. No environment variables required.

## 1b. Or run locally

```bash
npm install
npm install -g netlify-cli   # once
netlify dev                  # serves the app + functions on http://localhost:8888
```

`netlify dev` runs both the Vite frontend and the serverless functions, so `/api/*` works locally.

## 2. Optional: Upstox access token (for real-time + reliable option chain)

1. Create an app at https://account.upstox.com/developer/apps (free; needs an Upstox trading account).
2. Note the **API key** and **API secret**; set any redirect URL (e.g. `https://127.0.0.1`).
3. Get an auth code by opening in a browser:
   ```
   https://api.upstox.com/v2/login/authorization/dialog?client_id=YOUR_API_KEY&redirect_uri=YOUR_REDIRECT&response_type=code
   ```
4. Exchange it for an access token:
   ```bash
   curl -X POST https://api.upstox.com/v2/login/authorization/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "code=AUTH_CODE&client_id=YOUR_API_KEY&client_secret=YOUR_SECRET&redirect_uri=YOUR_REDIRECT&grant_type=authorization_code"
   ```
5. The token is valid until ~3:30 AM the next day (Upstox expires tokens daily). For a hands-off setup, automate steps 3–4 with a small script or use Upstox's extended-validity token option if available on your account.

> Prefer Angel One SmartAPI instead? The functions are thin — swap the fetch URLs in `netlify/functions/quotes.js` and `option-chain.js`; the frontend contract stays identical.

## 3. CLI deploy (alternative to the GitHub route)

```bash
netlify init      # link/create the site
netlify env:set UPSTOX_ACCESS_TOKEN "your-token-here"
netlify deploy --prod
```

Or connect the repo in the Netlify UI and add `UPSTOX_ACCESS_TOKEN` under **Site settings → Environment variables**.

## 4. Mutual fund Excel format

First sheet, first row = headers. Column names are matched fuzzily, so any of these work:

| Fund Name | Stock Name | Position | Change in Position |
|---|---|---|---|
| HDFC Flexi Cap | Reliance Industries | 1,20,00,000 | +4,50,000 |
| SBI Bluechip | Reliance Industries | 80,00,000 | -2,00,000 |

Aliases understood: fund/scheme/AMC · stock/company/scrip · position/holding/qty · change/net change/increase in holding. Commas, ₹ and % signs are stripped automatically. The file is parsed with SheetJS **in the browser** — it never uploads anywhere.

## 5. Where to extend

- **True 20-day average volume**: `quotes.js` has a note — pull Upstox historical daily candles and average the last 20 volumes for accurate surge ratios.
- **Better sentiment**: `news.js` uses a keyword lexicon. Replace `scoreHeadline()` with a call to an LLM or a FinBERT endpoint for real NLP sentiment.
- **More symbols**: extend the `ISIN` map in `quotes.js`, or load Upstox's full instrument master JSON.
- **Twitter/X**: the API is paid ($200+/mo). Cheaper proxies for retail chatter: Reddit's public JSON API, Stocktwits API, or Telegram channel scrapes.
- **Auto-refresh cadence**: both live tabs poll every 60 s; change the `setInterval` values.

## Notes & disclaimers

- Ticker tape values in the header are static placeholders — wire them to `/api/quotes` for index instruments if you want them live.
- OI/PCR/max-pain readings are conventional heuristics, not trading advice.
- NSE/BSE data redistribution has licensing rules; a personal dashboard on your own account's API is the safe pattern (which is what this is).
