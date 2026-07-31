/*
 * File-Path: frontend/src/data/indianStates.js
 * Purpose: Shared India state/UT list with official GST state codes, for every
 *          "State" dropdown across party masters (Customer, Vendor, Company,
 *          SO Ship-To) -- was free text everywhere, real risk of typos
 *          silently breaking exact-string GST place-of-supply comparison
 *          (§113.16's deriveSalesInvoiceGstType). One canonical list, one
 *          spelling, used everywhere.
 * Authority: Frontend
 */

export const INDIAN_STATES = Object.freeze([
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "18", name: "Assam" },
  { code: "10", name: "Bihar" },
  { code: "04", name: "Chandigarh" },
  { code: "22", name: "Chhattisgarh" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "07", name: "Delhi" },
  { code: "30", name: "Goa" },
  { code: "24", name: "Gujarat" },
  { code: "06", name: "Haryana" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "01", name: "Jammu and Kashmir" },
  { code: "20", name: "Jharkhand" },
  { code: "29", name: "Karnataka" },
  { code: "32", name: "Kerala" },
  { code: "38", name: "Ladakh" },
  { code: "31", name: "Lakshadweep" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "27", name: "Maharashtra" },
  { code: "14", name: "Manipur" },
  { code: "17", name: "Meghalaya" },
  { code: "15", name: "Mizoram" },
  { code: "13", name: "Nagaland" },
  { code: "21", name: "Odisha" },
  { code: "97", name: "Other Territory" },
  { code: "34", name: "Puducherry" },
  { code: "03", name: "Punjab" },
  { code: "08", name: "Rajasthan" },
  { code: "11", name: "Sikkim" },
  { code: "33", name: "Tamil Nadu" },
  { code: "36", name: "Telangana" },
  { code: "16", name: "Tripura" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "05", name: "Uttarakhand" },
  { code: "19", name: "West Bengal" },
]);

// GST-lookup APIs (Vendor/Company "Check GST") return their own free-text
// state spelling -- normalize it against the canonical list (case/space
// insensitive) so the auto-filled value actually matches a dropdown option
// instead of silently landing on an unselected/blank select. Returns the
// canonical name, or the original raw string if no match is found (better
// to show something the user can fix than to silently drop their GST
// lookup's answer).
export function matchIndianStateName(rawName) {
  const normalized = String(rawName ?? "").trim().toLowerCase();
  if (!normalized) return "";
  const match = INDIAN_STATES.find((state) => state.name.toLowerCase() === normalized);
  return match ? match.name : rawName;
}
