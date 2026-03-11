import { SCREEN_TYPE } from "../screenTypes.js";

export const CORE_SCREENS = Object.freeze({

  DASHBOARD_HOME: {
    screen_code: "DASHBOARD_HOME",
    route: "/dashboard",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: true,
  },

});