import { SCREEN_TYPE } from "../../../screenTypes.js";

export const OPERATION_SCREENS = Object.freeze({
  OM_MATERIAL_LIST: {
    screen_code: "OM_MATERIAL_LIST",
    route: "/dashboard/om/materials",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_MATERIAL_CREATE: {
    screen_code: "OM_MATERIAL_CREATE",
    route: "/dashboard/om/material/create",
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

  OM_VENDOR_CREATE: {
    screen_code: "OM_VENDOR_CREATE",
    route: "/dashboard/om/vendor/create",
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

  PROC_PO_DETAIL: {
    screen_code: "PROC_PO_DETAIL",
    route: "/dashboard/procurement/purchase-orders/:id",
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

  PROC_QA_QUEUE: {
    screen_code: "PROC_QA_QUEUE",
    route: "/dashboard/procurement/qa-queue",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  PROC_QA_DOCUMENT: {
    screen_code: "PROC_QA_DOCUMENT",
    route: "/dashboard/procurement/qa-documents/:id",
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
});
