/*
 * File-ID: 7.6C
 * File-Path: frontend/src/context/MenuProvider.jsx
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Provide menu snapshot and route authority state
 * Authority: Frontend
 */

import { useState, useCallback } from "react";
import { MenuContext } from "./MenuContext.js";
import { buildRouteIndex } from "../router/routeIndex.js";

export function MenuProvider({ children }) {
  const [menu, setMenu] = useState([]);
  const [allowedRoutes, setAllowedRoutes] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [shellProfile, setShellProfileState] = useState({
    userCode: "",
    roleCode: "",
    tagline: "Process Automation & Control Environment",
  });

  const startMenuLoading = useCallback(() => {
    setLoading(true);
  }, []);

  const clearMenuSnapshot = useCallback(() => {
    setMenu([]);
    setAllowedRoutes(new Set());
    setShellProfileState({
      userCode: "",
      roleCode: "",
      tagline: "Process Automation & Control Environment",
    });
    setLoading(false);
  }, []);

  const setMenuSnapshot = useCallback((snapshot) => {
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
  }, []);

  const setShellProfile = useCallback((profile) => {
    setShellProfileState({
      userCode: profile?.userCode ?? "",
      roleCode: profile?.roleCode ?? "",
      tagline: profile?.tagline ?? "Process Automation & Control Environment",
    });
  }, []);

  return (
    <MenuContext.Provider
      value={{
        menu,
        allowedRoutes,
        loading,
        shellProfile,
        startMenuLoading,
        clearMenuSnapshot,
        setMenuSnapshot,
        setShellProfile,
      }}
    >
      {children}
    </MenuContext.Provider>
  );
}
