/*
 * File-ID: 7.6C
 * File-Path: frontend/src/context/MenuProvider.jsx
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Provide menu snapshot and route authority state
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import { MenuContext } from "./MenuContext.js";
import { buildRouteIndex } from "../router/routeIndex.js";

export function MenuProvider({ children }) {
  const [menu, setMenu] = useState([]);
  const [allowedRoutes, setAllowedRoutes] = useState(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {

  /*
  ============================================================
  TEMP_UI_BOOT_PATCH
  Step: 2
  File: MenuProvider.jsx
  Reason:
  During UI bootstrap landing page loads before authentication.
  Menu API (/api/me/menu) requires valid session.

  Temporary rule:
  Skip menu fetch on landing page.

  Remove after login flow is implemented.
  ============================================================
  */

 const pathname = globalThis.location.pathname;

const PUBLIC_ROUTES = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password"
]);

if (PUBLIC_ROUTES.has(pathname)) {

  // React safe async state update
  setTimeout(() => {
    setLoading(false);
  }, 0);

  return;
}

  fetch(`${import.meta.env.VITE_API_BASE}/api/me/menu`, {
  credentials: "include",
})
    .then(async (res) => {

      const text = await res.text();

      let json;

      try {
        json = JSON.parse(text);
      } catch {
        console.error("MENU API returned non-JSON:", text);
        return { data: { menu: [] } };
      }

      return json;
    })
    .then((res) => {
      const snapshot = res?.data?.menu ?? [];
      setMenu(snapshot);
      setAllowedRoutes(buildRouteIndex(snapshot));
    })
    .catch((err) => {
      console.error("Menu fetch failed:", err);
      setMenu([]);
      setAllowedRoutes(new Set());
    })
    .finally(() => setLoading(false));
}, []);

  return (
    <MenuContext.Provider value={{ menu, allowedRoutes, loading }}>
      {children}
    </MenuContext.Provider>
  );
}
