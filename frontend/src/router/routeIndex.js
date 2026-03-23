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

// 🔥 IMPORTANT fallback routes
routes.add("/sa/home");
routes.add("/ga/home");
routes.add("/dashboard");
routes.add("/app");

return routes;
}
