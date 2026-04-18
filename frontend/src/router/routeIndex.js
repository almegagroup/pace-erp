/*
 * File-ID: 7.6
 * File-Path: frontend/src/router/routeIndex.js
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Build allowed route index from backend menu snapshot
 * Authority: Frontend
 */

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
