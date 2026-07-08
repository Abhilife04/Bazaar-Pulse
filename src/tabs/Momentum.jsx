import { useEffect, useMemo, useState } from "react";
import { getQuotes, getNews } from "../lib/api";
import { compact, fmtC, pct, momentumScore, scoreColor } from "../lib/format";

const DEFAULT_WATCHLIST = ["RELIANCE", "HDFCBANK", "TATAMOTORS", "INFY", "ADANIENT", "SBIN", "ZOMATO", "ITC"];

export default function Momentum({ setLive }) {
  const [watchlist, setWatchlist] = useState(DEFAULT_WATCHLIST);
  const [quotes, setQuotes] = useState([]);
  const [news, setNews] = useState({}); // symbol -> items
  const [selected, setSelected] = useState(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh(list = watchlist) {
    setLoading(true);
    const q = await getQuotes(list);
    setQuotes(q.quotes);
    setLive(q.live);
    // fetch news for each symbol (fire in parallel, tolerate failures)
    const entries = await Promise.all(
      q.quotes.map(async (s) => [s.symbol, (await getNews(s.symbol)).items])
    );
    setNews(Object.fromEntries(entries));
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const id = setInterval(() => refresh(), 60_000); // refresh every minute
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    return quotes
      .map((s) => {
        const items = news[s.symbol] || [];
        const sentiment = items.length
          ? items.reduce((a, n) => a + (n.sentiment || 0), 0) / items.length
          : 0;
        const score = momentumScore({ ...s, sentiment });
        const surge = s.avgVolume20d ? s.volume / s.avgVolume20d : null;
        return { ...s, sentiment, score, surge, headlines: items.length };
      })
      .sort((a, b) => b.score - a.score);
  }, [quotes, news]);

  function addSymbol() {
    const sym = input.trim().toUpperCase();
    if (!sym || watchlist.includes(sym)) return;
    const next = [...watchlist, sym];
    setWatchlist(next);
    setInput("");
    refresh(next);
  }

  const gainers = rows.filter((r) => r.changePct > 0).length;
  const surging = rows.filter((r) => r.surge && r.surge > 1.5).length;

  return (
    <div>
      <div className="grid cols-3">
        <div className="card">
          <h3>Watchlist breadth</h3>
          <div className="big">
            <span className="up">{gainers}</span>
            <span className="neutral"> / {rows.length} advancing</span>
          </div>
          <div className="hint">Stocks trading above previous close</div>
        </div>
        <div className="card">
          <h3>Volume surges</h3>
          <div className="big" style={{ color: "var(--saffron)" }}>{surging}</div>
          <div className="hint">Trading at &gt;1.5× their 20-day average volume</div>
        </div>
        <div className="card">
          <h3>Top momentum</h3>
          <div className="big">{rows[0]?.symbol || "—"}</div>
          <div className="hint">Composite of volume surge, price move & news tone</div>
        </div>
      </div>

      <div className="section-title">
        Momentum screener
        <small>score = 40% volume surge · 35% price change · 25% news sentiment</small>
      </div>

      <div className="controls">
        <input
          type="text"
          placeholder="Add NSE symbol e.g. WIPRO"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addSymbol()}
        />
        <button className="btn ghost" onClick={addSymbol}>Add to watchlist</button>
        <button className="btn" onClick={() => refresh()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh now"}
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Stock</th>
              <th>LTP</th>
              <th>Change</th>
              <th>Volume</th>
              <th>vs 20-day avg</th>
              <th>News tone</th>
              <th>Momentum</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} onClick={() => setSelected(r.symbol)} style={{ cursor: "pointer" }}>
                <td className="name">
                  {r.symbol}
                  <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>{r.name || ""}</div>
                </td>
                <td>{fmtC(r.ltp)}</td>
                <td className={r.changePct >= 0 ? "up" : "down"}>{pct(r.changePct)}</td>
                <td>{compact(r.volume)}</td>
                <td className={r.surge > 1.5 ? "up" : r.surge < 0.8 ? "down" : "neutral"}>
                  {r.surge ? r.surge.toFixed(2) + "×" : "—"}
                </td>
                <td className={r.sentiment > 0.15 ? "up" : r.sentiment < -0.15 ? "down" : "neutral"}>
                  {r.headlines ? (r.sentiment > 0.15 ? "Positive" : r.sentiment < -0.15 ? "Negative" : "Mixed") : "No news"}
                </td>
                <td>
                  <span className="score">
                    <span className="score-bar">
                      <span className="score-fill" style={{ width: r.score + "%", background: scoreColor(r.score) }} />
                    </span>
                    {r.score}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <>
          <div className="section-title">
            Headlines — {selected}
            <small>Google News RSS, keyword-scored</small>
          </div>
          <div className="card">
            {(news[selected] || []).length === 0 && <div className="empty">No recent headlines found.</div>}
            {(news[selected] || []).map((n, i) => (
              <div className="news-item" key={i}>
                <a href={n.link} target="_blank" rel="noreferrer">{n.title}</a>
                <span className={"pill " + (n.sentiment > 0 ? "pos" : n.sentiment < 0 ? "neg" : "neu")}>
                  {n.sentiment > 0 ? "bullish" : n.sentiment < 0 ? "bearish" : "neutral"}
                </span>
                <div className="meta">{n.source}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="note">
        Click any row to see its scored headlines. The sentiment model here is a simple keyword
        scorer running in a Netlify function — swap it for an LLM or FinBERT endpoint later without
        touching the UI.
      </div>
    </div>
  );
}
