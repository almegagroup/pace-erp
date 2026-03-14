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
import LandingPage from "../pages/public/LandingPage.jsx";
import LoginScreen from "../pages/public/LoginScreen.jsx";
import SignupScreen from "../pages/public/SignupPage.jsx";
import EmailVerified from "../pages/public/EmailVerified.jsx";
import SignupSubmittedPage from "../pages/public/SignupSubmittedPage.jsx";
import ForgotPassword from "../pages/public/ForgotPassword.jsx";
import ResetPassword from "../pages/public/ResetPassword.jsx";
import AdminResolver from "../admin/AdminResolver.jsx";
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

  {/* 
  ============================================================
  TEMP_UI_BOOT_PATCH
  Step: 4
  File: AppRouter.jsx
  Reason:
  HiddenRouteRedirect depends on useMenu() which requires
  authenticated session. During landing bootstrap no session
  exists → page becomes blank.

  Temporarily disabled until login flow is implemented.
  Reference: TEMP_UI_BOOT_LOG.md
  ============================================================
  */}

  <Routes>
          {/* ============================== */}
          {/* 🔒 ADMIN UNIVERSE ENTRY POINTS */}
          {/* ============================== */}
          <Route path="/admin" element={<AdminResolver />} />
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

          <Route
            path="/"
            element={<LandingPage />}
          />

          <Route
            path="/login"
            element={<LoginScreen />}
          />
          <Route path="/signup" element={<SignupScreen />} />

        <Route path="/email-verified" element={<EmailVerified />} />

        <Route path="/signup-submitted" element={<SignupSubmittedPage />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

       </Routes>
  

{/* TEMP_UI_BOOT_PATCH — HiddenRouteRedirect disabled
    Closing tag preserved for future restoration
*/}
{/* </HiddenRouteRedirect> */}
    </BrowserRouter>
  );
}