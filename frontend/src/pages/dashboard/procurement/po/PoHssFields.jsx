import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";

// High Sea Sale fields for PO Create and Legacy PO Create -- state helpers live in poHss.js.
export default function PoHssFields({ form, vendorSelected, vendorIsImport, isHss, motherOptions, onToggleHss, onChange }) {
  return (
    <>
      {vendorSelected && !vendorIsImport ? (
        <label className="flex items-start gap-2 text-xs font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={form.is_hss === true}
            onChange={(event) => onToggleHss(event.target.checked)}
            className="mt-0.5"
          />
          <span>
            High Sea Sale (HSS)?
            <span className="block text-[10px] font-normal text-slate-400">
              The PO goes to this vendor, but it is handled as an import: Import CSN, customs and import lead time.
            </span>
          </span>
        </label>
      ) : null}
      {isHss ? (
        <label className="flex items-start gap-2 text-xs font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={form.has_hss_mother === true}
            onChange={(event) => onChange({
              has_hss_mother: event.target.checked,
              hss_mother_vendor_id: event.target.checked ? form.hss_mother_vendor_id : "",
            })}
            className="mt-0.5"
          />
          <span>
            Has Mother Company?
            <span className="block text-[10px] font-normal text-slate-400">
              The overseas company that actually ships. Its Import Lead Time is used for the CSN ETA.
            </span>
          </span>
        </label>
      ) : null}
      {isHss && form.has_hss_mother ? (
        <label className="grid gap-1 text-xs font-semibold text-slate-700">
          Mother Company <span className="text-rose-500">*</span>
          <ErpComboboxField
            value={form.hss_mother_vendor_id}
            onChange={(value) => onChange({ hss_mother_vendor_id: value })}
            options={motherOptions}
            blankLabel="Select Mother Company (Import vendor)"
          />
        </label>
      ) : null}
    </>
  );
}
