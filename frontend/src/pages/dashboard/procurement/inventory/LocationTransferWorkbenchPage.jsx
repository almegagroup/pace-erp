import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  getLocationTransferWorkbench,
  getLocationTransferWorkbenchByNumber,
  postLocationTransfer,
  reverseLocationTransferPosting,
} from "../procurementApi.js";

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-GB");
}

function formatNumber(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toFixed(3) : "0.000";
}

export default function LocationTransferWorkbenchPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [searchParams, setSearchParams] = useSearchParams();
  const [companyId, setCompanyId] = useState(() => resolveDefaultTransactionCompanyId(runtimeContext));
  const [requestNumberInput, setRequestNumberInput] = useState(searchParams.get("request_number") || "");
  const [requestIdInput, setRequestIdInput] = useState(searchParams.get("request_id") || "");
  const [submittedLookup, setSubmittedLookup] = useState(
    searchParams.get("request_id")
      ? { request_id: searchParams.get("request_id"), request_number: "", company_id: "" }
      : searchParams.get("request_number")
        ? { request_id: "", request_number: searchParams.get("request_number"), company_id: resolveDefaultTransactionCompanyId(runtimeContext) }
        : null,
  );
  const [postingQtyByLine, setPostingQtyByLine] = useState({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const workbenchQuery = useQuery({
    queryKey: ["procurement", "location-transfer-workbench", submittedLookup],
    enabled: Boolean(submittedLookup?.request_id || (submittedLookup?.request_number && submittedLookup?.company_id)),
    queryFn: () => {
      if (submittedLookup?.request_id) {
        return getLocationTransferWorkbench(submittedLookup.request_id);
      }
      return getLocationTransferWorkbenchByNumber({
        company_id: submittedLookup?.company_id,
        request_number: submittedLookup?.request_number,
      });
    },
  });

  useEffect(() => {
    const lines = Array.isArray(workbenchQuery.data?.lines) ? workbenchQuery.data.lines : [];
    setPostingQtyByLine(Object.fromEntries(lines.map((line) => [line.id, String(line.open_qty ?? "")])));
  }, [workbenchQuery.data]);

  const openLines = useMemo(
    () => (Array.isArray(workbenchQuery.data?.lines) ? workbenchQuery.data.lines.filter((line) => Number(line.open_qty) > 0) : []),
    [workbenchQuery.data],
  );

  function handleExecute() {
    const nextLookup = requestIdInput
      ? { request_id: requestIdInput, request_number: "", company_id: "" }
      : { request_id: "", request_number: requestNumberInput, company_id: companyId };
    setSubmittedLookup(nextLookup);
    setSearchParams(
      requestIdInput
        ? { request_id: requestIdInput }
        : requestNumberInput
          ? { request_number: requestNumberInput, company_id: companyId }
          : {},
    );
  }

  async function handlePost() {
    setError("");
    setNotice("");
    try {
      const lines = openLines
        .map((line) => ({
          request_line_id: line.id,
          quantity: Number(postingQtyByLine[line.id] || 0),
        }))
        .filter((line) => line.quantity > 0);
      if (lines.length === 0) {
        setError("Enter at least one posting quantity above zero.");
        return;
      }
      await postLocationTransfer({ request_id: workbenchQuery.data.id, lines });
      setNotice("IN11 posting completed.");
      await workbenchQuery.refetch();
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : "Posting failed.");
    }
  }

  async function handleReverse(postingId) {
    setError("");
    setNotice("");
    try {
      await reverseLocationTransferPosting(postingId, "Reversed from IN11 workbench");
      setNotice("Posting reversed.");
      await workbenchQuery.refetch();
    } catch (reverseError) {
      setError(reverseError instanceof Error ? reverseError.message : "Reverse failed.");
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Inventory"
      title="Goods Movement Workbench / IN11"
      notices={[
        {
          key: "ltr-post-guide",
          tone: "info",
          message: "IN11 follows MIGO logic: choose the company, load the IN10 request by business number, then post only the open quantity.",
        },
        ...(notice ? [{ key: "ltr-post-notice", tone: "success", message: notice }] : []),
        ...(error ? [{ key: "ltr-post-error", tone: "error", message: error }] : []),
        ...(workbenchQuery.error instanceof Error ? [{ key: "ltr-post-query-error", tone: "error", message: workbenchQuery.error.message }] : []),
      ]}
      actions={[
        {
          key: "back",
          label: "Back To IN10",
          tone: "neutral",
          onClick: () => {
            openScreen(OPERATION_SCREENS.PROC_LOC_TRANSFER_REQ.screen_code);
            navigate("/dashboard/procurement/location-transfer");
          },
        },
        {
          key: "execute",
          label: workbenchQuery.isFetching ? "Loading..." : "Load Request",
          tone: "primary",
          onClick: handleExecute,
          disabled: !(requestIdInput || (companyId && requestNumberInput)),
        },
        {
          key: "post",
          label: "Post P311",
          tone: "primary",
          onClick: () => void handlePost(),
          disabled: openLines.length === 0,
        },
      ]}
    >
      <div className="grid gap-4">
        <div className="grid gap-4 xl:grid-cols-4">
          <ErpFieldPreview label="Transaction" value="IN11" tone="sky" />
          <ErpFieldPreview label="Loaded Request" value={workbenchQuery.data?.ltr_number || "—"} />
          <ErpFieldPreview label="Status" value={workbenchQuery.data?.status || "Selection"} />
          <ErpFieldPreview label="Open Lines" value={`${openLines.length}`} caption={openLines.length > 0 ? "Ready for P311." : "No open quantity left."} />
        </div>

        <ErpSectionCard eyebrow="Page 1" title="Reference Selection">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="xl:col-span-2">
              <TransactionCompanySelector
                runtimeContext={runtimeContext}
                value={companyId}
                onChange={setCompanyId}
                label="Company"
              />
            </div>
            <ErpDenseFormRow label="Request Number">
              <input
                value={requestNumberInput}
                onChange={(event) => setRequestNumberInput(event.target.value)}
                placeholder="LTR business number"
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Direct Request ID">
              <input
                value={requestIdInput}
                onChange={(event) => setRequestIdInput(event.target.value)}
                placeholder="optional technical id"
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
          </div>
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Page 2" title="Open Quantities For P311">
          <ErpDenseGrid
            columns={[
              { key: "line_no", label: "Line", width: "70px" },
              { key: "material_label", label: "Material", width: "260px" },
              { key: "source_storage_location", label: "Source", width: "180px", render: (row) => row.source_storage_location?.label || "—" },
              { key: "target_storage_location", label: "Target", width: "180px", render: (row) => row.target_storage_location?.label || "—" },
              { key: "requested_qty", label: "Requested", width: "100px", render: (row) => formatNumber(row.requested_qty) },
              { key: "posted_qty", label: "Posted", width: "100px", render: (row) => formatNumber(row.posted_qty) },
              { key: "open_qty", label: "Open", width: "100px", render: (row) => formatNumber(row.open_qty) },
              { key: "available_qty", label: "Avail.", width: "100px", render: (row) => formatNumber(row.available_qty) },
              {
                key: "post_qty",
                label: "Post Qty",
                width: "120px",
                render: (row) => (
                  <input
                    value={postingQtyByLine[row.id] || ""}
                    onChange={(event) => setPostingQtyByLine((current) => ({ ...current, [row.id]: event.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900"
                  />
                ),
              },
            ]}
            rows={openLines}
            rowKey={(row) => row.id}
            emptyMessage={submittedLookup ? "No open lines remain for posting." : "Load a request first."}
            maxHeight="calc(100vh - 390px)"
          />
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Page 3" title="Posting History / P311 / P312">
          <ErpDenseGrid
            columns={[
              { key: "movement_type_code", label: "MvT", width: "80px" },
              { key: "posted_qty", label: "Qty", width: "100px", render: (row) => formatNumber(row.posted_qty) },
              { key: "material_doc_number", label: "Material Doc", width: "150px" },
              { key: "material_doc_year", label: "Year", width: "120px" },
              { key: "posted_by_label", label: "Posted By", width: "200px", render: (row) => row.posted_by_label || "—" },
              { key: "posted_at", label: "Posted At", width: "170px", render: (row) => formatDateTime(row.posted_at) },
              {
                key: "reverse",
                label: "Reverse",
                width: "120px",
                render: (row) => String(row.movement_type_code).toUpperCase() !== "P311" || row.reversal_of_posting_id ? "—" : (
                  <button
                    type="button"
                    onClick={() => void handleReverse(row.id)}
                    className="border border-rose-300 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-700"
                  >
                    Reverse
                  </button>
                ),
              },
            ]}
            rows={Array.isArray(workbenchQuery.data?.postings) ? workbenchQuery.data.postings : []}
            rowKey={(row) => row.id}
            emptyMessage="No posting history yet."
            maxHeight="320px"
          />
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
