import { defaultReceivedQty, remainingToAllocate, summarizeSplit } from "./grnSplitMath.js";

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const slice = (invoiceQty, receivedQty) => ({ invoiceQty, receivedQty });
const GRN = 33.95;

// The real case: invoices 22 + 12 = 34, received 33.95. Blank Received defaults so the last invoice takes the shortage.
const first = slice(22, defaultReceivedQty(22, [], GRN));
assertEqual(first.receivedQty, 22, "first slice defaults to its full invoice qty");
assertEqual(remainingToAllocate([first], GRN), 11.95, "11.95 left after the first slice");
const second = slice(12, defaultReceivedQty(12, [first], GRN));
assertEqual(second.receivedQty, 11.95, "second slice defaults to what is left, not the full 12");
let s = summarizeSplit([first, second], GRN);
assertEqual(s.canSplit, true, "22/22 + 12/11.95 splits");
assertEqual(s.invoiceTotal, 34, "invoice total");
assertEqual(s.receivedTotal, 33.95, "received total");
assertEqual(s.shortage, 0.05, "0.05 short");

// The shortage can sit on the first invoice instead.
s = summarizeSplit([slice(22, 21.95), slice(12, 12)], GRN);
assertEqual(s.canSplit, true, "21.95/22 + 12/12 splits");

// No shortage at all behaves exactly as before.
s = summarizeSplit([slice(20, 20), slice(13.95, 13.95)], GRN);
assertEqual(s.canSplit, true, "exact split still works");
assertEqual(s.shortage, 0, "no shortage");

// Received above the invoice is never allowed (Map's rule), even if the totals match.
s = summarizeSplit([slice(22, 22), slice(11, 11.95)], GRN);
assertEqual(s.receivedMatches, true, "totals match");
assertEqual(s.anyReceivedExceedsInvoice, true, "but 11.95 received against an 11 invoice");
assertEqual(s.canSplit, false, "so it cannot split");

// Received must add up to the GRN exactly.
s = summarizeSplit([slice(22, 22), slice(12, 12)], GRN);
assertEqual(s.canSplit, false, "34 received against a 33.95 GRN cannot split");
assertEqual(s.remaining, -0.05, "0.05 too much");
s = summarizeSplit([slice(22, 22)], GRN);
assertEqual(s.canSplit, false, "a single slice is not a split");

// Nothing left of the GRN: default is 0, never negative.
assertEqual(defaultReceivedQty(5, [slice(40, 33.95)], GRN), 0, "no negative default");

console.log("grnSplitMath tests passed");
