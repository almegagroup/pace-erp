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
  border: "1px solid #8d9baa",
  borderRadius: "0",
  padding: "10px 18px",
  fontSize: "13px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  cursor: "pointer",
};

const secondaryButtonStyle = {
  ...baseButtonStyle,
  background: "#ffffff",
  color: "#0f172a",
};

const primaryButtonStyle = {
  ...baseButtonStyle,
  borderColor: "#0f5ca8",
  background: "#dceaf8",
  color: "#0f355d",
};
