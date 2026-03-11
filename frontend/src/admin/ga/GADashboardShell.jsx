/*
 * File-ID: 9.1A
 * File-Path: frontend/src/admin/ga/GADashboardShell.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Group Admin dashboard entry shell consuming Screen Stack and Menu Snapshot
 * Authority: Frontend
 */

import { useEffect } from "react";
import MenuShell from "../../layout/MenuShell.jsx";
import { replaceStack } from "../../navigation/screenStackEngine.js";
import { assertAdminEntry } from "../adminEntryGuard.js";

export default function GADashboardShell() {
  useEffect(() => {
  assertAdminEntry();
}, []);

 useEffect(() => {
    replaceStack([
      {
        screen_code: "GA_HOME",
        route: "/ga/home",
        type: "full",
        keepAlive: true,
      },
    ]);
  }, []);

 return (
  <MenuShell
    universe="ADMIN"
    headerTitle="Group Admin"
    rootScreenCode="GA_HOME"
  />
);
}
