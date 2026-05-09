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
});
