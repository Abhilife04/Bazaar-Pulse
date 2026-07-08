// GET /api/news?q=RELIANCE
// Pulls Google News RSS (free, no key) and scores each headline with a
// simple finance keyword lexicon. Swap scoreHeadline() for an LLM call later.

const BULLISH = [
  "surge", "rally", "record", "profit", "beats", "beat", "upgrade", "buy",
  "jumps", "soars", "gains", "strong", "growth", "wins", "order", "expansion",
  "raises target", "bullish", "high", "outperform", "dividend", "bonus",
];
const BEARISH = [
  "falls", "drops", "plunge", "loss", "misses", "downgrade", "sell", "weak",
  "cuts", "probe", "penalty", "fraud", "slump", "crash", "bearish", "low",
  "underperform", "concern", "lawsuit", "default", "regulatory", "resign",
];

function scoreHeadline(title) {
  const t = title.toLowerCase();
  let score = 0;
  for (const w of BULLISH) if (t.includes(w)) score++;
  for (const w of BEARISH) if (t.includes(w)) score--;
  return Math.max(-1, Math.min(1, score));
}

export default async (req) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  if (!q) return json({ error: "q param required" }, 400);

  const rss = `https://news.google.com/rss/search?q=${encodeURIComponent(
    q + " stock NSE"
  )}&hl=en-IN&gl=IN&ceid=IN:en`;

  try {
    const res = await fetch(rss, { headers: { "User-Agent": "Mozilla/5.0" } });
    const xml = await res.text();

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .slice(0, 8)
      .map((m) => {
        const block = m[1];
        const pick = (tag) => {
          const r = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`));
          return r ? r[1].trim() : "";
        };
        const title = decode(pick("title"));
        return {
          title,
          link: pick("link"),
          source: decode(pick("source")) || "Google News",
          pubDate: pick("pubDate"),
          sentiment: scoreHeadline(title),
        };
      });

    return json({ items, live: true });
  } catch (err) {
    return json({ error: String(err) }, 502);
  }
};

function decode(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300", // cache headlines 5 min
    },
  });
