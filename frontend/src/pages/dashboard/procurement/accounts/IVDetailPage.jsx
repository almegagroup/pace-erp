import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import { listMaterials, listVendors } from "../../om/omApi.js";
import { addIVLine, getGRN, getIV, postIV, removeIVLine, runIVMatch } from "../procurementApi.js";

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "MATCHED":
      return "emerald";
    case "BLOCKED":
      return "rose";
    case "POSTED":
      return "sky";
    case "DRAFT":
    default:
      return "slate";
  }
}

function lineStatusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "MATCHED":
      return "bg-emerald-100 text-emerald-800";
    case "BLOCKED":
      return "bg-rose-100 text-rose-800";
    case "PENDING":
    default:
      return "bg-amber-100 text-amber-800";
  }
}

function createEmptyLineForm() {
  return {
    grn_line_id: "",
    invoice_qty: "",
    invoice_rate: "",
    gst_rate: "",
    invoice_gst_amount: "",
  };
}

export default function IVDetailPage() {
  const { id = "" } = useParams();
  const [detail, setDetail] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [availableGrns, setAvailableGrns] = useState([]);
  const [lineForm, setLineForm] = useState(createEmptyLineForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const vendorMap = useMemo(
    () => new Map(vendors.map((entry) => [entry.id, entry])),
    [vendors]
  );
  const materialMap = useMemo(
    () => new Map(materials.map((entry) => [entry.id, entry])),
    [materials]
  );
  const currentStatus = String(detail?.status || "").toUpperCase();
  const isDraft = currentStatus === "DRAFT";

  async function loadDetail() {
    if (!id) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [ivData, vendorData, materialData] = await Promise.all([
        getIV(id),
        listVendors({ limit: 200, offset: 0 }),
        listMaterials({ limit: 200, offset: 0 }),
      ]);
      const grnMapRows =
        ivData?.vendor_id
          ? await listVendors({ limit: 1, offset: 0 }).then(() => [])
          : [];
      setDetail(ivData);
      setVendors(Array.isArray(vendorData?.data) ? vendorData.data : []);
      setMaterials(Array.isArray(materialData?.data) ? materialData.data : []);
      setAvailableGrns(grnMapRows);
      setLineForm(createEmptyLineForm());
    } catch (loadError) {
      setDetail(null);
      setVendors([]);
      setMaterials([]);
      setAvailableGrns([]);
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_IV_FETCH_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [id]);

  async function handleRunMatch() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await runIVMatch(id);
      setNotice("Invoice verification match completed.");
      await loadDetail();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_IV_MATCH_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handlePost() {
    const confirmed = window.confirm("Post this invoice verification?");
    if (!confirmed) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await postIV(id);
      setNotice("Invoice verification posted.");
      await loadDetail();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_IV_POST_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveLine(lineId) {
    if (!window.confirm("Remove this IV line?")) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await removeIVLine(id, lineId);
      setNotice("IV line removed.");
      await loadDetail();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_IV_LINE_REMOVE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddLine() {
    if (!lineForm.grn_line_id || !lineForm.invoice_qty || !lineForm.invoice_rate) {
      setError("GRN line, invoice qty, and invoice rate are required.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await addIVLine(id, {
        grn_line_id: lineForm.grn_line_id,
        invoice_qty: Number(lineForm.invoice_qty),
        invoice_rate: Number(lineForm.invoice_rate),
        gst_rate: lineForm.gst_rate ? Number(lineForm.gst_rate) : null,
        invoice_gst_amount: lineForm.invoice_gst_amount ? Number(lineForm.invoice_gst_amount) : 0,
      });
      setLineForm(createEmptyLineForm());
      setNotice("IV line added.");
      await loadDetail();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_IV_LINE_ADD_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const totals = useMemo(() => {
    const rows = Array.isArray(detail?.lines) ? detail.lines : [];
    return rows.reduce(
      (summary, row) => {
        summary.taxable += Number(row.taxable_value ?? 0);
        summary.gst += Number(row.invoice_gst_amount ?? 0);
        summary.invoice += Number(row.taxable_value ?? 0) + Number(row.invoice_gst_amount ?? 0);
        return summary;
      },
      { taxable: 0, gst: 0, invoice: 0 }
    );
  }, [detail?.lines]);

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Accounts"
      title="Invoice Verification Detail"
      notices={[
        ...(error ? [{ key: "iv-detail-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "iv-detail-notice", tone: "success", message: notice }] : []),
        ...(currentStatus === "MATCHED"
          ? [{
              key: "iv-matched-banner",
              tone: "success",
              message: "All lines within 50% tolerance - ready to post",
            }]
          : []),
        ...(currentStatus === "BLOCKED"
          ? [{
              key: "iv-blocked-banner",
              tone: "error",
              message: "One or more lines exceed 50% rate variance - cannot post until resolved. Resolve variance or amend PO.",
            }]
          : []),
      ]}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        ...(isDraft
          ? [{
              key: "run-match",
              label: saving ? "Running..." : "Run Match",
              tone: "primary",
              onClick: () => void handleRunMatch(),
              disabled: saving,
            }]
          : []),
        ...(currentStatus === "MATCHED"
          ? [{
              key: "post",
              label: saving ? "Posting..." : "Post IV",
              tone: "primary",
              onClick: () => void handlePost(),
              disabled: saving,
            }]
          : []),
      ]}
    >
      {loading || !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading invoice verification detail..." : "Invoice verification detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={detail.iv_number || "IV"}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <ErpFieldPreview label="Status" value={detail.status || "—"} tone={statusTone(detail.status)} />
              <ErpFieldPreview label="Vendor" value={vendorMap.get(detail.vendor_id)?.vendor_name || vendorMap.get(detail.vendor_id)?.vendor_code || detail.vendor_id || "—"} />
              <ErpFieldPreview label="Vendor Invoice" value={detail.vendor_invoice_number || "—"} />
              <ErpFieldPreview label="Vendor Invoice Date" value={detail.vendor_invoice_date || "—"} />
              <ErpFieldPreview label="IV Date" value={detail.iv_date || "—"} />
              <ErpFieldPreview label="Total Invoice Value" value={detail.total_invoice_value ?? "—"} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Lines" title="Invoice verification lines">
            <ErpDenseGrid
              columns={[
                {
                  key: "material_id",
                  label: "Material",
                  render: (row) =>
                    materialMap.get(row.material_id)?.material_name ||
                    materialMap.get(row.material_id)?.material_code ||
                    row.material_id ||
                    "—",
                },
                { key: "grn_qty", label: "GRN Qty", width: "90px" },
                { key: "invoice_qty", label: "Invoice Qty", width: "100px" },
                { key: "po_rate", label: "PO Rate", width: "90px" },
                { key: "invoice_rate", label: "Invoice Rate", width: "100px" },
                {
                  key: "rate_variance_pct",
                  label: "Variance %",
                  width: "110px",
                  render: (row) => {
                    const value = Number(row.rate_variance_pct ?? 0);
                    return (
                      <span className={value > 50 ? "inline-block rounded bg-rose-100 px-2 py-1 font-semibold text-rose-800" : undefined}>
                        {value || 0}
                      </span>
                    );
                  },
                },
                {
                  key: "match_status",
                  label: "Match",
                  width: "120px",
                  render: (row) => (
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${lineStatusTone(row.match_status)}`}>
                      {String(row.rate_variance_pct ?? 0) > 50 ? "BLOCKED" : row.match_status}
                    </span>
                  ),
                },
                { key: "taxable_value", label: "Taxable", width: "110px" },
                {
                  key: "invoice_gst_amount",
                  label: "Invoice GST",
                  width: "130px",
                  render: (row) => (
                    <span className="inline-flex items-center gap-2">
                      <span>{row.invoice_gst_amount ?? 0}</span>
                      <span className={row.gst_match_flag ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>
                        {row.gst_match_flag ? "✓" : "✗"}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "actions",
                  label: "Actions",
                  width: "110px",
                  render: (row) =>
                    isDraft ? (
                      <button
                        type="button"
                        onClick={() => void handleRemoveLine(row.id)}
                        className="border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-900"
                      >
                        Remove
                      </button>
                    ) : "—",
                },
              ]}
              rows={detail.lines ?? []}
              rowKey={(row) => row.id}
              getRowProps={(row) => ({
                className: Number(row.rate_variance_pct ?? 0) > 50 ? "bg-rose-50" : undefined,
              })}
              emptyMessage="No invoice verification lines found."
            />

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <ErpFieldPreview label="Total Taxable Value" value={totals.taxable.toFixed(4)} />
              <ErpFieldPreview label="Total GST Amount" value={totals.gst.toFixed(4)} />
              <ErpFieldPreview label="Total Invoice Value" value={totals.invoice.toFixed(4)} />
            </div>
          </ErpSectionCard>

          {isDraft ? (
            <ErpSectionCard eyebrow="Add Line" title="Append GRN line to draft">
              <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                <ErpDenseFormRow label="GRN Line ID">
                  <input
                    value={lineForm.grn_line_id}
                    onChange={(event) => setLineForm((current) => ({ ...current, grn_line_id: event.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Invoice Qty">
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={lineForm.invoice_qty}
                    onChange={(event) => setLineForm((current) => ({ ...current, invoice_qty: event.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Invoice Rate">
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={lineForm.invoice_rate}
                    onChange={(event) => setLineForm((current) => ({ ...current, invoice_rate: event.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="GST Rate">
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={lineForm.gst_rate}
                    onChange={(event) => setLineForm((current) => ({ ...current, gst_rate: event.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Invoice GST Amount">
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={lineForm.invoice_gst_amount}
                    onChange={(event) => setLineForm((current) => ({ ...current, invoice_gst_amount: event.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleAddLine()}
                  className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50"
                >
                  Add Line
                </button>
              </div>
            </ErpSectionCard>
          ) : null}
        </div>
      )}
    </ErpScreenScaffold>
  );
}
