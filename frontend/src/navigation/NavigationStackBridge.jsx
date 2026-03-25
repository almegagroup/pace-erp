import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isPublicRoute } from "../router/publicRoutes.js";
import {
  getActiveScreen,
  subscribeToStack,
} from "./screenStackEngine.js";

export default function NavigationStackBridge() {
  const location = useLocation();
  const navigate = useNavigate();
  const pathnameRef = useRef(location.pathname);

  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    return subscribeToStack((_stack, meta) => {
      const targetRoute = meta.activeScreen?.route;
      if (!targetRoute) return;

      if (pathnameRef.current === targetRoute) return;

      navigate(targetRoute, {
        replace: meta.action !== "PUSH",
      });
    });
  }, [navigate]);

  useEffect(() => {
    if (isPublicRoute(location.pathname) || location.pathname === "/auth/callback") {
      return;
    }

    const active = getActiveScreen();
    if (!active?.route) return;

    if (active.route !== location.pathname) {
      navigate(active.route, { replace: true });
    }
  }, [location.pathname, navigate]);

  return null;
}
