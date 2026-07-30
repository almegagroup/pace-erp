/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/DODetailPage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: §113 Stage 2 — Delivery Order detail (read view).
 * Authority: Frontend
 */

import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import { getActiveScreenContext } from "../../../../navigation/screenStackEngine.js";
import { getDeliveryOrder } from "../procurementApi.js";

export default function DODetailPage() {
  const routeParams = useParams();
  const routeId = routeParams.id;
  const id = routeId && routeId !== ":id" ? routeId : getActiveScreenContext()?.id;

  const doQuery = useQuery({
    queryKey: ["procurement", "delivery-order", id],
    queryFn: () => getDeliveryOrder(id),
    enabled: Boolean(id),
  });

  const data = doQuery.data ?? {};
  const lines = Array.isArray(data.lines) ? data.lines : [];

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title={data.dc_number ? `Delivery Order — ${data.dc_number}` : "Delivery Order"}
      actions={[{ key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() }]}
      notices={doQuery.error ? [{ key: "do-detail-error", tone: "error", message: doQuery.error instanceof Error ? doQuery.error.message : "PROCUREMENT_DO_FETCH_FAILED" }] : []}
    >
      {doQuery.isLoading ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">Loading delivery order...</div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title="Delivery order summary">
            <div className="grid gap-3 md:grid-cols-3 text-sm">
              <div><span className="text-xs text-slate-500">DO Number</span><div className="font-mono font-semibold">{data.dc_number}</div></div>
              <div><span className="text-xs text-slate-500">Date</span><div>{data.dc_date}</div></div>
              <div><span className="text-xs text-slate-500">Status</span><div>{data.status}</div></div>
              <div><span className="text-xs text-slate-500">Type</span><div>{data.dc_type}</div></div>
              <div><span className="text-xs text-slate-500">Vehicle</span><div>{data.vehicle_number || "—"}</div></div>
              <div><span className="text-xs text-slate-500">LR Number</span><div>{data.lr_number || "—"}</div></div>
              <div><span className="text-xs text-slate-500">Driver Name</span><div>{data.driver_name || "—"}</div></div>
              <div><span className="text-xs text-slate-500">Transporter</span><div>{data.transporter_display || "—"}</div></div>
              <div><span className="text-xs text-slate-500">Cost Center</span><div>{data.cost_center_display || "—"}</div></div>
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Source & Party" title="What this DO dispatches, and against which order">
            <div className="grid gap-3 md:grid-cols-3 text-sm">
              <div>
                <span className="text-xs text-slate-500">{data.dc_type === "SALES" ? "Sales Order" : "Stock Transfer Order"}</span>
                <div className="font-mono font-semibold">{data.source_document_number || "—"}</div>
                {data.source_document_date ? <div className="text-xs text-slate-500">{data.source_document_date}</div> : null}
              </div>
              {data.dc_type === "SALES" ? (
                <div><span className="text-xs text-slate-500">Customer</span><div>{data.customer_display || "—"}</div></div>
              ) : (
                <div><span className="text-xs text-slate-500">Receiving Company</span><div>{data.receiving_company_display || "—"}</div></div>
              )}
              <div><span className="text-xs text-slate-500">Selling Company</span><div>{data.selling_company_display || "—"}</div></div>
              {data.source_reference_display ? (
                <div className="md:col-span-3"><span className="text-xs text-slate-500">Reference</span><div>{data.source_reference_display}</div></div>
              ) : null}
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Lines" title={`${lines.length} line${lines.length === 1 ? "" : "s"}`}>
            <ErpDenseGrid
              columns={[
                { key: "line_number", label: "#", width: "50px" },
                { key: "material_id", label: "Material", render: (row) => row.material_display || row.material_id },
                { key: "quantity", label: "Qty", width: "100px", render: (row) => `${row.quantity} ${row.uom_code || ""}` },
                { key: "storage_location_id", label: "Storage Location", render: (row) => row.storage_location_display || row.storage_location_id || "—" },
                { key: "unit_value", label: "Rate", width: "100px", align: "right", render: (row) => (Number.isFinite(Number(row.unit_value)) ? Number(row.unit_value).toFixed(2) : "—") },
                { key: "line_total", label: "Line Total", width: "110px", align: "right", render: (row) => (Number.isFinite(Number(row.line_total)) ? Number(row.line_total).toFixed(2) : "-") },
              ]}
              rows={lines}
              rowKey={(row) => row.id}
              emptyMessage="No lines."
            />
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
