/*
 * File-ID: 7.8
 * File-Path: frontend/src/router/DeepLinkGuard.jsx
 * Gate: 7
 * Phase: 7
 * Domain: SECURITY
 * Purpose: Block direct URL access to routes not present in menu snapshot
 * Authority: Frontend
 */

import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useMenu } from "../context/useMenu.js";

export default function DeepLinkGuard() {
  const { allowedRoutes, loading } = useMenu();
  const location = useLocation();

  if (loading) return null;

  if (!allowedRoutes.has(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
