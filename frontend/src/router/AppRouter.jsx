/*
 * File-ID: 7.6B
 * File-Path: frontend/src/router/AppRouter.jsx
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Central route definition with snapshot-based guards
 * Authority: Frontend
 */

import { BrowserRouter, Routes, Route } from "react-router-dom";
import RouteGuard from "./RouteGuard.jsx";
import DeepLinkGuard from "./DeepLinkGuard.jsx";
import MenuShell from "../layout/MenuShell.jsx";
import HiddenRouteRedirect from "../layout/HiddenRouteRedirect.jsx";

// 🆕 Admin shells
import SADashboardShell from "../admin/sa/SADashboardShell.jsx";
import GADashboardShell from "../admin/ga/GADashboardShell.jsx";

export default function AppRouter() {
  return (
    <BrowserRouter>
      <HiddenRouteRedirect>
        <Routes>
          {/* ============================== */}
          {/* 🔒 ADMIN UNIVERSE ENTRY POINTS */}
          {/* ============================== */}
          <Route path="/sa/home" element={<SADashboardShell />} />
          <Route path="/ga/home" element={<GADashboardShell />} />

          {/* ============================== */}
          {/* 🔐 ACL USER UNIVERSE */}
          {/* ============================== */}
          <Route element={<DeepLinkGuard />}>
            <Route
              path="/dashboard"
              element={
                <MenuShell>
                  <RouteGuard>
                    <div>Dashboard</div>
                  </RouteGuard>
                </MenuShell>
              }
            />
          </Route>

          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </HiddenRouteRedirect>
    </BrowserRouter>
  );
}
