/*
 * File-Path: supabase/functions/api/_shared/processPoExclusion.ts
 * Purpose: SA OM13 "Exclude from Process PO" — Prodshades of a company that may
 *          not be used to CREATE a Process PO. Only Process PO creation reads
 *          this; the Prodshade stays usable everywhere else for that company.
 *          Rule lives in erp_planning.process_po_excluded_prodshades() (Mother /
 *          Child / Prodshade ticks; ungrouped Prodshades are never excluded).
 * Authority: Backend
 */

import { serviceRoleClient } from "./serviceRoleClient.ts";

export async function loadProcessPoExcludedProdshadeIds(companyId: string): Promise<Set<string>> {
  if (!companyId) return new Set();
  const { data, error } = await serviceRoleClient.schema("erp_planning")
    .rpc("process_po_excluded_prodshades", { p_company_id: companyId });
  if (error) throw new Error("PROD_PO_EXCLUSION_LOOKUP_FAILED");
  return new Set(((data ?? []) as Array<{ prodshade_material_id: string }>).map((row) => String(row.prodshade_material_id)));
}

export async function isProdshadeExcludedFromProcessPo(companyId: string, prodshadeMaterialId: string): Promise<boolean> {
  if (!companyId || !prodshadeMaterialId) return false;
  return (await loadProcessPoExcludedProdshadeIds(companyId)).has(prodshadeMaterialId);
}
