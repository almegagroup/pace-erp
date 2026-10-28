/*
 * File-Path: frontend/src/pages/dashboard/procurement/planning/usePo22ColumnLayouts.js
 * Purpose: PO22 column picker state (owner 2026-10-28) — hidden columns, named layouts per user, default layout.
 *          The grid and the Excel both read `columns` from here, so a downloaded file always matches the screen.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createMtsReportLayout, deleteMtsReportLayout, listMtsReportLayouts, setDefaultMtsReportLayout } from "../procurementApi.js";
import { applyHidden, hiddenFromSaved, pickableColumns, toggleHidden, visibleKeys } from "./mtsColumnLayout.js";

export function usePo22ColumnLayouts(reportCode, allColumns, onMessage) {
  const queryClient = useQueryClient();
  const [touchedHidden, setTouchedHidden] = useState(null); // Set once the user toggles by hand
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

  const hidden = useMemo(() => {
    if (touchedHidden) return touchedHidden;
    const chosen = layouts.find((l) => l.id === (activeLayoutId || defaultLayoutId));
    return chosen ? hiddenFromSaved(chosen.visible_columns, allColumns) : new Set();
  }, [touchedHidden, layouts, activeLayoutId, defaultLayoutId, allColumns]);

  const columns = useMemo(() => applyHidden(allColumns, hidden), [allColumns, hidden]);
  const pickable = useMemo(() => pickableColumns(allColumns), [allColumns]);
  const visibleColumnKeys = useMemo(() => visibleKeys(allColumns, hidden), [allColumns, hidden]);
  const activeLayout = layouts.find((l) => l.id === (activeLayoutId || (touchedHidden ? "" : defaultLayoutId))) ?? null;

  const layoutOptions = useMemo(() => layouts.map((l) => ({
    id: l.id,
    label: `${l.scope === "GLOBAL" ? "Global" : "User"} — ${l.layout_name}`,
    scope: l.scope,
    visible_columns: l.visible_columns,
  })), [layouts]);

  const toggleColumn = useCallback((key) => {
    setActiveLayoutId("");
    setTouchedHidden(toggleHidden(hidden, key));
  }, [hidden]);
  const selectLayout = useCallback((id) => { setTouchedHidden(null); setActiveLayoutId(id); }, []);
  const resetColumns = useCallback(() => { setTouchedHidden(new Set()); setActiveLayoutId(""); }, []);

  const saveCurrentAs = useCallback(async () => {
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
  }, [reportCode, visibleColumnKeys, queryClient, onMessage, selectLayout]);

  const setDefault = useCallback(async () => {
    const id = activeLayoutId || (touchedHidden ? "" : defaultLayoutId);
    if (!id) { onMessage?.("Select a saved layout first.", "error"); return; }
    try {
      await setDefaultMtsReportLayout(id);
      await queryClient.invalidateQueries({ queryKey });
      onMessage?.("Default layout updated.", "success");
    } catch (error) {
      onMessage?.(error instanceof Error ? error.message : "REPORT_LAYOUT_DEFAULT_SET_FAILED", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayoutId, touchedHidden, defaultLayoutId, queryClient, onMessage]);

  const removeLayout = useCallback(async (id) => {
    if (!id || !window.confirm("Delete this saved layout?")) return;
    try {
      await deleteMtsReportLayout(id);
      await queryClient.invalidateQueries({ queryKey });
      if (id === activeLayoutId) setActiveLayoutId("");
      onMessage?.("Layout deleted.", "success");
    } catch (error) {
      onMessage?.(error instanceof Error ? error.message : "REPORT_LAYOUT_DELETE_FAILED", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayoutId, queryClient, onMessage]);

  return {
    columns, pickable, visibleColumnKeys, layoutOptions, defaultLayoutId,
    activeLayoutId: activeLayout && !touchedHidden ? activeLayout.id : "",
    activeLayoutName: activeLayout && !touchedHidden ? activeLayout.layout_name : "",
    toggleColumn, selectLayout, resetColumns, saveCurrentAs, setDefault, removeLayout,
  };
}
