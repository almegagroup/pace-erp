import { useEffect } from "react";
import MenuShell from "./MenuShell.jsx";
import { getActiveScreen, resetToScreen } from "../navigation/screenStackEngine.js";

export default function DashboardShell() {
  useEffect(() => {
    const active = getActiveScreen();

    if (!active?.route?.startsWith("/dashboard")) {
      resetToScreen("DASHBOARD_HOME");
    }
  }, []);

  return <MenuShell />;
}
