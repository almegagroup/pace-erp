/*
 * File-Path: supabase/functions/api/_shared/indianStates.ts
 * Purpose: Backend allowlist mirroring frontend/src/data/indianStates.js --
 *          the frontend dropdown stops typos at entry, this stops a direct
 *          API call from bypassing it. State names are compared exactly
 *          against this set for GST place-of-supply matching
 *          (deriveSalesInvoiceGstType), so an unlisted spelling must be
 *          rejected here, not silently accepted.
 * Authority: Backend
 */

export const INDIAN_STATE_NAMES = new Set([
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Other Territory",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
]);
