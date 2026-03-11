/*
 * File-ID: 8.1
 * File-Path: frontend/src/navigation/screenRegistry.js
 * Gate: 8
 * Phase: 8
 * Domain: FRONT
 * Purpose: Declare canonical screen registry for navigation engine
 * Authority: Frontend
 */
import { SCREEN_TYPE } from "./screenTypes.js";
import { CORE_SCREENS } from "./screens/coreScreens.js";
import { ADMIN_SCREENS } from "./screens/adminScreens.js";
import { SETTINGS_SCREENS } from "./screens/settingsScreens.js";

import { PROJECT_SCREENS } from "./screens/projects/projectScreens.js";

import { HR_SCREENS } from "./screens/projects/hrModule/hrScreens.js";
import { OPERATION_SCREENS } from "./screens/projects/operationModule/operationScreens.js";

import { WORKFLOW_SCREENS } from "./screens/workflowScreens.js";
import { REPORTING_SCREENS } from "./screens/reportingScreens.js";


/**
 * Screen Registry is the ONLY source of truth
 * for what constitutes a valid screen in the ERP.
 *
 * This file defines EXISTENCE, not permission or visibility.
 * No ACL, no menu logic, no role logic is allowed here.
 */
export const SCREEN_REGISTRY = Object.freeze({

  ...CORE_SCREENS,

  ...ADMIN_SCREENS,
  ...SETTINGS_SCREENS,

  ...PROJECT_SCREENS,

  ...HR_SCREENS,
  ...OPERATION_SCREENS,

  ...WORKFLOW_SCREENS,
  ...REPORTING_SCREENS,

});
