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
import MenuShell from "../../layout/MenuShell.jsx";
import { replaceStack } from "../../navigation/screenStackEngine.js";
import { assertAdminEntry } from "../adminEntryGuard.js";

export default function SADashboardShell() {

  console.log("🔥 SA Dashboard Shell ACTIVE");
  // --- HARD ENTRY ASSERTION ---
  // Ensures this shell is entered only via valid admin path
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

return (
  <MenuShell
    universe="ADMIN"
    headerTitle="Super Admin"
    rootScreenCode="SA_HOME"
  >
    <Outlet /> {/* 🔥 THIS IS MUST */}
  </MenuShell>
);
}
