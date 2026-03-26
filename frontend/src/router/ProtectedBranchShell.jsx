import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useMenu } from "../context/useMenu.js";
import {
  getActiveScreen,
  resetToScreen,
} from "../navigation/screenStackEngine.js";
import { hardLogout } from "../store/sessionWarning.js";
import {
  claimSingleTabOwnership,
  getCurrentTabId,
  isOwnedByCurrentTab,
  subscribeSingleTabOwnership,
} from "../store/singleTabSession.js";

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

    let loggedOut = false;

    const enforceOwnership = () => {
      if (loggedOut) return;

      if (!isOwnedByCurrentTab()) {
        loggedOut = true;
        hardLogout();
      }
    };

    claimSingleTabOwnership();

    const unsubscribe = subscribeSingleTabOwnership((owner) => {
      if (!owner) return;
      if (owner.tabId === getCurrentTabId()) return;
      enforceOwnership();
    });

    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (loggedOut) return;
      claimSingleTabOwnership();
    };

    window.addEventListener("focus", handleVisibility);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      unsubscribe();
      window.removeEventListener("focus", handleVisibility);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [allowedRoutes, loading, location.pathname]);

  if (loading) return null;
  if (allowedRoutes.size === 0) return null;
  if (!allowedRoutes.has(location.pathname)) return null;

  return <Outlet />;
}
