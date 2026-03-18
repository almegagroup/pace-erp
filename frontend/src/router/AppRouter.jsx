/*
 * File-ID: 7.6B
 * File-Path: frontend/src/router/AppRouter.jsx
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Central route definition with snapshot-based guards
 * Authority: Frontend
 */

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { MenuProvider } from "../context/MenuProvider.jsx";

import LandingPage from "../pages/public/LandingPage.jsx";
import LoginScreen from "../pages/public/LoginScreen.jsx";
import SignupScreen from "../pages/public/SignupPage.jsx";
import AuthCallback from "../pages/public/AuthCallback.jsx";
import EmailVerified from "../pages/public/EmailVerified.jsx";
import SignupSubmittedPage from "../pages/public/SignupSubmittedPage.jsx";
import ForgotPassword from "../pages/public/ForgotPassword.jsx";
import ResetPassword from "../pages/public/ResetPassword.jsx";

import AdminResolver from "../admin/AdminResolver.jsx";

import RouteGuard from "./RouteGuard.jsx";
import DeepLinkGuard from "./DeepLinkGuard.jsx";

import MenuShell from "../layout/MenuShell.jsx";

// 🆕 Admin shells
import SADashboardShell from "../admin/sa/SADashboardShell.jsx";
import GADashboardShell from "../admin/ga/GADashboardShell.jsx";

export default function AppRouter() {
  return (
    <BrowserRouter>

      {/* ============================================================
          TEMP_UI_BOOT_PATCH
          HiddenRouteRedirect disabled intentionally
          ============================================================ */}

      <Routes>

        {/* ============================== */}
        {/* 🌐 PUBLIC ROUTES (NO CONTEXT) */}
        {/* ============================== */}

        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/signup" element={<SignupScreen />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/email-verified" element={<EmailVerified />} />
        <Route path="/signup-submitted" element={<SignupSubmittedPage />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* ============================== */}
        {/* 🔒 ADMIN ENTRY */}
        {/* ============================== */}

        <Route path="/admin" element={<AdminResolver />} />

        {/* ============================== */}
        {/* 🔒 ADMIN DASHBOARDS (WITH MENU) */}
        {/* ============================== */}

        <Route
          path="/sa/home"
          element={
            <MenuProvider>
              <SADashboardShell />
            </MenuProvider>
          }
        />

        <Route
          path="/ga/home"
          element={
            <MenuProvider>
              <GADashboardShell />
            </MenuProvider>
          }
        />

        {/* ============================== */}
        {/* 🔐 ACL USER UNIVERSE */}
        {/* ============================== */}

        <Route
          path="/dashboard"
          element={
            <MenuProvider>
              <DeepLinkGuard>
                <MenuShell>
                  <RouteGuard>
                    <div>Dashboard</div>
                  </RouteGuard>
                </MenuShell>
              </DeepLinkGuard>
            </MenuProvider>
          }
        />

        {/* ============================== */}
        {/* 🚧 FALLBACK */}
        {/* ============================== */}

        <Route path="*" element={<Navigate to="/" replace />} />

      </Routes>

      {/* TEMP_UI_BOOT_PATCH — HiddenRouteRedirect disabled */}

    </BrowserRouter>
  );
}