/*
 * File-ID: 7.6C-HOOK
 * File-Path: frontend/src/context/useMenu.js
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Access menu route authority context
 * Authority: Frontend
 */

import { useContext } from "react";
import { MenuContext } from "./MenuContext.js";

export function useMenu() {
  return useContext(MenuContext);
}
