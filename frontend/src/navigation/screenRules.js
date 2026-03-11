/*
 * File-ID: 8.1A
 * File-Path: frontend/src/navigation/screenRules.js
 * Gate: 8
 * Phase: 8
 * Domain: FRONT
 * Purpose: Enforce canonical screen metadata invariants
 * Authority: Frontend
 */

import { SCREEN_REGISTRY } from "./screenRegistry.js";
import { SCREEN_TYPE } from "./screenTypes.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[SCREEN_REGISTRY_INVALID] ${message}`);
  }
}

export function validateScreenRegistry() {
  const routes = new Set();

  Object.values(SCREEN_REGISTRY).forEach((screen) => {
    const { screen_code, route, type, keepAlive } = screen;

    // Basic presence
    assert(screen_code, "screen_code is required");
    assert(route, `route missing for ${screen_code}`);
    assert(type, `type missing for ${screen_code}`);

    // Route uniqueness
    assert(!routes.has(route), `duplicate route detected: ${route}`);
    routes.add(route);

    // Type-specific rules
    if (type === SCREEN_TYPE.MODAL) {
      assert(
        keepAlive === false,
        `MODAL screen ${screen_code} cannot have keepAlive=true`
      );
    }

    if (type === SCREEN_TYPE.DRAWER) {
      assert(
        keepAlive === false,
        `DRAWER screen ${screen_code} cannot have keepAlive=true`
      );
    }

    if (type === SCREEN_TYPE.FULL) {
      assert(
        typeof keepAlive === "boolean",
        `FULL screen ${screen_code} must explicitly declare keepAlive`
      );
    }
  });
}
