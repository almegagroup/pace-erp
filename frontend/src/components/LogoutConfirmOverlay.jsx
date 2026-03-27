import { useEffect, useRef, useState } from "react";
import {
  resolveLogoutConfirm,
  subscribeLogoutConfirm,
  unsubscribeLogoutConfirm,
} from "../store/logoutConfirm.js";
import ModalBase from "./layer/ModalBase.jsx";

export default function LogoutConfirmOverlay() {
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const noButtonRef = useRef(null);
  const yesButtonRef = useRef(null);

  useEffect(() => {
    const listener = (nextState) => {
      setVisible(nextState.visible);
      setTitle(nextState.title);
      setMessage(nextState.message);
    };

    subscribeLogoutConfirm(listener);
    return () => unsubscribeLogoutConfirm(listener);
  }, []);

  if (!visible) return null;

  return (
    <ModalBase
      visible={visible}
      onEscape={() => resolveLogoutConfirm(false)}
      initialFocusRef={noButtonRef}
      eyebrow="Logout Flow"
      title={title}
      message={message}
      actions={
        <>
          <button
            ref={noButtonRef}
            style={secondaryButtonStyle}
            data-erp-nav-item="true"
            onClick={() => resolveLogoutConfirm(false)}
          >
            No
          </button>
          <button
            ref={yesButtonRef}
            style={primaryButtonStyle}
            data-erp-nav-item="true"
            onClick={() => resolveLogoutConfirm(true)}
          >
            Yes
          </button>
        </>
      }
      width="min(420px, calc(100vw - 32px))"
    />
  );
}

const baseButtonStyle = {
  border: "none",
  borderRadius: "12px",
  padding: "10px 18px",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButtonStyle = {
  ...baseButtonStyle,
  background: "#e2e8f0",
  color: "#0f172a",
};

const primaryButtonStyle = {
  ...baseButtonStyle,
  background: "linear-gradient(90deg, #0ea5e9 0%, #2563eb 100%)",
  color: "#ffffff",
};
