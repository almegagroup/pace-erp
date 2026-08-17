/*
 * File-ID: 27.FE-SHARED-PRECISION
 * File-Path: frontend/src/pages/dashboard/production/productionPrecision.js
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Preserve operator-entered decimal precision across Stroke / Process /
 *          Packing flows instead of forcing UI rounding at each stage.
 */

export const PRODUCTION_DECIMAL_STEP = "0.000001";

function trimTrailingZeros(text) {
  return text.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
}

function normalizeFloatingArtifact(text, numeric) {
  const fractional = text.split(".")[1] ?? "";
  if (fractional.length <= 8) return null;
  if (!/(?:0{6,}|9{6,})$/u.test(fractional)) return null;
  return trimTrailingZeros(numeric.toFixed(5));
}

export function formatPreciseNumber(value, fallback = "--") {
  if (value === null || value === undefined || value === "") return fallback;
  const text = String(value).trim();
  if (!text) return fallback;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return fallback;
  if (/[eE]/.test(text)) {
    return trimTrailingZeros(numeric.toLocaleString(undefined, { useGrouping: false, maximumFractionDigits: 12 }));
  }
  return normalizeFloatingArtifact(text, numeric) ?? text;
}

export function multiplyPreciseValues(left, right) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
  return String(a * b);
}
