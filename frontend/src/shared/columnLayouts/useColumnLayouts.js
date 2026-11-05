/*
 * File-Path: frontend/src/shared/columnLayouts/useColumnLayouts.js
 * Purpose: Common column-picker state for every report/list page (business owner 2026-11-05).
 *          Hidden columns + column ORDER, up to MAX_USER_LAYOUTS named layouts per user per page, a default layout,
 *          Save Changes (overwrite the selected layout), Save As (new), Rename, Delete. A layout is the ordered list
 *          of its visible column keys. The grid and the Excel both read `columns` from here.
 *          Page usage:
 *            const layout = useColumnLayouts("IN14", allColumns, notify);   // allColumns: [{ key, label, defaultHidden?, pinned? ... }]
 *            <Grid columns={layout.columns} />
 *            <ErpColumnVisibilityDrawer {...layoutDrawerProps(layout)} visible onClose title />
 *          `reportCode` is the page's own stable code (never reuse one across two pages).
 * Authority: Frontend
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnLayout, deleteColumnLayout, listColumnLayouts, setDefaultColumnLayout, updateColumnLayout,
} from "./columnLayoutApi.js";
import {
  applyHidden, applyOrder, defaultHiddenKeys, defaultOrderKeys, hiddenFromSaved, moveKey, orderFromSaved, pickableColumns, toggleHidden,
} from "./columnLayoutHelpers.js";

// A user keeps at most this many personal layouts per page (the backend enforces the same limit).
export const MAX_USER_LAYOUTS = 3;

export function useColumnLayouts(reportCode, allColumns, onMessage) {
  const queryClient = useQueryClient();
  // Set once the user changes something by hand; holds the working copy (hidden set + full pickable order).
  const [touched, setTouched] = useState(null);
  const [activeLayoutId, setActiveLayoutId] = useState("");
  const queryKey = useMemo(() => ["column-layouts", reportCode], [reportCode]);
  const layoutsQ = useQuery({
    queryKey,
    queryFn: () => listColumnLayouts(reportCode),
    select: (result) => ({
      layouts: Array.isArray(result?.data) ? result.data : [],
      defaultLayoutId: result?.default_layout_id ?? "",
    }),
    staleTime: 60_000,
  });
  const layouts = useMemo(() => layoutsQ.data?.layouts ?? [], [layoutsQ.data]);
  const defaultLayoutId = layoutsQ.data?.defaultLayoutId ?? "";

  // The layout in force: the one picked, else the user's default.
  const baseLayout = useMemo(
    () => layouts.find((l) => l.id === (activeLayoutId || defaultLayoutId)) ?? null,
    [layouts, activeLayoutId, defaultLayoutId],
  );
  const working = useMemo(() => {
    if (touched) return touched;
    if (baseLayout) {
      return { hidden: hiddenFromSaved(baseLayout.visible_columns, allColumns), order: orderFromSaved(baseLayout.visible_columns, allColumns) };
    }
    return { hidden: defaultHiddenKeys(allColumns), order: defaultOrderKeys(allColumns) };
  }, [touched, baseLayout, allColumns]);

  const columns = useMemo(() => applyOrder(applyHidden(allColumns, working.hidden), working.order), [allColumns, working]);
  // Picker list: every pickable column, in the working order (hidden ones included so they can be ticked back on).
  const pickable = useMemo(() => {
    const byKey = new Map(pickableColumns(allColumns).map((c) => [c.key, c]));
    const ordered = working.order.filter((key) => byKey.has(key)).map((key) => byKey.get(key));
    for (const [key, column] of byKey) if (!working.order.includes(key)) ordered.push(column);
    return ordered;
  }, [allColumns, working]);
  const visibleColumnKeys = useMemo(() => pickable.map((c) => c.key).filter((key) => !working.hidden.has(key)), [pickable, working]);

  const userLayoutCount = useMemo(() => layouts.filter((l) => l.scope === "USER").length, [layouts]);
  const canSaveNew = userLayoutCount < MAX_USER_LAYOUTS;
  const layoutOptions = useMemo(() => layouts.map((l) => ({
    id: l.id,
    label: `${l.scope === "GLOBAL" ? "Global" : "My"} — ${l.layout_name}`,
    scope: l.scope,
    visible_columns: l.visible_columns,
  })), [layouts]);

  const toggleColumn = useCallback((key) => {
    setTouched({ hidden: toggleHidden(working.hidden, key), order: working.order });
  }, [working]);
  const moveColumn = useCallback((key, delta) => {
    setTouched({ hidden: working.hidden, order: moveKey(working.order, working.hidden, key, delta) });
  }, [working]);
  const selectLayout = useCallback((id) => { setTouched(null); setActiveLayoutId(id); }, []);
  const resetColumns = useCallback(() => {
    setTouched({ hidden: defaultHiddenKeys(allColumns), order: defaultOrderKeys(allColumns) });
    setActiveLayoutId("");
  }, [allColumns]);

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey }), [queryClient, queryKey]);

  const saveCurrentAs = useCallback(async () => {
    if (!canSaveNew) {
      onMessage?.(`You can keep at most ${MAX_USER_LAYOUTS} layouts for this page. Delete one, or use Save Changes to update an existing layout.`, "error");
      return;
    }
    const layoutName = window.prompt("Layout name");
    if (!layoutName || !layoutName.trim()) return;
    try {
      const saved = await createColumnLayout({ report_code: reportCode, scope: "USER", layout_name: layoutName.trim(), visible_columns: visibleColumnKeys });
      await refresh();
      const id = saved?.data?.id ?? saved?.id ?? "";
      if (id) selectLayout(id);
      onMessage?.(`Layout "${layoutName.trim()}" saved.`, "success");
    } catch (error) {
      onMessage?.(error instanceof Error ? error.message : "REPORT_LAYOUT_CREATE_FAILED", "error");
    }
  }, [reportCode, visibleColumnKeys, refresh, onMessage, selectLayout, canSaveNew]);

  // Overwrite the layout being edited with the current visible columns + order.
  const updateCurrent = useCallback(async () => {
    const id = baseLayout?.id;
    if (!id) { onMessage?.("Pick a saved layout first, or use Save Current As.", "error"); return; }
    try {
      await updateColumnLayout(id, { visible_columns: visibleColumnKeys });
      await refresh();
      setActiveLayoutId(id);
      setTouched(null);
      onMessage?.(`Layout "${baseLayout.layout_name}" updated.`, "success");
    } catch (error) {
      onMessage?.(error instanceof Error ? error.message : "REPORT_LAYOUT_UPDATE_FAILED", "error");
    }
  }, [baseLayout, visibleColumnKeys, refresh, onMessage]);

  const renameCurrent = useCallback(async () => {
    const id = baseLayout?.id;
    if (!id) { onMessage?.("Pick a saved layout first.", "error"); return; }
    const layoutName = window.prompt("Layout name", baseLayout.layout_name);
    if (!layoutName || !layoutName.trim() || layoutName.trim() === baseLayout.layout_name) return;
    try {
      await updateColumnLayout(id, { layout_name: layoutName.trim() });
      await refresh();
      onMessage?.(`Layout renamed to "${layoutName.trim()}".`, "success");
    } catch (error) {
      onMessage?.(error instanceof Error ? error.message : "REPORT_LAYOUT_UPDATE_FAILED", "error");
    }
  }, [baseLayout, refresh, onMessage]);

  const setDefault = useCallback(async () => {
    const id = baseLayout?.id;
    if (!id) { onMessage?.("Select a saved layout first.", "error"); return; }
    try {
      await setDefaultColumnLayout(id);
      await refresh();
      onMessage?.("Default layout updated.", "success");
    } catch (error) {
      onMessage?.(error instanceof Error ? error.message : "REPORT_LAYOUT_DEFAULT_SET_FAILED", "error");
    }
  }, [baseLayout, refresh, onMessage]);

  const removeLayout = useCallback(async (id) => {
    if (!id || !window.confirm("Delete this saved layout?")) return;
    try {
      await deleteColumnLayout(id);
      await refresh();
      if (id === activeLayoutId) { setActiveLayoutId(""); setTouched(null); }
      onMessage?.("Layout deleted.", "success");
    } catch (error) {
      onMessage?.(error instanceof Error ? error.message : "REPORT_LAYOUT_DELETE_FAILED", "error");
    }
  }, [activeLayoutId, refresh, onMessage]);

  const isDirty = Boolean(touched);
  return {
    columns, pickable, visibleColumnKeys, layoutOptions, defaultLayoutId,
    activeLayoutId: baseLayout?.id ?? "",
    activeLayoutName: baseLayout ? `${baseLayout.layout_name}${isDirty ? " (changed)" : ""}` : "",
    isDirty, canSaveNew, userLayoutCount, maxLayouts: MAX_USER_LAYOUTS,
    toggleColumn, moveColumn, selectLayout, resetColumns, saveCurrentAs, renameCurrent, updateCurrent, setDefault, removeLayout,
  };
}

/** Spread onto <ErpColumnVisibilityDrawer/> together with visible / onClose / title. */
export function layoutDrawerProps(layout) {
  return {
    columns: layout.pickable,
    visibleColumnKeys: layout.visibleColumnKeys,
    layoutOptions: layout.layoutOptions,
    activeLayoutId: layout.activeLayoutId,
    defaultLayoutId: layout.defaultLayoutId,
    onSelectLayout: layout.selectLayout,
    onSaveCurrentAs: layout.saveCurrentAs,
    onSetDefaultLayout: layout.setDefault,
    onDeleteLayout: layout.removeLayout,
    onToggleColumn: layout.toggleColumn,
    onMoveColumn: layout.moveColumn,
    onUpdateCurrent: layout.updateCurrent,
    onRenameLayout: layout.renameCurrent,
    canSaveNew: layout.canSaveNew,
    layoutLimitText: `My layouts: ${layout.userLayoutCount} of ${layout.maxLayouts} used`,
    isDirty: layout.isDirty,
    onResetColumns: layout.resetColumns,
  };
}
