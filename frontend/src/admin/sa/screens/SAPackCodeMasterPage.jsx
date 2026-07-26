/*
 * File-ID: 27.SA-02
 * File-Path: frontend/src/admin/sa/screens/SAPackCodeMasterPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: SA-only Pack Code Master — Tab 1: Pack Code Catalog, Tab 2: Prodshade Pack Config.
 */

import React, { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import {
  listPackCodes,
  createPackCode,
  updatePackCode,
  togglePackCode,
  listApprovedProdshades,
  listPackConfigs,
  upsertPackConfig,
  deletePackConfig,
} from "../../../pages/dashboard/production/prodApi.js";

const TABS = ["Pack Code Catalog", "Prodshade Pack Config"];
const PACK_TYPE_OPTIONS = ["CONSUMER", "DRUM", "BARREL", "IBC", "TANKER", "MTEST"];
const BILLING_UOM_OPTIONS = ["PER_UNIT", "PER_KG"];

const ERRORS = {
  PROD_PACK_CODE_NOT_FOUND: "Pack code not found.",
  PROD_PACK_CODE_EXISTS: "Pack code already exists.",
  PROD_PACK_CODE_INVALID: "Pack code, description, pack type, and billing UOM are required.",
  PROD_PACK_CONFIG_NOT_FOUND: "Pack config not found.",
  PROD_PACK_CONFIG_EXISTS: "A config for this prodshade + pack code already exists.",
  PROD_PACK_CONFIG_DELETE_BLOCKED_BOM_EXISTS: "Delete blocked: a Pack BOM already exists for this FG SKU.",
  PROD_PACK_CONFIG_DELETE_BLOCKED_PO_EXISTS: "Delete blocked: a Packing PO already exists for this FG SKU.",
  PROD_PRODSHADE_LIST_FAILED: "Approved prodshade list failed.",
  PROD_SA_REQUIRED: "Super Admin access required.",
};

function friendly(value) {
  return ERRORS[value] ?? value ?? "Request failed.";
}

function getErrorMessage(error) {
  if (!error) return "";
  return friendly(error.message ?? String(error));
}

function prodshadeLabel(prodshade) {
  if (!prodshade) return "";
  const externalCode = String(prodshade.external_code ?? "").trim();
  const shadeCode = String(prodshade.shade_code ?? "").trim();
  const materialName = String(prodshade.document_name ?? prodshade.material_name ?? "").trim();
  if (externalCode && materialName) return `${externalCode} — ${materialName}`;
  if (externalCode) return externalCode;
  if (shadeCode && materialName) return `${shadeCode} — ${materialName}`;
  if (shadeCode) return shadeCode;
  if (materialName) return materialName;
  return String(prodshade.external_code ?? prodshade.material_id ?? "").trim();
}

const EMPTY_CONFIG_FORM = {
  material_id: "",
  pack_code_id: "",
  variant: "",
  fill_qty: "",
};

const EMPTY_PACK_CODE_FORM = {
  pack_code: "",
  pack_name: "",
  description: "",
  pack_type: PACK_TYPE_OPTIONS[0],
  billing_uom: BILLING_UOM_OPTIONS[0],
  bom_required: true,
};

export default function SAPackCodeMasterPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [saving, setSaving] = useState(false);

  const [filterMaterialId, setFilterMaterialId] = useState("");
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);
  const [configForm, setConfigForm] = useState({ ...EMPTY_CONFIG_FORM });
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const [packCodeDrawerOpen, setPackCodeDrawerOpen] = useState(false);
  const [editingPackCode, setEditingPackCode] = useState(null);
  const [packCodeForm, setPackCodeForm] = useState({ ...EMPTY_PACK_CODE_FORM });

  const packCodeInputRef = useRef(null);
  const prodshadeInputRef = useRef(null);

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  const codesQ = useQuery({
    queryKey: ["pack-codes"],
    queryFn: () => listPackCodes({}),
    select: (d) => (Array.isArray(d) ? d : d?.data ?? []),
  });

  const prodshadesQ = useQuery({
    queryKey: ["approved-prodshades"],
    queryFn: () => listApprovedProdshades({}),
    select: (d) => (Array.isArray(d) ? d : d?.data ?? []),
    enabled: activeTab === 1 || configDrawerOpen,
  });

  const configsQ = useQuery({
    queryKey: ["pack-configs", filterMaterialId],
    queryFn: () => listPackConfigs({ material_id: filterMaterialId || undefined }),
    select: (d) => (Array.isArray(d) ? d : d?.data ?? []),
    enabled: activeTab === 1 && Boolean(filterMaterialId),
  });

  const codes = codesQ.data ?? [];
  const prodshades = prodshadesQ.data ?? [];
  const configs = configsQ.data ?? [];
  const selectedProdshade = prodshades.find((entry) => entry.material_id === filterMaterialId) ?? null;

  const packTypeOptions = [...new Set([...PACK_TYPE_OPTIONS, ...codes.map((code) => code.pack_type).filter(Boolean)])];
  const prodshadeOptions = prodshades.map((entry) => ({
    value: entry.material_id,
    label: prodshadeLabel(entry),
  }));
  const packCodeOptions = codes
    .filter((code) => code.active)
    .map((code) => ({
      value: code.id,
      label: `${code.pack_code} — ${code.description || code.pack_name || code.pack_type || ""}`.trim(),
    }));

  function resetPackCodeDrawer() {
    setPackCodeDrawerOpen(false);
    setEditingPackCode(null);
    setPackCodeForm({ ...EMPTY_PACK_CODE_FORM });
  }

  function resetConfigDrawer() {
    setConfigDrawerOpen(false);
    setConfigForm({ ...EMPTY_CONFIG_FORM });
  }

  function openCreatePackCode() {
    setEditingPackCode(null);
    setPackCodeForm({ ...EMPTY_PACK_CODE_FORM });
    setPackCodeDrawerOpen(true);
  }

  function openEditPackCode(code) {
    setEditingPackCode(code);
    setPackCodeForm({
      pack_code: code.pack_code ?? "",
      pack_name: code.pack_name ?? code.description ?? "",
      description: code.description ?? code.pack_name ?? "",
      pack_type: code.pack_type ?? PACK_TYPE_OPTIONS[0],
      billing_uom: code.billing_uom ?? BILLING_UOM_OPTIONS[0],
      bom_required: code.bom_required !== false,
    });
    setPackCodeDrawerOpen(true);
  }

  function openAddConfig() {
    setConfigForm({ ...EMPTY_CONFIG_FORM, material_id: filterMaterialId || "" });
    setConfigDrawerOpen(true);
  }

  async function handleToggle(code) {
    setSaving(true);
    try {
      await togglePackCode({ id: code.id, active: !code.active });
      toast(`Pack code ${code.pack_code} ${code.active ? "deactivated" : "activated"}.`);
      await qc.invalidateQueries({ queryKey: ["pack-codes"] });
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePackCode() {
    if (!packCodeForm.pack_code.trim() && !editingPackCode) {
      toast("Pack Code is required.", "error");
      return;
    }
    if (!packCodeForm.description.trim()) {
      toast("Description is required.", "error");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        pack_code: packCodeForm.pack_code.trim().toUpperCase(),
        pack_name: packCodeForm.pack_name.trim() || packCodeForm.description.trim(),
        description: packCodeForm.description.trim(),
        pack_type: packCodeForm.pack_type,
        billing_uom: packCodeForm.billing_uom,
        bom_required: packCodeForm.bom_required,
      };

      if (editingPackCode) {
        await updatePackCode(editingPackCode.id, payload);
        toast(`Pack code ${editingPackCode.pack_code} updated.`);
      } else {
        await createPackCode(payload);
        toast(`Pack code ${payload.pack_code} created.`);
      }

      resetPackCodeDrawer();
      await qc.invalidateQueries({ queryKey: ["pack-codes"] });
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveConfig() {
    if (!configForm.material_id || !configForm.pack_code_id) {
      toast("Prodshade and Pack Code are required.", "error");
      return;
    }

    setSaving(true);
    try {
      await upsertPackConfig({
        material_id: configForm.material_id,
        pack_code_id: configForm.pack_code_id,
        variant: configForm.variant.trim() || undefined,
        fill_qty: configForm.fill_qty ? parseFloat(configForm.fill_qty) : undefined,
      });
      toast("Pack config saved.");
      resetConfigDrawer();
      if (!filterMaterialId) setFilterMaterialId(configForm.material_id);
      await qc.invalidateQueries({ queryKey: ["pack-configs"] });
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    setSaving(true);
    try {
      await deletePackConfig(id);
      toast("Pack config deleted.");
      setConfirmDeleteId(null);
      await qc.invalidateQueries({ queryKey: ["pack-configs"] });
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      title="Pack Code Master — OM08"
      notices={notice.msg ? [{ key: "pack-code-master-notice", tone: notice.tone, message: notice.msg }] : []}
    >
      <ErpSectionCard>
        <div className="mb-6 flex gap-0 border-b border-slate-200">
          {TABS.map((tab, index) => (
            <button
              key={tab}
              onClick={() => setActiveTab(index)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === index
                  ? "border-sky-600 text-sky-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 0 && (
          <>
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                SA can add new pack codes, edit existing codes, and activate or deactivate them.
              </p>
              <button
                onClick={openCreatePackCode}
                className="rounded bg-sky-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sky-700"
              >
                Add pack code
              </button>
            </div>

            {codesQ.isLoading ? (
              <p className="py-4 text-center text-sm text-slate-500">Loading…</p>
            ) : codesQ.isError ? (
              <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {getErrorMessage(codesQ.error)}
              </p>
            ) : codes.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">No pack codes found.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <th className="border-b px-3 py-2 text-left">Pack Code</th>
                    <th className="border-b px-3 py-2 text-left">Description</th>
                    <th className="border-b px-3 py-2 text-left">Pack Type</th>
                    <th className="border-b px-3 py-2 text-left">Billing UOM</th>
                    <th className="border-b px-3 py-2 text-left">BOM Required</th>
                    <th className="border-b px-3 py-2 text-left">Status</th>
                    <th className="border-b px-3 py-2 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((code) => (
                    <tr key={code.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono font-semibold text-slate-800">{code.pack_code}</td>
                      <td className="px-3 py-2 text-slate-700">{code.description || code.pack_name || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{code.pack_type || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{code.billing_uom || "—"}</td>
                      <td className="px-3 py-2">
                        {code.bom_required ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Yes</span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">No</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {code.active ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Active</span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Inactive</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => openEditPackCode(code)}
                            className="rounded border border-sky-200 px-3 py-1 text-xs text-sky-700 transition-colors hover:bg-sky-50"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleToggle(code)}
                            disabled={saving}
                            className={`rounded border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                              code.active
                                ? "border-rose-300 text-rose-600 hover:bg-rose-50"
                                : "border-emerald-300 text-emerald-600 hover:bg-emerald-50"
                            }`}
                          >
                            {code.active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === 1 && (
          <>
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div className="min-w-[320px] flex-1">
                <label className="mb-1 block text-xs text-slate-500">Prodshade</label>
                <ErpComboboxField
                  value={filterMaterialId}
                  onChange={(value) => setFilterMaterialId(value)}
                  options={prodshadeOptions}
                  placeholder="Select an approved prodshade"
                  blankLabel="— Select prodshade —"
                  inputRef={prodshadeInputRef}
                  emptyStateLabel={
                    prodshades.length === 0
                      ? "No approved prodshades yet — a stroke must be approved first (see Stroke Master)."
                      : "No matches"
                  }
                  inputClassName="rounded px-2 py-2 text-sm"
                />
              </div>
              <button
                onClick={openAddConfig}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700"
              >
                + Link Pack Code
              </button>
            </div>

            {prodshadesQ.isError && (
              <p className="mb-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {getErrorMessage(prodshadesQ.error)}
              </p>
            )}

            {selectedProdshade && (
              <div className="mb-4 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
                Showing pack config for <span className="font-medium">{prodshadeLabel(selectedProdshade)}</span>
              </div>
            )}

            {configsQ.isLoading ? (
              <p className="py-4 text-center text-sm text-slate-500">Loading…</p>
            ) : configsQ.isError ? (
              <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {getErrorMessage(configsQ.error)}
              </p>
            ) : !filterMaterialId ? (
              <p className="py-4 text-center text-sm text-slate-400">Select an approved prodshade to view linked pack codes.</p>
            ) : configs.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">No pack codes linked for this prodshade yet.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <th className="border-b px-3 py-2 text-left">Pack Code</th>
                    <th className="border-b px-3 py-2 text-left">Variant</th>
                    <th className="border-b px-3 py-2 text-right">Fill Qty</th>
                    <th className="border-b px-3 py-2 text-left">BOM Required</th>
                    <th className="border-b px-3 py-2 text-left">FG SKU</th>
                    <th className="border-b px-3 py-2 text-left">FG Material Name</th>
                    <th className="border-b px-3 py-2 text-left">Status</th>
                    <th className="border-b px-3 py-2 text-center">Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {configs.map((cfg) => (
                    <tr key={cfg.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <span className="font-mono font-semibold text-slate-800">{cfg.pack_code?.pack_code || "—"}</span>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{cfg.variant || "—"}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700">
                        {cfg.fill_qty != null ? Number(cfg.fill_qty).toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {cfg.pack_code?.bom_required ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Yes</span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">No</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-700">{cfg.fg_sku || "—"}</td>
                      <td className="px-3 py-2 text-slate-700">{cfg.fg_material_name || "—"}</td>
                      <td className="px-3 py-2">
                        {cfg.active !== false ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Active</span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Inactive</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {confirmDeleteId === cfg.id ? (
                          <div className="flex justify-center gap-1">
                            <button
                              onClick={() => handleDelete(cfg.id)}
                              disabled={saving}
                              className="rounded bg-rose-600 px-2 py-0.5 text-xs text-white hover:bg-rose-700 disabled:opacity-50"
                            >
                              {saving ? "…" : "Confirm"}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(cfg.id)}
                            className="rounded border border-rose-200 px-3 py-1 text-xs text-rose-500 transition-colors hover:bg-rose-50"
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

      <DrawerBase
        visible={packCodeDrawerOpen}
        title={editingPackCode ? `Edit Pack Code ${editingPackCode.pack_code}` : "Add Pack Code"}
        onClose={resetPackCodeDrawer}
        initialFocusRef={packCodeInputRef}
        width="min(520px, calc(100vw - 24px))"
        actions={
          <>
            <button
              type="button"
              onClick={handleSavePackCode}
              disabled={saving}
              className="rounded bg-sky-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
            >
              {editingPackCode ? "Save Changes" : "Create Pack Code"}
            </button>
            <button
              type="button"
              onClick={resetPackCodeDrawer}
              className="rounded border border-slate-300 px-4 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
          </>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSavePackCode();
          }}
          className="flex flex-col gap-4 p-4"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">
              Pack Code <span className="text-rose-500">*</span>
            </label>
            <input
              ref={packCodeInputRef}
              className="rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
              value={packCodeForm.pack_code}
              onChange={(event) => setPackCodeForm((current) => ({ ...current, pack_code: event.target.value }))}
              onBlur={() => setPackCodeForm((current) => ({ ...current, pack_code: current.pack_code.trim().toUpperCase() }))}
              placeholder="e.g. 599"
              disabled={Boolean(editingPackCode)}
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">
              Description <span className="text-rose-500">*</span>
            </label>
            <input
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              value={packCodeForm.description}
              onChange={(event) =>
                setPackCodeForm((current) => ({
                  ...current,
                  description: event.target.value,
                  pack_name: current.pack_name || event.target.value,
                }))
              }
              placeholder="Informational display text"
              required
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">
                Pack Type <span className="text-rose-500">*</span>
              </label>
              <select
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={packCodeForm.pack_type}
                onChange={(event) => setPackCodeForm((current) => ({ ...current, pack_type: event.target.value }))}
              >
                {packTypeOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">
                Billing UOM <span className="text-rose-500">*</span>
              </label>
              <select
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={packCodeForm.billing_uom}
                onChange={(event) => setPackCodeForm((current) => ({ ...current, billing_uom: event.target.value }))}
              >
                {BILLING_UOM_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={packCodeForm.bom_required}
              onChange={(event) => setPackCodeForm((current) => ({ ...current, bom_required: event.target.checked }))}
            />
            BOM Required
          </label>
        </form>
      </DrawerBase>

      <DrawerBase
        visible={configDrawerOpen}
        title="Link Prodshade Pack Code"
        onClose={resetConfigDrawer}
        initialFocusRef={prodshadeInputRef}
        width="min(520px, calc(100vw - 24px))"
        actions={
          <>
            <button
              type="button"
              onClick={handleSaveConfig}
              disabled={saving}
              className="rounded bg-sky-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
            >
              Save Config
            </button>
            <button
              type="button"
              onClick={resetConfigDrawer}
              className="rounded border border-slate-300 px-4 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
          </>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSaveConfig();
          }}
          className="flex flex-col gap-4 p-4"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">
              Prodshade <span className="text-rose-500">*</span>
            </label>
            <ErpComboboxField
              value={configForm.material_id}
              onChange={(value) => setConfigForm((current) => ({ ...current, material_id: value }))}
              options={prodshadeOptions}
              placeholder="Select an approved prodshade"
              blankLabel="— Select prodshade —"
              inputRef={prodshadeInputRef}
              emptyStateLabel={
                prodshades.length === 0
                  ? "No approved prodshades yet — a stroke must be approved first (see Stroke Master)."
                  : "No matches"
              }
              inputClassName="rounded px-2 py-2 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">
              Pack Code <span className="text-rose-500">*</span>
            </label>
            <select
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              value={configForm.pack_code_id}
              onChange={(event) => setConfigForm((current) => ({ ...current, pack_code_id: event.target.value }))}
              required
            >
              <option value="">— Select pack code —</option>
              {packCodeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {packCodeOptions.length === 0 && (
              <p className="text-xs text-amber-600">No active pack codes available. Activate or create one in Tab 1 first.</p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">
              Variant <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              value={configForm.variant}
              onChange={(event) => setConfigForm((current) => ({ ...current, variant: event.target.value }))}
              placeholder="e.g. JAR, BAG"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">
              Fill Qty <span className="font-normal text-slate-400">(optional — for fill-size pack codes)</span>
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              className="rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
              value={configForm.fill_qty}
              onChange={(event) => setConfigForm((current) => ({ ...current, fill_qty: event.target.value }))}
              placeholder="e.g. 230"
            />
          </div>
        </form>
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
