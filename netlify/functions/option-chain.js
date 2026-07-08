// GET /api/option-chain?underlying=NIFTY
//
// FREE MODE (default): scrapes NSE's own public JSON API
//   (option-chain-indices / option-chain-equities). No key needed,
//   but NSE aggressively blocks datacenter IPs — expect intermittent
//   failures from Netlify's AWS-hosted functions. When it fails, the
//   frontend gracefully falls back to demo data.
//
// UPSTOX MODE (optional): set UPSTOX_ACCESS_TOKEN for reliable data.

const UPSTOX_BASE = "https://api.upstox.com/v2";
const NSE = "https://www.nseindia.com";

const INDICES = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"]);
const UPSTOX_KEYS = {
  NIFTY: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  FINNIFTY: "NSE_INDEX|Nifty Fin Service",
  RELIANCE: "NSE_EQ|INE002A01018",
  HDFCBANK: "NSE_EQ|INE040A01034",
  TATAMOTORS: "NSE_EQ|INE155A01022",
  SBIN: "NSE_EQ|INE062A01020",
};

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-IN,en;q=0.9",
  Referer: "https://www.nseindia.com/option-chain",
};

export default async (req) => {
  const url = new URL(req.url);
  const underlying = (url.searchParams.get("underlying") || "NIFTY").toUpperCase();
  const expiry = url.searchParams.get("expiry");

  if (process.env.UPSTOX_ACCESS_TOKEN && UPSTOX_KEYS[underlying]) {
    const up = await fromUpstox(underlying, expiry).catch(() => null);
    if (up) return json({ ...up, live: true, source: "upstox" });
  }

  const nse = await fromNSE(underlying, expiry).catch((e) => ({ __err: String(e) }));
  if (nse && !nse.__err) return json({ ...nse, live: true, source: "nse" });

  return json(
    { error: "NSE blocked the request (common from cloud IPs). Add UPSTOX_ACCESS_TOKEN for reliable data.", detail: nse?.__err },
    502
  );
};

async function fromNSE(underlying, wantedExpiry) {
  // Step 1: warm up — hit homepage to collect the cookies NSE requires
  const warm = await fetch(NSE + "/option-chain", { headers: BROWSER_HEADERS, redirect: "follow" });
  const setCookies = warm.headers.getSetCookie ? warm.headers.getSetCookie() : [warm.headers.get("set-cookie")].filter(Boolean);
  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");

  // Step 2: fetch the chain JSON with those cookies
  const endpoint = INDICES.has(underlying)
    ? `/api/option-chain-indices?symbol=${underlying}`
    : `/api/option-chain-equities?symbol=${encodeURIComponent(underlying)}`;

  const res = await fetch(NSE + endpoint, { headers: { ...BROWSER_HEADERS, Cookie: cookie } });
  if (!res.ok) throw new Error(`NSE responded ${res.status}`);
  const data = await res.json();

  const records = data?.records;
  if (!records?.data?.length) throw new Error("empty chain from NSE");

  const expiry = wantedExpiry || records.expiryDates?.[0];
  const spot = records.underlyingValue;

  const strikes = records.data
    .filter((r) => r.expiryDate === expiry)
    .map((r) => ({
      strike: r.strikePrice,
      call: normNSE(r.CE),
      put: normNSE(r.PE),
    }))
    .sort((a, b) => a.strike - b.strike);

  if (!strikes.length) throw new Error("no strikes for expiry " + expiry);
  return { spot, expiry, strikes, expiries: records.expiryDates?.slice(0, 6) };
}

function normNSE(leg) {
  if (!leg) return { oi: 0, oiChange: 0, iv: null, ltp: 0, volume: 0 };
  return {
    oi: leg.openInterest ?? 0,
    oiChange: leg.changeinOpenInterest ?? 0,
    iv: leg.impliedVolatility ? +(+leg.impliedVolatility).toFixed(1) : null,
    ltp: leg.lastPrice ?? 0,
    volume: leg.totalTradedVolume ?? 0,
  };
}

async function fromUpstox(underlying, expiry) {
  const key = UPSTOX_KEYS[underlying];
  const headers = { Authorization: `Bearer ${process.env.UPSTOX_ACCESS_TOKEN}`, Accept: "application/json" };

  if (!expiry) {
    const cRes = await fetch(`${UPSTOX_BASE}/option/contract?instrument_key=${encodeURIComponent(key)}`, { headers });
    const cData = await cRes.json();
    expiry = [...new Set((cData.data || []).map((c) => c.expiry))].sort()[0];
    if (!expiry) return null;
  }

  const res = await fetch(
    `${UPSTOX_BASE}/option/chain?instrument_key=${encodeURIComponent(key)}&expiry_date=${expiry}`,
    { headers }
  );
  const data = await res.json();
  if (data.status !== "success") return null;

  const rows = data.data || [];
  return {
    spot: rows[0]?.underlying_spot_price ?? null,
    expiry,
    strikes: rows
      .map((r) => ({ strike: r.strike_price, call: normUp(r.call_options), put: normUp(r.put_options) }))
      .sort((a, b) => a.strike - b.strike),
  };
}

function normUp(leg) {
  const md = leg?.market_data || {};
  const gr = leg?.option_greeks || {};
  return {
    oi: md.oi ?? 0,
    oiChange: (md.oi ?? 0) - (md.prev_oi ?? md.oi ?? 0),
    iv: gr.iv != null ? +(+gr.iv).toFixed(1) : null,
    ltp: md.ltp ?? 0,
    volume: md.volume ?? 0,
  };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
