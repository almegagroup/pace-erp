/*
 * File-ID: 7.X (UPDATED)
 * File-Path: frontend/src/admin/AuthResolver.jsx
 * Purpose: Show secure redirect handoff while the protected shell resolves the user's home route
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useMenu } from "../context/useMenu.js";
import { resetToScreen } from "../navigation/screenStackEngine.js";

const REDIRECT_TIPS = Object.freeze([
  "Protect access with strong passwords and never reuse ERP credentials across personal services.",
  "Review shared reports carefully and remove unneeded exports from email threads and downloads.",
  "Lock your workspace before stepping away so operational data stays protected from shoulder surfing.",
  "Download only the files you need, and delete outdated local copies after approved use is complete.",
  "Check recipient names twice before sharing finance, payroll, costing, or supplier data.",
  "Keep master data clean by updating records at the source instead of maintaining side spreadsheets.",
  "Treat customer, employee, and vendor data as confidential even inside internal chat groups.",
  "Use the ERP as the single source of truth so teams do not make decisions from stale copied data.",
  "Report suspicious logins, unusual exports, or unexpected permission changes as soon as they are noticed.",
  "Good data hygiene starts with small habits: accurate entry, timely updates, and careful access control.",
]);

function shuffleTips(seedItems) {
  const items = [...seedItems];

  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }

  return items;
}

export default function AuthResolver() {
  const location = useLocation();
  const { menu } = useMenu();
  const shuffledTips = useMemo(() => shuffleTips(REDIRECT_TIPS), []);
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    if (!menu || menu.length === 0) {
      return;
    }

    if (location.pathname !== "/app") {
      return;
    }

    const ga = menu.find((item) => item.menu_code === "GA_HOME");
    const sa = menu.find((item) => item.menu_code === "SA_HOME");

    if (ga) {
      resetToScreen("GA_HOME");
      return;
    }

    if (sa) {
      resetToScreen("SA_HOME");
      return;
    }

    resetToScreen("DASHBOARD_HOME");
  }, [menu, location.pathname]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setTipIndex((current) => (current + 1) % shuffledTips.length);
    }, 2800);

    return () => window.clearInterval(intervalId);
  }, [shuffledTips]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "28px",
        background:
          "radial-gradient(circle at top, rgba(145,188,214,0.24), transparent 38%), linear-gradient(135deg, #edf4f8 0%, #f7fbfd 48%, #e4eef4 100%)",
      }}
    >
      <div
        style={{
          width: "min(720px, 100%)",
          border: "1px solid rgba(24,52,71,0.12)",
          borderRadius: "28px",
          background: "rgba(255,255,255,0.9)",
          boxShadow: "0 28px 80px rgba(16,41,57,0.14)",
          padding: "32px",
          color: "#102939",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "10px",
            padding: "8px 12px",
            borderRadius: "999px",
            background: "#dfeef7",
            color: "#245574",
            fontSize: "12px",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            fontWeight: 800,
          }}
        >
          <span
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "999px",
              background: "#2f7db1",
              animation: "pace-auth-pulse 1s ease-in-out infinite",
            }}
          />
          Secure Redirect
        </div>

        <h1
          style={{
            margin: "18px 0 10px",
            fontSize: "32px",
            lineHeight: 1.1,
            letterSpacing: "-0.04em",
          }}
        >
          Preparing your ERP workspace
        </h1>

        <p
          style={{
            margin: 0,
            fontSize: "15px",
            lineHeight: 1.7,
            color: "#4a6273",
          }}
        >
          We are validating your session, loading the correct home dashboard,
          and refreshing the latest menu authority for your role.
        </p>

        <div
          style={{
            marginTop: "24px",
            display: "grid",
            gap: "14px",
          }}
        >
          <div
            style={{
              height: "10px",
              borderRadius: "999px",
              overflow: "hidden",
              background: "#dbe8ef",
            }}
          >
            <div
              style={{
                width: "38%",
                height: "100%",
                borderRadius: "999px",
                background: "linear-gradient(90deg, #2f7db1 0%, #7ecbff 100%)",
                animation: "pace-auth-slide 1.25s ease-in-out infinite",
                transformOrigin: "left center",
              }}
            />
          </div>

          <div
            style={{
              border: "1px solid #d7e5ee",
              borderRadius: "18px",
              background: "#f8fbfd",
              padding: "18px 18px 16px",
              minHeight: "122px",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: "11px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "#628099",
                fontWeight: 800,
              }}
            >
              Security And Data Hygiene
            </p>
            <p
              key={tipIndex}
              style={{
                margin: "12px 0 0",
                fontSize: "18px",
                lineHeight: 1.7,
                color: "#17354a",
                animation: "pace-auth-fade 280ms ease",
              }}
            >
              {shuffledTips[tipIndex]}
            </p>
          </div>
        </div>

        <style>{`
          @keyframes pace-auth-slide {
            0% { transform: translateX(-40%) scaleX(0.75); opacity: 0.55; }
            50% { transform: translateX(145%) scaleX(1); opacity: 1; }
            100% { transform: translateX(250%) scaleX(0.8); opacity: 0.55; }
          }

          @keyframes pace-auth-pulse {
            0%, 100% { transform: scale(0.9); opacity: 0.55; }
            50% { transform: scale(1.05); opacity: 1; }
          }

          @keyframes pace-auth-fade {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    </div>
  );
}
