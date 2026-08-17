/*
 * File-ID: 27.FE-SHARED-PRECISION
 * File-Path: frontend/src/pages/dashboard/production/productionPrecision.js
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Preserve operator-entered decimal precision across Stroke / Process /
 *          Packing flows instead of forcing UI rounding at each stage.
 */

export const PRODUCTION_DECIMAL_STEP = "0.000001";

export function formatPreciseNumber(value, fallback = "--") {
  if (value === null || value === undefined || value === "") return fallback;
  const text = String(value).trim();
  if (!text) return fallback;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return fallback;
  if (/[eE]/.test(text)) {
    return numeric.toLocaleString(undefined, { useGrouping: false, maximumFractionDigits: 12 });
  }
  return text;
}

export function multiplyPreciseValues(left, right) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
  return String(a * b);
}
