/*
 * File-ID: 27.FE-PR09
 * File-Path: frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx
 * Gate: 27
 * Phase: 27
 * Domain: FRONT
 * Purpose: Create new Process PO or Packing PO (Standard Create — both PO types).
 * Authority: Frontend
 */

import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { createProcessOrder, createPackingOrder } from "./prodApi.js";

const ERRORS = {
  PROD_PO_STROKE_REQUIRED:          "Stroke Master ID is required for this production type.",
  PROD_PO_PRODSHADE_REQUIRED:       "Prodshade Material ID is required.",
  PROD_PO_INVALID_TYPE:             "Invalid production type selected.",
  PROD_PO_PROCESS_ORDER_NOT_FOUND:  "Process Order not found.",
  PROD_PO_PACK_CODE_REQUIRED:       "Pack Code Config ID is required.",
  PROD_MANAGER_OR_SA_REQUIRED:      "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

const PROCESS_TYPES = ["MTO", "HPS", "MTS", "INT", "MTEST"];
const PROCESS_SEGMENTS = ["ADMIX", "HPS", "IWC", "POWDER", "INT"];
const TABS = ["Process PO", "Packing PO"];

const EMPTY_PROCESS = {
  company_id: "",
  prod_type: "MTO",
  segment_code: "",
  prodshade_material_id: "",
  stroke_master_id: "",
  planned_qty_kg: "",
  planned_start_date: "",
  notes: "",
};

const EMPTY_PACKING = {
  company_id: "",
  process_order_id: "",
  pack_code_config_id: "",
  planned_qty_kg: "",
  fo_id: "",
};

export default function ProductionPOCreatePage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [saving, setSaving] = useState(false);
  const [processForm, setProcessForm] = useState({ ...EMPTY_PROCESS });
  const [packingForm, setPackingForm] = useState({ ...EMPTY_PACKING });

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  function updateProcess(field, val) {
    setProcessForm((f) => ({ ...f, [field]: val }));
  }

  function updatePacking(field, val) {
    setPackingForm((f) => ({ ...f, [field]: val }));
  }

  async function handleCreateProcess(e) {
    e.preventDefault();
    if (!processForm.company_id || !processForm.prodshade_material_id || !processForm.planned_qty_kg) {
      toast("Company ID, Prodshade Material ID, and Planned Qty are required.", "error");
      return;
    }
    if (!processForm.segment_code) {
      toast("Segment is required.", "error");
      return;
    }
    if (processForm.prod_type !== "MTEST" && !processForm.stroke_master_id) {
      toast("Stroke Master ID is required for non-MTEST orders.", "error");
      return;
    }
    setSaving(true);
    try {
      const body = {
        company_id: processForm.company_id,
        po_type: processForm.prod_type,
        segment_code: processForm.segment_code,
        prodshade_material_id: processForm.prodshade_material_id,
        planned_qty_kg: parseFloat(processForm.planned_qty_kg),
        planned_start_date: processForm.planned_start_date || undefined,
        notes: processForm.notes || undefined,
      };
      if (processForm.prod_type !== "MTEST") {
        body.stroke_master_id = processForm.stroke_master_id;
      }
      const result = await createProcessOrder(body);
      toast(`Process PO created successfully.${result?.po_number ? ` PO: ${result.po_number}` : ""}`);
      setProcessForm({ ...EMPTY_PROCESS });
      qc.invalidateQueries({ queryKey: ["process-orders"] });
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreatePacking(e) {
    e.preventDefault();
    if (!packingForm.company_id || !packingForm.process_order_id || !packingForm.pack_code_config_id || !packingForm.planned_qty_kg) {
      toast("Company ID, Process Order ID, Pack Code Config ID, and Planned Qty are required.", "error");
      return;
    }
    setSaving(true);
    try {
      const body = {
        company_id: packingForm.company_id,
        process_order_id: packingForm.process_order_id,
        pack_code_config_id: packingForm.pack_code_config_id,
        planned_qty_kg: parseFloat(packingForm.planned_qty_kg),
        fo_id: packingForm.fo_id || undefined,
      };
      const result = await createPackingOrder(body);
      toast(`Packing PO created successfully.${result?.po_number ? ` PO: ${result.po_number}` : ""}`);
      setPackingForm({ ...EMPTY_PACKING });
      qc.invalidateQueries({ queryKey: ["packing-orders"] });
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      title="Production PO Create — PR09"
      subtitle="Create new Process PO or Packing PO"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      {/* Tab Bar */}
      <ErpSectionCard>
        <div className="flex gap-0 border-b border-slate-200 mb-4">
          {TABS.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === i
                  ? "border-sky-600 text-sky-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Process PO Tab */}
        {activeTab === 0 && (
          <form onSubmit={handleCreateProcess} className="flex flex-col gap-4 max-w-2xl">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-600 font-medium">Company ID <span className="text-rose-500">*</span></label>
                <input
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                  placeholder="UUID"
                  value={processForm.company_id}
                  onChange={(e) => updateProcess("company_id", e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-600 font-medium">Production Type <span className="text-rose-500">*</span></label>
                <select
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                  value={processForm.prod_type}
                  onChange={(e) => updateProcess("prod_type", e.target.value)}
                >
                  {PROCESS_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-600 font-medium">Segment <span className="text-rose-500">*</span></label>
                <select
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                  value={processForm.segment_code}
                  onChange={(e) => updateProcess("segment_code", e.target.value)}
                  required
                >
                  <option value="">Select segment</option>
                  {PROCESS_SEGMENTS.map((segment) => (
                    <option key={segment} value={segment}>{segment}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-600 font-medium">Prodshade Material ID <span className="text-rose-500">*</span></label>
                <input
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono"
                  placeholder="UUID"
                  value={processForm.prodshade_material_id}
                  onChange={(e) => updateProcess("prodshade_material_id", e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-600 font-medium">
                  Stroke Master ID
                  {processForm.prod_type !== "MTEST" && <span className="text-rose-500"> *</span>}
                  {processForm.prod_type === "MTEST" && <span className="text-slate-400 ml-1">(not required for MTEST)</span>}
                </label>
                <input
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono"
                  placeholder="UUID"
                  value={processForm.stroke_master_id}
                  onChange={(e) => updateProcess("stroke_master_id", e.target.value)}
                  disabled={processForm.prod_type === "MTEST"}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-600 font-medium">Planned Qty (KG) <span className="text-rose-500">*</span></label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono"
                  placeholder="e.g. 500"
                  value={processForm.planned_qty_kg}
                  onChange={(e) => updateProcess("planned_qty_kg", e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-600 font-medium">Planned Start Date</label>
                <input
                  type="date"
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                  value={processForm.planned_start_date}
                  onChange={(e) => updateProcess("planned_start_date", e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1 col-span-2">
                <label className="text-xs text-slate-600 font-medium">Notes</label>
                <textarea
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm resize-none"
                  rows={3}
                  placeholder="Optional notes"
                  value={processForm.notes}
                  onChange={(e) => updateProcess("notes", e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
              >
                {saving ? "Creating…" : "Create Process PO"}
              </button>
              <button
                type="button"
                onClick={() => setProcessForm({ ...EMPTY_PROCESS })}
                className="text-slate-500 hover:text-slate-700 text-sm px-4 py-2 rounded border border-slate-300 transition-colors"
              >
                Clear
              </button>
            </div>
          </form>
        )}

        {/* Packing PO Tab */}
        {activeTab === 1 && (
          <form onSubmit={handleCreatePacking} className="flex flex-col gap-4 max-w-2xl">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-600 font-medium">Company ID <span className="text-rose-500">*</span></label>
                <input
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                  placeholder="UUID"
                  value={packingForm.company_id}
                  onChange={(e) => updatePacking("company_id", e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-600 font-medium">
                  Process Order ID <span className="text-rose-500">*</span>
                  <span className="text-slate-400 ml-1 font-normal">(must be VERIFIED)</span>
                </label>
                <input
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono"
                  placeholder="UUID"
                  value={packingForm.process_order_id}
                  onChange={(e) => updatePacking("process_order_id", e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-600 font-medium">Pack Code Config ID <span className="text-rose-500">*</span></label>
                <input
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono"
                  placeholder="UUID"
                  value={packingForm.pack_code_config_id}
                  onChange={(e) => updatePacking("pack_code_config_id", e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-600 font-medium">Planned Qty (KG) <span className="text-rose-500">*</span></label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono"
                  placeholder="e.g. 200"
                  value={packingForm.planned_qty_kg}
                  onChange={(e) => updatePacking("planned_qty_kg", e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1 col-span-2">
                <label className="text-xs text-slate-600 font-medium">FO ID <span className="text-slate-400 font-normal">(optional)</span></label>
                <input
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono"
                  placeholder="UUID — link to Factory Order"
                  value={packingForm.fo_id}
                  onChange={(e) => updatePacking("fo_id", e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
              >
                {saving ? "Creating…" : "Create Packing PO"}
              </button>
              <button
                type="button"
                onClick={() => setPackingForm({ ...EMPTY_PACKING })}
                className="text-slate-500 hover:text-slate-700 text-sm px-4 py-2 rounded border border-slate-300 transition-colors"
              >
                Clear
              </button>
            </div>
          </form>
        )}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
