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
    // ── HR ────────────────────────────────────────────────────────────────────
    // Register report criteria → results (companion pages)
    ["/dashboard/hr/leave/register",   "/dashboard/hr/leave/register/results"],
    ["/dashboard/hr/out-work/register", "/dashboard/hr/out-work/register/results"],
    // Leave request detail — accessible from my-requests, approval inbox, or register
    ["/dashboard/hr/leave/my-requests",          "/dashboard/hr/leave/request-detail"],
    ["/dashboard/hr/leave/approval-inbox",       "/dashboard/hr/leave/request-detail"],
    ["/dashboard/hr/leave/approval-history",     "/dashboard/hr/leave/request-detail"],
    // Out-work request detail
    ["/dashboard/hr/out-work/my-requests",       "/dashboard/hr/out-work/request-detail"],
    ["/dashboard/hr/out-work/approval-inbox",    "/dashboard/hr/out-work/request-detail"],
    ["/dashboard/hr/out-work/approval-history",  "/dashboard/hr/out-work/request-detail"],
    // Attendance correction detail
    ["/dashboard/hr/attendance/correction/my-requests",     "/dashboard/hr/attendance/correction/detail"],
    ["/dashboard/hr/attendance/correction/approval-inbox",  "/dashboard/hr/attendance/correction/detail"],
    ["/dashboard/hr/attendance/correction/approval-history","/dashboard/hr/attendance/correction/detail"],

    // ── OM Masters ────────────────────────────────────────────────────────────
    // Detail pages use non-:id exact paths (context passed via screen stack)
    ["/dashboard/om/materials",              "/dashboard/om/material/detail"],
    ["/dashboard/om/material/create",        "/dashboard/om/material/detail"],
    ["/dashboard/om/vendors",                "/dashboard/om/vendor/detail"],
    ["/dashboard/om/vendor/create",          "/dashboard/om/vendor/detail"],
    ["/dashboard/om/vendor-material-infos",  "/dashboard/om/vendor-material-info/detail"],
    ["/dashboard/om/vendor-material-infos",  "/dashboard/om/vendor-material-info/create"],
    ["/dashboard/om/vendor-material-info/create", "/dashboard/om/vendor-material-info/detail"],
    ["/dashboard/om/customers",              "/dashboard/om/customer/detail"],
    ["/dashboard/om/customers",              "/dashboard/om/customer/create"],
    ["/dashboard/om/customer/create",        "/dashboard/om/customer/detail"],

    // ── Procurement — :id detail routes ───────────────────────────────────────
    ["/dashboard/procurement/purchase-orders",         "/dashboard/procurement/purchase-orders/:id"],
    ["/dashboard/procurement/purchase-orders/create",  "/dashboard/procurement/purchase-orders/:id"],
    ["/dashboard/procurement/purchase-orders/create-opening",  "/dashboard/procurement/purchase-orders/:id"],
    ["/dashboard/procurement/csn-tracker",             "/dashboard/procurement/csns/:id"],
    ["/dashboard/procurement/csn-alerts",              "/dashboard/procurement/csns/:id"],
    ["/dashboard/procurement/gate-entries",            "/dashboard/procurement/gate-entries/:id"],
    ["/dashboard/procurement/gate-entries/create",     "/dashboard/procurement/gate-entries/:id"],
    ["/dashboard/procurement/gate-entries",            "/dashboard/procurement/gate-exits/inbound/:id"],
    ["/dashboard/procurement/grns",                    "/dashboard/procurement/grns/:id"],
    ["/dashboard/procurement/qa-queue",                "/dashboard/procurement/qa-documents/:id"],
    ["/dashboard/procurement/stos",                    "/dashboard/procurement/stos/:id"],
    ["/dashboard/procurement/stos/create",             "/dashboard/procurement/stos/:id"],
    ["/dashboard/procurement/rtvs",                    "/dashboard/procurement/rtvs/:id"],
    ["/dashboard/procurement/rtvs/create",             "/dashboard/procurement/rtvs/:id"],
    ["/dashboard/procurement/debit-notes",             "/dashboard/procurement/debit-notes/:id"],
    ["/dashboard/procurement/accounts/invoice-verifications",        "/dashboard/procurement/accounts/invoice-verifications/:id"],
    ["/dashboard/procurement/accounts/invoice-verifications/create", "/dashboard/procurement/accounts/invoice-verifications/:id"],
    ["/dashboard/procurement/accounts/landed-costs",   "/dashboard/procurement/accounts/landed-costs/:id"],
    ["/dashboard/procurement/transfer",                "/dashboard/procurement/transfer/:id"],
    ["/dashboard/procurement/sales-orders",            "/dashboard/procurement/sales-orders/:id"],
    ["/dashboard/procurement/sales-orders/create",     "/dashboard/procurement/sales-orders/:id"],
    ["/dashboard/procurement/sales-invoices",          "/dashboard/procurement/sales-invoices/:id"],
    ["/dashboard/procurement/physical-inventory",      "/dashboard/procurement/physical-inventory/:id"],

    ["/dashboard/procurement/opening-stock", "/dashboard/procurement/opening-stock/:id"],

    // ── SA ────────────────────────────────────────────────────────────────────
    ["/sa/users",              "/sa/users/report"],
  ];

  for (const [baseRoute, companionRoute] of companionRoutePairs) {
    if (routes.has(baseRoute)) {
      routes.add(companionRoute);
    }
  }

  return routes;
}
