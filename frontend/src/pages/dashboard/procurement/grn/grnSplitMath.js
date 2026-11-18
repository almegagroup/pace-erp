/*
 * GRN Split quantity rules (Invoice Mapping page). Pure, no React.
 *
 * Each invoice slice has TWO quantities:
 *   - invoiceQty  : what the vendor's invoice says (a check only -- the system does not store it, same as plain Map);
 *   - receivedQty : what physically arrived against that invoice. This is what the new GRN carries and what payable
 *                   and landed cost follow.
 * Rules (the same as plain Map's "GRN quantity cannot exceed Invoice Quantity"):
 *   1. every slice: receivedQty <= invoiceQty;
 *   2. the slices' receivedQty must add up to the GRN's received quantity EXACTLY (physical stock is neither created nor lost).
 * So a truck that was short (invoices 22 + 12 = 34, received 33.95) is valid: the shortage sits on the slice(s) whose
 * Received is below Invoice Qty. Invoices adding up to LESS than what was received can never satisfy rule 1.
 */
export const SPLIT_QTY_TOLERANCE = 0.0001;

const round4 = (value) => Number(Number(value).toFixed(4));

export function sumReceived(slices) {
  return round4(slices.reduce((sum, slice) => sum + Number(slice.receivedQty || 0), 0));
}

export function sumInvoiceQty(slices) {
  return round4(slices.reduce((sum, slice) => sum + Number(slice.invoiceQty || 0), 0));
}

// Received quantity still to be placed on slices that have not been added yet.
export function remainingToAllocate(slices, targetQty) {
  return round4(Number(targetQty) - sumReceived(slices));
}

// What Received Qty defaults to when the user leaves it blank: the full invoice quantity, but never more than is left
// of the GRN -- so the LAST invoice automatically absorbs a shortage (22 + 12 against 33.95 -> 22 and 11.95).
export function defaultReceivedQty(invoiceQty, slices, targetQty) {
  const remaining = remainingToAllocate(slices, targetQty);
  return round4(Math.min(Number(invoiceQty), Math.max(remaining, 0)));
}

export function summarizeSplit(slices, targetQty) {
  const receivedTotal = sumReceived(slices);
  const invoiceTotal = sumInvoiceQty(slices);
  const receivedMatches = slices.length >= 2 && Math.abs(receivedTotal - Number(targetQty)) < SPLIT_QTY_TOLERANCE;
  const exceeding = slices.filter((slice) => Number(slice.receivedQty) - Number(slice.invoiceQty) > SPLIT_QTY_TOLERANCE);
  return {
    receivedTotal,
    invoiceTotal,
    // Invoiced but not received: positive when the truck was short.
    shortage: round4(Math.max(0, invoiceTotal - receivedTotal)),
    remaining: round4(Number(targetQty) - receivedTotal),
    receivedMatches,
    anyReceivedExceedsInvoice: exceeding.length > 0,
    canSplit: receivedMatches && exceeding.length === 0,
  };
}
