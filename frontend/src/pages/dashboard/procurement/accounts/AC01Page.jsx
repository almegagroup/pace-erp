/*
 * File-Path: frontend/src/pages/dashboard/procurement/accounts/AC01Page.jsx
 * Domain: PROCUREMENT / ACCOUNTS
 * Purpose: AC01 GRN Landed Cost Hub — redesigned Invoice Verifications page.
 *          Row = one GRN. ErpDenseGrid (cell-level keyboard nav) + a center
 *          DrawerBase detail/edit panel, per the locked mockup spec
 *          (Artifact "AC01 GRN Cost Hub"). Also serves AC03 (view-only) via
 *          the `readOnly` prop — same component, no field/column differences,
 *          only editing is disabled.
 * Authority: Frontend
 * Claude direct-implemented (business owner directive 2026-08-21).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../../context/useMenu.js";
import {
  getAC01GRN,
  listAC01GRNs,
  listDeductionTypes,
  createDeductionType,
  saveAC01GRNCost,
  listTransporters,
  createTransporter,
} from "../procurementApi.js";

const DATE_FIELD_OPTIONS = [
  { value: "invoice_date", label: "Invoice date" },
  { value: "grn_date", label: "GRN date" },
  { value: "posting_date", label: "Posting date" },
];

const DUTY_COST_TYPES = new Set([
  "IMPORT_DUTY", "EXCISE_DUTY", "CST", "CUSTOMS_EDN_CESS", "ADDITIONAL_DUTY_IGST", "DUTY_SETOFF",
  "ENTRY_TAX", "CUSTOMS_DUTY",
]);
const CHARGE_COST_TYPES = [
  { value: "FREIGHT", label: "Freight" },
  { value: "CLEARING_CHARGES_CHA", label: "Clearing charges (C&F)" },
  { value: "CHA_CHARGES", label: "CHA charges" },
  { value: "LOADING", label: "Loading" },
  { value: "UNLOADING", label: "Unloading" },
  { value: "LAST_MILE_TRANSPORT", label: "Last mile transport" },
  { value: "TRANSPORTER_CHARGE_OTHER_THAN_BASIC", label: "Invoice: transporter charge other than basic" },
  { value: "INSURANCE", label: "Insurance" },
  { value: "PORT_CHARGES", label: "Port charges" },
  { value: "OTHER", label: "Other" },
];
const DUTY_LINE_TYPES = [
  { value: "IMPORT_DUTY", label: "Import duty" },
  { value: "EXCISE_DUTY", label: "Excise duty" },
  { value: "CST", label: "CST" },
  { value: "CUSTOMS_EDN_CESS", label: "Customs education cess" },
  { value: "ADDITIONAL_DUTY_IGST", label: "Additional duty / IGST" },
  { value: "DUTY_SETOFF", label: "Duty set-off" },
];
const FINANCE_LINE_TYPES = [
  { value: "LC_CHARGES", label: "LC charges" },
  { value: "BANK_CHARGES", label: "Bank charges" },
];
// Which of the three parties a cost/deduction line's amount is actually owed
// to. Suggested payable per party is computed strictly from THIS GRN's own
// lines (never aggregated across other GRNs — that's AC02's future Vendor
// Ledger, a different layer). See ac01.handlers.ts's computeSuggestedPayables.
const PARTY_TYPE_OPTIONS = [
  { value: "VENDOR", label: "Vendor" },
  { value: "TRANSPORTER", label: "Transporter" },
  { value: "LAST_MILE_TRANSPORTER", label: "Last mile transporter" },
];

function toDDMMYYYY(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return text;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function toISODate(ddmmyyyy) {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(ddmmyyyy ?? "").trim());
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function formatNumberOrBlank(value) {
  if (value === null || value === undefined || value === "") return "";
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString("en-IN", { maximumFractionDigits: 4 }) : "";
}

function udDotClass(status) {
  if (status === "GREEN") return "bg-emerald-500";
  if (status === "YELLOW") return "bg-amber-500";
  if (status === "RED") return "bg-rose-500";
  return "bg-slate-300";
}

function paymentDotStatus(row) {
  if (row.payment_status) return row.payment_status;
  // Payment status genuinely depends on AC02's Vendor Ledger, not yet built —
  // this deliberately falls back to a neutral dot rather than guessing.
  return null;
}

function nextEmptyDeductionLine() {
  return { key: `new-${Date.now()}-${Math.random()}`, deduction_type_id: "", amount: "", percentage: "", round_off: "", in_landed: false, party_type: "VENDOR" };
}

function nextEmptyCostLine() {
  return {
    key: `new-${Date.now()}-${Math.random()}`,
    cost_type: "FREIGHT", amount: "", entry_mode: "AD_HOC", has_gst: false, gst_treatment: "EXCLUSIVE", gst_rate: "",
    bill_reference: "", bill_date: "", description: "", party_type: "VENDOR",
  };
}

function buildColumns() {
  return [
    {
      key: "status", label: "Status", width: "70px",
      render: (row) => (
        <div className="flex items-center gap-1">
          <span className={`inline-block h-2 w-2 rounded-full ${udDotClass(row.ud_status)}`} title={row.ud_status ? `UD: ${row.ud_status}` : "No QA required"} />
          <span
            className={`inline-block h-2 w-2 rounded-full ${paymentDotStatus(row) === "GREEN" ? "bg-emerald-500" : paymentDotStatus(row) === "YELLOW" ? "bg-amber-500" : paymentDotStatus(row) === "RED" ? "bg-rose-500" : "bg-slate-300"}`}
            title="Payment status (pending AC02 Vendor Ledger)"
          />
        </div>
      ),
    },
    { key: "csn_number", label: "CSN Number", width: "120px" },
    { key: "grn_number", label: "GRN Number", width: "120px" },
    { key: "company_code", label: "Company", width: "90px" },
    { key: "supplier_name", label: "Supplier", width: "160px" },
    { key: "invoice_number", label: "Invoice No.", width: "120px" },
    { key: "invoice_date", label: "Invoice Date", width: "100px", render: (row) => toDDMMYYYY(row.invoice_date) },
    { key: "item_name", label: "Item Name", width: "160px" },
    { key: "external_code", label: "External Code", width: "110px" },
    { key: "grn_qty", label: "GRN Qty", width: "90px", align: "right", render: (row) => formatNumberOrBlank(row.grn_qty) },
    { key: "invoice_qty", label: "Invoice Qty", width: "90px", align: "right", render: (row) => formatNumberOrBlank(row.invoice_qty) },
    { key: "base_uom_code", label: "Base UoM", width: "80px" },
    { key: "pack_uom_code", label: "Pack UoM", width: "80px" },
    { key: "purchase_rate", label: "Purchase Rate", width: "100px", align: "right", render: (row) => formatNumberOrBlank(row.purchase_rate) },
    {
      key: "invoice_rate", label: "Invoice Rate", width: "110px", align: "right",
      render: (row) => (
        <span>
          {formatNumberOrBlank(row.invoice_rate)}
          {row.rate_mismatch ? <span className="ml-1 text-[9px] font-semibold text-rose-600">mismatch</span> : null}
        </span>
      ),
    },
    { key: "confirmed_rate", label: "Confirmed Rate", width: "100px", align: "right", render: (row) => formatNumberOrBlank(row.confirmed_rate) },
    { key: "currency", label: "Currency", width: "70px" },
    { key: "gst_pct", label: "GST %", width: "70px", align: "right", render: (row) => formatNumberOrBlank(row.gst_pct) },
    { key: "taxable_value", label: "Taxable Value", width: "110px", align: "right", render: (row) => formatNumberOrBlank(row.taxable_value) },
    { key: "landed_cost_total", label: "Landed Cost", width: "110px", align: "right", render: (row) => formatNumberOrBlank(row.landed_cost_total) },
    { key: "cost_per_unit", label: "Cost / Unit", width: "100px", align: "right", render: (row) => formatNumberOrBlank(row.cost_per_unit) },
    { key: "vendor_payable", label: "Vendor Payable (material)", width: "150px", align: "right", render: (row) => formatNumberOrBlank(row.vendor_payable) },
    {
      key: "vendor_suggested_payable", label: "Vendor Payable (total)", width: "140px", align: "right",
      render: (row) => formatNumberOrBlank(row.vendor_payable_override ?? row.vendor_suggested_payable),
    },
    {
      key: "transporter_suggested_payable", label: "Transporter Payable", width: "140px", align: "right",
      render: (row) => formatNumberOrBlank(row.transporter_payable_override ?? row.transporter_suggested_payable),
    },
    {
      key: "last_mile_suggested_payable", label: "Last Mile Payable", width: "140px", align: "right",
      render: (row) => formatNumberOrBlank(row.last_mile_payable_override ?? row.last_mile_suggested_payable),
    },
    { key: "payment_days", label: "Payment Days", width: "90px", align: "right" },
    { key: "payment_type", label: "Payment Type", width: "140px" },
    { key: "actual_payment_date", label: "Actual Payment Date", width: "120px", render: (row) => toDDMMYYYY(row.actual_payment_date) },
    { key: "revised_payment_date", label: "Revised Payment Date", width: "130px", render: (row) => toDDMMYYYY(row.revised_payment_date) },
    { key: "freight_type", label: "Freight Type", width: "100px" },
    { key: "transporter_id", label: "Transporter", width: "160px", render: (row) => row.transporter_name || "—" },
    { key: "last_mile_transporter_id", label: "Last Mile Transporter", width: "170px", render: (row) => row.last_mile_transporter_name || "—" },
    { key: "lr_number", label: "LR Number", width: "100px" },
    { key: "lr_date", label: "LR Date", width: "90px", render: (row) => toDDMMYYYY(row.lr_date) },
    { key: "bl_number", label: "BL Number", width: "100px" },
    { key: "bl_date", label: "BL Date", width: "90px", render: (row) => toDDMMYYYY(row.bl_date) },
    { key: "lc_number", label: "LC Number", width: "100px" },
    { key: "lc_date", label: "LC Date", width: "90px", render: (row) => toDDMMYYYY(row.lc_date) },
    { key: "boe_number", label: "BOE Number", width: "100px" },
    { key: "boe_date", label: "BOE Date", width: "90px", render: (row) => toDDMMYYYY(row.boe_date) },
  ];
}

function DrawerField({ label, children }) {
  return (
    <label className="grid gap-0.5 text-[10px] font-medium text-slate-600">
      <span>{label}</span>
      {children}
    </label>
  );
}

function DrawerSection({ eyebrow, title, children }) {
  return (
    <section className="grid gap-2 border border-slate-200 bg-slate-50 px-2.5 py-2">
      <div className="grid gap-0.5">
        <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">{eyebrow}</div>
        <div className="text-[12px] font-semibold text-slate-900">{title}</div>
      </div>
      {children}
    </section>
  );
}

const inputCls = "h-[26px] w-full border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-100 disabled:text-slate-500";

export default function AC01Page({ readOnly = false, initialGrnId = null }) {
  const queryClient = useQueryClient();
  const { runtimeContext } = useMenu();
  const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);

  const [companyId, setCompanyId] = useState(defaultCompanyId || "");
  const [search, setSearch] = useState("");
  const [dateFields, setDateFields] = useState(["invoice_date"]);
  const [dateFieldPickerOpen, setDateFieldPickerOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rateStatus, setRateStatus] = useState("");
  const [selectedGrnId, setSelectedGrnId] = useState(initialGrnId);
  const [drawerOpen, setDrawerOpen] = useState(Boolean(initialGrnId));
  const [draft, setDraft] = useState(null);
  const [costLines, setCostLines] = useState([]);
  const [deductionLines, setDeductionLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dateFieldPickerRef = useRef(null);

  // Last mile transporter -- search-and-select against Transporter Master,
  // same mechanism GRN's own Transporter tab uses (GRNPostFlow.jsx), plus an
  // inline "+ New transporter" quick-create so the flow never has to leave
  // this drawer. Found live 2026-08-21: this used to be a bare text input
  // bound directly to a raw transporter_id.
  const [lastMileTransporterName, setLastMileTransporterName] = useState("");
  const [lastMileTransporterSearch, setLastMileTransporterSearch] = useState("");
  const [debouncedLmtSearch, setDebouncedLmtSearch] = useState("");
  const [lmtCreateOpen, setLmtCreateOpen] = useState(false);
  const [lmtCreateName, setLmtCreateName] = useState("");
  const [lmtCreateGst, setLmtCreateGst] = useState("");
  const [lmtCreating, setLmtCreating] = useState(false);
  const lmtDebounceRef = useRef(null);

  const [deductionTypeCreateOpen, setDeductionTypeCreateOpen] = useState(false);
  const [deductionTypeCreateName, setDeductionTypeCreateName] = useState("");
  const [deductionTypeCreating, setDeductionTypeCreating] = useState(false);

  useEffect(() => {
    if (lmtDebounceRef.current) clearTimeout(lmtDebounceRef.current);
    lmtDebounceRef.current = setTimeout(() => setDebouncedLmtSearch(lastMileTransporterSearch.trim()), 300);
    return () => clearTimeout(lmtDebounceRef.current);
  }, [lastMileTransporterSearch]);

  const lastMileTransporterQuery = useQuery({
    queryKey: ["ac01", "transporters-search", debouncedLmtSearch, companyId],
    queryFn: () => listTransporters({ search: debouncedLmtSearch, company_id: companyId, limit: 20 }),
    enabled: debouncedLmtSearch.length >= 2,
  });
  const lastMileTransporterResults = Array.isArray(lastMileTransporterQuery.data)
    ? lastMileTransporterQuery.data
    : (lastMileTransporterQuery.data?.data ?? []);

  async function handleCreateTransporter() {
    if (!lmtCreateName.trim()) {
      setError("Transporter name is required.");
      return;
    }
    setLmtCreating(true);
    setError("");
    try {
      const result = await createTransporter({
        transporter_name: lmtCreateName.trim(),
        usage_direction: "BOTH",
        gst_number: lmtCreateGst.trim() || undefined,
      });
      const created = result?.data ?? result;
      if (created?.id) {
        setDraft((current) => ({ ...current, last_mile_transporter_id: created.id }));
        setLastMileTransporterName(`${created.transporter_code} — ${created.transporter_name}`);
      }
      setLmtCreateOpen(false);
      setLmtCreateName("");
      setLmtCreateGst("");
      setLastMileTransporterSearch("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Transporter create failed.");
    } finally {
      setLmtCreating(false);
    }
  }

  useEffect(() => {
    if (!companyId && defaultCompanyId) setCompanyId(defaultCompanyId);
  }, [companyId, defaultCompanyId]);

  useEffect(() => {
    function handleOutsideClick(event) {
      if (dateFieldPickerRef.current && !dateFieldPickerRef.current.contains(event.target)) {
        setDateFieldPickerOpen(false);
      }
    }
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, []);

  const listQuery = useQuery({
    queryKey: ["ac01", "grns", { companyId, search, dateFields, dateFrom, dateTo, rateStatus }],
    queryFn: () =>
      listAC01GRNs({
        company_id: companyId || undefined,
        search: search || undefined,
        date_field: dateFields[0] || "invoice_date",
        date_from: dateFrom ? toISODate(dateFrom) : undefined,
        date_to: dateTo ? toISODate(dateTo) : undefined,
        rate_status: rateStatus || undefined,
        limit: 200,
      }),
    enabled: Boolean(companyId),
  });

  const rows = useMemo(() => (Array.isArray(listQuery.data?.items) ? listQuery.data.items : []), [listQuery.data]);
  const columns = useMemo(() => buildColumns(), []);

  const grnDetailQuery = useQuery({
    queryKey: ["ac01", "grn", selectedGrnId],
    queryFn: () => getAC01GRN(selectedGrnId),
    enabled: Boolean(selectedGrnId) && drawerOpen,
  });

  const deductionTypesQuery = useQuery({
    queryKey: ["ac01", "deduction-types", companyId],
    queryFn: () => listDeductionTypes({ company_id: companyId }),
    enabled: Boolean(companyId) && drawerOpen,
  });

  useEffect(() => {
    if (!grnDetailQuery.data) return;
    const grn = grnDetailQuery.data;
    setDraft({
      invoice_number: grn.invoice_number ?? "",
      invoice_date: toDDMMYYYY(grn.invoice_date),
      confirmed_rate: grn.confirmed_rate ?? "",
      revised_payment_date: toDDMMYYYY(grn.revised_payment_date),
      gst_pct: grn.gst_pct ?? "",
      last_mile_transporter_id: grn.last_mile_transporter_id ?? "",
      vendor_payable_override: grn.vendor_payable_override ?? "",
      transporter_payable_override: grn.transporter_payable_override ?? "",
      last_mile_payable_override: grn.last_mile_payable_override ?? "",
    });
    setLastMileTransporterName(grn.last_mile_transporter_name ?? "");
    setLastMileTransporterSearch("");
    setLmtCreateOpen(false);
    setCostLines(
      (grn.cost_lines ?? []).map((line) => ({
        key: line.id,
        cost_type: line.cost_type,
        amount: line.amount ?? "",
        entry_mode: line.entry_mode ?? "AD_HOC",
        has_gst: Boolean(line.has_gst),
        gst_treatment: line.gst_treatment ?? "EXCLUSIVE",
        gst_rate: line.gst_rate ?? "",
        bill_reference: line.bill_reference ?? "",
        bill_date: toDDMMYYYY(line.bill_date),
        description: line.description ?? "",
        party_type: line.party_type ?? "VENDOR",
      })),
    );
    setDeductionLines(
      (grn.deduction_lines ?? []).map((line) => ({
        key: line.id,
        deduction_type_id: line.deduction_type_id,
        amount: line.amount ?? "",
        percentage: line.percentage ?? "",
        round_off: line.round_off ?? "",
        in_landed: Boolean(line.in_landed),
        party_type: line.party_type ?? "VENDOR",
      })),
    );
  }, [grnDetailQuery.data]);

  function openDrawer(row) {
    setSelectedGrnId(row.grn_id);
    setDrawerOpen(true);
  }

  // Locked rule: closing the drawer is a pure client-side state toggle —
  // never a screen-stack pop or route navigation, so it can never land the
  // user on Dashboard Home instead of back on this list.
  function closeDrawer() {
    setDrawerOpen(false);
    setSelectedGrnId(null);
    setDraft(null);
    setCostLines([]);
    setDeductionLines([]);
    setError("");
    setLastMileTransporterName("");
    setLastMileTransporterSearch("");
    setLmtCreateOpen(false);
    setDeductionTypeCreateOpen(false);
    setDeductionTypeCreateName("");
  }

  async function handleSave() {
    if (readOnly || !selectedGrnId || !draft) return;
    setSaving(true);
    setError("");
    try {
      await saveAC01GRNCost(selectedGrnId, {
        confirmed_rate: draft.confirmed_rate === "" ? null : Number(draft.confirmed_rate),
        last_mile_transporter_id: draft.last_mile_transporter_id || null,
        invoice_number: draft.invoice_number || null,
        invoice_date: draft.invoice_date ? toISODate(draft.invoice_date) : null,
        gst_pct: draft.gst_pct === "" ? null : Number(draft.gst_pct),
        revised_payment_date: draft.revised_payment_date ? toISODate(draft.revised_payment_date) : null,
        clear_revised_payment_date: !draft.revised_payment_date,
        vendor_payable_override: draft.vendor_payable_override === "" ? null : Number(draft.vendor_payable_override),
        clear_vendor_payable_override: draft.vendor_payable_override === "",
        transporter_payable_override: draft.transporter_payable_override === "" ? null : Number(draft.transporter_payable_override),
        clear_transporter_payable_override: draft.transporter_payable_override === "",
        last_mile_payable_override: draft.last_mile_payable_override === "" ? null : Number(draft.last_mile_payable_override),
        clear_last_mile_payable_override: draft.last_mile_payable_override === "",
        cost_lines: costLines
          .filter((line) => line.amount !== "")
          .map((line) => ({
            cost_type: line.cost_type,
            amount: Number(line.amount),
            entry_mode: line.entry_mode,
            has_gst: line.has_gst,
            gst_treatment: line.has_gst ? line.gst_treatment : null,
            gst_rate: line.has_gst && line.gst_rate !== "" ? Number(line.gst_rate) : null,
            bill_reference: line.bill_reference || null,
            bill_date: line.bill_date ? toISODate(line.bill_date) : null,
            description: line.description || null,
            party_type: line.party_type || "VENDOR",
          })),
        deduction_lines: deductionLines
          .filter((line) => line.deduction_type_id)
          .map((line) => ({
            deduction_type_id: line.deduction_type_id,
            amount: line.amount === "" ? null : Number(line.amount),
            percentage: line.percentage === "" ? null : Number(line.percentage),
            round_off: line.round_off === "" ? null : Number(line.round_off),
            in_landed: line.in_landed,
            party_type: line.party_type || "VENDOR",
          })),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ac01", "grns"] }),
        queryClient.invalidateQueries({ queryKey: ["ac01", "grn", selectedGrnId] }),
      ]);
      closeDrawer();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "AC01_SAVE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateDeductionType(name) {
    if (!name.trim() || !companyId) return null;
    try {
      const created = await createDeductionType({ company_id: companyId, name: name.trim() });
      await queryClient.invalidateQueries({ queryKey: ["ac01", "deduction-types", companyId] });
      return created;
    } catch (createError) {
      // Found live 2026-08-21: this used to be a bare `catch {}` -- a real
      // failure (ACL, duplicate name, network) looked identical to success
      // from the user's side, since the native prompt() gave no feedback
      // either way and the row simply never appeared.
      setError(createError instanceof Error ? createError.message : "Deduction type create failed.");
      return null;
    }
  }

  async function handleSubmitNewDeductionType() {
    if (!deductionTypeCreateName.trim()) {
      setError("Deduction type name is required.");
      return;
    }
    setDeductionTypeCreating(true);
    try {
      const created = await handleCreateDeductionType(deductionTypeCreateName);
      if (created) {
        setDeductionTypeCreateOpen(false);
        setDeductionTypeCreateName("");
      }
    } finally {
      setDeductionTypeCreating(false);
    }
  }

  useEffect(() => {
    if (!drawerOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
      } else if (!readOnly && event.ctrlKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerOpen, draft, costLines, deductionLines, readOnly]);

  const deductionTypeOptions = Array.isArray(deductionTypesQuery.data?.items) ? deductionTypesQuery.data.items : [];
  const selectedDateFieldLabel =
    dateFields.length === 0
      ? "Select date field(s)"
      : dateFields.length === 1
        ? DATE_FIELD_OPTIONS.find((option) => option.value === dateFields[0])?.label
        : `${DATE_FIELD_OPTIONS.find((option) => option.value === dateFields[0])?.label} +${dateFields.length - 1} more`;

  return (
    <>
      <ErpMasterListTemplate
        eyebrow="Accounts"
        title={readOnly ? "AC03 · Landed Costs (View)" : "AC01 · Invoice Verifications"}
        notices={error ? [{ key: "ac01-error", tone: "error", message: error }] : []}
        filterSection={{
          eyebrow: "",
          title: "",
          children: (
            <div className="grid gap-2 xl:grid-cols-[200px_220px_170px_130px_130px_140px] items-end">
              <TransactionCompanySelector
                runtimeContext={runtimeContext}
                value={companyId}
                onChange={(value) => setCompanyId(value)}
                label="Company"
              />
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Search
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="GRN, invoice, item, supplier..."
                  className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500"
                />
              </label>
              <div className="relative grid gap-1 text-[11px] font-medium text-slate-600" ref={dateFieldPickerRef}>
                Date field(s)
                <button
                  type="button"
                  onClick={() => setDateFieldPickerOpen((open) => !open)}
                  className="flex h-[26px] items-center justify-between border border-slate-300 bg-white px-2 text-left text-[11px] text-slate-900"
                >
                  <span className="truncate">{selectedDateFieldLabel}</span>
                  <span className="text-slate-400">▾</span>
                </button>
                {dateFieldPickerOpen ? (
                  <div className="absolute top-[46px] left-0 z-20 w-52 border border-slate-300 bg-white p-1 shadow-lg">
                    {DATE_FIELD_OPTIONS.map((option) => (
                      <label key={option.value} className="flex items-center gap-2 px-1.5 py-1 text-[11px] text-slate-700 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={dateFields.includes(option.value)}
                          onChange={(event) => {
                            setDateFields((current) =>
                              event.target.checked
                                ? [...current, option.value]
                                : current.filter((value) => value !== option.value),
                            );
                          }}
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                From date
                <input value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} placeholder="DD-MM-YYYY" className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                To date
                <input value={dateTo} onChange={(event) => setDateTo(event.target.value)} placeholder="DD-MM-YYYY" className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Status
                <select value={rateStatus} onChange={(event) => setRateStatus(event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500">
                  <option value="">All</option>
                  <option value="PENDING">Rate pending</option>
                  <option value="CONFIRMED">Confirmed</option>
                </select>
              </label>
            </div>
          ),
        }}
        listSection={{
          eyebrow: "",
          title: "",
          children: (
            <ErpDenseGrid
              columns={columns}
              rows={rows}
              rowKey={(row) => row.grn_id}
              onRowActivate={openDrawer}
              cellNavigate
              virtualize
              emptyMessage={listQuery.isLoading ? "Loading GRNs..." : "No GRNs matched the current filter."}
              getRowProps={() => ({ onDoubleClick: undefined })}
            />
          ),
        }}
      />

      <DrawerBase
        visible={drawerOpen}
        title={grnDetailQuery.data ? `GRN ${grnDetailQuery.data.grn_number}` : "Loading..."}
        onClose={closeDrawer}
        side="center"
        width="min(1480px, calc(100vw - 24px))"
        actions={
          <>
            {!readOnly ? (
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="h-8 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            ) : null}
            <button type="button" onClick={closeDrawer} className="h-8 border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50">
              Close
            </button>
          </>
        }
      >
        {!draft || grnDetailQuery.isLoading ? (
          <p className="p-6 text-center text-sm text-slate-400">Loading...</p>
        ) : (
          <div className="grid gap-2 p-3">
            <DrawerSection eyebrow="Identification" title="Company, supplier and invoice reference">
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
                <DrawerField label="Invoice number">
                  <input disabled={readOnly} value={draft.invoice_number} onChange={(event) => setDraft((current) => ({ ...current, invoice_number: event.target.value }))} className={inputCls} />
                </DrawerField>
                <DrawerField label="Invoice date">
                  <input disabled={readOnly} value={draft.invoice_date} onChange={(event) => setDraft((current) => ({ ...current, invoice_date: event.target.value }))} placeholder="DD-MM-YYYY" className={inputCls} />
                </DrawerField>
              </div>
            </DrawerSection>

            <DrawerSection eyebrow="Rate confirmation" title="PO rate, invoice rate and confirmed rate">
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
                <DrawerField label="PO rate (reference)">
                  <input disabled value={formatNumberOrBlank(grnDetailQuery.data?.po_rate)} className={inputCls} />
                </DrawerField>
                <DrawerField label="Invoice rate (noted at GRN)">
                  <input disabled value={formatNumberOrBlank(grnDetailQuery.data?.invoice_rate)} className={inputCls} />
                </DrawerField>
                <DrawerField label="Confirmed rate">
                  <input disabled={readOnly} value={draft.confirmed_rate} onChange={(event) => setDraft((current) => ({ ...current, confirmed_rate: event.target.value }))} placeholder="Enter confirmed rate" className={inputCls} />
                </DrawerField>
                <DrawerField label="GST %">
                  <input disabled={readOnly} value={draft.gst_pct} onChange={(event) => setDraft((current) => ({ ...current, gst_pct: event.target.value }))} className={inputCls} />
                </DrawerField>
              </div>
            </DrawerSection>

            <DrawerSection eyebrow="Payment" title="Terms and payment dates">
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
                <DrawerField label="Actual payment date (calculated from PO payment terms)">
                  <input
                    disabled
                    value={grnDetailQuery.data?.actual_payment_date ? toDDMMYYYY(grnDetailQuery.data.actual_payment_date) : "-"}
                    className={inputCls}
                  />
                </DrawerField>
                <DrawerField label="Revised payment date">
                  <input disabled={readOnly} value={draft.revised_payment_date} onChange={(event) => setDraft((current) => ({ ...current, revised_payment_date: event.target.value }))} placeholder="DD-MM-YYYY, optional" className={inputCls} />
                </DrawerField>
              </div>
            </DrawerSection>

            <DrawerSection eyebrow="Freight and logistics" title="Last mile transporter">
              {grnDetailQuery.data?.freight_type ? (
                <div className="border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600">
                  <span className="font-semibold text-slate-800">Freight term (from PO): {grnDetailQuery.data.freight_type}</span>
                  {grnDetailQuery.data.freight_type === "FOR" && costLines.some((line) => line.cost_type === "FREIGHT") ? (
                    <div className="mt-0.5 text-amber-700">
                      ⚠ FOR means the vendor delivers to destination — a "Freight" line here is unusual; verify it, or use Last Mile Transport for PACE's own onward leg.
                    </div>
                  ) : null}
                </div>
              ) : null}
              <DrawerField label="Last mile transporter">
                {draft.last_mile_transporter_id && lastMileTransporterName ? (
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 flex-1 items-center border border-emerald-300 bg-emerald-50 px-2 text-sm text-emerald-900">
                      {lastMileTransporterName}
                    </span>
                    {!readOnly ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDraft((current) => ({ ...current, last_mile_transporter_id: "" }));
                          setLastMileTransporterName("");
                        }}
                        className="h-8 border border-slate-300 bg-white px-3 text-xs text-slate-600"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                ) : readOnly ? (
                  <span className="text-sm text-slate-400">—</span>
                ) : (
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Type 2+ characters to search transporter master…"
                      value={lastMileTransporterSearch}
                      onChange={(event) => setLastMileTransporterSearch(event.target.value)}
                      className={inputCls}
                    />
                    {debouncedLmtSearch.length >= 2 ? (
                      <div className="absolute left-0 right-0 top-full z-20 mt-0.5 max-h-52 overflow-y-auto border border-slate-200 bg-white shadow-md">
                        {lastMileTransporterQuery.isLoading ? (
                          <div className="px-3 py-2 text-sm text-slate-400">Searching…</div>
                        ) : null}
                        {!lastMileTransporterQuery.isLoading && lastMileTransporterResults.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-slate-500">
                            No match found.{" "}
                            <button type="button" onClick={() => { setLmtCreateOpen(true); setLmtCreateName(lastMileTransporterSearch); }} className="text-sky-600 underline">
                              + New transporter
                            </button>
                          </div>
                        ) : null}
                        {lastMileTransporterResults.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              setDraft((current) => ({ ...current, last_mile_transporter_id: t.id }));
                              setLastMileTransporterName(`${t.transporter_code} — ${t.transporter_name}`);
                              setLastMileTransporterSearch("");
                            }}
                            className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-sky-50"
                          >
                            <span className="font-mono text-xs text-slate-500">{t.transporter_code}</span>
                            <span className="ml-2 font-medium">{t.transporter_name}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </DrawerField>
              {!readOnly && !draft.last_mile_transporter_id ? (
                lmtCreateOpen ? (
                  <div className="mt-2 grid gap-2 border border-sky-200 bg-sky-50 p-3" style={{ gridTemplateColumns: "1fr 1fr auto auto" }}>
                    <input placeholder="Transporter name" value={lmtCreateName} onChange={(event) => setLmtCreateName(event.target.value)} className={inputCls} />
                    <input placeholder="GST number (optional)" value={lmtCreateGst} onChange={(event) => setLmtCreateGst(event.target.value)} className={inputCls} />
                    <button type="button" disabled={lmtCreating} onClick={() => void handleCreateTransporter()} className="h-8 bg-sky-600 px-3 text-xs font-semibold text-white disabled:opacity-50">
                      {lmtCreating ? "Saving…" : "Save"}
                    </button>
                    <button type="button" onClick={() => setLmtCreateOpen(false)} className="h-8 border border-slate-300 bg-white px-3 text-xs text-slate-600">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setLmtCreateOpen(true)} className="mt-1 text-[11px] font-semibold text-sky-600 underline">
                    + New transporter
                  </button>
                )
              ) : null}
            </DrawerSection>

            <DrawerSection eyebrow="Landed cost" title="Duty stack + ad-hoc/per-UoM charges, GST gated then treated, always Base UoM">
              <div className="grid gap-1">
                {costLines.map((line, index) => {
                  const isDuty = DUTY_COST_TYPES.has(line.cost_type);
                  return (
                    <div key={line.key} className="grid gap-1.5 items-end" style={{ gridTemplateColumns: "1.4fr 0.7fr 0.6fr 0.6fr 0.6fr 0.5fr 0.9fr 0.5fr" }}>
                      <select
                        disabled={readOnly}
                        value={line.cost_type}
                        onChange={(event) => setCostLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, cost_type: event.target.value } : entry)))}
                        className={inputCls}
                      >
                        <optgroup label="Duty (amount in, % derived)">
                          {DUTY_LINE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </optgroup>
                        <optgroup label="Charges">
                          {CHARGE_COST_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </optgroup>
                        <optgroup label="Finance">
                          {FINANCE_LINE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </optgroup>
                      </select>
                      <input
                        disabled={readOnly}
                        value={line.amount}
                        onChange={(event) => setCostLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, amount: event.target.value } : entry)))}
                        placeholder="Amount"
                        className={inputCls}
                      />
                      {!isDuty ? (
                        <select
                          disabled={readOnly}
                          value={line.entry_mode}
                          onChange={(event) => setCostLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, entry_mode: event.target.value } : entry)))}
                          className={inputCls}
                        >
                          <option value="AD_HOC">Ad hoc</option>
                          <option value="PER_UOM">Per UoM</option>
                        </select>
                      ) : <div />}
                      {!isDuty ? (
                        <select
                          disabled={readOnly}
                          value={line.has_gst ? "YES" : "NO"}
                          onChange={(event) => setCostLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, has_gst: event.target.value === "YES" } : entry)))}
                          className={inputCls}
                        >
                          <option value="NO">Has GST? No</option>
                          <option value="YES">Has GST? Yes</option>
                        </select>
                      ) : <div />}
                      {!isDuty && line.has_gst ? (
                        <select
                          disabled={readOnly}
                          value={line.gst_treatment}
                          onChange={(event) => setCostLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, gst_treatment: event.target.value } : entry)))}
                          className={inputCls}
                        >
                          <option value="EXCLUSIVE">Exclusive</option>
                          <option value="INCLUSIVE">Inclusive</option>
                        </select>
                      ) : <div />}
                      {!isDuty && line.has_gst ? (
                        <input
                          disabled={readOnly}
                          value={line.gst_rate}
                          onChange={(event) => setCostLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, gst_rate: event.target.value } : entry)))}
                          placeholder="GST %"
                          className={inputCls}
                        />
                      ) : <div />}
                      <select
                        disabled={readOnly}
                        value={line.party_type}
                        onChange={(event) => setCostLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, party_type: event.target.value } : entry)))}
                        className={inputCls}
                        title="Which party this charge is owed to"
                      >
                        {PARTY_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                      {!readOnly ? (
                        <button
                          type="button"
                          onClick={() => setCostLines((current) => current.filter((_, entryIndex) => entryIndex !== index))}
                          className="h-[26px] border border-rose-300 bg-rose-50 text-[10px] font-semibold text-rose-800"
                        >
                          Remove
                        </button>
                      ) : <div />}
                    </div>
                  );
                })}
                {!readOnly ? (
                  <button type="button" onClick={() => setCostLines((current) => [...current, nextEmptyCostLine()])} className="mt-1 justify-self-start text-[11px] font-semibold text-sky-700">
                    + Add cost line
                  </button>
                ) : null}
              </div>
            </DrawerSection>

            <DrawerSection eyebrow="Deductions" title='Reusable deduction types — tick "In landed?" to affect landed cost'>
              <div className="grid gap-1">
                {deductionLines.map((line, index) => (
                  <div key={line.key} className="grid gap-1.5 items-end" style={{ gridTemplateColumns: "1.2fr 0.6fr 0.5fr 0.6fr 0.9fr 0.5fr 0.5fr" }}>
                    <select
                      disabled={readOnly}
                      value={line.deduction_type_id}
                      onChange={(event) => setDeductionLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, deduction_type_id: event.target.value } : entry)))}
                      className={inputCls}
                    >
                      <option value="">Select type</option>
                      {deductionTypeOptions.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                    </select>
                    <input disabled={readOnly} value={line.amount} onChange={(event) => setDeductionLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, amount: event.target.value } : entry)))} placeholder="Amount" className={inputCls} />
                    <input disabled={readOnly} value={line.percentage} onChange={(event) => setDeductionLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, percentage: event.target.value } : entry)))} placeholder="%" className={inputCls} />
                    <input disabled={readOnly} value={line.round_off} onChange={(event) => setDeductionLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, round_off: event.target.value } : entry)))} placeholder="Round off" className={inputCls} />
                    <select
                      disabled={readOnly}
                      value={line.party_type}
                      onChange={(event) => setDeductionLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, party_type: event.target.value } : entry)))}
                      className={inputCls}
                      title="Which party this deduction is against"
                    >
                      {PARTY_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <label className="flex h-[26px] items-center gap-1 text-[10px] text-slate-600">
                      <input
                        type="checkbox"
                        disabled={readOnly}
                        checked={line.in_landed}
                        onChange={(event) => setDeductionLines((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, in_landed: event.target.checked } : entry)))}
                      />
                      In landed
                    </label>
                    {!readOnly ? (
                      <button type="button" onClick={() => setDeductionLines((current) => current.filter((_, entryIndex) => entryIndex !== index))} className="h-[26px] border border-rose-300 bg-rose-50 text-[10px] font-semibold text-rose-800">
                        Remove
                      </button>
                    ) : <div />}
                  </div>
                ))}
                {!readOnly ? (
                  <div className="mt-1 grid gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setDeductionLines((current) => [...current, nextEmptyDeductionLine()])} className="text-[11px] font-semibold text-sky-700">
                        + Add deduction
                      </button>
                      {!deductionTypeCreateOpen ? (
                        <button type="button" onClick={() => setDeductionTypeCreateOpen(true)} className="text-[11px] font-semibold text-slate-500">
                          + New deduction type
                        </button>
                      ) : null}
                    </div>
                    {deductionTypeCreateOpen ? (
                      <div className="grid gap-2 border border-sky-200 bg-sky-50 p-3" style={{ gridTemplateColumns: "1fr auto auto" }}>
                        <input
                          autoFocus
                          placeholder="Deduction type name (e.g. TDS 194Q)"
                          value={deductionTypeCreateName}
                          onChange={(event) => setDeductionTypeCreateName(event.target.value)}
                          className={inputCls}
                        />
                        <button type="button" disabled={deductionTypeCreating} onClick={() => void handleSubmitNewDeductionType()} className="h-8 bg-sky-600 px-3 text-xs font-semibold text-white disabled:opacity-50">
                          {deductionTypeCreating ? "Saving…" : "Save"}
                        </button>
                        <button type="button" onClick={() => { setDeductionTypeCreateOpen(false); setDeductionTypeCreateName(""); }} className="h-8 border border-slate-300 bg-white px-3 text-xs text-slate-600">
                          Cancel
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </DrawerSection>

            <DrawerSection
              eyebrow="Payable"
              title="Per-party payable — suggested from this GRN's own lines only, overwrite to confirm the real amount"
            >
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Vendor payable", suggestedKey: "vendor_suggested_payable", draftKey: "vendor_payable_override" },
                  { label: "Transporter payable", suggestedKey: "transporter_suggested_payable", draftKey: "transporter_payable_override" },
                  { label: "Last mile transporter payable", suggestedKey: "last_mile_suggested_payable", draftKey: "last_mile_payable_override" },
                ].map(({ label, suggestedKey, draftKey }) => (
                  <div key={draftKey} className="grid gap-1 border border-slate-200 bg-white px-2 py-1.5">
                    <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</div>
                    <div className="text-[11px] text-slate-500">
                      Suggested: <span className="font-semibold text-slate-800">{formatNumberOrBlank(grnDetailQuery.data?.[suggestedKey]) || "0"}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        disabled={readOnly}
                        value={draft[draftKey]}
                        onChange={(event) => setDraft((current) => ({ ...current, [draftKey]: event.target.value }))}
                        placeholder="Confirmed / overwrite"
                        className={inputCls}
                      />
                      {!readOnly && draft[draftKey] !== "" ? (
                        <button
                          type="button"
                          onClick={() => setDraft((current) => ({ ...current, [draftKey]: "" }))}
                          className="h-[26px] shrink-0 border border-slate-300 bg-white px-2 text-[10px] text-slate-600"
                        >
                          Use suggested
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </DrawerSection>

            <DrawerSection eyebrow="Summary" title="Computed on save — also mirrored on the row itself">
              <div className="grid grid-cols-4 gap-2">
                {[
                  ["Landed cost total", grnDetailQuery.data?.landed_cost?.total_cost],
                ].map(([label, value]) => (
                  <div key={label} className="border border-slate-200 bg-white px-2 py-1.5">
                    <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</div>
                    <div className="text-[14px] font-semibold text-slate-900">{formatNumberOrBlank(value) || "—"}</div>
                  </div>
                ))}
              </div>
            </DrawerSection>
          </div>
        )}
      </DrawerBase>
    </>
  );
}
