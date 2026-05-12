# CODEX TASK BRIEF — Gate-16.8 Invoice Verification + Landed Cost Backend

**Gate:** 16.8
**Spec File:** OM-GATE-16.8-IVLandedCostBackend-Spec.md
**Dependency:** Gate-16.4 VERIFIED ✅

---

## Read First
Read `OM-GATE-16.8-IVLandedCostBackend-Spec.md` in full.

## Files to Create / Modify

1. CREATE `supabase/functions/api/_core/procurement/invoice_verification.handlers.ts`
2. CREATE `supabase/functions/api/_core/procurement/landed_cost.handlers.ts`
3. MODIFY `supabase/functions/api/_routes/procurement.routes.ts` — add IV + LC routes

## What to Build

**invoice_verification.handlers.ts:** `createIVDraftHandler`, `listIVsHandler`, `getIVHandler`, `addIVLineHandler`, `removeIVLineHandler`, `runMatchHandler`, `postIVHandler`, `listBlockedIVsHandler`

**landed_cost.handlers.ts:** `createLandedCostHandler`, `listLandedCostsHandler`, `getLandedCostHandler`, `addLCLineHandler`, `updateLCLineHandler`, `deleteLCLineHandler`, `postLandedCostHandler`, `getLandedCostForGRNHandler`

## Critical Business Logic

**addIVLineHandler:**
- All GRN lines in one IV must be from the same vendor. Validate on add.
- Check GRN line not already fully invoiced in another POSTED IV.

**runMatchHandler (core):**
```
For each IV line:
  rate_variance_pct = ABS(invoice_rate - po_rate) / po_rate × 100
  match_status = (rate_variance_pct > 50) ? 'BLOCKED' : 'MATCHED'
  
  // GST verification
  gst_type = derive_from_vendor_state_vs_company_state()
  calculated_gst = taxable_value × gst_rate / 100
  gst_match_flag = ABS(calculated_gst - invoice_gst_amount) < 1.00

// Header
iv.status = (any line BLOCKED) ? 'BLOCKED' : 'MATCHED'
iv.total_taxable_value = sum(lines.taxable_value)
iv.total_gst_amount = sum(cgst + sgst + igst)
iv.total_invoice_value = total_taxable + total_gst
```

**postIVHandler:**
- Validate iv.status = 'MATCHED' → else 400 (cannot post BLOCKED or DRAFT IV)
- Record posted_by + posted_at

**GST type derivation** (used in runMatchHandler):
- Fetch vendor.state from vendor_master (erp_master schema)
- Fetch company.state from companies (erp_master schema)
- If same state: CGST_SGST, else IGST

## After Implementation — Update Log
Set Gate-16.8 items to DONE.

---
*Brief frozen: 2026-05-12*
