/*
 * File-Path: frontend/src/pages/dashboard/procurement/transfer/PlantTransferPage.jsx
 * Domain: PROCUREMENT / PO12 (Plant Transfer Order)
 * Purpose: PO12's own 2-tab wrapper — Tab 1 (CRCP Discrepancy List, default)
 *          and Tab 2 (physical Transfer/Receive, PlantTransferListPage.jsx
 *          unchanged). Design: docs/PROCUREMENT-DESIGN-DOC.md "PO12 (PTO) —
 *          Tab 1 Design" ("ei page ta khulle Tab1 dekhabe").
 * Authority: Frontend
 */

import { useSearchParams } from "react-router-dom";
import CrcpDiscrepancyPage from "./CrcpDiscrepancyPage.jsx";
import PlantTransferListPage from "./PlantTransferListPage.jsx";

function resolveInitialTab(rawValue) {
  return rawValue === "transfer" ? "transfer" : "discrepancy";
}

export default function PlantTransferPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveInitialTab(searchParams.get("tab"));

  function switchTab(tab) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("tab", tab);
      return next;
    });
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-end gap-2 px-1 pt-1">
        <button
          type="button"
          onClick={() => switchTab("discrepancy")}
          className={`border px-3 py-2 text-sm font-semibold ${activeTab === "discrepancy" ? "border-sky-300 bg-sky-50 text-sky-900" : "border-slate-300 bg-white text-slate-700"}`}
        >
          Tab 1 — Discrepancy List
        </button>
        <button
          type="button"
          onClick={() => switchTab("transfer")}
          className={`border px-3 py-2 text-sm font-semibold ${activeTab === "transfer" ? "border-sky-300 bg-sky-50 text-sky-900" : "border-slate-300 bg-white text-slate-700"}`}
        >
          Tab 2 — Transfer / Receive
        </button>
      </div>
      {activeTab === "discrepancy" ? <CrcpDiscrepancyPage /> : <PlantTransferListPage />}
    </div>
  );
}
