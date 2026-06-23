import { useEffect, useRef, useState } from "react";
import ModalBase from "./layer/ModalBase.jsx";
import { resolveActionPrompt, subscribeActionPrompt, unsubscribeActionPrompt } from "../store/actionPrompt.js";

export default function ActionPromptOverlay() {
  const [snapshot, setSnapshot] = useState({ visible: false, eyebrow: "", title: "", message: "", label: "", placeholder: "", defaultValue: "", required: false, confirmOnly: false, confirmLabel: "Confirm" });
  const [value, setValue] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    const listener = (nextState) => {
      setSnapshot(nextState);
      if (nextState.visible) setValue(nextState.defaultValue ?? "");
    };
    subscribeActionPrompt(listener);
    return () => unsubscribeActionPrompt(listener);
  }, []);

  useEffect(() => {
    if (snapshot.visible && !snapshot.confirmOnly) setTimeout(() => inputRef.current?.focus(), 50);
  }, [snapshot.visible, snapshot.confirmOnly]);

  if (!snapshot.visible) return null;

  function handleConfirm() {
    if (snapshot.confirmOnly) {
      resolveActionPrompt(true);
      return;
    }
    if (snapshot.required && !value.trim()) return;
    resolveActionPrompt(value.trim() || null);
  }

  function handleCancel() {
    resolveActionPrompt(snapshot.confirmOnly ? false : null);
  }

  return (
    <ModalBase
      visible={snapshot.visible}
      onEscape={handleCancel}
      eyebrow={snapshot.eyebrow}
      title={snapshot.title}
      message={
        snapshot.confirmOnly ? (
          snapshot.message || null
        ) : (
          <div className="grid gap-2 mt-1">
            {snapshot.message && <p>{snapshot.message}</p>}
            {snapshot.label && (
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                {snapshot.label}
              </label>
            )}
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
              placeholder={snapshot.placeholder}
              className="h-9 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </div>
        )
      }
      actions={
        <>
          <button style={secondaryStyle} data-erp-nav-item="true" onClick={handleCancel}>Cancel</button>
          <button style={primaryStyle} data-erp-nav-item="true" onClick={handleConfirm}
            disabled={!snapshot.confirmOnly && snapshot.required && !value.trim()}
          >{snapshot.confirmLabel || "Confirm"}</button>
        </>
      }
      width="min(460px, calc(100vw - 32px))"
    />
  );
}

const base = { border: "1px solid #8d9baa", borderRadius: "0", padding: "10px 18px", fontSize: "13px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", cursor: "pointer" };
const secondaryStyle = { ...base, background: "#ffffff", color: "#0f172a" };
const primaryStyle = { ...base, borderColor: "#0f5ca8", background: "#dceaf8", color: "#0f355d" };
