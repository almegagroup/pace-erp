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
 * ✅ Menu আসে AuthResolver থেকে (single source of truth)
 */

import { useState } from "react";
import { MenuContext } from "./MenuContext.js";
import { buildRouteIndex } from "../router/routeIndex.js";

export function MenuProvider({ children }) {

  const [menu, setMenu] = useState([]);
  const [allowedRoutes, setAllowedRoutes] = useState(new Set());
  const [loading, setLoading] = useState(true);

  const setMenuSnapshot = (snapshot) => {

    if (!Array.isArray(snapshot)) {
  console.error("Invalid menu snapshot:", snapshot);
  setMenu([]);
  setAllowedRoutes(new Set());
  setLoading(false); // ✅ ADD THIS LINE
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
        setMenuSnapshot
      }}
    >
      {children}
    </MenuContext.Provider>
  );
}