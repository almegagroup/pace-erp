/*
 * File-Path: frontend/src/pages/dashboard/procurement/planning/MtsRollingPlanDownload.jsx
 * Domain: PROCUREMENT / MTS PLANNING
 * Purpose: PO22 "Download Plan (Excel)" (owner 2026-10-21; Final or Rolling — PO21 effective plan) — every company the user can see, one
 *          Excel file for higher management (see rollingPlanWorkbook.js for the tabs). Companies are
 *          fetched one after another to keep the backend load flat; a company without access is
 *          listed on the Summary tab, never silently dropped.
 * Authority: Frontend (numbers come from the backend engine only)
 */

import { useState } from "react";
import { buildTransactionCompanyList } from "../../../../components/inputs/transactionCompanyRuntime.js";
import { pushToast } from "../../../../store/uiToast.js";
import { getMtsPlanReport, getMtsRollingPlan } from "../procurementApi.js";

function errorText(error) {
  return error instanceof Error ? error.message : String(error ?? "");
}

export default function MtsRollingPlanDownload({ runtimeContext, planMonth, asOf, demandAt }) {
  const [busy, setBusy] = useState("");

  async function download() {
    const list = buildTransactionCompanyList(runtimeContext).map((c) => ({ id: String(c.id ?? c.company_id ?? ""), label: c.company_name || c.company_code || "—" })).filter((c) => c.id);
    if (list.length === 0) { pushToast({ message: "No company in your access.", tone: "error" }); return; }
    const companies = [];
    const skipped = [];
    try {
      // DEPENDENT: one company at a time so the planning engine never runs N times in parallel.
      for (const [index, c] of list.entries()) {
        setBusy(`${c.label} (${index + 1}/${list.length})…`);
        let rolling;
        try {
          rolling = await getMtsRollingPlan({ company_id: c.id, plan_month: planMonth, as_of: asOf, demand_at: demandAt || undefined });
        } catch (error) {
          skipped.push(`${c.label}: not included — ${errorText(error)}`);
          continue;
        }
        const notes = [];
        let plan = null;
        try {
          plan = await getMtsPlanReport({ company_id: c.id, months: rolling.calendar.months.slice(0, 3).map((m) => m.slice(0, 7)).join(",") });
        } catch (error) {
          notes.push(`${c.label}: PLAN tab without this company — ${errorText(error)}`);
        }
        companies.push({ ...rolling, plan, notes });
      }
      if (companies.length === 0) { pushToast({ message: skipped.join(" · ") || "Nothing to download.", tone: "error" }); return; }
      setBusy("Building Excel…");
      if (skipped.length) companies[0].notes = [...skipped, ...(companies[0].notes ?? [])];
      const { downloadRollingPlanWorkbook } = await import("./rollingPlanWorkbook.js");
      await downloadRollingPlanWorkbook({ companies, asOf, fileName: `mts_plan_${asOf.replaceAll("-", "")}.xlsx` });
      pushToast({ message: `Plan downloaded (${companies.length} compan${companies.length === 1 ? "y" : "ies"}${skipped.length ? `, ${skipped.length} skipped — see Summary` : ""}).`, tone: "success" });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setBusy("");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void download()}
      disabled={Boolean(busy) || !planMonth || !asOf}
      title="All your companies in one Excel: Summary, PLAN, RM / PM planning with Prediction, RM_PM per company, Buy Plan, Store Instructions, Arrivals"
      className="h-8 border border-emerald-600 bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
    >
      {busy ? `Preparing ${busy}` : "Download Plan (Excel)"}
    </button>
  );
}
