/*
 * File-ID: 7.6
 * File-Path: frontend/src/router/routeIndex.js
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Build allowed route index from backend menu snapshot
 * Authority: Frontend
 */

/**
 * Check whether a pathname is authorized by the allowed-route set.
 *
 * Two strategies:
 *   1. Exact match  — covers the vast majority of static routes.
 *   2. Pattern match — covers dynamic React Router routes that contain ":param"
 *      segments (e.g. "/dashboard/procurement/purchase-orders/:id").
 *      Each ":param" token is treated as a regex wildcard that matches one
 *      non-slash path segment, so "/procurement/purchase-orders/PO-2024-001"
 *      correctly matches the stored pattern.
 *
 * This function is the single source of truth for route authorization checks.
 * Import it wherever `allowedRoutes.has(pathname)` was previously used.
 */
export function isRouteAllowed(allowedRoutes, pathname) {
  // 1. Fast exact match (covers ~95 % of cases)
  if (allowedRoutes.has(pathname)) return true;

  // 2. Pattern match for ":param" dynamic routes
  for (const pattern of allowedRoutes) {
    if (!pattern.includes(":")) continue;
    // ":param" → "[^/]+" — each param matches exactly one path segment
    const regex = new RegExp("^" + pattern.replace(/:[^/]+/g, "[^/]+") + "$");
    if (regex.test(pathname)) return true;
  }

  return false;
}

export function buildRouteIndex(menuSnapshot) {
  const routes = new Set();

  if (!Array.isArray(menuSnapshot)) return routes;

  for (const item of menuSnapshot) {
    if (item?.route_path) {
      routes.add(item.route_path);
    }
  }

  // Minimal shell anchors only. Real admin/user routes must come from snapshot.
  routes.add("/ga/home");
  routes.add("/dashboard");
  routes.add("/app");

  const companionRoutePairs = [
    ["/dashboard/hr/leave/register", "/dashboard/hr/leave/register/results"],
    ["/dashboard/hr/out-work/register", "/dashboard/hr/out-work/register/results"],
    ["/sa/users", "/sa/users/report"],
  ];

  for (const [baseRoute, companionRoute] of companionRoutePairs) {
    if (routes.has(baseRoute)) {
      routes.add(companionRoute);
    }
  }

  return routes;
}
