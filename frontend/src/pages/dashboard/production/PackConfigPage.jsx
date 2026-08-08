/*
 * File-ID: 27.FE-03
 * File-Path: frontend/src/pages/dashboard/production/PackConfigPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Prodshade Pack Configuration — which pack codes are valid per prodshade+company,
 *          and fill qty per pack. Manager creates/deletes configs. Tabs: Pack Codes (read) | Configs.
 */

import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../context/useMenu.js";
import {
  listPackCodes, listPackConfigs, upsertPackConfig, deletePackConfig, listStrokeMasters,
} from "./prodApi.js";

const TABS = ["Pack Codes", "Prodshade Configs"];

const ERRORS = {
  PROD_PACK_CONFIG_INVALID: "Company, material, and pack code are required.",
  PROD_MANAGER_OR_SA_REQUIRED: "Manager or SA access required.",
};
function friendlyErr(code) { return ERRORS[code] ?? code; }

export default function PackConfigPage() {
  const qc = useQueryClient();
  const { runtimeContext } = useMenu();
  const [tab, setTab] = useState(0);
  const [companyId, setCompanyId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState({ company_id: "", material_id: "", pack_code_id: "", fill_qty: "" });
  const [fillQtyLiter, setFillQtyLiter] = useState("");

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3000);
  }

  const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
  const effectiveCompanyId = companyId || defaultCompanyId;
  const effectiveFormCompanyId = form.company_id || defaultCompanyId;

  useEffect(() => {
    if (!form.company_id && defaultCompanyId) {
      setForm((current) => ({ ...current, company_id: defaultCompanyId }));
    }
  }, [defaultCompanyId, form.company_id]);

  const codesQ = useQuery({
    queryKey: ["prod-pack-codes"],
    queryFn: () => listPackCodes(),
    select: d => Array.isArray(d) ? d : d?.data ?? [],
  });

  const configsQ = useQuery({
    queryKey: ["prod-pack-configs", effectiveCompanyId, materialId],
    queryFn: () => listPackConfigs({ company_id: effectiveCompanyId || undefined, material_id: materialId || undefined }),
    select: d => Array.isArray(d) ? d : d?.data ?? [],
    enabled: tab === 1 && Boolean(effectiveCompanyId),
  });

  // §108.2 item 4 — MTS/IWC Prodshades take fill_qty in Liter (physical container
  // size, e.g. 1L/5L/50L); everything else keeps entering it directly in KG.
  // conversion_factor lives on the Prodshade's own approved Stroke (§83.3, same
  // source as List A item 3 — never on pack_code_master, it's density not pack-code).
  const strokeForFormMaterialQ = useQuery({
    queryKey: ["prod-pack-config-stroke-lookup", effectiveFormCompanyId, form.material_id],
    queryFn: () => listStrokeMasters({ company_id: effectiveFormCompanyId, material_id: form.material_id, status: "APPROVED" }),
    enabled: Boolean(effectiveFormCompanyId && form.material_id),
    select: d => Array.isArray(d) ? d : d?.data ?? [],
  });
  const approvedStrokeForFormMaterial = strokeForFormMaterialQ.data?.[0] ?? null;
  const isMtsFormMaterial = approvedStrokeForFormMaterial?.po_type === "MTS";
  const fillQtyLiterFactor = isMtsFormMaterial
    && approvedStrokeForFormMaterial?.conversion_uom_code
    && Number(approvedStrokeForFormMaterial?.conversion_factor) > 0
    ? Number(approvedStrokeForFormMaterial.conversion_factor)
    : null;
  const fillQtyLiterConversionMissing = isMtsFormMaterial && !strokeForFormMaterialQ.isLoading && fillQtyLiterFactor === null;

  async function handleCreate(e) {
    e?.preventDefault?.();
    if (!form.material_id || !form.pack_code_id) {
      toast("Material and pack code are required.", "error");
      return;
    }
    setSaving(true);
    try {
      await upsertPackConfig({
        company_id: effectiveFormCompanyId,
        material_id: form.material_id,
        pack_code_id: form.pack_code_id,
        fill_qty: form.fill_qty ? parseFloat(form.fill_qty) : null,
      });
      toast("Config saved.");
      setDrawerOpen(false);
      setForm({ company_id: defaultCompanyId, material_id: "", pack_code_id: "", fill_qty: "" });
      setFillQtyLiter("");
      qc.invalidateQueries({ queryKey: ["prod-pack-configs"] });
    } catch (err) { toast(friendlyErr(err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!window.confirm("Remove this pack config?")) return;
    setSaving(true);
    try {
      await deletePackConfig(id);
      toast("Config removed.");
      qc.invalidateQueries({ queryKey: ["prod-pack-configs"] });
    } catch (err) { toast(friendlyErr(err.message), "error"); }
    finally { setSaving(false); }
  }

  const codes = codesQ.data ?? [];
  const configs = configsQ.data ?? [];

  return (
    <ErpScreenScaffold
      title="Pack Configuration"
      subtitle="Manage pack codes and prodshade-level pack configs"
      actions={tab === 1 ? [{ label: "New Config", tone: "primary", mnemonic: "N", onClick: () => { setForm({ company_id: effectiveCompanyId, material_id: "", pack_code_id: "", fill_qty: "" }); setFillQtyLiter(""); setDrawerOpen(true); } }] : []}
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      {/* Tabs */}
      <ErpSectionCard>
        <div className="flex gap-2 border-b border-slate-200 mb-4">
          {TABS.map((t, i) => (
            <button
              key={t}
              onClick={() => setTab(i)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === i ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab 0 — Pack Codes */}
        {tab === 0 && (
          codesQ.isLoading ? <p className="text-slate-400 text-sm py-4 text-center">Loading…</p> : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <th className="text-left py-2 px-3 border-b">Code</th>
                  <th className="text-left py-2 px-3 border-b">Name</th>
                  <th className="text-left py-2 px-3 border-b">Type</th>
                  <th className="text-left py-2 px-3 border-b">Billing UOM</th>
                  <th className="text-left py-2 px-3 border-b">Active</th>
                </tr>
              </thead>
              <tbody>
                {codes.map(c => (
                  <tr key={c.id} className="border-b border-slate-100">
                    <td className="py-2 px-3 font-mono font-semibold">{c.pack_code}</td>
                    <td className="py-2 px-3">{c.pack_name}</td>
                    <td className="py-2 px-3 text-slate-500">{c.pack_type}</td>
                    <td className="py-2 px-3 text-slate-500">{c.billing_uom}</td>
                    <td className="py-2 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${c.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        {c.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {/* Tab 1 — Prodshade Configs */}
        {tab === 1 && (
          <>
            <div className="flex gap-3 mb-4 flex-wrap">
              <div className="w-72">
                <TransactionCompanySelector
                  runtimeContext={runtimeContext}
                  value={companyId}
                  onChange={setCompanyId}
                  label="Company"
                  hint=""
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Material ID</label>
                <input className="border border-slate-300 rounded px-2 py-1 text-sm w-64" value={materialId} onChange={e => setMaterialId(e.target.value)} placeholder="Filter by prodshade…" />
              </div>
            </div>
            {!effectiveCompanyId ? <p className="text-slate-400 text-sm py-4 text-center">Select a company to view pack configurations.</p> : configsQ.isLoading ? <p className="text-slate-400 text-sm py-4 text-center">Loading…</p> : configs.length === 0 ? (
              <p className="text-slate-400 text-sm py-4 text-center">No configs found. Press <kbd className="bg-slate-100 border px-1 rounded text-xs">Alt+N</kbd> to create.</p>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <th className="text-left py-2 px-3 border-b">Prodshade</th>
                    <th className="text-left py-2 px-3 border-b">Pack Code</th>
                    <th className="text-right py-2 px-3 border-b">Fill Qty</th>
                    <th className="py-2 px-3 border-b"></th>
                  </tr>
                </thead>
                <tbody>
                  {configs.map(c => (
                    <tr key={c.id} className="border-b border-slate-100">
                      <td className="py-2 px-3">{c.material?.pace_code ?? c.material_id?.slice(0, 8)}</td>
                      <td className="py-2 px-3 font-mono">{c.pack_code?.pack_code} — {c.pack_code?.pack_name}</td>
                      <td className="py-2 px-3 text-right font-mono">{c.fill_qty != null ? `${c.fill_qty} KG` : "—"}</td>
                      <td className="py-2 px-3 text-right">
                        <button onClick={() => handleDelete(c.id)} className="text-rose-400 hover:text-rose-600 text-xs">Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </ErpSectionCard>

      {/* Create Drawer */}
      <DrawerBase
        visible={drawerOpen}
        title="New Pack Config"
        onClose={() => setDrawerOpen(false)}
        actions={[
          { label: "Save", tone: "primary", onClick: handleCreate, disabled: saving || !form.material_id || !form.pack_code_id },
          { label: "Cancel", tone: "neutral", onClick: () => setDrawerOpen(false) },
        ]}
      >
        <form onSubmit={handleCreate} className="flex flex-col gap-4 p-4">
          <TransactionCompanySelector
            runtimeContext={runtimeContext}
            value={form.company_id}
            onChange={(value) => setForm((current) => ({ ...current, company_id: value }))}
            label="Company"
            hint=""
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-600 font-medium">Prodshade Material ID <span className="text-rose-500">*</span></label>
            <input
              autoFocus
              className="border border-slate-300 rounded px-2 py-1.5 text-sm"
              value={form.material_id}
              onChange={e => { setForm(f => ({ ...f, material_id: e.target.value })); setFillQtyLiter(""); }}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-600 font-medium">Pack Code <span className="text-rose-500">*</span></label>
            <select className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.pack_code_id} onChange={e => setForm(f => ({ ...f, pack_code_id: e.target.value }))} required>
              <option value="">Select pack code…</option>
              {codes.filter(c => c.active).map(c => (
                <option key={c.id} value={c.id}>{c.pack_code} — {c.pack_name}</option>
              ))}
            </select>
          </div>
          {isMtsFormMaterial ? (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-600 font-medium">Fill Qty (Liter)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono"
                  value={fillQtyLiter}
                  disabled={fillQtyLiterConversionMissing || strokeForFormMaterialQ.isLoading}
                  onChange={e => {
                    const literValue = e.target.value;
                    setFillQtyLiter(literValue);
                    const liters = Number(literValue);
                    if (fillQtyLiterFactor && Number.isFinite(liters) && liters > 0) {
                      setForm(f => ({ ...f, fill_qty: (liters * fillQtyLiterFactor).toFixed(4) }));
                    } else {
                      setForm(f => ({ ...f, fill_qty: "" }));
                    }
                  }}
                  placeholder="e.g. 5"
                />
                {fillQtyLiterConversionMissing && (
                  <span className="text-xs text-rose-600">এই Prodshade-এর Stroke-এ Conversion UOM/Factor সেট করা নেই — Stroke Master-এ গিয়ে যোগ করুন।</span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-600 font-medium">= Fill Qty (KG, derived)</label>
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono text-slate-900">{form.fill_qty || "--"}</div>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Fill Qty (KG)</label>
              <input type="number" step="0.01" min="0" className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.fill_qty} onChange={e => setForm(f => ({ ...f, fill_qty: e.target.value }))} placeholder="e.g. 200" />
              <p className="text-xs text-slate-400">Required for barrel (599) pack type.</p>
            </div>
          )}
        </form>
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
