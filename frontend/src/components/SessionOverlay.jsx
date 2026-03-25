/*
 * File-ID: UI-SESSION-2
 * File-Path: frontend/src/components/SessionOverlay.jsx
 * Gate: UI
 * Phase: UI
 * Domain: FRONT
 * Purpose: Blocking overlay for session warning (UI only, no authority)
 * Authority: Frontend (DISPLAY ONLY)
 */

import { useEffect, useState } from "react";
import {
  subscribe,
  unsubscribe,
  clearWarning,
} from "../store/sessionWarning.js";

/* =========================================================
 * Component
 * ========================================================= */

export default function SessionOverlay() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [warningType, setWarningType] = useState(null);

  useEffect(() => {
    const listener = (state) => {
      setVisible(state.visible);
      setMessage(state.message);
      setWarningType(state.type);
    };

    subscribe(listener);
    return () => unsubscribe(listener);
  }, []);

  useEffect(() => {
    if (!visible) {
      document.body.style.overflow = "";
      return undefined;
    }

    document.body.style.overflow = "hidden";

    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;

      event.preventDefault();
      event.stopPropagation();
      void clearWarning("escape");
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div style={overlayStyle} aria-modal="true" role="dialog">
      <div style={boxStyle}>
        <p style={badgeStyle}>{warningType === "ABSOLUTE_WARNING" ? "Session Expiring" : "Idle Warning"}</p>
        <p style={textStyle}>{message}</p>
        <button style={buttonStyle} onClick={() => void clearWarning("ack")}>
          OK
        </button>
      </div>
    </div>
  );
}

/* =========================================================
 * Styles (Hard block UI)
 * ========================================================= */

const overlayStyle = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "100vw",
  height: "100vh",
  background: "rgba(0,0,0,0.6)",
  zIndex: 999999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  pointerEvents: "all", // 🔥 HARD BLOCK
};

const boxStyle = {
  background: "#ffffff",
  padding: "24px",
  borderRadius: "12px",
  minWidth: "320px",
  maxWidth: "420px",
  boxShadow: "0 20px 80px rgba(0,0,0,0.28)",
  textAlign: "center",
};

const badgeStyle = {
  marginBottom: "12px",
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#b45309",
};

const textStyle = {
  marginBottom: "16px",
  fontSize: "14px",
  color: "#333",
  lineHeight: 1.5,
};

const buttonStyle = {
  padding: "8px 16px",
  border: "none",
  borderRadius: "4px",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};
