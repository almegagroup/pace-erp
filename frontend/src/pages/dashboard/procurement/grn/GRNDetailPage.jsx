import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { getActiveScreenContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import { openActionPrompt } from "../../../../store/actionPrompt.js";
import { getGRN, reverseGRN } from "../procurementApi.js";
import DocumentFlowSection from "../DocumentFlowSection.jsx";

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "POSTED": return "emerald";
    case "REVERSED": return "rose";
    default: return "sky";
  }
}

// Renders a labelled field group inside a card
function Fields({ items }) {
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
      {items.map(([label, value]) => (
        <ErpFieldPreview key={label} label={label} value={value || "—"} />
      ))}
    </div>
  );
}

export default function GRNDetailPage() {
  const { id: routeId = "" } = useParams();
  const screenContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const id = routeId && routeId !== ":id" ? routeId : (screenContext.id || "");
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const detailQuery = useQuery({
    queryKey: ["procurement", "grn-detail", id],
    enabled: Boolean(id),
    queryFn: () => getGRN(id),
  });

  const detail = detailQuery.data ?? null;
  const loading = detailQuery.isLoading;
  const isNewStyle = Boolean(detail?.gate_entry_line_id);

  async function handleReverse() {
    if (!detail?.id) return;
    const reason = await openActionPrompt({
      eyebrow: "GRN",
      title: "Reverse this GRN?",
      label: "Reversal reason",
      required: true,
    });
    if (!reason) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const reversed = await reverseGRN(detail.id, { reversal_reason: reason });
      queryClient.setQueryData(["procurement", "grn-detail", id], reversed);
      setNotice("GRN reversed successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "GRN_REVERSE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const vendorDisplay = detail?.vendor_name
    ? `${detail.vendor_code || ""} — ${detail.vendor_name}`.replace(/^( — )/, "")
    : "—";
  const geDisplay = detail?.ge_number || "—";
  const locationDisplay = detail?.location_code
    ? `${detail.location_code} — ${detail.location_name || ""}`.replace(/ — $/, "")
    : (detail?.storage_location_id ? "—" : null);

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title={detail?.grn_number || "GRN Detail"}
      notices={[
        ...(error ? [{ key: "grn-detail-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "grn-detail-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        ...(detail?.status === "POSTED"
          ? [{ key: "reverse", label: saving ? "Reversing…" : "Reverse GRN", tone: "danger", onClick: () => void handleReverse(), disabled: saving }]
          : []),
      ]}
    >
      {loading || !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading GRN…" : "GRN not found."}
        </div>
      ) : (
        <div className="grid gap-4">
          {/* Header */}
          <ErpSectionCard eyebrow="Header" title={detail.grn_number}>
            <Fields items={[
              ["GRN date", detail.grn_date],
              ["Status", detail.status],
              ["Vendor", vendorDisplay],
              ["GE number", geDisplay],
              ["Movement type", detail.movement_type_code],
              ["GRN type", isNewStyle ? "New (1 line per GE line)" : "Legacy"],
            ]} />
          </ErpSectionCard>

          {/* New-style GRN: single-row summary from header fields */}
          {isNewStyle && (
            <>
              <ErpSectionCard eyebrow="Receipt" title="Material & quantity">
                <Fields items={[
                  ["PACE code", detail.pace_code || "—"],
                  ["Material", detail.material_name || "—"],
                  ["External code", detail.external_sku || "—"],
                  ["GE qty", detail.ge_qty != null ? `${detail.ge_qty} ${detail.uom_code || ""}` : "—"],
                  ["Received qty", detail.received_qty != null ? `${detail.received_qty} ${detail.uom_code || ""}` : "—"],
                  ["Discrepancy", (() => {
                    const d = Number((Number(detail.ge_qty || 0) - Number(detail.received_qty || 0)).toFixed(6));
                    return d !== 0 ? String(d) : "None";
                  })()],
                  ["Storage location", locationDisplay],
                  ["Target stock type", detail.target_stock_type || "UNRESTRICTED"],
                  ["Batch / lot", detail.batch_lot_number || "—"],
                  ["Expiry date", detail.expiry_date || "—"],
                  ["Expiry type", detail.expiry_type || "—"],
                ]} />
                {detail.discrepancy_remarks && (
                  <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Discrepancy remarks: {detail.discrepancy_remarks}
                  </div>
                )}
              </ErpSectionCard>

              <ErpSectionCard eyebrow="Documents" title="Invoice & shipping">
                <Fields items={[
                  ["Invoice number", detail.invoice_number],
                  ["Invoice date", detail.invoice_date],
                  ["Invoice name", detail.invoice_name],
                  ["BL number", detail.bl_number],
                  ["BL date", detail.bl_date],
                  ["BoE number", detail.boe_number],
                  ["BoE date", detail.boe_date],
                ]} />
              </ErpSectionCard>

              <ErpSectionCard eyebrow="Accounts" title="Rate & GST">
                <Fields items={[
                  ["PO rate", detail.po_rate != null ? `₹ ${Number(detail.po_rate).toFixed(4)}` : "—"],
                  ["Invoice rate", detail.invoice_rate != null ? `₹ ${Number(detail.invoice_rate).toFixed(4)}` : "—"],
                  ["GRN rate", detail.grn_rate != null ? `₹ ${Number(detail.grn_rate).toFixed(4)}` : "—"],
                  ["Rate confirmed", detail.rate_confirmed ? "Yes" : "No"],
                  ["GST %", detail.gst_pct != null ? `${detail.gst_pct}%` : "—"],
                ]} />
              </ErpSectionCard>

              <ErpSectionCard eyebrow="Transporter" title="Logistics">
                <Fields items={[
                  ["Transporter", detail.transporter_name || "—"],
                  ["LR number", detail.lr_number],
                  ["LR date", detail.lr_date],
                ]} />
              </ErpSectionCard>
            </>
          )}

          {/* Old-style GRN: lines grid */}
          {!isNewStyle && (
            <ErpSectionCard eyebrow="Lines" title="Receipt lines">
              <ErpDenseGrid
                columns={[
                  { key: "line_number", label: "#", width: "50px" },
                  {
                    key: "material",
                    label: "Material",
                    render: (row) =>
                      row.material_name
                        ? <span><span className="font-medium">{row.pace_code}</span><span className="text-slate-500"> — {row.material_name}</span></span>
                        : row.pace_code || "—",
                  },
                  { key: "ge_qty", label: "GE qty", width: "90px" },
                  { key: "received_qty", label: "Received", width: "90px" },
                  {
                    key: "discrepancy_qty",
                    label: "Discrepancy",
                    width: "110px",
                    render: (row) => {
                      const d = Number(row.discrepancy_qty ?? Number((Number(row.ge_qty ?? 0) - Number(row.received_qty ?? 0)).toFixed(6)));
                      return <span className={d !== 0 ? "font-semibold text-amber-700" : ""}>{d !== 0 ? d : "—"}</span>;
                    },
                  },
                  {
                    key: "location",
                    label: "Storage location",
                    width: "160px",
                    render: (row) =>
                      row.location_code
                        ? `${row.location_code} — ${row.location_name || ""}`.replace(/ — $/, "")
                        : row.storage_location_id
                          ? "—"
                          : "Not set",
                  },
                  { key: "batch_lot_number", label: "Batch", width: "110px", render: (row) => row.batch_lot_number || "—" },
                  { key: "expiry_date", label: "Expiry", width: "110px", render: (row) => row.expiry_date || "—" },
                  {
                    key: "target_stock_type",
                    label: "Stock type",
                    width: "110px",
                    render: (row) => {
                      const qa = String(row.target_stock_type || "").toUpperCase() === "QA_STOCK";
                      return (
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${qa ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                          {qa ? "QA" : "UNREST."}
                        </span>
                      );
                    },
                  },
                ]}
                rows={Array.isArray(detail.lines) ? detail.lines : []}
                rowKey={(row) => row.id}
                getRowProps={(row) => ({
                  className: Number(row.discrepancy_qty ?? 0) !== 0 ? "bg-amber-50" : undefined,
                })}
                emptyMessage="No lines found."
              />
            </ErpSectionCard>
          )}

          <DocumentFlowSection docType="GRN" docId={detail.id} />
        </div>
      )}
    </ErpScreenScaffold>
  );
}
