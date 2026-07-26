/*
 * File-ID: 27.0b
 * File-Path: supabase/functions/api/_core/production/production.utils.ts
 * Gate: 27
 * Domain: PRODUCTION
 * Purpose: Shared utility functions for production handlers.
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";

export async function generateCompanyDocNumber(companyId: string, docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_company_doc_number", { p_company_id: companyId, p_doc_type: docType });

  if (error || !data) {
    throw new Error(`PROD_DOC_NUMBER_FAILED: ${docType}`);
  }
  return String(data);
}

// Process PO and Packing PO numbers are global (one counter across all companies),
// matching every other doc type's convention in erp_procurement.document_number_series
// (§8) - not company-scoped/prefixed. Company-scoped PROC_PO/PACK_PO rows in
// company_doc_number_series were deactivated 2026-07-13; do not reintroduce that path.
export async function generateGlobalDocNumber(docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_doc_number", { p_doc_type: docType });

  if (error || !data) {
    throw new Error(`PROD_DOC_NUMBER_FAILED: ${docType}`);
  }
  return String(data);
}
