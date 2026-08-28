/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/SO01Page.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: SO01's 3-tab landing shell (Create SO | SO Map | Create FG STO) —
 *          feasibility §133.7/§133.16. Wraps the already-built SO01CreatePage
 *          and SO01MapPage as tabs of one page rather than two disconnected
 *          screens; "Create FG STO" is a locked placeholder ("Coming Soon"),
 *          unchanged from §133.7 — FG Dispatch is a separate future module.
 * Authority: Frontend
 */

import { useState } from "react";
import SO01CreatePage from "./SO01CreatePage.jsx";
import SO01MapPage from "./SO01MapPage.jsx";

const TABS = [
  { key: "create", label: "Create SO" },
  { key: "map", label: "SO Map" },
  { key: "fg_sto", label: "Create FG STO" },
];

export default function SO01Page({ initialTab = "create" }) {
  const [tab, setTab] = useState(TABS.some((entry) => entry.key === initialTab) ? initialTab : "create");

  return (
    <div className="grid gap-3">
      <div className="flex gap-1 border-b border-slate-200 px-1">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            className={`px-4 py-2 text-sm font-semibold transition-colors ${
              tab === entry.key
                ? "border-b-2 border-sky-700 text-sky-950"
                : "border-b-2 border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "create" ? <SO01CreatePage /> : null}
      {tab === "map" ? <SO01MapPage /> : null}
      {tab === "fg_sto" ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center text-sm text-slate-500">
          Create FG STO — Coming Soon. FG Dispatch is a separate module, built in its own future session (§133.7).
        </div>
      ) : null}
    </div>
  );
}
