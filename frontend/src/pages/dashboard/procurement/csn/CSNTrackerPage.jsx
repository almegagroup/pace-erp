import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpColumnVisibilityDrawer from "../../../../components/ErpColumnVisibilityDrawer.jsx";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ModalBase from "../../../../components/layer/ModalBase.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { openScreen, openScreenWithContext } from "../../../../navigation/screenStackEngine.js";
import { requestWideWorkspace } from "../../../../store/wideWorkspace.js";
import { openActionConfirm } from "../../../../store/actionConfirm.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { useCompaniesQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";
import {
  confirmCSNDispatchQty,
  createSubCSN,
  createCSNTrackerLayout,
  deleteSubCSN,
  deleteCSNTrackerLayout,
  getAllAlertCounts,
  getCSNFieldHistory,
  getCSNTracker,
  listCHAs,
  listCSNTrackerLayouts,
  listPorts,
  listTransporters,
  previewCSNDispatchQty,
  updateCSN,
} from "../procurementApi.js";

const LIMIT = 100;
const STATUS_OPTIONS = ["ORD", "TRN", "GED", "GRD", "CAN", "KOF"];
const STATUS_LABELS = {
  ORD: "Ordered",
  TRN: "In Transit",
  GED: "GE Done",
  GRD: "GRN Done",
  CAN: "Cancelled",
  KOF: "Knocked Off",
};
const YES_NO_OPTIONS = [
  { value: true, label: "Yes" },
  { value: false, label: "No" },
];
// Locked 2026-08-13 (business owner override): GED/GRD no longer hard-block editing on the
// backend -- CSN Tracker access holders (SCM etc.) can correct any field regardless of status,
// since GE/Stores can make a mistake just as easily as SCM can. The safety net is this
// confirm, shown ONCE per Save click (not per field) when the CSN is already past Gate
// Entry/GRN, so a genuine correction can't happen by accident.
const POST_PROCESS_CSN_STATUSES = new Set(["GED", "GRD"]);
// Step 6 retrofit (2026-08-21): the date-field picker mirrors AC01's pattern -- only the
// FIRST checked field is actually sent to the backend (same behavior AC01 locked), the
// checkbox UI just lets the user choose which single column Date From/To filters against.
// Whitelist must match TRACKER_DATE_FILTER_FIELDS in csn.handlers.ts's getTrackerHandler.
const TRACKER_DATE_FIELD_OPTIONS = [
  { value: "created_at", label: "CSN Created" },
  { value: "etd", label: "ETD" },
  { value: "eta_at_port", label: "ETA Port" },
  { value: "ata_at_port", label: "ATA Port" },
  { value: "invoice_date", label: "Invoice Date" },
  { value: "gate_entry_date", label: "GE Date" },
  { value: "grn_date", label: "GRN Date" },
  { value: "lr_date", label: "LR Date" },
  { value: "bl_date", label: "BL Date" },
];
const TRACKER_FIELDS = [
  "dispatch_qty",
  "has_rebate",
  "rebate_rate",
  "rebate_remarks",
  "material_category_id",
  "indent_required",
  "vendor_indent_number",
  "scheduled_eta_to_port",
  "etd",
  "etd_is_manual_override",
  "bl_number",
  "bl_date",
  "invoice_number",
  "invoice_date",
  "boe_number",
  "boe_date",
  "eta_at_port",
  "eta_at_port_is_manual_override",
  "ata_at_port",
  "transporter_id",
  "transporter_name_freetext",
  "cha_id",
  "cha_name_freetext",
  "lr_date",
  "lr_number",
  "gate_entry_id",
  "gate_entry_date",
  "grn_id",
  "grn_date",
  "lc_number",
  "lc_opened_date",
  "soft_copy_received",
  "hard_copy_received",
  "hard_copy_courier_number",
  "courier_dispatch_date",
  "courier_received_date",
  "courier_date_to_cha",
  "courier_cha_receive_date",
  "cha_docket_number",
  "consignee_company_id",
  "port_of_discharge_id",
  "vessel_name",
  "voyage_number",
  "post_clearance_lr_date",
  "lr_number_port_to_plant",
  "vehicle_number_port_to_plant",
  "vehicle_number",
  "domestic_transporter_id",
  "domestic_transporter_freetext",
  "last_mile_transporter_id",
  "last_mile_transporter_freetext",
  "remarks",
  "received_qty",
  "transit_days_snapshot",
];

function toText(value) {
  return String(value ?? "").trim();
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function diffDays(left, right) {
  if (!left || !right) {
    return null;
  }
  const leftDate = new Date(`${left}T00:00:00.000Z`);
  const rightDate = new Date(`${right}T00:00:00.000Z`);
  return Math.round((leftDate.getTime() - rightDate.getTime()) / 86400000);
}

function formatDiff(diff) {
  if (diff == null) {
    return "-";
  }
  return diff > 0 ? `+${diff}` : String(diff);
}

function formatBool(value) {
  if (value === true) {
    return "Yes";
  }
  if (value === false) {
    return "No";
  }
  return "-";
}

function getStatusLabel(value) {
  return STATUS_LABELS[String(value || "").toUpperCase()] || value || "-";
}

function getBadgeTone(value) {
  switch (String(value || "").toUpperCase()) {
    case "IMPORT":
      return "bg-sky-100 text-sky-800";
    case "DOMESTIC":
      return "bg-emerald-100 text-emerald-800";
    case "GED":
      return "bg-[#FAC775] text-[#412402]";
    case "GRD":
      return "bg-[#97C459] text-[#173404]";
    case "CAN":
      return "bg-[#E24B4A] text-[#FCEBEB]";
    case "KOF":
      return "bg-[#5F5E5A] text-[#F1EFE8]";
    case "TRN":
      return "bg-[#B5D4F4] text-[#042C53]";
    case "ORD":
      return "bg-[#F1EFE8] text-[#2C2C2A]";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function toneForDiff(diff) {
  if (diff == null || diff === 0) {
    return "text-slate-600";
  }
  return diff > 0 ? "text-rose-700" : "text-sky-700";
}

function buildDraft(row) {
  const draft = TRACKER_FIELDS.reduce((acc, field) => {
    acc[field] = row?.[field] ?? (field.endsWith("_received") || field.endsWith("_override") ? false : "");
    return acc;
  }, {});
  if (!draft.consignee_company_id) {
    draft.consignee_company_id = row?.consignee_company_id ?? row?.company_id ?? "";
  }
  // §113 fix: no more draft.atd — ATD has no real column (it's just
  // bl_date/lr_date), and the edit drawer now reads those directly for its
  // read-only ATD mirror instead of carrying a separate, driftable copy.
  return draft;
}

function normalizePayload(draft) {
  const payload = {};
  for (const [key, value] of Object.entries(draft)) {
    if (typeof value === "boolean") {
      payload[key] = value;
    } else if (value === "") {
      payload[key] = null;
    } else {
      payload[key] = value;
    }
  }
  return payload;
}

function buildColumnDefs() {
  return [
    { key: "csn_display_number", label: "CSN", width: "140px" },
    { key: "display_reference_number", label: "Reference", width: "120px" },
    { key: "status", label: "Status", width: "110px" },
    { key: "csn_type", label: "Type", width: "100px" },
    { key: "company_label", label: "Company", width: "180px" },
    { key: "consignee_company_label", label: "Allotted Company", width: "180px" },
    { key: "vendor_name", label: "Vendor", width: "180px" },
    { key: "material_code", label: "Material Code", width: "130px" },
    { key: "material_name", label: "Material", width: "180px" },
    { key: "material_group_name", label: "Material Group", width: "150px" },
    { key: "po_date", label: "PO Date", width: "120px" },
    { key: "po_qty", label: "Order Qty", width: "110px" },
    { key: "balance_qty", label: "Balance Qty", width: "110px" },
    { key: "dispatch_qty", label: "Dispatch Qty", width: "110px" },
    { key: "base_uom_code", label: "Base UOM", width: "100px" },
    { key: "po_uom_code", label: "Order UOM", width: "100px" },
    { key: "po_rate", label: "PO Rate", width: "100px" },
    { key: "currency_code", label: "Currency", width: "90px" },
    { key: "cha_name", label: "CHA", width: "160px" },
    { key: "indent_required", label: "Indent?", width: "90px" },
    { key: "vendor_indent_number", label: "Indent Number", width: "140px" },
    { key: "has_rebate", label: "Has Rebate", width: "100px" },
    { key: "rebate_rate", label: "Rebate Rate", width: "110px" },
    { key: "rebate_remarks", label: "Rebate Remarks", width: "160px" },
    { key: "baseline_schedule", label: "Baseline ETD/ETA", width: "140px" },
    { key: "delivery_type", label: "Delivery Type", width: "120px" },
    { key: "scheduled_eta_to_port", label: "Scheduled ETA Port", width: "140px" },
    { key: "etd", label: "ETD", width: "120px" },
    { key: "atd", label: "ATD", width: "120px" },
    { key: "bl_number", label: "BL Number", width: "130px" },
    { key: "bl_date", label: "BL Date", width: "120px" },
    { key: "invoice_number", label: "Invoice Number", width: "140px" },
    { key: "invoice_date", label: "Invoice Date", width: "120px" },
    { key: "boe_number", label: "BOE Number", width: "130px" },
    { key: "boe_date", label: "BOE Date", width: "120px" },
    { key: "eta_at_port", label: "ETA Port", width: "120px" },
    { key: "ata_at_port", label: "ATA Port", width: "120px" },
    { key: "transporter_name", label: "Transporter", width: "160px" },
    { key: "last_mile_transporter_name", label: "Last Mile Transporter", width: "160px" },
    { key: "lr_date", label: "LR Date", width: "120px" },
    { key: "lr_number", label: "LR Number", width: "130px" },
    { key: "eta_to_plant_calculated", label: "ETA Plant", width: "120px" },
    { key: "gate_entry_number", label: "GE Number", width: "120px" },
    { key: "gate_entry_date", label: "GE Date", width: "120px" },
    { key: "grn_number", label: "GRN Number", width: "130px" },
    { key: "grn_date", label: "GRN Date", width: "120px" },
    { key: "port_of_discharge_label", label: "Destination Port", width: "180px" },
    { key: "lc_number", label: "LC Number", width: "120px" },
    { key: "lc_due_date", label: "Calculated LC Opening Date", width: "160px" },
    { key: "lc_opened_date", label: "LC Opened", width: "120px" },
    { key: "actual_payment_date", label: "Actual Payment Date", width: "150px" },
    { key: "soft_copy_received", label: "Soft Copy", width: "110px" },
    { key: "hard_copy_received", label: "Hard Copy", width: "110px" },
    { key: "etd_vs_atd_days", label: "ETD vs ATD", width: "110px" },
    { key: "eta_vs_ata_days", label: "ETA vs ATA", width: "110px" },
    { key: "baseline_vs_actual_days", label: "Baseline vs Actual", width: "130px" },
    { key: "lr_vs_ge_days", label: "LR vs GE", width: "100px" },
    { key: "created_by_display", label: "Created By", width: "170px" },
    { key: "created_at", label: "Created At", width: "160px" },
    { key: "remarks", label: "Remarks", width: "220px", wrap: true },
  ];
}

function computeDerived(row) {
  const atd = row.csn_type === "IMPORT" ? row.bl_date : row.lr_date;
  const etdVsAtd = diffDays(atd, row.etd);
  const etaVsAta = diffDays(row.ata_at_port, row.eta_at_port);
  const baselineSchedule = row.csn_type === "DOMESTIC" ? row.expected_delivery_date : row.scheduled_eta_to_port;
  const baselineVsActual = row.csn_type === "DOMESTIC"
    ? diffDays(row.lr_date, row.expected_delivery_date)
    : diffDays(row.ata_at_port, row.scheduled_eta_to_port);
  const lrVsGe = diffDays(row.gate_entry_date, row.lr_date);
  return {
    atd,
    baseline_schedule: baselineSchedule,
    etd_vs_atd_days: etdVsAtd,
    eta_vs_ata_days: etaVsAta,
    baseline_vs_actual_days: baselineVsActual,
    lr_vs_ge_days: lrVsGe,
    gate_entry_number: row.ge_number || row.gate_entry_id || "-",
    grn_number: row.grn_number || row.grn_id || "-",
  };
}

function evaluateRedFields(row) {
  const today = todayIso();
  const derived = computeDerived(row);
  const red = new Set();
  const etd = toText(row.etd);
  const atd = toText(derived.atd);
  const eta = toText(row.eta_at_port);
  const ata = toText(row.ata_at_port);
  const geMissing = !toText(row.gate_entry_date) && !toText(row.ge_number) && !toText(row.gate_entry_id);
  const importClearanceAnchor = row.import_clearance_days != null && ata
    ? addDays(ata, Number(row.import_clearance_days))
    : "";

  const mark = (fields, condition) => {
    if (condition) {
      fields.forEach((field) => red.add(field));
    }
  };

  mark(["etd", "atd"], etd && today > etd && !atd);
  mark(["bl_number"], row.csn_type === "IMPORT" && toText(row.bl_date) && !toText(row.bl_number));
  mark(["bl_date"], row.csn_type === "IMPORT" && toText(row.bl_number) && !toText(row.bl_date));
  mark(
    ["invoice_number", "invoice_date"],
    row.csn_type === "IMPORT"
      ? ((toText(row.bl_number) && toText(row.bl_date)) || toText(row.bl_date)) &&
          (!toText(row.invoice_number) || !toText(row.invoice_date))
      : toText(row.lr_date) && (!toText(row.invoice_number) || !toText(row.invoice_date))
  );
  mark(["eta_at_port", "ata_at_port"], row.csn_type === "IMPORT" && eta && today > eta && !ata);
  mark(["boe_number", "boe_date"], row.csn_type === "IMPORT" && ata && (!toText(row.boe_number) || !toText(row.boe_date)));
  mark(
    ["transporter_id", "lr_number", "lr_date"],
    row.csn_type === "IMPORT" && importClearanceAnchor && today > importClearanceAnchor &&
      (!toText(row.transporter_id || row.transporter_name_freetext) || !toText(row.lr_number) || !toText(row.lr_date))
  );
  mark(["soft_copy_received"], atd && today >= addDays(atd, 3) && row.soft_copy_received !== true);
  mark(["hard_copy_received"], atd && today >= addDays(atd, 7) && row.hard_copy_received !== true);
  mark(["eta_to_plant_calculated"], toText(row.eta_to_plant_calculated) && today > toText(row.eta_to_plant_calculated) && geMissing);
  return red;
}

function FieldHistoryButton({ rowId, fieldName, activeKey, histories, loadingHistoryKey, onToggle }) {
  const key = `${rowId}:${fieldName}`;
  const isOpen = activeKey === key;
  const history = histories[key] || [];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onToggle(key, rowId, fieldName)}
        title="Field history"
        className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full border border-slate-300 bg-white text-[9px] font-semibold text-slate-500"
      >
        i
      </button>
      {isOpen ? (
        <div className="absolute right-0 z-20 mt-1 w-72 border border-slate-300 bg-white p-2 text-[10px] shadow-xl">
          <div className="mb-2 font-semibold text-slate-700">Field History</div>
          {loadingHistoryKey === key ? (
            <div className="text-slate-500">Loading...</div>
          ) : history.length > 0 ? (
            <div className="grid gap-2">
              {history.map((entry) => (
                <div key={entry.id} className="border border-slate-200 bg-slate-50 px-2 py-1">
                  <div className="text-slate-800">
                    {(entry.old_value || "-")} {"->"} {(entry.new_value || "-")}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {entry.changed_by_display || entry.changed_by || "-"} | {entry.changed_at || "-"}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-slate-500">No history yet.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function EditField({ label, children, rowId, fieldName, activeHistoryKey, histories, loadingHistoryKey, onToggleHistory }) {
  return (
    <label className="grid gap-0.5 text-[10px] font-medium text-slate-600">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <FieldHistoryButton
          rowId={rowId}
          fieldName={fieldName}
          activeKey={activeHistoryKey}
          histories={histories}
          loadingHistoryKey={loadingHistoryKey}
          onToggle={onToggleHistory}
        />
      </span>
      {children}
    </label>
  );
}

function TrackerSection({ eyebrow, title, children }) {
  return (
    <section className="grid gap-2 border border-slate-200 bg-white px-2.5 py-2">
      <div className="grid gap-0.5">
        <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {eyebrow}
        </div>
        <div className="text-[12px] font-semibold text-slate-900">{title}</div>
      </div>
      {children}
    </section>
  );
}

function IconActionButton({ glyph, title, onClick, disabled = false, tone = "neutral" }) {
  const toneClass = disabled
    ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
    : tone === "primary"
      ? "border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100"
      : tone === "danger"
        ? "border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100"
        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-[26px] min-w-[26px] items-center justify-center whitespace-nowrap border px-1.5 text-[10px] font-semibold uppercase tracking-[0.04em] transition ${toneClass}`}
    >
      {glyph}
    </button>
  );
}

function CompactPaginationStrip({ page, totalPages, startIndex, endIndex, totalItems, onPrev, onNext }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
      <div>
        Rows {startIndex}-{endIndex} of {totalItems}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onPrev}
          disabled={page <= 1}
          className="inline-flex h-[24px] min-w-[38px] items-center justify-center border border-slate-300 bg-white px-1.5 text-[10px] font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Prev
        </button>
        <div className="min-w-[66px] text-center text-[10px] font-semibold text-slate-700">
          Page {page}/{totalPages}
        </div>
        <button
          type="button"
          onClick={onNext}
          disabled={page >= totalPages}
          className="inline-flex h-[24px] min-w-[38px] items-center justify-center border border-slate-300 bg-white px-1.5 text-[10px] font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export default function CSNTrackerPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { runtimeContext } = useMenu();
  useEffect(() => requestWideWorkspace(), []);
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [csnType, setCsnType] = useState("");
  const [dateFields, setDateFields] = useState(["created_at"]);
  const [dateFieldPickerOpen, setDateFieldPickerOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [expandedRowId, setExpandedRowId] = useState("");
  const [draft, setDraft] = useState(null);
  const [savingRowId, setSavingRowId] = useState("");
  const [showColumns, setShowColumns] = useState(false);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(() => buildColumnDefs().map((column) => column.key));
  const [layoutDraft, setLayoutDraft] = useState({ name: "", scope: "USER" });
  const [showSaveLayout, setShowSaveLayout] = useState(false);
  const [selectedLayoutId, setSelectedLayoutId] = useState("");
  const [dispatchDialog, setDispatchDialog] = useState(null);
  const [activeHistoryKey, setActiveHistoryKey] = useState("");
  const [histories, setHistories] = useState({});
  const [loadingHistoryKey, setLoadingHistoryKey] = useState("");
  const dateFieldPickerRef = useRef(null);

  const columns = useMemo(() => buildColumnDefs(), []);
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim().toLowerCase());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    function handleOutsideClick(event) {
      if (dateFieldPickerRef.current && !dateFieldPickerRef.current.contains(event.target)) {
        setDateFieldPickerOpen(false);
      }
    }
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, []);

  const trackerQuery = useQuery({
    queryKey: ["csn-tracker", effectiveCompanyId, status, csnType, dateFields[0], dateFrom, dateTo, page],
    queryFn: () =>
      getCSNTracker({
        company_id: effectiveCompanyId || undefined,
        status: status || undefined,
        csn_type: csnType || undefined,
        date_field: dateFields[0] || "created_at",
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: LIMIT,
        offset: (page - 1) * LIMIT,
      }),
    enabled: Boolean(effectiveCompanyId),
  });

  const alertsQuery = useQuery({
    queryKey: ["csn-alert-counts", effectiveCompanyId],
    queryFn: () => getAllAlertCounts({ company_id: effectiveCompanyId || undefined }),
    enabled: Boolean(effectiveCompanyId),
  });

  useErpScreenHotkeys({
    refresh: {
      disabled: trackerQuery.isLoading,
      perform: () => {
        void trackerQuery.refetch();
        void alertsQuery.refetch();
      },
    },
  });

  const layoutsQuery = useQuery({
    queryKey: ["csn-tracker-layouts"],
    queryFn: () => listCSNTrackerLayouts(),
  });

  const transportersQuery = useQuery({
    queryKey: ["csn-transporters"],
    queryFn: () => listTransporters({ is_active: "true", limit: 500 }),
  });
  const dischargePortsQuery = useQuery({
    queryKey: ["csn-discharge-ports"],
    queryFn: () => listPorts({ is_active: "true", port_role: "DISCHARGE" }),
  });

  // PERF: this was a raw fetch() under its own key ("csn-procurement-companies"), hitting the very
  // same endpoint as the shared useCompaniesQuery hook. Two keys for one endpoint = React Query
  // can't dedupe or share the cache, so /api/procurement/companies was fetched twice. Use the
  // shared hook so every consumer reads one cached copy. (It also bypassed the fetchProcurement
  // helper, so it skipped the standard error handling.)
  const companiesQuery = useCompaniesQuery();

  const rows = useMemo(() => {
    const baseRows = Array.isArray(trackerQuery.data?.data) ? trackerQuery.data.data : [];
    return baseRows.map((row) => ({ ...row, ...computeDerived(row) }));
  }, [trackerQuery.data]);
  const expandedRowCompanyId = useMemo(
    () => rows.find((row) => row.id === expandedRowId)?.company_id || "",
    [expandedRowId, rows]
  );
  const chasQuery = useQuery({
    queryKey: ["csn-chas", expandedRowCompanyId || ""],
    queryFn: () => listCHAs({ is_active: true, limit: 500, company_id: expandedRowCompanyId || undefined }),
    enabled: Boolean(expandedRowCompanyId),
  });

  const filteredRows = useMemo(() => {
    if (!debouncedSearch) {
      return rows;
    }
    return rows.filter((row) =>
      [
        row.csn_display_number,
        row.display_reference_number,
        row.vendor_name,
        row.material_name,
        row.material_group_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(debouncedSearch)
    );
  }, [debouncedSearch, rows]);

  const total = Number(trackerQuery.data?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const startIndex = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(page * LIMIT, total);
  const visibleColumns = useMemo(
    () => columns.filter((column) => visibleColumnKeys.includes(column.key)),
    [columns, visibleColumnKeys]
  );

  const transporterOptions = useMemo(() => {
    const raw = Array.isArray(transportersQuery.data) ? transportersQuery.data : [];
    return raw.map((row) => ({
      value: row.id,
      label: `${row.transporter_name || row.name || "Unnamed transporter"} — ${row.address || "No address on file"}`,
    }));
  }, [transportersQuery.data]);

  const chaOptions = useMemo(() => {
    const raw = Array.isArray(chasQuery.data) ? chasQuery.data : [];
    return raw.map((row) => ({
      value: row.id,
      label: `${row.cha_name || row.name || "Unnamed CHA"} — ${row.address || "No address on file"}`,
    }));
  }, [chasQuery.data]);

  const portOptions = useMemo(() => {
    const raw = Array.isArray(dischargePortsQuery.data) ? dischargePortsQuery.data : [];
    return raw.map((row) => ({
      value: row.id,
      label: `${row.port_code || ""}${row.port_name ? ` | ${row.port_name}` : ""}` || row.id,
    }));
  }, [dischargePortsQuery.data]);

  const allottedCompanyOptions = useMemo(() => {
    const raw = Array.isArray(companiesQuery.data) ? companiesQuery.data : [];
    return raw.map((row) => ({
      value: row.id,
      label: `${row.company_code || ""}${row.company_name ? ` | ${row.company_name}` : ""}` || row.id,
    }));
  }, [companiesQuery.data]);

  const savedLayouts = Array.isArray(layoutsQuery.data) ? layoutsQuery.data : [];

  function openAlerts(tab) {
    openScreen(OPERATION_SCREENS.PROC_CSN_ALERTS.screen_code);
    navigate(`/dashboard/procurement/csn-alerts?tab=${encodeURIComponent(tab)}`);
  }

  function openDetail(row) {
    openScreenWithContext(OPERATION_SCREENS.PROC_CSN_DETAIL.screen_code, {
      id: row.id,
      refreshOnReturn: true,
    });
    navigate(`/dashboard/procurement/csns/${encodeURIComponent(row.id)}`);
  }

  function resetDraft(row) {
    setExpandedRowId(row?.id || "");
    setDraft(row ? buildDraft(row) : null);
    setActiveHistoryKey("");
  }

  async function toggleHistory(key, rowId, fieldName) {
    if (activeHistoryKey === key) {
      setActiveHistoryKey("");
      return;
    }
    setActiveHistoryKey(key);
    if (histories[key]) {
      return;
    }
    try {
      setLoadingHistoryKey(key);
      const data = await getCSNFieldHistory(rowId, { field_name: fieldName });
      setHistories((current) => ({ ...current, [key]: Array.isArray(data) ? data : [] }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_CSN_HISTORY_LIST_FAILED");
    } finally {
      setLoadingHistoryKey("");
    }
  }

  function patchDraft(field, value) {
    setDraft((current) => ({ ...(current || {}), [field]: value }));
  }

  async function invalidateTracker() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["csn-tracker"] }),
      queryClient.invalidateQueries({ queryKey: ["csn-alert-counts"] }),
    ]);
  }

  async function saveExpandedRow(row, dispatchAction = null) {
    const scopedCompanyId = effectiveCompanyId || row?.company_id || "";
    if (!draft) {
      return;
    }
    if (!scopedCompanyId) {
      setError("PROCUREMENT_CSN_COMPANY_REQUIRED");
      return;
    }
    // Only gate the FIRST entry into a save attempt -- dispatchAction is set when this function
    // re-enters after the user already resolved the (separate) dispatch-qty conflict dialog, and
    // by then they've already been through this confirm once for this same Save click.
    if (!dispatchAction && POST_PROCESS_CSN_STATUSES.has(toText(row.status).toUpperCase())) {
      const confirmed = await openActionConfirm({
        eyebrow: "Consignment Tracker",
        title: "Save changes to this CSN?",
        message: "Gate Entry / GRN has already been posted for this consignment. Are you sure you want to change it now?",
        confirmLabel: "Yes, save changes",
      });
      if (!confirmed) return;
    }
    setSavingRowId(row.id);
    setError("");
    setNotice("");
    try {
      const payload = normalizePayload(draft);
      const nextDispatchQty = parseNumber(payload.dispatch_qty);
      const currentDispatchQty = parseNumber(row.dispatch_qty);
      const dispatchChanged = nextDispatchQty !== currentDispatchQty;

      if (!dispatchAction && dispatchChanged && nextDispatchQty != null) {
        const preview = await previewCSNDispatchQty(row.id, {
          company_id: scopedCompanyId,
          dispatch_qty: nextDispatchQty,
        });
        if (Number(preview?.remainder ?? 0) > 0) {
          setDispatchDialog({
            row,
            payload,
            preview,
            allocations: (preview.csns || []).map((entry) => ({
              id: entry.id,
              qty: entry.current_qty,
              label: entry.csn_number ? `${entry.csn_number}` : entry.id,
            })),
            knock_off_qty: preview.remainder || 0,
            reason: "",
            mode: "prompt",
          });
          return;
        }
      }

      if (dispatchAction) {
        await confirmCSNDispatchQty(row.id, {
          company_id: scopedCompanyId,
          dispatch_qty: payload.dispatch_qty,
          ...dispatchAction,
        });
      }

      await updateCSN(row.id, {
        company_id: scopedCompanyId,
        ...payload,
      });

      await invalidateTracker();
      setNotice("CSN row updated.");
      resetDraft(null);
      setDispatchDialog(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_CSN_UPDATE_FAILED");
    } finally {
      setSavingRowId("");
    }
  }

  async function handleCreateSubCsn(row) {
    const scopedCompanyId = effectiveCompanyId || row?.company_id || "";
    if (!row?.id || !scopedCompanyId) {
      setError("PROCUREMENT_SUB_CSN_COMPANY_REQUIRED");
      return;
    }
    setSavingRowId(row.id);
    setError("");
    setNotice("");
    try {
      await createSubCSN(row.id, {
        company_id: scopedCompanyId,
      });
      await invalidateTracker();
      setNotice("Sub CSN created. Set its dispatch quantity from the tracker row.");
      resetDraft(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_SUB_CSN_CREATE_FAILED");
    } finally {
      setSavingRowId("");
    }
  }

  async function handleDeleteSubCsn(motherRow, subRow) {
    if (!motherRow?.id || !subRow?.id) {
      return;
    }
    setSavingRowId(motherRow.id);
    setError("");
    setNotice("");
    try {
      await deleteSubCSN(motherRow.id, subRow.id);
      await invalidateTracker();
      setNotice("Sub CSN deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "PROCUREMENT_SUB_CSN_DELETE_FAILED");
    } finally {
      setSavingRowId("");
    }
  }

  async function saveLayout() {
    try {
      setError("");
      await createCSNTrackerLayout({
        name: layoutDraft.name,
        scope: layoutDraft.scope,
        visible_columns: visibleColumnKeys,
      });
      await queryClient.invalidateQueries({ queryKey: ["csn-tracker-layouts"] });
      setNotice("Layout saved.");
      setShowSaveLayout(false);
      setLayoutDraft({ name: "", scope: "USER" });
    } catch (layoutError) {
      setError(layoutError instanceof Error ? layoutError.message : "PROCUREMENT_CSN_LAYOUT_CREATE_FAILED");
    }
  }

  async function removeSelectedLayout() {
    if (!selectedLayoutId) {
      return;
    }
    try {
      setError("");
      await deleteCSNTrackerLayout(selectedLayoutId);
      await queryClient.invalidateQueries({ queryKey: ["csn-tracker-layouts"] });
      setSelectedLayoutId("");
      setVisibleColumnKeys(columns.map((column) => column.key));
      setNotice("Layout deleted.");
    } catch (layoutError) {
      setError(layoutError instanceof Error ? layoutError.message : "PROCUREMENT_CSN_LAYOUT_DELETE_FAILED");
    }
  }

  function applyLayout(layoutId) {
    setSelectedLayoutId(layoutId);
    if (!layoutId) {
      setVisibleColumnKeys(columns.map((column) => column.key));
      return;
    }
    const layout = savedLayouts.find((entry) => entry.id === layoutId);
    const next = Array.isArray(layout?.visible_columns)
      ? layout.visible_columns.filter((key) => columns.some((column) => column.key === key))
      : [];
    if (next.length > 0) {
      setVisibleColumnKeys(next);
    }
  }

  function renderCell(row, column) {
    const redFields = evaluateRedFields(row);
    const textClass = redFields.has(column.key) ? "text-rose-700 font-semibold" : "text-slate-700";
    switch (column.key) {
      case "status":
        return (
          <span
            title={getStatusLabel(row.status)}
            className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${getBadgeTone(row.status)}`}
          >
            {row.status || "-"}
          </span>
        );
      case "csn_type":
        return (
          <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${getBadgeTone(row.csn_type)}`}>
            {row.csn_type || "-"}
          </span>
        );
      case "soft_copy_received":
      case "hard_copy_received":
      case "indent_required":
      case "has_rebate":
        return <span className={textClass}>{formatBool(row[column.key])}</span>;
      case "etd_vs_atd_days":
      case "eta_vs_ata_days":
      case "baseline_vs_actual_days":
        return <span className={toneForDiff(row[column.key])}>{formatDiff(row[column.key])}</span>;
      case "lr_vs_ge_days":
        return <span className="text-slate-700">{formatDiff(row[column.key])}</span>;
      case "remarks":
      case "rebate_remarks":
        return <span className="line-clamp-2">{row[column.key] || "-"}</span>;
      default:
        return <span className={textClass}>{row[column.key] || "-"}</span>;
    }
  }

  const gridColumns = useMemo(
    () => visibleColumns.map((column) => ({ ...column, render: (row) => renderCell(row, column) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleColumns, expandedRowId, rows]
  );

  const currentRow = rows.find((row) => row.id === expandedRowId) || null;
  const currentGroupOptions = currentRow?.material_group_options || [];
  const subCsnsForCurrentRow = useMemo(
    () => rows.filter((entry) => entry.mother_csn_id === expandedRowId),
    [expandedRowId, rows]
  );
  const currentRowSupportsSubCsn = Boolean(currentRow && !currentRow.mother_csn_id);
  const drawerOpen = Boolean(currentRow && draft);

  const handleExpandedRowKeyDown = useEffectEvent((event) => {
    if (!currentRow || !draft) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      resetDraft(null);
      return;
    }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "s" && currentRowSupportsSubCsn) {
      event.preventDefault();
      void handleCreateSubCsn(currentRow);
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveExpandedRow(currentRow);
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === "o") {
      event.preventDefault();
      openDetail(currentRow);
    }
  });

  useEffect(() => {
    if (!currentRow || !draft) {
      return undefined;
    }

    window.addEventListener("keydown", handleExpandedRowKeyDown);
    return () => window.removeEventListener("keydown", handleExpandedRowKeyDown);
  }, [currentRow, draft]);

  const selectedDateFieldLabel =
    dateFields.length === 0
      ? "Select date field"
      : dateFields.length === 1
        ? TRACKER_DATE_FIELD_OPTIONS.find((option) => option.value === dateFields[0])?.label
        : `${TRACKER_DATE_FIELD_OPTIONS.find((option) => option.value === dateFields[0])?.label} +${dateFields.length - 1} more`;

  return (
    <>
      <ErpMasterListTemplate
        eyebrow="Procurement"
        title="Consignment Tracker"
        actions={[]}
        notices={[
          ...(error ? [{ key: "csn-tracker-error", tone: "error", message: error }] : []),
          ...(notice ? [{ key: "csn-tracker-notice", tone: "success", message: notice }] : []),
        ]}
        filterSection={{
          eyebrow: "",
          title: "",
          children: (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2 border border-slate-200 bg-slate-50 px-2 py-1.5">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  <span className="font-semibold text-sky-800">Procurement</span>
                  <span className="text-slate-300">/</span>
                  <span className="font-semibold text-slate-900">Consignment Tracker</span>
                  <button
                    type="button"
                    onClick={() => openAlerts("lc")}
                    className="inline-flex items-center border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.1em] text-amber-900"
                    title="Open LC alerts"
                  >
                    LC {Number(alertsQuery.data?.lc_alert ?? 0)}
                  </button>
                  <button
                    type="button"
                    onClick={() => openAlerts("vessel")}
                    className="inline-flex items-center border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.1em] text-amber-900"
                    title="Open vessel-booking alerts"
                  >
                    Vessel {Number(alertsQuery.data?.vessel_booking_alert ?? 0)}
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <IconActionButton glyph="CL" title="Columns" onClick={() => setShowColumns(true)} />
                  <IconActionButton glyph="LY" title="Save layout" onClick={() => setShowSaveLayout(true)} />
                  <IconActionButton
                    glyph="RF"
                    title={trackerQuery.isFetching ? "Refreshing" : "Refresh"}
                    onClick={() => void invalidateTracker()}
                  />
                </div>
              </div>

              <div className="grid gap-2 xl:grid-cols-[210px_130px_130px_170px_128px_128px_200px_minmax(0,1fr)]">
                <TransactionCompanySelector
                  runtimeContext={runtimeContext}
                  value={companyId}
                  onChange={(nextValue) => {
                    setCompanyId(nextValue);
                    setPage(1);
                  }}
                  label="Company"
                />

                <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                  Status
                  <select
                    value={status}
                    onChange={(event) => {
                      setStatus(event.target.value);
                      setPage(1);
                    }}
                    className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">ALL</option>
                    {STATUS_OPTIONS.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry} - {getStatusLabel(entry)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                  CSN Type
                  <select
                    value={csnType}
                    onChange={(event) => {
                      setCsnType(event.target.value);
                      setPage(1);
                    }}
                    className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">ALL</option>
                    {["IMPORT", "DOMESTIC"].map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="relative grid gap-1 text-[11px] font-medium text-slate-600" ref={dateFieldPickerRef}>
                  Date Field
                  <button
                    type="button"
                    onClick={() => setDateFieldPickerOpen((open) => !open)}
                    className="flex h-[26px] items-center justify-between border border-slate-300 bg-white px-2 text-left text-[11px] text-slate-900"
                  >
                    <span className="truncate">{selectedDateFieldLabel}</span>
                    <span className="text-slate-400">▾</span>
                  </button>
                  {dateFieldPickerOpen ? (
                    <div className="absolute top-[46px] left-0 z-20 w-56 border border-slate-300 bg-white p-1 shadow-lg">
                      {TRACKER_DATE_FIELD_OPTIONS.map((option) => (
                        <label key={option.value} className="flex items-center gap-2 px-1.5 py-1 text-[11px] text-slate-700 hover:bg-slate-50">
                          <input
                            type="checkbox"
                            checked={dateFields.includes(option.value)}
                            onChange={(event) => {
                              setDateFields((current) =>
                                event.target.checked
                                  ? [...current, option.value]
                                  : current.filter((value) => value !== option.value)
                              );
                              setPage(1);
                            }}
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>

                <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                  Date From
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(event) => {
                      setDateFrom(event.target.value);
                      setPage(1);
                    }}
                    className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500"
                  />
                </label>

                <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                  Date To
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(event) => {
                      setDateTo(event.target.value);
                      setPage(1);
                    }}
                    className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500"
                  />
                </label>

                <label className="grid min-w-0 gap-1 text-[11px] font-medium text-slate-600">
                  Layout
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <select
                      value={selectedLayoutId}
                      onChange={(event) => applyLayout(event.target.value)}
                      className="h-[26px] min-w-0 flex-1 border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500"
                    >
                      <option value="">Default (All Columns)</option>
                      {savedLayouts.map((layout) => (
                        <option key={layout.id} value={layout.id}>
                          {layout.name} [{layout.scope}]
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void removeSelectedLayout()}
                      disabled={!selectedLayoutId}
                      className="inline-flex h-[26px] items-center border border-rose-300 bg-rose-50 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-rose-900 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </label>
                <label className="grid min-w-0 gap-1 text-[11px] font-medium text-slate-600">
                  Search
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="CSN, vendor, material, PO"
                    className="h-[26px] min-w-0 border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-500"
                  />
                </label>
              </div>
            </div>
          ),
        }}
        listSection={{
          eyebrow: "",
          title: "",
          children: (
            <div className="grid gap-2">
              <CompactPaginationStrip
                page={page}
                totalPages={totalPages}
                startIndex={startIndex}
                endIndex={endIndex}
                totalItems={total}
                onPrev={() => setPage((current) => Math.max(1, current - 1))}
                onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
              />
              <ErpDenseGrid
                columns={gridColumns}
                rows={filteredRows}
                rowKey={(row) => row.id}
                onRowActivate={(row) => resetDraft(row)}
                getRowProps={(row) => ({ onDoubleClick: () => resetDraft(row) })}
                cellNavigate
                virtualize
                emptyMessage={trackerQuery.isLoading ? "Loading consignment tracker..." : "No CSNs matched the current filter."}
              />
            </div>
          ),
        }}
      />

      <DrawerBase
        visible={drawerOpen}
        onClose={() => resetDraft(null)}
        onEscape={() => resetDraft(null)}
        side="center"
        width="min(1180px, calc(100vw - 24px))"
        title={
          currentRow ? (
            <span className="grid gap-0.5">
              <span className="block text-[13px] font-semibold text-slate-900">
                {currentRow.csn_display_number || currentRow.csn_number || currentRow.id}
              </span>
              <span className="block text-[11px] font-normal text-slate-600">
                {currentRow.display_reference_number || currentRow.po_number || currentRow.sto_number || "-"} | {currentRow.material_name || "-"} | {currentRow.company_label || "-"}
              </span>
            </span>
          ) : (
            "Tracker Row"
          )
        }
        actions={
          currentRow ? (
            <>
              {!currentRow.mother_csn_id ? (
                <IconActionButton
                  glyph="+"
                  title="Create Sub CSN (Ctrl+Shift+S)"
                  onClick={() => void handleCreateSubCsn(currentRow)}
                  disabled={savingRowId === currentRow.id}
                  tone="primary"
                />
              ) : null}
              <IconActionButton glyph="OP" title="Open full detail (Ctrl+O)" onClick={() => openDetail(currentRow)} />
              <IconActionButton
                glyph="SV"
                title={savingRowId === currentRow.id ? "Saving" : "Save (Ctrl+S)"}
                onClick={() => void saveExpandedRow(currentRow)}
                disabled={savingRowId === currentRow.id}
                tone="primary"
              />
              <IconActionButton glyph="X" title="Close (Esc)" onClick={() => resetDraft(null)} />
            </>
          ) : null
        }
      >
        {currentRow && draft ? (
          <div className="grid gap-2">
            <TrackerSection eyebrow="Allocation" title="Dispatch balance and commercial flags">
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                <EditField label="Dispatch Qty" rowId={currentRow.id} fieldName="dispatch_qty" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <input type="number" min="0" step="0.0001" value={draft.dispatch_qty ?? ""} onChange={(event) => patchDraft("dispatch_qty", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500" />
                </EditField>
                <EditField label="Material Group" rowId={currentRow.id} fieldName="material_category_id" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  {currentGroupOptions.length > 0 ? (
                    <select value={draft.material_category_id ?? ""} onChange={(event) => patchDraft("material_category_id", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500">
                      <option value="">Select group</option>
                      {currentGroupOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.group_name}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="h-[26px] border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                      {currentRow.material_name || "-"}
                    </div>
                  )}
                </EditField>
                <EditField label="Indent Required" rowId={currentRow.id} fieldName="indent_required" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <select value={draft.indent_required ? "YES" : "NO"} onChange={(event) => patchDraft("indent_required", event.target.value === "YES")} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500">
                    {YES_NO_OPTIONS.map((option) => (
                      <option key={option.label} value={option.value ? "YES" : "NO"}>{option.label}</option>
                    ))}
                  </select>
                </EditField>
                <EditField label="Indent Number" rowId={currentRow.id} fieldName="vendor_indent_number" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <input disabled={!draft.indent_required} value={draft.vendor_indent_number ?? ""} onChange={(event) => patchDraft("vendor_indent_number", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400" />
                </EditField>
                <EditField label="Has Rebate" rowId={currentRow.id} fieldName="has_rebate" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <select value={draft.has_rebate ? "YES" : "NO"} onChange={(event) => patchDraft("has_rebate", event.target.value === "YES")} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500">
                    {YES_NO_OPTIONS.map((option) => (
                      <option key={option.label} value={option.value ? "YES" : "NO"}>{option.label}</option>
                    ))}
                  </select>
                </EditField>
                <EditField label="Rebate Rate" rowId={currentRow.id} fieldName="rebate_rate" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={draft.rebate_rate ?? ""}
                    onChange={(event) => patchDraft("rebate_rate", event.target.value)}
                    disabled={!draft.has_rebate}
                    className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </EditField>
                <EditField label="Rebate Remarks" rowId={currentRow.id} fieldName="rebate_remarks" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <input
                    value={draft.rebate_remarks ?? ""}
                    onChange={(event) => patchDraft("rebate_remarks", event.target.value)}
                    disabled={!draft.has_rebate}
                    className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </EditField>
              </div>
            </TrackerSection>

            {!currentRow.mother_csn_id ? (
              <TrackerSection eyebrow="Sub CSNs" title="Linked splits and allocated quantities">
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                    <span>{subCsnsForCurrentRow.length} linked row{subCsnsForCurrentRow.length === 1 ? "" : "s"}</span>
                    <IconActionButton
                      glyph="+"
                      title="Create Sub CSN (Ctrl+Shift+S)"
                      onClick={() => void handleCreateSubCsn(currentRow)}
                      disabled={savingRowId === currentRow.id}
                      tone="primary"
                    />
                  </div>
                  {subCsnsForCurrentRow.length > 0 ? (
                    <div className="overflow-auto border border-slate-200">
                      <table className="min-w-full border-collapse text-[10px]">
                        <thead className="bg-slate-100 uppercase tracking-[0.08em] text-slate-500">
                          <tr>
                            <th className="border-b border-r border-slate-200 px-1.5 py-1 text-left font-semibold">Label</th>
                            <th className="border-b border-r border-slate-200 px-1.5 py-1 text-left font-semibold">Allotted Company</th>
                            <th className="border-b border-r border-slate-200 px-1.5 py-1 text-left font-semibold">Qty</th>
                            <th className="border-b border-r border-slate-200 px-1.5 py-1 text-left font-semibold">Status</th>
                            <th className="border-b border-slate-200 px-1.5 py-1 text-right font-semibold">Delete</th>
                          </tr>
                        </thead>
                        <tbody>
                          {subCsnsForCurrentRow.map((subRow) => {
                            const canDelete = String(subRow.status || "").toUpperCase() === "ORD" && !subRow.sto_id;
                            return (
                              <tr key={subRow.id} className="border-b border-slate-200 last:border-b-0">
                                <td className="border-r border-slate-200 px-1.5 py-1 text-slate-700">{subRow.csn_display_number || subRow.csn_number || subRow.id}</td>
                                <td className="border-r border-slate-200 px-1.5 py-1 text-slate-700">{subRow.consignee_company_label || "-"}</td>
                                <td className="border-r border-slate-200 px-1.5 py-1 text-slate-700">{subRow.dispatch_qty || "-"}</td>
                                <td className="border-r border-slate-200 px-1.5 py-1">
                                  <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${getBadgeTone(subRow.status)}`}>
                                    {subRow.status || "-"}
                                  </span>
                                </td>
                                <td className="px-1.5 py-1 text-right">
                                  {canDelete ? (
                                    <IconActionButton
                                      glyph="DL"
                                      title="Delete Sub CSN"
                                      onClick={() => void handleDeleteSubCsn(currentRow, subRow)}
                                      disabled={savingRowId === currentRow.id}
                                      tone="danger"
                                    />
                                  ) : (
                                    <span className="text-[10px] text-slate-400">-</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="border border-dashed border-slate-300 bg-slate-50 px-2 py-2 text-[10px] text-slate-500">
                      No sub CSNs linked yet.
                    </div>
                  )}
                </div>
              </TrackerSection>
            ) : null}

            <TrackerSection eyebrow="Shipment Timeline" title="ETD, ATD, ETA, and arrival chain">
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                {currentRow.csn_type === "IMPORT" ? (
                  <EditField label="Scheduled ETA Port" rowId={currentRow.id} fieldName="scheduled_eta_to_port" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                    <input type="date" value={draft.scheduled_eta_to_port ?? ""} onChange={(event) => patchDraft("scheduled_eta_to_port", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                  </EditField>
                ) : null}
                <EditField label="ETD" rowId={currentRow.id} fieldName="etd" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <input type="date" value={draft.etd ?? ""} onChange={(event) => patchDraft("etd", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                </EditField>
                <EditField label="ATD (from LR/BL Date below)" rowId={currentRow.id} fieldName={currentRow.csn_type === "IMPORT" ? "bl_date" : "lr_date"} activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  {/* §113 fix: this used to be its own editable input bound to a
                      separate draft.atd key -- since ATD has no real DB column (it's
                      only ever bl_date for IMPORT / lr_date for DOMESTIC), editing it
                      independently let a stale/empty draft.atd silently overwrite
                      whatever the user had just typed into the real LR/BL Date field
                      below on save. Now purely a live read-only mirror -- there is
                      exactly one place to edit this date. */}
                  <input type="date" value={(currentRow.csn_type === "IMPORT" ? draft.bl_date : draft.lr_date) ?? ""} readOnly disabled className="h-[26px] border border-slate-300 bg-slate-100 px-2 text-[11px] text-slate-600 outline-none" />
                </EditField>
                {currentRow.csn_type === "IMPORT" ? (
                  <>
                    <EditField label="ETA at Port" rowId={currentRow.id} fieldName="eta_at_port" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                      <input type="date" value={draft.eta_at_port ?? ""} onChange={(event) => patchDraft("eta_at_port", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                    </EditField>
                    <EditField label="ATA at Port" rowId={currentRow.id} fieldName="ata_at_port" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                      <input type="date" value={draft.ata_at_port ?? ""} onChange={(event) => patchDraft("ata_at_port", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                    </EditField>
                  </>
                ) : null}
              </div>
            </TrackerSection>

            <TrackerSection eyebrow="Documents" title="BL, invoice, BOE, and statutory references">
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                {currentRow.csn_type === "IMPORT" ? (
                  <>
                    <EditField label="BL Number" rowId={currentRow.id} fieldName="bl_number" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                      <input value={draft.bl_number ?? ""} onChange={(event) => patchDraft("bl_number", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                    </EditField>
                    <EditField label="BL Date" rowId={currentRow.id} fieldName="bl_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                      <input type="date" value={draft.bl_date ?? ""} onChange={(event) => patchDraft("bl_date", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                    </EditField>
                  </>
                ) : null}
                <EditField label="Invoice Number" rowId={currentRow.id} fieldName="invoice_number" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <input value={draft.invoice_number ?? ""} onChange={(event) => patchDraft("invoice_number", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                </EditField>
                <EditField label="Invoice Date" rowId={currentRow.id} fieldName="invoice_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <input type="date" value={draft.invoice_date ?? ""} onChange={(event) => patchDraft("invoice_date", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                </EditField>
                {currentRow.csn_type === "IMPORT" ? (
                  <>
                    <EditField label="BOE Number" rowId={currentRow.id} fieldName="boe_number" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                      <input value={draft.boe_number ?? ""} onChange={(event) => patchDraft("boe_number", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                    </EditField>
                    <EditField label="BOE Date" rowId={currentRow.id} fieldName="boe_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                      <input type="date" value={draft.boe_date ?? ""} onChange={(event) => patchDraft("boe_date", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                    </EditField>
                  </>
                ) : null}
                <EditField label="Destination Port" rowId={currentRow.id} fieldName="port_of_discharge_id" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <select value={draft.port_of_discharge_id ?? ""} onChange={(event) => patchDraft("port_of_discharge_id", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500">
                    <option value="">Select port</option>
                    {portOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </EditField>
                <EditField label="Allotted Company" rowId={currentRow.id} fieldName="consignee_company_id" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <select value={draft.consignee_company_id ?? ""} onChange={(event) => patchDraft("consignee_company_id", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500">
                    <option value="">Select company</option>
                    {allottedCompanyOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </EditField>
              </div>
            </TrackerSection>

            <TrackerSection eyebrow="Logistics" title="Transport, LR, and post-clearance handoff">
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                {currentRow.csn_type === "DOMESTIC" ? (
                  // Real bug found live 2026-08-13 (business owner) -- this field was
                  // hardcoded to transporter_id, but GRN sync (grn.handlers.ts's CSN
                  // sync-back) writes DOMESTIC transporters to domestic_transporter_id,
                  // a separate column. The combobox always came up blank for Domestic
                  // CSNs even with a real value sitting in the DB, because it was reading
                  // the wrong column.
                  <EditField label="Transporter" rowId={currentRow.id} fieldName="domestic_transporter_id" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                    <ErpComboboxField
                      value={draft.domestic_transporter_id ?? ""}
                      onChange={(value) => patchDraft("domestic_transporter_id", value)}
                      options={transporterOptions}
                      blankLabel="Select transporter"
                      placeholder="Select transporter"
                      inputClassName="h-[26px] px-2 py-0 text-[11px]"
                    />
                  </EditField>
                ) : (
                  <EditField label="Transporter" rowId={currentRow.id} fieldName="transporter_id" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                    <ErpComboboxField
                      value={draft.transporter_id ?? ""}
                      onChange={(value) => patchDraft("transporter_id", value)}
                      options={transporterOptions}
                      blankLabel="Select transporter"
                      placeholder="Select transporter"
                      inputClassName="h-[26px] px-2 py-0 text-[11px]"
                    />
                  </EditField>
                )}
                <EditField label="Last Mile Transporter" rowId={currentRow.id} fieldName="last_mile_transporter_id" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <ErpComboboxField
                    value={draft.last_mile_transporter_id ?? ""}
                    onChange={(value) => patchDraft("last_mile_transporter_id", value)}
                    options={transporterOptions}
                    blankLabel="Select last mile transporter"
                    placeholder="Select last mile transporter"
                    inputClassName="h-[26px] px-2 py-0 text-[11px]"
                  />
                </EditField>
                <EditField label="CHA" rowId={currentRow.id} fieldName="cha_id" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <ErpComboboxField
                    value={draft.cha_id ?? ""}
                    onChange={(value) => patchDraft("cha_id", value)}
                    options={chaOptions}
                    blankLabel="Select CHA"
                    placeholder="Select CHA"
                    inputClassName="h-[26px] px-2 py-0 text-[11px]"
                  />
                </EditField>
                <EditField label="CHA Name (if not listed)" rowId={currentRow.id} fieldName="cha_name_freetext" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <input
                    value={draft.cha_name_freetext ?? ""}
                    onChange={(event) => patchDraft("cha_name_freetext", event.target.value)}
                    disabled={Boolean(draft.cha_id)}
                    className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500 disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </EditField>
                <EditField label="LR Date" rowId={currentRow.id} fieldName="lr_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <input type="date" value={draft.lr_date ?? ""} onChange={(event) => patchDraft("lr_date", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                </EditField>
                <EditField label="LR Number" rowId={currentRow.id} fieldName="lr_number" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <input value={draft.lr_number ?? ""} onChange={(event) => patchDraft("lr_number", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                </EditField>
                <EditField label="Post-clearance LR Date" rowId={currentRow.id} fieldName="post_clearance_lr_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <input type="date" value={draft.post_clearance_lr_date ?? ""} onChange={(event) => patchDraft("post_clearance_lr_date", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                </EditField>
              </div>
            </TrackerSection>

            <TrackerSection eyebrow="Receiving" title="GE, GRN, LC, and completion tracking">
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                <EditField label="GE Number" rowId={currentRow.id} fieldName="gate_entry_id" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <div className="h-[26px] border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{currentRow.ge_number || "-"}</div>
                </EditField>
                <EditField label="GE Date" rowId={currentRow.id} fieldName="gate_entry_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <div className="h-[26px] border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{currentRow.gate_entry_date || "-"}</div>
                </EditField>
                <EditField label="GRN Number" rowId={currentRow.id} fieldName="grn_id" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <div className="h-[26px] border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{currentRow.grn_number || "-"}</div>
                </EditField>
                <EditField label="GRN Date" rowId={currentRow.id} fieldName="grn_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                  <div className="h-[26px] border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{currentRow.grn_date || "-"}</div>
                </EditField>
                {currentRow.csn_type === "IMPORT" ? (
                  <>
                    <EditField label="LC Number" rowId={currentRow.id} fieldName="lc_number" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                      <input value={draft.lc_number ?? ""} onChange={(event) => patchDraft("lc_number", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                    </EditField>
                    <EditField label="LC Opened Date" rowId={currentRow.id} fieldName="lc_opened_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                      <input type="date" value={draft.lc_opened_date ?? ""} onChange={(event) => patchDraft("lc_opened_date", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                    </EditField>
                  </>
                ) : null}
                {currentRow.csn_type === "IMPORT" ? (
                  <>
                    <EditField label="Soft Copy Received" rowId={currentRow.id} fieldName="soft_copy_received" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                      <select value={draft.soft_copy_received ? "YES" : "NO"} onChange={(event) => patchDraft("soft_copy_received", event.target.value === "YES")} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500">
                        {YES_NO_OPTIONS.map((option) => <option key={option.label} value={option.value ? "YES" : "NO"}>{option.label}</option>)}
                      </select>
                    </EditField>
                    <EditField label="Hard Copy Received" rowId={currentRow.id} fieldName="hard_copy_received" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                      <select value={draft.hard_copy_received ? "YES" : "NO"} onChange={(event) => patchDraft("hard_copy_received", event.target.value === "YES")} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500">
                        {YES_NO_OPTIONS.map((option) => <option key={option.label} value={option.value ? "YES" : "NO"}>{option.label}</option>)}
                      </select>
                    </EditField>
                  </>
                ) : null}
              </div>
            </TrackerSection>

            {currentRow.csn_type === "IMPORT" ? (
              <TrackerSection eyebrow="Courier And CHA" title="Hard-copy handoff and sub-CSN linkage">
                <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                  <EditField label="Courier Number" rowId={currentRow.id} fieldName="hard_copy_courier_number" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                    <input value={draft.hard_copy_courier_number ?? ""} onChange={(event) => patchDraft("hard_copy_courier_number", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                  </EditField>
                  <EditField label="Courier Dispatch Date" rowId={currentRow.id} fieldName="courier_dispatch_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                    <input type="date" value={draft.courier_dispatch_date ?? ""} onChange={(event) => patchDraft("courier_dispatch_date", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                  </EditField>
                  <EditField label="Courier Received Date" rowId={currentRow.id} fieldName="courier_received_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                    <input type="date" value={draft.courier_received_date ?? ""} onChange={(event) => patchDraft("courier_received_date", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                  </EditField>
                  <EditField label="Courier Date to CHA" rowId={currentRow.id} fieldName="courier_date_to_cha" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                    <input type="date" value={draft.courier_date_to_cha ?? ""} onChange={(event) => patchDraft("courier_date_to_cha", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                  </EditField>
                  <EditField label="Courier CHA Receive Date" rowId={currentRow.id} fieldName="courier_cha_receive_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                    <input type="date" value={draft.courier_cha_receive_date ?? ""} onChange={(event) => patchDraft("courier_cha_receive_date", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                  </EditField>
                  <EditField label="CHA Docket Number" rowId={currentRow.id} fieldName="cha_docket_number" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                    <input value={draft.cha_docket_number ?? ""} onChange={(event) => patchDraft("cha_docket_number", event.target.value)} className="h-[26px] border border-slate-300 bg-white px-2 text-[11px] outline-none focus:border-sky-500" />
                  </EditField>
                </div>
              </TrackerSection>
            ) : null}

            <TrackerSection eyebrow="Remarks" title="Final notes before saving">
              <EditField label="Remarks" rowId={currentRow.id} fieldName="remarks" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                <textarea value={draft.remarks ?? ""} onChange={(event) => patchDraft("remarks", event.target.value)} rows={2} className="min-h-[52px] border border-slate-300 bg-white px-2 py-1 text-[11px] outline-none focus:border-sky-500" />
              </EditField>
            </TrackerSection>

            <div className="grid gap-1 border border-slate-200 bg-white px-2 py-1.5 text-[10px] text-slate-600">
              <span className="font-semibold uppercase tracking-[0.12em] text-slate-500">Mother CSN</span>
              <span className="text-[11px] text-slate-800">
                {currentRow.mother_csn_display_number || "-"}
              </span>
            </div>
          </div>
        ) : (
          <p className="p-6 text-center text-sm text-slate-400">Loading...</p>
        )}
      </DrawerBase>

      <ErpColumnVisibilityDrawer
        visible={showColumns}
        columns={columns}
        visibleColumnKeys={visibleColumnKeys}
        onToggleColumn={(columnKey) => {
          setVisibleColumnKeys((current) => {
            if (current.includes(columnKey)) {
              const next = current.filter((key) => key !== columnKey);
              return next.length > 1 ? next : current;
            }
            return [...current, columnKey];
          });
        }}
        onResetColumns={() => setVisibleColumnKeys(columns.map((column) => column.key))}
        onClose={() => setShowColumns(false)}
      />

      <ModalBase
        visible={showSaveLayout}
        eyebrow="CSN Tracker"
        title="Save Layout"
        onEscape={() => setShowSaveLayout(false)}
        actions={
          <>
            <button type="button" onClick={() => setShowSaveLayout(false)} className="border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700">
              Cancel
            </button>
            <button type="button" onClick={() => void saveLayout()} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950">
              Save Layout
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Layout Name
            <input value={layoutDraft.name} onChange={(event) => setLayoutDraft((current) => ({ ...current, name: event.target.value }))} className="h-10 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Scope
            <select value={layoutDraft.scope} onChange={(event) => setLayoutDraft((current) => ({ ...current, scope: event.target.value }))} className="h-10 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500">
              <option value="USER">User-specific</option>
              <option value="GLOBAL">Global</option>
            </select>
          </label>
        </div>
      </ModalBase>

      <ModalBase
        visible={Boolean(dispatchDialog)}
        eyebrow="CSN Dispatch Balance"
        title={dispatchDialog?.mode === "reconcile" ? "Reconcile CSN Quantities" : "Balance Requires Action"}
        onEscape={() => setDispatchDialog(null)}
        width="min(760px, calc(100vw - 32px))"
        actions={
          <>
            <button type="button" onClick={() => setDispatchDialog(null)} className="border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700">
              Cancel
            </button>
            {dispatchDialog?.mode === "reconcile" ? (
              <button
                type="button"
                onClick={() =>
                  void saveExpandedRow(dispatchDialog.row, {
                    action: "RECONCILE",
                    allocations: dispatchDialog.allocations,
                    knock_off_qty: dispatchDialog.knock_off_qty,
                    reason: dispatchDialog.reason,
                  })
                }
                className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950"
              >
                Save Reconciliation
              </button>
            ) : null}
          </>
        }
      >
        {!dispatchDialog ? null : dispatchDialog.mode !== "reconcile" ? (
          <div className="grid gap-3">
            <div className="text-sm text-slate-700">
              Balance remaining: <strong>{dispatchDialog.preview?.remainder}</strong>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void saveExpandedRow(dispatchDialog.row, { action: "CREATE_CSN" })}
                className="border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-900"
              >
                Create CSN for Balance
              </button>
              {dispatchDialog?.preview?.can_reconcile ? (
                <button
                  type="button"
                  onClick={() =>
                    setDispatchDialog((current) => ({
                      ...current,
                      mode: "reconcile",
                    }))
                  }
                  className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800"
                >
                  Reallocate Existing CSNs
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void saveExpandedRow(dispatchDialog.row, { action: "KNOCK_OFF", reason: dispatchDialog.reason })}
                className="border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900"
              >
                Knock Off Balance
              </button>
            </div>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Knock-off Reason
              <input value={dispatchDialog.reason} onChange={(event) => setDispatchDialog((current) => ({ ...current, reason: event.target.value }))} className="h-10 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
            </label>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              {dispatchDialog.allocations.map((entry, index) => (
                <div key={entry.id} className="grid gap-2 border border-slate-200 bg-slate-50 px-3 py-3 md:grid-cols-[minmax(0,1fr)_180px] md:items-center">
                  <div className="text-sm font-medium text-slate-700">{entry.label}</div>
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={entry.qty}
                    onChange={(event) =>
                      setDispatchDialog((current) => ({
                        ...current,
                        allocations: current.allocations.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, qty: event.target.value } : row
                        ),
                      }))
                    }
                    className="h-10 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
                  />
                </div>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Knock Off Qty
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={dispatchDialog.knock_off_qty}
                  onChange={(event) => setDispatchDialog((current) => ({ ...current, knock_off_qty: event.target.value }))}
                  className="h-10 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
                />
              </label>
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Knock-off Reason
                <input
                  value={dispatchDialog.reason}
                  onChange={(event) => setDispatchDialog((current) => ({ ...current, reason: event.target.value }))}
                  className="h-10 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
                />
              </label>
            </div>
          </div>
        )}
      </ModalBase>
    </>
  );
}
