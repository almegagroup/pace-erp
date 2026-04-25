/*
 * File-ID: 9.10-FRONT
 * File-Path: frontend/src/components/templates/ErpScreenScaffold.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Provide the canonical keyboard-native screen scaffold for dense ERP work surfaces
 * Authority: Frontend
 */

import { Fragment, useEffect, useMemo, useRef } from "react";
import { pushToast } from "../../store/uiToast.js";
import { isBlockingLayerActive } from "../layer/blockingLayerStack.js";
import ErpCommandStrip from "../layout/ErpCommandStrip.jsx";


const ACTION_TONE_CLASS = Object.freeze({
  primary:
    "border-sky-700 bg-sky-100 text-sky-950 hover:bg-sky-200",
  neutral:
    "border-slate-400 bg-white text-slate-800 hover:bg-slate-50",
  danger:
    "border-rose-700 bg-rose-100 text-rose-950 hover:bg-rose-200",
});

const METRIC_TONE_CLASS = Object.freeze({
  sky: "border-sky-200 bg-sky-50",
  emerald: "border-emerald-200 bg-emerald-50",
  rose: "border-rose-200 bg-rose-50",
  amber: "border-amber-200 bg-amber-50",
  slate: "border-slate-300 bg-slate-100",
});

const NOTICE_TONE_CLASS = Object.freeze({
  success: "border-emerald-200 bg-emerald-50 text-emerald-950",
  error: "border-rose-200 bg-rose-50 text-rose-950",
  info: "border-sky-200 bg-sky-50 text-sky-950",
  neutral: "border-slate-200 bg-slate-50 text-slate-900",
});

const NOTICE_TONE_LABEL = Object.freeze({
  success: "Saved",
  error: "Attention Required",
  info: "Heads Up",
  neutral: "Status",
});

const SECTION_TONE_CLASS = Object.freeze({
  default: "border-slate-200 bg-white",
  accent: "border-sky-200 bg-[#f8fbff]",
  warning: "border-amber-200 bg-[#fffaf2]",
  success: "border-emerald-200 bg-[#f5fffa]",
});

const RESERVED_MNEMONICS = new Set(["A", "C", "H", "K", "L", "M"]);

function extractHintMnemonic(hint) {
  const match = /^Alt\+([A-Z])$/i.exec(hint ?? "");
  return match ? match[1].toUpperCase() : null;
}

function findMnemonic(label, used) {
  const candidates = Array.from((label ?? "").toUpperCase()).filter((char) =>
    /[A-Z]/.test(char)
  );

  for (const char of candidates) {
    if (!used.has(char) && !RESERVED_MNEMONICS.has(char)) {
      used.add(char);
      return char;
    }
  }

  for (const char of candidates) {
    if (!used.has(char)) {
      used.add(char);
      return char;
    }
  }

  return null;
}

function withActionMnemonics(actions) {
  const used = new Set();

  return actions.map((action) => {
    const hintedMnemonic = extractHintMnemonic(action.hint);
    const mnemonic =
      action.mnemonic?.toUpperCase() ??
      (hintedMnemonic && !used.has(hintedMnemonic)
        ? hintedMnemonic
        : findMnemonic(action.label, used));

    if (hintedMnemonic) {
      used.add(hintedMnemonic);
    } else if (mnemonic) {
      used.add(mnemonic);
    }

    return {
      ...action,
      mnemonic,
      mnemonicHint: mnemonic ? `Alt+${mnemonic}` : null,
    };
  });
}

function renderMnemonicLabel(label, mnemonic) {
  if (!label || !mnemonic) {
    return label;
  }

  const index = label.toUpperCase().indexOf(mnemonic);

  if (index < 0) {
    return label;
  }

  return (
    <>
      {label.slice(0, index)}
      <span className="underline decoration-[1.5px] underline-offset-[3px]">
        {label[index]}
      </span>
      {label.slice(index + 1)}
    </>
  );
}

export function ErpMetricCard({
  label,
  value,
  caption,
  tone = "sky",
  badge = "",
}) {
  return (
    <article
      className={`grid gap-2 border px-3 py-2 shadow-sm ${METRIC_TONE_CLASS[tone] ?? METRIC_TONE_CLASS.sky}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {label}
        </p>
        {badge ? (
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            {badge}
          </span>
        ) : null}
      </div>
      <div className="grid gap-1">
        <h3 className="text-2xl font-semibold tracking-tight text-slate-900">
          {value}
        </h3>
        {caption ? (
          <p className="max-w-[20rem] text-xs leading-5 text-slate-500">
            {caption}
          </p>
        ) : null}
      </div>
    </article>
  );
}

export function ErpFieldPreview({
  label,
  value,
  caption,
  multiline = false,
  tone = "default",
  badge = "",
}) {
  const toneClass = {
    default: "border-slate-300 bg-white",
    success: "border-emerald-200 bg-emerald-50",
    sky: "border-sky-200 bg-sky-50",
    emerald: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    rose: "border-rose-200 bg-rose-50",
  }[tone] ?? "border-slate-300 bg-white";

  return (
    <article className={`grid gap-2 border px-3 py-3 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {label}
        </p>
        {badge ? (
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            {badge}
          </span>
        ) : null}
      </div>
      {multiline ? (
        <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">
          {value || "Not available yet"}
        </p>
      ) : (
        <p className="text-sm font-semibold text-slate-900">
          {value || "Not available yet"}
        </p>
      )}
      {caption ? (
        <p className="mt-2 text-xs leading-5 text-slate-500">{caption}</p>
      ) : null}
    </article>
  );
}

export function ErpActionStrip({ actions = [] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {actions.map((action, index) => {
        const toneClass =
          action.disabled
            ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
            : ACTION_TONE_CLASS[action.tone] ?? ACTION_TONE_CLASS.neutral;

        const hintTokens = [action.hint, action.mnemonicHint]
          .filter(Boolean)
          .filter((value, i, arr) => arr.indexOf(value) === i);

        return (
          <button
            key={action.key ?? `${action.label}-${index}`}
            ref={action.buttonRef}
            type="button"
            disabled={action.disabled}
            onClick={action.onClick}
            onKeyDown={action.onKeyDown}
            className={`border px-2 py-[3px] text-left transition ${toneClass}`}
          >
            <span className="block text-[11px] font-semibold uppercase tracking-[0.06em]">
              {renderMnemonicLabel(action.label, action.mnemonic)}
            </span>
            {hintTokens.length > 0 ? (
              <span className="block text-[9px] uppercase tracking-[0.12em] text-slate-500">
                {hintTokens.join(" | ")}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function ErpSectionCard({
  eyebrow,
  title,
  aside,
  children,
  className = "",
  tone = "default",
}) {
  return (
    <section
      className={`overflow-hidden border shadow-[0_4px_12px_rgba(15,23,42,0.04)] ${SECTION_TONE_CLASS[tone] ?? SECTION_TONE_CLASS.default} ${className}`.trim()}
    >
      {(eyebrow || title || aside) ? (
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <h2 className="mt-2 text-base font-semibold tracking-tight text-slate-900">
                {title}
              </h2>
            ) : null}
          </div>
          {aside ? <Fragment>{aside}</Fragment> : null}
        </div>
      ) : null}
      <div className="px-4 py-4">
        {children}
      </div>
    </section>
  );
}

export default function ErpScreenScaffold({
  eyebrow,
  title,
  actions = [],
  topActions = [],
  notices = [],
  error = "",
  notice = "",
  footerHints = [],
  children,
}) {
  const deliveredToastKeysRef = useRef(new Set());
  const mergedActions = useMemo(
    () => (actions.length > 0 ? actions : topActions),
    [actions, topActions]
  );
  const mergedNotices = useMemo(
    () => [
      ...notices,
      ...(error ? [{ key: "error-alias", tone: "error", message: error }] : []),
      ...(notice
        ? [{ key: "notice-alias", tone: "success", message: notice }]
        : []),
    ],
    [error, notice, notices]
  );
  const resolvedActions = useMemo(() => withActionMnemonics(mergedActions), [mergedActions]);

     useEffect(() => {
    function handleMnemonic(event) {
      if (isBlockingLayerActive()) {
        return;
      }

      if (
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        typeof event.key !== "string"
      ) {
        return;
      }

      const key = event.key.toUpperCase();
      const action = resolvedActions.find(
        (item) => !item.disabled && item.mnemonic === key
      );

      if (!action) {
        return;
      }

      event.preventDefault();
      action.onClick?.(event);
    }

    window.addEventListener("keydown", handleMnemonic, true);
    return () => window.removeEventListener("keydown", handleMnemonic, true);
  }, [resolvedActions]);

  useEffect(() => {
    mergedNotices.forEach((entry, index) => {
      if (!entry?.message) {
        return;
      }

      const toastKey =
        entry.key ??
        `${entry.tone ?? "info"}:${entry.message}:${index}`;

      if (deliveredToastKeysRef.current.has(toastKey)) {
        return;
      }

      deliveredToastKeysRef.current.add(toastKey);
      pushToast({
        id: toastKey,
        tone: entry.tone ?? "info",
        title: NOTICE_TONE_LABEL[entry.tone] ?? NOTICE_TONE_LABEL.info,
        message: entry.message,
      });
    });
  }, [mergedNotices]);

  return (
    <section className="min-h-full text-slate-900">
      <div className="mx-auto flex max-w-none flex-col gap-[var(--erp-section-gap)]">
        <div className="sticky top-0 z-20 overflow-hidden border-b border-slate-300 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-1.5">
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-sky-700">
                {eyebrow}
              </p>
              <h1 className="text-[13px] font-bold tracking-tight text-slate-900">
                {title}
              </h1>
            </div>

            {resolvedActions.length > 0 ? (
              <ErpActionStrip actions={resolvedActions} />
            ) : null}
          </div>
        </div>

        <div className="grid gap-[var(--erp-section-gap)]">{children}</div>

        <ErpCommandStrip hints={footerHints} />
      </div>
    </section>
  );
}
