import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import { getOptionChain } from "../lib/api";
import { compact, fmt } from "../lib/format";

const UNDERLYINGS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "RELIANCE", "HDFCBANK", "TATAMOTORS", "SBIN", "INFY", "TCS"];

function maxPain(strikes) {
  // Strike where total option writers' payout is minimised
  let best = null;
  for (const s of strikes) {
    let pain = 0;
    for (const o of strikes) {
      pain += Math.max(0, s.strike - o.strike) * o.call.oi; // calls ITM below expiry price
      pain += Math.max(0, o.strike - s.strike) * o.put.oi;  // puts ITM above expiry price
    }
    if (!best || pain < best.pain) best = { strike: s.strike, pain };
  }
  return best?.strike ?? null;
}

export default function OptionChain({ setLive }) {
  const [underlying, setUnderlying] = useState("NIFTY");
  const [chain, setChain] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load(u = underlying) {
    setLoading(true);
    const data = await getOptionChain(u);
    setChain(data);
    setLive(data.live);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const id = setInterval(() => load(), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [underlying]);

  const stats = useMemo(() => {
    if (!chain) return null;
    const callOI = chain.strikes.reduce((a, s) => a + s.call.oi, 0);
    const putOI = chain.strikes.reduce((a, s) => a + s.put.oi, 0);
    const pcr = callOI ? putOI / callOI : 0;
    const mp = maxPain(chain.strikes);
    const maxCallOI = [...chain.strikes].sort((a, b) => b.call.oi - a.call.oi)[0];
    const maxPutOI = [...chain.strikes].sort((a, b) => b.put.oi - a.put.oi)[0];
    return { callOI, putOI, pcr, mp, maxCallOI, maxPutOI };
  }, [chain]);

  const chartData = useMemo(() => {
    if (!chain) return [];
    return chain.strikes.map((s) => ({
      strike: s.strike,
      "Call OI": s.call.oi,
      "Put OI": s.put.oi,
    }));
  }, [chain]);

  const atmIndex = useMemo(() => {
    if (!chain) return -1;
    let idx = 0, min = Infinity;
    chain.strikes.forEach((s, i) => {
      const d = Math.abs(s.strike - chain.spot);
      if (d < min) { min = d; idx = i; }
    });
    return idx;
  }, [chain]);

  return (
    <div>
      <div className="controls">
        <select value={underlying} onChange={(e) => setUnderlying(e.target.value)}>
          {UNDERLYINGS.map((u) => <option key={u}>{u}</option>)}
        </select>
        <button className="btn" onClick={() => load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh chain"}
        </button>
        {chain && <span className="badge">Spot {fmt.format(chain.spot)} · expiry {chain.expiry}</span>}
      </div>

      {stats && (
        <div className="grid cols-4">
          <div className="card">
            <h3>Put/Call ratio (OI)</h3>
            <div className="big" style={{ color: stats.pcr > 1.2 ? "var(--up)" : stats.pcr < 0.8 ? "var(--down)" : "var(--saffron)" }}>
              {stats.pcr.toFixed(2)}
            </div>
            <div className="hint">{stats.pcr > 1.2 ? "Put-heavy — often read as support building" : stats.pcr < 0.8 ? "Call-heavy — often read as resistance / bearish tilt" : "Balanced"}</div>
          </div>
          <div className="card">
            <h3>Max pain</h3>
            <div className="big">{stats.mp ? fmt.format(stats.mp) : "—"}</div>
            <div className="hint">Strike minimising option writers' payout</div>
          </div>
          <div className="card">
            <h3>Highest call OI</h3>
            <div className="big down">{fmt.format(stats.maxCallOI.strike)}</div>
            <div className="hint">{compact(stats.maxCallOI.call.oi)} contracts — potential resistance</div>
          </div>
          <div className="card">
            <h3>Highest put OI</h3>
            <div className="big up">{fmt.format(stats.maxPutOI.strike)}</div>
            <div className="hint">{compact(stats.maxPutOI.put.oi)} contracts — potential support</div>
          </div>
        </div>
      )}

      <div className="section-title">Open interest by strike</div>
      <div className="card" style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <XAxis dataKey="strike" tick={{ fill: "#8b94a7", fontSize: 11 }} />
            <YAxis tick={{ fill: "#8b94a7", fontSize: 11 }} tickFormatter={compact} />
            <Tooltip
              formatter={(v, name) => [compact(v), name]}
              contentStyle={{ background: "#141b2b", border: "1px solid #232e47", borderRadius: 8 }}
              labelStyle={{ color: "#e8ecf4" }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {chain && <ReferenceLine x={chain.strikes[atmIndex]?.strike} stroke="#f2a33c" strokeDasharray="4 4" label={{ value: "spot", fill: "#f2a33c", fontSize: 11 }} />}
            <Bar dataKey="Call OI" fill="#ff5c5c" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Put OI" fill="#2ecc8f" radius={[3, 3, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="section-title">Chain <small>CALLS · strike · PUTS — ATM row highlighted</small></div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Call OI</th>
              <th>OI chg</th>
              <th>IV</th>
              <th>LTP</th>
              <th style={{ textAlign: "center" }}>Strike</th>
              <th>LTP</th>
              <th>IV</th>
              <th>OI chg</th>
              <th>Put OI</th>
            </tr>
          </thead>
          <tbody>
            {chain?.strikes.map((s, i) => (
              <tr key={s.strike} style={i === atmIndex ? { background: "rgba(242,163,60,0.08)" } : undefined}>
                <td>{compact(s.call.oi)}</td>
                <td className={s.call.oiChange >= 0 ? "up" : "down"}>
                  {s.call.oiChange >= 0 ? "+" : ""}{compact(s.call.oiChange)}
                </td>
                <td className="neutral">{s.call.iv}%</td>
                <td>{s.call.ltp}</td>
                <td className="name" style={{ textAlign: "center", fontFamily: "var(--font-mono)", color: "var(--saffron)" }}>
                  {fmt.format(s.strike)}
                </td>
                <td>{s.put.ltp}</td>
                <td className="neutral">{s.put.iv}%</td>
                <td className={s.put.oiChange >= 0 ? "up" : "down"}>
                  {s.put.oiChange >= 0 ? "+" : ""}{compact(s.put.oiChange)}
                </td>
                <td>{compact(s.put.oi)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="note">
        OI change interpretations (support/resistance, PCR tilt) are conventional heuristics, not signals.
        Once your Upstox token is set, this tab pulls the live chain via <code>/api/option-chain</code>.
      </div>
    </div>
  );
}
