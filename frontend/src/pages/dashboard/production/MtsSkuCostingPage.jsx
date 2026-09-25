import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ModalBase from "../../../components/layer/ModalBase.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { pushToast } from "../../../store/uiToast.js";
import {
  createAc05MtsSkuRate,
  deleteAc05MtsSkuPendingRate,
  listAc05MtsSkuEligibleSkus,
  listAc05MtsSkuRates,
  listAc05MtsSkuVendorCodes,
  pendingAc05MtsSkuRateCount,
  updateAc05MtsSkuPendingRate,
} from "./prodApi.js";

const emptyEntry = (vendorCodeId = "") => ({
  __key: `ac05-${Math.random().toString(36).slice(2)}`,
  vendor_code_id: vendorCodeId, sku_material_id: "", __sku: null,
  rate_per_base_uom: "", rate_per_inner_pack: "", rate_per_outer_uom: "",
  rm_wastage_pct: "", pack_wastage_pct: "", effective_date: new Date().toISOString().slice(0, 10),
});
const asRows = (value) => Array.isArray(value) ? value : value?.data ?? [];
const money = (value) => value == null ? "—" : Number(value).toFixed(4);
const errorMessage = (error) => error?.backendMessage || error?.message || "Request failed.";
// SKU dropdown labels always carry the Material Master Document Name so
// users can identify a SKU without leaving the combobox — same convention
// SO01's own FG SKU picker (§141) already established.
const skuLabel = (sku) => [sku.pace_code, sku.document_name || sku.material_name].filter(Boolean).join(" — ");

function numberInput(value, onChange, extra = {}) {
  return (
    <input type="number" min="0" step="0.0001" value={value} onChange={(event) => onChange(event.target.value)}
      className="h-8 w-full border border-slate-300 bg-white px-2 font-mono text-xs text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-100" {...extra} />
  );
}

// Shared by both the per-row Save button and the modal-level "Save All" —
// one entry, one insert attempt, returns whether it actually saved so the
// caller can decide what to invalidate/report. __key/__sku are local-only
// bookkeeping (row identity + cached SKU label lookup) and must never reach
// the backend payload.
async function saveEntry(companyId, entry) {
  const { __key, __sku, ...payload } = entry;
  if (!payload.vendor_code_id || !payload.sku_material_id || !payload.effective_date) {
    pushToast({ message: "Vendor Code, SKU, and Effective Date are required.", tone: "error" });
    return false;
  }
  try {
    await createAc05MtsSkuRate({ company_id: companyId, ...payload });
    pushToast({ message: "MTS SKU rate saved." });
    return true;
  } catch (error) {
    pushToast({ message: errorMessage(error), tone: "error" });
    return false;
  }
}

// A row's own component (not a raw render() call) so its eligible-SKU query
// -- which depends on that row's own Vendor Code -- follows the Rules of
// Hooks correctly; ErpDenseGrid's column.render() is a plain function call
// during the parent's render pass, not a mounted component, so a hook can
// only run safely inside a cell that is itself JSX like this one (same
// pattern SO01CreatePage's own <SalesOrderFgSkuPicker/> cell uses).
function SkuCell({ row, companyId, onChange }) {
  const eligibleQuery = useQuery({
    queryKey: ["ac05-mts-sku-eligible", companyId, row.vendor_code_id],
    queryFn: () => listAc05MtsSkuEligibleSkus({ company_id: companyId, vendor_code_id: row.vendor_code_id }),
    enabled: Boolean(companyId && row.vendor_code_id),
    select: asRows,
  });
  const eligibleSkus = eligibleQuery.data ?? [];
  const skuOptions = eligibleSkus.map((item) => ({ value: item.material_id, label: skuLabel(item) }));
  return (
    <ErpComboboxField
      value={row.sku_material_id}
      onChange={(id) => onChange(row.__key, { sku_material_id: id, rate_per_inner_pack: "", __sku: eligibleSkus.find((item) => item.material_id === id) ?? null })}
      options={skuOptions}
      disabled={!row.vendor_code_id}
      placeholder={!row.vendor_code_id ? "Select Vendor Code first" : eligibleQuery.isLoading ? "Loading…" : "Type to search SKU…"}
      inputClassName="h-8 text-xs"
    />
  );
}

function buildEntryColumns({ vendorCodes, companyId, savingKeys, onChange, onRemove, onSave }) {
  const vendorOptions = vendorCodes.map((code) => ({ value: code.vendor_code_id, label: `${code.vendor_code}${code.is_primary ? " (Primary)" : ""}` }));
  return [
    { key: "vendor_code", label: "Vendor Code *", width: "160px", render: (row) => (
      <ErpComboboxField value={row.vendor_code_id}
        onChange={(id) => onChange(row.__key, { vendor_code_id: id, sku_material_id: "", rate_per_inner_pack: "", __sku: null })}
        options={vendorOptions} placeholder="Select" inputClassName="h-8 text-xs" />
    ) },
    { key: "sku", label: "SKU *", width: "230px", render: (row) => <SkuCell row={row} companyId={companyId} onChange={onChange} /> },
    { key: "document_name", label: "Document Name", width: "190px", render: (row) => <span className="text-xs text-slate-600">{row.__sku?.document_name || row.__sku?.material_name || "—"}</span> },
    { key: "effective_date", label: "Effective Date *", width: "130px", render: (row) => (
      <input type="date" value={row.effective_date} onChange={(event) => onChange(row.__key, { effective_date: event.target.value })}
        className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
    ) },
    { key: "rate_per_base_uom", label: "Rate / Base *", width: "105px", render: (row) => numberInput(row.rate_per_base_uom, (value) => onChange(row.__key, { rate_per_base_uom: value })) },
    { key: "rate_per_inner_pack", label: "Rate / Inner", width: "105px", render: (row) => numberInput(row.rate_per_inner_pack, (value) => onChange(row.__key, { rate_per_inner_pack: value }), { disabled: !row.__sku?.has_inner_pack }) },
    { key: "rate_per_outer_uom", label: "Rate / Outer *", width: "105px", render: (row) => numberInput(row.rate_per_outer_uom, (value) => onChange(row.__key, { rate_per_outer_uom: value })) },
    { key: "rm_wastage_pct", label: "RM Waste %", width: "95px", render: (row) => numberInput(row.rm_wastage_pct, (value) => onChange(row.__key, { rm_wastage_pct: value })) },
    { key: "pack_wastage_pct", label: "Pack Waste %", width: "95px", render: (row) => numberInput(row.pack_wastage_pct, (value) => onChange(row.__key, { pack_wastage_pct: value })) },
    { key: "actions", label: "", width: "150px", render: (row) => {
      const saving = savingKeys.has(row.__key);
      return (
        <div className="flex gap-1.5">
          <button type="button" disabled={saving} onClick={() => onSave(row.__key)} className="h-8 bg-sky-700 px-3 text-[11px] font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
          <button type="button" onClick={() => onRemove(row.__key)} className="h-8 border border-rose-300 px-3 text-[11px] font-semibold text-rose-700">Remove</button>
        </div>
      );
    } },
  ];
}

function PendingRateModal({ row, companyId, onClose, onSaved }) {
  const [form, setForm] = useState({ rate_per_base_uom: "", rate_per_inner_pack: "", rate_per_outer_uom: "", rm_wastage_pct: row?.rm_wastage_pct ?? "", pack_wastage_pct: row?.pack_wastage_pct ?? "" });
  const [saving, setSaving] = useState(false);
  if (!row) return null;
  async function save() {
    setSaving(true);
    try { await updateAc05MtsSkuPendingRate(row.id, { company_id: companyId, ...form }); pushToast({ message: "Pending rate filled and marked Rated." }); onSaved(); onClose(); }
    catch (error) { pushToast({ message: errorMessage(error), tone: "error" }); }
    finally { setSaving(false); }
  }
  async function remove() {
    setSaving(true);
    try { await deleteAc05MtsSkuPendingRate(row.id, { company_id: companyId }); pushToast({ message: "Pending rate removed." }); onSaved(); onClose(); }
    catch (error) { pushToast({ message: errorMessage(error), tone: "error" }); }
    finally { setSaving(false); }
  }
  const input = (key, label) => (
    <label className="grid gap-1 text-xs font-medium text-slate-600">{label}
      <input type="number" min="0" step="0.0001" value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="h-9 w-full border border-slate-300 px-2 font-mono text-sm" />
    </label>
  );
  return (
    <ModalBase visible title="Fill Pending MTS SKU Rate" onEscape={onClose} width="min(560px, calc(100vw - 32px))"
      actions={<>
        <button type="button" disabled={saving} onClick={onClose} className="h-9 border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
        <button type="button" disabled={saving} onClick={remove} className="h-9 border border-rose-300 px-4 text-sm font-semibold text-rose-700 disabled:opacity-50">Remove</button>
        <button type="button" disabled={saving} onClick={save} className="h-9 bg-sky-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save Rate"}</button>
      </>}>
      <div className="grid gap-4">
        <div className="text-sm text-slate-600">
          {row.vendor_code} · {row.sku?.pace_code} — {row.sku?.material_name}
          <br /><span className="text-xs">Effective {row.effective_date}; this is the manually-entered commercial rate.</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {input("rate_per_base_uom", "Rate / Base UOM *")}
          {input("rate_per_inner_pack", "Rate / Inner Pack")}
          {input("rate_per_outer_uom", "Rate / Outer UOM *")}
          {input("rm_wastage_pct", "RM Wastage %")}
          {input("pack_wastage_pct", "Pack Wastage %")}
        </div>
      </div>
    </ModalBase>
  );
}

export default function MtsSkuCostingPage() {
  const { runtimeContext } = useMenu(); const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState(""); const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  const [createOpen, setCreateOpen] = useState(false); const [entryRows, setEntryRows] = useState([]); const [pendingRow, setPendingRow] = useState(null); const [search, setSearch] = useState("");
  const [savingKeys, setSavingKeys] = useState(() => new Set());
  const [savingAll, setSavingAll] = useState(false);
  const ratesQuery = useQuery({ queryKey: ["ac05-mts-sku-rates", effectiveCompanyId], queryFn: () => listAc05MtsSkuRates({ company_id: effectiveCompanyId }), enabled: Boolean(effectiveCompanyId), select: asRows });
  const vendorCodesQuery = useQuery({ queryKey: ["ac05-mts-sku-vendor-codes", effectiveCompanyId], queryFn: () => listAc05MtsSkuVendorCodes({ company_id: effectiveCompanyId }), enabled: Boolean(effectiveCompanyId && createOpen), select: asRows });
  const pendingQuery = useQuery({ queryKey: ["ac05-mts-sku-pending-count", effectiveCompanyId], queryFn: () => pendingAc05MtsSkuRateCount({ company_id: effectiveCompanyId }), enabled: Boolean(effectiveCompanyId), select: (value) => value?.pending_count ?? value?.data?.pending_count ?? 0 });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["ac05-mts-sku"] });
  const vendorCodes = vendorCodesQuery.data ?? [];
  const primaryId = vendorCodes.find((code) => code.is_primary)?.vendor_code_id ?? "";
  function addEntry() { setEntryRows((rows) => [...rows, emptyEntry(primaryId)]); }
  function changeEntry(key, patch) { setEntryRows((rows) => rows.map((row) => row.__key === key ? { ...row, ...patch } : row)); }
  function removeEntry(key) { setEntryRows((rows) => rows.filter((row) => row.__key !== key)); }
  async function saveOne(key) {
    setSavingKeys((current) => new Set(current).add(key));
    try {
      const entry = entryRows.find((row) => row.__key === key);
      const ok = entry ? await saveEntry(effectiveCompanyId, entry) : false;
      if (ok) void invalidate();
    } finally {
      setSavingKeys((current) => { const next = new Set(current); next.delete(key); return next; });
    }
  }
  async function saveAll() {
    const pendingKeys = entryRows.map((row) => row.__key).filter((key) => !savingKeys.has(key));
    if (!pendingKeys.length) return;
    setSavingAll(true);
    setSavingKeys((current) => { const next = new Set(current); pendingKeys.forEach((key) => next.add(key)); return next; });
    try {
      const results = await Promise.all(pendingKeys.map((key) => {
        const entry = entryRows.find((row) => row.__key === key);
        return entry ? saveEntry(effectiveCompanyId, entry) : Promise.resolve(false);
      }));
      if (results.some(Boolean)) void invalidate();
    } finally {
      setSavingKeys((current) => { const next = new Set(current); pendingKeys.forEach((key) => next.delete(key)); return next; });
      setSavingAll(false);
    }
  }
  const rows = (ratesQuery.data ?? []).filter((row) => JSON.stringify(row).toLowerCase().includes(search.trim().toLowerCase()));
  const columns = [
    { key: "vendor_code", label: "Vendor Code", width: "110px" }, { key: "sku", label: "SKU", width: "260px", render: (row) => <span>{row.sku?.pace_code ?? "—"} — {row.sku?.document_name || row.sku?.material_name || "—"}</span> },
    { key: "rate_per_base_uom", label: "Manual / Base", width: "125px", align: "right", render: (row) => money(row.rate_per_base_uom) }, { key: "rate_per_inner_pack", label: "Manual / Inner", width: "125px", align: "right", render: (row) => money(row.rate_per_inner_pack) }, { key: "rate_per_outer_uom", label: "Manual / Outer", width: "125px", align: "right", render: (row) => <strong>{money(row.rate_per_outer_uom)}</strong> },
    { key: "rm_wastage_pct", label: "RM Waste %", width: "95px", align: "right", render: (row) => money(row.rm_wastage_pct) }, { key: "pack_wastage_pct", label: "Pack Waste %", width: "100px", align: "right", render: (row) => money(row.pack_wastage_pct) }, { key: "effective_date", label: "Effective", width: "110px" },
    { key: "status", label: "Status", width: "95px", render: (row) => <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${row.status === "PENDING" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>{row.status}</span> },
    { key: "verification", label: "Calculated / KG", width: "130px", align: "right", render: (row) => <span className="text-slate-400" title="Calculated verification only; never used as the SO rate">{money(row.verification?.per_kg)} <small>calc.</small></span> }, { key: "verification_inner", label: "Calculated / Inner", width: "140px", align: "right", render: (row) => <span className="text-slate-400">{money(row.verification?.per_inner_pack)} <small>calc.</small></span> }, { key: "verification_outer", label: "Calculated / Outer", width: "140px", align: "right", render: (row) => <span className="text-slate-400">{money(row.verification?.per_outer_uom)} <small>calc.</small></span> },
    { key: "action", label: "Action", width: "100px", render: (row) => row.status === "PENDING" ? <button type="button" onClick={() => setPendingRow(row)} className="text-xs font-semibold text-sky-700">Fill Rate</button> : <span className="text-xs text-slate-400">Immutable</span> },
  ];
  const entryColumns = buildEntryColumns({ vendorCodes, companyId: effectiveCompanyId, savingKeys, onChange: changeEntry, onRemove: removeEntry, onSave: saveOne });
  useErpScreenHotkeys({ refresh: { disabled: !effectiveCompanyId, perform: () => { void invalidate(); } }, save: { disabled: !createOpen, perform: () => { if (!entryRows.length) addEntry(); } } });
  return <ErpScreenScaffold title="MTS SKU Costing" subtitle="AC05 — effective-dated, Vendor-Code-keyed manual MTS SKU rates. Calculated values are verification only; SO always uses the Manual / Outer rate." actions={[{ label: pendingQuery.data > 0 ? "Create 🔴" : "Create", tone: "primary", onClick: () => { setCreateOpen(true); if (!entryRows.length) setEntryRows([emptyEntry(primaryId)]); }, disabled: !effectiveCompanyId }]}>
    <ErpSectionCard><div className="mb-4 grid gap-3 md:grid-cols-[320px_minmax(0,1fr)]"><TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search all rate columns…" className="h-9 border border-slate-300 px-3 text-sm" /></div><ErpDenseGrid columns={columns} rows={rows} rowKey={(row) => row.id} maxHeight="640px" getRowProps={(row) => row.status === "PENDING" ? { className: "bg-rose-50" } : {}} emptyMessage={ratesQuery.isLoading ? "Loading MTS SKU rates…" : "No MTS SKU rate rows for this company."} /></ErpSectionCard>
    <ModalBase visible={createOpen} title="Create MTS SKU Rate" onEscape={() => setCreateOpen(false)} width="min(1240px, calc(100vw - 32px))"
      actions={<>
        <button type="button" onClick={() => setCreateOpen(false)} className="h-9 border border-slate-300 px-4 text-sm font-semibold text-slate-700">Close</button>
        <button type="button" disabled={!entryRows.length || savingAll} onClick={saveAll} className="h-9 bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{savingAll ? "Saving All…" : "Save All"}</button>
      </>}>
      <div className="grid gap-3">
        <p className="text-xs text-slate-500">Enter Base, Inner, and Outer rates independently. The system never derives or replaces a manual rate. Edit multiple rows, then use Save All to submit every row in one go.</p>
        <div className="flex justify-end">
          <button type="button" onClick={addEntry} className="border border-sky-300 px-3 py-2 text-xs font-semibold text-sky-800">Add Row</button>
        </div>
        <ErpDenseGrid columns={entryColumns} rows={entryRows} rowKey={(row) => row.__key} cellNavigate fitColumnWidths emptyMessage="No rows yet — click Add Row to start." />
      </div>
    </ModalBase>
    <PendingRateModal row={pendingRow} companyId={effectiveCompanyId} onClose={() => setPendingRow(null)} onSaved={() => { void invalidate(); }} />
  </ErpScreenScaffold>;
}
