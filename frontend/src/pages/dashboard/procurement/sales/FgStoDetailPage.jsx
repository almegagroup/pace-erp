/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/FgStoDetailPage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: Read-only FG STO detail for Stores / Accounts / Logistics (SO01/SO02 ACL). Shows the
 *          header, lines (SKU, qty, transfer price, conversion cost, locations), the CSNs
 *          (dispatch / LR / ETA / gate entry / GRN) and the Delivery Orders raised against it.
 * Authority: Frontend
 */

import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import { getFgSto } from "../procurementApi.js";

const dash = (value) => (value === null || value === undefined || value === "" ? "—" : value);

export default function FgStoDetailPage() {
  const { id } = useParams();
  const stoQuery = useQuery({
    queryKey: ["procurement", "fg-sto", id],
    queryFn: () => getFgSto(id),
    enabled: Boolean(id),
  });
  const sto = stoQuery.data ?? null;
  const loading = stoQuery.isLoading;
  const lines = Array.isArray(sto?.lines) ? sto.lines : [];
  const csns = Array.isArray(sto?.csns) ? sto.csns : [];
  const deliveryOrders = Array.isArray(sto?.delivery_challans) ? sto.delivery_challans : [];

  return (
    <ErpScreenScaffold
      eyebrow="Procurement / Sales"
      title="FG STO Detail"
      notices={stoQuery.error ? [{ key: "fg-sto-detail-error", tone: "error", message: stoQuery.error instanceof Error ? stoQuery.error.message : "FG_STO_FETCH_FAILED" }] : []}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "refresh", label: "Refresh", tone: "neutral", onClick: () => stoQuery.refetch() },
      ]}
    >
      {loading || !sto ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading FG STO..." : "FG STO is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={`${sto.sto_number || "—"}`}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
              <ErpFieldPreview label="Status" value={dash(sto.status)} />
              <ErpFieldPreview label="STO Date" value={dash(sto.sto_date)} />
              <ErpFieldPreview label="Sending Company" value={dash(sto.sending_company_display)} />
              <ErpFieldPreview label="Receiving Company" value={dash(sto.receiving_company_display)} />
              <ErpFieldPreview label="Delivery Type" value={dash(sto.delivery_type)} />
              <ErpFieldPreview label="Group Number" value={dash(sto.group_number)} />
              <ErpFieldPreview label="Created" value={dash(sto.created_at)} />
              <ErpFieldPreview label="Remarks" value={dash(sto.remarks)} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Lines" title={`${lines.length} line${lines.length === 1 ? "" : "s"}`}>
            <ErpDenseGrid
              columns={[
                { key: "line_number", label: "#", width: "50px" },
                { key: "material_display", label: "SKU", render: (row) => dash(row.material_display) },
                { key: "quantity", label: "Qty", width: "100px", align: "right" },
                { key: "uom_code", label: "UOM", width: "70px" },
                { key: "transfer_price", label: "Transfer Price", width: "120px", align: "right", render: (row) => dash(row.transfer_price) },
                { key: "conversion_cost_per_unit", label: "Conversion Cost", width: "120px", align: "right", render: (row) => dash(row.conversion_cost_per_unit) },
                { key: "balance_qty", label: "Balance Qty", width: "100px", align: "right", render: (row) => dash(row.balance_qty) },
                { key: "sending_location_display", label: "Sending Location", render: (row) => dash(row.sending_location_display) },
                { key: "receiving_location_display", label: "Receiving Location", render: (row) => dash(row.receiving_location_display) },
                { key: "payment_term_display", label: "Payment Term", render: (row) => dash(row.payment_term_display) },
                { key: "freight_term", label: "Freight", width: "100px", render: (row) => dash(row.freight_term) },
                { key: "expected_delivery_date", label: "Expected Delivery", width: "130px", render: (row) => dash(row.expected_delivery_date) },
              ]}
              rows={lines}
              rowKey={(row) => row.id}
              emptyMessage="No lines."
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="CSN" title={`${csns.length} consignment note${csns.length === 1 ? "" : "s"}`}>
            <ErpDenseGrid
              columns={[
                { key: "csn_number", label: "CSN", width: "130px" },
                { key: "status", label: "Status", width: "90px" },
                { key: "material_display", label: "SKU", render: (row) => dash(row.material_display) },
                { key: "dispatch_qty", label: "Dispatch Qty", width: "110px", align: "right", render: (row) => dash(row.dispatch_qty) },
                { key: "lr_number", label: "LR No.", width: "110px", render: (row) => dash(row.lr_number) },
                { key: "lr_date", label: "LR Date", width: "110px", render: (row) => dash(row.lr_date) },
                { key: "vehicle_number", label: "Vehicle", width: "110px", render: (row) => dash(row.vehicle_number) },
                { key: "eta_to_plant_calculated", label: "ETA to Plant", width: "120px", render: (row) => dash(row.eta_to_plant_calculated) },
                { key: "gate_entry_date", label: "Gate Entry", width: "110px", render: (row) => dash(row.gate_entry_date) },
                { key: "grn_date", label: "GRN Date", width: "110px", render: (row) => dash(row.grn_date) },
                { key: "received_qty", label: "Received Qty", width: "110px", align: "right", render: (row) => dash(row.received_qty) },
                { key: "invoice_number", label: "Invoice No.", width: "130px", render: (row) => dash(row.invoice_number) },
                { key: "invoice_date", label: "Invoice Date", width: "110px", render: (row) => dash(row.invoice_date) },
              ]}
              rows={csns}
              rowKey={(row) => row.id}
              emptyMessage="No CSN yet."
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Delivery Orders" title={`${deliveryOrders.length} delivery order${deliveryOrders.length === 1 ? "" : "s"}`}>
            <ErpDenseGrid
              columns={[
                { key: "dc_number", label: "DO Number", width: "140px" },
                { key: "status", label: "Status", width: "110px" },
                { key: "dc_date", label: "DO Date", width: "110px", render: (row) => dash(row.dc_date) },
                { key: "transporter_name_freetext", label: "Transporter", render: (row) => dash(row.transporter_name_freetext) },
                { key: "lr_number", label: "LR No.", width: "110px", render: (row) => dash(row.lr_number) },
                { key: "lr_date", label: "LR Date", width: "110px", render: (row) => dash(row.lr_date) },
                { key: "vehicle_number", label: "Vehicle", width: "110px", render: (row) => dash(row.vehicle_number) },
                { key: "dispatch_date", label: "Dispatch Date", width: "120px", render: (row) => dash(row.dispatch_date) },
              ]}
              rows={deliveryOrders}
              rowKey={(row) => row.id}
              emptyMessage="No Delivery Order raised yet."
            />
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
