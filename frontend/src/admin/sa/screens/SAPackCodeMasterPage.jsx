/*
 * File-ID: 27.SA-02
 * File-Path: frontend/src/admin/sa/screens/SAPackCodeMasterPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: SA-only Pack Code Master — Tab 1: Pack Code Catalog (toggle active), Tab 2: Prodshade Pack Config (upsert/delete).
 */

import React, { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import {
  listPackCodes,
  togglePackCode,
  listPackConfigs,
  upsertPackConfig,
  deletePackConfig,
} from "../../../pages/dashboard/production/prodApi.js";

const TABS = ["Pack Code Catalog", "Prodshade Pack Config"];

const ERRORS = {
  PROD_PACK_CODE_NOT_FOUND:    "Pack code not found.",
  PROD_PACK_CONFIG_NOT_FOUND:  "Pack config not found.",
  PROD_PACK_CONFIG_EXISTS:     "A config for this prodshade + pack code already exists.",
  PROD_SA_REQUIRED:            "Super Admin access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

const EMPTY_CONFIG_FORM = {
  material_id: "",
  pack_code_id: "",
  variant: "",
  fill_qty: "",
};

export default function SAPackCodeMasterPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [saving, setSaving] = useState(false);

  // Tab 2 state
  const [filterMaterialId, setFilterMaterialId] = useState("");
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);
  const [configForm, setConfigForm] = useState({ ...EMPTY_CONFIG_FORM });
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const firstInputRef = useRef(null);

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  // ── Pack Codes Query ─────────────────────────────────────────────────────────
  const codesQ = useQuery({
    queryKey: ["pack-codes"],
    queryFn: () => listPackCodes({}),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
  });

  // ── Pack Configs Query ───────────────────────────────────────────────────────
  const configsQ = useQuery({
    queryKey: ["pack-configs", filterMaterialId],
    queryFn: () => listPackConfigs({ material_id: filterMaterialId || undefined }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
    enabled: activeTab === 1,
  });

  const codes = codesQ.data ?? [];
  const configs = configsQ.data ?? [];

  // ── Pack Code Toggle ─────────────────────────────────────────────────────────
  async function handleToggle(code) {
    setSaving(true);
    try {
      await togglePackCode({ id: code.id, active: !code.active });
      toast(`Pack code ${code.pack_code} ${!code.active ? "activated" : "deactivated"}.`);
      qc.invalidateQueries({ queryKey: ["pack-codes"] });
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  // ── Pack Config Upsert ───────────────────────────────────────────────────────
  function openAddConfig() {
    setConfigForm({ ...EMPTY_CONFIG_FORM, material_id: filterMaterialId });
    setConfigDrawerOpen(true);
  }

  async function handleUpsertConfig(e) {
    e.preventDefault();
    if (!configForm.material_id || !configForm.pack_code_id) {
      toast("Prodshade (Material ID) and Pack Code are required.", "error");
      return;
    }
    setSaving(true);
    try {
      await upsertPackConfig({
        material_id: configForm.material_id,
        pack_code_id: configForm.pack_code_id,
        variant: configForm.variant || undefined,
        fill_qty: configForm.fill_qty ? parseFloat(configForm.fill_qty) : undefined,
      });
      toast("Pack config saved.");
      setConfigDrawerOpen(false);
      setConfigForm({ ...EMPTY_CONFIG_FORM });
      qc.invalidateQueries({ queryKey: ["pack-configs"] });
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  // ── Pack Config Delete ───────────────────────────────────────────────────────
  async function handleDelete(id) {
    setSaving(true);
    try {
      await deletePackConfig(id);
      toast("Pack config deleted.");
      setConfirmDeleteId(null);
      qc.invalidateQueries({ queryKey: ["pack-configs"] });
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      title="Pack Code Master — OM08"
      subtitle="SA-only: manage pack code catalog and prodshade pack configurations"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard>
        {/* Tab Bar */}
        <div className="flex gap-0 border-b border-slate-200 mb-6">
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

        {/* ── Tab 1: Pack Code Catalog ────────────────────────────────────────── */}
        {activeTab === 0 && (
          <>
            <p className="text-xs text-slate-500 mb-4">
              Pack codes are seeded at system level. SA can toggle active/inactive. No add/edit for now.
            </p>
            {codesQ.isLoading ? (
              <p className="text-slate-500 text-sm py-4 text-center">Loading…</p>
            ) : codes.length === 0 ? (
              <p className="text-slate-400 text-sm py-4 text-center">No pack codes found.</p>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                    <th className="text-left py-2 px-3 border-b">Pack Code</th>
                    <th className="text-left py-2 px-3 border-b">Description</th>
                    <th className="text-left py-2 px-3 border-b">BOM Required</th>
                    <th className="text-left py-2 px-3 border-b">Billing UOM</th>
                    <th className="text-left py-2 px-3 border-b">Type</th>
                    <th className="text-left py-2 px-3 border-b">Status</th>
                    <th className="text-center py-2 px-3 border-b">Toggle</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((c) => (
                    <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-3 font-mono font-bold text-slate-800">{c.pack_code}</td>
                      <td className="py-2 px-3 text-slate-600">{c.description ?? "—"}</td>
                      <td className="py-2 px-3">
                        {c.bom_required
                          ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">BOM Required</span>
                          : <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">No BOM</span>}
                      </td>
                      <td className="py-2 px-3 text-slate-500">{c.billing_uom ?? "—"}</td>
                      <td className="py-2 px-3 text-slate-500">{c.pack_type ?? "—"}</td>
                      <td className="py-2 px-3">
                        {c.active
                          ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">Active</span>
                          : <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Inactive</span>}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <button
                          onClick={() => handleToggle(c)}
                          disabled={saving}
                          className={`text-xs px-3 py-1 rounded border font-medium transition-colors disabled:opacity-50 ${
                            c.active
                              ? "border-rose-300 text-rose-600 hover:bg-rose-50"
                              : "border-emerald-300 text-emerald-600 hover:bg-emerald-50"
                          }`}
                        >
                          {c.active ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {/* ── Tab 2: Prodshade Pack Config ────────────────────────────────────── */}
        {activeTab === 1 && (
          <>
            <div className="flex gap-3 flex-wrap items-end mb-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Filter by Prodshade (Material ID)</label>
                <input
                  className="border border-slate-300 rounded px-2 py-1 text-sm font-mono w-72"
                  placeholder="Material UUID to filter…"
                  value={filterMaterialId}
                  onChange={(e) => setFilterMaterialId(e.target.value)}
                />
              </div>
              <button
                onClick={openAddConfig}
                className="bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium px-4 py-1.5 rounded transition-colors"
              >
                + Add Config
              </button>
            </div>

            {configsQ.isLoading ? (
              <p className="text-slate-500 text-sm py-4 text-center">Loading…</p>
            ) : configs.length === 0 ? (
              <p className="text-slate-400 text-sm py-4 text-center">
                {filterMaterialId ? "No configs found for this prodshade." : "Enter a Material ID to filter, or click + Add Config."}
              </p>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                    <th className="text-left py-2 px-3 border-b">Prodshade (Material ID)</th>
                    <th className="text-left py-2 px-3 border-b">Pack Code</th>
                    <th className="text-left py-2 px-3 border-b">Variant</th>
                    <th className="text-right py-2 px-3 border-b">Fill Qty</th>
                    <th className="text-left py-2 px-3 border-b">Status</th>
                    <th className="text-center py-2 px-3 border-b">Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {configs.map((cfg) => (
                    <tr key={cfg.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-3 font-mono text-slate-600 text-xs">{cfg.material_id?.slice(0, 12)}…</td>
                      <td className="py-2 px-3">
                        <span className="font-mono font-semibold text-slate-800">{cfg.pack_code?.pack_code ?? cfg.pack_code_id?.slice(0, 8)}</span>
                      </td>
                      <td className="py-2 px-3 text-slate-500">{cfg.variant ?? "—"}</td>
                      <td className="py-2 px-3 text-right font-mono text-slate-600">{cfg.fill_qty != null ? Number(cfg.fill_qty).toLocaleString() : "—"}</td>
                      <td className="py-2 px-3">
                        {cfg.active !== false
                          ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">Active</span>
                          : <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Inactive</span>}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {confirmDeleteId === cfg.id ? (
                          <div className="flex gap-1 justify-center">
                            <button
                              onClick={() => handleDelete(cfg.id)}
                              disabled={saving}
                              className="text-xs px-2 py-0.5 rounded bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                            >
                              {saving ? "…" : "Confirm"}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs px-2 py-0.5 rounded border border-slate-300 text-slate-500 hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(cfg.id)}
                            className="text-xs px-3 py-1 rounded border border-rose-200 text-rose-500 hover:bg-rose-50 transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </ErpSectionCard>

      {/* Add Config Drawer */}
      <DrawerBase
        visible={configDrawerOpen}
        title="Add Prodshade Pack Config"
        onClose={() => setConfigDrawerOpen(false)}
        initialFocusRef={firstInputRef}
        width="min(480px, calc(100vw - 24px))"
        actions={[
          { label: "Save Config", tone: "primary", onClick: handleUpsertConfig, disabled: saving },
          { label: "Cancel", tone: "neutral", onClick: () => setConfigDrawerOpen(false) },
        ]}
      >
        <form onSubmit={handleUpsertConfig} className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-600 font-medium">Prodshade Material ID <span className="text-rose-500">*</span></label>
            <input
              ref={firstInputRef}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono"
              placeholder="UUID"
              value={configForm.material_id}
              onChange={(e) => setConfigForm((f) => ({ ...f, material_id: e.target.value }))}
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-600 font-medium">Pack Code <span className="text-rose-500">*</span></label>
            <select
              className="border border-slate-300 rounded px-2 py-1.5 text-sm"
              value={configForm.pack_code_id}
              onChange={(e) => setConfigForm((f) => ({ ...f, pack_code_id: e.target.value }))}
              required
            >
              <option value="">— Select pack code —</option>
              {codes.filter((c) => c.active).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.pack_code}{c.description ? ` — ${c.description}` : ""}
                </option>
              ))}
            </select>
            {codes.filter((c) => c.active).length === 0 && (
              <p className="text-xs text-amber-600">No active pack codes. Please activate some in Tab 1 first.</p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-600 font-medium">Variant <span className="text-slate-400 font-normal">(optional)</span></label>
            <input
              className="border border-slate-300 rounded px-2 py-1.5 text-sm"
              placeholder="e.g. SMALL, LARGE, EXPORT"
              value={configForm.variant}
              onChange={(e) => setConfigForm((f) => ({ ...f, variant: e.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-600 font-medium">Fill Qty <span className="text-slate-400 font-normal">(optional — for barrel/IBC)</span></label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono"
              placeholder="e.g. 225 for 225 kg barrel"
              value={configForm.fill_qty}
              onChange={(e) => setConfigForm((f) => ({ ...f, fill_qty: e.target.value }))}
            />
          </div>
        </form>
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
