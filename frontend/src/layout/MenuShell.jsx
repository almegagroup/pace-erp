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

  if (loading) return null; // no optimistic UI

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <aside style={{ width: "220px", borderRight: "1px solid #ddd" }}>
        <ul>
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
      </aside>

      {/* Main content */}
      <main style={{ flex: 1 }}>
        {children}
      </main>
    </div>
  );
}
