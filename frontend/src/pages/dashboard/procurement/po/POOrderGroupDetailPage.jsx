import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { useMenu } from "../../../../context/useMenu.js";
import { getActiveScreenContext, openScreen, openScreenWithContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
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
  const { id: routeId = "" } = useParams();
  const screenContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const id = routeId && routeId !== ":id" && routeId !== "id" ? routeId : (screenContext.id || "");
  const navigate = useNavigate();
  const { shellProfile } = useMenu();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const groupQuery = useQuery({
    queryKey: ["procurement", "po-order-group-detail", id],
    enabled: Boolean(id),
    queryFn: () => getPOOrderGroup(id),
  });
  const group = groupQuery.data ?? null;
  const loading = groupQuery.isLoading;

  useErpScreenHotkeys({
    refresh: {
      disabled: groupQuery.isFetching,
      perform: () => void groupQuery.refetch(),
    },
  });

  const canApprove = PO_APPROVER_ROLES.has(shellProfile?.roleCode);
  useEffect(() => {
    setError(groupQuery.error?.message || "");
  }, [groupQuery.error?.message]);

  async function runAction(action, successMessage) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
      await groupQuery.refetch();
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
    openScreenWithContext(
      OPERATION_SCREENS.PROC_PO_DETAIL.screen_code,
      { id: po.id, refreshOnReturn: true }
    );
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
        {
          key: "back",
          label: "Back",
          tone: "neutral",
          onClick: () => {
            try {
              popScreen();
            } catch {
              openScreen(OPERATION_SCREENS.PROC_PO_ORDER_APPROVALS.screen_code);
              navigate("/dashboard/procurement/po-order-groups");
            }
          },
        },
        {
          key: "refresh",
          label: groupQuery.isFetching ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void groupQuery.refetch(),
          disabled: groupQuery.isFetching,
        },
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
          <ErpSectionCard eyebrow="Order" title={`Vendor: ${group.vendor_display || "—"}`}>
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
                  render: (po) => (po.lines ?? []).map((l) => l.material_display || "—").join(", ") || "-",
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
