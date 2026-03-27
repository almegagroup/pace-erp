import { useEffect, useRef, useState } from "react";
import ModalBase from "./layer/ModalBase.jsx";
import {
  resolveActionConfirm,
  subscribeActionConfirm,
  unsubscribeActionConfirm,
} from "../store/actionConfirm.js";

export default function ActionConfirmOverlay() {
  const [snapshot, setSnapshot] = useState({
    visible: false,
    eyebrow: "",
    title: "",
    message: "",
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
  });
  const cancelButtonRef = useRef(null);

  useEffect(() => {
    const listener = (nextState) => {
      setSnapshot(nextState);
    };

    subscribeActionConfirm(listener);
    return () => unsubscribeActionConfirm(listener);
  }, []);

  if (!snapshot.visible) {
    return null;
  }

  return (
    <ModalBase
      visible={snapshot.visible}
      onEscape={() => resolveActionConfirm(false)}
      initialFocusRef={cancelButtonRef}
      eyebrow={snapshot.eyebrow}
      title={snapshot.title}
      message={snapshot.message}
      actions={
        <>
          <button
            ref={cancelButtonRef}
            style={secondaryButtonStyle}
            data-erp-nav-item="true"
            onClick={() => resolveActionConfirm(false)}
          >
            {snapshot.cancelLabel}
          </button>
          <button
            style={primaryButtonStyle}
            data-erp-nav-item="true"
            onClick={() => resolveActionConfirm(true)}
          >
            {snapshot.confirmLabel}
          </button>
        </>
      }
      width="min(460px, calc(100vw - 32px))"
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
