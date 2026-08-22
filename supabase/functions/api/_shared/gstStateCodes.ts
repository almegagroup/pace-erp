/*
 * File-Path: supabase/functions/api/_shared/gstStateCodes.ts
 * Purpose: India's standard 2-digit GST state codes (CBIC), keyed by the exact
 *          state-name strings in indianStates.ts (INDIAN_STATE_NAMES). Used to
 *          compute a customer's display code ("{code} - {name}") when no GST
 *          number is set yet (feasibility doc Section 129.4) -- the customer's
 *          own state field is the fallback source of the prefix; the GST
 *          number's own first 2 digits are the primary source once set.
 *          Backend-only, single source of truth -- frontend never recomputes
 *          this (Section 129.4).
 * Authority: Backend
 */

export const GST_STATE_CODES: Record<string, string> = {
  "Jammu and Kashmir": "01",
  "Himachal Pradesh": "02",
  "Punjab": "03",
  "Chandigarh": "04",
  "Uttarakhand": "05",
  "Haryana": "06",
  "Delhi": "07",
  "Rajasthan": "08",
  "Uttar Pradesh": "09",
  "Bihar": "10",
  "Sikkim": "11",
  "Arunachal Pradesh": "12",
  "Nagaland": "13",
  "Manipur": "14",
  "Mizoram": "15",
  "Tripura": "16",
  "Meghalaya": "17",
  "Assam": "18",
  "West Bengal": "19",
  "Jharkhand": "20",
  "Odisha": "21",
  "Chhattisgarh": "22",
  "Madhya Pradesh": "23",
  "Gujarat": "24",
  "Dadra and Nagar Haveli and Daman and Diu": "26",
  "Maharashtra": "27",
  "Karnataka": "29",
  "Goa": "30",
  "Lakshadweep": "31",
  "Kerala": "32",
  "Tamil Nadu": "33",
  "Puducherry": "34",
  "Andaman and Nicobar Islands": "35",
  "Telangana": "36",
  "Andhra Pradesh": "37",
  "Ladakh": "38",
  "Other Territory": "97",
};

export function gstStateCodeFromState(state: string | null | undefined): string | null {
  if (!state) return null;
  return GST_STATE_CODES[state] ?? null;
}

export function gstStateCodeFromGstNumber(gstNumber: string | null | undefined): string | null {
  const trimmed = String(gstNumber ?? "").trim();
  if (trimmed.length < 2) return null;
  return trimmed.slice(0, 2);
}
