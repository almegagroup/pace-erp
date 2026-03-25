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

  useEffect(() => {
    const listener = (state) => {
      setVisible(state.visible);
      setMessage(state.message);
    };

    subscribe(listener);
    return () => unsubscribe(listener);
  }, []);

  if (!visible) return null;

  return (
    <div style={overlayStyle}>
      <div style={boxStyle}>
        <p style={textStyle}>{message}</p>
        <button style={buttonStyle} onClick={clearWarning}>
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
  borderRadius: "8px",
  minWidth: "280px",
  textAlign: "center",
};

const textStyle = {
  marginBottom: "16px",
  fontSize: "14px",
  color: "#333",
};

const buttonStyle = {
  padding: "8px 16px",
  border: "none",
  borderRadius: "4px",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};