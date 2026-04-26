/*
 * File-ID: 8.4G
 * File-Path: frontend/src/hooks/useErpScreenHotkeys.js
 * Gate: 8
 * Phase: 8
 * Domain: FRONT
 * Purpose: Register route-level save, refresh, and focus hotkeys for keyboard-first ERP screens
 * Authority: Frontend
 */

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { registerErpScreenHotkeys } from "../store/erpScreenHotkeys.js";

/**
 * Register screen-level hotkeys without triggering a subscriber cascade on
 * every render. The caller may pass a new inline object each render — we store
 * it in a ref so live `disabled` and `perform` values are always current, but
 * we only call `registerErpScreenHotkeys` (which emits to MenuShell) once per
 * route, not once per render.
 */
export function useErpScreenHotkeys(hotkeys) {
  const location = useLocation();
  const hotkeysRef = useRef(hotkeys);

  // Keep the ref current on every render (synchronous, no effect needed).
  hotkeysRef.current = hotkeys;

  useEffect(() => {
    // Build a stable proxy object whose `disabled` / `perform` read from the
    // ref at call time, so changes in the caller are reflected immediately
    // without re-registering and without re-emitting to subscribers.
    const KEYS = ["save", "refresh", "focusSearch", "focusPrimary"];
    const proxy = {};
    for (const key of KEYS) {
      proxy[key] = {
        get disabled() {
          return Boolean(hotkeysRef.current?.[key]?.disabled);
        },
        perform() {
          hotkeysRef.current?.[key]?.perform?.();
        },
      };
    }

    return registerErpScreenHotkeys(location.pathname, proxy);
  }, [location.pathname]); // re-register only on route change, not on every render
}
