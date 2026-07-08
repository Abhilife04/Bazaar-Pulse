import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";
import { compact } from "../lib/format";

/* ------------------------------------------------------------------ */
/* Column detection — supports two formats:                             */
/*  A) SNAPSHOT:  Fund Name | Month | Asset Name | Sector | Shares Held */
/*                | Market Value | AUM Weight % | Fund AUM               */
/*     → month-over-month changes are COMPUTED by diffing snapshots.     */
/*  B) CHANGE:    Fund Name | Stock Name | Position | Change in Position */
/*     → changes are read directly.                                      */
/* ------------------------------------------------------------------ */

const ALIASES = {
  fund: ["fund name", "fund", "scheme", "scheme name", "amc"],
  stock: ["asset name", "stock name", "stock", "company", "company name", "security", "scrip", "asset"],
  month: ["month", "date", "as on", "period"],
  sector: ["sector", "industry"],
  position: ["shares held", "position", "holding", "quantity", "qty", "no of shares", "shares"],
  value: ["market value", "value", "mkt value", "holding value"],
  weight: ["aum weight", "weight", "% of aum", "% to nav", "portfolio weight"],
  change: ["change in position", "net change", "change in holding", "increase in holding", "increase/decrease"],
};

function matchColumns(headers) {
  const lower = headers.map((h) => String(h || "").trim().toLowerCase());
  const map = {};
  for (const [key, aliases] of Object.entries(ALIASES)) {
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

/** Normalize Excel serials / Dates / strings to a "YYYY-MM" key + label. */
function monthKey(v) {
  let d = null;
  if (v instanceof Date) d = v;
  else if (typeof v === "number" && v > 20000) {
    d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
  } else if (typeof v === "string") {
    const p = new Date(v);
    if (!Number.isNaN(p.getTime())) d = p;
  }
  if (!d) return { key: String(v), label: String(v) };
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const label = d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
  return { key, label };
}

export default function MFFlows() {
  const [dataset, setDataset] = useState(null); // {mode, rows, months?, funds}
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);

  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [fundFilter, setFundFilter] = useState("ALL");
  const [selectedStock, setSelectedStock] = useState("");

  function parseFile(file) {
    setError(""); setSelectedStock("");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array", cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        if (!raw.length) throw new Error("Sheet is empty");
        const cols = matchColumns(raw[0]);
        if (cols.fund == null || cols.stock == null) {
          throw new Error("Couldn't find Fund and Stock/Asset columns in the header row.");
        }

        const body = raw.slice(1).filter((r) => r[cols.fund] && r[cols.stock]);
        if (!body.length) throw new Error("No data rows found under the header row.");

        if (cols.month != null && cols.position != null) {
          /* ---- SNAPSHOT MODE ---- */
          const rows = body.map((r) => {
            const m = monthKey(r[cols.month]);
            return {
              fund: String(r[cols.fund]).trim(),
              stock: String(r[cols.stock]).trim(),
              sector: cols.sector != null ? String(r[cols.sector]).trim() : "",
              month: m.key,
              monthLabel: m.label,
              shares: num(r[cols.position]),
              value: cols.value != null ? num(r[cols.value]) : null,
              weight: cols.weight != null ? num(r[cols.weight]) : null,
            };
          });
          const months = [...new Map(rows.map((r) => [r.month, r.monthLabel])).entries()]
            .sort((a, b) => a[0].localeCompare(b[0]));
          if (months.length < 2) throw new Error("Snapshot format detected but fewer than 2 months present — need at least 2 to compute flows.");
          const funds = [...new Set(rows.map((r) => r.fund))].sort();
          setDataset({ mode: "snapshot", rows, months, funds });
          setFromMonth(months[months.length - 2][0]);
          setToMonth(months[months.length - 1][0]);
          setFundFilter("ALL");
        } else if (cols.change != null) {
          /* ---- CHANGE-COLUMN MODE (legacy) ---- */
          const rows = body.map((r) => ({
            fund: String(r[cols.fund]).trim(),
            stock: String(r[cols.stock]).trim(),
            sector: "",
            shares: cols.position != null ? num(r[cols.position]) : null,
            change: num(r[cols.change]),
          }));
          const funds = [...new Set(rows.map((r) => r.fund))].sort();
          setDataset({ mode: "change", rows, funds });
          setFundFilter("ALL");
        } else {
          throw new Error("Need either a Month + Shares Held combination (snapshots) or a Change in Position column.");
        }
        setFileName(file.name);
      } catch (err) {
        setError(err.message || "Failed to parse file");
        setDataset(null);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  /* ---------------- flow computation ---------------- */
  const flows = useMemo(() => {
    if (!dataset) return null;

    // entry list: {fund, stock, sector, from, to, change, flowValue, weightFrom, weightTo, status}
    let entries = [];

    if (dataset.mode === "snapshot") {
      const rel = dataset.rows.filter((r) => fundFilter === "ALL" || r.fund === fundFilter);
      const byFundStock = new Map();
      for (const r of rel) {
        const k = r.fund + "||" + r.stock;
        const e = byFundStock.get(k) || { fund: r.fund, stock: r.stock, sector: r.sector, snaps: {} };
        if (!e.sector && r.sector) e.sector = r.sector;
        // May 30 + May 31 → same key; keep the larger-shares snapshot (fuller disclosure)
        const prev = e.snaps[r.month];
        if (!prev || r.shares > prev.shares) e.snaps[r.month] = r;
        byFundStock.set(k, e);
      }
      for (const e of byFundStock.values()) {
        const a = e.snaps[fromMonth];
        const b = e.snaps[toMonth];
        if (!a && !b) continue;
        const from = a?.shares ?? 0;
        const to = b?.shares ?? 0;
        const change = to - from;
        // approximate price from market value / shares of whichever snapshot exists
        const price =
          b && b.value && b.shares ? b.value / b.shares :
          a && a.value && a.shares ? a.value / a.shares : null;
        entries.push({
          fund: e.fund, stock: e.stock, sector: e.sector,
          from, to, change,
          flowValue: price != null ? change * price : null, // in Lakhs
          weightFrom: a?.weight ?? null, weightTo: b?.weight ?? null,
          status: !a && b ? "NEW" : a && !b ? "EXIT" : "HELD",
        });
      }
    } else {
      entries = dataset.rows
        .filter((r) => fundFilter === "ALL" || r.fund === fundFilter)
        .map((r) => ({
          fund: r.fund, stock: r.stock, sector: "",
          from: null, to: r.shares, change: r.change, flowValue: null,
          weightFrom: null, weightTo: null,
          status: "HELD",
        }));
    }

    /* aggregate per stock */
    const byStock = new Map();
    for (const e of entries) {
      const s = byStock.get(e.stock) || {
        stock: e.stock, sector: e.sector, net: 0, flowValue: 0, hasFlowValue: false,
        buyers: 0, sellers: 0, news: 0, exits: 0, funds: [],
      };
      if (!s.sector && e.sector) s.sector = e.sector;
      s.net += e.change;
      if (e.flowValue != null) { s.flowValue += e.flowValue; s.hasFlowValue = true; }
      if (e.change > 0) s.buyers++;
      else if (e.change < 0) s.sellers++;
      if (e.status === "NEW") s.news++;
      if (e.status === "EXIT") s.exits++;
      s.funds.push(e);
      byStock.set(e.stock, s);
    }
    const stocks = [...byStock.values()].sort((a, b) =>
      (b.hasFlowValue ? b.flowValue : b.net) - (a.hasFlowValue ? a.flowValue : a.net)
    );

    /* aggregate per sector */
    const bySector = new Map();
    for (const s of stocks) {
      if (!s.sector) continue;
      const g = bySector.get(s.sector) || { sector: s.sector, flowValue: 0, net: 0 };
      g.flowValue += s.flowValue;
      g.net += s.net;
      bySector.set(s.sector, g);
    }
    const sectors = [...bySector.values()].sort((a, b) => b.flowValue - a.flowValue);

    const newEntries = entries.filter((e) => e.status === "NEW");
    const exits = entries.filter((e) => e.status === "EXIT");

    return { entries, stocks, sectors, newEntries, exits };
  }, [dataset, fromMonth, toMonth, fundFilter]);

  const monthLabel = (key) => dataset?.months?.find((m) => m[0] === key)?.[1] || key;

  const chartData = useMemo(() => {
    if (!flows) return [];
    const metric = (s) => (s.hasFlowValue ? s.flowValue : s.net);
    const sorted = [...flows.stocks].sort((a, b) => metric(b) - metric(a));
    const top = sorted.slice(0, 8);
    const bottom = sorted.slice(-8).filter((s) => !top.includes(s)).reverse();
    return [...top, ...bottom].map((s) => ({ name: s.stock.replace(/ Limited$/i, ""), v: +metric(s).toFixed(1) }));
  }, [flows]);

  const detail = useMemo(() => {
    if (!flows || !selectedStock) return null;
    return flows.stocks.find((s) => s.stock === selectedStock) || null;
  }, [flows, selectedStock]);

  const isSnapshot = dataset?.mode === "snapshot";
  const valueUnit = "₹ Lakhs (est.)";

  return (
    <div>
      {!dataset && (
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
            <div><strong>Drop your mutual fund holdings Excel here</strong> or click to browse</div>
            <div className="small">
              Monthly snapshots (Fund · Month · Asset · Shares Held …) or a change-column sheet — both work.
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
          </div>
        </>
      )}

      {dataset && flows && (
        <>
          <div className="controls">
            <span className="badge">{fileName} · {dataset.funds.length} funds · {flows.stocks.length} stocks</span>
            {isSnapshot && (
              <>
                <select value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} aria-label="From month">
                  {dataset.months.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <span className="neutral">→</span>
                <select value={toMonth} onChange={(e) => setToMonth(e.target.value)} aria-label="To month">
                  {dataset.months.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </>
            )}
            <select value={fundFilter} onChange={(e) => setFundFilter(e.target.value)} aria-label="Fund filter">
              <option value="ALL">All funds</option>
              {dataset.funds.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <button className="btn ghost" onClick={() => { setDataset(null); setSelectedStock(""); }}>
              Upload a different file
            </button>
          </div>

          <div className="grid cols-4">
            <div className="card">
              <h3>Top accumulation</h3>
              <div className="big up">{flows.stocks[0]?.stock.replace(/ Limited$/i, "") || "—"}</div>
              <div className="hint">
                {flows.stocks[0]?.hasFlowValue
                  ? `≈ ₹${compact(flows.stocks[0].flowValue)} L net buying`
                  : `+${compact(flows.stocks[0]?.net || 0)} shares net`}
              </div>
            </div>
            <div className="card">
              <h3>Top distribution</h3>
              <div className="big down">{flows.stocks[flows.stocks.length - 1]?.stock.replace(/ Limited$/i, "") || "—"}</div>
              <div className="hint">
                {flows.stocks[flows.stocks.length - 1]?.hasFlowValue
                  ? `≈ ₹${compact(flows.stocks[flows.stocks.length - 1].flowValue)} L net selling`
                  : `${compact(flows.stocks[flows.stocks.length - 1]?.net || 0)} shares net`}
              </div>
            </div>
            <div className="card">
              <h3>Fresh entries</h3>
              <div className="big" style={{ color: "var(--saffron)" }}>{flows.newEntries.length}</div>
              <div className="hint">{isSnapshot ? `New fund-stock positions in ${monthLabel(toMonth)}` : "Not available in this format"}</div>
            </div>
            <div className="card">
              <h3>Complete exits</h3>
              <div className="big" style={{ color: "var(--saffron)" }}>{flows.exits.length}</div>
              <div className="hint">{isSnapshot ? `Positions fully sold since ${monthLabel(fromMonth)}` : "Not available in this format"}</div>
            </div>
          </div>

          <div className="section-title">
            Net flows by stock
            <small>{isSnapshot ? `${monthLabel(fromMonth)} → ${monthLabel(toMonth)} · Δshares × price, ${valueUnit}` : "net share change"}</small>
          </div>
          <div className="card" style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 55 }}>
                <XAxis dataKey="name" angle={-38} textAnchor="end" tick={{ fill: "#8b94a7", fontSize: 10.5 }} interval={0} />
                <YAxis tick={{ fill: "#8b94a7", fontSize: 11 }} tickFormatter={compact} />
                <Tooltip
                  formatter={(v) => [compact(v), isSnapshot ? valueUnit : "Net shares"]}
                  contentStyle={{ background: "#141b2b", border: "1px solid #232e47", borderRadius: 8 }}
                  labelStyle={{ color: "#e8ecf4" }}
                />
                <ReferenceLine y={0} stroke="#232e47" />
                <Bar dataKey="v" radius={[4, 4, 0, 0]}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.v >= 0 ? "#2ecc8f" : "#ff5c5c"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {isSnapshot && flows.sectors.length > 0 && (
            <>
              <div className="section-title">Sector rotation <small>net estimated flow, {valueUnit}</small></div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Sector</th><th>Net flow</th><th>Net shares</th></tr>
                  </thead>
                  <tbody>
                    {flows.sectors.map((s) => (
                      <tr key={s.sector}>
                        <td className="name">{s.sector}</td>
                        <td className={s.flowValue >= 0 ? "up" : "down"}>
                          {s.flowValue >= 0 ? "+" : ""}₹{compact(s.flowValue)} L
                        </td>
                        <td className={s.net >= 0 ? "up" : "down"}>{s.net >= 0 ? "+" : ""}{compact(s.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="section-title">Stock-wise flows <small>click a row for fund-level detail</small></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Stock</th>
                  {isSnapshot && <th>Sector</th>}
                  <th>Net Δ shares</th>
                  {isSnapshot && <th>Est. flow</th>}
                  <th>Adding</th>
                  <th>Cutting</th>
                  <th>New / Exit</th>
                </tr>
              </thead>
              <tbody>
                {flows.stocks.map((s) => (
                  <tr key={s.stock} onClick={() => setSelectedStock(s.stock)} style={{ cursor: "pointer" }}>
                    <td className="name">{s.stock.replace(/ Limited$/i, "")}</td>
                    {isSnapshot && <td className="neutral" style={{ fontFamily: "var(--font-display)", fontSize: 12 }}>{s.sector || "—"}</td>}
                    <td className={s.net >= 0 ? "up" : "down"}>{s.net >= 0 ? "+" : ""}{compact(s.net)}</td>
                    {isSnapshot && (
                      <td className={s.flowValue >= 0 ? "up" : "down"}>
                        {s.hasFlowValue ? (s.flowValue >= 0 ? "+" : "") + "₹" + compact(s.flowValue) + " L" : "—"}
                      </td>
                    )}
                    <td className="up">{s.buyers}</td>
                    <td className="down">{s.sellers}</td>
                    <td className="neutral">
                      {s.news ? <span className="pill pos">{s.news} new</span> : null}
                      {s.exits ? <span className="pill neg">{s.exits} exit</span> : null}
                      {!s.news && !s.exits ? "—" : null}
                    </td>
                  </tr>
                ))}
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
                      {isSnapshot && <th>{monthLabel(fromMonth)} shares</th>}
                      <th>{isSnapshot ? monthLabel(toMonth) + " shares" : "Position"}</th>
                      <th>Change</th>
                      {isSnapshot && <th>Weight %</th>}
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.funds
                      .slice()
                      .sort((a, b) => b.change - a.change)
                      .map((f, i) => (
                        <tr key={i}>
                          <td className="name">{f.fund}</td>
                          {isSnapshot && <td>{compact(f.from)}</td>}
                          <td>{compact(f.to)}</td>
                          <td className={f.change >= 0 ? "up" : "down"}>{f.change >= 0 ? "+" : ""}{compact(f.change)}</td>
                          {isSnapshot && (
                            <td className="neutral">
                              {f.weightFrom != null ? f.weightFrom.toFixed(2) : "—"} → {f.weightTo != null ? f.weightTo.toFixed(2) : "—"}
                            </td>
                          )}
                          <td>
                            {f.status === "NEW" && <span className="pill pos">NEW</span>}
                            {f.status === "EXIT" && <span className="pill neg">EXIT</span>}
                            {f.status === "HELD" && <span className="neutral">held</span>}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {isSnapshot && (
            <div className="note">
              "Est. flow" ≈ change in shares × latest available price (market value ÷ shares), in ₹ Lakhs.
              It approximates buying/selling value and ignores intramonth price moves. Months with two
              disclosure dates (e.g. 30th and 31st) are merged, keeping the fuller snapshot.
            </div>
          )}
        </>
      )}
    </div>
  );
}
