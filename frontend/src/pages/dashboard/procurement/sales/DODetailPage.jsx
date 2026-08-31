/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/DODetailPage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: DO detail (read view) — §133.12 multi-source redesign. Uses the
 *          unified GET (getDeliveryOrderUnified/hydrateDeliveryOrderUnified)
 *          for every DO, old and new alike: that hydrator synthesizes a
 *          single-source "sources" row from a pre-redesign DO's own header
 *          sales_order_id/sto_id, so one detail view correctly serves both
 *          shapes without branching here. Cancel is unchanged (the shared
 *          cancelDeliveryOrderHandler route/endpoint already handles both).
 *          Edit (§133.12, backend done) has no UI entry point yet — flagged,
 *          not yet built; re-opening the 3-page wizard pre-loaded with an
 *          existing DO's lines is its own follow-up increment.
 * Authority: Frontend
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import { getActiveScreenContext, openScreenWithContext } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { openActionPrompt } from "../../../../store/actionPrompt.js";
import { amendDeliveryOrderDispatchDetails, cancelDeliveryOrder, getDeliveryOrderUnified, listTransporters } from "../procurementApi.js";

export default function DODetailPage() {
  const navigate = useNavigate();
  const routeParams = useParams();
  const routeId = routeParams.id;
  const id = routeId && routeId !== ":id" && routeId !== "id" ? routeId : getActiveScreenContext()?.id;
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [amendOpen, setAmendOpen] = useState(false);
  const [amendment, setAmendment] = useState({ transporter_id: "", vehicle_number: "", lr_number: "", lr_date: "", reason: "" });

  const doQuery = useQuery({
    queryKey: ["procurement", "delivery-order-v2", id],
    queryFn: () => getDeliveryOrderUnified(id),
    enabled: Boolean(id),
  });

  const data = doQuery.data ?? {};
  const lines = Array.isArray(data.lines) ? data.lines : [];
  const transporterQuery = useQuery({
    queryKey: ["procurement", "transporters", data.selling_company_id],
    queryFn: () => listTransporters({ company_id: data.selling_company_id, is_active: "true", limit: 500 }),
    enabled: amendOpen && Boolean(data.selling_company_id),
  });
  const transporters = Array.isArray(transporterQuery.data) ? transporterQuery.data : (transporterQuery.data?.items ?? transporterQuery.data?.data ?? []);

  useErpScreenHotkeys({
    refresh: { disabled: doQuery.isLoading, perform: () => void doQuery.refetch() },
  });

  // §113.15 -- DO cancel only valid pre-PGI (status CREATED); once
  // DISPATCHED, reversal happens through the Invoice instead.
  const canCancel = data.status === "CREATED";
  // §133.12 -- Edit is likewise only valid pre-PGI; reopens DO01CreatePage
  // pre-seeded from this DO's own saved lines (updateDeliveryOrderUnifiedHandler).
  const canEdit = data.status === "CREATED";

  function openEdit() {
    navigate(`/dashboard/procurement/delivery-orders/${encodeURIComponent(id)}/edit`);
  }

  async function handleCancel() {
    const reason = await openActionPrompt({ eyebrow: "Delivery Order", title: "Cancel this DO?", label: "Cancellation reason", required: true });
    if (!reason) return;
    setSaving(true);
    setActionError("");
    setNotice("");
    try {
      await cancelDeliveryOrder(id, { reason });
      setNotice("Delivery order cancelled.");
      await doQuery.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "PROCUREMENT_DO_CANCEL_FAILED");
    } finally {
      setSaving(false);
    }
  }

  function openInvoiceDetail() {
    if (!data.invoice_id) return;
    openScreenWithContext(OPERATION_SCREENS.PROC_INV_PGI_GROUPS.screen_code, { dcId: id, refreshOnReturn: true });
    navigate("/dashboard/procurement/sales-invoices/pgi-groups");
  }

  function openAmendment() {
    setActionError("");
    setAmendment({ transporter_id: data.transporter_id || "", vehicle_number: data.vehicle_number || "", lr_number: data.lr_number || "", lr_date: data.lr_date || "", reason: "" });
    setAmendOpen(true);
  }

  async function saveAmendment() {
    if (!amendment.reason.trim()) {
      setActionError("Amendment reason is required.");
      return;
    }
    setSaving(true);
    setActionError("");
    try {
      await amendDeliveryOrderDispatchDetails(id, amendment);
      setAmendOpen(false);
      setNotice("Dispatch details amended. Stock, invoice amount and reconciliation were not changed.");
      await doQuery.refetch();
    } catch (amendmentError) {
      setActionError(amendmentError instanceof Error ? amendmentError.message : "DISPATCH_AMENDMENT_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title={data.dc_number ? `Delivery Order — ${data.dc_number}` : "Delivery Order"}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        ...(data.invoice_id ? [{ key: "open-invoice", label: "View Invoice Groups", tone: "neutral", onClick: openInvoiceDetail }] : []),
        ...(data.status === "DISPATCHED" ? [{ key: "amend-dispatch", label: "Amend Dispatch Details", tone: "neutral", onClick: openAmendment, disabled: saving }] : []),
        ...(canEdit ? [{ key: "edit", label: "Edit DO", tone: "neutral", onClick: openEdit, disabled: saving }] : []),
        ...(canCancel ? [{ key: "cancel", label: saving ? "Cancelling..." : "Cancel DO", tone: "danger", onClick: () => void handleCancel(), disabled: saving }] : []),
      ]}
      notices={[
        ...(doQuery.error ? [{ key: "do-detail-error", tone: "error", message: doQuery.error instanceof Error ? doQuery.error.message : "PROCUREMENT_DO_FETCH_FAILED" }] : []),
        ...(actionError ? [{ key: "do-action-error", tone: "error", message: actionError }] : []),
        ...(notice ? [{ key: "do-action-notice", tone: "success", message: notice }] : []),
      ]}
    >
      {doQuery.isLoading ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">Loading delivery order...</div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title="Delivery order summary — one vehicle, may carry lines from multiple SO/STO documents (§133.12)">
            <div className="grid gap-3 md:grid-cols-3 text-sm">
              <div><span className="text-xs text-slate-500">DO Number</span><div className="font-mono font-semibold">{data.dc_number}</div></div>
              <div><span className="text-xs text-slate-500">Date</span><div>{data.dc_date}</div></div>
              <div><span className="text-xs text-slate-500">Status</span><div>{data.status}</div></div>
              <div><span className="text-xs text-slate-500">Type</span><div>{data.dc_type}</div></div>
              <div><span className="text-xs text-slate-500">Vehicle</span><div>{data.vehicle_number || "—"}</div></div>
              <div><span className="text-xs text-slate-500">Transporter</span><div>{data.transporter_display || "—"}</div></div>
              <div><span className="text-xs text-slate-500">LR Number</span><div>{data.lr_number || "—"}</div></div>
              <div><span className="text-xs text-slate-500">LR Date</span><div>{data.lr_date || "—"}</div></div>
              <div><span className="text-xs text-slate-500">Gross Weight</span><div>{data.gross_weight ?? "—"}</div></div>
              <div><span className="text-xs text-slate-500">Net Weight</span><div>{data.net_weight ?? "—"}</div></div>
              <div><span className="text-xs text-slate-500">Driver Number</span><div>{data.driver_number || data.driver_name || "—"}</div></div>
              <div><span className="text-xs text-slate-500">Driver Contact Number</span><div>{data.driver_contact_number || "—"}</div></div>
              {data.remarks ? <div className="md:col-span-3"><span className="text-xs text-slate-500">Remarks</span><div>{data.remarks}</div></div> : null}
              {data.status === "CANCELLED" ? (
                <div className="md:col-span-3"><span className="text-xs text-slate-500">Cancellation Reason</span><div>{data.cancellation_reason || "—"}</div></div>
              ) : null}
            </div>
          </ErpSectionCard>

          {amendOpen ? (
            <ErpSectionCard eyebrow="Post-PGI Amendment" title="Correct transporter / vehicle / LR details only">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm"><span className="text-xs text-slate-500">Transporter</span><select value={amendment.transporter_id} onChange={(event) => setAmendment((current) => ({ ...current, transporter_id: event.target.value }))} className="h-9 border border-slate-300 bg-white px-2"><option value="">No transporter</option>{transporters.map((transporter) => <option key={transporter.id} value={transporter.id}>{transporter.transporter_name}</option>)}</select></label>
                <label className="grid gap-1 text-sm"><span className="text-xs text-slate-500">Vehicle Number</span><input value={amendment.vehicle_number} onChange={(event) => setAmendment((current) => ({ ...current, vehicle_number: event.target.value }))} className="h-9 border border-slate-300 px-2" /></label>
                <label className="grid gap-1 text-sm"><span className="text-xs text-slate-500">LR Number</span><input value={amendment.lr_number} onChange={(event) => setAmendment((current) => ({ ...current, lr_number: event.target.value }))} className="h-9 border border-slate-300 px-2" /></label>
                <label className="grid gap-1 text-sm"><span className="text-xs text-slate-500">LR Date</span><input type="date" value={amendment.lr_date} onChange={(event) => setAmendment((current) => ({ ...current, lr_date: event.target.value }))} className="h-9 border border-slate-300 px-2" /></label>
                <label className="grid gap-1 text-sm md:col-span-2"><span className="text-xs text-slate-500">Reason</span><input value={amendment.reason} onChange={(event) => setAmendment((current) => ({ ...current, reason: event.target.value }))} className="h-9 border border-slate-300 px-2" placeholder="Why are these dispatch details changing?" /></label>
                <div className="flex gap-2 md:col-span-2"><button type="button" onClick={() => setAmendOpen(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-semibold">Close</button><button type="button" disabled={saving} onClick={() => void saveAmendment()} className="border border-slate-800 bg-slate-800 px-4 py-2 text-xs font-semibold text-white">Save Amendment</button></div>
              </div>
            </ErpSectionCard>
          ) : null}

          {Array.isArray(data.dispatch_amendments) && data.dispatch_amendments.length > 0 ? (
            <ErpSectionCard eyebrow="Audit" title="Dispatch amendment history">
              <ErpDenseGrid cellNavigate columns={[{ key: "amended_at", label: "When", width: "180px" }, { key: "amendment_reason", label: "Reason" }, { key: "old_lr_number", label: "Old LR", width: "120px" }, { key: "new_lr_number", label: "New LR", width: "120px" }, { key: "old_vehicle_number", label: "Old Vehicle", width: "130px" }, { key: "new_vehicle_number", label: "New Vehicle", width: "130px" }]} rows={data.dispatch_amendments} rowKey={(row) => row.id} />
            </ErpSectionCard>
          ) : null}

          {data.invoice_id ? (
            <ErpSectionCard eyebrow="PGI & Invoice" title="What this DO's goods issue posted">
              <div className="grid gap-3 md:grid-cols-3 text-sm">
                <div><span className="text-xs text-slate-500">Invoice Number</span><div className="font-mono font-semibold">{data.invoice_number || "—"}</div></div>
                <div><span className="text-xs text-slate-500">Invoice Date</span><div>{data.invoice_date || "—"}</div></div>
                <div><span className="text-xs text-slate-500">Invoice Status</span><div>{data.invoice_status || "—"}</div></div>
                <div><span className="text-xs text-slate-500">Tally Invoice Number</span><div>{data.tally_invoice_number || "—"}</div></div>
                <div><span className="text-xs text-slate-500">Tally Invoice Date</span><div>{data.tally_invoice_date || "—"}</div></div>
              </div>
            </ErpSectionCard>
          ) : null}

          <ErpSectionCard eyebrow="Source Documents" title="Every SO/STO this DO drew items from — Bill-To/Ship-To resolve fresh at Invoice/PGI time, not shown here (§133.12-addendum)">
            <ErpDenseGrid
              cellNavigate
              columns={[
                { key: "source_type", label: "Type", width: "110px", render: (row) => (row.source_type === "SALES_ORDER" ? "Sales Order" : "STO") },
                { key: "document_number", label: "Document Number", width: "160px", render: (row) => <span className="font-mono font-semibold">{row.document_number || "—"}</span> },
                { key: "document_date", label: "Date", width: "110px" },
                { key: "party_display", label: "Party / Receiving Company", render: (row) => row.party_display || "—" },
              ]}
              rows={Array.isArray(data.sources) ? data.sources : []}
              rowKey={(row) => `${row.source_type}:${row.source_id}`}
              emptyMessage="No source documents recorded."
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Lines" title={`${lines.length} line${lines.length === 1 ? "" : "s"}`}>
            <ErpDenseGrid
              cellNavigate
              columns={[
                { key: "line_number", label: "#", width: "50px" },
                { key: "material_id", label: "Material", render: (row) => row.material_display || row.material_id },
                { key: "document_name", label: "Document Name", width: "180px", render: (row) => row.document_name || "—" },
                { key: "quantity", label: "Qty", width: "100px", render: (row) => `${row.quantity} ${row.uom_code || ""}` },
                { key: "batch_number", label: "Batch", width: "110px", render: (row) => row.batch_number || "-" },
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
