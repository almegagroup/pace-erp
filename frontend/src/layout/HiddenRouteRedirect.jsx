/*
 * File-ID: 7.7A
 * File-Path: frontend/src/layout/HiddenRouteRedirect.jsx
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Redirect user when current route is not present in menu snapshot
 * Authority: Frontend
 */

import { useLocation, Navigate } from "react-router-dom";
import { useMenu } from "../context/useMenu.js";

export default function HiddenRouteRedirect({ children }) {
  const location = useLocation();
  const { allowedRoutes, loading } = useMenu();

  if (loading) {
    return null;
  }

  if (allowedRoutes.size === 0) {
    return null;
  }

  if (!allowedRoutes.has(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  return children;
}
