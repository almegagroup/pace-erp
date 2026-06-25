/*
 * File-ID: ACL-ROUTE-REGISTRY
 * File-Path: supabase/functions/api/_acl/route-acl-registry.ts
 * Purpose: Central registry mapping every API route to its ACL resource_code + action.
 *
 * RULES (NEVER VIOLATE):
 * 1. Every protected route MUST be registered here.
 * 2. If a route is missing → ROUTE_ACL_NOT_REGISTERED error (loud failure, not silent 403).
 * 3. SA/GA bypass ACL entirely (handled in pipeline, not here).
 * 4. Public routes are in ACL_SUPPORT_ROUTES (runner.ts) — not here.
 * 5. When adding a new route → add it here FIRST, then add the handler.
 *
 * HOW TO ADD A NEW ROUTE:
 *   Exact route:  Add to EXACT_ROUTE_ACL
 *   Param route:  Add to PATTERN_ROUTE_ACL
 *   Skip ACL:     Add to SKIP_ACL_ROUTES (only for support/utility endpoints)
 */

import type { VwedAction } from "./vwed_engine.ts";

export type RouteAclMeta =
  | { skipAcl: true }
  | { skipAcl: false; resourceCode: string; action: VwedAction };

// ---------------------------------------------------------------------------
// Exact route ACL mapping (METHOD:/path → ACL meta)
// ---------------------------------------------------------------------------

const EXACT_ROUTE_ACL: Record<string, RouteAclMeta> = {

  // ── Procurement: CSN ─────────────────────────────────────────────────────
  "GET:/api/procurement/csns":                        { skipAcl: false, resourceCode: "PROC_CSN_TRACKER", action: "VIEW" },
  "GET:/api/procurement/tracker":                     { skipAcl: false, resourceCode: "PROC_CSN_TRACKER", action: "VIEW" },
  "GET:/api/procurement/alerts/lc-count":             { skipAcl: false, resourceCode: "PROC_CSN_ALERTS",  action: "VIEW" },
  "GET:/api/procurement/alerts/lc":                   { skipAcl: false, resourceCode: "PROC_CSN_ALERTS",  action: "VIEW" },
  "GET:/api/procurement/alerts/vessel-booking-count": { skipAcl: false, resourceCode: "PROC_CSN_ALERTS",  action: "VIEW" },
  "GET:/api/procurement/alerts/vessel-booking":       { skipAcl: false, resourceCode: "PROC_CSN_ALERTS",  action: "VIEW" },
  "GET:/api/procurement/alerts/counts":               { skipAcl: false, resourceCode: "PROC_CSN_ALERTS",  action: "VIEW" },

  // ── Procurement: Purchase Orders ─────────────────────────────────────────
  "GET:/api/procurement/purchase-orders":             { skipAcl: false, resourceCode: "PROC_PO_LIST",   action: "VIEW"  },
  "POST:/api/procurement/purchase-orders":            { skipAcl: false, resourceCode: "PROC_PO_CREATE", action: "WRITE" },
  "GET:/api/procurement/po-order-groups":             { skipAcl: false, resourceCode: "PROC_PO_ORDER_APPROVALS", action: "VIEW" },
  "GET:/api/procurement/po-filter-options":           { skipAcl: false, resourceCode: "PROC_PO_LIST",   action: "VIEW"  },

  // ── Procurement: Gate Entry ───────────────────────────────────────────────
  "GET:/api/procurement/gate-entries":                { skipAcl: false, resourceCode: "PROC_GATE_ENTRY_LIST",   action: "VIEW"  },
  "POST:/api/procurement/gate-entries":               { skipAcl: false, resourceCode: "PROC_GATE_ENTRY_CREATE", action: "WRITE" },
  "GET:/api/procurement/gate-entries/open-csns":      { skipAcl: false, resourceCode: "PROC_GATE_ENTRY_CREATE", action: "VIEW"  },
  "POST:/api/procurement/gate-exits/inbound":         { skipAcl: false, resourceCode: "PROC_GATE_ENTRY_CREATE", action: "WRITE" },

  // ── Procurement: GRN ─────────────────────────────────────────────────────
  "GET:/api/procurement/grns":                        { skipAcl: false, resourceCode: "PROC_GRN_LIST", action: "VIEW"  },
  "POST:/api/procurement/grns":                       { skipAcl: false, resourceCode: "PROC_GRN_LIST", action: "WRITE" },

  // ── Procurement: Inward QA ────────────────────────────────────────────────
  "GET:/api/procurement/qa-documents":                { skipAcl: false, resourceCode: "PROC_QA_QUEUE", action: "VIEW"  },

  // ── Procurement: Invoice Verification ────────────────────────────────────
  "GET:/api/procurement/invoice-verifications":         { skipAcl: false, resourceCode: "PROC_IV_LIST",   action: "VIEW"  },
  "POST:/api/procurement/invoice-verifications":        { skipAcl: false, resourceCode: "PROC_IV_CREATE", action: "WRITE" },
  "GET:/api/procurement/invoice-verifications/blocked": { skipAcl: false, resourceCode: "PROC_BLOCKED_IV_LIST", action: "VIEW" },

  // ── Procurement: Landed Cost ─────────────────────────────────────────────
  "GET:/api/procurement/landed-costs":                { skipAcl: false, resourceCode: "PROC_LC_LIST", action: "VIEW"  },
  "POST:/api/procurement/landed-costs":               { skipAcl: false, resourceCode: "PROC_LC_LIST", action: "WRITE" },

  // ── Procurement: Plant Transfer (PTO) ────────────────────────────────────
  "GET:/api/procurement/ptos":                        { skipAcl: false, resourceCode: "PROC_PLANT_TRANSFER_LIST", action: "VIEW"  },
  "POST:/api/procurement/ptos":                       { skipAcl: false, resourceCode: "PROC_PLANT_TRANSFER_LIST", action: "WRITE" },
  "POST:/api/procurement/sloc-transfer":              { skipAcl: false, resourceCode: "PROC_PLANT_TRANSFER_LIST", action: "WRITE" },

  // ── Procurement: RTV / Debit Note / Exchange ──────────────────────────────
  "GET:/api/procurement/rtvs":                        { skipAcl: false, resourceCode: "PROC_RTV_LIST",   action: "VIEW"  },
  "POST:/api/procurement/rtvs":                       { skipAcl: false, resourceCode: "PROC_RTV_CREATE", action: "WRITE" },
  "GET:/api/procurement/debit-notes":                 { skipAcl: false, resourceCode: "PROC_DEBIT_NOTE_LIST", action: "VIEW"  },
  "POST:/api/procurement/debit-notes":                { skipAcl: false, resourceCode: "PROC_DEBIT_NOTE_LIST", action: "WRITE" },
  "GET:/api/procurement/exchange-refs":               { skipAcl: false, resourceCode: "PROC_EXCHANGE_REF_LIST", action: "VIEW"  },
  "POST:/api/procurement/exchange-refs":              { skipAcl: false, resourceCode: "PROC_EXCHANGE_REF_LIST", action: "WRITE" },

  // ── Procurement: STO ─────────────────────────────────────────────────────
  "GET:/api/procurement/stos":                        { skipAcl: false, resourceCode: "PROC_STO_LIST",   action: "VIEW"  },
  "POST:/api/procurement/stos":                       { skipAcl: false, resourceCode: "PROC_STO_CREATE", action: "WRITE" },

  // ── Procurement: Sales ───────────────────────────────────────────────────
  "GET:/api/procurement/sales-orders":                { skipAcl: false, resourceCode: "PROC_SO_LIST",   action: "VIEW"  },
  "POST:/api/procurement/sales-orders":               { skipAcl: false, resourceCode: "PROC_SO_CREATE", action: "WRITE" },
  "GET:/api/procurement/sales-invoices":              { skipAcl: false, resourceCode: "PROC_INV_LIST",  action: "VIEW"  },
  "POST:/api/procurement/sales-invoices":             { skipAcl: false, resourceCode: "PROC_INV_LIST",  action: "WRITE" },

  // ── Procurement: Physical Inventory ──────────────────────────────────────
  "GET:/api/procurement/physical-inventory":          { skipAcl: false, resourceCode: "PROC_PI_LIST", action: "VIEW"  },
  "POST:/api/procurement/physical-inventory":         { skipAcl: false, resourceCode: "PROC_PI_LIST", action: "WRITE" },

  // ── Procurement: Opening Stock ────────────────────────────────────────────
  "GET:/api/procurement/opening-stock":               { skipAcl: false, resourceCode: "SA_OPENING_STOCK_LIST", action: "VIEW"  },
  "POST:/api/procurement/opening-stock":              { skipAcl: false, resourceCode: "SA_OPENING_STOCK_LIST", action: "WRITE" },

  // ── Procurement: Reports ──────────────────────────────────────────────────
  "GET:/api/procurement/planning":                    { skipAcl: false, resourceCode: "PROC_PLANNING_VIEW",  action: "VIEW" },
  "GET:/api/procurement/document-flow":               { skipAcl: false, resourceCode: "PROC_PO_LIST",        action: "VIEW" },
  "GET:/api/procurement/stock-ledger":                { skipAcl: false, resourceCode: "PROC_STOCK_LEDGER",   action: "VIEW" },
  "GET:/api/procurement/current-stock":               { skipAcl: false, resourceCode: "PROC_CURRENT_STOCK",  action: "VIEW" },
  "GET:/api/procurement/stock-valuation":             { skipAcl: false, resourceCode: "PROC_STOCK_VALUATION", action: "VIEW" },

  // ── Procurement: L2 Masters (Payment Terms, Ports, etc.) ─────────────────
  "GET:/api/procurement/payment-terms":               { skipAcl: false, resourceCode: "PROC_PAYMENT_TERMS_MASTER",      action: "VIEW"  },
  "POST:/api/procurement/payment-terms":              { skipAcl: false, resourceCode: "PROC_PAYMENT_TERMS_MASTER",      action: "WRITE" },
  "POST:/api/procurement/payment-terms/toggle":       { skipAcl: false, resourceCode: "PROC_PAYMENT_TERMS_MASTER",      action: "WRITE" },
  "GET:/api/procurement/reference-date-types":        { skipAcl: true },
  "POST:/api/procurement/reference-date-type":        { skipAcl: false, resourceCode: "PROC_PAYMENT_TERMS_MASTER",      action: "WRITE" },
  "POST:/api/procurement/reference-date-type/toggle": { skipAcl: false, resourceCode: "PROC_PAYMENT_TERMS_MASTER",      action: "WRITE" },
  "GET:/api/procurement/ports":                       { skipAcl: false, resourceCode: "PROC_PORT_MASTER",               action: "VIEW"  },
  "POST:/api/procurement/ports":                      { skipAcl: false, resourceCode: "PROC_PORT_MASTER",               action: "WRITE" },
  "POST:/api/procurement/ports/toggle":               { skipAcl: false, resourceCode: "PROC_PORT_MASTER",               action: "WRITE" },
  "GET:/api/procurement/port-transit":                { skipAcl: false, resourceCode: "PROC_PORT_TRANSIT_MASTER",       action: "VIEW"  },
  "POST:/api/procurement/port-transit":               { skipAcl: false, resourceCode: "PROC_PORT_TRANSIT_MASTER",       action: "WRITE" },
  "GET:/api/procurement/material-categories":         { skipAcl: false, resourceCode: "PROC_MATERIAL_CATEGORY_MASTER",  action: "VIEW"  },
  "POST:/api/procurement/material-categories":        { skipAcl: false, resourceCode: "PROC_MATERIAL_CATEGORY_MASTER",  action: "WRITE" },
  "GET:/api/procurement/lead-times/import":           { skipAcl: false, resourceCode: "PROC_IMPORT_LEAD_TIME_MASTER",   action: "VIEW"  },
  "POST:/api/procurement/lead-times/import":          { skipAcl: false, resourceCode: "PROC_IMPORT_LEAD_TIME_MASTER",   action: "WRITE" },
  "GET:/api/procurement/lead-times/domestic":         { skipAcl: false, resourceCode: "PROC_DOMESTIC_LEAD_TIME_MASTER", action: "VIEW"  },
  "POST:/api/procurement/lead-times/domestic":        { skipAcl: false, resourceCode: "PROC_DOMESTIC_LEAD_TIME_MASTER", action: "WRITE" },
  "GET:/api/procurement/transporters":                { skipAcl: false, resourceCode: "PROC_TRANSPORTER_MASTER",        action: "VIEW"  },
  "POST:/api/procurement/transporters":               { skipAcl: false, resourceCode: "PROC_TRANSPORTER_MASTER",        action: "WRITE" },
  "GET:/api/procurement/transporters/contacts":       { skipAcl: false, resourceCode: "PROC_TRANSPORTER_MASTER",        action: "VIEW"  },
  "POST:/api/procurement/transporters/contacts":      { skipAcl: false, resourceCode: "PROC_TRANSPORTER_MASTER",        action: "EDIT"  },
  "GET:/api/procurement/transporters/emails":         { skipAcl: false, resourceCode: "PROC_TRANSPORTER_MASTER",        action: "VIEW"  },
  "POST:/api/procurement/transporters/emails":        { skipAcl: false, resourceCode: "PROC_TRANSPORTER_MASTER",        action: "EDIT"  },
  "GET:/api/procurement/transporters/company-map":    { skipAcl: false, resourceCode: "PROC_TRANSPORTER_MASTER",        action: "VIEW"  },
  "POST:/api/procurement/transporters/company-map":   { skipAcl: false, resourceCode: "PROC_TRANSPORTER_MASTER",        action: "EDIT"  },
  "GET:/api/procurement/gst-profile":                 { skipAcl: true },
  "GET:/api/procurement/companies":                   { skipAcl: true },
  "GET:/api/procurement/chas":                        { skipAcl: false, resourceCode: "PROC_CHA_MASTER",                action: "VIEW"  },
  "POST:/api/procurement/chas":                       { skipAcl: false, resourceCode: "PROC_CHA_MASTER",                action: "WRITE" },
  "POST:/api/procurement/chas/toggle":                { skipAcl: false, resourceCode: "PROC_CHA_MASTER",                action: "EDIT"  },
  "GET:/api/procurement/chas/contacts":               { skipAcl: false, resourceCode: "PROC_CHA_MASTER",                action: "VIEW"  },
  "POST:/api/procurement/chas/contacts":              { skipAcl: false, resourceCode: "PROC_CHA_MASTER",                action: "EDIT"  },
  "GET:/api/procurement/chas/emails":                 { skipAcl: false, resourceCode: "PROC_CHA_MASTER",                action: "VIEW"  },
  "POST:/api/procurement/chas/emails":                { skipAcl: false, resourceCode: "PROC_CHA_MASTER",                action: "EDIT"  },
  "GET:/api/procurement/chas/company-map":            { skipAcl: false, resourceCode: "PROC_CHA_MASTER",                action: "VIEW"  },
  "POST:/api/procurement/chas/company-map":           { skipAcl: false, resourceCode: "PROC_CHA_MASTER",                action: "EDIT"  },

  // ── Procurement: Number Series (SA-level) ────────────────────────────────
  "GET:/api/procurement/number-series/global":        { skipAcl: true },
  "GET:/api/procurement/number-series/company":       { skipAcl: true },
  "POST:/api/procurement/number-series/company":      { skipAcl: true },

  // ── OM: Material ─────────────────────────────────────────────────────────
  "GET:/api/om/materials":                            { skipAcl: false, resourceCode: "OM_MATERIAL_LIST",   action: "VIEW"  },
  "POST:/api/om/material":                            { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },
  "PATCH:/api/om/material":                           { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "EDIT"  },
  "GET:/api/om/material/category-groups":             { skipAcl: false, resourceCode: "OM_MATERIAL_LIST",   action: "VIEW"  },
  "POST:/api/om/material/category-group":             { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },
  "PATCH:/api/om/material/category-group":            { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },
  "DELETE:/api/om/material/category-group":           { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },
  "POST:/api/om/material/category-group/member":      { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },
  "DELETE:/api/om/material/category-group/member":    { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },
  "GET:/api/om/material/uom-conversions":             { skipAcl: false, resourceCode: "OM_MATERIAL_LIST",   action: "VIEW"  },
  "POST:/api/om/material/uom-conversion":             { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },
  "POST:/api/om/material/status":                     { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "EDIT"  },
  "POST:/api/om/material/extend-company":             { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },
  "POST:/api/om/material/extend-plant":               { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },
  "GET:/api/om/material":                             { skipAcl: false, resourceCode: "OM_MATERIAL_LIST",   action: "VIEW"  },
  "GET:/api/om/material/company-extensions":          { skipAcl: false, resourceCode: "OM_MATERIAL_LIST",   action: "VIEW"  },
  "GET:/api/om/material/plant-extensions":            { skipAcl: false, resourceCode: "OM_MATERIAL_LIST",   action: "VIEW"  },
  "POST:/api/om/materials/bulk-save":                 { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },
  "DELETE:/api/om/materials":                         { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },
  "POST:/api/om/materials/import":                    { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },
  "GET:/api/om/material/company-mapping":             { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "VIEW"  },
  "POST:/api/om/material/company-map-bulk":           { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },
  "DELETE:/api/om/material/company-unmap-bulk":       { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },
  "POST:/api/om/material/company-mapping-import":     { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },

  // ── OM: Vendor ───────────────────────────────────────────────────────────
  "GET:/api/om/vendors":                              { skipAcl: false, resourceCode: "OM_VENDOR_LIST",   action: "VIEW"  },
  "GET:/api/om/vendor":                               { skipAcl: false, resourceCode: "OM_VENDOR_LIST",   action: "VIEW"  },
  "POST:/api/om/vendor":                              { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "WRITE" },
  "PATCH:/api/om/vendor":                             { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "EDIT"  },
  "POST:/api/om/vendor/status":                       { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "EDIT"  },
  "DELETE:/api/om/vendors":                           { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "WRITE" },
  "GET:/api/om/vendor/banks":                         { skipAcl: false, resourceCode: "OM_VENDOR_LIST",   action: "VIEW"  },
  "POST:/api/om/vendor/banks":                        { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "WRITE" },
  "GET:/api/om/vendor/contacts":                      { skipAcl: false, resourceCode: "OM_VENDOR_LIST",   action: "VIEW"  },
  "POST:/api/om/vendor/contacts":                     { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "WRITE" },
  "GET:/api/om/vendor/emails":                        { skipAcl: false, resourceCode: "OM_VENDOR_LIST",   action: "VIEW"  },
  "POST:/api/om/vendor/emails":                       { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "WRITE" },
  "GET:/api/om/vendor/company-mapping":               { skipAcl: false, resourceCode: "OM_VENDOR_LIST",   action: "VIEW"  },
  "POST:/api/om/vendor/company-map-bulk":             { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "WRITE" },
  "DELETE:/api/om/vendor/company-unmap-bulk":         { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "WRITE" },
  "POST:/api/om/vendor/company-map":                  { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "WRITE" },
  "GET:/api/om/vendor/company-maps":                  { skipAcl: false, resourceCode: "OM_VENDOR_LIST",   action: "VIEW"  },
  "GET:/api/om/vendor/payment-terms":                 { skipAcl: false, resourceCode: "OM_VENDOR_LIST",   action: "VIEW"  },
  "POST:/api/om/vendor/payment-terms":                { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "WRITE" },
  "GET:/api/om/vendor-material-infos":                { skipAcl: false, resourceCode: "OM_VENDOR_LIST",   action: "VIEW"  },
  "GET:/api/om/vendor-material-info":                 { skipAcl: false, resourceCode: "OM_VENDOR_LIST",   action: "VIEW"  },
  "POST:/api/om/vendor-material-info":                { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "WRITE" },
  "PATCH:/api/om/vendor-material-info":               { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "EDIT"  },
  "POST:/api/om/vendor-material-info/status":         { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "EDIT"  },
  "DELETE:/api/om/vendor-material-info":              { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "WRITE" },

  // ── OM: Customer ─────────────────────────────────────────────────────────
  "GET:/api/om/customers":                            { skipAcl: false, resourceCode: "OM_CUSTOMER_LIST",   action: "VIEW"  },
  "POST:/api/om/customer":                            { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "WRITE" },
  "PATCH:/api/om/customer":                           { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "EDIT"  },
  "POST:/api/om/customer/status":                     { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "EDIT"  },
  "POST:/api/om/customer/company-map":                { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "WRITE" },
  "GET:/api/om/customer/company-maps":                { skipAcl: false, resourceCode: "OM_CUSTOMER_LIST",   action: "VIEW"  },

  // ── OM: Parent Customer (groups RM/PM Sales Customer rows) ──────────────
  "GET:/api/om/parent-customers":                     { skipAcl: false, resourceCode: "OM_CUSTOMER_LIST",   action: "VIEW"  },
  "POST:/api/om/parent-customer":                     { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "WRITE" },
  "PATCH:/api/om/parent-customer":                    { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "EDIT"  },

  // ── OM: Utility (used by forms — skipAcl) ────────────────────────────────
  "GET:/api/om/uoms":                                 { skipAcl: true },
  "POST:/api/om/uom":                                 { skipAcl: true },
  "PATCH:/api/om/uom":                                { skipAcl: true },
  "POST:/api/om/uom/toggle":                          { skipAcl: true },
  "GET:/api/om/storage-locations":                    { skipAcl: true },
  "POST:/api/om/storage-location":                    { skipAcl: true },
  "PATCH:/api/om/storage-location":                   { skipAcl: true },
  "POST:/api/om/storage-location/toggle":             { skipAcl: true },
  "GET:/api/om/storage-location/plant-assignments":   { skipAcl: true },
  "POST:/api/om/storage-location/plant-map":          { skipAcl: true },
  "POST:/api/om/storage-location/plant-unmap":        { skipAcl: true },
  "GET:/api/om/cost-centers":                         { skipAcl: true },
  "POST:/api/om/cost-center":                         { skipAcl: true },
  "PATCH:/api/om/cost-center":                        { skipAcl: true },
  "POST:/api/om/cost-center/toggle":                  { skipAcl: true },
  "GET:/api/om/material-type-categories":             { skipAcl: true },
  "POST:/api/om/material-type-category":              { skipAcl: true },
  "GET:/api/om/machines":                             { skipAcl: true },
  "POST:/api/om/machine":                             { skipAcl: true },
  "PATCH:/api/om/machine":                            { skipAcl: true },
  "POST:/api/om/machine/toggle":                      { skipAcl: true },
  "GET:/api/om/number-series":                        { skipAcl: true },
  "POST:/api/om/number-series":                       { skipAcl: true },

  // ── Admin: All routes — SA/GA only, ACL enforced in stepAcl (skipAcl here) ─
  "GET:/api/admin/system-health":                          { skipAcl: true },
  "GET:/api/admin/control-panel":                          { skipAcl: true },
  "GET:/api/admin/signup-requests":                        { skipAcl: true },
  "POST:/api/admin/signup-requests/approve":               { skipAcl: true },
  "POST:/api/admin/signup-requests/reject":                { skipAcl: true },
  "POST:/api/admin/company":                               { skipAcl: true },
  "GET:/api/admin/companies":                              { skipAcl: true },
  "GET:/api/admin/company/gst-profile":                    { skipAcl: true },
  "POST:/api/admin/company/state":                         { skipAcl: true },
  "PATCH:/api/admin/company/address":                      { skipAcl: true },
  "POST:/api/admin/group":                                 { skipAcl: true },
  "PATCH:/api/admin/group":                                { skipAcl: true },
  "DELETE:/api/admin/group":                               { skipAcl: true },
  "GET:/api/admin/groups":                                 { skipAcl: true },
  "POST:/api/admin/group/state":                           { skipAcl: true },
  "POST:/api/admin/group/map-company":                     { skipAcl: true },
  "POST:/api/admin/company-group/unmap":                   { skipAcl: true },
  "POST:/api/admin/project":                               { skipAcl: true },
  "GET:/api/admin/projects":                               { skipAcl: true },
  "POST:/api/admin/project/state":                         { skipAcl: true },
  "GET:/api/admin/project/company-map":                    { skipAcl: true },
  "POST:/api/admin/project/map-company":                   { skipAcl: true },
  "POST:/api/admin/project/unmap-company":                 { skipAcl: true },
  "POST:/api/admin/module":                                { skipAcl: true },
  "POST:/api/admin/module/update":                         { skipAcl: true },
  "GET:/api/admin/modules":                                { skipAcl: true },
  "GET:/api/admin/module-resource-map":                    { skipAcl: true },
  "POST:/api/admin/module-resource-map":                   { skipAcl: true },
  "POST:/api/admin/module-resource-map/remove":            { skipAcl: true },
  "POST:/api/admin/module/state":                          { skipAcl: true },
  "POST:/api/admin/department":                            { skipAcl: true },
  "GET:/api/admin/departments":                            { skipAcl: true },
  "POST:/api/admin/department/state":                      { skipAcl: true },
  "GET:/api/admin/approval/approvers":                     { skipAcl: true },
  "GET:/api/admin/approval/workspace":                     { skipAcl: true },
  "GET:/api/admin/report-visibility/workspace":            { skipAcl: true },
  "GET:/api/admin/approval/resource-policy":               { skipAcl: true },
  "POST:/api/admin/approval/resource-policy":              { skipAcl: true },
  "POST:/api/admin/approval/approvers":                    { skipAcl: true },
  "POST:/api/admin/approval/approvers/delete":             { skipAcl: true },
  "GET:/api/admin/approval/viewers":                       { skipAcl: true },
  "POST:/api/admin/approval/viewers":                      { skipAcl: true },
  "POST:/api/admin/approval/viewers/delete":               { skipAcl: true },
  "GET:/api/admin/acl/capabilities":                       { skipAcl: true },
  "POST:/api/admin/acl/capabilities":                      { skipAcl: true },
  "GET:/api/admin/acl/capability-actions":                 { skipAcl: true },
  "POST:/api/admin/acl/capability-actions":                { skipAcl: true },
  "POST:/api/admin/acl/capability-actions/disable":        { skipAcl: true },
  "GET:/api/admin/acl/work-contexts":                      { skipAcl: true },
  "POST:/api/admin/acl/work-contexts":                     { skipAcl: true },
  "GET:/api/admin/acl/work-context-capabilities":          { skipAcl: true },
  "POST:/api/admin/acl/work-context-capabilities/assign":  { skipAcl: true },
  "POST:/api/admin/acl/work-context-capabilities/unassign":{ skipAcl: true },
  "GET:/api/admin/acl/work-context-projects":              { skipAcl: true },
  "POST:/api/admin/acl/work-context-projects":             { skipAcl: true },
  "GET:/api/admin/acl/governance-summary-report":          { skipAcl: true },
  "GET:/api/admin/acl/versions":                           { skipAcl: true },
  "GET:/api/admin/acl/version-center":                     { skipAcl: true },
  "POST:/api/admin/acl/versions":                          { skipAcl: true },
  "POST:/api/admin/acl/versions/activate":                 { skipAcl: true },
  "POST:/api/admin/acl/versions/delete":                   { skipAcl: true },
  "GET:/api/admin/users":                                  { skipAcl: true },
  "GET:/api/admin/users/report":                           { skipAcl: true },
  "GET:/api/admin/users/scope":                            { skipAcl: true },
  "POST:/api/admin/users/scope":                           { skipAcl: true },
  "POST:/api/admin/users/state":                           { skipAcl: true },
  "POST:/api/admin/users/role":                            { skipAcl: true },
  "PATCH:/api/admin/users/scope/primary-company":          { skipAcl: true },
  "GET:/api/admin/audit":                                  { skipAcl: true },
  "GET:/api/admin/sessions":                               { skipAcl: true },
  "POST:/api/admin/sessions/revoke":                       { skipAcl: true },
};

// ---------------------------------------------------------------------------
// Pattern-based ACL mapping (for parameterized routes like /grns/:id)
// ---------------------------------------------------------------------------

type PatternAclEntry = {
  pattern: RegExp;
  methods: Partial<Record<string, RouteAclMeta>>;
};

const PATTERN_ROUTE_ACL: PatternAclEntry[] = [

  // ── PO ───────────────────────────────────────────────────────────────────
  {
    pattern: /^\/api\/procurement\/purchase-orders\/[^/]+$/,
    methods: {
      GET:    { skipAcl: false, resourceCode: "PROC_PO_LIST",   action: "VIEW"   },
      PUT:    { skipAcl: false, resourceCode: "PROC_PO_CREATE", action: "EDIT"   },
      DELETE: { skipAcl: false, resourceCode: "PROC_PO_CREATE", action: "DELETE" },
    },
  },
  {
    pattern: /^\/api\/procurement\/purchase-orders\/[^/]+\/approve$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PO_CREATE", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/procurement\/purchase-orders\/[^/]+\/reject$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PO_CREATE", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/procurement\/purchase-orders\/[^/]+\/cancel$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PO_CREATE", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/purchase-orders\/[^/]+\/confirm$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PO_CREATE", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/purchase-orders\/[^/]+\/amend$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PO_CREATE", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/purchase-orders\/[^/]+\/approve-amendment$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PO_CREATE", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/procurement\/purchase-orders\/[^/]+\/knock-off$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PO_CREATE", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/purchase-orders\/[^/]+\/lines\/[^/]+\/knock-off$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PO_CREATE", action: "EDIT" } },
  },

  // ── PO Order Group (internal batch-approval wrapper, 87.12A) ──────────────
  {
    pattern: /^\/api\/procurement\/po-order-groups\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROC_PO_ORDER_APPROVALS", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/procurement\/po-order-groups\/[^/]+\/confirm$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PO_ORDER_APPROVALS", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/po-order-groups\/[^/]+\/approve$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PO_ORDER_APPROVALS", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/procurement\/po-order-groups\/[^/]+\/reject$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PO_ORDER_APPROVALS", action: "APPROVE" } },
  },

  // ── CSN ──────────────────────────────────────────────────────────────────
  {
    pattern: /^\/api\/procurement\/csns\/[^/]+$/,
    methods: {
      GET: { skipAcl: false, resourceCode: "PROC_CSN_TRACKER", action: "VIEW" },
      PUT: { skipAcl: false, resourceCode: "PROC_CSN_TRACKER", action: "EDIT" },
    },
  },
  {
    pattern: /^\/api\/procurement\/csns\/[^/]+\/sub-csns$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_CSN_TRACKER", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/csns\/[^/]+\/sub-csns\/[^/]+$/,
    methods: { DELETE: { skipAcl: false, resourceCode: "PROC_CSN_TRACKER", action: "DELETE" } },
  },
  {
    pattern: /^\/api\/procurement\/csns\/[^/]+\/mark-in-transit$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_CSN_TRACKER", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/csns\/[^/]+\/mark-arrived$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_CSN_TRACKER", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/csns\/[^/]+\/transform-to-sto$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_STO_CREATE", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/tracker\/[^/]+\/inline$/,
    methods: { PUT: { skipAcl: false, resourceCode: "PROC_CSN_TRACKER", action: "EDIT" } },
  },

  // ── Gate Entry ───────────────────────────────────────────────────────────
  {
    pattern: /^\/api\/procurement\/gate-entries\/[^/]+$/,
    methods: {
      GET: { skipAcl: false, resourceCode: "PROC_GATE_ENTRY_LIST",   action: "VIEW" },
      PUT: { skipAcl: false, resourceCode: "PROC_GATE_ENTRY_CREATE", action: "EDIT" },
    },
  },
  {
    pattern: /^\/api\/procurement\/gate-exits\/inbound\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROC_GATE_ENTRY_LIST", action: "VIEW" } },
  },

  // ── GRN ──────────────────────────────────────────────────────────────────
  {
    pattern: /^\/api\/procurement\/grns\/[^/]+$/,
    methods: {
      GET: { skipAcl: false, resourceCode: "PROC_GRN_LIST", action: "VIEW" },
      PUT: { skipAcl: false, resourceCode: "PROC_GRN_LIST", action: "EDIT" },
    },
  },
  {
    pattern: /^\/api\/procurement\/grns\/[^/]+\/post$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_GRN_LIST", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/procurement\/grns\/[^/]+\/reverse$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_GRN_LIST", action: "DELETE" } },
  },

  // ── Inward QA ────────────────────────────────────────────────────────────
  {
    pattern: /^\/api\/procurement\/qa-documents\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROC_QA_QUEUE", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/procurement\/qa-documents\/[^/]+\/assign-officer$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_QA_QUEUE", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/qa-documents\/[^/]+\/test-lines$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_QA_QUEUE", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/qa-documents\/[^/]+\/test-lines\/[^/]+$/,
    methods: {
      PUT:    { skipAcl: false, resourceCode: "PROC_QA_QUEUE", action: "EDIT"   },
      DELETE: { skipAcl: false, resourceCode: "PROC_QA_QUEUE", action: "DELETE" },
    },
  },
  {
    pattern: /^\/api\/procurement\/qa-documents\/[^/]+\/usage-decision$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_QA_QUEUE", action: "APPROVE" } },
  },

  // ── Invoice Verification ──────────────────────────────────────────────────
  {
    pattern: /^\/api\/procurement\/invoice-verifications\/[^/]+$/,
    methods: {
      GET: { skipAcl: false, resourceCode: "PROC_IV_LIST",   action: "VIEW" },
      PUT: { skipAcl: false, resourceCode: "PROC_IV_CREATE", action: "EDIT" },
    },
  },
  {
    pattern: /^\/api\/procurement\/invoice-verifications\/[^/]+\/lines$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_IV_CREATE", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/invoice-verifications\/[^/]+\/lines\/[^/]+$/,
    methods: { DELETE: { skipAcl: false, resourceCode: "PROC_IV_CREATE", action: "DELETE" } },
  },
  {
    pattern: /^\/api\/procurement\/invoice-verifications\/[^/]+\/match$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_IV_CREATE", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/invoice-verifications\/[^/]+\/post$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_IV_CREATE", action: "APPROVE" } },
  },

  // ── Landed Cost ───────────────────────────────────────────────────────────
  {
    pattern: /^\/api\/procurement\/landed-costs\/[^/]+$/,
    methods: {
      GET: { skipAcl: false, resourceCode: "PROC_LC_LIST", action: "VIEW" },
      PUT: { skipAcl: false, resourceCode: "PROC_LC_LIST", action: "EDIT" },
    },
  },
  {
    pattern: /^\/api\/procurement\/landed-costs\/grn\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROC_LC_LIST", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/procurement\/landed-costs\/[^/]+\/lines$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_LC_LIST", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/landed-costs\/[^/]+\/lines\/[^/]+$/,
    methods: {
      PUT:    { skipAcl: false, resourceCode: "PROC_LC_LIST", action: "EDIT"   },
      DELETE: { skipAcl: false, resourceCode: "PROC_LC_LIST", action: "DELETE" },
    },
  },
  {
    pattern: /^\/api\/procurement\/landed-costs\/[^/]+\/post$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_LC_LIST", action: "APPROVE" } },
  },

  // ── PTO / Plant Transfer ──────────────────────────────────────────────────
  {
    pattern: /^\/api\/procurement\/ptos\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROC_PLANT_TRANSFER_LIST", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/procurement\/ptos\/[^/]+\/approve$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PLANT_TRANSFER_LIST", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/procurement\/ptos\/[^/]+\/cancel$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PLANT_TRANSFER_LIST", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/ptos\/[^/]+\/issue$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PLANT_TRANSFER_LIST", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/ptos\/[^/]+\/receive$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PLANT_TRANSFER_LIST", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/ptos\/[^/]+\/one-step$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PLANT_TRANSFER_LIST", action: "WRITE" } },
  },

  // ── RTV / Debit Note / Exchange ────────────────────────────────────────────
  {
    pattern: /^\/api\/procurement\/rtvs\/[^/]+$/,
    methods: {
      GET: { skipAcl: false, resourceCode: "PROC_RTV_LIST",   action: "VIEW" },
      PUT: { skipAcl: false, resourceCode: "PROC_RTV_CREATE", action: "EDIT" },
    },
  },
  {
    pattern: /^\/api\/procurement\/rtvs\/[^/]+\/lines$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_RTV_CREATE", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/rtvs\/[^/]+\/post$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_RTV_CREATE", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/procurement\/debit-notes\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROC_DEBIT_NOTE_LIST", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/procurement\/debit-notes\/[^/]+\/acknowledge$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_DEBIT_NOTE_LIST", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/procurement\/debit-notes\/[^/]+\/mark-sent$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_DEBIT_NOTE_LIST", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/debit-notes\/[^/]+\/settle$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_DEBIT_NOTE_LIST", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/procurement\/exchange-refs\/[^/]+\/link-grn$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_EXCHANGE_REF_LIST", action: "WRITE" } },
  },

  // ── STO ───────────────────────────────────────────────────────────────────
  {
    pattern: /^\/api\/procurement\/stos\/[^/]+$/,
    methods: {
      GET: { skipAcl: false, resourceCode: "PROC_STO_LIST",   action: "VIEW" },
      PUT: { skipAcl: false, resourceCode: "PROC_STO_CREATE", action: "EDIT" },
    },
  },
  {
    pattern: /^\/api\/procurement\/stos\/[^/]+\/dispatch$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_STO_CREATE", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/stos\/[^/]+\/confirm-receipt$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_STO_CREATE", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/procurement\/stos\/[^/]+\/cancel$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_STO_CREATE", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/stos\/[^/]+\/close$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_STO_CREATE", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/procurement\/stos\/[^/]+\/gate-exit-weight$/,
    methods: { PUT: { skipAcl: false, resourceCode: "PROC_STO_CREATE", action: "EDIT" } },
  },

  // ── Sales ─────────────────────────────────────────────────────────────────
  {
    pattern: /^\/api\/procurement\/sales-orders\/[^/]+$/,
    methods: {
      GET: { skipAcl: false, resourceCode: "PROC_SO_LIST",   action: "VIEW" },
      PUT: { skipAcl: false, resourceCode: "PROC_SO_CREATE", action: "EDIT" },
    },
  },
  {
    pattern: /^\/api\/procurement\/sales-orders\/[^/]+\/cancel$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_SO_CREATE", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/sales-orders\/[^/]+\/issue-stock$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_SO_CREATE", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/sales-orders\/[^/]+\/lines\/[^/]+\/knock-off$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_SO_CREATE", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/sales-invoices\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROC_INV_LIST", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/procurement\/sales-invoices\/[^/]+\/post$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_INV_LIST", action: "APPROVE" } },
  },

  // ── Physical Inventory ────────────────────────────────────────────────────
  {
    pattern: /^\/api\/procurement\/physical-inventory\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROC_PI_LIST", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/procurement\/physical-inventory\/[^/]+\/items$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PI_LIST", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/physical-inventory\/[^/]+\/items\/[^/]+\/count$/,
    methods: { PUT: { skipAcl: false, resourceCode: "PROC_PI_LIST", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/physical-inventory\/[^/]+\/items\/[^/]+\/recount$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PI_LIST", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/physical-inventory\/[^/]+\/post-differences$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PI_LIST", action: "APPROVE" } },
  },

  // ── Opening Stock ──────────────────────────────────────────────────────────
  {
    pattern: /^\/api\/procurement\/opening-stock\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "SA_OPENING_STOCK_LIST", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/procurement\/opening-stock\/[^/]+\/lines$/,
    methods: { POST: { skipAcl: false, resourceCode: "SA_OPENING_STOCK_LIST", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/opening-stock\/[^/]+\/lines\/[^/]+$/,
    methods: {
      PUT:    { skipAcl: false, resourceCode: "SA_OPENING_STOCK_LIST", action: "EDIT"   },
      DELETE: { skipAcl: false, resourceCode: "SA_OPENING_STOCK_LIST", action: "DELETE" },
    },
  },
  {
    pattern: /^\/api\/procurement\/opening-stock\/[^/]+\/submit$/,
    methods: { POST: { skipAcl: false, resourceCode: "SA_OPENING_STOCK_LIST", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/opening-stock\/[^/]+\/approve$/,
    methods: { POST: { skipAcl: false, resourceCode: "SA_OPENING_STOCK_LIST", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/procurement\/opening-stock\/[^/]+\/post$/,
    methods: { POST: { skipAcl: false, resourceCode: "SA_OPENING_STOCK_LIST", action: "APPROVE" } },
  },

  // ── L2 Masters (parametric) ────────────────────────────────────────────────
  {
    pattern: /^\/api\/procurement\/payment-terms\/[^/]+$/,
    methods: {
      GET: { skipAcl: false, resourceCode: "PROC_PAYMENT_TERMS_MASTER", action: "VIEW" },
      PUT: { skipAcl: false, resourceCode: "PROC_PAYMENT_TERMS_MASTER", action: "EDIT" },
      DELETE: { skipAcl: false, resourceCode: "PROC_PAYMENT_TERMS_MASTER", action: "DELETE" },
    },
  },
  {
    pattern: /^\/api\/procurement\/ports\/[^/]+$/,
    methods: {
      PUT: { skipAcl: false, resourceCode: "PROC_PORT_MASTER", action: "EDIT" },
      DELETE: { skipAcl: false, resourceCode: "PROC_PORT_MASTER", action: "DELETE" },
    },
  },
  {
    pattern: /^\/api\/procurement\/transporters\/[^/]+$/,
    methods: {
      PUT:    { skipAcl: false, resourceCode: "PROC_TRANSPORTER_MASTER", action: "EDIT" },
      DELETE: { skipAcl: false, resourceCode: "PROC_TRANSPORTER_MASTER", action: "DELETE" },
    },
  },
  {
    pattern: /^\/api\/procurement\/port-transit\/[^/]+$/,
    methods: { DELETE: { skipAcl: false, resourceCode: "PROC_PORT_TRANSIT_MASTER", action: "DELETE" } },
  },
  {
    pattern: /^\/api\/procurement\/lead-times\/import\/[^/]+$/,
    methods: {
      DELETE: { skipAcl: false, resourceCode: "PROC_IMPORT_LEAD_TIME_MASTER", action: "DELETE" },
      PATCH:  { skipAcl: false, resourceCode: "PROC_IMPORT_LEAD_TIME_MASTER", action: "EDIT"   },
    },
  },
  {
    pattern: /^\/api\/procurement\/lead-times\/domestic\/[^/]+$/,
    methods: {
      DELETE: { skipAcl: false, resourceCode: "PROC_DOMESTIC_LEAD_TIME_MASTER", action: "DELETE" },
      PATCH:  { skipAcl: false, resourceCode: "PROC_DOMESTIC_LEAD_TIME_MASTER", action: "EDIT"   },
    },
  },
  {
    pattern: /^\/api\/procurement\/chas\/[^/]+$/,
    methods: {
      PATCH:  { skipAcl: false, resourceCode: "PROC_CHA_MASTER", action: "EDIT"   },
      DELETE: { skipAcl: false, resourceCode: "PROC_CHA_MASTER", action: "DELETE" },
    },
  },
  {
    pattern: /^\/api\/procurement\/chas\/[^/]+\/ports$/,
    methods: {
      GET:  { skipAcl: false, resourceCode: "PROC_CHA_MASTER", action: "VIEW" },
      POST: { skipAcl: false, resourceCode: "PROC_CHA_MASTER", action: "EDIT" },
    },
  },
  {
    pattern: /^\/api\/procurement\/chas\/[^/]+\/ports\/[^/]+$/,
    methods: { DELETE: { skipAcl: false, resourceCode: "PROC_CHA_MASTER", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/number-series\/global\/[^/]+$/,
    methods: { PATCH: { skipAcl: true } },
  },
  {
    pattern: /^\/api\/procurement\/number-series\/company\/[^/]+$/,
    methods: {
      PATCH:  { skipAcl: true },
      DELETE: { skipAcl: true },
    },
  },
  {
    pattern: /^\/api\/procurement\/number-series\/company\/[^/]+\/[^/]+\/counters$/,
    methods: {
      GET:  { skipAcl: true },
      POST: { skipAcl: true },
    },
  },
  {
    pattern: /^\/api\/procurement\/number-series\/counters\/[^/]+$/,
    methods: { DELETE: { skipAcl: true } },
  },

  // ── OM: Material (parametric) ──────────────────────────────────────────────
  {
    pattern: /^\/api\/om\/material$/,
    methods: { GET: { skipAcl: false, resourceCode: "OM_MATERIAL_LIST", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/om\/material\/uom-conversion[s]?$/,
    methods: {
      GET:  { skipAcl: false, resourceCode: "OM_MATERIAL_LIST",   action: "VIEW"  },
      POST: { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },
    },
  },
  {
    pattern: /^\/api\/om\/material\/status$/,
    methods: { POST: { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/om\/material\/extend-company$/,
    methods: { POST: { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/om\/material\/extend-plant$/,
    methods: { POST: { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" } },
  },

  // ── OM: Vendor (parametric) ────────────────────────────────────────────────
  {
    pattern: /^\/api\/om\/vendor$/,
    methods: { GET: { skipAcl: false, resourceCode: "OM_VENDOR_LIST", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/om\/vendor\/status$/,
    methods: { POST: { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/om\/vendor\/company-map$/,
    methods: { POST: { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/om\/vendor-material-info$/,
    methods: { GET: { skipAcl: false, resourceCode: "OM_VENDOR_LIST", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/om\/vendor-material-info\/status$/,
    methods: { POST: { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "EDIT" } },
  },

  // ── OM: Customer (parametric) ──────────────────────────────────────────────
  {
    pattern: /^\/api\/om\/customer$/,
    methods: { GET: { skipAcl: false, resourceCode: "OM_CUSTOMER_LIST", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/om\/customer\/status$/,
    methods: { POST: { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/om\/customer\/company-map$/,
    methods: { POST: { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "WRITE" } },
  },
];

// ---------------------------------------------------------------------------
// Public lookup function
// ---------------------------------------------------------------------------

/**
 * Looks up ACL metadata for a given HTTP method + pathname.
 *
 * Returns:
 *   { found: true, meta }  — route is registered
 *   { found: false }       — route NOT in registry → caller must throw ROUTE_ACL_NOT_REGISTERED
 */
export function lookupRouteAcl(
  method: string,
  pathname: string,
): { found: true; meta: RouteAclMeta } | { found: false } {
  const routeKey = `${method}:${pathname}`;

  // 1. Exact match
  if (routeKey in EXACT_ROUTE_ACL) {
    return { found: true, meta: EXACT_ROUTE_ACL[routeKey] };
  }

  // 2. Pattern match
  for (const entry of PATTERN_ROUTE_ACL) {
    if (entry.pattern.test(pathname)) {
      const meta = entry.methods[method];
      if (meta) {
        return { found: true, meta };
      }
    }
  }

  return { found: false };
}
