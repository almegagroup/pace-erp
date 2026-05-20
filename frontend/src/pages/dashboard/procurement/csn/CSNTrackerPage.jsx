import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { getAllAlertCounts, getCSNTracker, inlineUpdateCSN } from "../procurementApi.js";

const LIMIT = 50;
const EDITABLE_STATUSES = new Set(["ORDERED", "IN_TRANSIT"]);

function getBadgeTone(value) {
  switch (String(value || "").toUpperCase()) {
    case "IMPORT":
      return "bg-sky-100 text-sky-800";
    case "DOMESTIC":
      return "bg-emerald-100 text-emerald-800";
    case "BULK":
      return "bg-violet-100 text-violet-800";
    case "ARRIVED":
      return "bg-emerald-100 text-emerald-800";
    case "GRN_DONE":
    case "CLOSED":
      return "bg-slate-200 text-slate-700";
    case "IN_TRANSIT":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function inputTypeForField(field) {
  return field.includes("eta") || field.includes("etd") ? "date" : "text";
}

export default function CSNTrackerPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ lc_alert: 0, vessel_booking_alert: 0 });
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [csnType, setCsnType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [savingInline, setSavingInline] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const companyOptions = useMemo(
    () =>
      (runtimeContext?.availableCompanies ?? []).map((entry) => ({
        value: entry.id,
        label: entry.company_name || entry.company_code || entry.id,
      })),
    [runtimeContext?.availableCompanies]
  );

  useEffect(() => {
    if (!companyId) {
      setCompanyId(runtimeContext?.selectedCompanyId || companyOptions[0]?.value || "");
    }
  }, [companyId, companyOptions, runtimeContext?.selectedCompanyId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim().toLowerCase());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  async function loadTracker() {
    if (!companyId) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [trackerData, alertCounts] = await Promise.all([
        getCSNTracker({
          company_id: companyId,
          status: status || undefined,
          csn_type: csnType || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          limit: LIMIT,
          offset: (page - 1) * LIMIT,
        }),
        getAllAlertCounts({ company_id: companyId }),
      ]);
      setRows(Array.isArray(trackerData?.data) ? trackerData.data : []);
      setTotal(Number(trackerData?.total ?? 0));
      setCounts({
        lc_alert: Number(alertCounts?.lc_alert ?? 0),
        vessel_booking_alert: Number(alertCounts?.vessel_booking_alert ?? 0),
      });
    } catch (loadError) {
      setRows([]);
      setTotal(0);
      setCounts({ lc_alert: 0, vessel_booking_alert: 0 });
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_CSN_TRACKER_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTracker();
  }, [companyId, csnType, dateFrom, dateTo, page, status]);

  const filteredRows = useMemo(() => {
    if (!debouncedSearch) {
      return rows;
    }
    return rows.filter((row) =>
      [row.csn_number, row.po_number, row.vendor_name, row.material_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(debouncedSearch)
    );
  }, [debouncedSearch, rows]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / LIMIT)), [total]);
  const startIndex = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(page * LIMIT, total);

  function beginInlineEdit(row, field) {
    if (!EDITABLE_STATUSES.has(String(row.status || "").toUpperCase())) {
      return;
    }
    setEditing({
      rowId: row.id,
      field,
      value: String(row[field] ?? ""),
    });
    setNotice("");
    setError("");
  }

  async function saveInlineEdit() {
    if (!editing || !companyId) {
      return;
    }
    setSavingInline(true);
    setError("");
    setNotice("");
    try {
      const updated = await inlineUpdateCSN(editing.rowId, {
        company_id: companyId,
        field: editing.field,
        value: editing.value,
      });
      setRows((current) =>
        current.map((row) => (row.id === editing.rowId ? { ...row, ...updated } : row))
      );
      setEditing(null);
      setNotice("Tracker cell updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_CSN_INLINE_UPDATE_FAILED");
    } finally {
      setSavingInline(false);
    }
  }

  function renderInlineCell(row, field, displayKey = field) {
    const editable = EDITABLE_STATUSES.has(String(row.status || "").toUpperCase());
    const isEditing = editing?.rowId === row.id && editing?.field === field;
    const displayValue = row[displayKey] ?? row[field] ?? "—";

    if (isEditing) {
      return (
        <div className="flex items-center gap-1">
          <input
            type={inputTypeForField(field)}
            value={editing.value}
            onChange={(event) =>
              setEditing((current) => (current ? { ...current, value: event.target.value } : current))
            }
            className="h-7 w-full min-w-0 border border-sky-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500"
          />
          <button
            type="button"
            onClick={() => void saveInlineEdit()}
            disabled={savingInline}
            className="border border-sky-300 bg-sky-50 px-2 py-[2px] text-[10px] font-semibold text-sky-900 disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(null)}
            className="border border-slate-300 bg-white px-2 py-[2px] text-[10px] font-semibold text-slate-700"
          >
            Cancel
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        disabled={!editable}
        onClick={() => beginInlineEdit(row, field)}
        className={`w-full text-left ${editable ? "cursor-pointer text-sky-700 underline underline-offset-2" : "cursor-default text-slate-500 no-underline"}`}
      >
        {displayValue || "—"}
      </button>
    );
  }

  function openAlerts(tab) {
    openScreen(OPERATION_SCREENS.PROC_CSN_ALERTS.screen_code);
    navigate(`/dashboard/procurement/csn-alerts?tab=${encodeURIComponent(tab)}`);
  }

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_CSN_DETAIL.screen_code);
    navigate(`/dashboard/procurement/csns/${encodeURIComponent(row.id)}`);
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Consignment Tracker"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void loadTracker(),
        },
      ]}
      notices={[
        ...(error ? [{ key: "csn-tracker-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "csn-tracker-notice", tone: "success", message: notice }] : []),
      ]}
      filterSection={{
        eyebrow: "Tracker Alerts",
        title: "Arrival, LC, and vessel readiness",
        children: (
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openAlerts("lc")}
                className="inline-flex items-center gap-2 border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900"
              >
                LC Alerts: {counts.lc_alert}
              </button>
              <button
                type="button"
                onClick={() => openAlerts("vessel")}
                className="inline-flex items-center gap-2 border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900"
              >
                Vessel Booking: {counts.vessel_booking_alert}
              </button>
            </div>

            <div className="grid gap-3 xl:grid-cols-[220px_180px_180px_170px_170px_minmax(0,1fr)]">
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Company
                <select
                  value={companyId}
                  onChange={(event) => {
                    setCompanyId(event.target.value);
                    setPage(1);
                  }}
                  className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">Select company</option>
                  {companyOptions.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Status
                <select
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setPage(1);
                  }}
                  className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">ALL</option>
                  {["ORDERED", "IN_TRANSIT", "ARRIVED", "GRN_DONE", "CLOSED"].map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
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
                  className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">ALL</option>
                  {["IMPORT", "DOMESTIC", "BULK"].map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Date From
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => {
                    setDateFrom(event.target.value);
                    setPage(1);
                  }}
                  className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
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
                  className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </label>

              <QuickFilterInput
                label="Search"
                value={search}
                onChange={setSearch}
                placeholder="CSN, vendor, material, PO"
              />
            </div>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "Tracker Grid",
        title: loading ? "Loading consignment tracker" : `${total} CSN row${total === 1 ? "" : "s"}`,
        children: (
          <div className="grid gap-3">
            <ErpPaginationStrip
              page={page}
              setPage={setPage}
              totalPages={totalPages}
              startIndex={startIndex}
              endIndex={endIndex}
              totalItems={total}
            />
            <ErpDenseGrid
              columns={[
                { key: "csn_number", label: "CSN", width: "140px" },
                { key: "po_number", label: "PO", width: "120px" },
                { key: "vendor_name", label: "Vendor", width: "160px" },
                { key: "material_name", label: "Material", width: "160px" },
                {
                  key: "csn_type",
                  label: "Type",
                  width: "110px",
                  render: (row) => (
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${getBadgeTone(row.csn_type)}`}>
                      {row.csn_type || "—"}
                    </span>
                  ),
                },
                {
                  key: "status",
                  label: "Status",
                  width: "120px",
                  render: (row) => (
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${getBadgeTone(row.status)}`}>
                      {row.status || "—"}
                    </span>
                  ),
                },
                { key: "dispatch_qty", label: "Qty", width: "90px" },
                {
                  key: "etd_origin",
                  label: "ETD Origin",
                  width: "120px",
                  render: (row) => renderInlineCell(row, "etd"),
                },
                {
                  key: "eta_plant",
                  label: "ETA Plant",
                  width: "120px",
                  render: (row) => row.eta_plant || "—",
                },
                {
                  key: "eta_at_port",
                  label: "Port ETA",
                  width: "120px",
                  render: (row) => renderInlineCell(row, "eta_at_port"),
                },
                {
                  key: "actual_arrival_date",
                  label: "Actual Arrival",
                  width: "130px",
                  render: (row) => row.actual_arrival_date || "—",
                },
                {
                  key: "lr_number",
                  label: "LR Number",
                  width: "140px",
                  render: (row) => renderInlineCell(row, "lr_number"),
                },
                {
                  key: "transporter_name",
                  label: "Transporter",
                  width: "150px",
                  render: (row) => renderInlineCell(row, "transporter_id", "transporter_name"),
                },
              ]}
              rows={filteredRows}
              rowKey={(row) => row.id}
              onRowActivate={openDetail}
              getRowProps={(row) => ({
                onDoubleClick: () => openDetail(row),
                className: "cursor-pointer hover:bg-sky-50",
              })}
              emptyMessage={loading ? "Loading consignment tracker..." : "No CSNs matched the current filter."}
            />
          </div>
        ),
      }}
    />
  );
}
