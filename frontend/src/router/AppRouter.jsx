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
import AuthBootstrap from "../auth/AuthBootstrap.jsx";
import AuthResolver from "../admin/AuthResolver.jsx";
import LandingPage from "../pages/public/LandingPage.jsx";
import LoginScreen from "../pages/public/LoginScreen.jsx";
import SignupScreen from "../pages/public/SignupPage.jsx";
import AuthCallback from "../pages/public/AuthCallback.jsx";
import EmailVerified from "../pages/public/EmailVerified.jsx";
import SignupSubmittedPage from "../pages/public/SignupSubmittedPage.jsx";
import ForgotPassword from "../pages/public/ForgotPassword.jsx";
import ResetPassword from "../pages/public/ResetPassword.jsx";


import RouteGuard from "./RouteGuard.jsx";
import DeepLinkGuard from "./DeepLinkGuard.jsx";
import MenuShell from "../layout/MenuShell.jsx";
import SessionWatchdog from "../components/SessionWatchdog.jsx";

// Admin shells
import SADashboardShell from "../admin/sa/SADashboardShell.jsx";
import GADashboardShell from "../admin/ga/GADashboardShell.jsx";

// SA screens
import SACompanyCreate from "../admin/sa/screens/SACompanyCreate.jsx";
import SAUsers from "../admin/sa/screens/SAUsers.jsx";
import SASignupRequests from "../admin/sa/screens/SASignupRequests.jsx";
import SAHome from "../admin/sa/screens/SAHome.jsx"; 

export default function AppRouter() {
  //console.log("🧭 AppRouter RENDERED");
  return (
    <BrowserRouter>
      {/* ✅ SINGLE SOURCE OF CONTEXT */}
      <MenuProvider>
  {/* 🔥 GLOBAL AUTH BOOT */}
  <AuthBootstrap>
        <SessionWatchdog />

        <Routes>

          {/* ============================== */}
          {/* 🌐 PUBLIC ROUTES */}
          {/* ============================== */}

          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/signup" element={<SignupScreen />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/email-verified" element={<EmailVerified />} />
          <Route path="/signup-submitted" element={<SignupSubmittedPage />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

         {/* 🔥 NEUTRAL ENTRY (AUTH BOOT TARGET) */}
<Route path="/app" element={<AuthResolver />} />
          

          {/* ============================== */}
          {/* 🔒 ADMIN DASHBOARD (ENTRY) */}
          {/* ============================== */}
{/* ============================== */}
{/* 🔒 SA UNIVERSE (PROTECTED) */}
{/* ============================== */}

<Route
  path="/sa"
  element={
    <DeepLinkGuard>
      <RouteGuard>
        <SADashboardShell />
      </RouteGuard>
    </DeepLinkGuard>
  }
>
  {/* 🔥 LAYOUT LAYER */}
  <Route element={<MenuShell />}>

    <Route
      path="home"
      element={(console.log("📍 /sa/home PAGE HIT"), <SAHome />)}
    />
    <Route path="company/create" element={<SACompanyCreate />} />
    <Route path="users" element={<SAUsers />} />
    <Route path="signup-requests" element={<SASignupRequests />} />

  </Route>
</Route>

{/* ============================== */}
{/* 🔒 GA UNIVERSE (PROTECTED) */}
{/* ============================== */}

<Route
  path="/ga"
  element={
    <DeepLinkGuard>
      <RouteGuard>
        <GADashboardShell />
      </RouteGuard>
    </DeepLinkGuard>
  }
>
  <Route path="home" element={<div>GA Home</div>} />
</Route>

          {/* ============================== */}
          {/* 🔐 ACL USER UNIVERSE */}
          {/* ============================== */}

          <Route
            path="/dashboard"
            element={
              <DeepLinkGuard>
                <MenuShell>
                  <RouteGuard>
                    <div>Dashboard</div>
                  </RouteGuard>
                </MenuShell>
              </DeepLinkGuard>
            }
          />

          {/* ============================== */}
          {/* 🚧 FALLBACK */}
          {/* ============================== */}

          <Route path="*" element={<Navigate to="/" replace />} />

        </Routes>
         </AuthBootstrap>

      </MenuProvider>
    </BrowserRouter>
  );
}
