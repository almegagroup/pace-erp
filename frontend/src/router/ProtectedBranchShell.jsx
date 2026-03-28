import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useMenu } from "../context/useMenu.js";
import {
  getActiveScreen,
  resetToScreen,
} from "../navigation/screenStackEngine.js";
import { hardLogout } from "../store/sessionWarning.js";
import { startClusterWindowOwnershipGuard } from "../store/sessionCluster.js";

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

  useEffect(() => {
    if (loading || allowedRoutes.size === 0) return undefined;
    if (!allowedRoutes.has(location.pathname)) return undefined;

    return startClusterWindowOwnershipGuard(() => {
      hardLogout({ broadcast: false });
    });
  }, [allowedRoutes, loading, location.pathname]);

  if (loading) return null;
  if (allowedRoutes.size === 0) return null;
  if (!allowedRoutes.has(location.pathname)) return null;

  return <Outlet />;
}
