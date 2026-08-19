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

// Found live 2026-08-19 (business owner, PR02 Stroke Approval): a dosage
// total of exactly 100 displayed as "100.00000000001%" -- classic binary
// floating-point summation noise (0.1 + 0.2-style residue from adding many
// decimal dosage_pct values). formatPreciseNumber's artifact-detection regex
// only strips noise shaped as a long run of trailing 0s/9s; it missed this
// shape (ends in a single stray "1", not a run). A SUM is never a value the
// user directly typed -- unlike a single field, there's no original
// precision to preserve -- so round it to the same precision inputs are
// entered at (PRODUCTION_DECIMAL_STEP, 6dp) before formatting. This only
// ever removes floating-point noise below 1e-6; every validation check
// (e.g. Math.abs(sum - 100) < 0.01) still runs against the raw, unrounded
// sum, so the actual pass/fail tolerance is completely unaffected -- this
// only changes what gets displayed, never what counts as valid.
export function formatSum(sum, fallback = "--") {
  if (!Number.isFinite(sum)) return fallback;
  return formatPreciseNumber(Number(sum.toFixed(6)), fallback);
}
