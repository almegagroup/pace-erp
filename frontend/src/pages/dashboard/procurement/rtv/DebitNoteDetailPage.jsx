/*
 * File-ID: 21.2
 * File-Path: frontend/src/pages/dashboard/procurement/rtv/DebitNoteDetailPage.jsx
 * Gate: 21
 * Phase: 21
 * Domain: PROCUREMENT
 * Purpose: View debit note detail and lifecycle progression
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { getActiveScreenContext, openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  acknowledgeDebitNote,
  getDebitNote,
  markDebitNoteSent,
  settleDebitNote,
} from "../procurementApi.js";
import { openActionConfirm } from "../../../../store/actionConfirm.js";
import { MASTER_PICKER_FETCH_LIMIT, useVendorOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "SENT":
      return "sky";
    case "ACKNOWLEDGED":
      return "violet";
    case "SETTLED":
      return "emerald";
    case "DRAFT":
    default:
      return "amber";
  }
}

function formatNumber(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return "0.0000";
  }
  return amount.toLocaleString("en-IN", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

function formatNullable(value) {
  return value || "—";
}

export default function DebitNoteDetailPage() {
  const navigate = useNavigate();
  const { id: routeId = "" } = useParams();
  const screenContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const id = routeId && routeId !== ":id" && routeId !== "id" ? routeId : (screenContext.id || "");
  const menu = useMenu();
  void menu;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const vendorQuery = useVendorOptionsQuery({ limit: MASTER_PICKER_FETCH_LIMIT, offset: 0 });
  const detailQuery = useQuery({
    queryKey: ["procurement", "debit-note-detail", id],
    queryFn: () => getDebitNote(id),
    enabled: Boolean(id),
  });
  const detail = detailQuery.data ?? null;
  const vendors = vendorQuery.vendors;
  const loading = detailQuery.isLoading || vendorQuery.isLoading;

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void detailQuery.refetch(),
    },
  });

  const vendorMap = useMemo(
    () => new Map(vendors.map((entry) => [entry.id, entry])),
    [vendors]
  );

  useEffect(() => {
    if (!id) {
      setError("PROCUREMENT_DEBIT_NOTE_FETCH_FAILED");
      return;
    }
    const nextError =
      detailQuery.error?.message ||
      vendorQuery.error?.message ||
      "";
    setError(nextError);
  }, [detailQuery.error, id, vendorQuery.error]);

  async function runAction(action, successMessage) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
      await Promise.all([detailQuery.refetch(), vendorQuery.refetch()]);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "PROCUREMENT_DEBIT_NOTE_ACTION_FAILED"
      );
    } finally {
      setSaving(false);
    }
  }

  function goBack() {
    openScreen(OPERATION_SCREENS.PROC_DEBIT_NOTE_LIST.screen_code);
    navigate("/dashboard/procurement/debit-notes");
  }

  function openRtv() {
    if (!detail?.rtv_id) {
      return;
    }
    openScreen(OPERATION_SCREENS.PROC_RTV_DETAIL.screen_code);
    navigate(`/dashboard/procurement/rtvs/${encodeURIComponent(detail.rtv_id)}`);
  }

  function buildActionConfig() {
    const currentStatus = String(detail?.status || "").toUpperCase();
    if (currentStatus === "DRAFT") {
      return {
        key: "mark-sent",
        label: saving ? "Marking..." : "Mark Sent",
        onClick: async () => {
          const ok1 = await openActionConfirm({ eyebrow: "Debit Note", title: "Mark as sent?", confirmLabel: "Mark Sent" });
          if (!ok1) return;
          await runAction(() => markDebitNoteSent(id), "Debit note marked sent.");
        },
      };
    }
    if (currentStatus === "SENT") {
      return {
        key: "acknowledge",
        label: saving ? "Acknowledging..." : "Acknowledge",
        onClick: async () => {
          const ok2 = await openActionConfirm({ eyebrow: "Debit Note", title: "Acknowledge this debit note?", confirmLabel: "Acknowledge" });
          if (!ok2) return;
          await runAction(
            () => acknowledgeDebitNote(id),
            "Debit note acknowledged."
          );
        },
      };
    }
    if (currentStatus === "ACKNOWLEDGED") {
      return {
        key: "settle",
        label: saving ? "Settling..." : "Settle",
        onClick: async () => {
          const ok3 = await openActionConfirm({ eyebrow: "Debit Note", title: "Settle this debit note?", confirmLabel: "Settle" });
          if (!ok3) return;
          await runAction(() => settleDebitNote(id), "Debit note settled.");
        },
      };
    }
    return null;
  }

  const actionConfig = buildActionConfig();

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Debit Note Detail"
      notices={[
        ...(error
          ? [{ key: "dn-detail-error", tone: "error", message: error }]
          : []),
        ...(notice
          ? [{ key: "dn-detail-notice", tone: "success", message: notice }]
          : []),
      ]}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: goBack },
        ...(actionConfig
          ? [
              {
                key: actionConfig.key,
                label: actionConfig.label,
                tone: "primary",
                disabled: saving,
                onClick: () => void actionConfig.onClick(),
              },
            ]
          : []),
      ]}
    >
      {loading || !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading debit note detail..." : "Debit note detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={detail.dn_number || "Debit Note"}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
              <ErpFieldPreview
                label="Status"
                value={formatNullable(detail.status)}
                tone={statusTone(detail.status)}
              />
              <ErpFieldPreview label="DN Date" value={formatNullable(detail.dn_date)} />
              <ErpFieldPreview
                label="Vendor"
                value={
                  vendorMap.get(detail.vendor_id)?.vendor_name ||
                  vendorMap.get(detail.vendor_id)?.vendor_code ||
                  detail.vendor_id ||
                  "—"
                }
              />
              <ErpFieldPreview label="Company" value={formatNullable(detail.company_id)} />
              <ErpFieldPreview label="Linked RTV" value={formatNullable(detail.rtv_id)} />
            </div>
            {detail.rtv_id ? (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={openRtv}
                  className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900"
                >
                  Open RTV
                </button>
              </div>
            ) : null}
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Values" title="Debit note value breakdown">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <ErpFieldPreview label="Material Value" value={formatNumber(detail.material_value)} />
              <ErpFieldPreview label="Freight Amount" value={formatNumber(detail.freight_amount)} />
              <ErpFieldPreview label="Insurance Amount" value={formatNumber(detail.insurance_amount)} />
              <ErpFieldPreview label="Customs Duty" value={formatNumber(detail.customs_duty_amount)} />
              <ErpFieldPreview label="CHA Charges" value={formatNumber(detail.cha_charges_amount)} />
              <ErpFieldPreview label="Loading Charges" value={formatNumber(detail.loading_charges)} />
              <ErpFieldPreview label="Unloading Charges" value={formatNumber(detail.unloading_charges)} />
              <ErpFieldPreview label="Other Charges" value={formatNumber(detail.other_charges)} />
              <ErpFieldPreview
                label="Total Value"
                value={formatNumber(detail.total_value)}
                tone="sky"
              />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Lifecycle" title="Debit note milestones">
            <div className="grid gap-3 md:grid-cols-3">
              <ErpFieldPreview label="Sent At" value={formatNullable(detail.sent_at)} />
              <ErpFieldPreview
                label="Acknowledged At"
                value={formatNullable(detail.acknowledged_at)}
              />
              <ErpFieldPreview label="Settled At" value={formatNullable(detail.settled_at)} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Remarks" title="Notes">
            <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {detail.remarks || "—"}
            </div>
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
