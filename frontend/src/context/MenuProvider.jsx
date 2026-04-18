/*
 * File-ID: 7.6C
 * File-Path: frontend/src/context/MenuProvider.jsx
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Provide menu snapshot and route authority state
 * Authority: Frontend
 */

import { useState, useCallback, useEffect } from "react";
import { MenuContext } from "./MenuContext.js";
import { buildRouteIndex } from "../router/routeIndex.js";
import {
  buildShellSnapshot,
  clearShellSnapshotCache,
  EMPTY_RUNTIME_CONTEXT,
  EMPTY_SHELL_PROFILE,
  readShellSnapshotCache,
  writeShellSnapshotCache,
} from "../store/shellSnapshotCache.js";

export function MenuProvider({ children }) {
  const cachedSnapshot = readShellSnapshotCache();
  const [menu, setMenu] = useState(() => cachedSnapshot?.menu ?? []);
  const [allowedRoutes, setAllowedRoutes] = useState(() =>
    cachedSnapshot?.menu?.length > 0
      ? buildRouteIndex(cachedSnapshot.menu)
      : new Set()
  );
  const [loading, setLoading] = useState(() => !cachedSnapshot);
  const [shellProfile, setShellProfileState] = useState(
    () => cachedSnapshot?.shellProfile ?? EMPTY_SHELL_PROFILE
  );
  const [runtimeContext, setRuntimeContextState] = useState(
    () => cachedSnapshot?.runtimeContext ?? EMPTY_RUNTIME_CONTEXT
  );
  const [snapshotUpdatedAt, setSnapshotUpdatedAt] = useState(
    () => cachedSnapshot?.cachedAt ?? 0
  );

  const startMenuLoading = useCallback(() => {
    setLoading(true);
  }, []);

  const clearMenuSnapshot = useCallback(() => {
    setMenu([]);
    setAllowedRoutes(new Set());
    setShellProfileState(EMPTY_SHELL_PROFILE);
    setRuntimeContextState(EMPTY_RUNTIME_CONTEXT);
    setSnapshotUpdatedAt(0);
    clearShellSnapshotCache();
    setLoading(false);
  }, []);

  const setMenuSnapshot = useCallback((snapshot) => {
    if (!Array.isArray(snapshot)) {
      console.error("Invalid menu snapshot:", snapshot);
      setMenu([]);
      setAllowedRoutes(new Set());
      setLoading(false);
      return;
    }

    setMenu(snapshot);
    setAllowedRoutes(buildRouteIndex(snapshot));
    setSnapshotUpdatedAt(Date.now());
    setLoading(false);
  }, []);

  const setShellProfile = useCallback((profile) => {
    setShellProfileState({
      name: profile?.name ?? "",
      userCode: profile?.userCode ?? "",
      roleCode: profile?.roleCode ?? "",
      tagline: profile?.tagline ?? "Process Automation & Control Environment",
    });
  }, []);

  const setRuntimeContext = useCallback((context) => {
    setRuntimeContextState({
      isAdmin: context?.isAdmin === true,
      selectedCompanyId: context?.selectedCompanyId ?? "",
      currentCompany: context?.currentCompany ?? null,
      availableCompanies: Array.isArray(context?.availableCompanies)
        ? context.availableCompanies
        : [],
      availableWorkContexts: Array.isArray(context?.availableWorkContexts)
        ? context.availableWorkContexts
        : [],
      selectedWorkContext: context?.selectedWorkContext ?? null,
      shellIssueCode: context?.shellIssueCode ?? "",
      shellIssueMessage: context?.shellIssueMessage ?? "",
    });
  }, []);

  useEffect(() => {
    if (
      loading ||
      menu.length === 0 ||
      !shellProfile.userCode ||
      !shellProfile.roleCode
    ) {
      return;
    }

    writeShellSnapshotCache(
      buildShellSnapshot({
        menu,
        shellProfile,
        runtimeContext,
        cachedAt: snapshotUpdatedAt || Date.now(),
      })
    );
  }, [
    loading,
    menu,
    runtimeContext,
    shellProfile,
    snapshotUpdatedAt,
  ]);

  return (
    <MenuContext.Provider
      value={{
        menu,
        allowedRoutes,
        loading,
        shellProfile,
        runtimeContext,
        snapshotUpdatedAt,
        startMenuLoading,
        clearMenuSnapshot,
        setMenuSnapshot,
        setShellProfile,
        setRuntimeContext,
      }}
    >
      {children}
    </MenuContext.Provider>
  );
}
