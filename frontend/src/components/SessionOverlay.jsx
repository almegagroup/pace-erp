/*
 * File-ID: UI-SESSION-2
 * File-Path: frontend/src/components/SessionOverlay.jsx
 * Gate: UI
 * Phase: UI
 * Domain: FRONT
 * Purpose: Blocking overlay for session warning (UI only, no authority)
 * Authority: Frontend (DISPLAY ONLY)
 */

import { useEffect, useRef, useState } from "react";
import {
  subscribe,
  unsubscribe,
  clearWarning,
} from "../store/sessionWarning.js";
import ModalBase from "./layer/ModalBase.jsx";

export default function SessionOverlay() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [warningType, setWarningType] = useState(null);
  const actionButtonRef = useRef(null);

  useEffect(() => {
    const listener = (state) => {
      setVisible(state.visible);
      setMessage(state.message);
      setWarningType(state.type);
    };

    subscribe(listener);
    return () => unsubscribe(listener);
  }, []);

  if (!visible) return null;

  return (
    <ModalBase
      visible={visible}
      onEscape={() => void clearWarning("escape")}
      initialFocusRef={actionButtonRef}
      eyebrow={
        warningType === "ABSOLUTE_WARNING" ? "Session Expiring" : "Idle Warning"
      }
      message={message}
      actions={
        <button
          ref={actionButtonRef}
          style={buttonStyle}
          data-erp-nav-item="true"
          onClick={() => void clearWarning("ack")}
        >
          OK
        </button>
      }
      width="min(420px, calc(100vw - 32px))"
    />
  );
}

const buttonStyle = {
  padding: "10px 18px",
  border: "none",
  borderRadius: "12px",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: 600,
};
