import { useState } from "react";
import ModalBase from "../../../components/layer/ModalBase.jsx";

// Bulk PO/STO — §3.7 "Bulk PO/STO — Effective Date + Cutoff mechanism"
// (LOCKED 2026-09-30). Shared edit modal reused by both PO Detail and STO
// Detail — mandatory for BULK delivery type at creation, editable any time
// post-approval, same pattern as CrcpEditModal.jsx.
export default function EffectiveDateEditModal({
  visible,
  onClose,
  initialValue,
  saving,
  error,
  onSave,
}) {
  const [value, setValue] = useState(() => initialValue || "");

  return (
    <ModalBase
      visible={visible}
      eyebrow="Bulk"
      title="Effective Start Date"
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
            disabled={saving || !value}
            onClick={() => onSave(value)}
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
          Window start for validating a vendor Challan/Invoice date at Gate Entry. The window ends
          at the next document's own Effective Start Date (same vendor/company/material for a PO,
          same sending/receiving company/material for an STO), or at this document's own Cutoff
          Date once knocked off with no successor yet.
        </p>
        <label className="grid gap-1 text-xs font-semibold text-slate-700">
          Effective Start Date
          <input
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
          />
        </label>
      </div>
    </ModalBase>
  );
}
