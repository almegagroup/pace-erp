/*
 * File-Path: frontend/src/pages/dashboard/procurement/planning/usePo22ColumnLayouts.js
 * Purpose: PO22 column picker state (owner 2026-10-28) — which columns are visible AND in what order, named layouts per user,
 *          a default layout. A layout is the ordered list of its visible column keys. The grid and the Excel both read
 *          `columns` from here, so a downloaded file always matches the screen.
 *          2026-11-05: (1) "Save changes" updates the layout being edited (before, only "Save as new name" existed, so
 *          editing a layout and pressing Done lost the edit); toggling a column no longer drops the selected layout.
 *          (2) Columns can be re-ordered; the order is stored in the layout.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createMtsReportLayout, deleteMtsReportLayout, listMtsReportLayouts, setDefaultMtsReportLayout, updateMtsReportLayout } from "../procurementApi.js";
import {
  applyHidden, applyOrder, defaultOrderKeys, hiddenFromSaved, moveKey, orderFromSaved, pickableColumns, toggleHidden,
} from "./mtsColumnLayout.js";

// A user keeps at most this many personal layouts (the backend enforces the same limit).
export const MAX_USER_LAYOUTS = 3;

export function usePo22ColumnLayouts(reportCode, allColumns, onMessage) {
  const queryClient = useQueryClient();
  // Set once the user changes something by hand; holds the working copy (hidden set + full pickable order).
  const [touched, setTouched] = useState(null);
  const [activeLayoutId, setActiveLayoutId] = useState("");
  const queryKey = ["procurement-mts-report-layouts", reportCode];
  const layoutsQ = useQuery({
    queryKey,
    queryFn: () => listMtsReportLayouts({ report_code: reportCode }),
    select: (result) => ({
      layouts: Array.isArray(result?.data) ? result.data : [],
      defaultLayoutId: result?.default_layout_id ?? "",
    }),
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
    return { hidden: new Set(), order: defaultOrderKeys(allColumns) };
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
    label: `${l.scope === "GLOBAL" ? "Global" : "User"} — ${l.layout_name}`,
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
    setTouched({ hidden: new Set(), order: defaultOrderKeys(allColumns) });
    setActiveLayoutId("");
  }, [allColumns]);

  const saveCurrentAs = useCallback(async () => {
    if (!canSaveNew) {
      onMessage?.(`You can keep at most ${MAX_USER_LAYOUTS} layouts. Delete one, or use Save Changes to update an existing layout.`, "error");
      return;
    }
    const layoutName = window.prompt("Layout name");
    if (!layoutName || !layoutName.trim()) return;
    try {
      const saved = await createMtsReportLayout({ report_code: reportCode, scope: "USER", layout_name: layoutName.trim(), visible_columns: visibleColumnKeys });
      await queryClient.invalidateQueries({ queryKey });
      const id = saved?.data?.id ?? saved?.id ?? "";
      if (id) selectLayout(id);
      onMessage?.(`Layout "${layoutName.trim()}" saved.`, "success");
    } catch (error) {
      onMessage?.(error instanceof Error ? error.message : "REPORT_LAYOUT_CREATE_FAILED", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportCode, visibleColumnKeys, queryClient, onMessage, selectLayout, canSaveNew]);

  // Overwrite the layout being edited with the current visible columns + order.
  const updateCurrent = useCallback(async () => {
    const id = baseLayout?.id;
    if (!id) { onMessage?.("Pick a saved layout first, or use Save Current As.", "error"); return; }
    try {
      await updateMtsReportLayout(id, { visible_columns: visibleColumnKeys });
      await queryClient.invalidateQueries({ queryKey });
      setActiveLayoutId(id);
      setTouched(null);
      onMessage?.(`Layout "${baseLayout.layout_name}" updated.`, "success");
    } catch (error) {
      onMessage?.(error instanceof Error ? error.message : "REPORT_LAYOUT_UPDATE_FAILED", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseLayout, visibleColumnKeys, queryClient, onMessage]);

  const renameCurrent = useCallback(async () => {
    const id = baseLayout?.id;
    if (!id) { onMessage?.("Pick a saved layout first.", "error"); return; }
    const layoutName = window.prompt("Layout name", baseLayout.layout_name);
    if (!layoutName || !layoutName.trim() || layoutName.trim() === baseLayout.layout_name) return;
    try {
      await updateMtsReportLayout(id, { layout_name: layoutName.trim() });
      await queryClient.invalidateQueries({ queryKey });
      onMessage?.(`Layout renamed to "${layoutName.trim()}".`, "success");
    } catch (error) {
      onMessage?.(error instanceof Error ? error.message : "REPORT_LAYOUT_UPDATE_FAILED", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseLayout, queryClient, onMessage]);

  const setDefault = useCallback(async () => {
    const id = baseLayout?.id;
    if (!id) { onMessage?.("Select a saved layout first.", "error"); return; }
    try {
      await setDefaultMtsReportLayout(id);
      await queryClient.invalidateQueries({ queryKey });
      onMessage?.("Default layout updated.", "success");
    } catch (error) {
      onMessage?.(error instanceof Error ? error.message : "REPORT_LAYOUT_DEFAULT_SET_FAILED", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseLayout, queryClient, onMessage]);

  const removeLayout = useCallback(async (id) => {
    if (!id || !window.confirm("Delete this saved layout?")) return;
    try {
      await deleteMtsReportLayout(id);
      await queryClient.invalidateQueries({ queryKey });
      if (id === activeLayoutId) { setActiveLayoutId(""); setTouched(null); }
      onMessage?.("Layout deleted.", "success");
    } catch (error) {
      onMessage?.(error instanceof Error ? error.message : "REPORT_LAYOUT_DELETE_FAILED", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayoutId, queryClient, onMessage]);

  const isDirty = Boolean(touched);
  return {
    columns, pickable, visibleColumnKeys, layoutOptions, defaultLayoutId,
    activeLayoutId: baseLayout?.id ?? "",
    activeLayoutName: baseLayout ? `${baseLayout.layout_name}${isDirty ? " (changed)" : ""}` : "",
    isDirty, canSaveNew, userLayoutCount, maxLayouts: MAX_USER_LAYOUTS,
    toggleColumn, moveColumn, selectLayout, resetColumns, saveCurrentAs, renameCurrent, updateCurrent, setDefault, removeLayout,
  };
}
