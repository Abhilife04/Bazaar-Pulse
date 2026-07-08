// GET /api/quotes?symbols=RELIANCE,TATAMOTORS
//
// FREE MODE (default, no keys needed):
//   Uses Yahoo Finance's public chart API. NSE symbols are suffixed .NS
//   (use .BO for BSE-only scrips). Pulls 1 month of daily candles, so we
//   get LTP, % change, today's volume AND a true 20-day average volume.
//
// UPSTOX MODE (optional): set UPSTOX_ACCESS_TOKEN to switch to broker data.

const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart";
const UPSTOX_BASE = "https://api.upstox.com/v2";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };

const ISIN = {
  RELIANCE: "INE002A01018", HDFCBANK: "INE040A01034", TATAMOTORS: "INE155A01022",
  INFY: "INE009A01021", ADANIENT: "INE423A01024", SBIN: "INE062A01020",
  ZOMATO: "INE758T01015", ITC: "INE154A01025", WIPRO: "INE075A01022", TCS: "INE467B01029",
};

export default async (req) => {
  const url = new URL(req.url);
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length) return json({ error: "symbols param required" }, 400);

  if (process.env.UPSTOX_ACCESS_TOKEN) {
    const upstox = await fromUpstox(symbols).catch(() => null);
    if (upstox) return json({ quotes: upstox, live: true, source: "upstox" });
  }

  // Free path: Yahoo Finance, parallel per symbol
  const results = await Promise.all(symbols.map((s) => fromYahoo(s).catch(() => null)));
  const quotes = results.filter(Boolean);
  if (!quotes.length) return json({ error: "no quotes available" }, 502);
  return json({ quotes, live: true, source: "yahoo" });
};

async function fromYahoo(symbol) {
  // .NS = NSE listing; change to .BO for BSE-only scrips
  const res = await fetch(`${YAHOO}/${encodeURIComponent(symbol)}.NS?range=1mo&interval=1d`, { headers: UA });
  if (!res.ok) return null;
  const data = await res.json();
  const r = data?.chart?.result?.[0];
  if (!r) return null;

  const meta = r.meta || {};
  const vols = (r.indicators?.quote?.[0]?.volume || []).filter((v) => v != null);
  const todayVol = vols[vols.length - 1] ?? null;
  const past = vols.slice(0, -1).slice(-20);
  const avg20 = past.length ? past.reduce((a, b) => a + b, 0) / past.length : null;

  const ltp = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose ?? meta.previousClose;

  return {
    symbol,
    name: meta.longName || meta.shortName || symbol,
    ltp,
    changePct: ltp && prev ? ((ltp - prev) / prev) * 100 : 0,
    volume: todayVol,
    avgVolume20d: avg20 ? Math.round(avg20) : null,
  };
}

async function fromUpstox(symbols) {
  const keys = symbols.filter((s) => ISIN[s]).map((s) => `NSE_EQ|${ISIN[s]}`);
  if (!keys.length) return null;
  const res = await fetch(
    `${UPSTOX_BASE}/market-quote/quotes?instrument_key=${encodeURIComponent(keys.join(","))}`,
    { headers: { Authorization: `Bearer ${process.env.UPSTOX_ACCESS_TOKEN}`, Accept: "application/json" } }
  );
  const data = await res.json();
  if (data.status !== "success") return null;
  return Object.values(data.data).map((q) => ({
    symbol: q.symbol,
    name: q.symbol,
    ltp: q.last_price,
    changePct: q.net_change && q.last_price ? (q.net_change / (q.last_price - q.net_change)) * 100 : 0,
    volume: q.volume,
    avgVolume20d: q.average_volume || null,
  }));
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=30" },
  });
