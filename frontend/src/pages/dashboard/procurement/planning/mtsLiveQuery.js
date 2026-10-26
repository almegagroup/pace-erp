/*
 * File-Path: frontend/src/pages/dashboard/procurement/planning/mtsLiveQuery.js
 * Purpose: PO22 always shows the live state (owner 2026-10-26): every open of a tab, every return
 *          to the browser tab, and every Recalculate re-reads PO21 plan, stock and CSN Tracker.
 *          The browser never serves an older PO22 result from its cache.
 */

export const PO22_LIVE_QUERY = Object.freeze({
  staleTime: 0,
  refetchOnMount: "always",
  refetchOnWindowFocus: true,
});
