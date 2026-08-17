import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listLocationTransferRequests } from "../procurementApi.js";

const STATUS_OPTIONS = ["", "OPEN", "PARTIALLY_POSTED", "POSTED", "CANCELLED"];

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB");
}

export default function LocationTransferRequestListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [submittedFilters, setSubmittedFilters] = useState(null);
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  const requestQuery = useQuery({
    queryKey: ["procurement", "location-transfer-requests", submittedFilters],
    enabled: Boolean(submittedFilters?.company_id),
    queryFn: () => listLocationTransferRequests(submittedFilters),
    select: (result) => (Array.isArray(result?.items) ? result.items : []),
  });

  const rows = Array.isArray(requestQuery.data) ? requestQuery.data : [];

  const metrics = useMemo(() => ([
    { label: "Requests", value: rows.length, caption: "Matched by current criteria." },
    { label: "Open", value: rows.filter((row) => String(row.status).toUpperCase() === "OPEN").length, caption: "Still editable in IN10." },
    { label: "Partial", value: rows.filter((row) => String(row.status).toUpperCase() === "PARTIALLY_POSTED").length, caption: "Partially consumed in IN11." },
    { label: "Posted", value: rows.filter((row) => String(row.status).toUpperCase() === "POSTED").length, caption: "Fully moved and history-only." },
  ]), [rows]);

  function handleExecute() {
    setSubmittedFilters({
      company_id: effectiveCompanyId || "",
      status: status || undefined,
      search: search || undefined,
    });
  }

  function openCreate() {
    openScreen(OPERATION_SCREENS.PROC_LOC_TRANSFER_REQ_CREATE.screen_code);
    navigate("/dashboard/procurement/location-transfer/create");
  }

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_LOC_TRANSFER_REQ_DETAIL.screen_code, { context: { id: row.id } });
    navigate(`/dashboard/procurement/location-transfer/${encodeURIComponent(row.id)}`);
  }

  function openWorkbench(row) {
    openScreen(OPERATION_SCREENS.PROC_LOC_TRANSFER_POST.screen_code, { context: { request_id: row.id } });
    navigate(`/dashboard/procurement/location-transfer/post?request_id=${encodeURIComponent(row.id)}`);
  }

  return (
    <ErpScreenScaffold
      eyebrow="Inventory"
      title="Location Transfer Request Register"
      notices={[
        {
          key: "ltr-list-guide",
          tone: "info",
          message: "IN10 works like MB21/MB22: create or change the request here, then open IN11 to post or reverse the actual movement.",
        },
        ...(requestQuery.error instanceof Error
          ? [{ key: "ltr-list-error", tone: "error", message: requestQuery.error.message }]
          : []),
      ]}
      actions={[
        { key: "execute", label: requestQuery.isFetching ? "Executing..." : "Execute", tone: "primary", onClick: handleExecute, disabled: !effectiveCompanyId },
        { key: "create", label: "Create IN10", tone: "primary", onClick: openCreate },
      ]}
    >
      <div className="grid gap-4">
        <div className="grid gap-4 xl:grid-cols-4">
          <ErpFieldPreview label="Transaction" value="IN10" tone="sky" />
          <ErpFieldPreview label="Company Scope" value={effectiveCompanyId ? "Selected" : "Required"} />
          <ErpFieldPreview label="Posting Partner" value="IN11 / MIGO-style" />
          <ErpFieldPreview label="Business Rule" value="No approval; reserve first, move later." />
        </div>

        <ErpSectionCard eyebrow="Selection Screen" title="Choose Criteria, Then Execute">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="xl:col-span-2">
              <TransactionCompanySelector
                runtimeContext={runtimeContext}
                value={companyId}
                onChange={setCompanyId}
                label="Company"
              />
            </div>
            <ErpDenseFormRow label="Status">
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                {STATUS_OPTIONS.map((entry) => (
                  <option key={entry || "ALL"} value={entry}>{entry || "ALL"}</option>
                ))}
              </select>
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Request Number">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="LTR number"
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
          </div>
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Register" title="IN10 Request Output">
          <div className="grid gap-3">
            <div className="grid gap-3 xl:grid-cols-4">
              {metrics.map((metric) => (
                <div key={metric.label} className="rounded border border-slate-200 bg-white px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{metric.label}</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">{metric.value}</div>
                  <div className="mt-1 text-sm text-slate-500">{metric.caption}</div>
                </div>
              ))}
            </div>
            <ErpDenseGrid
              columns={[
                { key: "ltr_number", label: "Request #", width: "140px" },
                { key: "status", label: "Status", width: "150px" },
                { key: "request_date", label: "Request Date", width: "120px", render: (row) => formatDate(row.request_date) },
                { key: "required_by_date", label: "Required By", width: "120px", render: (row) => formatDate(row.required_by_date) },
                { key: "remarks", label: "Remarks", width: "280px", render: (row) => row.remarks || "—" },
                {
                  key: "go_post",
                  label: "IN11",
                  width: "120px",
                  render: (row) => (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openWorkbench(row);
                      }}
                      className="border border-slate-300 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700 hover:border-sky-500 hover:text-sky-700"
                    >
                      Open IN11
                    </button>
                  ),
                },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
              onRowActivate={openDetail}
              getRowProps={(row) => ({
                onDoubleClick: () => openDetail(row),
                className: "cursor-pointer hover:bg-sky-50",
              })}
              emptyMessage={submittedFilters ? "No location transfer requests found." : "Choose criteria and click Execute."}
              maxHeight="calc(100vh - 380px)"
            />
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
