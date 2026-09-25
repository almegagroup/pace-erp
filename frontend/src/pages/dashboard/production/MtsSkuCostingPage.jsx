import { useMemo, useState } from "react";
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

const emptyEntry = (vendorCodeId = "") => ({ vendor_code_id: vendorCodeId, sku_material_id: "", rate_per_base_uom: "", rate_per_inner_pack: "", rate_per_outer_uom: "", rm_wastage_pct: "", pack_wastage_pct: "", effective_date: new Date().toISOString().slice(0, 10) });
const asRows = (value) => Array.isArray(value) ? value : value?.data ?? [];
const money = (value) => value == null ? "—" : Number(value).toFixed(4);
const errorMessage = (error) => error?.backendMessage || error?.message || "Request failed.";
// SKU dropdown labels always carry the Material Master Document Name so
// users can identify a SKU without leaving the combobox — same convention
// SO01's own FG SKU picker (§141) already established.
const skuLabel = (sku) => [sku.pace_code, sku.document_name || sku.material_name].filter(Boolean).join(" — ");

// Shared by both the per-row Save button and the modal-level "Save All" —
// one entry, one insert attempt, returns whether it actually saved so the
// caller can decide what to invalidate/report.
async function saveEntry(companyId, entry) {
  if (!entry.vendor_code_id || !entry.sku_material_id || !entry.effective_date) {
    pushToast({ message: "Vendor Code, SKU, and Effective Date are required.", tone: "error" });
    return false;
  }
  try {
    await createAc05MtsSkuRate({ company_id: companyId, ...entry });
    pushToast({ message: "MTS SKU rate saved." });
    return true;
  } catch (error) {
    pushToast({ message: errorMessage(error), tone: "error" });
    return false;
  }
}

function RateEntryRow({ index, value, vendorCodes, companyId, saving, onChange, onRemove, onSave }) {
  const eligibleQuery = useQuery({
    queryKey: ["ac05-mts-sku-eligible", companyId, value.vendor_code_id],
    queryFn: () => listAc05MtsSkuEligibleSkus({ company_id: companyId, vendor_code_id: value.vendor_code_id }),
    enabled: Boolean(companyId && value.vendor_code_id),
    select: asRows,
  });
  const eligibleSkus = eligibleQuery.data ?? [];
  const sku = eligibleSkus.find((item) => item.material_id === value.sku_material_id);
  const field = (name, label, required = false, disabled = false) => (
    <label className="grid gap-1 text-xs font-medium text-slate-600">
      {label}{required ? <span className="text-rose-600"> *</span> : null}
      <input type="number" min="0" step="0.0001" disabled={disabled} value={value[name]} onChange={(event) => onChange(index, { [name]: event.target.value })} className="h-9 w-full border border-slate-300 bg-white px-2 font-mono text-sm disabled:bg-slate-100" />
    </label>
  );
  const vendorOptions = vendorCodes.map((code) => ({ value: code.vendor_code_id, label: `${code.vendor_code}${code.is_primary ? " (Primary)" : ""}` }));
  const skuOptions = eligibleSkus.map((item) => ({ value: item.material_id, label: skuLabel(item) }));
  return (
    <div className="grid gap-4 border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-medium text-slate-600">Vendor Code <span className="text-rose-600">*</span>
          <ErpComboboxField
            value={value.vendor_code_id}
            onChange={(id) => onChange(index, { vendor_code_id: id, sku_material_id: "", rate_per_inner_pack: "" })}
            options={vendorOptions}
            placeholder="Select Vendor Code"
            inputClassName="h-9 text-sm"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600">SKU <span className="text-rose-600">*</span>
          <ErpComboboxField
            value={value.sku_material_id}
            onChange={(id) => onChange(index, { sku_material_id: id, rate_per_inner_pack: "" })}
            options={skuOptions}
            disabled={!value.vendor_code_id}
            placeholder={!value.vendor_code_id ? "Select Vendor Code first" : eligibleQuery.isLoading ? "Loading…" : "Type to search SKU…"}
            inputClassName="h-9 text-sm"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600">Effective Date <span className="text-rose-600">*</span>
          <input type="date" value={value.effective_date} onChange={(event) => onChange(index, { effective_date: event.target.value })} className="h-9 border border-slate-300 bg-white px-2 text-sm" />
        </label>
      </div>
      {sku ? (
        <div className="text-xs text-slate-500">Document Name: <span className="font-medium text-slate-700">{sku.document_name || sku.material_name}</span></div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {field("rate_per_base_uom", "Rate / Base UOM", true)}
        {field("rate_per_inner_pack", "Rate / Inner Pack", Boolean(sku?.has_inner_pack), !sku?.has_inner_pack)}
        {field("rate_per_outer_uom", "Rate / Outer UOM", true)}
        {field("rm_wastage_pct", "RM Wastage %")}
        {field("pack_wastage_pct", "Pack Wastage %")}
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={saving} onClick={() => onSave(index)} className="h-9 bg-sky-700 px-4 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        <button type="button" onClick={() => onRemove(index)} className="h-9 border border-rose-300 px-4 text-xs font-semibold text-rose-700">Remove</button>
      </div>
    </div>
  );
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
  const [savingIndexes, setSavingIndexes] = useState(() => new Set());
  const [savingAll, setSavingAll] = useState(false);
  const ratesQuery = useQuery({ queryKey: ["ac05-mts-sku-rates", effectiveCompanyId], queryFn: () => listAc05MtsSkuRates({ company_id: effectiveCompanyId }), enabled: Boolean(effectiveCompanyId), select: asRows });
  const vendorCodesQuery = useQuery({ queryKey: ["ac05-mts-sku-vendor-codes", effectiveCompanyId], queryFn: () => listAc05MtsSkuVendorCodes({ company_id: effectiveCompanyId }), enabled: Boolean(effectiveCompanyId && createOpen), select: asRows });
  const pendingQuery = useQuery({ queryKey: ["ac05-mts-sku-pending-count", effectiveCompanyId], queryFn: () => pendingAc05MtsSkuRateCount({ company_id: effectiveCompanyId }), enabled: Boolean(effectiveCompanyId), select: (value) => value?.pending_count ?? value?.data?.pending_count ?? 0 });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["ac05-mts-sku"] });
  const vendorCodes = vendorCodesQuery.data ?? [];
  const primaryId = vendorCodes.find((code) => code.is_primary)?.vendor_code_id ?? "";
  function addEntry() { setEntryRows((rows) => [...rows, emptyEntry(primaryId)]); }
  function changeEntry(index, patch) { setEntryRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row)); }
  async function saveOne(index) {
    setSavingIndexes((current) => new Set(current).add(index));
    try {
      const ok = await saveEntry(effectiveCompanyId, entryRows[index]);
      if (ok) void invalidate();
    } finally {
      setSavingIndexes((current) => { const next = new Set(current); next.delete(index); return next; });
    }
  }
  async function saveAll() {
    const pending = entryRows.map((row, index) => index).filter((index) => !savingIndexes.has(index));
    if (!pending.length) return;
    setSavingAll(true);
    setSavingIndexes((current) => { const next = new Set(current); pending.forEach((index) => next.add(index)); return next; });
    try {
      const results = await Promise.all(pending.map((index) => saveEntry(effectiveCompanyId, entryRows[index])));
      if (results.some(Boolean)) void invalidate();
    } finally {
      setSavingIndexes((current) => { const next = new Set(current); pending.forEach((index) => next.delete(index)); return next; });
      setSavingAll(false);
    }
  }
  const rows = useMemo(() => (ratesQuery.data ?? []).filter((row) => JSON.stringify(row).toLowerCase().includes(search.trim().toLowerCase())), [ratesQuery.data, search]);
  const columns = [
    { key: "vendor_code", label: "Vendor Code", width: "110px" }, { key: "sku", label: "SKU", width: "260px", render: (row) => <span>{row.sku?.pace_code ?? "—"} — {row.sku?.document_name || row.sku?.material_name || "—"}</span> },
    { key: "rate_per_base_uom", label: "Manual / Base", width: "125px", align: "right", render: (row) => money(row.rate_per_base_uom) }, { key: "rate_per_inner_pack", label: "Manual / Inner", width: "125px", align: "right", render: (row) => money(row.rate_per_inner_pack) }, { key: "rate_per_outer_uom", label: "Manual / Outer", width: "125px", align: "right", render: (row) => <strong>{money(row.rate_per_outer_uom)}</strong> },
    { key: "rm_wastage_pct", label: "RM Waste %", width: "95px", align: "right", render: (row) => money(row.rm_wastage_pct) }, { key: "pack_wastage_pct", label: "Pack Waste %", width: "100px", align: "right", render: (row) => money(row.pack_wastage_pct) }, { key: "effective_date", label: "Effective", width: "110px" },
    { key: "status", label: "Status", width: "95px", render: (row) => <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${row.status === "PENDING" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>{row.status}</span> },
    { key: "verification", label: "Calculated / KG", width: "130px", align: "right", render: (row) => <span className="text-slate-400" title="Calculated verification only; never used as the SO rate">{money(row.verification?.per_kg)} <small>calc.</small></span> }, { key: "verification_inner", label: "Calculated / Inner", width: "140px", align: "right", render: (row) => <span className="text-slate-400">{money(row.verification?.per_inner_pack)} <small>calc.</small></span> }, { key: "verification_outer", label: "Calculated / Outer", width: "140px", align: "right", render: (row) => <span className="text-slate-400">{money(row.verification?.per_outer_uom)} <small>calc.</small></span> },
    { key: "action", label: "Action", width: "100px", render: (row) => row.status === "PENDING" ? <button type="button" onClick={() => setPendingRow(row)} className="text-xs font-semibold text-sky-700">Fill Rate</button> : <span className="text-xs text-slate-400">Immutable</span> },
  ];
  useErpScreenHotkeys({ refresh: { disabled: !effectiveCompanyId, perform: () => { void invalidate(); } }, save: { disabled: !createOpen, perform: () => { if (!entryRows.length) addEntry(); } } });
  return <ErpScreenScaffold title="MTS SKU Costing" subtitle="AC05 — effective-dated, Vendor-Code-keyed manual MTS SKU rates. Calculated values are verification only; SO always uses the Manual / Outer rate." actions={[{ label: pendingQuery.data > 0 ? "Create 🔴" : "Create", tone: "primary", onClick: () => { setCreateOpen(true); if (!entryRows.length) setEntryRows([emptyEntry(primaryId)]); }, disabled: !effectiveCompanyId }]}>
    <ErpSectionCard><div className="mb-4 grid gap-3 md:grid-cols-[320px_minmax(0,1fr)]"><TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search all rate columns…" className="h-9 border border-slate-300 px-3 text-sm" /></div><ErpDenseGrid columns={columns} rows={rows} rowKey={(row) => row.id} maxHeight="640px" getRowProps={(row) => row.status === "PENDING" ? { className: "bg-rose-50" } : {}} emptyMessage={ratesQuery.isLoading ? "Loading MTS SKU rates…" : "No MTS SKU rate rows for this company."} /></ErpSectionCard>
    <ModalBase visible={createOpen} title="Create MTS SKU Rate" onEscape={() => setCreateOpen(false)} width="min(960px, calc(100vw - 32px))"
      actions={<>
        <button type="button" onClick={() => setCreateOpen(false)} className="h-9 border border-slate-300 px-4 text-sm font-semibold text-slate-700">Close</button>
        <button type="button" disabled={!entryRows.length || savingAll} onClick={saveAll} className="h-9 bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{savingAll ? "Saving All…" : "Save All"}</button>
      </>}>
      <div className="grid gap-4">
        <p className="text-xs text-slate-500">Enter Base, Inner, and Outer rates independently. The system never derives or replaces a manual rate. Edit multiple rows, then use Save All to submit every row in one go.</p>
        {entryRows.map((row, index) => <RateEntryRow key={index} index={index} value={row} vendorCodes={vendorCodes} companyId={effectiveCompanyId} saving={savingIndexes.has(index)} onChange={changeEntry} onRemove={(removeIndex) => setEntryRows((rows) => rows.filter((_, index) => index !== removeIndex))} onSave={saveOne} />)}
        <button type="button" onClick={addEntry} className="w-fit border border-sky-300 px-3 py-2 text-xs font-semibold text-sky-800">Add Row</button>
      </div>
    </ModalBase>
    <PendingRateModal row={pendingRow} companyId={effectiveCompanyId} onClose={() => setPendingRow(null)} onSaved={() => { void invalidate(); }} />
  </ErpScreenScaffold>;
}
