/*
 * File-ID: 7.6E
 * File-Path: frontend/src/router/publicRoutes.js
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Single source of truth for public routes
 * Authority: Frontend
 */

/*
============================================================
PUBLIC ROUTE REGISTRY

Rules:
1. Public routes render without authentication
2. Navigation engine must NOT activate on these routes
3. Menu API must NOT run on these routes
4. Guards must bypass these routes

This file acts as SSOT for all public route checks.
============================================================
*/

export const PUBLIC_ROUTES = new Set([
  "/",
  "/login",
  "/signup-instructions",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/email-verified",
  "/signup-submitted",
  "/auth/callback", // 🔥 ADD THIS
]);

export function isPublicRoute(pathname) {
  return PUBLIC_ROUTES.has(pathname);
}
