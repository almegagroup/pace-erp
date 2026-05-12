import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { createGRNDraft, createGateExitInbound, getGateEntry } from "../procurementApi.js";

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "GRN_POSTED":
    case "CLOSED":
      return "emerald";
    case "OPEN":
      return "sky";
    default:
      return "slate";
  }
}

export default function GateEntryDetailPage() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const [detail, setDetail] = useState(null);
  const [gateExitForm, setGateExitForm] = useState({
    exit_date: new Date().toISOString().slice(0, 10),
    exit_time: "",
    tare_weight: "",
    net_weight_override: "",
    rst_number_tare: "",
    remarks: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const hasGateExit = Boolean(detail?.gate_exit_inbound?.id);
  const weightedInbound = useMemo(
    () => Array.isArray(detail?.lines) && detail.lines.some((line) => Number(line.gross_weight ?? 0) > 0),
    [detail?.lines]
  );

  async function loadDetail() {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const data = await getGateEntry(id);
      setDetail(data);
    } catch (loadError) {
      setDetail(null);
      setError(loadError instanceof Error ? loadError.message : "GE_FETCH_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [id]);

  async function handleCreateGateExit() {
    if (!detail?.id) return;
    if (weightedInbound && !gateExitForm.tare_weight) {
      setError("Tare weight is required for BULK/TANKER or weighed inbound gate exits.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createGateExitInbound({
        gate_entry_id: detail.id,
        exit_date: gateExitForm.exit_date,
        exit_time: gateExitForm.exit_time || null,
        tare_weight: gateExitForm.tare_weight ? Number(gateExitForm.tare_weight) : null,
        net_weight_override: gateExitForm.net_weight_override ? Number(gateExitForm.net_weight_override) : null,
        rst_number_tare: gateExitForm.rst_number_tare || null,
        remarks: gateExitForm.remarks || null,
      });
      setNotice("Inbound gate exit created.");
      await loadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "GEX_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateGrn() {
    if (!detail?.id) return;
    const existingGrnId = (detail.lines ?? []).find((line) => line.linked_csn?.grn_id)?.linked_csn?.grn_id;
    if (existingGrnId) {
      openScreen(OPERATION_SCREENS.PROC_GRN_DETAIL.screen_code);
      navigate(`/dashboard/procurement/grns/${encodeURIComponent(existingGrnId)}`);
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await createGRNDraft({ gate_entry_id: detail.id });
      setNotice("GRN draft created.");
      openScreen(OPERATION_SCREENS.PROC_GRN_DETAIL.screen_code);
      navigate(`/dashboard/procurement/grns/${encodeURIComponent(created.id)}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "GRN_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Gate Entry Detail"
      notices={[
        ...(error ? [{ key: "ge-detail-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "ge-detail-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
      ]}
    >
      {loading || !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading gate entry detail..." : "Gate entry detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={detail.ge_number || "Gate Entry"}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <ErpFieldPreview label="Entry Date" value={detail.ge_date || "—"} />
              <ErpFieldPreview label="Vehicle" value={detail.vehicle_number || "—"} />
              <ErpFieldPreview label="Driver" value={detail.driver_name || "—"} />
              <ErpFieldPreview label="Status" value={detail.status || "—"} tone={statusTone(detail.status)} />
              <ErpFieldPreview label="Gate Staff" value={detail.gate_staff_id || "—"} />
              <ErpFieldPreview label="GE Type" value={detail.ge_type || "—"} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Lines" title="Gate entry lines">
            <ErpDenseGrid
              columns={[
                { key: "line_number", label: "Line", width: "70px" },
                { key: "material_id", label: "Material", width: "180px" },
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
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                <ErpFieldPreview label="Exit Number" value={detail.gate_exit_inbound.exit_number || "—"} />
                <ErpFieldPreview label="Exit Date" value={detail.gate_exit_inbound.exit_date || "—"} />
                <ErpFieldPreview label="Tare Weight" value={detail.gate_exit_inbound.tare_weight || "—"} />
                <ErpFieldPreview label="Net Calculated" value={detail.gate_exit_inbound.net_weight_calculated || "—"} />
                <ErpFieldPreview label="Net Override" value={detail.gate_exit_inbound.net_weight_override || "—"} />
                <ErpFieldPreview label="Effective Net" value={detail.gate_exit_inbound.effective_net_weight || "—"} />
              </div>
            ) : detail.status === "OPEN" ? (
              <div className="grid gap-3">
                <div className="grid gap-3 lg:grid-cols-2">
                  <ErpDenseFormRow label="Exit Date">
                    <input type="date" value={gateExitForm.exit_date} onChange={(event) => setGateExitForm((current) => ({ ...current, exit_date: event.target.value }))} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Exit Time">
                    <input type="time" value={gateExitForm.exit_time} onChange={(event) => setGateExitForm((current) => ({ ...current, exit_time: event.target.value }))} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Tare Weight" required={weightedInbound}>
                    <input type="number" min="0" step="0.0001" value={gateExitForm.tare_weight} onChange={(event) => setGateExitForm((current) => ({ ...current, tare_weight: event.target.value }))} className={`h-8 w-full border px-2 text-sm outline-none focus:border-sky-500 ${weightedInbound ? "border-amber-300 bg-amber-50" : "border-slate-300 bg-white"}`} />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Net Override">
                    <input type="number" min="0" step="0.0001" value={gateExitForm.net_weight_override} onChange={(event) => setGateExitForm((current) => ({ ...current, net_weight_override: event.target.value }))} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="RST Number">
                    <input value={gateExitForm.rst_number_tare} onChange={(event) => setGateExitForm((current) => ({ ...current, rst_number_tare: event.target.value }))} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                  </ErpDenseFormRow>
                  <ErpDenseFormRow label="Remarks">
                    <input value={gateExitForm.remarks} onChange={(event) => setGateExitForm((current) => ({ ...current, remarks: event.target.value }))} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                  </ErpDenseFormRow>
                </div>
                <div className="flex justify-end">
                  <button type="button" onClick={() => void handleCreateGateExit()} disabled={saving} className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50">
                    {saving ? "Creating..." : "Create Gate Exit"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-500">Gate exit can only be created while the gate entry is open.</div>
            )}
          </ErpSectionCard>

          <ErpSectionCard eyebrow="GRN" title="Goods receipt">
            {hasGateExit ? (
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-slate-600">Gate Exit exists. You can create the GRN draft now.</div>
                <button type="button" onClick={() => void handleCreateGrn()} disabled={saving} className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50">
                  {saving ? "Opening..." : "Create GRN"}
                </button>
              </div>
            ) : (
              <div className="text-sm text-slate-500">Create the inbound gate exit first. GRN is unlocked only after Gate Exit exists.</div>
            )}
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
