export const fmt = new Intl.NumberFormat("en-IN");
export const fmtC = (n) =>
  n == null || Number.isNaN(n) ? "—" : "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);

export function compact(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e7) return (n / 1e7).toFixed(2) + " Cr";
  if (abs >= 1e5) return (n / 1e5).toFixed(2) + " L";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + " K";
  return String(n);
}

export function pct(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return (n > 0 ? "+" : "") + n.toFixed(2) + "%";
}

/**
 * Composite momentum score 0–100.
 *  - volume surge: today's volume vs 20-day average (weight 40%)
 *  - price change: intraday % change (weight 35%)
 *  - news sentiment: mean of headline scores in [-1, 1] (weight 25%)
 */
export function momentumScore({ volume, avgVolume20d, changePct, sentiment = 0 }) {
  const surge = avgVolume20d ? volume / avgVolume20d : 1;
  const surgeNorm = Math.min(1, Math.max(0, (surge - 0.5) / 2.5)); // 0.5x → 0, 3x → 1
  const priceNorm = Math.min(1, Math.max(0, (changePct + 5) / 10)); // -5% → 0, +5% → 1
  const sentNorm = (sentiment + 1) / 2;
  return Math.round(100 * (0.4 * surgeNorm + 0.35 * priceNorm + 0.25 * sentNorm));
}

export function scoreColor(s) {
  if (s >= 65) return "var(--up)";
  if (s <= 35) return "var(--down)";
  return "var(--saffron)";
}
