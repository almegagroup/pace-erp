/*
 * PO22 Item Plan (owner 2026-10-21): vendor rules for the user's lots, shared by the Item Plan
 * tab and the vendor × date compare (same rules as the backend's user_lots flags).
 */

/** Real order qty for a vendor: at least the MOQ, rounded up to the order multiple. */
export function vendorLotQty(qty, option) {
  const wanted = Math.max(Number(qty) || 0, Number(option?.moq_qty) || 0);
  const multiple = Number(option?.order_multiple_qty) || 0;
  return multiple > 0 ? Math.ceil(wanted / multiple - 1e-9) * multiple : wanted;
}

/** Flags for one of the user's lots against the chosen vendor (same rules as the backend). */
export function lotVendorFlags(lot, vendorChoices) {
  const option = lot.vendor_id ? (vendorChoices ?? []).find((c) => c.material_id === lot.material_id)?.options.find((o) => o.vendor_id === lot.vendor_id) : null;
  if (!option) return { option: null, tooEarly: false, belowMoq: false, value: null };
  const qty = Number(lot.qty_base) || 0;
  return {
    option,
    tooEarly: Boolean(option.earliest_plant_eta && lot.plant_eta < option.earliest_plant_eta),
    belowMoq: Boolean(option.moq_qty && qty < option.moq_qty),
    value: option.unit_total_cost === null ? null : qty * option.unit_total_cost,
  };
}
