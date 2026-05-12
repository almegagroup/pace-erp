import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import { listMaterials } from "../../om/omApi.js";
import { getGRN, postGRN, reverseGRN, updateGRNDraft } from "../procurementApi.js";

function badgeTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "POSTED":
      return "emerald";
    case "REVERSED":
      return "rose";
    case "DRAFT":
    default:
      return "sky";
  }
}

export default function GRNDetailPage() {
  const { id = "" } = useParams();
  const [detail, setDetail] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const materialMap = useMemo(() => new Map(materials.map((entry) => [entry.id, entry])), [materials]);
  const weightedMode = useMemo(
    () => lines.some((line) => Number(line.net_weight_from_weighbridge ?? 0) > 0),
    [lines]
  );
  const stockSummary = useMemo(
    () =>
      lines.reduce(
        (summary, line) => {
          summary.totalQty += Number(line.received_qty ?? 0);
          summary.qaLines += String(line.target_stock_type || "").toUpperCase() === "QA_STOCK" ? 1 : 0;
          return summary;
        },
        { totalQty: 0, qaLines: 0 }
      ),
    [lines]
  );

  async function loadDetail() {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const [grnData, materialData] = await Promise.all([
        getGRN(id),
        listMaterials({ limit: 200, offset: 0 }),
      ]);
      setDetail(grnData);
      setLines(Array.isArray(grnData?.lines) ? grnData.lines : []);
      setMaterials(Array.isArray(materialData?.data) ? materialData.data : []);
    } catch (loadError) {
      setDetail(null);
      setLines([]);
      setMaterials([]);
      setError(loadError instanceof Error ? loadError.message : "GRN_FETCH_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [id]);

  function updateLine(lineId, patch) {
    setLines((current) =>
      current.map((line) => {
        if (line.id !== lineId) return line;
        const next = { ...line, ...patch };
        const geQty = Number(next.ge_qty ?? 0);
        const receivedQty = Number(next.received_qty ?? 0);
        next.discrepancy_qty = Number((geQty - receivedQty).toFixed(6));
        return next;
      })
    );
  }

  async function handleSaveDraft() {
    if (!detail?.id) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        grn_date: detail.grn_date,
        posting_date: detail.posting_date,
        remarks: detail.remarks,
        lines: lines.map((line) => ({
          id: line.id,
          ge_qty: line.ge_qty,
          received_qty: Number(line.received_qty),
          storage_location_id: line.storage_location_id || null,
          batch_lot_number: line.batch_lot_number || null,
          expiry_date: line.expiry_date || null,
          target_stock_type: line.target_stock_type,
        })),
      };
      const updated = await updateGRNDraft(detail.id, payload);
      setDetail(updated);
      setLines(Array.isArray(updated?.lines) ? updated.lines : []);
      setNotice("GRN draft saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "GRN_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handlePost() {
    if (!detail?.id) return;
    const confirmed = window.confirm("This will post stock movement. Cannot be undone without reversal.");
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const posted = await postGRN(detail.id);
      setDetail(posted);
      setLines(Array.isArray(posted?.lines) ? posted.lines : []);
      setNotice(`GRN posted. ${stockSummary.qaLines} QA line(s), total qty ${stockSummary.totalQty.toFixed(3)}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "GRN_POST_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleReverse() {
    if (!detail?.id) return;
    const reason = window.prompt("Reversal reason", "");
    if (!reason) return;
    const confirmed = window.confirm("Reverse this posted GRN?");
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const reversed = await reverseGRN(detail.id, { reversal_reason: reason });
      setDetail(reversed);
      setLines(Array.isArray(reversed?.lines) ? reversed.lines : []);
      setNotice("GRN reversed.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "GRN_REVERSE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="GRN Detail"
      notices={[
        ...(error ? [{ key: "grn-detail-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "grn-detail-notice", tone: "success", message: notice }] : []),
        ...(weightedMode
          ? [{ key: "grn-weight-note", tone: "info", message: "BULK/TANKER mode detected. Received quantities were prefilled from net weight and remain editable." }]
          : []),
      ]}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        ...(detail?.status === "DRAFT"
          ? [
              { key: "save", label: saving ? "Saving..." : "Save Draft", tone: "neutral", onClick: () => void handleSaveDraft(), disabled: saving },
              { key: "post", label: saving ? "Posting..." : "Post GRN", tone: "primary", onClick: () => void handlePost(), disabled: saving },
            ]
          : []),
        ...(detail?.status === "POSTED"
          ? [{ key: "reverse", label: saving ? "Reversing..." : "Reverse GRN", tone: "danger", onClick: () => void handleReverse(), disabled: saving }]
          : []),
      ]}
    >
      {loading || !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading GRN detail..." : "GRN detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={detail.grn_number || "GRN"}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <ErpFieldPreview label="GRN Date" value={detail.grn_date || "—"} />
              <ErpFieldPreview label="Posting Date" value={detail.posting_date || "—"} />
              <ErpFieldPreview label="Status" value={detail.status || "—"} tone={badgeTone(detail.status)} />
              <ErpFieldPreview label="Vendor" value={detail.vendor_id || "—"} />
              <ErpFieldPreview label="GE Number" value={detail.gate_entry?.ge_number || detail.gate_entry_id || "—"} />
              <ErpFieldPreview label="Movement Type" value={detail.movement_type_code || "—"} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Lines" title="Receipt lines">
            <ErpDenseGrid
              columns={[
                { key: "line_number", label: "Line", width: "70px" },
                { key: "material_id", label: "Material", width: "150px" },
                { key: "ge_qty", label: "GE Qty", width: "95px" },
                {
                  key: "received_qty",
                  label: "Received Qty",
                  width: "110px",
                  render: (row) =>
                    detail.status === "DRAFT" ? (
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={row.received_qty ?? ""}
                        onChange={(event) => updateLine(row.id, { received_qty: event.target.value })}
                        className="h-7 w-full border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500"
                      />
                    ) : (
                      row.received_qty ?? "—"
                    ),
                },
                {
                  key: "discrepancy_qty",
                  label: "Discrepancy",
                  width: "110px",
                  render: (row) => {
                    const discrepancy = Number(row.discrepancy_qty ?? Number((Number(row.ge_qty ?? 0) - Number(row.received_qty ?? 0)).toFixed(6)));
                    return (
                      <span className={discrepancy !== 0 ? "font-semibold text-amber-700" : "text-slate-700"}>
                        {discrepancy}
                      </span>
                    );
                  },
                },
                {
                  key: "storage_location_id",
                  label: "Storage Location",
                  width: "140px",
                  render: (row) =>
                    detail.status === "DRAFT" ? (
                      <input
                        value={row.storage_location_id ?? ""}
                        onChange={(event) => updateLine(row.id, { storage_location_id: event.target.value })}
                        className="h-7 w-full border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500"
                      />
                    ) : (
                      row.storage_location_id || "—"
                    ),
                },
                {
                  key: "batch_lot_number",
                  label: "Batch",
                  width: "120px",
                  render: (row) => {
                    const material = materialMap.get(row.material_id);
                    if (!material?.batch_tracking_required) return "—";
                    return detail.status === "DRAFT" ? (
                      <input
                        value={row.batch_lot_number ?? ""}
                        onChange={(event) => updateLine(row.id, { batch_lot_number: event.target.value })}
                        className="h-7 w-full border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500"
                      />
                    ) : (
                      row.batch_lot_number || "—"
                    );
                  },
                },
                {
                  key: "expiry_date",
                  label: "Expiry",
                  width: "120px",
                  render: (row) => {
                    const material = materialMap.get(row.material_id);
                    if (!material?.expiry_tracking_enabled) return "—";
                    return detail.status === "DRAFT" ? (
                      <input
                        type="date"
                        value={row.expiry_date ?? ""}
                        onChange={(event) => updateLine(row.id, { expiry_date: event.target.value })}
                        className="h-7 w-full border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500"
                      />
                    ) : (
                      row.expiry_date || "—"
                    );
                  },
                },
                {
                  key: "stock_type",
                  label: "Stock Type",
                  width: "120px",
                  render: (row) => {
                    const stockType = String(row.target_stock_type || "").toUpperCase();
                    const qa = stockType === "QA_STOCK";
                    return (
                      <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${qa ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                        {qa ? "QA_STOCK" : "UNRESTRICTED"}
                      </span>
                    );
                  },
                },
              ]}
              rows={lines}
              rowKey={(row) => row.id}
              getRowProps={(row) => ({
                className: Number(row.discrepancy_qty ?? 0) !== 0 ? "bg-amber-50" : undefined,
              })}
              emptyMessage="No GRN lines found."
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Header Notes" title="Posting guidance">
            <div className="grid gap-3 lg:grid-cols-2">
              <ErpDenseFormRow label="Remarks">
                <input
                  value={detail.remarks ?? ""}
                  onChange={(event) => setDetail((current) => ({ ...current, remarks: event.target.value }))}
                  disabled={detail.status !== "DRAFT"}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-100 disabled:text-slate-500"
                />
              </ErpDenseFormRow>
              <div className="text-sm text-slate-600">
                QA badge rows are informational only. Users cannot override target stock routing here.
              </div>
            </div>
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
