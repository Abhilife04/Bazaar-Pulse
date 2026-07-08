import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";
import { compact } from "../lib/format";

/**
 * Expected columns (order & exact names don't matter — matched fuzzily):
 *   Fund Name | Stock Name | Position | Change in Position | Increase in Holding
 * Extra columns are ignored. Numbers may contain commas.
 */
const COLUMN_ALIASES = {
  fund: ["fund name", "fund", "scheme", "scheme name", "amc"],
  stock: ["stock name", "stock", "company", "company name", "security", "scrip"],
  position: ["position", "holding", "shares held", "quantity", "qty", "no of shares"],
  change: ["change in position", "change", "net change", "chg", "change in holding", "increase in holding", "increase/decrease"],
};

function matchColumns(headers) {
  const lower = headers.map((h) => String(h || "").trim().toLowerCase());
  const map = {};
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = lower.findIndex((h) => aliases.some((a) => h === a || h.includes(a)));
    if (idx !== -1) map[key] = idx;
  }
  return map;
}

const num = (v) => {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[,%₹\s]/g, ""));
  return Number.isNaN(n) ? 0 : n;
};

export default function MFFlows() {
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [stockFilter, setStockFilter] = useState("");

  function parseFile(file) {
    setError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        if (!raw.length) throw new Error("Sheet is empty");
        const cols = matchColumns(raw[0]);
        if (cols.fund == null || cols.stock == null || cols.change == null) {
          throw new Error(
            "Couldn't find required columns. Need headers like: Fund Name, Stock Name, Change in Position."
          );
        }
        const parsed = raw
          .slice(1)
          .filter((r) => r[cols.fund] && r[cols.stock])
          .map((r) => ({
            fund: String(r[cols.fund]).trim(),
            stock: String(r[cols.stock]).trim(),
            position: cols.position != null ? num(r[cols.position]) : null,
            change: num(r[cols.change]),
          }));
        if (!parsed.length) throw new Error("No data rows found under the header row.");
        setRows(parsed);
        setFileName(file.name);
      } catch (err) {
        setError(err.message || "Failed to parse file");
        setRows(null);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  const agg = useMemo(() => {
    if (!rows) return null;
    const byStock = new Map();
    const byFund = new Map();
    for (const r of rows) {
      const s = byStock.get(r.stock) || { stock: r.stock, net: 0, buyers: 0, sellers: 0, funds: [] };
      s.net += r.change;
      if (r.change > 0) s.buyers++;
      else if (r.change < 0) s.sellers++;
      s.funds.push(r);
      byStock.set(r.stock, s);

      const f = byFund.get(r.fund) || { fund: r.fund, net: 0, adds: 0, cuts: 0 };
      f.net += r.change;
      if (r.change > 0) f.adds++;
      else if (r.change < 0) f.cuts++;
      byFund.set(r.fund, f);
    }
    const stocks = [...byStock.values()].sort((a, b) => b.net - a.net);
    const funds = [...byFund.values()].sort((a, b) => b.net - a.net);
    return { stocks, funds };
  }, [rows]);

  const chartData = useMemo(() => {
    if (!agg) return [];
    const top = agg.stocks.slice(0, 8);
    const bottom = agg.stocks.slice(-8).filter((s) => !top.includes(s));
    return [...top, ...bottom.reverse()].map((s) => ({ name: s.stock, net: s.net }));
  }, [agg]);

  const detail = useMemo(() => {
    if (!agg || !stockFilter) return null;
    return agg.stocks.find((s) => s.stock === stockFilter) || null;
  }, [agg, stockFilter]);

  return (
    <div>
      {!rows && (
        <>
          <label
            className={"dropzone" + (drag ? " drag" : "")}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault(); setDrag(false);
              if (e.dataTransfer.files[0]) parseFile(e.dataTransfer.files[0]);
            }}
          >
            <div><strong>Drop your mutual fund flows Excel here</strong> or click to browse</div>
            <div className="small">
              Expected headers (any order): Fund Name · Stock Name · Position · Change in Position / Increase in Holding
            </div>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: "none" }}
              onChange={(e) => e.target.files[0] && parseFile(e.target.files[0])}
            />
          </label>
          {error && <div className="note" style={{ borderLeftColor: "var(--down)" }}>{error}</div>}
          <div className="note">
            Everything is parsed <strong>in your browser</strong> — the file never leaves your machine.
            You can export this data from AMC portfolio disclosures or trackers like Trendlyne / Rupeevest.
          </div>
        </>
      )}

      {rows && agg && (
        <>
          <div className="controls">
            <span className="badge">{fileName} · {rows.length} rows · {agg.funds.length} funds · {agg.stocks.length} stocks</span>
            <button className="btn ghost" onClick={() => { setRows(null); setStockFilter(""); }}>
              Upload a different file
            </button>
          </div>

          <div className="grid cols-3">
            <div className="card">
              <h3>Most accumulated</h3>
              <div className="big up">{agg.stocks[0]?.stock || "—"}</div>
              <div className="hint">Net +{compact(agg.stocks[0]?.net || 0)} shares across funds</div>
            </div>
            <div className="card">
              <h3>Most distributed</h3>
              <div className="big down">{agg.stocks[agg.stocks.length - 1]?.stock || "—"}</div>
              <div className="hint">Net {compact(agg.stocks[agg.stocks.length - 1]?.net || 0)} shares</div>
            </div>
            <div className="card">
              <h3>Most active fund</h3>
              <div className="big">{[...agg.funds].sort((a, b) => (b.adds + b.cuts) - (a.adds + a.cuts))[0]?.fund || "—"}</div>
              <div className="hint">By number of position changes</div>
            </div>
          </div>

          <div className="section-title">Net fund flows by stock <small>top accumulation vs distribution</small></div>
          <div className="card" style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 40 }}>
                <XAxis dataKey="name" angle={-35} textAnchor="end" tick={{ fill: "#8b94a7", fontSize: 11 }} interval={0} />
                <YAxis tick={{ fill: "#8b94a7", fontSize: 11 }} tickFormatter={compact} />
                <Tooltip
                  formatter={(v) => [compact(v), "Net change (shares)"]}
                  contentStyle={{ background: "#141b2b", border: "1px solid #232e47", borderRadius: 8 }}
                  labelStyle={{ color: "#e8ecf4" }}
                />
                <ReferenceLine y={0} stroke="#232e47" />
                <Bar dataKey="net" radius={[4, 4, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.net >= 0 ? "#2ecc8f" : "#ff5c5c"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="section-title">Stock-wise flows <small>click a row for fund-level detail</small></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Stock</th>
                  <th>Net change (shares)</th>
                  <th>Funds adding</th>
                  <th>Funds cutting</th>
                  <th>Conviction</th>
                </tr>
              </thead>
              <tbody>
                {agg.stocks.map((s) => {
                  const conviction = s.buyers + s.sellers ? s.buyers / (s.buyers + s.sellers) : 0;
                  return (
                    <tr key={s.stock} onClick={() => setStockFilter(s.stock)} style={{ cursor: "pointer" }}>
                      <td className="name">{s.stock}</td>
                      <td className={s.net >= 0 ? "up" : "down"}>{s.net >= 0 ? "+" : ""}{compact(s.net)}</td>
                      <td className="up">{s.buyers}</td>
                      <td className="down">{s.sellers}</td>
                      <td className={conviction > 0.6 ? "up" : conviction < 0.4 ? "down" : "neutral"}>
                        {(conviction * 100).toFixed(0)}% buying
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {detail && (
            <>
              <div className="section-title">Fund positions — {detail.stock}</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fund</th>
                      <th>Position</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.funds
                      .slice()
                      .sort((a, b) => b.change - a.change)
                      .map((f, i) => (
                        <tr key={i}>
                          <td className="name">{f.fund}</td>
                          <td>{f.position != null ? compact(f.position) : "—"}</td>
                          <td className={f.change >= 0 ? "up" : "down"}>
                            {f.change >= 0 ? "+" : ""}{compact(f.change)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
