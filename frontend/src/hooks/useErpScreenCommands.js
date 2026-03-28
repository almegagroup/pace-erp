/*
 * File-ID: 8.4D
 * File-Path: frontend/src/hooks/useErpScreenCommands.js
 * Gate: 8
 * Phase: 8
 * Domain: FRONT
 * Purpose: Register current route keyboard commands for the protected ERP command palette
 * Authority: Frontend
 */

import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { registerErpScreenCommands } from "../store/erpCommandPalette.js";

export function useErpScreenCommands(commands) {
  const location = useLocation();

  useEffect(() => {
    return registerErpScreenCommands(location.pathname, commands);
  }, [commands, location.pathname]);
}
