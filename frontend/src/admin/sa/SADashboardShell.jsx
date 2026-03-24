/*
 * File-ID: 9.1
 * File-Path: frontend/src/admin/sa/SADashboardShell.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin dashboard entry shell consuming Screen Stack and Menu Snapshot
 * Authority: Frontend
 */
import { Outlet } from "react-router-dom";
import { useEffect } from "react";
import { replaceStack } from "../../navigation/screenStackEngine.js";
import { assertAdminEntry } from "../adminEntryGuard.js";

export default function SADashboardShell() {

  console.log("🔥 SA Dashboard Shell ACTIVE");

  useEffect(() => {
    assertAdminEntry();
  }, []);

  useEffect(() => {
    replaceStack([
      {
        screen_code: "SA_HOME",
        route: "/sa/home",
        type: "full",
        keepAlive: true,
      },
    ]);
  }, []);

  console.log("➡️ About to render MenuShell from SA Shell");

 return (
  <>
    {console.log("📦 SA Shell rendering Outlet")}
    <Outlet />
  </>
);
}
