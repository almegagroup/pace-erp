// High Sea Sale (HSS) with a Mother Company (business owner, 2026-10-15), shared by PO Create
// and Legacy PO Create.
//
// The PO stays on the vendor PACE pays (e.g. Nouryon India, often a DOMESTIC vendor), but an
// HSS PO is an import PO: import fields, Import CSN, customs. Its import lead time comes from
// the overseas Mother Company (e.g. Nouryon Asia) when one is chosen. The vendor's Default
// Mother Company pre-fills only when the PO is HSS -- a plain domestic PO never uses it.

export const HSS_TRADE_TYPE = "HIGH_SEA_SALE";

export const EMPTY_HSS_FORM = {
  is_hss: false,
  has_hss_mother: false,
  hss_mother_vendor_id: "",
};

export function resolveHssState(selectedVendor, form) {
  const vendorIsImport = String(selectedVendor?.vendor_type || "").toUpperCase() === "IMPORT";
  const isImportPo = vendorIsImport || form.is_hss === true;
  const isHss = isImportPo && form.import_trade_type === HSS_TRADE_TYPE;
  return { vendorIsImport, isImportPo, isHss };
}

// Form patch for turning HSS on/off. Turning it on pre-fills the vendor's Default Mother Company.
export function buildHssPatch(enabled, selectedVendor, vendorIsImport) {
  if (!enabled) {
    return vendorIsImport
      ? { ...EMPTY_HSS_FORM }
      : { ...EMPTY_HSS_FORM, import_trade_type: "" };
  }
  const defaultMotherId = String(selectedVendor?.default_hss_mother_vendor_id || "");
  return {
    is_hss: !vendorIsImport,
    import_trade_type: HSS_TRADE_TYPE,
    has_hss_mother: Boolean(defaultMotherId),
    hss_mother_vendor_id: defaultMotherId,
  };
}

export function buildHssPayload(form, isHss) {
  return {
    hss_mother_vendor_id: isHss && form.has_hss_mother && form.hss_mother_vendor_id ? form.hss_mother_vendor_id : null,
  };
}

export function validateHss(form, isHss) {
  if (isHss && form.has_hss_mother && !form.hss_mother_vendor_id) {
    return "Select the Mother Company, or untick Has Mother Company.";
  }
  return "";
}

export function buildHssMotherOptions(motherVendors, poVendorId) {
  return (Array.isArray(motherVendors) ? motherVendors : [])
    .filter((entry) => entry.id !== poVendorId)
    .map((entry) => ({
      value: entry.id,
      label: [entry.vendor_code, entry.vendor_name].filter(Boolean).join(" — "),
    }));
}
