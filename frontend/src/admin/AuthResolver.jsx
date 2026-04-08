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
import paceBackground from "../assets/pace-bgr.png";
import {
  REDIRECT_TIPS,
  shuffleRedirectTips,
} from "../auth/redirectGuidance.js";

export default function AuthResolver() {
  const location = useLocation();
  const { menu } = useMenu();
  const shuffledTips = useMemo(() => shuffleRedirectTips(REDIRECT_TIPS), []);
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
          We are opening your ERP home workspace and restoring the correct
          shell for your role. Fresh data will settle quietly in the
          background when needed.
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
              display: "flex",
              justifyContent: "center",
              paddingTop: "4px",
            }}
          >
            <img
              src={paceBackground}
              alt="Pace ERP"
              style={{
                width: "min(220px, 58vw)",
                height: "auto",
                objectFit: "contain",
                filter: "drop-shadow(0 10px 20px rgba(16,41,57,0.12))",
              }}
            />
          </div>

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
