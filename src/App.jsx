import { useState } from "react";
import Momentum from "./tabs/Momentum";
import MFFlows from "./tabs/MFFlows";
import OptionChain from "./tabs/OptionChain";

const TABS = [
  { id: "momentum", label: "Momentum screener" },
  { id: "mf", label: "Mutual fund flows" },
  { id: "options", label: "Option chain" },
];

const TAPE = [
  ["NIFTY 50", "25,142.30", "+0.62%"],
  ["SENSEX", "82,318.90", "+0.55%"],
  ["BANKNIFTY", "56,204.15", "-0.18%"],
  ["INDIA VIX", "13.42", "-2.10%"],
  ["USD/INR", "85.94", "+0.08%"],
  ["GOLD MCX", "98,410", "+0.31%"],
];

export default function App() {
  const [tab, setTab] = useState("momentum");
  const [live, setLive] = useState(false);

  const tapeItems = [...TAPE, ...TAPE]; // duplicated for seamless loop

  return (
    <>
      <div className="tape" aria-hidden="true">
        <div className="tape-track">
          {tapeItems.map(([name, val, chg], i) => (
            <span className="tape-item" key={i}>
              <strong>{name}</strong> {val}{" "}
              <span className={chg.startsWith("+") ? "up" : "down"}>{chg}</span>
            </span>
          ))}
        </div>
      </div>

      <header className="header">
        <h1>Bazaar<span>Pulse</span></h1>
        <span className="sub">NSE / BSE momentum · fund flows · derivatives desk</span>
        <span className={"badge " + (live ? "live" : "mock")}>
          {live ? "● LIVE" : "◌ DEMO DATA — live feed unavailable"}
        </span>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={"tab" + (tab === t.id ? " active" : "")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="main">
        {tab === "momentum" && <Momentum setLive={setLive} />}
        {tab === "mf" && <MFFlows />}
        {tab === "options" && <OptionChain setLive={setLive} />}
      </main>
    </>
  );
}
