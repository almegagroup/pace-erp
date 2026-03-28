/*
 * File-ID: 8.4G
 * File-Path: frontend/src/hooks/useErpScreenHotkeys.js
 * Gate: 8
 * Phase: 8
 * Domain: FRONT
 * Purpose: Register route-level save, refresh, and focus hotkeys for keyboard-first ERP screens
 * Authority: Frontend
 */

import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { registerErpScreenHotkeys } from "../store/erpScreenHotkeys.js";

export function useErpScreenHotkeys(hotkeys) {
  const location = useLocation();

  useEffect(() => {
    return registerErpScreenHotkeys(location.pathname, hotkeys);
  }, [hotkeys, location.pathname]);
}
