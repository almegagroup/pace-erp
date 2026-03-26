/*
 * File-ID: 7.7
 * File-Path: frontend/src/layout/MenuShell.jsx
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Render menu UI strictly from backend snapshot
 * Authority: Frontend
 */

import { useMenu } from "../context/useMenu.js";
import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import {
  getScreenForRoute,
  getStackDepth,
  openRoute,
  popScreen,
  resetToScreen,
} from "../navigation/screenStackEngine.js";
import {
  confirmAndRequestLogout,
  requestLogout,
} from "../store/sessionWarning.js";
import {
  subscribeWorkspaceShell,
  toggleSidebarCollapsed,
  unsubscribeWorkspaceShell,
} from "../store/workspaceShell.js";

export default function MenuShell(){
  //console.log("🔥 MenuShell ACTIVE");
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const { menu, loading, shellProfile } = useMenu();
  const stackDepth = getStackDepth();

  const activeTitle = useMemo(() => {
    const menuMatch = menu.find((item) => item.route_path === location.pathname);
    if (menuMatch?.title) return menuMatch.title;

    const screenMatch = getScreenForRoute(location.pathname);
    if (screenMatch?.screen_code) {
      return screenMatch.screen_code
        .split("_")
        .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
        .join(" ");
    }

    return "Workspace";
  }, [location.pathname, menu]);

  console.log("📊 MenuShell state:", {
    loading,
    menuLength: menu?.length,
  });

  useEffect(() => {
    const listener = (snapshot) => {
      setCollapsed(snapshot.sidebarCollapsed);
    };

    subscribeWorkspaceShell(listener);
    return () => unsubscribeWorkspaceShell(listener);
  }, []);

  if (loading) {
    console.log("⏳ Loading...");
    return <div>Loading Menu...</div>;
  }

  async function handleLogout() {
    await requestLogout();
  }

  function handleMenuRoute(routePath) {
    if (!getScreenForRoute(routePath)) {
      console.warn(`[NAVIGATION_ROUTE_MISSING] ${routePath}`);
      return;
    }

    openRoute(routePath);
  }

  function getHomeRouteTarget() {
    if (location.pathname.startsWith("/sa")) {
      return "SA_HOME";
    }

    if (location.pathname.startsWith("/ga")) {
      return "GA_HOME";
    }

    return "DASHBOARD_HOME";
  }

  function handleGoHome() {
    resetToScreen(getHomeRouteTarget());
  }

  async function handleBack() {
    if (stackDepth <= 1) {
      await confirmAndRequestLogout();
      return;
    }

    popScreen();
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "linear-gradient(180deg, #f4f8fb 0%, #edf3f7 100%)" }}>
      <aside style={{ width: collapsed ? "88px" : "280px", transition: "width 180ms ease", borderRight: "1px solid #d6e2ea", display: "flex", flexDirection: "column", background: "linear-gradient(180deg, #06243a 0%, #0f3b59 100%)", color: "#fff" }}>
        <div style={{ padding: "24px 22px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
              <img
                src="/icon-192.png"
                alt="PACE ERP"
                style={{
                  width: "38px",
                  height: "38px",
                  borderRadius: "12px",
                  objectFit: "cover",
                  border: "1px solid rgba(255,255,255,0.14)",
                  boxShadow: "0 10px 24px rgba(2, 132, 199, 0.24)",
                  flexShrink: 0,
                }}
              />
              {!collapsed ? (
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: "11px", letterSpacing: "0.24em", textTransform: "uppercase", color: "#90d5ff", fontWeight: 700 }}>
                    Pace ERP
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: "12px", color: "rgba(255,255,255,0.62)" }}>
                    {shellProfile?.userCode || "PACE ERP"}
                  </p>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => toggleSidebarCollapsed()}
              title={collapsed ? "Show sidebar (Ctrl+Right Arrow)" : "Hide sidebar (Ctrl+Left Arrow)"}
              style={{
                border: "1px solid rgba(255,255,255,0.16)",
                background: "rgba(255,255,255,0.06)",
                color: "#fff",
                borderRadius: "12px",
                padding: "8px 10px",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              {collapsed ? ">>" : "<<"}
            </button>
          </div>
          {!collapsed ? (
            <>
              <h2 style={{ margin: "16px 0 0", fontSize: "24px", fontWeight: 600, lineHeight: 1.2 }}>
            {activeTitle}
              </h2>
              <p style={{ margin: "10px 0 0", fontSize: "13px", lineHeight: 1.6, color: "rgba(255,255,255,0.72)" }}>
            {shellProfile?.tagline || "Process Automation & Control Environment"}
              </p>
            </>
          ) : null}
        </div>

        <div style={{ padding: "18px 16px 16px", flex: 1 }}>
          {!collapsed ? (
            <p style={{ margin: "0 8px 14px", fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.56)", fontWeight: 700 }}>
            Modules
            </p>
          ) : null}
          <ul style={{ flex: 1, listStyle: "none", margin: 0, padding: 0 }}>
          {menu.map(item => (
            <li key={item.menu_code} style={{ marginBottom: "8px" }}>
              {item.route_path ? (
                <button
                  type="button"
                  onClick={() => handleMenuRoute(item.route_path)}
                  disabled={location.pathname === item.route_path}
                  style={{
                    width: "100%",
                    background: location.pathname === item.route_path ? "linear-gradient(90deg, rgba(56,189,248,0.24) 0%, rgba(59,130,246,0.08) 100%)" : "transparent",
                    border: "none",
                    borderRadius: "16px",
                    padding: collapsed ? "14px 10px" : "14px 16px",
                    color: location.pathname === item.route_path ? "#ffffff" : "rgba(255,255,255,0.82)",
                    cursor: location.pathname === item.route_path ? "default" : "pointer",
                    textAlign: collapsed ? "center" : "left",
                    fontSize: "14px",
                    fontWeight: location.pathname === item.route_path ? 600 : 500,
                  }}
                >
                  {collapsed ? item.title.slice(0, 2).toUpperCase() : item.title}
                </button>
              ) : (
                <span style={{ display: "block", padding: collapsed ? "14px 10px" : "14px 16px", color: "rgba(255,255,255,0.56)", textAlign: collapsed ? "center" : "left" }}>
                  {collapsed ? item.title.slice(0, 2).toUpperCase() : item.title}
                </span>
              )}
            </li>
          ))}
          </ul>
        </div>

        <div style={{ padding: "16px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <button
            onClick={handleLogout}
            title="Logout (Ctrl+Shift+L)"
            style={{
              width: "100%",
              border: "none",
              borderRadius: "16px",
              padding: collapsed ? "14px 10px" : "14px 16px",
              background: "linear-gradient(90deg, #0ea5e9 0%, #2563eb 100%)",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {collapsed ? "Out" : "Logout (Ctrl+Shift+L)"}
          </button>
        </div>

      </aside>

      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 26px", borderBottom: "1px solid #d6e2ea", background: "rgba(255,255,255,0.72)", backdropFilter: "blur(10px)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "18px", flexWrap: "wrap" }}>
            <div>
              <p style={{ margin: 0, fontSize: "11px", letterSpacing: "0.22em", textTransform: "uppercase", color: "#64748b", fontWeight: 700 }}>
                {shellProfile?.roleCode || "Role"}
              </p>
              <h1 style={{ margin: "10px 0 0", fontSize: "20px", color: "#0f172a", fontWeight: 600 }}>
                {activeTitle}
              </h1>
              <p style={{ margin: "6px 0 0", fontSize: "13px", color: "#64748b" }}>
                {shellProfile?.userCode || "User"}
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => void handleBack()}
                style={{
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  borderRadius: "14px",
                  padding: "10px 14px",
                  color: "#0f172a",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {stackDepth <= 1 ? "Logout" : "Back"}
              </button>
              <button
                type="button"
                onClick={handleGoHome}
                style={{
                  border: "1px solid #bae6fd",
                  background: "#e0f2fe",
                  borderRadius: "14px",
                  padding: "10px 14px",
                  color: "#075985",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Main Dashboard
              </button>
            </div>
          </div>
        </div>
        <div style={{ flex: 1 }}>
  <Outlet />
        </div>
      </main>
    </div>
  );
}
