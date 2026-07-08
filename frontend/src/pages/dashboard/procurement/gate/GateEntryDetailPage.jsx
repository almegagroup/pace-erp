import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { openActionConfirm } from "../../../../store/actionConfirm.js";
import { isRouteAllowed } from "../../../../router/routeIndex.js";
import { getActiveScreenContext, openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  createGateExitInbound,
  getGateEntry,
  pruneGateEntry,
} from "../procurementApi.js";

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "GRN_POSTED":
    case "CLOSED":
      return "emerald";
    case "OPEN":
      return "sky";
    case "PRUNED":
    case "CANCELLED":
      return "rose";
    default:
      return "slate";
  }
}

export default function GateEntryDetailPage() {
  const navigate = useNavigate();
  const { id: routeId = "" } = useParams();
  const screenContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const id = routeId && routeId !== ":id" ? routeId : (screenContext.id || "");
  const { runtimeContext, allowedRoutes } = useMenu();
  const canPruneGe = isRouteAllowed(allowedRoutes ?? new Set(), "/dashboard/procurement/grns/:id");
  const queryClient = useQueryClient();
  const [gateExitForm, setGateExitForm] = useState({
    exit_date: new Date().toISOString().slice(0, 10),
    exit_time: "",
    tare_weight: "",
    net_weight_override: "",
    rst_number_tare: "",
    remarks: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  void runtimeContext;

  const { data: detail, isLoading: loading, error: queryError } = useQuery({
    queryKey: ["procurement", "ge-detail", id],
    enabled: Boolean(id),
    queryFn: () => getGateEntry(id),
  });

  const fetchError = queryError instanceof Error ? queryError.message : (queryError ? "GE_FETCH_FAILED" : "");

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void queryClient.invalidateQueries({ queryKey: ["procurement", "ge-detail", id] }),
    },
  });

  const hasGateExit = Boolean(detail?.gate_exit_inbound?.id);
  const weightedInbound = useMemo(
    () => Array.isArray(detail?.lines) && detail.lines.some((line) => Number(line.gross_weight ?? 0) > 0),
    [detail?.lines]
  );

  async function handleCreateGateExit() {
    if (!detail?.id) return;
    if (weightedInbound && !gateExitForm.tare_weight) {
      setError(
        "Tare weight is required for BULK/TANKER or weighed inbound gate exits."
      );
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await createGateExitInbound({
        gate_entry_id: detail.id,
        exit_date: gateExitForm.exit_date,
        exit_time: gateExitForm.exit_time || null,
        tare_weight: gateExitForm.tare_weight
          ? Number(gateExitForm.tare_weight)
          : null,
        net_weight_override: gateExitForm.net_weight_override
          ? Number(gateExitForm.net_weight_override)
          : null,
        rst_number_tare: gateExitForm.rst_number_tare || null,
        remarks: gateExitForm.remarks || null,
      });
      setNotice("Inbound gate exit created.");
      openScreen(OPERATION_SCREENS.PROC_GATE_EXIT_INBOUND_DETAIL.screen_code);
      navigate(
        `/dashboard/procurement/gate-exits/inbound/${encodeURIComponent(result.id)}`
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "GEX_CREATE_FAILED"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateGrn() {
    if (!detail?.id) return;
    const existingGrnId = (detail.lines ?? []).find(
      (line) => line.linked_csn?.grn_id
    )?.linked_csn?.grn_id;
    if (existingGrnId) {
      openScreen(OPERATION_SCREENS.PROC_GRN_DETAIL.screen_code);
      navigate(`/dashboard/procurement/grns/${encodeURIComponent(existingGrnId)}`);
      return;
    }
    openScreen(OPERATION_SCREENS.PROC_GRN_POST_FLOW.screen_code);
    navigate("/dashboard/procurement/grns/post");
  }

  async function handlePrune() {
    if (!detail?.id) return;
    const linkedGrns = Array.isArray(detail.linked_grns) ? detail.linked_grns : [];
    const blockedGrns = linkedGrns.filter((g) => String(g.status || "").toUpperCase() !== "REVERSED");
    if (blockedGrns.length > 0) {
      const blockedList = blockedGrns.map((g) => g.grn_number).join(", ");
      await openActionConfirm({
        eyebrow: "Cannot Prune",
        title: "Linked GRNs must be reversed first",
        message: `The following GRN(s) are linked to this Gate Entry and have not been reversed yet. Reverse them before pruning.\n\nPending: ${blockedList}`,
        confirmLabel: "OK",
        cancelLabel: null,
      });
      return;
    }
    const confirmed = await openActionConfirm({
      eyebrow: "GE Prune",
      title: `Prune Gate Entry ${detail.ge_number}?`,
      message: "GE will be marked PRUNED. All linked CSNs will be released back to their previous status. Serial number stays occupied. This cannot be undone.",
      confirmLabel: "Prune GE",
    });
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const pruned = await pruneGateEntry(detail.id);
      queryClient.setQueryData(["procurement", "ge-detail", id], pruned);
      setNotice("Gate entry pruned. CSNs have been released.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "GE_PRUNE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  function openGateExitDetail() {
    if (!detail?.gate_exit_inbound?.id) {
      return;
    }
    openScreen(OPERATION_SCREENS.PROC_GATE_EXIT_INBOUND_DETAIL.screen_code);
    navigate(
      `/dashboard/procurement/gate-exits/inbound/${encodeURIComponent(
        detail.gate_exit_inbound.id
      )}`
    );
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Gate Entry Detail"
      notices={[
        ...(fetchError || error
          ? [{ key: "ge-detail-error", tone: "error", message: fetchError || error }]
          : []),
        ...(notice
          ? [{ key: "ge-detail-notice", tone: "success", message: notice }]
          : []),
      ]}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        ...(canPruneGe && !["PRUNED", "CANCELLED"].includes(String(detail?.status || "").toUpperCase())
          ? [{ key: "prune", label: saving ? "Pruning..." : "Prune GE", tone: "danger", onClick: () => void handlePrune(), disabled: saving }]
          : []),
      ]}
    >
      {loading || !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading
            ? "Loading gate entry detail..."
            : "Gate entry detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={detail.ge_number || "Gate Entry"}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <ErpFieldPreview label="Entry Date" value={detail.ge_date || "—"} />
              <ErpFieldPreview label="Vehicle" value={detail.vehicle_number || "—"} />
              <ErpFieldPreview label="Driver" value={detail.driver_name || "—"} />
              <ErpFieldPreview
                label="Status"
                value={detail.status || "—"}
                tone={statusTone(detail.status)}
              />
              <ErpFieldPreview label="Remarks" value={detail.remarks || "—"} />
              <ErpFieldPreview label="GE Type" value={detail.ge_type || "—"} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Lines" title="Gate entry lines">
            <ErpDenseGrid
              columns={[
                { key: "line_number", label: "Line", width: "70px" },
                { key: "material_name", label: "Material", width: "220px", render: (row) => row.material_name || row.material_id || "—" },
                {
                  key: "linked_csn",
                  label: "CSN",
                  width: "140px",
                  render: (row) => row.linked_csn?.csn_number || row.csn_id || "—",
                },
                { key: "ge_qty", label: "Received Qty", width: "110px" },
                { key: "uom_code", label: "UOM", width: "90px" },
                { key: "gross_weight", label: "Gross Wt", width: "110px" },
                { key: "net_weight", label: "Net Wt", width: "110px" },
              ]}
              rows={detail.lines ?? []}
              rowKey={(row) => row.id}
              emptyMessage="No gate entry lines found."
            />
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Gate Exit" title="Inbound gate exit">
            {hasGateExit ? (
              <div className="grid gap-3">
                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <ErpFieldPreview
                    label="Exit Number"
                    value={detail.gate_exit_inbound.exit_number || "—"}
                  />
                  <ErpFieldPreview
                    label="Exit Date"
                    value={detail.gate_exit_inbound.exit_date || "—"}
                  />
                  <ErpFieldPreview
                    label="Tare Weight"
                    value={detail.gate_exit_inbound.tare_weight || "—"}
                  />
                  <ErpFieldPreview
                    label="Net Calculated"
                    value={detail.gate_exit_inbound.net_weight_calculated || "—"}
                  />
                  <ErpFieldPreview
                    label="Net Override"
                    value={detail.gate_exit_inbound.net_weight_override || "—"}
                  />
                  <ErpFieldPreview
                    label="Effective Net"
                    value={detail.gate_exit_inbound.effective_net_weight || "—"}
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={openGateExitDetail}
                    className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900"
                  >
                    Open Gate Exit
                  </button>
                </div>
              </div>
            ) : detail.status === "OPEN" ? (
              <div className="grid gap-3">
                <div className="grid gap-3 lg:grid-cols-2">
                  <ErpDenseFormRow label="Exit Date">
                    <input
                      type="date"
                      value={gateExitForm.exit_date}
                      onChange={(event) =>
                        setGateExitForm((current) => ({
                          ...current,
                          exit_date: event.target.value,
                        }))
                      }
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Exit Time">
                    <input
                      type="time"
                      value={gateExitForm.exit_time}
                      onChange={(event) =>
                        setGateExitForm((current) => ({
                          ...current,
                          exit_time: event.target.value,
                        }))
                      }
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Tare Weight" required={weightedInbound}>
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={gateExitForm.tare_weight}
                      onChange={(event) =>
                        setGateExitForm((current) => ({
                          ...current,
                          tare_weight: event.target.value,
                        }))
                      }
                      className={`h-8 w-full border px-2 text-sm outline-none focus:border-sky-500 ${
                        weightedInbound
                          ? "border-amber-300 bg-amber-50"
                          : "border-slate-300 bg-white"
                      }`}
                    />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Net Override">
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={gateExitForm.net_weight_override}
                      onChange={(event) =>
                        setGateExitForm((current) => ({
                          ...current,
                          net_weight_override: event.target.value,
                        }))
                      }
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="RST Number">
                    <input
                      value={gateExitForm.rst_number_tare}
                      onChange={(event) =>
                        setGateExitForm((current) => ({
                          ...current,
                          rst_number_tare: event.target.value,
                        }))
                      }
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Remarks">
                    <input
                      value={gateExitForm.remarks}
                      onChange={(event) =>
                        setGateExitForm((current) => ({
                          ...current,
                          remarks: event.target.value,
                        }))
                      }
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleCreateGateExit()}
                    disabled={saving}
                    className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50"
                  >
                    {saving ? "Creating..." : "Create Gate Exit"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-500">
                Gate exit can only be created while the gate entry is open.
              </div>
            )}
          </ErpSectionCard>

          {Array.isArray(detail.linked_grns) && detail.linked_grns.length > 0 && (
            <ErpSectionCard eyebrow="Linked GRNs" title="Goods receipts linked to this gate entry">
              <ErpDenseGrid
                columns={[
                  { key: "grn_number", label: "GRN Number", width: "160px" },
                  {
                    key: "status",
                    label: "Status",
                    width: "140px",
                    render: (row) => {
                      const s = String(row.status || "").toUpperCase();
                      const tone =
                        s === "REVERSED" ? "bg-rose-100 text-rose-800" :
                        s === "POSTED" ? "bg-emerald-100 text-emerald-800" :
                        "bg-amber-100 text-amber-800";
                      return (
                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${tone}`}>
                          {row.status}
                        </span>
                      );
                    },
                  },
                  {
                    key: "prune_block",
                    label: "",
                    width: "200px",
                    render: (row) =>
                      String(row.status || "").toUpperCase() !== "REVERSED" ? (
                        <span className="text-[11px] text-rose-600 font-medium">Must reverse before prune</span>
                      ) : null,
                  },
                ]}
                rows={detail.linked_grns}
                rowKey={(row) => row.id}
                emptyMessage="No GRNs linked."
              />
            </ErpSectionCard>
          )}

          <ErpSectionCard eyebrow="GRN" title="Goods receipt">
            {hasGateExit ? (
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-slate-600">
                  Gate Exit exists. You can create the GRN draft now.
                </div>
                <button
                  type="button"
                  onClick={() => void handleCreateGrn()}
                  disabled={saving}
                  className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50"
                >
                  {saving ? "Opening..." : "Create GRN"}
                </button>
              </div>
            ) : (
              <div className="text-sm text-slate-500">
                Create the inbound gate exit first. GRN is unlocked only after Gate
                Exit exists.
              </div>
            )}
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
