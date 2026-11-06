/*
 * File-Path: frontend/src/hooks/useErpVisibleColumns.js
 * Purpose: Column picker state for list pages. Now backed by the common column-layout system
 *          (shared/columnLayouts): hidden columns + order, up to 3 named layouts per user per page, a default layout,
 *          Save Changes / Save As / Rename / Delete. The old per-browser localStorage choice is gone -- a user's saved
 *          layouts follow them across browsers.
 *          `storageKey` (kept for existing callers) doubles as the page's layout code; pass `layoutCode` to override.
 *          Return shape is unchanged (visibleColumns, visibleColumnKeys, toggleColumn, resetColumns) plus `drawerProps`:
 *          spread it on <ErpColumnVisibilityDrawer/> to get the layout controls.
 * Authority: Frontend
 */
import { useCallback, useMemo } from "react";
import { pushToast } from "../store/uiToast.js";
import { layoutDrawerProps, useColumnLayouts } from "../shared/columnLayouts/useColumnLayouts.js";

const toLayoutCode = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9_.-]/g, "_").slice(0, 60);

export function useErpVisibleColumns({ storageKey, layoutCode, columnDefs, defaultColumnKeys }) {
  const pickerColumns = useMemo(
    () => columnDefs.map((column) => ({ ...column, defaultHidden: !defaultColumnKeys.includes(column.key) })),
    [columnDefs, defaultColumnKeys],
  );
  const notify = useCallback((message, tone) => pushToast({ message, tone }), []);
  const layout = useColumnLayouts(toLayoutCode(layoutCode ?? storageKey), pickerColumns, notify);

  return {
    visibleColumns: layout.columns,
    visibleColumnKeys: layout.visibleColumnKeys,
    toggleColumn: layout.toggleColumn,
    resetColumns: layout.resetColumns,
    layout,
    drawerProps: layoutDrawerProps(layout),
  };
}
