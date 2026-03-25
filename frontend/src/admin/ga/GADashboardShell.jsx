/*
 * File-ID: 9.1A
 * File-Path: frontend/src/admin/ga/GADashboardShell.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Group Admin dashboard entry shell consuming Screen Stack and Menu Snapshot
 * Authority: Frontend
 */

import { Outlet } from "react-router-dom";
import { useEffect } from "react";
import { getActiveScreen, resetToScreen } from "../../navigation/screenStackEngine.js";
import { assertAdminEntry } from "../adminEntryGuard.js";

export default function GADashboardShell() {
  useEffect(() => {
  assertAdminEntry();
}, []);

 useEffect(() => {
    const active = getActiveScreen();

    if (!active?.route?.startsWith("/ga")) {
      resetToScreen("GA_HOME");
    }
  }, []);

 return <Outlet />;
}
