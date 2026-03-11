/*
 * File-ID: 7.6A
 * File-Path: frontend/src/router/RouteGuard.jsx
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Block navigation to routes not present in menu snapshot
 * Authority: Frontend
 */

import { Navigate, useLocation } from "react-router-dom";
import { useMenu } from "../context/useMenu.js";

export default function RouteGuard({ children }) {
  const location = useLocation();
  const { allowedRoutes, loading } = useMenu();

  if (loading) return null; // no optimistic render

  if (!allowedRoutes.has(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  return children;
}
