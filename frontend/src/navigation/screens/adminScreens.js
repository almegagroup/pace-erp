import { SCREEN_TYPE } from "../screenTypes.js";

export const ADMIN_SCREENS = Object.freeze({

  SA_HOME: {
    screen_code: "SA_HOME",
    route: "/sa/home",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: true,
  },
  GA_HOME: {
    screen_code: "GA_HOME",
    route: "/ga/home",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: true,
  },

});