import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import BlockingLayer from "./layer/BlockingLayer.jsx";
import { isPublicRoute } from "../router/publicRoutes.js";
import {
  clearWorkspaceLock,
  submitWorkspaceUnlock,
  subscribeWorkspaceLock,
  unsubscribeWorkspaceLock,
} from "../store/workspaceLock.js";

export default function WorkspaceLockOverlay() {
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const passwordRef = useRef(null);

  useEffect(() => {
    const listener = (snapshot) => {
      setVisible(snapshot.visible);
      setLoading(snapshot.loading);
      setError(snapshot.error);
      if (!snapshot.visible) {
        setPassword("");
      }
    };

    subscribeWorkspaceLock(listener);
    return () => unsubscribeWorkspaceLock(listener);
  }, []);

  useEffect(() => {
    if (isPublicRoute(location.pathname)) {
      clearWorkspaceLock();
    }
  }, [location.pathname]);

  if (!visible || isPublicRoute(location.pathname)) {
    return null;
  }

  async function handleUnlock(e) {
    if (e) e.preventDefault();
    await submitWorkspaceUnlock(password);
  }

  return (
    <BlockingLayer
      visible={visible}
      initialFocusRef={passwordRef}
      overlayStyle={overlayStyle}
      dialogStyle={dialogStyle}
    >
      <div style={cardStyle}>
        <p style={eyebrowStyle}>Workspace Lock</p>
        <h2 style={titleStyle}>This dashboard is locked</h2>
        <p style={messageStyle}>
          Enter your current login password to unlock your workspace and continue.
        </p>

        <form onSubmit={handleUnlock} style={formStyle}>
          <label style={labelStyle}>Password</label>
          <input
            ref={passwordRef}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={loading}
            placeholder="Enter your login password"
            style={inputStyle}
          />

          {error ? <div style={errorStyle}>{error}</div> : null}

          <button type="submit" disabled={loading} style={buttonStyle}>
            {loading ? "Unlocking..." : "Unlock Workspace"}
          </button>
        </form>

        <p style={noteStyle}>
          Idle timeout and session expiry protections remain active while the workspace is locked.
        </p>
      </div>
    </BlockingLayer>
  );
}

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.60)",
  zIndex: 999997,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "16px",
};

const dialogStyle = {
  width: "min(520px, calc(100vw - 32px))",
  borderRadius: "28px",
  background: "#ffffff",
  boxShadow: "0 28px 90px rgba(15, 23, 42, 0.26)",
  padding: "28px",
};

const cardStyle = {
  display: "flex",
  flexDirection: "column",
};

const eyebrowStyle = {
  margin: 0,
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "#0369a1",
};

const titleStyle = {
  margin: "10px 0 0",
  fontSize: "28px",
  fontWeight: 700,
  color: "#0f172a",
};

const messageStyle = {
  margin: "14px 0 0",
  fontSize: "15px",
  lineHeight: 1.7,
  color: "#475569",
};

const formStyle = {
  marginTop: "22px",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
};

const labelStyle = {
  fontSize: "13px",
  fontWeight: 600,
  color: "#334155",
};

const inputStyle = {
  width: "100%",
  borderRadius: "16px",
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  padding: "12px 14px",
  fontSize: "14px",
  color: "#0f172a",
  outline: "none",
};

const errorStyle = {
  borderRadius: "16px",
  border: "1px solid #fecaca",
  background: "#fef2f2",
  padding: "12px 14px",
  fontSize: "13px",
  color: "#b91c1c",
};

const buttonStyle = {
  marginTop: "4px",
  border: "none",
  borderRadius: "16px",
  background: "linear-gradient(90deg, #0ea5e9 0%, #2563eb 100%)",
  color: "#ffffff",
  padding: "12px 16px",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
};

const noteStyle = {
  margin: "18px 0 0",
  fontSize: "12px",
  lineHeight: 1.6,
  color: "#64748b",
};
