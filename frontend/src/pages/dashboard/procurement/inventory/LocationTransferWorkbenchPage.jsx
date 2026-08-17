import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  getLocationTransferWorkbench,
  getLocationTransferWorkbenchByNumber,
  postLocationTransfer,
  reverseLocationTransferPosting,
} from "../procurementApi.js";

const ACTIONS = [
  { value: "post", label: "Post Transfer" },
  { value: "reverse", label: "Reverse Transfer" },
  { value: "display", label: "Display History" },
];
const DETAIL_TABS = [
  { value: "qty", label: "Quantity" },
  { value: "where", label: "Where" },
  { value: "avail", label: "Availability" },
];

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-GB");
}

function formatNumber(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toFixed(3) : "0.000";
}

function PostWorkspace({ requestId, openLines, onPosted }) {
  const [postingQtyByLine, setPostingQtyByLine] = useState(
    () => Object.fromEntries(openLines.map((line) => [line.id, String(line.open_qty ?? "")])),
  );
  const [okByLine, setOkByLine] = useState(() => Object.fromEntries(openLines.map((line) => [line.id, true])));
  const [selectedLineId, setSelectedLineId] = useState(() => openLines[0]?.id ?? "");
  const [detailTab, setDetailTab] = useState("qty");
  const [checkResult, setCheckResult] = useState(null);
  const [error, setError] = useState("");
  const [posting, setPosting] = useState(false);

  const selectedLine = openLines.find((line) => line.id === selectedLineId) ?? null;

  function handleCheck() {
    let ready = 0;
    let skipped = 0;
    for (const line of openLines) {
      const qty = Number(postingQtyByLine[line.id] || 0);
      if (!okByLine[line.id] || qty <= 0 || qty > Number(line.available_qty ?? 0) + 0.000001) {
        skipped += 1;
      } else {
        ready += 1;
      }
    }
    setCheckResult({ ready, skipped });
  }

  async function handlePost() {
    setError("");
    setPosting(true);
    try {
      const postLines = openLines
        .filter((line) => okByLine[line.id])
        .map((line) => ({ request_line_id: line.id, quantity: Number(postingQtyByLine[line.id] || 0) }))
        .filter((line) => line.quantity > 0);
      if (postLines.length === 0) {
        setError("Tick at least one line with a post quantity above zero.");
        return;
      }
      await postLocationTransfer({ request_id: requestId, lines: postLines });
      setCheckResult(null);
      await onPosted();
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : "Posting failed.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <>
      <ErpSectionCard eyebrow="Post" title="Open quantities">
        <ErpDenseGrid
          columns={[
            {
              key: "ok",
              label: "OK",
              width: "50px",
              render: (row) => (
                <input
                  type="checkbox"
                  checked={Boolean(okByLine[row.id])}
                  onChange={(event) => setOkByLine((current) => ({ ...current, [row.id]: event.target.checked }))}
                />
              ),
            },
            { key: "material_label", label: "Material", width: "240px" },
            { key: "source_storage_location", label: "Source", width: "160px", render: (row) => row.source_storage_location?.label || "—" },
            { key: "target_storage_location", label: "Target", width: "160px", render: (row) => row.target_storage_location?.label || "—" },
            { key: "requested_qty", label: "Requested", width: "90px", render: (row) => formatNumber(row.requested_qty) },
            { key: "open_qty", label: "Open", width: "90px", render: (row) => formatNumber(row.open_qty) },
            {
              key: "post_qty",
              label: "Post Qty",
              width: "110px",
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
          onRowActivate={(row) => { setSelectedLineId(row.id); setDetailTab("qty"); }}
          getRowProps={(row) => ({
            onClick: () => setSelectedLineId(row.id),
            className: `cursor-pointer ${row.id === selectedLineId ? "bg-sky-50" : ""}`,
          })}
          emptyMessage="No open lines remain for posting."
          maxHeight="calc(100vh - 560px)"
        />
      </ErpSectionCard>

      {selectedLine ? (
        <ErpSectionCard eyebrow="Detail" title={selectedLine.material_label}>
          <div className="mb-3 flex gap-1.5">
            {DETAIL_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setDetailTab(tab.value)}
                className={`h-7 border px-3 text-[11px] font-semibold uppercase tracking-[0.1em] ${
                  detailTab === tab.value ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-300 text-slate-600"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {detailTab === "qty" ? (
            <div className="grid gap-3 xl:grid-cols-4">
              <div><div className="text-[11px] text-slate-500">Requested</div><div className="text-sm font-semibold">{formatNumber(selectedLine.requested_qty)}</div></div>
              <div><div className="text-[11px] text-slate-500">Posted</div><div className="text-sm font-semibold">{formatNumber(selectedLine.posted_qty)}</div></div>
              <div><div className="text-[11px] text-slate-500">Open</div><div className="text-sm font-semibold">{formatNumber(selectedLine.open_qty)}</div></div>
              <div><div className="text-[11px] text-slate-500">Post qty</div><div className="text-sm font-semibold">{postingQtyByLine[selectedLine.id] || "0"}</div></div>
            </div>
          ) : detailTab === "where" ? (
            <div className="grid gap-3 xl:grid-cols-4">
              <div><div className="text-[11px] text-slate-500">Source SLoc</div><div className="text-sm">{selectedLine.source_storage_location?.label || "—"}</div></div>
              <div><div className="text-[11px] text-slate-500">Target SLoc</div><div className="text-sm">{selectedLine.target_storage_location?.label || "—"}</div></div>
              <div><div className="text-[11px] text-slate-500">Batch</div><div className="text-sm">{selectedLine.batch_number || "—"}</div></div>
              <div><div className="text-[11px] text-slate-500">Source lot ref</div><div className="text-sm">{selectedLine.source_lot_ref || "—"}</div></div>
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-3">
              <div><div className="text-[11px] text-slate-500">Live stock at source</div><div className="text-sm font-semibold">{formatNumber(selectedLine.live_qty)}</div></div>
              <div><div className="text-[11px] text-slate-500">Reserved by others</div><div className="text-sm">{formatNumber(selectedLine.reserved_other_qty)}</div></div>
              <div><div className="text-[11px] text-slate-500">Available now</div><div className="text-sm font-semibold text-emerald-700">{formatNumber(selectedLine.available_qty)}</div></div>
            </div>
          )}
        </ErpSectionCard>
      ) : null}

      <ErpSectionCard eyebrow="Commit" title="Check then post">
        {error ? <div className="mb-3 text-xs font-semibold text-rose-700">{error}</div> : null}
        {checkResult ? (
          <div className={`mb-3 text-xs font-semibold ${checkResult.skipped > 0 ? "text-amber-700" : "text-emerald-700"}`}>
            Check: {checkResult.ready} line(s) ready to post, {checkResult.skipped} skipped (unticked, zero qty, or over available).
          </div>
        ) : null}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCheck}
            className="h-8 border border-slate-300 bg-white px-4 text-xs font-semibold uppercase tracking-[0.12em] text-slate-700"
          >
            Check
          </button>
          <button
            type="button"
            onClick={() => void handlePost()}
            disabled={posting || openLines.length === 0}
            className="h-8 border border-sky-700 bg-sky-100 px-4 text-xs font-semibold uppercase tracking-[0.12em] text-sky-950 disabled:opacity-50"
          >
            {posting ? "Posting..." : "Post P311"}
          </button>
        </div>
      </ErpSectionCard>
    </>
  );
}

export default function LocationTransferWorkbenchPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [searchParams, setSearchParams] = useSearchParams();
  const [action, setAction] = useState("post");
  const [companyId, setCompanyId] = useState(() => resolveDefaultTransactionCompanyId(runtimeContext));
  const [numberInput, setNumberInput] = useState(searchParams.get("request_number") || "");
  const [submittedLookup, setSubmittedLookup] = useState(
    searchParams.get("request_id")
      ? { request_id: searchParams.get("request_id"), request_number: "", company_id: "" }
      : null,
  );
  const [refetchNonce, setRefetchNonce] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

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

  const openLines = useMemo(() => {
    const lines = Array.isArray(workbenchQuery.data?.lines) ? workbenchQuery.data.lines : [];
    return lines.filter((line) => Number(line.open_qty) > 0);
  }, [workbenchQuery.data]);
  const postings = Array.isArray(workbenchQuery.data?.postings) ? workbenchQuery.data.postings : [];
  const reversablePostings = postings.filter((row) => String(row.movement_type_code).toUpperCase() === "P311" && !row.reversal_of_posting_id);
  const loaded = Boolean(workbenchQuery.data?.id);

  function handleLoad() {
    setError("");
    setNotice("");
    const nextLookup = { request_id: "", request_number: numberInput, company_id: companyId };
    setSubmittedLookup(nextLookup);
    setSearchParams(numberInput ? { request_number: numberInput, company_id: companyId } : {});
  }

  function handleNumberKeyDown(event) {
    if (event.key === "Enter" && numberInput.trim() && companyId) {
      handleLoad();
    }
  }

  async function handlePosted() {
    setNotice("IN11 posting completed.");
    await workbenchQuery.refetch();
    setRefetchNonce((current) => current + 1);
  }

  async function handleReverse(postingId) {
    setError("");
    setNotice("");
    try {
      await reverseLocationTransferPosting(postingId, "Reversed from IN11 workbench");
      setNotice("Posting reversed.");
      await workbenchQuery.refetch();
      setRefetchNonce((current) => current + 1);
    } catch (reverseError) {
      setError(reverseError instanceof Error ? reverseError.message : "Reverse failed.");
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Inventory"
      title="Goods Movement Workbench / IN11"
      notices={[
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
      ]}
    >
      <div className="grid gap-3">
        <ErpSectionCard eyebrow="Reference" title="Load a request">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ErpDenseFormRow label="Action">
              <select
                value={action}
                onChange={(event) => setAction(event.target.value)}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                {ACTIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
              </select>
            </ErpDenseFormRow>
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={setCompanyId}
              label="Company"
            />
            <div className="xl:col-span-2">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Reservation / Request Number
                <input
                  value={numberInput}
                  onChange={(event) => setNumberInput(event.target.value)}
                  onKeyDown={handleNumberKeyDown}
                  autoFocus
                  placeholder="LTR-0000000005 — press Enter to load"
                  className="h-11 w-full border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none focus:border-sky-500"
                />
              </label>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={handleLoad}
              disabled={!numberInput.trim() || !companyId}
              className="h-8 border border-sky-700 bg-sky-100 px-4 text-xs font-semibold uppercase tracking-[0.12em] text-sky-950 disabled:opacity-50"
            >
              {workbenchQuery.isFetching ? "Loading..." : "Load"}
            </button>
            {loaded ? (
              <span className="flex items-center gap-2 text-xs text-emerald-700">
                <span className="font-semibold">{workbenchQuery.data.ltr_number}</span>
                <span className="text-slate-500">{workbenchQuery.data.status} · {openLines.length} open line(s)</span>
              </span>
            ) : null}
          </div>
        </ErpSectionCard>

        {!loaded ? null : action === "display" ? (
          <ErpSectionCard eyebrow="Display" title="Posting history">
            <ErpDenseGrid
              columns={[
                { key: "movement_type_code", label: "MvT", width: "80px" },
                { key: "posted_qty", label: "Qty", width: "100px", render: (row) => formatNumber(row.posted_qty) },
                { key: "material_doc_number", label: "Material Doc", width: "150px" },
                { key: "material_doc_year", label: "Year", width: "100px" },
                { key: "posted_by_label", label: "Posted By", width: "200px", render: (row) => row.posted_by_label || "—" },
                { key: "posted_at", label: "Posted At", width: "170px", render: (row) => formatDateTime(row.posted_at) },
              ]}
              rows={postings}
              rowKey={(row) => row.id}
              emptyMessage="No posting history yet."
              maxHeight="calc(100vh - 420px)"
            />
          </ErpSectionCard>
        ) : action === "reverse" ? (
          <ErpSectionCard eyebrow="Reverse" title="Select a posting to reverse">
            <ErpDenseGrid
              columns={[
                { key: "movement_type_code", label: "MvT", width: "80px" },
                { key: "posted_qty", label: "Qty", width: "100px", render: (row) => formatNumber(row.posted_qty) },
                { key: "material_doc_number", label: "Material Doc", width: "150px" },
                { key: "material_doc_year", label: "Year", width: "100px" },
                { key: "posted_by_label", label: "Posted By", width: "200px", render: (row) => row.posted_by_label || "—" },
                { key: "posted_at", label: "Posted At", width: "170px", render: (row) => formatDateTime(row.posted_at) },
                {
                  key: "reverse",
                  label: "Action",
                  width: "110px",
                  render: (row) => (reversablePostings.some((entry) => entry.id === row.id) ? (
                    <button
                      type="button"
                      onClick={() => void handleReverse(row.id)}
                      className="border border-rose-300 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-700"
                    >
                      Reverse P312
                    </button>
                  ) : <span className="text-slate-400">—</span>),
                },
              ]}
              rows={postings}
              rowKey={(row) => row.id}
              emptyMessage="No postings to reverse."
              maxHeight="calc(100vh - 420px)"
            />
          </ErpSectionCard>
        ) : (
          <PostWorkspace
            key={`${workbenchQuery.data.id}-${refetchNonce}`}
            requestId={workbenchQuery.data.id}
            openLines={openLines}
            onPosted={handlePosted}
          />
        )}
      </div>
    </ErpScreenScaffold>
  );
}
