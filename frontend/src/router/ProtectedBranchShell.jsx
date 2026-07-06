import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useMenu } from "../context/useMenu.js";
import {
  getActiveScreen,
  resetToScreen,
} from "../navigation/screenStackEngine.js";
import { hardLogout } from "../store/sessionWarning.js";
import { startClusterWindowOwnershipGuard } from "../store/sessionCluster.js";
import { isRouteAllowed } from "./routeIndex.js";

export default function ProtectedBranchShell({
  rootScreenCode,
  routePrefix,
}) {
  const location = useLocation();
  const { allowedRoutes, loading } = useMenu();

  useEffect(() => {
    if (loading || allowedRoutes.size === 0) return;

    if (!isRouteAllowed(allowedRoutes, location.pathname)) {
      resetToScreen(rootScreenCode);
      return;
    }

    const active = getActiveScreen();
    if (!active?.route?.startsWith(routePrefix)) {
      resetToScreen(rootScreenCode);
    }
  }, [allowedRoutes, loading, location.pathname, rootScreenCode, routePrefix]);

  useEffect(() => {
    if (loading || allowedRoutes.size === 0) return undefined;
    if (!isRouteAllowed(allowedRoutes, location.pathname)) return undefined;

    return startClusterWindowOwnershipGuard(() => {
      hardLogout({ broadcast: false });
    });
  }, [allowedRoutes, loading, location.pathname]);

  if (loading) return null;
  if (allowedRoutes.size === 0) return null;
  if (!isRouteAllowed(allowedRoutes, location.pathname)) return null;

  return <Outlet />;
}
