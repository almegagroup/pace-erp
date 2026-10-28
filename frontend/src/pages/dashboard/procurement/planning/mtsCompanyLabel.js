/*
 * File-Path: frontend/src/pages/dashboard/procurement/planning/mtsCompanyLabel.js
 * Purpose: PO22 Excel exports name a company by code + name, never its UUID. Kept free of ExcelJS so the
 *          page can import it without pulling the workbook library into its bundle.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Business exports must never turn an internal company id into a visible name. */
export function companyLabel(c) {
  const labels = [c.company_name, c.company_code]
    .map((value) => String(value ?? "").trim())
    .filter((value) => value && !UUID_RE.test(value));
  // Owner 2026-10-27: several companies share one name (CMP003 / CMP010 "ALMEGA SURFACE COATS LLP"), so the
  // code leads wherever a company is named.
  const [name, code] = labels;
  return code ? `${code} · ${name}` : name || "—";
}
