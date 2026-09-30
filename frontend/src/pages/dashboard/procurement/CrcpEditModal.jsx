import { useState } from "react";
import ModalBase from "../../../components/layer/ModalBase.jsx";

// CRCP (Cross Company) — PROCUREMENT-DESIGN-DOC.md §3.7 Points 3.2.2/3.2.9.
// Shared edit modal reused by both PO Detail (per-PO) and STO Detail
// (header-level) — same mechanism, same UI, only the caller differs.
// `companies` rows need id/company_code/state_name/company_name; `ownCompanyId`
// is always shown checked and locked (can't be removed, it's never stored in
// the allow-list — see the migration comment).
export default function CrcpEditModal({
  visible,
  onClose,
  ownCompanyId,
  companies,
  initialEnabled,
  initialCompanyIds,
  saving,
  error,
  onSave,
}) {
  // Lazy initial state only -- the parent mounts this component fresh each
  // time it opens (conditional render, not an always-mounted visible={false}),
  // so a fresh mount already picks up the latest initialEnabled/initialCompanyIds
  // without needing an effect to re-sync state on every open.
  const [enabled, setEnabled] = useState(() => Boolean(initialEnabled));
  const [selectedIds, setSelectedIds] = useState(() => new Set(initialCompanyIds || []));

  function toggleCompany(id) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <ModalBase
      visible={visible}
      eyebrow="CRCP"
      title="Cross Company Sharing"
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
            disabled={saving}
            onClick={() =>
              onSave({
                crcp_enabled: enabled,
                company_ids: enabled ? [...selectedIds] : [],
              })
            }
            className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      }
    >
      <div className="grid gap-4">
        {error ? <p className="text-sm font-semibold text-rose-700">{error}</p> : null}
        <p className="text-xs text-slate-500">
          When enabled, the companies checked below may also raise a Gate Entry against this
          document — for example when material physically unloads at a sister company instead
          of this document's own location. This is never shown on any printed copy.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEnabled(true)}
            className={`px-3 py-2 text-xs font-semibold ${
              enabled
                ? "border border-emerald-700 bg-emerald-100 text-emerald-900"
                : "border border-slate-300 bg-white text-slate-700"
            }`}
          >
            CRCP On
          </button>
          <button
            type="button"
            onClick={() => setEnabled(false)}
            className={`px-3 py-2 text-xs font-semibold ${
              !enabled
                ? "border border-slate-700 bg-slate-200 text-slate-950"
                : "border border-slate-300 bg-white text-slate-700"
            }`}
          >
            CRCP Off
          </button>
        </div>
        {enabled ? (
          <div className="grid gap-1 border border-slate-300 bg-[#fffef7] p-2" style={{ maxHeight: "320px", overflowY: "auto" }}>
            <label className="flex items-center gap-2 border-b border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-500">
              <input type="checkbox" checked readOnly disabled />
              {(() => {
                const own = companies.find((entry) => entry.id === ownCompanyId);
                return own
                  ? `${own.company_code || ""} — ${own.state_name || ""} — ${own.company_name || ""} (this document's own company, always included)`
                  : "This document's own company (always included)";
              })()}
            </label>
            {companies
              .filter((entry) => entry.id !== ownCompanyId)
              .map((entry) => (
                <label key={entry.id} className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-800 hover:bg-sky-50">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(entry.id)}
                    onChange={() => toggleCompany(entry.id)}
                  />
                  {entry.company_code || ""} — {entry.state_name || ""} — {entry.company_name || ""}
                </label>
              ))}
          </div>
        ) : null}
      </div>
    </ModalBase>
  );
}
