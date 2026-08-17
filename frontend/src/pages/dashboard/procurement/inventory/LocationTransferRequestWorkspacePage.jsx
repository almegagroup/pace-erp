import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { MASTER_PICKER_FETCH_LIMIT, useMaterialOptionsQuery, useStorageLocationOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  cancelLocationTransferRequest,
  createLocationTransferRequest,
  getLocationTransferRequest,
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
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [debouncedPreviewPayload, setDebouncedPreviewPayload] = useState([]);

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

  const previewEligibleLines = useMemo(
    () => lines
      .filter((line) =>
        line.source_storage_location_id
        && line.target_storage_location_id
        && line.material_id
        && line.stock_type_code)
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedPreviewPayload(previewEligibleLines);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [previewEligibleLines]);

  const availabilityQuery = useQuery({
    queryKey: [
      "procurement",
      "location-transfer-availability-preview",
      requestId || "new",
      companyId,
      debouncedPreviewPayload,
    ],
    enabled: Boolean(companyId) && debouncedPreviewPayload.length > 0,
    queryFn: () => previewLocationTransferAvailability({
      company_id: companyId,
      request_id: requestId || null,
      lines: debouncedPreviewPayload,
    }),
  });

  const availabilityByRowId = useMemo(
    () => new Map((availabilityQuery.data?.rows ?? []).map((row) => [row.client_row_id, row])),
    [availabilityQuery.data],
  );

  const rowStatusById = useMemo(
    () => new Map(lines.map((line) => {
      const preview = availabilityByRowId.get(line.client_row_id);
      const requestedQty = Number(line.requested_qty || 0);
      const availableQty = Number(preview?.available_qty ?? 0);
      const hasCoreFields = Boolean(
        line.source_storage_location_id
        && line.target_storage_location_id
        && line.material_id
        && line.stock_type_code,
      );
      const isQtyEntered = line.requested_qty !== "";
      const isShort = Boolean(preview && isQtyEntered && requestedQty > availableQty);
      return [line.client_row_id, { preview, hasCoreFields, isQtyEntered, isShort }];
    })),
    [availabilityByRowId, lines],
  );

  const headerStatus = isCreateMode ? "Draft In Entry" : String(detailQuery.data?.status || "OPEN");

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

  function removeLine(index) {
    setLines((current) => (current.length <= 1 ? current : current.filter((_, lineIndex) => lineIndex !== index)));
  }

  const invalidReason = useMemo(() => {
    if (!companyId) return "Company is required.";
    if (lines.length === 0) return "At least one line is required.";
    for (const line of lines) {
      if (!line.source_storage_location_id || !line.target_storage_location_id || !line.material_id || !line.stock_type_code) {
        return "Every line needs source, target, material, and stock type.";
      }
      if (!(Number(line.requested_qty) > 0)) {
        return "Every line needs a requested quantity above zero.";
      }
      if (String(line.source_storage_location_id) === String(line.target_storage_location_id)) {
        return "Source and target location cannot be the same.";
      }
    }
    if (debouncedPreviewPayload.length !== previewEligibleLines.length) {
      return "Availability preview is refreshing.";
    }
    if (availabilityQuery.isFetching) {
      return "Availability preview is refreshing.";
    }
    if (lines.some((line) => !rowStatusById.get(line.client_row_id)?.preview)) {
      return "Every line must load availability preview before save.";
    }
    if (lines.some((line) => rowStatusById.get(line.client_row_id)?.isShort)) {
      return "One or more rows exceed available quantity.";
    }
    if (availabilityQuery.data?.has_invalid_rows) {
      return "One or more rows exceed available quantity.";
    }
    return "";
  }, [availabilityQuery.data, availabilityQuery.isFetching, companyId, debouncedPreviewPayload.length, lines, previewEligibleLines.length, rowStatusById]);

  async function handleSave() {
    setError("");
    setNotice("");
    if (invalidReason) {
      setError(invalidReason);
      return;
    }
    setSaving(true);
    try {
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

  return (
    <ErpScreenScaffold
      eyebrow="Inventory"
      title={isCreateMode ? "Location Transfer Request / Create" : `Location Transfer Request / ${detailQuery.data?.ltr_number ?? "Display"}`}
      notices={[
        {
          key: "ltr-workspace-guide",
          tone: "info",
          message: "IN10 follows MB21 / MB22 logic: maintain the request first, verify availability, then open IN11 for actual goods movement.",
        },
        ...(notice ? [{ key: "ltr-workspace-notice", tone: "success", message: notice }] : []),
        ...(error ? [{ key: "ltr-workspace-error", tone: "error", message: error }] : []),
        ...(detailQuery.error instanceof Error ? [{ key: "ltr-workspace-query-error", tone: "error", message: detailQuery.error.message }] : []),
      ]}
      actions={[
        {
          key: "back",
          label: page === 1 ? "Back To IN10" : "Back",
          tone: "neutral",
          onClick: () => {
            if (page > 1) {
              setPage((current) => Math.max(1, current - 1));
              return;
            }
            openScreen(OPERATION_SCREENS.PROC_LOC_TRANSFER_REQ.screen_code);
            navigate("/dashboard/procurement/location-transfer");
          },
        },
        ...(page === 1 ? [{
          key: "next-header",
          label: "Continue To Lines",
          tone: "primary",
          onClick: () => setPage(2),
          disabled: !companyId,
        }] : []),
        ...(page === 2 ? [{
          key: "next-review",
          label: "Continue To Review",
          tone: "primary",
          onClick: () => setPage(3),
          disabled: lines.length === 0,
        }] : []),
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
          disabled: saving || Boolean(invalidReason) || page !== 3,
        },
      ]}
    >
      <div className="grid gap-4">
        <div className="grid gap-4 xl:grid-cols-4">
          <ErpFieldPreview label="Transaction" value="IN10" tone="sky" />
          <ErpFieldPreview label="Status" value={headerStatus} />
          <ErpFieldPreview label="Rows" value={`${lines.length}`} caption={invalidReason || "Every row is preview-valid."} />
          <ErpFieldPreview label="Availability" value={availabilityQuery.isFetching ? "Refreshing" : availabilityQuery.data?.has_invalid_rows ? "Blocked" : "Ready"} />
        </div>

        {page === 1 ? (
          <ErpSectionCard eyebrow="Page 1" title="Header / Company Scope">
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
        ) : null}

        {page === 2 ? (
          <ErpSectionCard eyebrow="Page 2" title="Editable Request Lines">
            <div className="grid gap-3">
              <div className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <span>Source-side availability is calculated from the live backend stock + other active reservations. Save stays blocked until every row is valid.</span>
                <button
                  type="button"
                  onClick={addLine}
                  className="border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700 hover:border-sky-500 hover:text-sky-700"
                >
                  Add Line
                </button>
              </div>
              <ErpDenseGrid
                columns={[
                  {
                    key: "source_storage_location_id",
                    label: "Source SLOC",
                    width: "180px",
                    render: (row, index) => (
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
                    render: (row, index) => (
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
                    render: (row, index) => (
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
                    render: (row, index) => (
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
                    width: "110px",
                    render: (row, index) => (
                      <input
                        value={row.requested_qty}
                        onChange={(event) => patchLine(index, { requested_qty: event.target.value })}
                        className={`h-8 w-full border bg-white px-2 text-xs text-slate-900 ${
                          rowStatusById.get(row.client_row_id)?.isShort ? "border-rose-500 bg-rose-50 text-rose-700" : "border-slate-300"
                        }`}
                      />
                    ),
                  },
                  {
                    key: "available_qty",
                    label: "Available",
                    width: "100px",
                    render: (row) => {
                      const preview = availabilityByRowId.get(row.client_row_id);
                      const isShort = rowStatusById.get(row.client_row_id)?.isShort;
                      return (
                        <span className={isShort ? "font-semibold text-rose-700" : ""}>
                          {preview ? formatNumber(preview.available_qty) : "—"}
                        </span>
                      );
                    },
                  },
                  {
                    key: "batch_number",
                    label: "Batch",
                    width: "120px",
                    render: (row, index) => (
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
                    render: (row, index) => (
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
                    width: "200px",
                    render: (row) => {
                      const status = rowStatusById.get(row.client_row_id);
                      const preview = status?.preview;
                      if (!status?.hasCoreFields) return "Select source, target, material";
                      if (!preview) return "Loading availability...";
                      if (status.isShort) return <span className="font-semibold text-rose-700">Qty exceeds available</span>;
                      if (!status.isQtyEntered) return <span className="text-slate-500">Enter qty to validate</span>;
                      return preview.is_valid ? <span className="font-semibold text-emerald-700">Ready</span> : (preview.invalid_reason || "Blocked");
                    },
                  },
                  {
                    key: "remove",
                    label: "Action",
                    width: "90px",
                    render: (_row, index) => (
                      <button
                        type="button"
                        onClick={() => removeLine(index)}
                        className="border border-rose-300 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-700"
                      >
                        Remove
                      </button>
                    ),
                  },
                ]}
                rows={lines}
                rowKey={(row) => row.client_row_id}
                getRowProps={(row) => ({
                  className: rowStatusById.get(row.client_row_id)?.isShort ? "bg-rose-50" : "",
                })}
                emptyMessage="Add the first transfer line."
                maxHeight="calc(100vh - 330px)"
              />
            </div>
          </ErpSectionCard>
        ) : null}

        {page === 3 ? (
          <ErpSectionCard eyebrow="Page 3" title="Review Before Save">
            <div className="grid gap-3">
              <div className="grid gap-3 xl:grid-cols-4">
                <ErpFieldPreview label="Company Ready" value={companyId ? "Yes" : "No"} />
                <ErpFieldPreview label="Preview Status" value={availabilityQuery.isFetching ? "Refreshing" : availabilityQuery.data?.has_invalid_rows ? "Blocked" : "Ready"} />
                <ErpFieldPreview label="Rows In Request" value={`${lines.length}`} />
                <ErpFieldPreview label="Save State" value={invalidReason ? "Disabled" : "Ready"} caption={invalidReason || "All rows passed preview."} />
              </div>
              <ErpDenseGrid
                columns={[
                  { key: "line_no", label: "Line", width: "60px", render: (_row, index) => index + 1 },
                  {
                    key: "material",
                    label: "Material",
                    width: "240px",
                    render: (row) => materialOptions.find((option) => option.value === row.material_id)?.label || "—",
                  },
                  {
                    key: "source",
                    label: "Source",
                    width: "180px",
                    render: (row) => slocOptions.find((option) => option.value === row.source_storage_location_id)?.label || "—",
                  },
                  {
                    key: "target",
                    label: "Target",
                    width: "180px",
                    render: (row) => slocOptions.find((option) => option.value === row.target_storage_location_id)?.label || "—",
                  },
                  { key: "requested_qty", label: "Req. Qty", width: "100px" },
                  {
                    key: "available_qty",
                    label: "Available",
                    width: "100px",
                    render: (row) => {
                      const preview = availabilityByRowId.get(row.client_row_id);
                      return preview ? formatNumber(preview.available_qty) : "—";
                    },
                  },
                  {
                    key: "validation",
                    label: "Validation",
                    width: "220px",
                    render: (row) => {
                      const preview = availabilityByRowId.get(row.client_row_id);
                      if (!preview) return "Preview missing";
                      return preview.is_valid ? "Ready To Save" : preview.invalid_reason || "Blocked";
                    },
                  },
                ]}
                rows={lines}
                rowKey={(row) => row.client_row_id}
                emptyMessage="No lines to review."
                maxHeight="360px"
              />
            </div>
          </ErpSectionCard>
        ) : null}
      </div>
    </ErpScreenScaffold>
  );
}
