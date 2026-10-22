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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const readable = (value) => {
  const label = String(value ?? "").trim();
  return label && !UUID_RE.test(label) ? label : "";
};

export default function MtsRollingPlanDownload({ runtimeContext, planMonth, asOf, demandAt }) {
  const [busy, setBusy] = useState("");

  async function download() {
    const list = buildTransactionCompanyList(runtimeContext).map((c) => {
      const companyName = readable(c.company_name);
      const companyCode = readable(c.company_code);
      return { id: String(c.id ?? c.company_id ?? ""), companyName, companyCode, label: companyName || companyCode || "—" };
    }).filter((c) => c.id);
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
        // The handler is authoritative for display labels.  The runtime value
        // is only a safe fallback when a legacy response lacks one; never let
        // the UUID used for the request become a business-facing Excel value.
        companies.push({
          ...rolling,
          company_id: c.id,
          company_name: readable(rolling.company_name) || c.companyName || null,
          company_code: readable(rolling.company_code) || c.companyCode || null,
          plan,
          notes,
        });
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
