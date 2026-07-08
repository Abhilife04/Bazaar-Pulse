// Mock data used when the Upstox token is not configured yet.
// Numbers are illustrative only — replace with live data via /api/* functions.

export const MOCK_QUOTES = [
  { symbol: "RELIANCE", name: "Reliance Industries", ltp: 2987.4, changePct: 1.62, volume: 8_420_000, avgVolume20d: 5_100_000 },
  { symbol: "HDFCBANK", name: "HDFC Bank", ltp: 1698.2, changePct: -0.41, volume: 11_200_000, avgVolume20d: 12_400_000 },
  { symbol: "TATAMOTORS", name: "Tata Motors", ltp: 1042.6, changePct: 3.85, volume: 22_600_000, avgVolume20d: 9_800_000 },
  { symbol: "INFY", name: "Infosys", ltp: 1587.0, changePct: 0.92, volume: 6_100_000, avgVolume20d: 5_700_000 },
  { symbol: "ADANIENT", name: "Adani Enterprises", ltp: 3120.5, changePct: -2.14, volume: 4_900_000, avgVolume20d: 3_200_000 },
  { symbol: "SBIN", name: "State Bank of India", ltp: 861.3, changePct: 2.31, volume: 18_700_000, avgVolume20d: 13_500_000 },
  { symbol: "ZOMATO", name: "Zomato", ltp: 268.9, changePct: 5.6, volume: 61_000_000, avgVolume20d: 28_000_000 },
  { symbol: "ITC", name: "ITC", ltp: 447.1, changePct: 0.12, volume: 9_300_000, avgVolume20d: 10_800_000 },
];

export const MOCK_NEWS = {
  RELIANCE: [
    { title: "Reliance Retail expands quick-commerce pilot to 12 new cities", source: "Mock Wire", sentiment: 1, link: "#" },
    { title: "Analysts raise target price after strong refining margins", source: "Mock Wire", sentiment: 1, link: "#" },
  ],
  TATAMOTORS: [
    { title: "Tata Motors JLR order book hits record high", source: "Mock Wire", sentiment: 1, link: "#" },
    { title: "EV price war concerns weigh on margins outlook", source: "Mock Wire", sentiment: -1, link: "#" },
  ],
  ZOMATO: [
    { title: "Zomato posts surprise profit; Blinkit GOV surges", source: "Mock Wire", sentiment: 1, link: "#" },
  ],
  ADANIENT: [
    { title: "Adani group faces fresh regulatory queries", source: "Mock Wire", sentiment: -1, link: "#" },
  ],
};

// Simple synthetic option chain around a spot of 25,000 (NIFTY-style)
export function mockOptionChain(spot = 25000) {
  const strikes = [];
  const step = 100;
  for (let k = spot - 800; k <= spot + 800; k += step) {
    const dist = Math.abs(k - spot);
    const atmFactor = Math.max(0.15, 1 - dist / 1200);
    strikes.push({
      strike: k,
      call: {
        oi: Math.round(1_500_000 * atmFactor * (k > spot ? 1.4 : 0.8) + Math.random() * 200_000),
        oiChange: Math.round((Math.random() - 0.4) * 300_000),
        iv: +(12 + dist / 300 + Math.random() * 2).toFixed(1),
        ltp: +Math.max(2, (spot - k) + 180 * atmFactor + Math.random() * 20).toFixed(1),
        volume: Math.round(900_000 * atmFactor),
      },
      put: {
        oi: Math.round(1_500_000 * atmFactor * (k < spot ? 1.5 : 0.7) + Math.random() * 200_000),
        oiChange: Math.round((Math.random() - 0.35) * 300_000),
        iv: +(13 + dist / 280 + Math.random() * 2).toFixed(1),
        ltp: +Math.max(2, (k - spot) + 170 * atmFactor + Math.random() * 20).toFixed(1),
        volume: Math.round(850_000 * atmFactor),
      },
    });
  }
  return { spot, expiry: "mock-expiry", strikes };
}
