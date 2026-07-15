import { SCREEN_TYPE } from "../../../screenTypes.js";

export const OPERATION_SCREENS = Object.freeze({
  OM_MATERIAL_LIST: {
    screen_code: "OM_MATERIAL_LIST",
    route: "/dashboard/om/materials",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_MATERIAL_DETAIL: {
    screen_code: "OM_MATERIAL_DETAIL",
    route: "/dashboard/om/material/detail",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_VENDOR_LIST: {
    screen_code: "OM_VENDOR_LIST",
    route: "/dashboard/om/vendors",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_VENDOR_DETAIL: {
    screen_code: "OM_VENDOR_DETAIL",
    route: "/dashboard/om/vendor/detail",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_ASL_LIST: {
    screen_code: "OM_ASL_LIST",
    route: "/dashboard/om/vendor-material-infos",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_ASL_CREATE: {
    screen_code: "OM_ASL_CREATE",
    route: "/dashboard/om/vendor-material-info/create",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_ASL_DETAIL: {
    screen_code: "OM_ASL_DETAIL",
    route: "/dashboard/om/vendor-material-info/detail",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_CUSTOMER_LIST: {
    screen_code: "OM_CUSTOMER_LIST",
    route: "/dashboard/om/customers",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_CUSTOMER_CREATE: {
    screen_code: "OM_CUSTOMER_CREATE",
    route: "/dashboard/om/customer/create",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_CUSTOMER_DETAIL: {
    screen_code: "OM_CUSTOMER_DETAIL",
    route: "/dashboard/om/customer/detail",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_PO_LIST: {
    screen_code: "PROC_PO_LIST",
    route: "/dashboard/procurement/purchase-orders",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_PO_CREATE: {
    screen_code: "PROC_PO_CREATE",
    route: "/dashboard/procurement/purchase-orders/create",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_PO_CREATE_OPENING: {
    screen_code: "PROC_PO_CREATE_OPENING",
    route: "/dashboard/procurement/purchase-orders/create-opening",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_PO_DETAIL: {
    screen_code: "PROC_PO_DETAIL",
    route: "/dashboard/procurement/purchase-orders/:id",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_PO_ORDER_APPROVALS: {
    screen_code: "PROC_PO_ORDER_APPROVALS",
    route: "/dashboard/procurement/po-order-groups",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_PO_ORDER_DETAIL: {
    screen_code: "PROC_PO_ORDER_DETAIL",
    route: "/dashboard/procurement/po-order-groups/:id",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_CSN_DETAIL: {
    screen_code: "PROC_CSN_DETAIL",
    route: "/dashboard/procurement/csns/:id",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_CSN_TRACKER: {
    screen_code: "PROC_CSN_TRACKER",
    route: "/dashboard/procurement/csn-tracker",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_CSN_ALERTS: {
    screen_code: "PROC_CSN_ALERTS",
    route: "/dashboard/procurement/csn-alerts",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_GATE_ENTRY_LIST: {
    screen_code: "PROC_GATE_ENTRY_LIST",
    route: "/dashboard/procurement/gate-entries",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_GATE_ENTRY_CREATE: {
    screen_code: "PROC_GATE_ENTRY_CREATE",
    route: "/dashboard/procurement/gate-entries/create",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_GATE_ENTRY_DETAIL: {
    screen_code: "PROC_GATE_ENTRY_DETAIL",
    route: "/dashboard/procurement/gate-entries/:id",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_GATE_EXIT_INBOUND_DETAIL: {
    screen_code: "PROC_GATE_EXIT_INBOUND_DETAIL",
    route: "/dashboard/procurement/gate-exits/inbound/:id",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_GATE_EXIT: {
    screen_code: "PROC_GATE_EXIT",
    route: "/dashboard/procurement/gate-exit",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_GATE_REPORT: {
    screen_code: "PROC_GATE_REPORT",
    route: "/dashboard/procurement/gate-report",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_GRN_LIST: {
    screen_code: "PROC_GRN_LIST",
    route: "/dashboard/procurement/grns",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_GRN_DETAIL: {
    screen_code: "PROC_GRN_DETAIL",
    route: "/dashboard/procurement/grns/:id",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_GRN_POST_FLOW: {
    screen_code: "PROC_GRN_POST_FLOW",
    route: "/dashboard/procurement/grns/post",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_QA_QUEUE: {
    screen_code: "PROC_QA_QUEUE",
    route: "/dashboard/procurement/qa-queue",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_STO_LIST: {
    screen_code: "PROC_STO_LIST",
    route: "/dashboard/procurement/stos",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_STO_CREATE: {
    screen_code: "PROC_STO_CREATE",
    route: "/dashboard/procurement/stos/create",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_STO_CREATE_OPENING: {
    screen_code: "PROC_STO_CREATE_OPENING",
    route: "/dashboard/procurement/stos/create-opening",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_STO_DETAIL: {
    screen_code: "PROC_STO_DETAIL",
    route: "/dashboard/procurement/stos/:id",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_RTV_LIST: {
    screen_code: "PROC_RTV_LIST",
    route: "/dashboard/procurement/rtvs",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_RTV_CREATE: {
    screen_code: "PROC_RTV_CREATE",
    route: "/dashboard/procurement/rtvs/create",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_RTV_DETAIL: {
    screen_code: "PROC_RTV_DETAIL",
    route: "/dashboard/procurement/rtvs/:id",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_DEBIT_NOTE_LIST: {
    screen_code: "PROC_DEBIT_NOTE_LIST",
    route: "/dashboard/procurement/debit-notes",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_DEBIT_NOTE_DETAIL: {
    screen_code: "PROC_DEBIT_NOTE_DETAIL",
    route: "/dashboard/procurement/debit-notes/:id",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_EXCHANGE_REF_LIST: {
    screen_code: "PROC_EXCHANGE_REF_LIST",
    route: "/dashboard/procurement/exchange-refs",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_IV_LIST: {
    screen_code: "PROC_IV_LIST",
    route: "/dashboard/procurement/accounts/invoice-verifications",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_IV_CREATE: {
    screen_code: "PROC_IV_CREATE",
    route: "/dashboard/procurement/accounts/invoice-verifications/create",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_IV_DETAIL: {
    screen_code: "PROC_IV_DETAIL",
    route: "/dashboard/procurement/accounts/invoice-verifications/:id",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_BLOCKED_IV_LIST: {
    screen_code: "PROC_BLOCKED_IV_LIST",
    route: "/dashboard/procurement/accounts/blocked-ivs",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_PLANNING_VIEW: {
    screen_code: "PROC_PLANNING_VIEW",
    route: "/dashboard/procurement/planning",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_PLANT_TRANSFER_LIST: {
    screen_code: "PROC_PLANT_TRANSFER_LIST",
    route: "/dashboard/procurement/transfer",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_PLANT_TRANSFER_DETAIL: {
    screen_code: "PROC_PLANT_TRANSFER_DETAIL",
    route: "/dashboard/procurement/transfer/:id",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_STOCK_LEDGER: {
    screen_code: "PROC_STOCK_LEDGER",
    route: "/dashboard/procurement/reports/stock-ledger",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_CURRENT_STOCK: {
    screen_code: "PROC_CURRENT_STOCK",
    route: "/dashboard/procurement/reports/current-stock",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_STOCK_VALUATION: {
    screen_code: "PROC_STOCK_VALUATION",
    route: "/dashboard/procurement/reports/stock-valuation",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_LC_LIST: {
    screen_code: "PROC_LC_LIST",
    route: "/dashboard/procurement/accounts/landed-costs",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_LC_DETAIL: {
    screen_code: "PROC_LC_DETAIL",
    route: "/dashboard/procurement/accounts/landed-costs/:id",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_SO_LIST: {
    screen_code: "PROC_SO_LIST",
    route: "/dashboard/procurement/sales-orders",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_SO_CREATE: {
    screen_code: "PROC_SO_CREATE",
    route: "/dashboard/procurement/sales-orders/create",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_SO_DETAIL: {
    screen_code: "PROC_SO_DETAIL",
    route: "/dashboard/procurement/sales-orders/:id",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_INV_LIST: {
    screen_code: "PROC_INV_LIST",
    route: "/dashboard/procurement/sales-invoices",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_INV_DETAIL: {
    screen_code: "PROC_INV_DETAIL",
    route: "/dashboard/procurement/sales-invoices/:id",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_OPENING_STOCK_LIST: {
    screen_code: "PROC_OPENING_STOCK_LIST",
    route: "/dashboard/procurement/opening-stock",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_OPENING_STOCK_DETAIL: {
    screen_code: "PROC_OPENING_STOCK_DETAIL",
    route: "/dashboard/procurement/opening-stock/:id",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_OPENING_STOCK_APPROVAL: {
    screen_code: "PROC_OPENING_STOCK_APPROVAL",
    route: "/dashboard/procurement/opening-stock/approval",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_PI_LIST: {
    screen_code: "PROC_PI_LIST",
    route: "/dashboard/procurement/physical-inventory",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_PI_DETAIL: {
    screen_code: "PROC_PI_DETAIL",
    route: "/dashboard/procurement/physical-inventory/:id",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_PAYMENT_TERMS_MASTER: {
    screen_code: "PROC_PAYMENT_TERMS_MASTER",
    route: "/dashboard/procurement/masters/payment-terms",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_PORT_MASTER: {
    screen_code: "PROC_PORT_MASTER",
    route: "/dashboard/procurement/masters/ports",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_PORT_TRANSIT_MASTER: {
    screen_code: "PROC_PORT_TRANSIT_MASTER",
    route: "/dashboard/procurement/masters/port-transit",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_MATERIAL_CATEGORY_MASTER: {
    screen_code: "PROC_MATERIAL_CATEGORY_MASTER",
    route: "/dashboard/procurement/masters/material-categories",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_IMPORT_LEAD_TIME_MASTER: {
    screen_code: "PROC_IMPORT_LEAD_TIME_MASTER",
    route: "/dashboard/procurement/masters/lead-times",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_TRANSPORTER_MASTER: {
    screen_code: "PROC_TRANSPORTER_MASTER",
    route: "/dashboard/procurement/masters/transporters",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_CHA_MASTER: {
    screen_code: "PROC_CHA_MASTER",
    route: "/dashboard/procurement/masters/cha",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  // ── Gate-27: L3 Production ───────────────────────────────────────────────
  PROD_PLAN_FEED: {
    screen_code: "PROD_PLAN_FEED",
    route: "/dashboard/production/plan-feed",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_STROKE_MASTER: {
    screen_code: "PROD_STROKE_MASTER",
    route: "/dashboard/production/stroke-master",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_STROKE_APPROVAL: {
    screen_code: "PROD_STROKE_APPROVAL",
    route: "/dashboard/production/stroke-approval",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_CHANGE_BOM_ITEM: {
    screen_code: "PROD_CHANGE_BOM_ITEM",
    route: "/dashboard/production/change-bom-item",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_CHANGE_BOM_ITEM_APPROVAL: {
    screen_code: "PROD_CHANGE_BOM_ITEM_APPROVAL",
    route: "/dashboard/production/change-bom-approval",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_PACK_BOM_CREATE: {
    screen_code: "PROD_PACK_BOM_CREATE",
    route: "/dashboard/production/pack-bom-create",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_PACK_BOM_APPROVAL: {
    screen_code: "PROD_PACK_BOM_APPROVAL",
    route: "/dashboard/production/pack-bom-approval",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_CHANGE_PACK_BOM: {
    screen_code: "PROD_CHANGE_PACK_BOM",
    route: "/dashboard/production/change-pack-bom",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_CHANGE_PACK_BOM_APPROVAL: {
    screen_code: "PROD_CHANGE_PACK_BOM_APPROVAL",
    route: "/dashboard/production/change-pack-bom-approval",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_PO_CREATE: {
    screen_code: "PROD_PO_CREATE",
    route: "/dashboard/production/po-create",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_PO_EDIT: {
    screen_code: "PROD_PO_EDIT",
    route: "/dashboard/production/po-edit",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_PO_FINAL: {
    screen_code: "PROD_PO_FINAL",
    route: "/dashboard/production/po-final",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_PO_VERIFY: {
    screen_code: "PROD_PO_VERIFY",
    route: "/dashboard/production/po-verify",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_ORDER_LIST: {
    screen_code: "PROD_ORDER_LIST",
    route: "/dashboard/production/order-list",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_BATCH_VARIANCE: {
    screen_code: "PROD_BATCH_VARIANCE",
    route: "/dashboard/production/batch-variance",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_REVERSAL: {
    screen_code: "PROD_REVERSAL",
    route: "/dashboard/production/reversal",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_QA_QUEUE: {
    screen_code: "PROD_QA_QUEUE",
    route: "/dashboard/production/qa-queue",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_SFG_RESULT_RECORDING: {
    screen_code: "PROD_SFG_RESULT_RECORDING",
    route: "/dashboard/production/sfg-result-recording",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_BATCH_RELEASE: {
    screen_code: "PROD_BATCH_RELEASE",
    route: "/dashboard/production/batch-release",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_FG_STOCK_BREAKDOWN: {
    screen_code: "PROD_FG_STOCK_BREAKDOWN",
    route: "/dashboard/production/fg-stock-breakdown",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_PARTIAL_BATCH_REVERSAL: {
    screen_code: "PROD_PARTIAL_BATCH_REVERSAL",
    route: "/dashboard/production/partial-batch-reversal",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROD_PARTIAL_REVERSAL_REPORT: {
    screen_code: "PROD_PARTIAL_REVERSAL_REPORT",
    route: "/dashboard/production/partial-reversal-report",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },
});
