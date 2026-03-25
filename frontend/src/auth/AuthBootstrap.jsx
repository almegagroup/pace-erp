import { useRef, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMenu } from "../context/useMenu.js";
import { isPublicRoute } from "../router/publicRoutes.js";

export default function AuthBootstrap({ children }) {
  const location = useLocation();
  const navigate = useNavigate();

  const hasBootedRef = useRef(false);

  const {
    menu,
    startMenuLoading,
    setMenuSnapshot,
    clearMenuSnapshot,
  } = useMenu();

  // ✅ ADD THIS BLOCK HERE (exactly here)
useEffect(() => {
  if (!menu || menu.length === 0) {
  hasBootedRef.current = false;
}
}, [menu]);

 

  useEffect(() => {
    let alive = true;

    async function boot() {
      const pathname = location.pathname;

      //console.log("🚀 [BOOT START]");
      //console.log("📍 Path:", pathname);
      //console.log("📦 Menu (before):", menu);

      // 🟢 PUBLIC ROUTE
      // 🔥 PUBLIC ROUTES + AUTH CALLBACK SKIP
if (
  isPublicRoute(pathname) ||
  pathname === "/auth/callback"
) {
  hasBootedRef.current = false;
  return;
}

      // 🔥 Skip if menu already exists
if (menu && menu.length > 0 && hasBootedRef.current) {
  //console.log("⛔ Boot skipped (already ran + menu exists)");
  return;
}

// 🔥 Prevent duplicate boot
if (hasBootedRef.current) {
  //console.log("⛔ Boot skipped (already ran)");
  return;
}
hasBootedRef.current = true;

      

      try {
        //console.log("⏳ Starting menu loading...");
        startMenuLoading();

        // =========================
        // STEP 1: SESSION CHECK
        // =========================
        //console.log("📡 Calling /api/me...");
        const meRes = await fetch(
          `${import.meta.env.VITE_API_BASE}/api/me`,
          { credentials: "include" }
        );

        //console.log("🧾 /api/me status:", meRes.status);

        if (!meRes.ok) {
  //console.log("❌ SESSION INVALID");

  // 🔥 ADD THIS (logout detection)
  clearMenuSnapshot();
  navigate("/login", { replace: true });

  return; // ❗ MUST STOP FLOW
}

        // =========================
        // STEP 2: MENU FETCH
        // =========================
        //console.log("📡 Calling /api/me/menu...");
        const menuRes = await fetch(
          `${import.meta.env.VITE_API_BASE}/api/me/menu`,
          { credentials: "include" }
        );

        //console.log("🧾 /api/me/menu status:", menuRes.status);

        if (!menuRes.ok) {
          console.log("❌ MENU FETCH FAILED");
          throw new Error("MENU_FETCH_FAILED");
        }

        const data = await menuRes.json();
        if (!alive) return;

        //console.log("📦 Raw menu response:", data);

        const menuData = data?.data?.menu ?? [];

        //console.log("📊 Final menuData:", menuData);
        console.log("📊 Menu length:", menuData.length);

        // =========================
        // STEP 3: STORE SNAPSHOT
        // =========================
        setMenuSnapshot(menuData);
        //console.log("✅ Menu snapshot set");

        // =========================
        // STEP 4: ENTRY REDIRECT
        // =========================
        if (pathname === "/app") {
          //console.log("🔀 Resolving /app redirect...");

          const sa = menuData.find(m => m.menu_code === "SA_HOME");
          const ga = menuData.find(m => m.menu_code === "GA_HOME");

          console.log("SA:", sa);
          //console.log("GA:", ga);

          if (sa) {
            //console.log("➡️ Redirect → /sa/home");
            navigate("/sa/home", { replace: true });
            return;
          }

          if (ga) {
            //console.log("➡️ Redirect → /ga/home");
            navigate("/ga/home", { replace: true });
            return;
          }

          console.log("➡️ Redirect → /dashboard");
          navigate("/dashboard", { replace: true });
        }

      } catch (err) {
        console.error("🔥 AuthBootstrap ERROR:", err);

        clearMenuSnapshot();

        //console.log("➡️ Redirect → /login");
        navigate("/login", { replace: true });
      }
    }

    boot();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    location.pathname,
    navigate,
  startMenuLoading,
  setMenuSnapshot,
  clearMenuSnapshot,
  ]);

  return children;
}