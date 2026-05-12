import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import { listVendors } from "../../om/omApi.js";
import {
  amendPurchaseOrder,
  approveAmendment,
  approvePurchaseOrder,
  cancelPurchaseOrder,
  confirmPurchaseOrder,
  getPurchaseOrder,
  knockOffPOLine,
  knockOffPO,
  rejectPurchaseOrder,
} from "../procurementApi.js";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function listPoCsns(companyId, poId) {
  const params = new URLSearchParams();
  if (companyId) {
    params.set("company_id", companyId);
  }
  params.set("po_id", poId);
  params.set("limit", "200");
  params.set("offset", "0");
  const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/procurement/csns?${params.toString()}`, {
    credentials: "include",
  });
  const json = await readJsonSafe(response);
  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "PROCUREMENT_CSN_LIST_FAILED");
  }
  return json.data?.data ?? json.data ?? [];
}

function getHeaderStatusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "PENDING_APPROVAL":
      return "amber";
    case "CONFIRMED":
      return "sky";
    case "CLOSED":
      return "emerald";
    case "CANCELLED":
      return "rose";
    default:
      return "slate";
  }
}

function getLineStatusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "FULLY_RECEIVED":
      return "bg-emerald-100 text-emerald-800";
    case "PARTIALLY_RECEIVED":
      return "bg-amber-100 text-amber-800";
    case "KNOCKED_OFF":
    case "CANCELLED":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-sky-100 text-sky-800";
  }
}

function buildAmendmentState(lines, po) {
  return {
    delivery_date: po?.expected_delivery_date ?? "",
    remarks: "",
    lines: (lines ?? []).map((line) => ({
      id: line.id,
      material_id: line.material_id,
      ordered_qty: String(line.ordered_qty ?? ""),
      unit_rate: String(line.unit_rate ?? ""),
      original_qty: String(line.ordered_qty ?? ""),
      original_rate: String(line.unit_rate ?? ""),
    })),
  };
}

export default function PODetailPage() {
  const { id = "" } = useParams();
  const { shellProfile, runtimeContext } = useMenu();
  const [po, setPo] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [csns, setCsns] = useState([]);
  const [amendmentOpen, setAmendmentOpen] = useState(false);
  const [amendmentForm, setAmendmentForm] = useState({ delivery_date: "", remarks: "", lines: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const canApprove = shellProfile?.roleCode === "PROC_HEAD" || shellProfile?.roleCode === "SA";
  const vendorMap = useMemo(
    () => new Map(vendors.map((entry) => [entry.id, entry])),
    [vendors]
  );

  async function loadDetail() {
    if (!id) {
      setError("PROCUREMENT_PO_NOT_FOUND");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const detail = await getPurchaseOrder(id);
      const vendorData = await listVendors({ limit: 200, offset: 0 });
      const poRow = detail?.data ?? detail;
      const csnRows = await listPoCsns(poRow?.company_id || runtimeContext?.selectedCompanyId || "", id);
      setPo(poRow);
      setVendors(Array.isArray(vendorData?.data) ? vendorData.data : []);
      setCsns(Array.isArray(csnRows) ? csnRows : []);
      setAmendmentForm(buildAmendmentState(poRow?.lines, poRow));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_PO_DETAIL_FAILED");
      setPo(null);
      setCsns([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [id, runtimeContext?.selectedCompanyId]);

  async function runAction(action, successMessage) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
      await loadDetail();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_PO_ACTION_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    await runAction(
      () => confirmPurchaseOrder(id, { approval_required: true }),
      "Purchase order moved for approval."
    );
  }

  async function handleApprove() {
    const remarks = window.prompt("Approval remarks (optional)", "") ?? "";
    await runAction(
      () => approvePurchaseOrder(id, { remarks }),
      "Purchase order approved."
    );
  }

  async function handleReject() {
    const remarks = window.prompt("Reject reason", "");
    if (!remarks) {
      return;
    }
    await runAction(
      () => rejectPurchaseOrder(id, { remarks }),
      "Purchase order rejected."
    );
  }

  async function handleCancelPo() {
    const reason = window.prompt("Cancellation reason", "");
    if (!reason) {
      return;
    }
    await runAction(
      () => cancelPurchaseOrder(id, { reason }),
      "Purchase order cancelled."
    );
  }

  async function handleKnockOffPo() {
    const reason = window.prompt("Knock-off reason", "");
    if (!reason) {
      return;
    }
    await runAction(
      () => knockOffPO(id, { reason }),
      "Purchase order knocked off."
    );
  }

  async function handleKnockOffLine(lineId) {
    const reason = window.prompt("Line knock-off reason", "");
    if (!reason) {
      return;
    }
    await runAction(
      () => knockOffPOLine(id, lineId, { reason }),
      "PO line knocked off."
    );
  }

  async function handleApproveAmendment() {
    await runAction(
      () => approveAmendment(id),
      "Amendment approved."
    );
  }

  async function handleSubmitAmendment() {
    const changedLines = amendmentForm.lines.filter(
      (line) => line.ordered_qty !== line.original_qty || line.unit_rate !== line.original_rate
    );
    const headerChanged =
      amendmentForm.delivery_date !== String(po?.expected_delivery_date ?? "") ||
      amendmentForm.remarks.trim() !== "";

    if (!headerChanged && changedLines.length === 0) {
      setError("No amendment changes to submit.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (headerChanged) {
        await amendPurchaseOrder(id, {
          po_line_id: po?.lines?.[0]?.id,
          delivery_date: amendmentForm.delivery_date || null,
          remarks: amendmentForm.remarks.trim() || null,
        });
      }
      for (const line of changedLines) {
        await amendPurchaseOrder(id, {
          po_line_id: line.id,
          ordered_qty: Number(line.ordered_qty),
          unit_rate: Number(line.unit_rate),
          remarks: amendmentForm.remarks.trim() || null,
        });
      }
      setAmendmentOpen(false);
      setNotice("Purchase order amendment submitted.");
      await loadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_PO_AMEND_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const grnSummaryRows = useMemo(
    () =>
      Array.isArray(po?.lines)
        ? po.lines.map((line) => ({
            id: line.id,
            material_id: line.material_id,
            ordered_qty: Number(line.ordered_qty ?? 0),
            received_qty: Number((Number(line.ordered_qty ?? 0) - Number(line.open_qty ?? 0)).toFixed(6)),
            open_qty: Number(line.open_qty ?? 0),
          }))
        : [],
    [po?.lines]
  );

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Purchase Order Detail"
      notices={[
        ...(error ? [{ key: "po-detail-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "po-detail-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        ...(po?.status === "DRAFT" ? [{ key: "confirm", label: saving ? "Confirming..." : "Confirm", tone: "primary", onClick: () => void handleConfirm(), disabled: saving }] : []),
        ...(po?.status === "PENDING_APPROVAL" && canApprove
          ? [
              { key: "approve", label: saving ? "Approving..." : "Approve", tone: "primary", onClick: () => void handleApprove(), disabled: saving },
              { key: "reject", label: "Reject", tone: "danger", onClick: () => void handleReject(), disabled: saving },
            ]
          : []),
        ...(po?.status === "CONFIRMED"
          ? [
              { key: "amend", label: "Amend", tone: "neutral", onClick: () => setAmendmentOpen(true), disabled: saving },
              { key: "cancel", label: "Cancel PO", tone: "danger", onClick: () => void handleCancelPo(), disabled: saving },
              { key: "knockoff", label: "Knock-Off PO", tone: "neutral", onClick: () => void handleKnockOffPo(), disabled: saving },
            ]
          : []),
        ...(po?.status === "PENDING_AMENDMENT" && canApprove
          ? [{ key: "approve-amendment", label: "Approve Amendment", tone: "primary", onClick: () => void handleApproveAmendment(), disabled: saving }]
          : []),
      ]}
    >
      {loading || !po ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading purchase order detail..." : "Purchase order detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={`${po.po_number || "-"} | ${vendorMap.get(po.vendor_id)?.vendor_name || po.vendor_id || "-"}`}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <ErpFieldPreview label="Status" value={po.status} tone={getHeaderStatusTone(po.status)} />
              <ErpFieldPreview label="PO Date" value={po.po_date} />
              <ErpFieldPreview label="Company" value={po.company_id} />
              <ErpFieldPreview label="Delivery Type" value={po.delivery_type} />
              {po.delivery_type === "IMPORT" ? (
                <ErpFieldPreview label="Incoterm" value={po.incoterm || "—"} />
              ) : null}
              <ErpFieldPreview label="Freight Term" value={po.freight_term || "—"} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Lines" title="PO lines">
            <ErpDenseGrid
              columns={[
                { key: "line_number", label: "Line", width: "70px" },
                { key: "material_id", label: "Material" },
                { key: "ordered_qty", label: "Qty", width: "90px" },
                { key: "po_uom_code", label: "UOM", width: "90px" },
                { key: "unit_rate", label: "Rate", width: "90px" },
                {
                  key: "line_status",
                  label: "Status",
                  width: "140px",
                  render: (row) => (
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${getLineStatusTone(row.line_status)}`}>
                      {row.line_status}
                    </span>
                  ),
                },
                {
                  key: "actions",
                  label: "Actions",
                  width: "120px",
                  render: (row) =>
                    po.status === "CONFIRMED" ? (
                      <button
                        type="button"
                        onClick={() => void handleKnockOffLine(row.id)}
                        className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                      >
                        Knock-off
                      </button>
                    ) : "—",
                },
              ]}
              rows={po.lines ?? []}
              rowKey={(row) => row.id}
              emptyMessage="No PO lines found."
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="CSNs" title="CSN links">
            <div className="grid gap-2">
              {csns.length === 0 ? (
                <div className="text-sm text-slate-500">No CSNs are linked to this purchase order yet.</div>
              ) : (
                csns.map((row) => (
                  <Link
                    key={row.id}
                    to={`/dashboard/procurement/csns/${encodeURIComponent(row.id)}`}
                    className="text-sm font-semibold text-sky-700 underline underline-offset-2"
                  >
                    {row.csn_number || row.id}
                  </Link>
                ))
              )}
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Approval Log" title="Approval history">
            <ErpDenseGrid
              columns={[
                { key: "action", label: "Action", width: "120px" },
                { key: "from_status", label: "From", width: "120px" },
                { key: "to_status", label: "To", width: "120px" },
                { key: "remarks", label: "Remarks" },
                { key: "actioned_at", label: "At", width: "180px" },
              ]}
              rows={po.approval_log ?? []}
              rowKey={(row) => row.id}
              emptyMessage="No approval log rows available."
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Amendment Log" title="Amendment history">
            <ErpDenseGrid
              columns={[
                { key: "amendment_number", label: "Amendment #", width: "120px" },
                { key: "field_changed", label: "Field", width: "160px" },
                { key: "old_value", label: "Old Value" },
                { key: "new_value", label: "New Value" },
                { key: "approval_status", label: "Approval", width: "120px" },
                { key: "amended_at", label: "At", width: "180px" },
              ]}
              rows={po.amendment_log ?? []}
              rowKey={(row) => row.id}
              emptyMessage="No amendment log rows available."
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="GRN Summary" title="Ordered vs received">
            <ErpDenseGrid
              columns={[
                { key: "material_id", label: "Material" },
                { key: "ordered_qty", label: "Ordered Qty", width: "120px" },
                { key: "received_qty", label: "Received Qty", width: "120px" },
                { key: "open_qty", label: "Open Qty", width: "120px" },
              ]}
              rows={grnSummaryRows}
              rowKey={(row) => row.id}
              emptyMessage="No GRN summary rows available."
            />
          </ErpSectionCard>
        </div>
      )}

      {amendmentOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/30 p-4">
          <div className="w-full max-w-5xl border border-slate-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Amend Purchase Order</h2>
              <button type="button" onClick={() => setAmendmentOpen(false)} className="border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700">
                Close
              </button>
            </div>
            <div className="grid gap-4 p-4">
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Requires Procurement Head approval.
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Delivery Date
                  <input
                    type="date"
                    value={amendmentForm.delivery_date}
                    onChange={(event) => setAmendmentForm((current) => ({ ...current, delivery_date: event.target.value }))}
                    className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Remarks
                  <input
                    value={amendmentForm.remarks}
                    onChange={(event) => setAmendmentForm((current) => ({ ...current, remarks: event.target.value }))}
                    className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                  />
                </label>
              </div>
              <div className="grid gap-3">
                {amendmentForm.lines.map((line, index) => (
                  <div key={line.id} className="grid gap-3 border border-slate-200 bg-slate-50 p-3 md:grid-cols-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                      Line {index + 1} | {line.material_id}
                    </div>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">
                      Qty
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={line.ordered_qty}
                        onChange={(event) =>
                          setAmendmentForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) =>
                              entry.id === line.id ? { ...entry, ordered_qty: event.target.value } : entry
                            ),
                          }))
                        }
                        className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">
                      Rate
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={line.unit_rate}
                        onChange={(event) =>
                          setAmendmentForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) =>
                              entry.id === line.id ? { ...entry, unit_rate: event.target.value } : entry
                            ),
                          }))
                        }
                        className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                      />
                    </label>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setAmendmentOpen(false)} className="border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
                  Cancel
                </button>
                <button type="button" disabled={saving} onClick={() => void handleSubmitAmendment()} className="border border-sky-700 bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50">
                  {saving ? "Submitting..." : "Submit Amendment"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </ErpScreenScaffold>
  );
}
