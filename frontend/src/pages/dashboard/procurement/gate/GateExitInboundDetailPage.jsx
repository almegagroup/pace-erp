/*
 * File-ID: 21.5
 * File-Path: frontend/src/pages/dashboard/procurement/gate/GateExitInboundDetailPage.jsx
 * Gate: 21
 * Phase: 21
 * Domain: PROCUREMENT
 * Purpose: View immutable inbound gate exit details
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { getActiveScreenContext, openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { getGateExitInbound } from "../procurementApi.js";

function formatNullable(value) {
  return value || "—";
}

export default function GateExitInboundDetailPage() {
  const navigate = useNavigate();
  const { id: routeId = "" } = useParams();
  const screenContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const id = routeId && routeId !== ":id" && routeId !== "id" ? routeId : (screenContext.id || "");
  const menu = useMenu();
  void menu;
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => setReloadTick((tick) => tick + 1),
    },
  });

  useEffect(() => {
    let active = true;

    async function load() {
      if (!id) {
        return;
      }
      setLoading(true);
      setError("");
      try {
        const data = await getGateExitInbound(id);
        if (!active) {
          return;
        }
        setDetail(data);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setDetail(null);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "PROCUREMENT_GATE_EXIT_INBOUND_FETCH_FAILED"
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [id, reloadTick]);

  function openGateEntry() {
    if (!detail?.gate_entry_id) {
      return;
    }
    openScreen(OPERATION_SCREENS.PROC_GATE_ENTRY_DETAIL.screen_code);
    navigate(
      `/dashboard/procurement/gate-entries/${encodeURIComponent(detail.gate_entry_id)}`
    );
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Inbound Gate Exit Detail"
      notices={
        error
          ? [{ key: "gate-exit-inbound-error", tone: "error", message: error }]
          : []
      }
      actions={[
        {
          key: "back",
          label: "Back",
          tone: "neutral",
          onClick: openGateEntry,
        },
      ]}
    >
      {loading || !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading inbound gate exit detail..." : "Inbound gate exit detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={detail.exit_number || "Inbound Gate Exit"}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
              <ErpFieldPreview label="Exit Date" value={formatNullable(detail.exit_date)} />
              <ErpFieldPreview label="Exit Time" value={formatNullable(detail.exit_time)} />
              <ErpFieldPreview label="Vehicle Number" value={formatNullable(detail.vehicle_number)} />
              <ErpFieldPreview label="Driver Name" value={formatNullable(detail.driver_name)} />
              <ErpFieldPreview label="Gate Staff ID" value={formatNullable(detail.gate_staff_id)} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Weights" title="Inbound exit weights">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <ErpFieldPreview label="RST Number (Tare)" value={formatNullable(detail.rst_number_tare)} />
              <ErpFieldPreview label="Tare Weight" value={formatNullable(detail.tare_weight)} />
              <ErpFieldPreview
                label="Net Weight (Calculated)"
                value={formatNullable(detail.net_weight_calculated)}
              />
              <ErpFieldPreview
                label="Net Weight (Override)"
                value={formatNullable(detail.net_weight_override)}
              />
              <ErpFieldPreview
                label="Effective Net Weight"
                value={formatNullable(detail.effective_net_weight)}
                tone="sky"
              />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Remarks" title="Notes">
            <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {detail.remarks || "—"}
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Linked Gate Entry" title="Source gate entry">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-slate-600">
                Gate Entry ID:{" "}
                <span className="font-semibold text-slate-900">
                  {detail.gate_entry_id || "—"}
                </span>
              </div>
              <button
                type="button"
                onClick={openGateEntry}
                className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900"
              >
                Open Gate Entry
              </button>
            </div>
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
