# OM-GATE-16.8 — Invoice Verification + Landed Cost Backend
# PACE-ERP Operation Management — Procurement

**Gate:** 16.8
**Phase:** Operation Management — Layer 2 Backend
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-16.4 VERIFIED ✅ (GRN must exist before IV/LC)
**Design Reference:** Section 100 (Invoice Verification), Section 87.9 (Landed Cost)

---

## 1. What You Are Building

Invoice Verification (3-way match, 50% hard block, GST verification) and Landed Cost entry.
These are Accounts-team handlers — no stock movements, only financial documents.

Create: `supabase/functions/api/_core/procurement/invoice_verification.handlers.ts`
Create: `supabase/functions/api/_core/procurement/landed_cost.handlers.ts`
Modify: `supabase/functions/api/_routes/procurement.routes.ts`

---

## 2. Invoice Verification Handler List

Schema: `erp_procurement.invoice_verification` + `erp_procurement.invoice_verification_line`

| Function | Route | Description |
|---|---|---|
| `createIVDraftHandler` | `POST:/api/procurement/invoice-verifications` | Create IV in DRAFT. iv_number via `generate_doc_number('IV')`. vendor_invoice_number + vendor_invoice_date mandatory. Multiple GRN lines can be included in one IV. |
| `listIVsHandler` | `GET:/api/procurement/invoice-verifications` | List IVs. Filters: company_id, vendor_id, status, date range. |
| `getIVHandler` | `GET:/api/procurement/invoice-verifications/:id` | Get IV with lines + GRN references + match results. |
| `addIVLineHandler` | `POST:/api/procurement/invoice-verifications/:id/lines` | Add GRN line to IV. Line must belong to a POSTED GRN for same vendor. Validates: not already invoiced in another POSTED IV. |
| `removeIVLineHandler` | `DELETE:/api/procurement/invoice-verifications/:id/lines/:line_id` | Remove IV line. Only if IV status = DRAFT. |
| `runMatchHandler` | `POST:/api/procurement/invoice-verifications/:id/run-match` | Run 3-way match on all lines. Updates line.rate_variance_pct. Updates line.match_status. Updates IV header totals. Updates IV status (MATCHED or BLOCKED). |
| `postIVHandler` | `POST:/api/procurement/invoice-verifications/:id/post` | Post IV. Only if status = MATCHED. Status → POSTED. Records posted_by + posted_at. |
| `listBlockedIVsHandler` | `GET:/api/procurement/invoice-verifications/blocked` | List BLOCKED IVs for Accounts dashboard. company_id filter. Uses idx_iv_blocked partial index. |

---

## 3. 3-Way Match Logic (inside `runMatchHandler`)

For each IV line:
```
po_rate = iv_line.po_rate  (from PO line at time of GRN)
invoice_rate = iv_line.invoice_rate  (entered by Accounts)
rate_variance_pct = ABS(invoice_rate - po_rate) / po_rate × 100

if rate_variance_pct > 50:
  line.match_status = 'BLOCKED'
else:
  line.match_status = 'MATCHED'
```

GST verification per line:
```
gst_type = derived from vendor.state vs company.state (intra=CGST_SGST, inter=IGST)
calculated_gst = taxable_value × gst_rate / 100
if ABS(calculated_gst - invoice_gst_amount) < 1.00:  (tolerance = ₹1)
  gst_match_flag = true
else:
  gst_match_flag = false
```

**Header status update:**
```
if any line.match_status = 'BLOCKED':
  iv.status = 'BLOCKED'
else:
  iv.status = 'MATCHED'
```

**Header totals:**
```
iv.total_taxable_value = sum(lines.taxable_value)
iv.total_gst_amount = sum(lines.cgst_amount + lines.sgst_amount + lines.igst_amount)
iv.total_invoice_value = total_taxable_value + total_gst_amount
```

---

## 4. Landed Cost Handler List

Schema: `erp_procurement.landed_cost` + `erp_procurement.landed_cost_line`

| Function | Route | Description |
|---|---|---|
| `createLandedCostHandler` | `POST:/api/procurement/landed-costs` | Create LC document. lc_number via `generate_doc_number('LC')`. References grn_id and/or csn_id. Accounts team creates after GRN — retroactive allowed. |
| `listLandedCostsHandler` | `GET:/api/procurement/landed-costs` | Filters: company_id, grn_id, csn_id, status. |
| `getLandedCostHandler` | `GET:/api/procurement/landed-costs/:id` | Get LC with lines. |
| `addLCLineHandler` | `POST:/api/procurement/landed-costs/:id/lines` | Add cost line. cost_type: FREIGHT/INSURANCE/CUSTOMS_DUTY/CHA_CHARGES/LOADING/UNLOADING/PORT_CHARGES/OTHER. bill_reference, bill_date, amount mandatory. |
| `updateLCLineHandler` | `PUT:/api/procurement/landed-costs/:id/lines/:line_id` | Update line amount/reference. Only DRAFT LC. |
| `deleteLCLineHandler` | `DELETE:/api/procurement/landed-costs/:id/lines/:line_id` | Delete line. Only DRAFT LC. |
| `postLandedCostHandler` | `POST:/api/procurement/landed-costs/:id/post` | Post LC. Updates total_cost = sum of all lines. Status DRAFT → POSTED. |
| `getLandedCostForGRNHandler` | `GET:/api/procurement/landed-costs/by-grn/:grn_id` | Get all LC documents for a GRN. Used by Debit Note handler to calculate proportional landed cost. |

---

## 5. Business Rules

| Rule | Detail |
|---|---|
| IV hard block | BLOCKED status IV cannot be posted. Accounts must resolve: either get corrected invoice or PO amendment to bring variance ≤ 50%. |
| Partial invoicing | invoice_qty on IV line can be < grn_qty. Remaining grn_qty stays open for next IV. |
| Same vendor | All GRN lines in one IV must be from the same vendor. Validate on addIVLineHandler. |
| GST type auto-derived | Handler derives gst_type from vendor_master.state vs company.state. Not manually entered. |
| LC retroactive | No date restriction. Accounts can enter LC any time after GRN. |
| LC totals | postLandedCostHandler sets total_cost = sum(lc_line.amount). |
| Run match required | postIVHandler must check status = MATCHED before allowing post. If DRAFT or BLOCKED → 400. |
| vendor_invoice_number unique | Per vendor: warn (not block) if vendor_invoice_number already exists in another POSTED IV for same vendor. |

---

## 6. Verification — Claude Will Check

1. `runMatchHandler` calculates rate_variance_pct correctly: ABS(invoice - po) / po × 100
2. `runMatchHandler` sets BLOCKED if ANY line > 50%
3. `runMatchHandler` updates header totals (taxable, gst, invoice value)
4. `postIVHandler` blocks if status != MATCHED
5. GST verification logic present (gst_match_flag update)
6. `addIVLineHandler` validates all lines belong to same vendor
7. `createLandedCostHandler` allows grn_id and/or csn_id (both nullable — either or both)
8. All routes added to procurement.routes.ts

---

*Spec frozen: 2026-05-12 | Reference: Section 100, Section 87.9*
