import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import UomQuantityInput from "../../../../components/forms/UomQuantityInput.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { MASTER_PICKER_FETCH_LIMIT, useMaterialOptionsQuery, useStorageLocationOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  cancelLocationTransferRequest,
  createLocationTransferRequest,
  getLocationTransferRequest,
  listMaterialUomConversionsForProcurement,
  previewLocationTransferAvailability,
  updateLocationTransferRequest,
} from "../procurementApi.js";

const STOCK_TYPES = ["UNRESTRICTED", "QUALITY_INSPECTION", "BLOCKED"];

function createDraftLine() {
  return {
    client_row_id: `ROW-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    id: "",
    source_storage_location_id: "",
    target_storage_location_id: "",
    material_id: "",
    requested_qty: "",
    uom_code: "KG",
    stock_type_code: "UNRESTRICTED",
    batch_number: "",
    source_lot_ref: "",
    remarks: "",
    posted_qty: 0,
    status: "OPEN",
  };
}

function formatNumber(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toFixed(3) : "0.000";
}

// Same reusable multi-UoM entry as IN05/MI04 (§110) -- user types in whichever
// unit they think in (dispatch/pack), this converts to base UoM and only the
// base-UoM qty ever reaches line state. Its own useQuery needs a real
// component (not a bare render callback) to stay hook-rules-legal per row.
function RequestedQtyCell({ row, isShort, onChange }) {
  const conversionsQuery = useQuery({
    queryKey: ["procurement", "ltr-material-uom-conversions", row.material_id],
    queryFn: () => listMaterialUomConversionsForProcurement(row.material_id),
    enabled: Boolean(row.material_id),
  });
  return (
    <UomQuantityInput
      key={row.material_id}
      baseUomCode={row.uom_code || "KG"}
      conversions={Array.isArray(conversionsQuery.data?.data) ? conversionsQuery.data.data : []}
      value={row.requested_qty !== "" ? Number(row.requested_qty) : undefined}
      onChange={(baseQty) => onChange(baseQty != null ? String(baseQty) : "")}
      className={isShort ? "border border-rose-400 bg-rose-50 px-1" : ""}
    />
  );
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-GB");
}

export default function LocationTransferRequestWorkspacePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const { runtimeContext } = useMenu();
  const isCreateMode = location.pathname.endsWith("/location-transfer/create");
  const requestId = !isCreateMode ? String(params.id || "").trim() : "";

  const [companyId, setCompanyId] = useState(() => resolveDefaultTransactionCompanyId(runtimeContext));
  const [requestDate, setRequestDate] = useState(new Date().toISOString().slice(0, 10));
  const [requiredByDate, setRequiredByDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState([createDraftLine()]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [availabilityResult, setAvailabilityResult] = useState(null);
  const [checkedSignature, setCheckedSignature] = useState("");

  const detailQuery = useQuery({
    queryKey: ["procurement", "location-transfer-request", requestId],
    enabled: Boolean(requestId),
    queryFn: () => getLocationTransferRequest(requestId),
  });

  useEffect(() => {
    if (!detailQuery.data || isCreateMode) return;
    const detail = detailQuery.data;
    setCompanyId(String(detail.company_id || ""));
    setRequestDate(String(detail.request_date || "").slice(0, 10));
    setRequiredByDate(String(detail.required_by_date || "").slice(0, 10));
    setRemarks(String(detail.remarks || ""));
    setLines(Array.isArray(detail.lines) && detail.lines.length > 0
      ? detail.lines.map((line, index) => ({
        client_row_id: line.id || `ROW-${index + 1}`,
        id: line.id || "",
        source_storage_location_id: line.source_storage_location_id || "",
        target_storage_location_id: line.target_storage_location_id || "",
        material_id: line.material_id || "",
        requested_qty: String(line.requested_qty ?? ""),
        uom_code: line.uom_code || "KG",
        stock_type_code: line.stock_type_code || "UNRESTRICTED",
        batch_number: line.batch_number || "",
        source_lot_ref: line.source_lot_ref || "",
        remarks: line.remarks || "",
        posted_qty: Number(line.posted_qty ?? 0),
        status: line.status || "OPEN",
      }))
      : [createDraftLine()]);
  }, [detailQuery.data, isCreateMode]);

  const materialQuery = useMaterialOptionsQuery(
    { company_id: companyId || undefined, status: "ACTIVE", limit: MASTER_PICKER_FETCH_LIMIT },
    { enabled: Boolean(companyId) },
  );
  const slocQuery = useStorageLocationOptionsQuery(
    { company_id: companyId || undefined, is_active: true, limit: 1000 },
    { enabled: Boolean(companyId) },
  );

  const materialOptions = useMemo(
    () => (materialQuery.materials ?? []).map((row) => ({
      value: row.id,
      label: `${row.pace_code ?? "—"} — ${row.material_name ?? row.document_name ?? "Material"}`,
      base_uom_code: row.base_uom_code || "KG",
    })),
    [materialQuery.materials],
  );
  const slocOptions = useMemo(
    () => (slocQuery.storageLocations ?? []).map((row) => ({
      value: row.id,
      label: `${row.code ?? row.id} — ${row.name ?? ""}`.trim(),
    })),
    [slocQuery.storageLocations],
  );
  const materialLabelById = useMemo(() => new Map(materialOptions.map((entry) => [entry.value, entry.label])), [materialOptions]);
  const slocLabelById = useMemo(() => new Map(slocOptions.map((entry) => [entry.value, entry.label])), [slocOptions]);

  function isLineLocked(line) {
    return Number(line.posted_qty || 0) > 0;
  }

  const openCheckPayload = useMemo(
    () => lines
      .filter((line) => !isLineLocked(line))
      .map((line) => ({
        client_row_id: line.client_row_id,
        id: line.id || null,
        source_storage_location_id: line.source_storage_location_id,
        target_storage_location_id: line.target_storage_location_id,
        material_id: line.material_id,
        requested_qty: Number(line.requested_qty || 0),
        uom_code: line.uom_code || "KG",
        stock_type_code: line.stock_type_code,
        batch_number: line.batch_number || null,
        source_lot_ref: line.source_lot_ref || null,
      })),
    [lines],
  );
  const currentSignature = JSON.stringify(openCheckPayload);
  const isStale = availabilityResult !== null && currentSignature !== checkedSignature;

  const availabilityByRowId = useMemo(
    () => new Map((availabilityResult?.rows ?? []).map((row) => [row.client_row_id, row])),
    [availabilityResult],
  );

  const headerStatus = isCreateMode ? "Draft" : String(detailQuery.data?.status || "OPEN");
  const postings = Array.isArray(detailQuery.data?.postings) ? detailQuery.data.postings : [];

  function patchLine(index, patch) {
    setLines((current) => current.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      const next = { ...line, ...patch };
      if (patch.material_id) {
        const material = materialOptions.find((entry) => entry.value === patch.material_id);
        if (material) next.uom_code = material.base_uom_code || next.uom_code || "KG";
      }
      return next;
    }));
  }

  function addLine() {
    setLines((current) => [...current, createDraftLine()]);
  }

  function copyLine(index) {
    setLines((current) => {
      const source = current[index];
      const copy = {
        ...source,
        client_row_id: `ROW-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        id: "",
        posted_qty: 0,
        status: "OPEN",
      };
      const next = [...current];
      next.splice(index + 1, 0, copy);
      return next;
    });
  }

  function removeLine(index) {
    setLines((current) => {
      if (current.length <= 1) return current;
      if (isLineLocked(current[index])) return current;
      return current.filter((_, lineIndex) => lineIndex !== index);
    });
  }

  const structuralError = useMemo(() => {
    if (!companyId) return "Company is required.";
    if (lines.length === 0) return "At least one line is required.";
    for (const line of lines) {
      if (isLineLocked(line)) continue;
      if (!line.source_storage_location_id || !line.target_storage_location_id || !line.material_id || !line.stock_type_code) {
        return "Every open line needs source, target, material, and stock type.";
      }
      if (!(Number(line.requested_qty) > 0)) {
        return "Every open line needs a requested quantity above zero.";
      }
      if (String(line.source_storage_location_id) === String(line.target_storage_location_id)) {
        return "Source and target location cannot be the same.";
      }
    }
    return "";
  }, [companyId, lines]);

  async function runAvailabilityCheck() {
    if (structuralError) {
      setError(structuralError);
      return null;
    }
    setError("");
    setChecking(true);
    try {
      const result = openCheckPayload.length > 0
        ? await previewLocationTransferAvailability({ company_id: companyId, request_id: requestId || null, lines: openCheckPayload })
        : { rows: [], has_invalid_rows: false };
      setAvailabilityResult(result);
      setCheckedSignature(currentSignature);
      return result;
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : "Availability check failed.");
      return null;
    } finally {
      setChecking(false);
    }
  }

  async function handleSave() {
    setError("");
    setNotice("");
    if (structuralError) {
      setError(structuralError);
      return;
    }
    setSaving(true);
    try {
      const result = await runAvailabilityCheck();
      if (!result) {
        return;
      }
      if (result.has_invalid_rows) {
        setError("One or more lines exceed available quantity — check the Available column, adjust, then save again.");
        return;
      }
      const payload = {
        company_id: companyId,
        request_date: requestDate,
        required_by_date: requiredByDate || null,
        remarks: remarks || null,
        lines: lines.map((line) => ({
          ...(line.id ? { id: line.id } : {}),
          source_storage_location_id: line.source_storage_location_id,
          target_storage_location_id: line.target_storage_location_id,
          material_id: line.material_id,
          requested_qty: Number(line.requested_qty),
          uom_code: line.uom_code || "KG",
          stock_type_code: line.stock_type_code,
          batch_number: line.batch_number || null,
          source_lot_ref: line.source_lot_ref || null,
          remarks: line.remarks || null,
        })),
      };
      const saved = isCreateMode
        ? await createLocationTransferRequest(payload)
        : await updateLocationTransferRequest(requestId, payload);
      if (saved?.id) {
        setNotice("IN10 request saved.");
        openScreen(OPERATION_SCREENS.PROC_LOC_TRANSFER_REQ_DETAIL.screen_code, { context: { id: saved.id } });
        navigate(`/dashboard/procurement/location-transfer/${encodeURIComponent(saved.id)}`);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelDocument() {
    if (!requestId) return;
    setError("");
    setNotice("");
    try {
      await cancelLocationTransferRequest(requestId, "Cancelled from IN10 workspace");
      setNotice("Request cancelled.");
      await detailQuery.refetch();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Cancel failed.");
    }
  }

  const statusStripLabel = checking
    ? "Checking availability…"
    : availabilityResult?.has_invalid_rows
      ? "Blocked — over quantity"
      : availabilityResult
        ? isStale ? "Changed since last check" : "Checked — ready to save"
        : "Not checked yet";
  const statusStripTone = checking || (availabilityResult && isStale)
    ? "text-slate-500"
    : availabilityResult?.has_invalid_rows
      ? "font-semibold text-rose-600"
      : availabilityResult
        ? "text-emerald-600"
        : "text-slate-500";

  return (
    <ErpScreenScaffold
      eyebrow="Inventory"
      title={isCreateMode ? "Location Transfer Request / Create" : `Location Transfer Request / ${detailQuery.data?.ltr_number ?? "Display"}`}
      notices={[
        ...(notice ? [{ key: "ltr-workspace-notice", tone: "success", message: notice }] : []),
        ...(error ? [{ key: "ltr-workspace-error", tone: "error", message: error }] : []),
        ...(detailQuery.error instanceof Error ? [{ key: "ltr-workspace-query-error", tone: "error", message: detailQuery.error.message }] : []),
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
        ...(!isCreateMode ? [{
          key: "open-in11",
          label: "Open IN11",
          tone: "primary",
          onClick: () => {
            openScreen(OPERATION_SCREENS.PROC_LOC_TRANSFER_POST.screen_code, { context: { request_id: requestId } });
            navigate(`/dashboard/procurement/location-transfer/post?request_id=${encodeURIComponent(requestId)}`);
          },
        }] : []),
        ...(!isCreateMode ? [{
          key: "cancel-document",
          label: "Cancel Request",
          tone: "danger",
          onClick: () => void handleCancelDocument(),
        }] : []),
        {
          key: "save",
          label: saving ? "Saving..." : isCreateMode ? "Create Request" : "Save Changes",
          tone: "primary",
          onClick: () => void handleSave(),
          disabled: saving || checking || Boolean(structuralError),
        },
      ]}
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
          <span className="font-semibold text-slate-900">IN10</span>
          <span>Status: {headerStatus}</span>
          <span>{lines.length} line{lines.length === 1 ? "" : "s"}</span>
          <span className={statusStripTone}>{statusStripLabel}</span>
        </div>

        <ErpSectionCard eyebrow="Header" title="Company & request details">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="xl:col-span-2">
              <TransactionCompanySelector
                runtimeContext={runtimeContext}
                value={companyId}
                onChange={setCompanyId}
                label="Company"
                disabled={!isCreateMode}
              />
            </div>
            <ErpDenseFormRow label="Request Date">
              <input
                type="date"
                value={requestDate}
                onChange={(event) => setRequestDate(event.target.value)}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Required By">
              <input
                type="date"
                value={requiredByDate}
                onChange={(event) => setRequiredByDate(event.target.value)}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <div className="xl:col-span-4">
              <ErpDenseFormRow label="Remarks">
                <input
                  value={remarks}
                  onChange={(event) => setRemarks(event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </ErpDenseFormRow>
            </div>
          </div>
        </ErpSectionCard>

        <ErpSectionCard
          eyebrow="Lines"
          title="Transfer lines"
          actions={[
            { key: "check", label: checking ? "Checking..." : "Check Availability", tone: "neutral", onClick: () => void runAvailabilityCheck(), disabled: checking },
            { key: "add-line", label: "+ Add Line", tone: "primary", onClick: addLine },
          ]}
        >
          <div className="grid gap-3">
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Fill in every line first, then click Check Availability (or Save — it checks first automatically). Lines with a posting already against them are locked — reverse in IN11 to change them.
            </div>
            <ErpDenseGrid
              columns={[
                {
                  key: "source_storage_location_id",
                  label: "Source SLOC",
                  width: "180px",
                  render: (row, index) => isLineLocked(row) ? (
                    <span className="text-slate-600">{slocLabelById.get(row.source_storage_location_id) || "—"}</span>
                  ) : (
                    <select
                      value={row.source_storage_location_id}
                      onChange={(event) => patchLine(index, { source_storage_location_id: event.target.value })}
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900"
                    >
                      <option value="">Select</option>
                      {slocOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  ),
                },
                {
                  key: "target_storage_location_id",
                  label: "Target SLOC",
                  width: "180px",
                  render: (row, index) => isLineLocked(row) ? (
                    <span className="text-slate-600">{slocLabelById.get(row.target_storage_location_id) || "—"}</span>
                  ) : (
                    <select
                      value={row.target_storage_location_id}
                      onChange={(event) => patchLine(index, { target_storage_location_id: event.target.value })}
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900"
                    >
                      <option value="">Select</option>
                      {slocOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  ),
                },
                {
                  key: "material_id",
                  label: "Material",
                  width: "230px",
                  render: (row, index) => isLineLocked(row) ? (
                    <span className="text-slate-600">{materialLabelById.get(row.material_id) || "—"}</span>
                  ) : (
                    <ErpComboboxField
                      value={row.material_id}
                      onChange={(value) => patchLine(index, { material_id: value })}
                      options={materialOptions}
                      placeholder="Select material"
                      blankLabel="Select material"
                      inputClassName="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
                    />
                  ),
                },
                {
                  key: "stock_type_code",
                  label: "Stock Type",
                  width: "140px",
                  render: (row, index) => isLineLocked(row) ? (
                    <span className="text-slate-600">{row.stock_type_code}</span>
                  ) : (
                    <select
                      value={row.stock_type_code}
                      onChange={(event) => patchLine(index, { stock_type_code: event.target.value })}
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900"
                    >
                      {STOCK_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  ),
                },
                {
                  key: "requested_qty",
                  label: "Req. Qty",
                  width: "230px",
                  render: (row, index) => {
                    if (isLineLocked(row)) return <span className="text-slate-600">{formatNumber(row.requested_qty)} {row.uom_code}</span>;
                    const preview = availabilityByRowId.get(row.client_row_id);
                    const isShort = Boolean(preview && !isStale && Number(row.requested_qty || 0) > Number(preview.available_qty ?? 0));
                    return (
                      <RequestedQtyCell
                        row={row}
                        isShort={isShort}
                        onChange={(nextValue) => patchLine(index, { requested_qty: nextValue })}
                      />
                    );
                  },
                },
                {
                  key: "posted_qty",
                  label: "Posted",
                  width: "90px",
                  render: (row) => <span className="text-slate-500">{formatNumber(row.posted_qty)}</span>,
                },
                {
                  key: "available_qty",
                  label: "Available",
                  width: "100px",
                  render: (row) => {
                    if (isLineLocked(row)) return <span>—</span>;
                    const preview = availabilityByRowId.get(row.client_row_id);
                    if (!preview || isStale) return <span className="text-slate-400">Not checked</span>;
                    const isShort = Number(row.requested_qty || 0) > Number(preview.available_qty ?? 0);
                    return <span className={isShort ? "font-semibold text-rose-700" : ""}>{formatNumber(preview.available_qty)}</span>;
                  },
                },
                {
                  key: "batch_number",
                  label: "Batch",
                  width: "120px",
                  render: (row, index) => isLineLocked(row) ? (
                    <span className="text-slate-600">{row.batch_number || "—"}</span>
                  ) : (
                    <input
                      value={row.batch_number}
                      onChange={(event) => patchLine(index, { batch_number: event.target.value })}
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900"
                    />
                  ),
                },
                {
                  key: "source_lot_ref",
                  label: "Source Lot",
                  width: "120px",
                  render: (row, index) => isLineLocked(row) ? (
                    <span className="text-slate-600">{row.source_lot_ref || "—"}</span>
                  ) : (
                    <input
                      value={row.source_lot_ref}
                      onChange={(event) => patchLine(index, { source_lot_ref: event.target.value })}
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900"
                    />
                  ),
                },
                {
                  key: "validity",
                  label: "Validation",
                  width: "190px",
                  render: (row) => {
                    if (isLineLocked(row)) return <span className="text-slate-500">{row.status}</span>;
                    const preview = availabilityByRowId.get(row.client_row_id);
                    if (!preview || isStale) return <span className="text-slate-400">Not checked yet</span>;
                    return preview.is_valid ? <span className="font-semibold text-emerald-700">Ready</span> : (preview.invalid_reason || "Blocked");
                  },
                },
                {
                  key: "actions",
                  label: "Action",
                  width: "130px",
                  render: (row, index) => (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => copyLine(index)}
                        className="border border-slate-300 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700"
                      >
                        Copy
                      </button>
                      {!isLineLocked(row) ? (
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          className="border border-rose-300 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-700"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ),
                },
              ]}
              rows={lines}
              rowKey={(row) => row.client_row_id}
              getRowProps={(row) => {
                if (isLineLocked(row)) return { className: "bg-slate-50" };
                const preview = availabilityByRowId.get(row.client_row_id);
                const isShort = preview && !isStale && Number(row.requested_qty || 0) > Number(preview.available_qty ?? 0);
                return { className: isShort ? "bg-rose-50" : "" };
              }}
              emptyMessage="Add the first transfer line."
              maxHeight="calc(100vh - 460px)"
            />
          </div>
        </ErpSectionCard>

        {!isCreateMode ? (
          <ErpSectionCard eyebrow="History" title="Posting & reservation history">
            <button
              type="button"
              onClick={() => setHistoryOpen((current) => !current)}
              className="border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700 hover:border-sky-500 hover:text-sky-700"
            >
              {historyOpen ? "Hide" : "Show"} posting history ({postings.length})
            </button>
            {historyOpen ? (
              <div className="mt-3">
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
                  maxHeight="260px"
                />
              </div>
            ) : null}
          </ErpSectionCard>
        ) : null}
      </div>
    </ErpScreenScaffold>
  );
}
