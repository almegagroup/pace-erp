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
  const { menu, loading } = useMenu();

  if (loading) return null;

  // 🔥 ADD THIS FUNCTION HERE
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
      {/* Sidebar */}
      <aside style={{ width: "220px", borderRight: "1px solid #ddd", display: "flex", flexDirection: "column" }}>
        
        {/* 🔹 MENU LIST */}
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

        {/* 🔥 LOGOUT BUTTON (ADD HERE — BOTTOM) */}
        <div style={{ padding: "10px" }}>
          <button onClick={handleLogout} style={{ width: "100%" }}>
            Logout
          </button>
        </div>

      </aside>

      {/* Main content */}
      <main style={{ flex: 1 }}>
        {children}
      </main>
    </div>
  );
}
