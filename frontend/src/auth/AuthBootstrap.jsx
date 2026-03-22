/*
 * File-ID: 2.9A
 * File-Path: frontend/src/auth/AuthBootstrap.jsx
 * Gate: 2 / Gate-7 Integration
 * Phase: GLOBAL AUTH BOOT
 * Domain: FRONT
 * Purpose: Global authentication + menu bootstrap at app load
 * Authority: Frontend (boot-level)
 *
 * DESIGN RULE:
 * ✅ Runs on every route (except public)
 * ✅ Fetches session + menu before guards activate
 * ❌ No UI responsibility
 * ❌ No route-level dependency
 */

import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMenu } from "../context/useMenu.js";
import { isPublicRoute } from "../router/publicRoutes.js";

export default function AuthBootstrap({ children }) {
  const location = useLocation();
  const navigate = useNavigate();

  const {
    startMenuLoading,
    setMenuSnapshot,
    clearMenuSnapshot,
  } = useMenu();

  useEffect(() => {
  let alive = true;

  async function boot() {
    const pathname = location.pathname;

    if (isPublicRoute(pathname)) {
      clearMenuSnapshot();
      return;
    }

    try {
      startMenuLoading();

      const meRes = await fetch(
        `${import.meta.env.VITE_API_BASE}/api/me`,
        { credentials: "include" }
      );

      if (!meRes.ok) {
        throw new Error("SESSION_INVALID");
      }

      const menuRes = await fetch(
        `${import.meta.env.VITE_API_BASE}/api/me/menu`,
        { credentials: "include" }
      );

      if (!menuRes.ok) {
        throw new Error("MENU_FETCH_FAILED");
      }

      const data = await menuRes.json();
if (!alive) return;

const menu = data?.data?.menu ?? [];

setMenuSnapshot(menu);

// 🔥 redirect only from neutral entry
if (location.pathname === "/app") {

  const sa = menu.find(m => m.menu_code === "SA_HOME");
  const ga = menu.find(m => m.menu_code === "GA_HOME");

  if (sa) {
    navigate("/sa/home", { replace: true });
    return;
  }

  if (ga) {
    navigate("/ga/home", { replace: true });
    return;
  }

  navigate("/dashboard", { replace: true });
}
      
    } catch (err) {
      console.error("AuthBootstrap failed:", err);

      clearMenuSnapshot();
      navigate("/login", { replace: true });
    }
  }

  boot();

  return () => {
    alive = false;
  };
}, [
  location.pathname,
  navigate,
  startMenuLoading,
  setMenuSnapshot,
  clearMenuSnapshot,
]); 

  return children;
}