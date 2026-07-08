import { useEffect, useRef, useState } from "react";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import { createGateExitInbound, getGateEntryByNumber } from "../procurementApi.js";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function currentTime12() {
  const d = new Date();
  let h = d.getHours();
  const ap = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return {
    time: `${String(h).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    ampm: ap,
  };
}

function time12to24(time, ampm) {
  if (!time) return null;
  const [hh, mm] = time.split(":").map(Number);
  if (Number.isNaN(hh)) return null;
  let h24 = hh;
  if (ampm === "PM" && hh !== 12) h24 = hh + 12;
  if (ampm === "AM" && hh === 12) h24 = 0;
  return `${String(h24).padStart(2, "0")}:${String(mm || 0).padStart(2, "0")}:00`;
}

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

export default function GateExitEntryPage() {
  const dateRef = useRef(null);
  const geInputRef = useRef(null);

  const [geNumber, setGeNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const initTimeState = currentTime12();
  const [exitDate, setExitDate] = useState(todayIso());
  const [exitTime, setExitTime] = useState(initTimeState.time);
  const [ampm, setAmpm] = useState(initTimeState.ampm);
  const [tareWeight, setTareWeight] = useState("");

  const hasGateExit = Boolean(detail?.gate_exit_inbound?.id);
  const geStatus = String(detail?.status || "").toUpperCase();
  const canGateExit = Boolean(detail) && !hasGateExit && !["PRUNED", "CANCELLED"].includes(geStatus);

  async function handleLoad() {
    const trimmed = geNumber.trim().toUpperCase();
    if (!trimmed) {
      setError("GE number is required.");
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    setDetail(null);
    try {
      const result = await getGateEntryByNumber(trimmed);
      setDetail(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gate entry not found.");
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setGeNumber("");
    setDetail(null);
    setError("");
    setNotice("");
    setExitDate(todayIso());
    const t = currentTime12();
    setExitTime(t.time);
    setAmpm(t.ampm);
    setTareWeight("");
    geInputRef.current?.focus();
  }

  async function handleSave() {
    if (!detail?.id) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await createGateExitInbound({
        gate_entry_id: detail.id,
        exit_date: exitDate,
        exit_time: time12to24(exitTime, ampm),
        tare_weight: tareWeight ? Number(tareWeight) : null,
      });
      setNotice(`Gate Exit ${result.exit_number} created. ${detail.ge_number} is now gate exited.`);
      setDetail((current) => ({ ...current, gate_exit_inbound: result }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "GEX_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  function handleGeNumberKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleLoad();
    }
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === "F4") {
        const active = document.activeElement;
        if (active && active.type === "date") {
          active.showPicker?.();
        } else {
          const t = currentTime12();
          setExitTime(t.time);
          setAmpm(t.ampm);
        }
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Gate Exit"
      notices={[
        ...(error ? [{ key: "gex-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "gex-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        ...(detail ? [{ key: "new", label: "New Entry", tone: "neutral", onClick: resetForm }] : []),
      ]}
    >
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="Criteria" title="Enter GE number">
          <div className="flex max-w-md gap-2">
            <input
              ref={geInputRef}
              type="text"
              value={geNumber}
              onChange={(e) => setGeNumber(e.target.value)}
              onKeyDown={handleGeNumberKeyDown}
              placeholder="e.g. GE-100051"
              autoFocus
              disabled={loading}
              className="h-9 flex-1 border border-slate-300 bg-white px-3 text-sm font-medium uppercase text-slate-900 outline-none focus:border-sky-500 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void handleLoad()}
              disabled={loading}
              className="h-9 min-w-[90px] whitespace-nowrap border border-sky-300 bg-sky-50 px-4 text-sm font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-50"
            >
              {loading ? "Loading…" : "Load (Enter)"}
            </button>
          </div>
        </ErpSectionCard>

        {detail && (
          <>
            <ErpSectionCard eyebrow="Header" title={detail.ge_number || "Gate Entry"}>
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                <ErpFieldPreview label="Entry Date" value={detail.ge_date || "—"} />
                <ErpFieldPreview label="Vehicle" value={detail.vehicle_number || "—"} />
                <ErpFieldPreview label="Driver" value={detail.driver_name || "—"} />
                <ErpFieldPreview label="Status" value={detail.status || "—"} tone={statusTone(detail.status)} />
                <ErpFieldPreview label="GE Type" value={detail.ge_type || "—"} />
                <ErpFieldPreview label="Remarks" value={detail.remarks || "—"} />
              </div>
            </ErpSectionCard>

            <ErpSectionCard eyebrow="Lines" title="Gate entry lines">
              <ErpDenseGrid
                columns={[
                  { key: "line_number", label: "Line", width: "70px" },
                  { key: "material_name", label: "Material", width: "220px", render: (row) => row.material_name || row.material_id || "—" },
                  { key: "linked_csn", label: "CSN", width: "140px", render: (row) => row.linked_csn?.csn_number || row.csn_id || "—" },
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

            <ErpSectionCard eyebrow="Gate Exit" title="Record exit weighment">
              {hasGateExit ? (
                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <ErpFieldPreview label="Exit Number" value={detail.gate_exit_inbound.exit_number || "—"} />
                  <ErpFieldPreview label="Exit Date" value={detail.gate_exit_inbound.exit_date || "—"} />
                  <ErpFieldPreview label="Tare Weight" value={detail.gate_exit_inbound.tare_weight ?? "—"} />
                  <ErpFieldPreview label="Net Calculated" value={detail.gate_exit_inbound.net_weight_calculated ?? "—"} />
                  <ErpFieldPreview label="Effective Net" value={detail.gate_exit_inbound.effective_net_weight ?? "—"} tone="sky" />
                </div>
              ) : !canGateExit ? (
                <div className="text-sm text-slate-500">
                  This gate entry is {geStatus} — gate exit cannot be recorded.
                </div>
              ) : (
                <div className="grid gap-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">
                      <span className="flex items-center justify-between">
                        Exit date <span className="font-normal text-red-500">*</span>
                        <kbd className="rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-[9px] font-normal text-slate-500">F4</kbd>
                      </span>
                      <div className="flex gap-1">
                        <input
                          ref={dateRef}
                          type="date"
                          value={exitDate}
                          max={todayIso()}
                          onChange={(e) => setExitDate(e.target.value)}
                          className="h-9 flex-1 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                        />
                        <button
                          type="button"
                          className="h-9 border border-sky-600 bg-sky-50 px-3 text-xs font-semibold text-sky-800"
                          onClick={() => dateRef.current?.showPicker?.()}
                        >
                          F4
                        </button>
                      </div>
                    </label>

                    <label className="grid gap-1 text-xs font-semibold text-slate-700">
                      <span className="flex items-center justify-between">
                        Exit time
                        <kbd className="rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-[9px] font-normal text-slate-500">F4 = now</kbd>
                      </span>
                      <div className="flex gap-1">
                        <input
                          type="text"
                          maxLength={5}
                          value={exitTime}
                          placeholder="HH:MM"
                          className="h-9 flex-1 border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-sky-500"
                          onChange={(e) => {
                            let v = e.target.value.replace(/\D/g, "");
                            if (v.length > 2) v = `${v.slice(0, 2)}:${v.slice(2)}`;
                            setExitTime(v.slice(0, 5));
                          }}
                        />
                        <div className="flex overflow-hidden border border-slate-300">
                          {["AM", "PM"].map((ap) => (
                            <button
                              key={ap}
                              type="button"
                              className={[
                                "h-9 px-2 text-xs font-semibold",
                                ampm === ap ? "bg-slate-700 text-white" : "bg-white text-slate-600",
                              ].join(" ")}
                              onClick={() => setAmpm(ap)}
                            >
                              {ap}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="h-9 border border-sky-600 bg-sky-50 px-3 text-xs font-semibold text-sky-800"
                          onClick={() => {
                            const t = currentTime12();
                            setExitTime(t.time);
                            setAmpm(t.ampm);
                          }}
                        >
                          F4
                        </button>
                      </div>
                    </label>

                    <ErpDenseFormRow label="Tare Weight">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={tareWeight}
                        onChange={(e) => setTareWeight(e.target.value)}
                        className="h-9 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={saving}
                      className="border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Save (Gate Exit)"}
                    </button>
                  </div>
                </div>
              )}
            </ErpSectionCard>
          </>
        )}
      </div>
    </ErpScreenScaffold>
  );
}
