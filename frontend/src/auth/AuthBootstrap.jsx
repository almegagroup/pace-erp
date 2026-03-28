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

export default function AuthBootstrap({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const bootStateRef = useRef({
    bootKey: null,
    inFlight: false,
  });

  const {
    menu,
    startMenuLoading,
    setMenuSnapshot,
    setShellProfile,
    clearMenuSnapshot,
  } = useMenu();

  useEffect(() => {
    let alive = true;

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
        bootStateRef.current = {
          bootKey: pathname,
          inFlight: false,
        };
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
        });

        if (!meRes.ok) {
          clearMenuSnapshot();
          clearClusterAdmission();
          navigate("/login", { replace: true });
          return;
        }

        const existingAdmission = getClusterAdmission();
        const shouldRequestAdmission = Boolean(joinToken) || !existingAdmission;

        if (shouldRequestAdmission) {
          const clusterAdmission = await requestSessionClusterAdmission(joinToken);

          if (!clusterAdmission.ok) {
            clearMenuSnapshot();
            clearClusterAdmission();
            navigate("/login", { replace: true });
            return;
          }
        }

        if (!claimClusterWindowOwnership()) {
          clearMenuSnapshot();
          clearClusterAdmission();
          navigate("/login", { replace: true });
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

        const [profileRes, menuRes] = await Promise.all([
          fetch(`${import.meta.env.VITE_API_BASE}/api/me/profile`, {
            credentials: "include",
          }),
          fetch(`${import.meta.env.VITE_API_BASE}/api/me/menu`, {
            credentials: "include",
          }),
        ]);

        if (!profileRes.ok || !menuRes.ok) {
          throw new Error("AUTH_BOOTSTRAP_FETCH_FAILED");
        }

        const [profileData, data] = await Promise.all([
          profileRes.json(),
          menuRes.json(),
        ]);

        if (!alive) {
          return;
        }

        setShellProfile({
          userCode: profileData?.data?.user_code ?? "",
          roleCode: profileData?.data?.role_code ?? "",
          tagline: "Process Automation & Control Environment",
        });

        const menuData = data?.data?.menu ?? [];
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
    setMenuSnapshot,
    setShellProfile,
    startMenuLoading,
  ]);

  return children;
}
