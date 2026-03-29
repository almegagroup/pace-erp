import { SCREEN_TYPE } from "../screenTypes.js";

export const ADMIN_SCREENS = Object.freeze({

  SA_HOME: {
    screen_code: "SA_HOME",
    route: "/sa/home",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: true,
  },

  SA_CONTROL_PANEL: {
    screen_code: "SA_CONTROL_PANEL",
    route: "/sa/control-panel",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  SA_COMPANY_CREATE: {
    screen_code: "SA_COMPANY_CREATE",
    route: "/sa/company/create",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  SA_ORG_BOOTSTRAP: {
    screen_code: "SA_ORG_BOOTSTRAP",
    route: "/sa/org-bootstrap",
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

  SA_USER_ROLES: {
    screen_code: "SA_USER_ROLES",
    route: "/sa/users/roles",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  SA_USER_SCOPE: {
    screen_code: "SA_USER_SCOPE",
    route: "/sa/users/scope",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  SA_SESSIONS: {
    screen_code: "SA_SESSIONS",
    route: "/sa/sessions",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  SA_AUDIT: {
    screen_code: "SA_AUDIT",
    route: "/sa/audit",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  SA_SYSTEM_HEALTH: {
    screen_code: "SA_SYSTEM_HEALTH",
    route: "/sa/system-health",
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

  SA_PROJECT_MASTER: {
    screen_code: "SA_PROJECT_MASTER",
    route: "/sa/project-master",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  SA_ROLE_PERMISSIONS: {
    screen_code: "SA_ROLE_PERMISSIONS",
    route: "/sa/acl/role-permissions",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  SA_APPROVAL_RULES: {
    screen_code: "SA_APPROVAL_RULES",
    route: "/sa/approval-rules",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  SA_COMPANY_MODULE_MAP: {
    screen_code: "SA_COMPANY_MODULE_MAP",
    route: "/sa/acl/company-modules",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  SA_MENU_GOVERNANCE: {
    screen_code: "SA_MENU_GOVERNANCE",
    route: "/sa/menu",
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
