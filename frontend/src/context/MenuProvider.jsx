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

import { useState, useCallback } from "react";
import { MenuContext } from "./MenuContext.js";
import { buildRouteIndex } from "../router/routeIndex.js";

export function MenuProvider({ children }) {
  //console.log("🏗️ MenuProvider MOUNTED");
  const [menu, setMenu] = useState([]);
  const [allowedRoutes, setAllowedRoutes] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [shellProfile, setShellProfileState] = useState({
    userCode: "",
    roleCode: "",
    tagline: "Process Automation & Control Environment",
  });
  

  // 🔵 START LOADING (stable)
  const startMenuLoading = useCallback(() => {
    //console.log("⏳ startMenuLoading CALLED");
    setLoading(true);
  }, []);

  // 🔴 CLEAR (stable)
  const clearMenuSnapshot = useCallback(() => {
    //console.log("🧹 clearMenuSnapshot CALLED");
    setMenu([]);
    setAllowedRoutes(new Set());
    setShellProfileState({
      userCode: "",
      roleCode: "",
      tagline: "Process Automation & Control Environment",
    });
    console.log("✅ loading → false (clear)");
    setLoading(false);
  }, []);

  // 🟢 SET MENU (stable)
  const setMenuSnapshot = useCallback((snapshot) => {
    //console.log("📥 setMenuSnapshot CALLED");
  //console.log("📦 snapshot:", snapshot);
    if (!Array.isArray(snapshot)) {
      console.error("Invalid menu snapshot:", snapshot);
      setMenu([]);
      setAllowedRoutes(new Set());
      setLoading(false);
      return;
    }
    //console.log("💾 Setting menu...");
  setMenu(snapshot);

  console.log("🧭 Building route index...");
  setAllowedRoutes(buildRouteIndex(snapshot));

  //console.log("✅ loading → false");

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
