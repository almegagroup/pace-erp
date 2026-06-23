import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { listVendors } from "../../om/omApi.js";
import { openActionPrompt } from "../../../../store/actionPrompt.js";
import {
  approvePOOrderGroup,
  confirmPOOrderGroup,
  getPOOrderGroup,
  rejectPOOrderGroup,
} from "../procurementApi.js";

const PO_APPROVER_ROLES = new Set(["SA", "GA", "DIRECTOR", "L4_MANAGER", "L3_MANAGER", "L2_MANAGER"]);

function getStatusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "PENDING_APPROVAL":
      return "amber";
    case "CONFIRMED":
      return "emerald";
    case "CANCELLED":
      return "rose";
    default:
      return "slate";
  }
}

export default function POOrderGroupDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { shellProfile } = useMenu();
  const [group, setGroup] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const canApprove = PO_APPROVER_ROLES.has(shellProfile?.roleCode);

  async function loadDetail() {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const [groupData, vendorData] = await Promise.all([
        getPOOrderGroup(id),
        listVendors({ limit: 200, offset: 0 }),
      ]);
      setGroup(groupData);
      setVendors(Array.isArray(vendorData?.data) ? vendorData.data : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_PO_ORDER_GROUP_DETAIL_FAILED");
      setGroup(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [id]);

  const vendorMap = useMemo(() => new Map(vendors.map((entry) => [entry.id, entry])), [vendors]);

  async function runAction(action, successMessage) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
      await loadDetail();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_PO_ORDER_GROUP_ACTION_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    await runAction(
      () => confirmPOOrderGroup(id, { approval_required: true }),
      "Order sent for approval."
    );
  }

  async function handleApprove() {
    const remarks = (await openActionPrompt({ eyebrow: "Purchase Order Order", title: "Approve all POs in this order?", label: "Remarks (optional)", placeholder: "Optional approval remarks" })) ?? "";
    await runAction(
      () => approvePOOrderGroup(id, { remarks }),
      "All purchase orders in this group approved."
    );
  }

  async function handleReject() {
    const remarks = await openActionPrompt({ eyebrow: "Purchase Order Order", title: "Reject this order?", label: "Reject reason", required: true });
    if (!remarks) return;
    await runAction(
      () => rejectPOOrderGroup(id, { remarks }),
      "Order rejected — purchase orders sent back to draft."
    );
  }

  function openPo(po) {
    navigate(`/dashboard/procurement/purchase-orders/${encodeURIComponent(po.id)}`);
  }

  const pos = group?.purchase_orders ?? [];
  const totalValue = pos.reduce((sum, po) => {
    const lineTotal = (po.lines ?? []).reduce((lineSum, line) => lineSum + Number(line.total_value ?? 0), 0);
    return sum + lineTotal;
  }, 0);

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Purchase Order Approval"
      notices={[
        ...(error ? [{ key: "err", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "ok", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => navigate("/dashboard/procurement/po-order-groups") },
        ...(group?.status === "DRAFT" ? [{ key: "confirm", label: saving ? "Sending..." : "Confirm Order", tone: "primary", onClick: () => void handleConfirm(), disabled: saving }] : []),
        ...(group?.status === "PENDING_APPROVAL" && canApprove
          ? [
              { key: "approve", label: saving ? "Approving..." : "Approve Order", tone: "primary", onClick: () => void handleApprove(), disabled: saving },
              { key: "reject", label: "Reject Order", tone: "danger", onClick: () => void handleReject(), disabled: saving },
            ]
          : []),
      ]}
    >
      {loading || !group ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading order detail..." : "Order detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Order" title={`Vendor: ${vendorMap.get(group.vendor_id)?.vendor_name || group.vendor_id}`}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
              <ErpFieldPreview label="Status" value={group.status} tone={getStatusTone(group.status)} />
              <ErpFieldPreview label="Created" value={(group.created_at || "").slice(0, 10)} />
              <ErpFieldPreview label="Purchase Orders" value={String(pos.length)} />
              <ErpFieldPreview label="Total Value" value={totalValue.toFixed(2)} />
            </div>
            <p className="mt-2 text-xs text-slate-400">
              This "Order" is an internal grouping for approval only — the vendor never sees it, only the individual PO numbers below.
            </p>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Purchase Orders" title="Click a row to open and edit that PO">
            <ErpDenseGrid
              columns={[
                { key: "po_number", label: "PO Number", width: "160px" },
                {
                  key: "material",
                  label: "Material",
                  render: (po) => (po.lines ?? []).map((l) => l.material_id).join(", ") || "-",
                },
                {
                  key: "qty",
                  label: "Qty",
                  width: "100px",
                  render: (po) => (po.lines ?? []).map((l) => l.ordered_qty).join(", ") || "-",
                },
                {
                  key: "total_value",
                  label: "Value",
                  width: "120px",
                  align: "right",
                  render: (po) => (po.lines ?? []).reduce((sum, l) => sum + Number(l.total_value ?? 0), 0).toFixed(2),
                },
                {
                  key: "status",
                  label: "Status",
                  width: "150px",
                  render: (po) => (
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] bg-slate-100 text-slate-700`}>
                      {po.status}
                    </span>
                  ),
                },
              ]}
              rows={pos}
              rowKey={(po) => po.id}
              maxHeight="none"
              onRowActivate={openPo}
              getRowProps={(po) => ({ onDoubleClick: () => openPo(po), className: "cursor-pointer hover:bg-sky-50" })}
              emptyMessage="No purchase orders in this group."
            />
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
