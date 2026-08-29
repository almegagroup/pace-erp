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
  "GET:/api/procurement/csns/available-for-sto":      { skipAcl: false, resourceCode: "PROC_CSN_TRACKER", action: "VIEW" },
  "GET:/api/procurement/tracker":                     { skipAcl: false, resourceCode: "PROC_CSN_TRACKER", action: "VIEW" },
  "GET:/api/procurement/tracker/layouts":             { skipAcl: false, resourceCode: "PROC_CSN_TRACKER", action: "VIEW" },
  "POST:/api/procurement/tracker/layouts":            { skipAcl: false, resourceCode: "PROC_CSN_TRACKER", action: "WRITE" },
  "GET:/api/procurement/alerts/lc-count":             { skipAcl: false, resourceCode: "PROC_CSN_ALERTS",  action: "VIEW" },
  "GET:/api/procurement/alerts/lc":                   { skipAcl: false, resourceCode: "PROC_CSN_ALERTS",  action: "VIEW" },
  "GET:/api/procurement/alerts/vessel-booking-count": { skipAcl: false, resourceCode: "PROC_CSN_ALERTS",  action: "VIEW" },
  "GET:/api/procurement/alerts/vessel-booking":       { skipAcl: false, resourceCode: "PROC_CSN_ALERTS",  action: "VIEW" },
  "GET:/api/procurement/alerts/counts":               { skipAcl: false, resourceCode: "PROC_CSN_ALERTS",  action: "VIEW" },

  // ── Procurement: Purchase Orders ─────────────────────────────────────────
  "GET:/api/procurement/purchase-orders":             { skipAcl: false, resourceCode: "PROC_PO_LIST",   action: "VIEW"  },
  "POST:/api/procurement/purchase-orders":            { skipAcl: false, resourceCode: "PROC_PO_CREATE", action: "WRITE" },
  "GET:/api/procurement/po-order-groups":             { skipAcl: false, resourceCode: "PROC_PO_ORDER_APPROVALS", action: "VIEW" },
  "GET:/api/procurement/print-groups":                { skipAcl: false, resourceCode: "PROC_PO_STO_PRINT", action: "VIEW" },
  "POST:/api/procurement/print-groups/log":           { skipAcl: false, resourceCode: "PROC_PO_STO_PRINT", action: "WRITE" },
  "GET:/api/procurement/po-filter-options":           { skipAcl: false, resourceCode: "PROC_PO_LIST",   action: "VIEW"  },
  // Generic material_uom_conversion lookup (no PO reference, no company scope in the handler) --
  // was mis-gated under PROC_PO_LIST, which silently 403'd it for any non-PO page that also uses
  // it (Opening Stock, PID) whenever that user lacked PO List access. Found live in prod 2026-08-14
  // while verifying PID's companion-page dependencies -- OM_MATERIAL_LIST is what this data actually is.
  "GET:/api/procurement/materials/uom-conversion":    { skipAcl: false, resourceCode: "OM_MATERIAL_LIST", action: "VIEW"  },

  // ── Procurement: Gate Entry ───────────────────────────────────────────────
  "GET:/api/procurement/gate-entries":                { skipAcl: false, resourceCode: "PROC_GATE_ENTRY_LIST",   action: "VIEW"  },
  "POST:/api/procurement/gate-entries":               { skipAcl: false, resourceCode: "PROC_GATE_ENTRY_CREATE", action: "WRITE" },
  "GET:/api/procurement/gate-entries/open-csns":      { skipAcl: false, resourceCode: "PROC_GATE_ENTRY_CREATE", action: "VIEW"  },
  "GET:/api/procurement/gate-entries/open-pos":       { skipAcl: false, resourceCode: "PROC_GATE_ENTRY_CREATE", action: "VIEW"  },
  "GET:/api/procurement/gate-entries/open-stos":      { skipAcl: false, resourceCode: "PROC_GATE_ENTRY_CREATE", action: "VIEW"  },
  "GET:/api/procurement/gate-entries/by-number":      { skipAcl: false, resourceCode: "PROC_GATE_EXIT",         action: "VIEW"  },
  "POST:/api/procurement/gate-exits/inbound":         { skipAcl: false, resourceCode: "PROC_GATE_ENTRY_CREATE", action: "WRITE" },
  "GET:/api/procurement/gate-report":                 { skipAcl: false, resourceCode: "PROC_GATE_REPORT",       action: "VIEW"  },

  // ── Procurement: GRN ─────────────────────────────────────────────────────
  "GET:/api/procurement/grns":                              { skipAcl: false, resourceCode: "PROC_GRN_LIST", action: "VIEW"  },
  "POST:/api/procurement/grns":                             { skipAcl: false, resourceCode: "PROC_GRN_LIST", action: "WRITE" },
  "GET:/api/procurement/grns/ge-lines":                     { skipAcl: false, resourceCode: "PROC_GRN_LIST", action: "VIEW"  },
  "POST:/api/procurement/grns/from-line":                   { skipAcl: false, resourceCode: "PROC_GRN_LIST", action: "WRITE" },
  "GET:/api/procurement/grns/material-vendor-doc-names":    { skipAcl: false, resourceCode: "PROC_GRN_LIST", action: "VIEW"  },

  // ── Procurement: Inward QA ────────────────────────────────────────────────
  "GET:/api/procurement/qa-documents":                { skipAcl: false, resourceCode: "PROC_QA_QUEUE", action: "VIEW"  },
  "GET:/api/procurement/qa-test-methods":             { skipAcl: false, resourceCode: "PROC_QA_QUEUE", action: "VIEW"  },
  "POST:/api/procurement/qa-test-methods":            { skipAcl: false, resourceCode: "PROC_QA_QUEUE", action: "WRITE" },
  "GET:/api/procurement/qa-category-test-config":     { skipAcl: false, resourceCode: "PROC_QA_QUEUE", action: "VIEW"  },
  "POST:/api/procurement/qa-category-test-config":    { skipAcl: false, resourceCode: "PROC_QA_QUEUE", action: "WRITE" },

  // ── Procurement: Invoice Verification ────────────────────────────────────
  "GET:/api/procurement/invoice-verifications":         { skipAcl: false, resourceCode: "PROC_IV_LIST",   action: "VIEW"  },
  "POST:/api/procurement/invoice-verifications":        { skipAcl: false, resourceCode: "PROC_IV_CREATE", action: "WRITE" },
  "GET:/api/procurement/invoice-verifications/blocked": { skipAcl: false, resourceCode: "PROC_BLOCKED_IV_LIST", action: "VIEW" },

  // ── Procurement: Landed Cost ─────────────────────────────────────────────
  "GET:/api/procurement/landed-costs":                { skipAcl: false, resourceCode: "PROC_LC_LIST", action: "VIEW"  },
  "POST:/api/procurement/landed-costs":               { skipAcl: false, resourceCode: "PROC_LC_LIST", action: "WRITE" },

  // ── Procurement/Accounts: AC01 GRN Landed Cost Hub (redesigned Invoice
  // Verifications — row = one GRN). ⚠️ 2026-08-21 correction: originally
  // gated on a new resourceCode `ACC_GRN_LANDED_COST` that was never actually
  // provisioned in acl.menu_master/capability_menu_actions -- menu_code is
  // UNIQUE, so AC01's and AC03's separate tx_code rows can never literally
  // share one menu_code; that design was schema-impossible, not just
  // unfinished. Reusing the pre-existing, already-granted PROC_IV_LIST
  // resource instead -- AC01 and AC03 both hit these exact same routes.
  // AC01's own sidebar entry already uses PROC_IV_LIST as its menu_code
  // (unchanged), and AC03's sidebar entry keeps its own PROC_LC_LIST
  // menu_code independently for visibility -- only the shared *data* routes
  // below are gated by PROC_IV_LIST.
  // ⚠️ 2026-08-25 follow-up closed (found live via a real P0010/CMP006 403
  // ACL_DEFAULT_DENY_NO_MATCH on this exact route): the "known follow-up"
  // this comment used to flag -- a PROC_LC_LIST-only viewer (Auditor,
  // CAP_ACC_GRN_COST_AUDITOR; SCM, CAP_PROC_BUYER) could never actually reach
  // these routes, since neither capability ever held PROC_IV_LIST at all --
  // is fixed. Both capabilities now also carry a hidden (menu_visible=false)
  // PROC_IV_LIST:VIEW grant (VIEW only, never WRITE, so AC01 stays
  // uneditable for them, matching the locked "AC03 is read-only" design) in
  // both Dev and Prod. See OM-IMPLEMENTATION-LOG.md's 2026-08-25 entry for
  // the live-verification detail.
  "GET:/api/procurement/ac01/grns":                   { skipAcl: false, resourceCode: "PROC_IV_LIST", action: "VIEW"  },
  "GET:/api/procurement/ac01/deduction-types":        { skipAcl: false, resourceCode: "PROC_IV_LIST", action: "VIEW"  },
  "POST:/api/procurement/ac01/deduction-types":       { skipAcl: false, resourceCode: "PROC_IV_LIST", action: "WRITE" },

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
  "GET:/api/procurement/stos/last-payment-term":      { skipAcl: false, resourceCode: "PROC_STO_CREATE", action: "VIEW"  },
  "POST:/api/procurement/stos":                       { skipAcl: false, resourceCode: "PROC_STO_CREATE", action: "WRITE" },

  // ── Procurement: Sales ───────────────────────────────────────────────────
  "GET:/api/procurement/sales-orders":                { skipAcl: false, resourceCode: "PROC_SO_LIST",   action: "VIEW"  },
  "POST:/api/procurement/sales-orders":               { skipAcl: false, resourceCode: "PROC_SO_CREATE", action: "WRITE" },

  // ── SO01 unified RM/PM/INT/SFG/FG redesign (feasibility §133.7-§133.11) ──
  // SO01/SO02/SO03 are the SAME existing tx_codes/resources (PROC_SO_CREATE,
  // PROC_INV_LIST, PROC_DO_CREATE) being fully redesigned in place, not new
  // resources — confirmed 2026-08-28. CAP_PROC_ACCOUNTS now gates this (the
  // old blanket CAP_PROC_SALES grant was removed from PROC_SO_CREATE, per
  // the §133.11 Accounts-only lock — see the ACL restructuring note below).
  "POST:/api/procurement/sales-orders-v2":            { skipAcl: false, resourceCode: "PROC_SO_CREATE",  action: "WRITE" },
  // SO01's FG picker is a create-form prerequisite, so it shares the same
  // create authority rather than requiring a separate Production permission.
  "GET:/api/procurement/sales-orders/fg-sku-options": { skipAcl: false, resourceCode: "PROC_SO_CREATE",  action: "WRITE" },
  "GET:/api/procurement/sales-orders/address-options": { skipAcl: false, resourceCode: "PROC_SO_CREATE", action: "WRITE" },

  // ── SO Map (SO01 Tab 2, feasibility §133.9) — same PROC_SO_LIST resource,
  // EDIT action so Create-SO's WRITE grant (Accounts-only) stays separate
  // from Map's broader Stores/Accounts/Logistics access.
  "GET:/api/procurement/so-map/so-list":              { skipAcl: false, resourceCode: "PROC_SO_LIST", action: "VIEW" },
  "GET:/api/procurement/so-map/fo-options":           { skipAcl: false, resourceCode: "PROC_SO_LIST", action: "VIEW" },
  "GET:/api/procurement/so-map/address-options":      { skipAcl: false, resourceCode: "PROC_SO_LIST", action: "VIEW" },
  "POST:/api/procurement/so-map/map-fo":              { skipAcl: false, resourceCode: "PROC_SO_LIST", action: "EDIT" },
  "POST:/api/procurement/so-map/map-address":         { skipAcl: false, resourceCode: "PROC_SO_LIST", action: "EDIT" },
  "POST:/api/procurement/so-map/map-depot":           { skipAcl: false, resourceCode: "PROC_SO_LIST", action: "EDIT" },
  "POST:/api/procurement/so-map/save-group":          { skipAcl: false, resourceCode: "PROC_SO_LIST", action: "EDIT" },

  // ── Sales: Delivery Order (§113 Stage 2, TX SO03, GRP_ACL_SALES) ──────────
  "GET:/api/procurement/delivery-orders":                       { skipAcl: false, resourceCode: "PROC_DO_LIST",   action: "VIEW"  },
  "POST:/api/procurement/delivery-orders":                      { skipAcl: false, resourceCode: "PROC_DO_CREATE", action: "WRITE" },
  "GET:/api/procurement/delivery-orders/source-documents":      { skipAcl: false, resourceCode: "PROC_DO_CREATE", action: "VIEW"  },
  "GET:/api/procurement/delivery-orders/source-lines":          { skipAcl: false, resourceCode: "PROC_DO_CREATE", action: "VIEW"  },
  "GET:/api/procurement/delivery-orders/storage-locations":     { skipAcl: false, resourceCode: "PROC_DO_CREATE", action: "VIEW"  },
  "GET:/api/procurement/delivery-orders-v2/add-so-options":     { skipAcl: false, resourceCode: "PROC_DO_CREATE", action: "VIEW"  },
  "GET:/api/procurement/delivery-orders-v2/add-sto-options":    { skipAcl: false, resourceCode: "PROC_DO_CREATE", action: "VIEW"  },
  "GET:/api/procurement/delivery-orders-v2/storage-options":    { skipAcl: false, resourceCode: "PROC_DO_CREATE", action: "VIEW"  },
  "POST:/api/procurement/delivery-orders-v2":                   { skipAcl: false, resourceCode: "PROC_DO_CREATE", action: "WRITE" },
  "GET:/api/procurement/sales-invoices":              { skipAcl: false, resourceCode: "PROC_INV_LIST",  action: "VIEW"  },
  "POST:/api/procurement/sales-invoices":             { skipAcl: false, resourceCode: "PROC_INV_LIST",  action: "WRITE" },
  // §133.13 -- Additional Cost Category master, scoped to the Invoice/PGI
  // page's own drawer only (no separate master page/ACL resource).
  "GET:/api/procurement/additional-cost-categories":  { skipAcl: false, resourceCode: "PROC_INV_LIST",  action: "VIEW"  },
  "POST:/api/procurement/additional-cost-categories": { skipAcl: false, resourceCode: "PROC_INV_LIST",  action: "WRITE" },

  // ── Procurement: Physical Inventory ──────────────────────────────────────
  // Group 9 (2026-08-06): PID header create is the "scope of what's being counted"
  // stage, deliberately split from count-entry (WRITE below) so it can be gated
  // Auditor-only while count-entry stays open to everyone -- was bundled under one
  // WRITE action before this, which made the two-tier design unimplementable.
  "GET:/api/procurement/physical-inventory":          { skipAcl: false, resourceCode: "PROC_PI_LIST", action: "VIEW"  },
  "POST:/api/procurement/physical-inventory":         { skipAcl: false, resourceCode: "PROC_PI_LIST", action: "EDIT"  },
  "GET:/api/procurement/location-transfer-requests":  { skipAcl: false, resourceCode: "PROC_LOC_TRANSFER_REQ", action: "VIEW"  },
  "POST:/api/procurement/location-transfer-requests": { skipAcl: false, resourceCode: "PROC_LOC_TRANSFER_REQ", action: "WRITE" },
  "POST:/api/procurement/location-transfer-availability-preview": { skipAcl: false, resourceCode: "PROC_LOC_TRANSFER_REQ", action: "WRITE" },
  "GET:/api/procurement/location-transfer-workbench": { skipAcl: false, resourceCode: "PROC_LOC_TRANSFER_POST", action: "VIEW"  },
  "POST:/api/procurement/location-transfer-postings": { skipAcl: false, resourceCode: "PROC_LOC_TRANSFER_POST", action: "WRITE" },
  "GET:/api/procurement/stock-status-change/balance":  { skipAcl: false, resourceCode: "PROD_STOCK_STATUS_CHANGE", action: "VIEW"  },
  "POST:/api/procurement/stock-status-change/postings": { skipAcl: false, resourceCode: "PROD_STOCK_STATUS_CHANGE", action: "WRITE" },
  "GET:/api/procurement/stock-status-change/postings":  { skipAcl: false, resourceCode: "PROD_STOCK_STATUS_CHANGE", action: "VIEW"  },
  // §119.15 — MI20 IN07, own resourceCode (not PROC_PI_LIST) matching the IN02/IN03/PR21
  // pattern: a separate cross-document report gets its own resource, "everyone" per §119.5,
  // never shared with the document-lifecycle resource (bug pattern #6, §117.6's own note).
  "GET:/api/procurement/physical-inventory-differences": { skipAcl: false, resourceCode: "PROC_PI_DIFFERENCES", action: "VIEW" },
  // §119.12 — Create page (ITEM_WISE) material-location preview. Same EDIT tier as create
  // itself (Auditor-only) since this is part of the Create flow, not a general report.
  "GET:/api/procurement/physical-inventory-material-locations": { skipAcl: false, resourceCode: "PROC_PI_LIST", action: "EDIT" },
  // §MI04-MI05-sidebar-restore — PID-number lookup that MI04/MI05's own Page 1 calls before
  // loading. Same read tier as list/get (PROC_PI_LIST:VIEW) — the actual count/recount mutation
  // is separately gated on PROC_PI_COUNT_ENTRY/PROC_PI_RECOUNT:WRITE further down.
  "GET:/api/procurement/physical-inventory-resolve": { skipAcl: false, resourceCode: "PROC_PI_LIST", action: "VIEW" },
  // 2026-08-15 — IN08/IN09 must stay reachable even after IN01 is narrowed. Their standalone
  // Page-1 PID lookup therefore needs its own resource-scoped read endpoint instead of piggybacking
  // on PROC_PI_LIST:VIEW.
  "GET:/api/procurement/physical-inventory-resolve-count": { skipAcl: false, resourceCode: "PROC_PI_COUNT_ENTRY", action: "VIEW" },
  "GET:/api/procurement/physical-inventory-resolve-recount": { skipAcl: false, resourceCode: "PROC_PI_RECOUNT", action: "VIEW" },

  // ── Procurement: Opening Stock ────────────────────────────────────────────
  "GET:/api/procurement/opening-stock":               { skipAcl: false, resourceCode: "PROC_OPENING_STOCK_LIST", action: "VIEW"  },
  "POST:/api/procurement/opening-stock":              { skipAcl: false, resourceCode: "PROC_OPENING_STOCK_LIST", action: "WRITE" },
  "GET:/api/procurement/opening-stock/by-number":     { skipAcl: false, resourceCode: "PROC_OPENING_STOCK_APPROVAL", action: "VIEW"  },
  "POST:/api/procurement/opening-stock/recalculate-valuation": { skipAcl: false, resourceCode: "PROC_OPENING_STOCK_APPROVAL", action: "APPROVE" },

  // ── Procurement: Reports ──────────────────────────────────────────────────
  "GET:/api/procurement/planning":                    { skipAcl: false, resourceCode: "PROC_PLANNING_VIEW",  action: "VIEW" },
  "POST:/api/procurement/planning/lines/bulk-upsert": { skipAcl: false, resourceCode: "PROC_PLANNING_VIEW",  action: "EDIT" },
  "GET:/api/procurement/planning/sloc-groups":        { skipAcl: false, resourceCode: "PROC_PLANNING_VIEW",  action: "VIEW" },
  "POST:/api/procurement/planning/sloc-groups":       { skipAcl: false, resourceCode: "PROC_PLANNING_VIEW",  action: "EDIT" },
  "GET:/api/procurement/planning/item-groups":        { skipAcl: false, resourceCode: "PROC_PLANNING_VIEW",  action: "VIEW" },
  "POST:/api/procurement/planning/item-groups":       { skipAcl: false, resourceCode: "PROC_PLANNING_VIEW",  action: "EDIT" },
  "POST:/api/procurement/planning/close":             { skipAcl: false, resourceCode: "PROC_PLANNING_VIEW",  action: "EDIT" },
  "GET:/api/procurement/planning/history":            { skipAcl: false, resourceCode: "PROC_PLANNING_VIEW",  action: "VIEW" },
  // GET:/api/procurement/document-flow — deliberately NOT registered here.
  // Its resourceCode depends on the doc_type query param (13 document
  // types), so it resolves dynamically via Gate-2.5 in _pipeline/runner.ts
  // (same pattern as POST /api/workflow/decision's Gate-2) — see
  // dynamicAclRoutes in scripts/route-acl-registry-guard.mjs.
  "GET:/api/procurement/stock-ledger":                { skipAcl: false, resourceCode: "PROC_STOCK_LEDGER",   action: "VIEW" },
  "GET:/api/procurement/stock-ledger/movement-types": { skipAcl: false, resourceCode: "PROC_STOCK_LEDGER",   action: "VIEW" },
  "GET:/api/procurement/stock-ledger/batch-search":   { skipAcl: false, resourceCode: "PROC_STOCK_LEDGER",   action: "VIEW" },
  "GET:/api/procurement/stock-ledger/po-search":      { skipAcl: false, resourceCode: "PROC_STOCK_LEDGER",   action: "VIEW" },
  "GET:/api/procurement/report-layouts":              { skipAcl: false, resourceCode: "PROC_STOCK_LEDGER",   action: "VIEW" },
  // VIEW, not WRITE: this single route handles both personal (USER-scope,
  // anyone with VIEW may save their own layout) and Global-scope creation —
  // the report itself has no business-data WRITE concept, and the real
  // Global-vs-personal authority already lives inside createReportLayoutHandler
  // (canManageGlobalLayouts SA/GA check). Gating the route at WRITE would
  // block every ordinary VIEW-only user from saving even their own layout.
  "POST:/api/procurement/report-layouts":             { skipAcl: false, resourceCode: "PROC_STOCK_LEDGER",   action: "VIEW" },
  "GET:/api/procurement/current-stock/batch-search":  { skipAcl: false, resourceCode: "PROC_CURRENT_STOCK",  action: "VIEW" },
  "GET:/api/procurement/current-stock/po-search":     { skipAcl: false, resourceCode: "PROC_CURRENT_STOCK",  action: "VIEW" },
  "GET:/api/procurement/current-stock":               { skipAcl: false, resourceCode: "PROC_CURRENT_STOCK",  action: "VIEW" },
  "GET:/api/procurement/stock-history":               { skipAcl: false, resourceCode: "PROC_STOCK_HISTORY",  action: "VIEW" },
  "GET:/api/procurement/reservations":                { skipAcl: false, resourceCode: "PROC_RESERVATION_LIST", action: "VIEW" },
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

  // —— Production: Accounts rate masters ————————————————————————————————————————————
  "GET:/api/production/mts-sku-rates":               { skipAcl: false, resourceCode: "ACC_MTS_SKU_MONTHLY_RATE", action: "VIEW" },
  "POST:/api/production/mts-sku-rates/draft":        { skipAcl: false, resourceCode: "ACC_MTS_SKU_MONTHLY_RATE", action: "WRITE" },
  "GET:/api/production/mts-sku-rates/pending-drafts": { skipAcl: false, resourceCode: "ACC_MTS_SKU_MONTHLY_RATE", action: "VIEW" },
  "POST:/api/production/mts-sku-rates/approve":      { skipAcl: false, resourceCode: "ACC_MTS_SKU_MONTHLY_RATE", action: "APPROVE" },
  "GET:/api/production/mts-sku-rates/available-months": { skipAcl: false, resourceCode: "ACC_MTS_SKU_MONTHLY_RATE", action: "VIEW" },
  "GET:/api/production/ac06/workspace":              { skipAcl: false, resourceCode: "ACC_SLOC_COSTING_GROUP", action: "VIEW" },
  "POST:/api/production/ac06/sloc-groups":           { skipAcl: false, resourceCode: "ACC_SLOC_COSTING_SETUP", action: "WRITE" },
  "POST:/api/production/ac06/costing-groups":        { skipAcl: false, resourceCode: "ACC_SLOC_COSTING_SETUP", action: "WRITE" },
  "POST:/api/production/ac06/costing-groups/assign": { skipAcl: false, resourceCode: "ACC_SLOC_COSTING_SETUP", action: "WRITE" },
  "POST:/api/production/ac06/costing-groups/unassign": { skipAcl: false, resourceCode: "ACC_SLOC_COSTING_SETUP", action: "WRITE" },
  "POST:/api/production/ac06/material-inclusion":    { skipAcl: false, resourceCode: "ACC_SLOC_COSTING_SETUP", action: "WRITE" },
  "POST:/api/production/ac06/rates":                 { skipAcl: false, resourceCode: "ACC_SLOC_COSTING_RATE", action: "WRITE" },
  "POST:/api/production/ac06/verify":                { skipAcl: false, resourceCode: "ACC_SLOC_COSTING_VERIFY", action: "WRITE" },
  "POST:/api/production/ac06/close":                 { skipAcl: false, resourceCode: "ACC_SLOC_COSTING_CLOSE", action: "WRITE" },
  "GET:/api/production/ac06/report":                 { skipAcl: false, resourceCode: "ACC_SLOC_COSTING_GROUP", action: "VIEW" },
  "GET:/api/production/ac06/history":                { skipAcl: false, resourceCode: "ACC_SLOC_COSTING_GROUP", action: "VIEW" },
  "GET:/api/production/ac06/approved-months":        { skipAcl: false, resourceCode: "ACC_SLOC_COSTING_GROUP", action: "VIEW" },
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
  "PATCH:/api/om/material/uom-conversion":            { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },
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
  "GET:/api/om/vendor-material-info/mapped-materials": { skipAcl: false, resourceCode: "OM_VENDOR_LIST",   action: "VIEW"  },
  "POST:/api/om/vendor-material-info":                { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "WRITE" },
  "PATCH:/api/om/vendor-material-info":               { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "EDIT"  },
  "POST:/api/om/vendor-material-info/status":         { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "EDIT"  },
  "DELETE:/api/om/vendor-material-info":              { skipAcl: false, resourceCode: "OM_VENDOR_CREATE", action: "WRITE" },

  // ── OM: Customer ─────────────────────────────────────────────────────────
  "GET:/api/om/customers":                            { skipAcl: false, resourceCode: "OM_CUSTOMER_LIST",   action: "VIEW"  },
  "GET:/api/om/customer":                             { skipAcl: false, resourceCode: "OM_CUSTOMER_LIST",   action: "VIEW"  },
  "POST:/api/om/customer":                            { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "WRITE" },
  "PATCH:/api/om/customer":                           { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "EDIT"  },
  "POST:/api/om/customer/status":                     { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "EDIT"  },
  "POST:/api/om/customer/company-map":                { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "WRITE" },
  "GET:/api/om/customer/company-maps":                { skipAcl: false, resourceCode: "OM_CUSTOMER_LIST",   action: "VIEW"  },
  "GET:/api/om/customer/gst-profile":                 { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "VIEW"  },

  // ── OM: Parent Customer (groups RM/PM Sales Customer rows) ──────────────
  "GET:/api/om/parent-customers":                     { skipAcl: false, resourceCode: "OM_CUSTOMER_LIST",   action: "VIEW"  },
  "POST:/api/om/parent-customer":                     { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "WRITE" },
  "PATCH:/api/om/parent-customer":                    { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "EDIT"  },
  // §129.2/§129.3 — fg_parent_company/fg_depot_code are reused as MM04's own
  // VDC/Parent-Company layer (feasibility doc Section 129). Repointed from
  // OM_FG_DISPATCH_CUSTOMER (MM05's resource code, never granted to anyone --
  // 0 rows in these tables until this redesign) to MM04's own resource codes,
  // matching the parent-customer routes two lines above. Concrete Bug-
  // Pattern-#8 fix: without this, MM04-access users (Production/Stores/
  // Accounts, granted 2026-08-21) would silently 403 on VDC/Parent-Company
  // actions despite having full-looking MM04 access.
  "GET:/api/om/fg-parent-companies":                  { skipAcl: false, resourceCode: "OM_CUSTOMER_LIST",   action: "VIEW"  },
  "POST:/api/om/fg-parent-company":                   { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "WRITE" },
  "PATCH:/api/om/fg-parent-company":                  { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "EDIT"  },
  // §129 multi-company mapping (2026-08-22) -- cross-company GST lookup is
  // deliberately VIEW-tier only (finds an existing Parent Company to reuse,
  // never mutates); the actual map-write is a separate WRITE-tier route.
  "GET:/api/om/fg-parent-company/by-gst":              { skipAcl: false, resourceCode: "OM_CUSTOMER_LIST",   action: "VIEW"  },
  "GET:/api/om/fg-depot-codes":                       { skipAcl: false, resourceCode: "OM_CUSTOMER_LIST",   action: "VIEW"  },
  "POST:/api/om/fg-depot-code":                       { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "WRITE" },
  "PATCH:/api/om/fg-depot-code":                      { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "EDIT"  },
  // §132.5 point 6 (2026-08-27) -- MM05 fully retired, `fg_dispatch_customer`/
  // `fg_dispatch_customer_address` dropped, OM_FG_DISPATCH_CUSTOMER menu entry
  // removed. The dead dispatch-customer routes that used to live here are gone
  // too -- fg_parent_company/fg_depot_code (above) are the only pieces that
  // survived, unchanged.
  // §132.8 -- cross-company GST lookup for Customer, same VIEW-tier shape as
  // the Parent Company one above (finds an existing match to reuse, never
  // mutates -- the actual reuse-write is mapCustomerToCompanyHandler, already
  // registered below under company-map).
  "GET:/api/om/customer/by-gst":                      { skipAcl: false, resourceCode: "OM_CUSTOMER_LIST",   action: "VIEW"  },
  // §132.5 point 4 -- retroactive Vendor-link, same EDIT-tier as updateCustomerHandler.
  "POST:/api/om/customer/vendor-link":                { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "EDIT"  },

  // §129.3 — customer_address (Stage-1 address list + Stage-2 VDC mapping).
  "GET:/api/om/customer-addresses":                   { skipAcl: false, resourceCode: "OM_CUSTOMER_LIST",   action: "VIEW"  },
  "POST:/api/om/customer-address":                    { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "WRITE" },
  "PATCH:/api/om/customer-address":                   { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "EDIT"  },
  "PATCH:/api/om/customer-addresses/bulk-map":        { skipAcl: false, resourceCode: "OM_CUSTOMER_CREATE", action: "EDIT"  },

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

  // ── Production ───────────────────────────────────────────────────────────
  "GET:/api/production/pack-codes":                  { skipAcl: false, resourceCode: "PROD_PO_CREATE", action: "VIEW" },
  "POST:/api/production/pack-codes":                 { skipAcl: false, resourceCode: "SA_OM_PACK_CODE_MASTER", action: "WRITE" },
  "POST:/api/production/pack-codes/toggle":          { skipAcl: false, resourceCode: "SA_OM_PACK_CODE_MASTER", action: "EDIT" },
  "GET:/api/production/prodshades":                  { skipAcl: false, resourceCode: "PROD_PO_CREATE", action: "VIEW" },
  "GET:/api/production/pack-configs":                { skipAcl: false, resourceCode: "SA_OM_PACK_CODE_MASTER", action: "VIEW" },
  "POST:/api/production/pack-configs":               { skipAcl: false, resourceCode: "SA_OM_PACK_CODE_MASTER", action: "WRITE" },
  "GET:/api/production/batch-series":                { skipAcl: false, resourceCode: "SA_PROD_BATCH_SERIES", action: "VIEW" },
  "POST:/api/production/batch-series":               { skipAcl: false, resourceCode: "SA_PROD_BATCH_SERIES", action: "WRITE" },
  "GET:/api/production/batch-numbers":               { skipAcl: false, resourceCode: "PROD_BATCH_RELEASE", action: "VIEW" },
  "GET:/api/production/segment-locations":           { skipAcl: false, resourceCode: "SA_PROD_SEGMENT_LOCATIONS", action: "VIEW" },
  "POST:/api/production/segment-locations":          { skipAcl: false, resourceCode: "SA_PROD_SEGMENT_LOCATIONS", action: "WRITE" },
  "GET:/api/production/conversion-rates":            { skipAcl: false, resourceCode: "ACC_CONVERSION_COST", action: "VIEW" },
  "POST:/api/production/conversion-rates":           { skipAcl: false, resourceCode: "ACC_CONVERSION_COST", action: "WRITE" },
  // §104.8 stroke-derived opening-rate suggestion — consumed by IN05 Opening Stock, so it rides
  // that page's own resource rather than the Accounts one.
  "GET:/api/production/derived-opening-rate":        { skipAcl: false, resourceCode: "PROC_OPENING_STOCK_LIST", action: "VIEW" },
  "GET:/api/production/stroke-masters":              { skipAcl: false, resourceCode: "PROD_STROKE_MASTER", action: "VIEW" },
  "POST:/api/production/stroke-masters":             { skipAcl: false, resourceCode: "PROD_STROKE_MASTER", action: "WRITE" },
  "GET:/api/production/plan-feed":                   { skipAcl: false, resourceCode: "PROD_PLAN_FEED", action: "VIEW" },
  "POST:/api/production/plan-feed":                  { skipAcl: false, resourceCode: "PROD_PLAN_FEED", action: "WRITE" },
  "GET:/api/production/plan-feed/summary":           { skipAcl: false, resourceCode: "PROD_PLAN_FEED", action: "VIEW" },
  "GET:/api/production/plan-feed/unmapped-stock":    { skipAcl: false, resourceCode: "PROD_PLAN_FEED", action: "VIEW" },
  "GET:/api/production/plan-feed/check-stroke":      { skipAcl: false, resourceCode: "PROD_PLAN_FEED", action: "VIEW" },
  "GET:/api/production/plan-feed/stroke-options":    { skipAcl: false, resourceCode: "PROD_PLAN_FEED", action: "VIEW" },
  "GET:/api/production/plan-feed/find":               { skipAcl: false, resourceCode: "PROD_PLAN_FEED", action: "VIEW" },
  "GET:/api/production/plan-feed/mtest-skus":         { skipAcl: false, resourceCode: "PROD_PLAN_FEED", action: "VIEW" },
  // Same handler as above, reused for the Packing PO Create FG-SKU dropdown — gated on
  // PROD_PO_CREATE (the resource that already gates pack-codes/prodshades lookups at
  // Create time), not PROD_PLAN_FEED, since a Production user creating a Packing PO may
  // not hold Plan Feed access at all.
  "GET:/api/production/mtest-skus":                   { skipAcl: false, resourceCode: "PROD_PO_CREATE", action: "VIEW" },
  "GET:/api/production/plan-feed/mtest-capability":   { skipAcl: false, resourceCode: "PROD_PLAN_FEED", action: "VIEW" },
  // PR24 §122 — deliberately its own resource, not PROD_ORDER_LIST (PR13 stays the plain list).
  "GET:/api/production/order-information-system":    { skipAcl: false, resourceCode: "PROD_ORDER_INFO_SYSTEM", action: "VIEW" },
  // PR14 §123 — Batch Variance Report, its own resource (report page, CAP_EVERYONE_REPORTS).
  "GET:/api/production/batch-variance-report":        { skipAcl: false, resourceCode: "PROD_BATCH_VARIANCE", action: "VIEW" },
  "GET:/api/production/process-orders":              { skipAcl: false, resourceCode: "PROD_ORDER_LIST", action: "VIEW" },
  "GET:/api/production/process-orders/availability-preview": { skipAcl: false, resourceCode: "PROD_ORDER_LIST", action: "VIEW" },
  // §131.2 (2026-08-26) — read-only self-capability check (two booleans, nothing else),
  // any authenticated user may ask about their own grants.
  "GET:/api/production/process-orders/create-capability": { skipAcl: true },
  "POST:/api/production/process-orders":             { skipAcl: false, resourceCode: "PROD_PO_CREATE", action: "WRITE" },
  // §131.2 (2026-08-26) — MTEST-only route, distinct resource code so QA can be granted
  // this WITHOUT touching PROD_PO_CREATE/PROD_START_BATCH/PROD_PO_FINAL (which stay
  // Production-only, unchanged, for MTO/HPS/MTS/INT). Same handler as the routes above/
  // below, just a different URL so this static per-route gate can tell them apart.
  "POST:/api/production/process-orders/mtest":       { skipAcl: false, resourceCode: "PROD_MTEST_PO_CREATE", action: "WRITE" },
    "GET:/api/production/packing-orders":              { skipAcl: false, resourceCode: "PROD_ORDER_LIST", action: "VIEW" },
    "GET:/api/production/packing-orders/availability-preview": { skipAcl: false, resourceCode: "PROD_ORDER_LIST", action: "VIEW" },
    "GET:/api/production/packing-orders/sfg-batches":  { skipAcl: false, resourceCode: "PROD_ORDER_LIST", action: "VIEW" },
    // §131.4 item #11 (2026-08-26) — same VIEW-level gate as sfg-batches above (read-only
    // stock lookup); QA already has PROD_ORDER_LIST:VIEW via CAP_EVERYONE_REPORTS.
    "GET:/api/production/packing-orders/mtest-sfg-options": { skipAcl: false, resourceCode: "PROD_ORDER_LIST", action: "VIEW" },
    "POST:/api/production/packing-orders":             { skipAcl: false, resourceCode: "PROD_PO_CREATE", action: "WRITE" },
    // §131.2 (2026-08-26) — PTEST-only route, distinct resource so QA can be granted
    // this without touching PROD_PO_CREATE (stays Production-only for PMTO/PHPS/PMTS).
    "POST:/api/production/packing-orders/mtest":        { skipAcl: false, resourceCode: "PROD_MTEST_PACK_PO_CREATE", action: "WRITE" },
  "GET:/api/production/fg-stock-breakdown":           { skipAcl: false, resourceCode: "PROD_FG_STOCK_BREAKDOWN", action: "VIEW" },
  // Split off PROD_QA_QUEUE 2026-07-29 — PR18 (SFG Result Recording) shared
  // this resource with PR16 (QA Approval Queue), but the two need different
  // rank ceilings (PR18 up to L2_MANAGER, PR16 up to L3_MANAGER); sharing a
  // resource meant they could never be set independently, same class of
  // conflict as the Start Batch/PR17 split done earlier this session.
  "GET:/api/production/sfg-qa-documents":            { skipAcl: false, resourceCode: "PROD_SFG_RESULT_RECORDING", action: "VIEW" },
  "GET:/api/production/stroke-change-requests":      { skipAcl: false, resourceCode: "PROD_CHANGE_BOM_ITEM_APPROVAL", action: "VIEW" },
  "POST:/api/production/stroke-change-requests":     { skipAcl: false, resourceCode: "PROD_CHANGE_BOM_ITEM", action: "WRITE" },
  "GET:/api/production/pack-boms/eligible-skus":     { skipAcl: false, resourceCode: "PROD_PACK_BOM_CREATE", action: "VIEW" },
  "GET:/api/production/pack-boms":                   { skipAcl: false, resourceCode: "PROD_PACK_BOM_CREATE", action: "VIEW" },
  "POST:/api/production/pack-boms":                  { skipAcl: false, resourceCode: "PROD_PACK_BOM_CREATE", action: "WRITE" },
  "GET:/api/production/pack-bom-change-requests":    { skipAcl: false, resourceCode: "PROD_CHANGE_PACK_BOM_APPROVAL", action: "VIEW" },
  "GET:/api/production/partial-reversals/prodshades":     { skipAcl: false, resourceCode: "PROD_PARTIAL_BATCH_REVERSAL", action: "VIEW" },
  "GET:/api/production/partial-reversals/resolve-batch":  { skipAcl: false, resourceCode: "PROD_PARTIAL_BATCH_REVERSAL", action: "VIEW" },
  "GET:/api/production/partial-reversals/stock-lines":    { skipAcl: false, resourceCode: "PROD_PARTIAL_BATCH_REVERSAL", action: "VIEW" },
  "GET:/api/production/partial-reversals/salvage-batches": { skipAcl: false, resourceCode: "PROD_PARTIAL_BATCH_REVERSAL", action: "VIEW" },
  "GET:/api/production/partial-reversals/detail":         { skipAcl: false, resourceCode: "PROD_PARTIAL_BATCH_REVERSAL", action: "VIEW" },
  "POST:/api/production/partial-reversals":               { skipAcl: false, resourceCode: "PROD_PARTIAL_BATCH_REVERSAL", action: "WRITE" },
  "GET:/api/production/partial-reversals":                { skipAcl: false, resourceCode: "PROD_PARTIAL_REVERSAL_REPORT", action: "VIEW" },
  // §104.9 Opening Genealogy — Production ACL (PR22/PR23)
  "POST:/api/production/old-process-po":                  { skipAcl: false, resourceCode: "PROD_OLD_PROCESS_PO", action: "WRITE" },
  "GET:/api/production/old-process-po/batches":           { skipAcl: false, resourceCode: "PROD_OLD_PACKING_PO", action: "VIEW" },
  "POST:/api/production/old-packing-po":                  { skipAcl: false, resourceCode: "PROD_OLD_PACKING_PO", action: "WRITE" },
  "GET:/api/production/old-packing-po/batches":           { skipAcl: false, resourceCode: "PROD_OLD_PACKING_PO", action: "VIEW" },

  // ── Admin: ACL governance routes (acl.routes.ts) — verified 2026-08-06 that
  // every one of these 13 handlers gates on ctx.context.isAdmin internally
  // (grep confirmed for all _core/admin/acl/*.ts files touched here), same
  // pattern as every other skipAcl:true admin route below. Route-registry
  // guard (11-bug #8) found these were dispatched but never registered —
  // they were 500ing (ROUTE_ACL_NOT_REGISTERED) for everyone, including SA.
  "POST:/api/admin/acl/company-module/enable":             { skipAcl: true },
  "POST:/api/admin/acl/company-module/disable":            { skipAcl: true },
  "GET:/api/admin/acl/company-modules":                    { skipAcl: true },
  "GET:/api/admin/acl/role-permissions":                   { skipAcl: true },
  "POST:/api/admin/acl/role-permissions":                  { skipAcl: true },
  "POST:/api/admin/acl/role-permissions/disable":          { skipAcl: true },
  "GET:/api/admin/acl/role-capabilities":                  { skipAcl: true },
  "POST:/api/admin/acl/role-capabilities/assign":          { skipAcl: true },
  "POST:/api/admin/acl/role-capabilities/unassign":        { skipAcl: true },
  "GET:/api/admin/acl/user-overrides":                     { skipAcl: true },
  "POST:/api/admin/acl/user-overrides":                    { skipAcl: true },
  "POST:/api/admin/acl/user-overrides/revoke":              { skipAcl: true },
  "POST:/api/admin/acl/versions/rollback":                 { skipAcl: true },

  // ── Admin: Menu Admin Panel (menu.handler.ts) — Task #54 step 2, 2026-08-06.
  // Step 1 (same commit as step 2's own follow-up) added a real isAdmin
  // check (assertMenuAdmin) to every one of these 7 handlers, verified via
  // deno check. Before this, they were dispatched but unregistered — the
  // registry gap was accidentally the only thing stopping an unauthorized
  // caller, since the handlers themselves had zero auth. Now registered
  // AND authorized — do not repeat the "unregistered = safe" mistake for a
  // handler that still needs its own check written first.
  "GET:/api/admin/menu":                                   { skipAcl: true },
  "POST:/api/admin/menu":                                  { skipAcl: true },
  "PATCH:/api/admin/menu":                                 { skipAcl: true },
  "DELETE:/api/admin/menu":                                { skipAcl: true },
  "PATCH:/api/admin/menu/tree":                            { skipAcl: true },
  "PATCH:/api/admin/menu/state":                           { skipAcl: true },
  "POST:/api/admin/preview-user":                          { skipAcl: true },

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

  // ── AC06 monthly costing workspace ──────────────────────────────────────
  {
    pattern: /^\/api\/production\/ac06\/sloc-groups\/[^/]+$/,
    methods: { PATCH: { skipAcl: false, resourceCode: "ACC_SLOC_COSTING_SETUP", action: "WRITE" }, DELETE: { skipAcl: false, resourceCode: "ACC_SLOC_COSTING_SETUP", action: "DELETE" } },
  },
  {
    pattern: /^\/api\/production\/ac06\/costing-groups\/[^/]+$/,
    methods: { PATCH: { skipAcl: false, resourceCode: "ACC_SLOC_COSTING_SETUP", action: "WRITE" }, DELETE: { skipAcl: false, resourceCode: "ACC_SLOC_COSTING_SETUP", action: "DELETE" } },
  },

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
    pattern: /^\/api\/procurement\/planning\/sloc-groups\/[^/]+$/,
    methods: {
      PUT: { skipAcl: false, resourceCode: "PROC_PLANNING_VIEW", action: "EDIT" },
      DELETE: { skipAcl: false, resourceCode: "PROC_PLANNING_VIEW", action: "EDIT" },
    },
  },
  {
    pattern: /^\/api\/procurement\/planning\/item-groups\/[^/]+$/,
    methods: {
      PUT: { skipAcl: false, resourceCode: "PROC_PLANNING_VIEW", action: "EDIT" },
      DELETE: { skipAcl: false, resourceCode: "PROC_PLANNING_VIEW", action: "EDIT" },
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
    methods: { PUT: { skipAcl: false, resourceCode: "PROC_PO_CREATE", action: "EDIT" } },
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
    pattern: /^\/api\/procurement\/csns\/[^/]+\/history$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROC_CSN_TRACKER", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/procurement\/csns\/[^/]+\/transform-to-sto$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_STO_CREATE", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/csns\/[^/]+\/dispatch-qty\/preview$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_CSN_TRACKER", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/csns\/[^/]+\/dispatch-qty\/confirm$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_CSN_TRACKER", action: "EDIT" } },
  },
  {
    // VIEW here too, same reasoning as the create route above — ownership
    // (personal) vs SA/GA (Global) is enforced inside updateReportLayoutHandler
    // / deleteReportLayoutHandler, not at this coarse route gate.
    pattern: /^\/api\/procurement\/report-layouts\/[^/]+$/,
    methods: {
      PATCH: { skipAcl: false, resourceCode: "PROC_STOCK_LEDGER", action: "VIEW" },
      DELETE: { skipAcl: false, resourceCode: "PROC_STOCK_LEDGER", action: "VIEW" },
    },
  },
  {
    pattern: /^\/api\/procurement\/report-layouts\/[^/]+\/set-default$/,
    methods: {
      POST: { skipAcl: false, resourceCode: "PROC_STOCK_LEDGER", action: "VIEW" },
    },
  },
  {
    pattern: /^\/api\/procurement\/planning\/sloc-groups\/[^/]+$/,
    methods: {
      PUT: { skipAcl: false, resourceCode: "PROC_PLANNING_VIEW", action: "EDIT" },
      DELETE: { skipAcl: false, resourceCode: "PROC_PLANNING_VIEW", action: "EDIT" },
    },
  },
  {
    pattern: /^\/api\/procurement\/planning\/item-groups\/[^/]+$/,
    methods: {
      PUT: { skipAcl: false, resourceCode: "PROC_PLANNING_VIEW", action: "EDIT" },
      DELETE: { skipAcl: false, resourceCode: "PROC_PLANNING_VIEW", action: "EDIT" },
    },
  },
  {
    pattern: /^\/api\/procurement\/tracker\/[^/]+\/inline$/,
    methods: { PUT: { skipAcl: false, resourceCode: "PROC_CSN_TRACKER", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/tracker\/layouts\/[^/]+$/,
    methods: { DELETE: { skipAcl: false, resourceCode: "PROC_CSN_TRACKER", action: "DELETE" } },
  },

  // ── Gate Entry ───────────────────────────────────────────────────────────
  {
    pattern: /^\/api\/procurement\/gate-entries\/[^/]+\/prune$/,
    methods: {
      POST: { skipAcl: false, resourceCode: "PROC_GRN_LIST", action: "WRITE" },
    },
  },
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
    // NOTE: actual handler route is /decision (see procurement.routes.ts) — this was
    // previously registered as /usage-decision, a path that has never existed, which
    // silently blocked every QA usage-decision submission with ROUTE_ACL_NOT_REGISTERED.
    pattern: /^\/api\/procurement\/qa-documents\/[^/]+\/decision$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_QA_QUEUE", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/procurement\/qa-category-test-config\/[^/]+$/,
    methods: {
      PATCH:  { skipAcl: false, resourceCode: "PROC_QA_QUEUE", action: "EDIT"   },
      DELETE: { skipAcl: false, resourceCode: "PROC_QA_QUEUE", action: "DELETE" },
    },
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
    // Route-registry guard (11-bug #8), verified 2026-08-06: the real
    // dispatcher route is `/run-match` (see runMatchHandler in
    // procurement.routes.ts) — this `/match` entry has no matching dispatch
    // at all (rename drift). Kept for now (guard's stale-entry report will
    // flag it as unused); `/run-match` below is the one real callers hit.
    pattern: /^\/api\/procurement\/invoice-verifications\/[^/]+\/match$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_IV_CREATE", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/invoice-verifications\/[^/]+\/run-match$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_IV_CREATE", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/invoice-verifications\/[^/]+\/post$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_IV_CREATE", action: "APPROVE" } },
  },

  // ── AC01 GRN Landed Cost Hub (AC03 shares the same VIEW action, no
  // separate resourceCode — see the exact-match block above for why) ────────
  {
    pattern: /^\/api\/procurement\/ac01\/grns\/[^/]+\/save$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_IV_LIST", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/ac01\/grns\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROC_IV_LIST", action: "VIEW" } },
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
    // Route-registry guard (11-bug #8), verified 2026-08-06: the real
    // dispatcher route is `/by-grn/` (see procurement.routes.ts line ~843) —
    // `/grn/` below has no matching dispatch at all (rename drift). Kept for
    // now (guard's stale-entry report will flag it as unused).
    pattern: /^\/api\/procurement\/landed-costs\/by-grn\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROC_LC_LIST", action: "VIEW" } },
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
    // Route-registry guard (11-bug #8): confirmed live, dispatched but never
    // registered (found 2026-08-06) — updateGateExitOutboundWeightHandler.
    pattern: /^\/api\/procurement\/gate-exits\/outbound\/[^/]+\/weight$/,
    methods: { PUT: { skipAcl: false, resourceCode: "PROC_GATE_EXIT", action: "EDIT" } },
  },
  {
    // Route-registry guard (11-bug #8), verified 2026-08-06 against
    // supabase/functions/api/_routes/procurement.routes.ts: the real
    // dispatcher uses PUT for this path (`linkReplacementGRNHandler`), not
    // POST — this entry never actually matched any real request until the
    // PUT method line below was added. POST kept in case something else
    // still relies on it; if the guard's stale-entry report ever shows POST
    // unused here, remove it then.
    pattern: /^\/api\/procurement\/exchange-refs\/[^/]+\/link-grn$/,
    methods: {
      POST: { skipAcl: false, resourceCode: "PROC_EXCHANGE_REF_LIST", action: "WRITE" },
      PUT:  { skipAcl: false, resourceCode: "PROC_EXCHANGE_REF_LIST", action: "WRITE" },
    },
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
    pattern: /^\/api\/procurement\/stos\/[^/]+\/confirm$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_STO_CREATE", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/stos\/[^/]+\/approve$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_STO_CREATE", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/procurement\/stos\/[^/]+\/reject$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_STO_CREATE", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/stos\/[^/]+\/amend$/,
    methods: { PUT: { skipAcl: false, resourceCode: "PROC_STO_CREATE", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/stos\/[^/]+\/approve-amendment$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_STO_CREATE", action: "APPROVE" } },
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
    pattern: /^\/api\/procurement\/stos\/[^/]+\/lines\/[^/]+\/knock-off$/,
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
    // §133.10 — Edit/Cancel/Close on the unified SO. Same PROC_SO_CREATE
    // resource as Create (Accounts-only), EDIT action per the existing
    // WRITE=create/EDIT=modify convention.
    pattern: /^\/api\/procurement\/sales-orders-v2\/[^/]+\/cancel$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_SO_CREATE", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/sales-orders-v2\/[^/]+\/close$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_SO_CREATE", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/sales-orders-v2\/[^/]+$/,
    methods: { PUT: { skipAcl: false, resourceCode: "PROC_SO_CREATE", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/so-map\/[^/]+\/status$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROC_SO_LIST", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/procurement\/so-map\/[^/]+\/unmap$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_SO_LIST", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/so-map\/groups\/[^/]+\/release$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_SO_LIST", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/delivery-orders\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROC_DO_LIST", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/procurement\/delivery-orders-v2\/[^/]+$/,
    methods: {
      GET: { skipAcl: false, resourceCode: "PROC_DO_LIST", action: "VIEW" },
      // §133.12 -- own EDIT action (not reusing Create's WRITE), same
      // separation-of-duties shape as the legacy DO cancel action below.
      PUT: { skipAcl: false, resourceCode: "PROC_DO_CREATE", action: "EDIT" },
    },
  },
  {
    // §133.13 -- IBN-driven multi-invoice preview/post, own resource
    // (PROC_INV_LIST, same as the legacy /sales-invoices/pgi route) since
    // this supersedes that flow for §133.12 multi-source DOs.
    pattern: /^\/api\/procurement\/delivery-orders-v2\/[^/]+\/invoice-groups$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROC_INV_LIST", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/procurement\/delivery-orders-v2\/[^/]+\/pgi-invoice-groups$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_INV_LIST", action: "WRITE" } },
  },
  {
    // §113.15 -- deliberately its own action (EDIT, same shape as PO/STO's
    // own cancel/knock-off) rather than reusing DO create's WRITE action, so
    // cancel authority can be granted to a different role than create
    // authority later without touching this handler.
    pattern: /^\/api\/procurement\/delivery-orders\/[^/]+\/cancel$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_DO_CREATE", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/sales-orders\/[^/]+\/cancel$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_SO_CREATE", action: "EDIT" } },
  },
  {
    // §113 bug fix — this pattern was "/issue-stock" but the real route
    // (procurement.routes.ts) is "/issue"; the mismatch meant this endpoint
    // 403'd for everyone except SA/GA regardless of ACL grants (checklist #8).
    pattern: /^\/api\/procurement\/sales-orders\/[^/]+\/issue$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_SO_CREATE", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/sales-orders\/[^/]+\/lines$/,
    methods: { PATCH: { skipAcl: false, resourceCode: "PROC_SO_CREATE", action: "EDIT" } },
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
  {
    // §113.15 -- combined PGI+Invoice create. Same resource as SO02
    // (PROC_INV_LIST) since this reuses that page, action WRITE matching
    // the legacy POST /sales-invoices route's own convention.
    pattern: /^\/api\/procurement\/sales-invoices\/pgi$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_INV_LIST", action: "WRITE" } },
  },
  {
    // Deliberately its own action (EDIT, same shape as DO cancel) rather
    // than reusing PGI-create's WRITE action, so reversal authority can be
    // granted to a different role than create authority later.
    pattern: /^\/api\/procurement\/sales-invoices\/[^/]+\/reverse$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_INV_LIST", action: "EDIT" } },
  },

  // ── Physical Inventory ────────────────────────────────────────────────────
  {
    pattern: /^\/api\/procurement\/location-transfer-requests\/[^/]+$/,
    methods: {
      GET: { skipAcl: false, resourceCode: "PROC_LOC_TRANSFER_REQ", action: "VIEW" },
      PUT: { skipAcl: false, resourceCode: "PROC_LOC_TRANSFER_REQ", action: "EDIT" },
      PATCH: { skipAcl: false, resourceCode: "PROC_LOC_TRANSFER_REQ", action: "EDIT" },
    },
  },
  {
    pattern: /^\/api\/procurement\/location-transfer-requests\/[^/]+\/cancel$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_LOC_TRANSFER_REQ", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/location-transfer-postings\/[^/]+\/reverse$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_LOC_TRANSFER_REVERSE", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/stock-status-change\/postings\/[^/]+\/approve$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_STOCK_STATUS_CHANGE", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/procurement\/stock-status-change\/postings\/[^/]+\/reverse$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_STOCK_STATUS_CHANGE", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/physical-inventory\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROC_PI_LIST", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/procurement\/physical-inventory\/[^/]+\/count-workspace$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROC_PI_COUNT_ENTRY", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/procurement\/physical-inventory\/[^/]+\/recount-workspace$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROC_PI_RECOUNT", action: "VIEW" } },
  },
  {
    // Group 9 (2026-08-06): adding an item defines what's being counted (PID
    // scope), same tier as header create above -- EDIT, not WRITE, so it stays
    // Auditor-only and doesn't accidentally open up to the count-entry tier.
    pattern: /^\/api\/procurement\/physical-inventory\/[^/]+\/items$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PI_LIST", action: "EDIT" } },
  },
  {
    // §119.11 MI02 — item remove, same Auditor-only tier as item add.
    pattern: /^\/api\/procurement\/physical-inventory\/[^/]+\/items\/[^/]+$/,
    methods: { DELETE: { skipAcl: false, resourceCode: "PROC_PI_LIST", action: "EDIT" } },
  },
  {
    // §MI04-MI05-split-2026-08-14 — MI04 (IN08), its own resource now, not a PROC_PI_LIST
    // companion action. Same WRITE-tier capability grants as before (business owner: no ACL
    // authority change), only the resource identity is now real.
    pattern: /^\/api\/procurement\/physical-inventory\/[^/]+\/items\/[^/]+\/count$/,
    methods: { PUT: { skipAcl: false, resourceCode: "PROC_PI_COUNT_ENTRY", action: "WRITE" } },
  },
  {
    // MI05 (IN09) — Change Count, distinct endpoint (changeCountHandler) from MI04's /count.
    pattern: /^\/api\/procurement\/physical-inventory\/[^/]+\/items\/[^/]+\/change-count$/,
    methods: { PUT: { skipAcl: false, resourceCode: "PROC_PI_RECOUNT", action: "WRITE" } },
  },
  {
    // Legacy "clear back to pending" action — no longer called by any frontend page since MI05
    // now allows direct value changes (§MI04-MI05-split-2026-08-14), left wired for API
    // compatibility. Stays on PROC_PI_LIST (was never MI04/MI05-specific).
    pattern: /^\/api\/procurement\/physical-inventory\/[^/]+\/items\/[^/]+\/recount$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PI_LIST", action: "WRITE" } },
  },
  {
    // §119.6 — Submit for Approval is still the count-entry actor's own action; the
    // Auditor/Director escalation only starts at Reopen/Post below. Found live
    // 2026-08-19: this comment was the design intent all along, but resourceCode
    // stayed PROC_PI_LIST (Auditor/Director/CAP_PROC_INVENTORY-only) instead of
    // PROC_PI_COUNT_ENTRY -- a count-entry-only role (CAP_PI_COUNT_ENTRY, e.g.
    // L1/L2_MANAGER per feasibility §119.18) could save MI04/MI05 counts but then
    // 403'd trying to Submit the very document they just finished counting.
    pattern: /^\/api\/procurement\/physical-inventory\/[^/]+\/submit$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PI_COUNT_ENTRY", action: "WRITE" } },
  },
  {
    // §119.5/§119.6 — base gate is APPROVE (Reopen authority = Post authority for that
    // document); resolvePidActionAuthority() in the handler layers the escalating
    // Auditor-vs-Director split on top of this.
    pattern: /^\/api\/procurement\/physical-inventory\/[^/]+\/reopen$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PI_LIST", action: "APPROVE" } },
  },
  {
    // §119.11 MI02 — document cancel, Auditor-only tier (same as create/item-add).
    pattern: /^\/api\/procurement\/physical-inventory\/[^/]+\/cancel$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PI_LIST", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/physical-inventory\/[^/]+\/post$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_PI_LIST", action: "APPROVE" } },
  },

  // ── Opening Stock ──────────────────────────────────────────────────────────
  {
    pattern: /^\/api\/procurement\/opening-stock\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROC_OPENING_STOCK_LIST", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/procurement\/opening-stock\/[^/]+\/lines$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_OPENING_STOCK_LIST", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/opening-stock\/[^/]+\/lines\/batch$/,
    methods: { PUT: { skipAcl: false, resourceCode: "PROC_OPENING_STOCK_APPROVAL", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/procurement\/opening-stock\/[^/]+\/lines\/[^/]+$/,
    methods: {
      PUT:    { skipAcl: false, resourceCode: "PROC_OPENING_STOCK_LIST", action: "EDIT"   },
      DELETE: { skipAcl: false, resourceCode: "PROC_OPENING_STOCK_LIST", action: "DELETE" },
    },
  },
  {
    pattern: /^\/api\/procurement\/opening-stock\/[^/]+\/submit$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_OPENING_STOCK_LIST", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/procurement\/opening-stock\/[^/]+\/approve$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_OPENING_STOCK_APPROVAL", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/procurement\/opening-stock\/[^/]+\/post$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROC_OPENING_STOCK_APPROVAL", action: "APPROVE" } },
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

  // ── Production (parametric) ────────────────────────────────────────────────
  {
    pattern: /^\/api\/production\/pack-codes\/[^/]+$/,
    methods: { PATCH: { skipAcl: false, resourceCode: "SA_OM_PACK_CODE_MASTER", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/production\/pack-configs\/[^/]+$/,
    methods: { DELETE: { skipAcl: false, resourceCode: "SA_OM_PACK_CODE_MASTER", action: "DELETE" } },
  },
  {
    pattern: /^\/api\/production\/batch-series\/[^/]+$/,
    methods: { PATCH: { skipAcl: false, resourceCode: "SA_PROD_BATCH_SERIES", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/production\/batch-numbers\/[^/]+\/release$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_BATCH_RELEASE", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/production\/stroke-masters\/[^/]+$/,
    methods: {
      GET:   { skipAcl: false, resourceCode: "PROD_STROKE_MASTER", action: "VIEW" },
      PATCH: { skipAcl: false, resourceCode: "PROD_STROKE_MASTER", action: "EDIT" },
    },
  },
  {
    pattern: /^\/api\/production\/stroke-masters\/[^/]+\/approve$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_STROKE_APPROVAL", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/production\/stroke-masters\/[^/]+\/revert$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_STROKE_APPROVAL", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/production\/stroke-masters\/[^/]+\/reject$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_STROKE_APPROVAL", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/production\/stroke-masters\/[^/]+\/deactivate$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_STROKE_MASTER", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/production\/stroke-masters\/[^/]+\/reactivate$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_STROKE_APPROVAL", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/production\/plan-feed\/[^/]+$/,
    methods: {
      GET:   { skipAcl: false, resourceCode: "PROD_PLAN_FEED", action: "VIEW" },
      PATCH: { skipAcl: false, resourceCode: "PROD_PLAN_FEED", action: "EDIT" },
    },
  },
  {
    pattern: /^\/api\/production\/plan-feed\/[^/]+\/edit-mtest$/,
    methods: { PATCH: { skipAcl: false, resourceCode: "PROD_MTEST_PLAN_FEED", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/production\/plan-feed\/[^/]+\/cancel$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_PLAN_FEED", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/production\/plan-feed\/[^/]+\/reactivate$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_PLAN_FEED", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/production\/plan-feed\/[^/]+\/allocations$/,
    methods: {
      GET:  { skipAcl: false, resourceCode: "PROD_PLAN_FEED", action: "VIEW" },
      POST: { skipAcl: false, resourceCode: "PROD_PLAN_FEED", action: "EDIT" },
    },
  },
  {
    pattern: /^\/api\/production\/plan-feed\/[^/]+\/allocations-mtest$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_MTEST_PLAN_FEED", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/production\/batch-variance-report\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROD_BATCH_VARIANCE", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/production\/process-orders\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROD_ORDER_LIST", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/production\/process-orders\/[^/]+\/lines$/,
    methods: { PATCH: { skipAcl: false, resourceCode: "PROD_PO_EDIT", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/production\/process-orders\/[^/]+\/edit$/,
    methods: { PATCH: { skipAcl: false, resourceCode: "PROD_PO_EDIT", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/production\/process-orders\/[^/]+\/qa-approve$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_QA_QUEUE", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/production\/process-orders\/[^/]+\/qa-reject$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_QA_QUEUE", action: "APPROVE" } },
  },
  {
    // Was PROD_BATCH_RELEASE (shared with PR17's "release a voided batch
    // number" — a QA/Manager-tier oversight function). Split onto its own
    // resource code (2026-07-29) — Start Batch is Production's own action,
    // clicked right after QA approves in PR16's flow; sharing PR17's
    // resource would have blocked Production from starting a batch once
    // PR17 was restricted to QA-Manager-tier + Plant Head only.
    pattern: /^\/api\/production\/process-orders\/[^/]+\/start-batch$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_START_BATCH", action: "WRITE" } },
  },
  {
    // §131.2 (2026-08-26) — MTEST-only route, same reasoning as the /mtest create
    // route above: a distinct resource code so QA can be granted this without
    // touching PROD_START_BATCH (stays Production-only for MTO/HPS/MTS).
    pattern: /^\/api\/production\/process-orders\/[^/]+\/start-batch-mtest$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_MTEST_START_BATCH", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/production\/process-orders\/[^/]+\/finalize$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_PO_FINAL", action: "WRITE" } },
  },
  {
    // §131.2 (2026-08-26) — MTEST-only route. This single resource covers both the
    // Final write and the Verify-equivalent posting §131.1 has it run afterward —
    // there is no separate PROD_MTEST_PO_VERIFY, since for MTEST that's the same
    // one QA action as Final.
    pattern: /^\/api\/production\/process-orders\/[^/]+\/finalize-mtest$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_MTEST_PO_FINAL", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/production\/process-orders\/[^/]+\/verify$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_PO_VERIFY", action: "APPROVE" } },
  },
  {
    // COR6-style post-Verify correction — gated on the same resource that got the PO to
    // VERIFIED in the first place, matching correctPackingOrderHandler's own /correct
    // route below (which reuses PROD_PO_FINAL, the resource that got it to FINAL).
    pattern: /^\/api\/production\/process-orders\/[^/]+\/correct$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_PO_VERIFY", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/production\/process-orders\/[^/]+\/reverse$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_REVERSAL", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/production\/process-orders\/[^/]+\/prune$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_PO_EDIT", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/production\/sfg-qa-documents\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROD_SFG_RESULT_RECORDING", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/production\/sfg-qa-documents\/[^/]+\/test-lines$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_SFG_RESULT_RECORDING", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/production\/sfg-qa-documents\/[^/]+\/test-lines\/[^/]+$/,
    methods: {
      PUT: { skipAcl: false, resourceCode: "PROD_SFG_RESULT_RECORDING", action: "EDIT" },
    },
  },
  {
    pattern: /^\/api\/production\/sfg-qa-documents\/[^/]+\/decision$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_SFG_RESULT_RECORDING", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/production\/packing-orders\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROD_ORDER_LIST", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/production\/packing-orders\/[^/]+\/lines$/,
    methods: { PATCH: { skipAcl: false, resourceCode: "PROD_PO_EDIT", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/production\/packing-orders\/[^/]+\/edit$/,
    methods: { PATCH: { skipAcl: false, resourceCode: "PROD_PO_EDIT", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/production\/packing-orders\/[^/]+\/cancel$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_PO_EDIT", action: "EDIT" } },
  },
  {
    pattern: /^\/api\/production\/packing-orders\/[^/]+\/finalize$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_PO_FINAL", action: "WRITE" } },
  },
  {
    // §131.2 (2026-08-26) — PTEST-only route, same reasoning as its create sibling.
    pattern: /^\/api\/production\/packing-orders\/[^/]+\/finalize-mtest$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_MTEST_PACK_PO_FINAL", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/production\/packing-orders\/[^/]+\/reverse$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_REVERSAL", action: "APPROVE" } },
  },
  {
    // Fixed 2026-08-12 — was "PROD_PACKING_PO_FINAL", a resource_code that has never
    // existed in acl.menu_master (confirmed via live dev query: zero rows, zero
    // capability_menu_actions grants). Live since 2026-07-13 (commit 003d48aed),
    // invisible in dev because every test user is admin/full-access. Reuses
    // PROD_PO_FINAL — the resource that already gates getting a Packing PO TO final in
    // the first place (see the /finalize route below) — same "reuse, don't mint a new
    // resource for one action" intent the original comment stated, just pointed at a
    // resource that actually exists.
    pattern: /^\/api\/production\/packing-orders\/[^/]+\/correct$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_PO_FINAL", action: "WRITE" } },
  },
  {
    pattern: /^\/api\/production\/partial-reversals\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROD_PARTIAL_REVERSAL_REPORT", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/production\/stroke-change-requests\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROD_CHANGE_BOM_ITEM_APPROVAL", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/production\/stroke-change-requests\/[^/]+\/approve$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_CHANGE_BOM_ITEM_APPROVAL", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/production\/stroke-change-requests\/[^/]+\/reject$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_CHANGE_BOM_ITEM_APPROVAL", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/production\/pack-boms\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROD_PACK_BOM_CREATE", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/production\/pack-boms\/[^/]+\/approve$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_PACK_BOM_APPROVAL", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/production\/pack-boms\/[^/]+\/reject$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_PACK_BOM_APPROVAL", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/production\/pack-boms\/[^/]+\/change-request$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_CHANGE_PACK_BOM", action: "WRITE" } },
  },
  {
    // Route-registry guard (11-bug #8): confirmed live, dispatched but never
    // registered (found 2026-08-06) — single-record GET, list/approve/reject
    // on this same resource already registered, this one was just missed.
    pattern: /^\/api\/production\/pack-bom-change-requests\/[^/]+$/,
    methods: { GET: { skipAcl: false, resourceCode: "PROD_CHANGE_PACK_BOM_APPROVAL", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/production\/pack-bom-change-requests\/[^/]+\/approve$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_CHANGE_PACK_BOM_APPROVAL", action: "APPROVE" } },
  },
  {
    pattern: /^\/api\/production\/pack-bom-change-requests\/[^/]+\/reject$/,
    methods: { POST: { skipAcl: false, resourceCode: "PROD_CHANGE_PACK_BOM_APPROVAL", action: "APPROVE" } },
  },

  // ── OM: Material (parametric) ──────────────────────────────────────────────
  {
    pattern: /^\/api\/om\/material$/,
    methods: { GET: { skipAcl: false, resourceCode: "OM_MATERIAL_LIST", action: "VIEW" } },
  },
  {
    pattern: /^\/api\/om\/material\/uom-conversion[s]?$/,
    methods: {
      GET:   { skipAcl: false, resourceCode: "OM_MATERIAL_LIST",   action: "VIEW"  },
      POST:  { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },
      PATCH: { skipAcl: false, resourceCode: "OM_MATERIAL_CREATE", action: "WRITE" },
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
