import { useState } from "react";
import ModalBase from "../../../components/layer/ModalBase.jsx";

// PO Continuity (business owner, 2026-10-27) — exception to the §3.7 Bulk
// Effective Date rule. The ticked later POs no longer end this PO's
// challan/invoice date window, so GE/GR keep working against it while they
// are active. Saved directly, no approval. Same shape as EffectiveDateEditModal.
export default function PoContinuityModal({
  visible,
  onClose,
  candidates,
  loading,
  loadError,
  saving,
  error,
  onSave,
}) {
  const [selectedIds, setSelectedIds] = useState(
    () => new Set((candidates ?? []).filter((row) => row.selected).map((row) => row.id)),
  );

  function toggle(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const rows = candidates ?? [];

  return (
    <ModalBase
      visible={visible}
      eyebrow="Bulk"
      title="PO Continuity"
      onEscape={onClose}
      actions={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || loading || Boolean(loadError)}
            onClick={() => onSave([...selectedIds])}
            className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      }
    >
      <div className="grid gap-3">
        {error ? <p className="text-sm font-semibold text-rose-700">{error}</p> : null}
        <p className="text-xs text-slate-500">
          Normally a later active Bulk PO of the same vendor, company and material ends this PO&apos;s
          Effective Date window at its own Effective Start Date. Tick the later POs that must NOT end
          this PO — Gate Entry and GRN stay open against this PO while they are active.
        </p>
        {loading ? <p className="text-sm text-slate-500">Loading later POs...</p> : null}
        {loadError ? <p className="text-sm font-semibold text-rose-700">{loadError}</p> : null}
        {!loading && !loadError && rows.length === 0 ? (
          <p className="text-sm text-slate-500">No later active Bulk PO exists for this vendor, company and material.</p>
        ) : null}
        {!loading && !loadError && rows.length > 0 ? (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="border-b px-2 py-1.5"></th>
                <th className="border-b px-2 py-1.5">PO Number</th>
                <th className="border-b px-2 py-1.5">Effective Start</th>
                <th className="border-b px-2 py-1.5">Status</th>
                <th className="border-b px-2 py-1.5 text-right">Ordered</th>
                <th className="border-b px-2 py-1.5 text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggle(row.id)} />
                  </td>
                  <td className="px-2 py-1.5 font-mono">{row.po_number || "—"}</td>
                  <td className="px-2 py-1.5">{row.effective_start_date || "—"}</td>
                  <td className="px-2 py-1.5">{row.live ? row.status || "—" : "Ended"}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{row.ordered_qty} {row.uom_code || ""}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{row.open_qty} {row.uom_code || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </ModalBase>
  );
}
