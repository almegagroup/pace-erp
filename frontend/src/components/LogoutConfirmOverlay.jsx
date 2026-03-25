import { useEffect, useState } from "react";
import {
  resolveLogoutConfirm,
  subscribeLogoutConfirm,
  unsubscribeLogoutConfirm,
} from "../store/logoutConfirm.js";

export default function LogoutConfirmOverlay() {
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const listener = (nextState) => {
      setVisible(nextState.visible);
      setTitle(nextState.title);
      setMessage(nextState.message);
    };

    subscribeLogoutConfirm(listener);
    return () => unsubscribeLogoutConfirm(listener);
  }, []);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        resolveLogoutConfirm(false);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div style={overlayStyle} aria-modal="true" role="dialog">
      <div style={boxStyle}>
        <p style={badgeStyle}>{title}</p>
        <p style={textStyle}>{message}</p>
        <div style={actionsStyle}>
          <button style={secondaryButtonStyle} onClick={() => resolveLogoutConfirm(false)}>
            No
          </button>
          <button style={primaryButtonStyle} onClick={() => resolveLogoutConfirm(true)}>
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(2, 8, 23, 0.56)",
  zIndex: 999998,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const boxStyle = {
  width: "min(420px, calc(100vw - 32px))",
  background: "#ffffff",
  borderRadius: "18px",
  padding: "24px",
  boxShadow: "0 24px 80px rgba(15, 23, 42, 0.28)",
};

const badgeStyle = {
  margin: 0,
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#0f172a",
};

const textStyle = {
  margin: "14px 0 0",
  fontSize: "15px",
  lineHeight: 1.6,
  color: "#334155",
};

const actionsStyle = {
  marginTop: "22px",
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
};

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
