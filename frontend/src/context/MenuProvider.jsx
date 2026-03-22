/*
 * File-ID: 7.6C
 * File-Path: frontend/src/context/MenuProvider.jsx
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Provide menu snapshot and route authority state
 * Authority: Frontend
 *
 * FINAL RULE:
 * ❌ NO API CALL HERE
 * ✅ Menu আসে AuthBootstrap / AuthResolver থেকে (single source of truth)
 */

import { useState } from "react";
import { MenuContext } from "./MenuContext.js";
import { buildRouteIndex } from "../router/routeIndex.js";

export function MenuProvider({ children }) {
  const [menu, setMenu] = useState([]);
  const [allowedRoutes, setAllowedRoutes] = useState(new Set());
  const [loading, setLoading] = useState(true);

  // 🔵 START LOADING (used before fetch)
  const startMenuLoading = () => {
    setLoading(true);
  };

  // 🔴 CLEAR (used on logout / public routes)
  const clearMenuSnapshot = () => {
    setMenu([]);
    setAllowedRoutes(new Set());
    setLoading(false);
  };

  // 🟢 SET MENU (main function)
  const setMenuSnapshot = (snapshot) => {
    if (!Array.isArray(snapshot)) {
      console.error("Invalid menu snapshot:", snapshot);
      setMenu([]);
      setAllowedRoutes(new Set());
      setLoading(false);
      return;
    }

    setMenu(snapshot);
    setAllowedRoutes(buildRouteIndex(snapshot));
    setLoading(false);
  };

  return (
    <MenuContext.Provider
      value={{
        menu,
        allowedRoutes,
        loading,
        startMenuLoading,
        clearMenuSnapshot,
        setMenuSnapshot,
      }}
    >
      {children}
    </MenuContext.Provider>
  );
}