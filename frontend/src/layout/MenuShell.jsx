/*
 * File-ID: 7.7
 * File-Path: frontend/src/layout/MenuShell.jsx
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Render menu UI strictly from backend snapshot
 * Authority: Frontend
 */

import { useMenu } from "../context/useMenu.js";
import { Link } from "react-router-dom";

export default function MenuShell({ children }) {
  console.log("🔥 MenuShell ACTIVE");

  const { menu, loading } = useMenu();

  console.log("📊 MenuShell state:", {
    loading,
    menuLength: menu?.length,
  });

  if (loading) {
    console.log("⏳ Menu এখনও load হচ্ছে...");
    return <div>Loading Menu...</div>;
  }

  async function handleLogout() {
    try {
      await fetch(`${import.meta.env.VITE_API_BASE}/api/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch (e) {
      console.error(e);
    }

    window.location.href = "/login";
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={{ width: "220px", borderRight: "1px solid #ddd", display: "flex", flexDirection: "column" }}>
        
        <ul style={{ flex: 1 }}>
          {menu.map(item => (
            <li key={item.menu_code}>
              {item.route_path ? (
                <Link to={item.route_path}>{item.title}</Link>
              ) : (
                <span>{item.title}</span>
              )}
            </li>
          ))}
        </ul>

        <div style={{ padding: "10px" }}>
          <button onClick={handleLogout} style={{ width: "100%" }}>
            Logout
          </button>
        </div>

      </aside>

      <main style={{ flex: 1 }}>
        {children}
      </main>
    </div>
  );
}
