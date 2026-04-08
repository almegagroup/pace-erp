import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMenu } from "../context/useMenu.js";
import { isPublicRoute } from "../router/publicRoutes.js";
import { resetToScreen } from "../navigation/screenStackEngine.js";
import {
  claimClusterWindowOwnership,
  clearClusterAdmission,
  getClusterAdmission,
  requestSessionClusterAdmission,
} from "../store/sessionCluster.js";
import { getShellSnapshotAgeMs } from "../store/shellSnapshotCache.js";

const SESSION_IDENTITY_RECHECK_AFTER_HIDDEN_MS = 5 * 60 * 1000;
const SHELL_SNAPSHOT_BACKGROUND_REFRESH_MS = 3 * 60 * 1000;

export default function AuthBootstrap({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const bootStateRef = useRef({
    bootKey: null,
    inFlight: false,
  });
  const identityValidationRef = useRef({
    inFlight: false,
    lastStartedAt: 0,
  });
  const hiddenAtRef = useRef(0);
  const backgroundSyncRef = useRef({
    inFlight: false,
    lastStartedAt: 0,
  });

  const {
    menu,
    shellProfile,
    snapshotUpdatedAt,
    startMenuLoading,
    setMenuSnapshot,
    setShellProfile,
    setRuntimeContext,
    clearMenuSnapshot,
  } = useMenu();

  useEffect(() => {
    if (isPublicRoute(location.pathname) || location.pathname === "/auth/callback") {
      return undefined;
    }

    if (!Array.isArray(menu) || menu.length === 0) {
      return undefined;
    }

    let disposed = false;

    async function validateActiveSessionIdentity() {
      const now = Date.now();

      if (
        identityValidationRef.current.inFlight ||
        now - identityValidationRef.current.lastStartedAt < 1200
      ) {
        return;
      }

      identityValidationRef.current = {
        inFlight: true,
        lastStartedAt: now,
      };

      try {
        const response = await fetch(`${import.meta.env.VITE_API_BASE}/api/me/profile`, {
          credentials: "include",
          erpUiMode: "silent",
          erpUiLabel: "Validating session identity",
        });

        const json = await response.json().catch(() => null);

        if (disposed) {
          return;
        }

        if (!response.ok || !json?.ok || !json?.data?.user_code) {
          clearMenuSnapshot();
          clearClusterAdmission();
          navigate("/login", { replace: true });
          return;
        }

        const liveUserCode = json.data.user_code ?? "";
        const liveRoleCode = json.data.role_code ?? "";
        const cachedUserCode = shellProfile?.userCode ?? "";
        const cachedRoleCode = shellProfile?.roleCode ?? "";

        if (
          (cachedUserCode && liveUserCode !== cachedUserCode) ||
          (cachedRoleCode && liveRoleCode !== cachedRoleCode)
        ) {
          clearMenuSnapshot();
          clearClusterAdmission();
          navigate("/app", { replace: true });
        }
      } catch {
        if (disposed) {
          return;
        }

        clearMenuSnapshot();
        clearClusterAdmission();
        navigate("/login", { replace: true });
      } finally {
        identityValidationRef.current = {
          inFlight: false,
          lastStartedAt: Date.now(),
        };
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }

      if (document.visibilityState !== "visible") {
        return;
      }

      const hiddenDuration =
        hiddenAtRef.current > 0 ? Date.now() - hiddenAtRef.current : 0;

      hiddenAtRef.current = 0;

      if (hiddenDuration < SESSION_IDENTITY_RECHECK_AFTER_HIDDEN_MS) {
        return;
      }

      void validateActiveSessionIdentity();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    clearMenuSnapshot,
    location.pathname,
    menu,
    navigate,
    shellProfile?.roleCode,
    shellProfile?.userCode,
  ]);

  useEffect(() => {
    let alive = true;

    async function fetchShellSnapshot({ mode = "silent" } = {}) {
      const [profileRes, contextRes, menuRes] = await Promise.all([
        fetch(`${import.meta.env.VITE_API_BASE}/api/me/profile`, {
          credentials: "include",
          erpUiMode: mode,
          erpUiLabel: "Loading workspace shell",
        }),
        fetch(`${import.meta.env.VITE_API_BASE}/api/me/context`, {
          credentials: "include",
          erpUiMode: mode,
          erpUiLabel: "Loading workspace shell",
        }),
        fetch(`${import.meta.env.VITE_API_BASE}/api/me/menu`, {
          credentials: "include",
          erpUiMode: mode,
          erpUiLabel: "Loading workspace shell",
        }),
      ]);

      if (!profileRes.ok || !contextRes.ok || !menuRes.ok) {
        throw new Error("AUTH_BOOTSTRAP_FETCH_FAILED");
      }

      const [profileData, contextData, menuData] = await Promise.all([
        profileRes.json(),
        contextRes.json(),
        menuRes.json(),
      ]);

      return {
        shellProfile: {
          userCode: profileData?.data?.user_code ?? "",
          roleCode: profileData?.data?.role_code ?? "",
          tagline: "Process Automation & Control Environment",
        },
        runtimeContext: {
          isAdmin: contextData?.data?.is_admin === true,
          selectedCompanyId: contextData?.data?.selected_company_id ?? "",
          currentCompany: contextData?.data?.current_company ?? null,
          availableCompanies: contextData?.data?.available_companies ?? [],
          availableWorkContexts: contextData?.data?.available_work_contexts ?? [],
          selectedWorkContext: contextData?.data?.selected_work_context ?? null,
        },
        menu: menuData?.data?.menu ?? [],
      };
    }

    async function refreshShellInBackground() {
      const now = Date.now();

      if (
        backgroundSyncRef.current.inFlight ||
        now - backgroundSyncRef.current.lastStartedAt < 15000
      ) {
        return;
      }

      backgroundSyncRef.current = {
        inFlight: true,
        lastStartedAt: now,
      };

      try {
        const snapshot = await fetchShellSnapshot({ mode: "silent" });

        if (!alive) {
          return;
        }

        if (!snapshot.shellProfile.userCode || !snapshot.shellProfile.roleCode) {
          throw new Error("AUTH_BOOTSTRAP_INVALID_SHELL");
        }

        setShellProfile(snapshot.shellProfile);
        setRuntimeContext(snapshot.runtimeContext);
        setMenuSnapshot(snapshot.menu);
      } catch (error) {
        console.warn("BACKGROUND_SHELL_REFRESH_SKIPPED", error);
      } finally {
        backgroundSyncRef.current = {
          inFlight: false,
          lastStartedAt: Date.now(),
        };
      }
    }

    async function ensureWindowAdmission(joinToken) {
      const existingAdmission = getClusterAdmission();
      const shouldRequestAdmission = Boolean(joinToken) || !existingAdmission;

      if (shouldRequestAdmission) {
        const clusterAdmission = await requestSessionClusterAdmission(joinToken, {
          uiMode: "silent",
          uiLabel: "Loading workspace shell",
        });

        if (!clusterAdmission.ok) {
          clearMenuSnapshot();
          clearClusterAdmission();
          navigate("/login", { replace: true });
          return false;
        }
      }

      if (!claimClusterWindowOwnership()) {
        clearMenuSnapshot();
        clearClusterAdmission();
        navigate("/login", { replace: true });
        return false;
      }

      return true;
    }

    async function boot() {
      const pathname = location.pathname;
      const currentUrl = new URL(globalThis.location.href);
      const joinToken = currentUrl.searchParams.get("cluster_join");
      const bootKey = `${pathname}|${joinToken ?? ""}`;

      if (isPublicRoute(pathname) || pathname === "/auth/callback") {
        bootStateRef.current = {
          bootKey: null,
          inFlight: false,
        };
        clearClusterAdmission();
        return;
      }

      if (Array.isArray(menu) && menu.length > 0) {
        const admissionReady = await ensureWindowAdmission(joinToken);

        if (!admissionReady) {
          return;
        }

        if (joinToken) {
          currentUrl.searchParams.delete("cluster_join");

          try {
            globalThis.history.replaceState(
              null,
              "",
              `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`
            );
          } catch {
            // History cleanup is best-effort only.
          }
        }

        bootStateRef.current = {
          bootKey: pathname,
          inFlight: false,
        };

        if (
          getShellSnapshotAgeMs({ cachedAt: snapshotUpdatedAt }) >=
          SHELL_SNAPSHOT_BACKGROUND_REFRESH_MS
        ) {
          void refreshShellInBackground();
        }

        return;
      }

      if (
        bootStateRef.current.inFlight &&
        bootStateRef.current.bootKey === bootKey
      ) {
        return;
      }

      bootStateRef.current = {
        bootKey,
        inFlight: true,
      };

      try {
        startMenuLoading();

        const meRes = await fetch(`${import.meta.env.VITE_API_BASE}/api/me`, {
          credentials: "include",
          erpUiMode: "silent",
          erpUiLabel: "Loading workspace shell",
        });

        if (!meRes.ok) {
          clearMenuSnapshot();
          clearClusterAdmission();
          navigate("/login", { replace: true });
          return;
        }

        const admissionReady = await ensureWindowAdmission(joinToken);

        if (!admissionReady) {
          return;
        }

        if (joinToken) {
          currentUrl.searchParams.delete("cluster_join");

          try {
            globalThis.history.replaceState(
              null,
              "",
              `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`
            );
          } catch {
            // History cleanup is best-effort only.
          }
        }

        const snapshot = await fetchShellSnapshot({ mode: "silent" });

        if (!alive) {
          return;
        }

        setShellProfile(snapshot.shellProfile);
        setRuntimeContext(snapshot.runtimeContext);

        const menuData = snapshot.menu;
        setMenuSnapshot(menuData);

        bootStateRef.current = {
          bootKey: pathname,
          inFlight: false,
        };

        if (pathname === "/app") {
          const sa = menuData.find((item) => item.menu_code === "SA_HOME");
          const ga = menuData.find((item) => item.menu_code === "GA_HOME");

          if (sa) {
            resetToScreen("SA_HOME");
            return;
          }

          if (ga) {
            resetToScreen("GA_HOME");
            return;
          }

          resetToScreen("DASHBOARD_HOME");
        }
      } catch (error) {
        bootStateRef.current = {
          bootKey: null,
          inFlight: false,
        };

        console.error("AUTH_BOOTSTRAP_FAILED", error);
        clearMenuSnapshot();
        clearClusterAdmission();
        navigate("/login", { replace: true });
      } finally {
        if (alive && bootStateRef.current.bootKey === bootKey) {
          bootStateRef.current = {
            bootKey: pathname,
            inFlight: false,
          };
        }
      }
    }

    void boot();

    return () => {
      alive = false;
    };
  }, [
    clearMenuSnapshot,
    location.pathname,
    menu,
    navigate,
    shellProfile,
    snapshotUpdatedAt,
    setMenuSnapshot,
    setShellProfile,
    setRuntimeContext,
    startMenuLoading,
  ]);

  return children;
}
