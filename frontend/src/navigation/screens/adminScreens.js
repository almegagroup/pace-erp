import { SCREEN_TYPE } from "../screenTypes.js";

export const ADMIN_SCREENS = Object.freeze({

  SA_HOME: {
    screen_code: "SA_HOME",
    route: "/sa/home",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: true,
  },

  SA_COMPANY_CREATE: {
    screen_code: "SA_COMPANY_CREATE",
    route: "/sa/company/create",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  SA_USERS: {
    screen_code: "SA_USERS",
    route: "/sa/users",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  SA_SIGNUP_REQUESTS: {
    screen_code: "SA_SIGNUP_REQUESTS",
    route: "/sa/signup-requests",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  GA_HOME: {
    screen_code: "GA_HOME",
    route: "/ga/home",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: true,
  },

});