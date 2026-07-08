import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { compact } from "../lib/format";

/* ------------------------------------------------------------------ */
/* Per-fund view: each fund gets a sub-section with TWO tables —        */
/*   ▲ Increased holdings (incl. NEW entries)                           */
/*   ▼ Decreased holdings (incl. complete EXITs)                        */
/* Supports snapshot format (Fund|Month|Asset|Sector|Shares…) and the   */
/* legacy change-column format.                                         */
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

function monthKey(v) {
  let d = null;
  if (v instanceof Date) d = v;
  else if (typeof v === "number" && v > 20000) d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
  else if (typeof v === "string") {
    const p = new Date(v);
    if (!Number.isNaN(p.getTime())) d = p;
  }
  if (!d) return { key: String(v), label: String(v) };
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const label = d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
  return { key, label };
}

const short = (s) => s.replace(/\s+(Limited|Ltd\.?)$/i, "");

/* Reusable table for one direction */
function HoldingsTable({ items, isSnapshot, direction, fromLabel, toLabel }) {
  const up = direction === "up";
  return (
    <div className="table-wrap" style={{ marginBottom: 18 }}>
      <table>
        <thead>
          <tr>
            <th>Stock</th>
            <th>Sector / Industry</th>
            <th>{up ? "Shares added" : "Shares reduced"}</th>
            {isSnapshot && <th>{up ? "Est. buy" : "Est. sell"}</th>}
            {isSnapshot && <th>Weight % ({fromLabel} → {toLabel})</th>}
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.stock}>
              <td className="name">{short(e.stock)}</td>
              <td className="neutral" style={{ fontFamily: "var(--font-display)", fontSize: 12, textAlign: "left" }}>
                {e.sector}
              </td>
              <td className={up ? "up" : "down"}>
                {up ? "+" : ""}{compact(e.change)}
              </td>
              {isSnapshot && (
                <td className={up ? "up" : "down"}>
                  {e.flowValue != null ? "₹" + compact(Math.abs(e.flowValue)) + " L" : "—"}
                </td>
              )}
              {isSnapshot && (
                <td className="neutral">
                  {e.weightFrom != null ? e.weightFrom.toFixed(2) : "0.00"} → {e.weightTo != null ? e.weightTo.toFixed(2) : "0.00"}
                </td>
              )}
              <td>
                {e.isNew && <span className="pill pos" style={{ marginLeft: 0 }}>NEW ENTRY</span>}
                {e.isExit && <span className="pill neg" style={{ marginLeft: 0 }}>FULL EXIT</span>}
                {!e.isNew && !e.isExit && <span className="neutral">{up ? "added" : "trimmed"}</span>}
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={isSnapshot ? 6 : 4} className="neutral" style={{ textAlign: "left" }}>
                {up ? "No holdings increased in this period" : "No holdings decreased in this period"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function MFFlows() {
  const [dataset, setDataset] = useState(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [show, setShow] = useState("both"); // both | up | down

  function parseFile(file) {
    setError("");
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
          if (months.length < 2) throw new Error("Need at least 2 months of snapshots to compute changes.");
          const funds = [...new Set(rows.map((r) => r.fund))].sort();
          setDataset({ mode: "snapshot", rows, months, funds });
          setFromMonth(months[months.length - 2][0]);
          setToMonth(months[months.length - 1][0]);
        } else if (cols.change != null) {
          const rows = body.map((r) => ({
            fund: String(r[cols.fund]).trim(),
            stock: String(r[cols.stock]).trim(),
            sector: cols.sector != null ? String(r[cols.sector]).trim() : "",
            shares: cols.position != null ? num(r[cols.position]) : null,
            change: num(r[cols.change]),
          }));
          const funds = [...new Set(rows.map((r) => r.fund))].sort();
          setDataset({ mode: "change", rows, funds });
        } else {
          throw new Error("Need either Month + Shares Held columns (snapshots) or a Change in Position column.");
        }
        setFileName(file.name);
      } catch (err) {
        setError(err.message || "Failed to parse file");
        setDataset(null);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  const fundSections = useMemo(() => {
    if (!dataset) return null;

    let entries = [];
    if (dataset.mode === "snapshot") {
      const byFundStock = new Map();
      for (const r of dataset.rows) {
        const k = r.fund + "||" + r.stock;
        const e = byFundStock.get(k) || { fund: r.fund, stock: r.stock, sector: r.sector, snaps: {} };
        if (!e.sector && r.sector) e.sector = r.sector;
        const prev = e.snaps[r.month];
        if (!prev || r.shares > prev.shares) e.snaps[r.month] = r; // merge dup dates in a month
        byFundStock.set(k, e);
      }
      for (const e of byFundStock.values()) {
        const a = e.snaps[fromMonth];
        const b = e.snaps[toMonth];
        if (!a && !b) continue;
        const from = a?.shares ?? 0;
        const to = b?.shares ?? 0;
        const change = to - from;
        if (change === 0) continue;
        const price =
          b && b.value && b.shares ? b.value / b.shares :
          a && a.value && a.shares ? a.value / a.shares : null;
        entries.push({
          fund: e.fund, stock: e.stock, sector: e.sector || "—",
          from, to, change,
          flowValue: price != null ? change * price : null,
          weightFrom: a?.weight ?? null, weightTo: b?.weight ?? null,
          isNew: !a && !!b,
          isExit: !!a && !b,
        });
      }
    } else {
      entries = dataset.rows
        .filter((r) => r.change !== 0)
        .map((r) => ({
          fund: r.fund, stock: r.stock, sector: r.sector || "—",
          from: null, to: r.shares, change: r.change,
          flowValue: null, weightFrom: null, weightTo: null,
          isNew: false, isExit: false,
        }));
    }

    const byFund = new Map();
    for (const e of entries) {
      const f = byFund.get(e.fund) || {
        fund: e.fund, ups: [], downs: [],
        buyValue: 0, sellValue: 0, hasValue: false,
        newCount: 0, exitCount: 0,
        buySectors: new Map(), sellSectors: new Map(),
      };
      if (e.change > 0) {
        f.ups.push(e);
        if (e.flowValue != null) { f.buyValue += e.flowValue; f.hasValue = true; }
        if (e.isNew) f.newCount++;
        f.buySectors.set(e.sector, (f.buySectors.get(e.sector) || 0) + (e.flowValue ?? e.change));
      } else {
        f.downs.push(e);
        if (e.flowValue != null) { f.sellValue += e.flowValue; f.hasValue = true; }
        if (e.isExit) f.exitCount++;
        f.sellSectors.set(e.sector, (f.sellSectors.get(e.sector) || 0) + Math.abs(e.flowValue ?? e.change));
      }
      byFund.set(e.fund, f);
    }

    return [...byFund.values()]
      .sort((a, b) => a.fund.localeCompare(b.fund))
      .map((f) => ({
        ...f,
        ups: f.ups.sort((x, y) => (y.flowValue ?? y.change) - (x.flowValue ?? x.change)),
        downs: f.downs.sort((x, y) => (x.flowValue ?? x.change) - (y.flowValue ?? y.change)),
        topBuySectors: [...f.buySectors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s),
        topSellSectors: [...f.sellSectors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s),
      }));
  }, [dataset, fromMonth, toMonth]);

  const monthLabel = (key) => dataset?.months?.find((m) => m[0] === key)?.[1] || key;
  const isSnapshot = dataset?.mode === "snapshot";
  const totals = useMemo(() => {
    if (!fundSections) return null;
    return {
      ups: fundSections.reduce((a, f) => a + f.ups.length, 0),
      downs: fundSections.reduce((a, f) => a + f.downs.length, 0),
      news: fundSections.reduce((a, f) => a + f.newCount, 0),
      exits: fundSections.reduce((a, f) => a + f.exitCount, 0),
    };
  }, [fundSections]);

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

      {dataset && fundSections && totals && (
        <>
          <div className="controls">
            <span className="badge">{fileName}</span>
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
            <select value={show} onChange={(e) => setShow(e.target.value)} aria-label="Direction filter">
              <option value="both">Increases & decreases</option>
              <option value="up">Increases only</option>
              <option value="down">Decreases only</option>
            </select>
            <button className="btn ghost" onClick={() => setDataset(null)}>Upload a different file</button>
          </div>

          <div className="grid cols-4">
            <div className="card">
              <h3>Holdings increased</h3>
              <div className="big up">{totals.ups}</div>
              <div className="hint">{isSnapshot ? `${monthLabel(fromMonth)} → ${monthLabel(toMonth)}` : "across all funds"}</div>
            </div>
            <div className="card">
              <h3>Holdings decreased</h3>
              <div className="big down">{totals.downs}</div>
              <div className="hint">Positions trimmed or sold</div>
            </div>
            <div className="card">
              <h3>Fresh entries</h3>
              <div className="big" style={{ color: "var(--saffron)" }}>{isSnapshot ? totals.news : "—"}</div>
              <div className="hint">Brand-new positions</div>
            </div>
            <div className="card">
              <h3>Complete exits</h3>
              <div className="big" style={{ color: "var(--saffron)" }}>{isSnapshot ? totals.exits : "—"}</div>
              <div className="hint">Positions fully sold</div>
            </div>
          </div>

          {fundSections.map((f) => (
            <div key={f.fund}>
              <div className="section-title" style={{ marginTop: 34 }}>
                {f.fund}
                <small>
                  ▲ {f.ups.length} increased{f.newCount ? ` (${f.newCount} new)` : ""}
                  {" · "}▼ {f.downs.length} decreased{f.exitCount ? ` (${f.exitCount} exits)` : ""}
                  {f.hasValue ? ` · buy ≈ ₹${compact(f.buyValue)} L · sell ≈ ₹${compact(Math.abs(f.sellValue))} L` : ""}
                </small>
              </div>

              {(show === "both" || show === "up") && (
                <>
                  <div style={{ margin: "8px 0 8px", fontSize: 13, fontWeight: 500, color: "var(--up)" }}>
                    ▲ Increased
                    {f.topBuySectors.length > 0 && f.topBuySectors.map((s) => (
                      <span key={s} className="pill pos">{s}</span>
                    ))}
                  </div>
                  <HoldingsTable
                    items={f.ups} isSnapshot={isSnapshot} direction="up"
                    fromLabel={monthLabel(fromMonth)} toLabel={monthLabel(toMonth)}
                  />
                </>
              )}

              {(show === "both" || show === "down") && (
                <>
                  <div style={{ margin: "8px 0 8px", fontSize: 13, fontWeight: 500, color: "var(--down)" }}>
                    ▼ Decreased
                    {f.topSellSectors.length > 0 && f.topSellSectors.map((s) => (
                      <span key={s} className="pill neg">{s}</span>
                    ))}
                  </div>
                  <HoldingsTable
                    items={f.downs} isSnapshot={isSnapshot} direction="down"
                    fromLabel={monthLabel(fromMonth)} toLabel={monthLabel(toMonth)}
                  />
                </>
              )}
            </div>
          ))}

          {isSnapshot && (
            <div className="note">
              Each fund shows two lists: holdings <span className="up">increased</span> (with NEW ENTRY badges)
              and holdings <span className="down">decreased</span> (with FULL EXIT badges). Pills next to the
              headings are that fund's most-bought / most-sold sectors. "Est. buy/sell" ≈ Δshares × month-end
              price in ₹ Lakhs. Note: corporate renames or mergers appear as an exit in one name and a new
              entry in another. Months with two disclosure dates are merged automatically.
            </div>
          )}
        </>
      )}
    </div>
  );
}
