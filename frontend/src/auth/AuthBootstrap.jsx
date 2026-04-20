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
const BOOTSTRAP_RETRY_DELAYS_MS = [500, 1200, 2400];

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function createTaggedError(code, meta = {}) {
  const error = new Error(code);
  error.code = code;
  error.meta = meta;
  return error;
}

function buildStableRuntimeContext(overrides = {}) {
  return {
    isAdmin: false,
    selectedCompanyId: "",
    currentCompany: null,
    availableCompanies: [],
    availableWorkContexts: [],
    selectedWorkContext: null,
    shellIssueCode: "",
    shellIssueMessage: "",
    ...overrides,
  };
}

function deriveStableBootstrapIssue(error) {
  const upstreamCode = String(error?.meta?.code ?? "").trim();

  if (
    upstreamCode === "CONTEXT_UNRESOLVED" ||
    upstreamCode.startsWith("ME_CONTEXT_")
  ) {
    return {
      code: "CONTEXT_ISSUE",
      message: "Context issue. Re-select your work company or work context.",
    };
  }

  return {
    code: "WORKSPACE_BOOT_FAILED",
    message: "Workspace shell could not be loaded right now.",
  };
}

function isAuthResponseFailure(response, json) {
  if (json?.action === "LOGOUT") {
    return true;
  }

  if (response.status === 401) {
    return true;
  }

  return json?.code === "AUTH_NOT_AUTHENTICATED";
}

function isTransientBootstrapStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function fetchBootstrapEnvelope(path, options = {}) {
  const url = `${import.meta.env.VITE_API_BASE}${path}`;
  let lastError = null;

  for (let attempt = 0; attempt <= BOOTSTRAP_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const json = await response.clone().json().catch(() => null);

      if (response.ok) {
        return { response, json };
      }

      if (isAuthResponseFailure(response, json)) {
        throw createTaggedError("BOOTSTRAP_AUTH_FAILURE", {
          path,
          status: response.status,
          code: json?.code ?? null,
        });
      }

      if (
        isTransientBootstrapStatus(response.status) &&
        attempt < BOOTSTRAP_RETRY_DELAYS_MS.length
      ) {
        await wait(BOOTSTRAP_RETRY_DELAYS_MS[attempt]);
        continue;
      }

      throw createTaggedError("BOOTSTRAP_UPSTREAM_UNAVAILABLE", {
        path,
        status: response.status,
        code: json?.code ?? null,
      });
    } catch (error) {
      if (error?.code === "BOOTSTRAP_AUTH_FAILURE") {
        throw error;
      }

      lastError = error;

      if (attempt >= BOOTSTRAP_RETRY_DELAYS_MS.length) {
        throw createTaggedError("BOOTSTRAP_UPSTREAM_UNAVAILABLE", {
          path,
          cause:
            error instanceof Error
              ? error.message
              : "BOOTSTRAP_UPSTREAM_UNAVAILABLE",
        });
      }

      await wait(BOOTSTRAP_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw lastError ?? createTaggedError("BOOTSTRAP_UPSTREAM_UNAVAILABLE", { path });
}

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
        const { response, json } = await fetchBootstrapEnvelope("/api/me/profile", {
          credentials: "include",
          erpUiMode: "silent",
          erpUiLabel: "Validating session identity",
        });

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
        const liveName = json.data.name ?? "";
        const cachedUserCode = shellProfile?.userCode ?? "";
        const cachedRoleCode = shellProfile?.roleCode ?? "";
        const cachedName = shellProfile?.name ?? "";

        if (
          (cachedUserCode && liveUserCode !== cachedUserCode) ||
          (cachedRoleCode && liveRoleCode !== cachedRoleCode) ||
          (cachedName && liveName !== cachedName)
        ) {
          clearMenuSnapshot();
          clearClusterAdmission();
          navigate("/app", { replace: true });
        }
      } catch (error) {
        if (disposed) {
          return;
        }

        if (error?.code === "BOOTSTRAP_AUTH_FAILURE") {
          clearMenuSnapshot();
          clearClusterAdmission();
          navigate("/login", { replace: true });
          return;
        }

        console.warn("SESSION_IDENTITY_RECHECK_SKIPPED", error);
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
      const menuEnvelope = await fetchBootstrapEnvelope("/api/me/menu", {
        credentials: "include",
        erpUiMode: mode,
        erpUiLabel: "Loading workspace shell",
      });
      const menuData = menuEnvelope.json;

      const menuRows = Array.isArray(menuData?.data?.menu) ? menuData.data.menu : [];

      if (menuRows.length === 0) {
        return {
          shellProfile: {
            name: "",
            userCode: "",
            roleCode: "",
            tagline: "Process Automation & Control Environment",
          },
          runtimeContext: buildStableRuntimeContext({
            shellIssueCode: "NO_ACCESSIBLE_MODULES",
            shellIssueMessage: "No accessible modules in this context.",
          }),
          menu: [],
        };
      }

      const [profileEnvelope, contextEnvelope] = await Promise.all([
        fetchBootstrapEnvelope("/api/me/profile", {
          credentials: "include",
          erpUiMode: mode,
          erpUiLabel: "Loading workspace shell",
        }),
        fetchBootstrapEnvelope("/api/me/context", {
          credentials: "include",
          erpUiMode: mode,
          erpUiLabel: "Loading workspace shell",
        }),
      ]);

      const profileData = profileEnvelope.json;
      const contextData = contextEnvelope.json;

      return {
        shellProfile: {
          name: profileData?.data?.name ?? "",
          userCode: profileData?.data?.user_code ?? "",
          roleCode: profileData?.data?.role_code ?? "",
          tagline: "Process Automation & Control Environment",
        },
        runtimeContext: {
          isAdmin: contextData?.data?.is_admin === true,
          workspaceMode: contextData?.data?.workspace_mode ?? null,
          selectedCompanyId: contextData?.data?.selected_company_id ?? "",
          currentCompany: contextData?.data?.current_company ?? null,
          availableCompanies: contextData?.data?.available_companies ?? [],
          availableWorkContexts: contextData?.data?.available_work_contexts ?? [],
          selectedWorkContext: contextData?.data?.selected_work_context ?? null,
          shellIssueCode: "",
          shellIssueMessage: "",
        },
        menu: menuRows,
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

    async function boot(explicitPathname = location.pathname, explicitBootKey = null) {
      const pathname = explicitPathname;
      const currentUrl = new URL(globalThis.location.href);
      const joinToken = currentUrl.searchParams.get("cluster_join");
      const bootKey = explicitBootKey ?? `${pathname}|${joinToken ?? ""}`;

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

        await fetchBootstrapEnvelope("/api/me", {
          credentials: "include",
          erpUiMode: "silent",
          erpUiLabel: "Loading workspace shell",
        });

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

        if (error?.code === "BOOTSTRAP_AUTH_FAILURE") {
          console.error("AUTH_BOOTSTRAP_AUTH_FAILURE", error);
          clearMenuSnapshot();
          clearClusterAdmission();
          navigate("/login", { replace: true });
          return;
        }

        const stableIssue = deriveStableBootstrapIssue(error);
        console.warn("AUTH_BOOTSTRAP_STABLE_FAILURE", error);
        setShellProfile({
          name: "",
          userCode: "",
          roleCode: "",
          tagline: "Process Automation & Control Environment",
        });
        setMenuSnapshot([]);
        setRuntimeContext(
          buildStableRuntimeContext({
            shellIssueCode: stableIssue.code,
            shellIssueMessage: stableIssue.message,
          })
        );
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
