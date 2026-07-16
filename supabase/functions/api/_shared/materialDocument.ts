/*
 * File-Path: supabase/functions/api/_shared/materialDocument.ts
 * Gate: 27.106
 * Domain: INVENTORY / STOCK ENGINE
 * Purpose: Section 106 — shared helper to mint a SAP Material Document number+year
 *   (MBLNR + MJAHR) for one goods-movement EVENT. Every stock-posting handler calls this
 *   ONCE per event and passes the returned (docNumber, docYear) to all its
 *   post_stock_movement() calls, with the business document number carried as the reference.
 *
 *   See feasibility doc Section 106 (Phase 2 caller migration). The DB generator
 *   erp_inventory.generate_material_doc_number(company) is year-scoped (FY April-start),
 *   resets each FY, and is race-safe.
 * Authority: Backend
 */

import { serviceRoleClient } from "./serviceRoleClient.ts";

export type MaterialDocumentRef = {
  /** MBLNR — the material document number (year-scoped counter, e.g. "00000123"). */
  docNumber: string;
  /** MJAHR — the fiscal year the number belongs to (e.g. "2026-27"). */
  docYear: string;
};

/**
 * Mint one Material Document identity for a posting event. Call ONCE per event; reuse the
 * result across every post_stock_movement() line of that event so they share one MatDoc
 * header (with incrementing item_number) — mirroring SAP MKPF (one MBLNR) / MSEG (items).
 */
export async function generateMaterialDocNumber(companyId: string): Promise<MaterialDocumentRef> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .rpc("generate_material_doc_number", { p_company_id: companyId });

  if (error || !Array.isArray(data) || data.length === 0) {
    console.error("[materialDocument.generateMaterialDocNumber] rpc failed:", JSON.stringify(error));
    throw new Error("MATDOC_GENERATION_FAILED");
  }

  const row = data[0] as { doc_number?: unknown; doc_year?: unknown };
  const docNumber = String(row.doc_number ?? "").trim();
  const docYear = String(row.doc_year ?? "").trim();
  if (!docNumber || !docYear) {
    throw new Error("MATDOC_GENERATION_FAILED");
  }
  return { docNumber, docYear };
}
