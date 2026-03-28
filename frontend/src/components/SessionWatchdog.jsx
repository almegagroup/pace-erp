import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { isPublicRoute } from "../router/publicRoutes.js";
import {
  SESSION_WARNING_ACK_QUERY,
  getSessionWatchdogSnapshot,
  hardLogout,
  recordBackendActivity,
  recordUserActivity,
  resetWarningState,
  setProtectedRouteActive,
  showWarning,
} from "../store/sessionWarning.js";
import {
  releaseClusterWindowOwnership,
  requestCloseCurrentClusterWindow,
} from "../store/sessionCluster.js";

const IDLE_WARNING_MS = 10 * 60 * 1000;
const IDLE_LOGOUT_MS = 30 * 60 * 1000;
const PASSIVE_CHECK_MS = 60 * 1000;
const FAST_RECHECK_MS = 5 * 1000;

function isProtectedPath(pathname) {
  return !isPublicRoute(pathname) && pathname !== "/auth/callback";
}

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function passiveSessionCheck() {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/me?session_mode=passive`,
    { credentials: "include" }
  );

  return {
    ok: response.ok,
    json: await readJsonSafe(response),
  };
}

async function refreshActiveSession() {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/me?${SESSION_WARNING_ACK_QUERY}`,
    {
      credentials: "include",
    }
  );

  const json = await readJsonSafe(response);

  if (!response.ok || json?.action === "LOGOUT") {
    hardLogout();
    return;
  }

  recordBackendActivity();
}

export default function SessionWatchdog() {
  const location = useLocation();
  const probeInFlightRef = useRef(false);
  const lastPassiveProbeAtRef = useRef(0);

  useEffect(() => {
    const protectedRoute = isProtectedPath(location.pathname);

    setProtectedRouteActive(protectedRoute);

    if (protectedRoute) {
      recordUserActivity();
      recordBackendActivity();
    }

    return () => {
      if (protectedRoute) {
        setProtectedRouteActive(false);
      }
    };
  }, [location.pathname]);

  useEffect(() => {
    if (!isProtectedPath(location.pathname)) return undefined;

    const activityEvents = [
      "mousedown",
      "mousemove",
      "keydown",
      "scroll",
      "touchstart",
      "pointerdown",
      "click",
    ];

    const markActive = () => {
      recordUserActivity();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        recordUserActivity();
      }
    };

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, markActive, true);
    });
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, markActive, true);
      });
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [location.pathname]);

  useEffect(() => {
    if (!isProtectedPath(location.pathname)) return undefined;

    let cancelled = false;

    const tick = async () => {
      if (cancelled || probeInFlightRef.current) return;

      const snapshot = getSessionWatchdogSnapshot();
      const now = Date.now();
      const frontendIdleMs = now - snapshot.frontendActivityAt;
      const backendIdleMs = now - snapshot.backendActivityAt;
      const idleWarningReached =
        frontendIdleMs >= IDLE_WARNING_MS && backendIdleMs >= IDLE_WARNING_MS;
      const idleExpiryReached =
        frontendIdleMs >= IDLE_LOGOUT_MS && backendIdleMs >= IDLE_LOGOUT_MS;
      const needsFastProbe =
        snapshot.visible || idleWarningReached || idleExpiryReached;
      const cooldownMs = needsFastProbe ? FAST_RECHECK_MS : PASSIVE_CHECK_MS;

      if (now - lastPassiveProbeAtRef.current < cooldownMs) return;

      probeInFlightRef.current = true;
      lastPassiveProbeAtRef.current = now;

      try {
        const result = await passiveSessionCheck();
        if (cancelled) return;

        const payload = result.json;

        if (!result.ok || payload?.action === "LOGOUT") {
          hardLogout();
          return;
        }

        const warningType = payload?.warning?.type;

        if (warningType === "ABSOLUTE_WARNING") {
          showWarning("ABSOLUTE_WARNING", refreshActiveSession);
          return;
        }

        if (warningType === "IDLE_WARNING" && idleWarningReached) {
          showWarning("IDLE_WARNING", refreshActiveSession);
          return;
        }

        if (snapshot.visible && !warningType) {
          resetWarningState();
        }
      } catch {
        // Silent retry; transient probe failures should not break the UI.
      } finally {
        probeInFlightRef.current = false;
      }
    };

    void tick();

    const intervalId = window.setInterval(() => {
      void tick();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [location.pathname]);

  useEffect(() => {
    if (!isProtectedPath(location.pathname)) return undefined;

    const handlePageUnload = () => {
      releaseClusterWindowOwnership();
      void requestCloseCurrentClusterWindow({ keepalive: true });
    };

    window.addEventListener("pagehide", handlePageUnload);
    window.addEventListener("beforeunload", handlePageUnload);

    return () => {
      window.removeEventListener("pagehide", handlePageUnload);
      window.removeEventListener("beforeunload", handlePageUnload);
    };
  }, [location.pathname]);

  return null;
}
