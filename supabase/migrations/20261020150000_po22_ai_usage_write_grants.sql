/*
 * Migration: 20261020150000_po22_ai_usage_write_grants
 * Purpose:   Fix PO22 "Explain with AI" → 503 AI_BUDGET_UNAVAILABLE in PROD (2026-10-20).
 *            20261019150000 granted service_role only SELECT on erp_planning.mts_ai_usage, but
 *            reserve_mts_ai_budget() / settle_mts_ai_budget() run as the caller (not SECURITY
 *            DEFINER) and INSERT / UPDATE that table → "permission denied for table mts_ai_usage"
 *            (PROD postgres log 2026-10-20T03:57:57Z). Grant exactly the two missing privileges.
 *            No data change; deterministic Planning is unaffected.
 */

GRANT INSERT, UPDATE ON erp_planning.mts_ai_usage TO service_role;
