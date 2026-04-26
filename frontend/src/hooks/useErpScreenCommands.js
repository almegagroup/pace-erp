/*
 * File-ID: 8.4D
 * File-Path: frontend/src/hooks/useErpScreenCommands.js
 * Gate: 8
 * Phase: 8
 * Domain: FRONT
 * Purpose: Register current route keyboard commands for the protected ERP command palette
 * Authority: Frontend
 */

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { registerErpScreenCommands } from "../store/erpCommandPalette.js";

/**
 * Register screen-level commands without triggering a subscriber cascade on
 * every render. The caller may pass a new inline array each render — we store
 * it in a ref so live `disabled` and `perform` values are always current, but
 * we only call `registerErpScreenCommands` (which emits to MenuShell) once per
 * route, not once per render.
 */
export function useErpScreenCommands(commands) {
  const location = useLocation();
  const commandsRef = useRef(commands);

  // Keep the ref current on every render (synchronous, no effect needed).
  commandsRef.current = commands;

  useEffect(() => {
    // Build stable proxy command objects whose `disabled` / `perform` read
    // from the ref at call time, so changes in the caller are reflected
    // immediately without re-registering and without re-emitting to subscribers.
    const count = commandsRef.current?.length ?? 0;
    const proxyCommands = Array.from({ length: count }, (_, index) => ({
      get id() { return commandsRef.current?.[index]?.id; },
      get label() { return commandsRef.current?.[index]?.label ?? ""; },
      get group() { return commandsRef.current?.[index]?.group; },
      get hint() { return commandsRef.current?.[index]?.hint; },
      get keywords() { return commandsRef.current?.[index]?.keywords; },
      get disabled() { return commandsRef.current?.[index]?.disabled; },
      get order() { return commandsRef.current?.[index]?.order; },
      get perform() { return commandsRef.current?.[index]?.perform; },
    }));

    return registerErpScreenCommands(location.pathname, proxyCommands);
  }, [location.pathname]); // re-register only on route change, not on every render
}
