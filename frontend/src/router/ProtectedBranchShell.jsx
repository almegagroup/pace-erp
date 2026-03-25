import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useMenu } from "../context/useMenu.js";
import {
  getActiveScreen,
  resetToScreen,
} from "../navigation/screenStackEngine.js";

export default function ProtectedBranchShell({
  rootScreenCode,
  routePrefix,
}) {
  const location = useLocation();
  const { allowedRoutes, loading } = useMenu();

  useEffect(() => {
    if (loading || allowedRoutes.size === 0) return;

    if (!allowedRoutes.has(location.pathname)) {
      resetToScreen(rootScreenCode);
      return;
    }

    const active = getActiveScreen();
    if (!active?.route?.startsWith(routePrefix)) {
      resetToScreen(rootScreenCode);
    }
  }, [allowedRoutes, loading, location.pathname, rootScreenCode, routePrefix]);

  if (loading) return null;
  if (allowedRoutes.size === 0) return null;
  if (!allowedRoutes.has(location.pathname)) return null;

  return <Outlet />;
}
