import { MOCK_QUOTES, MOCK_NEWS, mockOptionChain } from "./mock";

// Data strategy, in order:
//   1. /api/* serverless functions (available on full Netlify deploys with functions)
//   2. Direct browser fetch via a free CORS relay (works on static drag-and-drop deploys)
//   3. Mock/demo data
//
// The CORS relays are free public services — fine for a personal dashboard,
// but rate-limited and occasionally down. The serverless path is preferred.

const RELAYS = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

async function tryFetch(url, asText = false) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = asText ? await res.text() : await res.json();
    if (!asText && data && data.error) return null;
    return data;
  } catch {
    return null;
  }
}

async function viaRelay(url, asText = false) {
  for (const relay of RELAYS) {
    const data = await tryFetch(relay(url), asText);
    if (data) return data;
  }
  return null;
}

/* ---------------- sentiment (mirrors netlify/functions/news.js) ---------------- */
const BULLISH = ["surge","rally","record","profit","beats","beat","upgrade","buy","jumps","soars","gains","strong","growth","wins","order","expansion","raises target","bullish","high","outperform","dividend","bonus"];
const BEARISH = ["falls","drops","plunge","loss","misses","downgrade","sell","weak","cuts","probe","penalty","fraud","slump","crash","bearish","low","underperform","concern","lawsuit","default","regulatory","resign"];

function scoreHeadline(title) {
  const t = title.toLowerCase();
  let s = 0;
  for (const w of BULLISH) if (t.includes(w)) s++;
  for (const w of BEARISH) if (t.includes(w)) s--;
  return Math.max(-1, Math.min(1, s));
}

/* ---------------- quotes ---------------- */

export async function getQuotes(symbols) {
  // 1) serverless
  const fn = await tryFetch(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`);
  if (fn && Array.isArray(fn.quotes) && fn.quotes.length) return { quotes: fn.quotes, live: true };

  // 2) browser → Yahoo Finance via relay
  const results = await Promise.all(symbols.map((s) => yahooQuote(s)));
  const quotes = results.filter(Boolean);
  if (quotes.length) return { quotes, live: true };

  // 3) mock
  return { quotes: MOCK_QUOTES, live: false };
}

async function yahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?range=1mo&interval=1d`;
  const data = await viaRelay(url);
  const r = data?.chart?.result?.[0];
  if (!r) return null;
  const meta = r.meta || {};
  const quote = r.indicators?.quote?.[0] || {};
  const vols = (quote.volume || []).filter((v) => v != null);
  const closes = (quote.close || []).filter((v) => v != null);
  const todayVol = vols[vols.length - 1] ?? null;
  const past = vols.slice(0, -1).slice(-20);
  const avg20 = past.length ? past.reduce((a, b) => a + b, 0) / past.length : null;
  const ltp = meta.regularMarketPrice ?? closes[closes.length - 1];
  // chartPreviousClose = close before the RANGE (1 month ago) — use yesterday's candle instead
  const prev =
    meta.regularMarketPreviousClose ??
    (closes.length > 1 ? closes[closes.length - 2] : meta.previousClose);
  return {
    symbol,
    name: meta.longName || meta.shortName || symbol,
    ltp,
    changePct: ltp && prev ? ((ltp - prev) / prev) * 100 : 0,
    volume: todayVol,
    avgVolume20d: avg20 ? Math.round(avg20) : null,
  };
}

/* ---------------- news ---------------- */

export async function getNews(symbol) {
  const fn = await tryFetch(`/api/news?q=${encodeURIComponent(symbol)}`);
  if (fn && Array.isArray(fn.items)) return { items: fn.items, live: true };

  // browser → Google News RSS via relay, parsed with DOMParser
  const rss = `https://news.google.com/rss/search?q=${encodeURIComponent(symbol + " stock NSE")}&hl=en-IN&gl=IN&ceid=IN:en`;
  const xml = await viaRelay(rss, true);
  if (xml) {
    try {
      const doc = new DOMParser().parseFromString(xml, "text/xml");
      const items = [...doc.querySelectorAll("item")].slice(0, 8).map((it) => {
        const title = it.querySelector("title")?.textContent?.trim() || "";
        return {
          title,
          link: it.querySelector("link")?.textContent?.trim() || "#",
          source: it.querySelector("source")?.textContent?.trim() || "Google News",
          pubDate: it.querySelector("pubDate")?.textContent || "",
          sentiment: scoreHeadline(title),
        };
      });
      if (items.length) return { items, live: true };
    } catch { /* fall through */ }
  }
  return { items: MOCK_NEWS[symbol] || [], live: false };
}

/* ---------------- option chain ---------------- */

export async function getOptionChain(underlying, expiry) {
  const params = new URLSearchParams({ underlying });
  if (expiry) params.set("expiry", expiry);
  const fn = await tryFetch(`/api/option-chain?${params}`);
  if (fn && Array.isArray(fn.strikes) && fn.strikes.length) return { ...fn, live: true };

  // NSE requires a cookie handshake that browsers can't do cross-origin,
  // so there is no reliable static-only path — demo data on Drop deploys.
  return { ...mockOptionChain(), live: false };
}
