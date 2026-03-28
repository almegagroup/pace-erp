/*
 * File-ID: 8.4E
 * File-Path: frontend/src/components/ErpCommandPalette.jsx
 * Gate: 8
 * Phase: 8
 * Domain: FRONT
 * Purpose: Provide a protected-shell command palette for full keyboard ERP operation
 * Authority: Frontend
 */

import { useEffect, useMemo, useRef, useState } from "react";
import ModalBase from "./layer/ModalBase.jsx";
import { handleLinearNavigation } from "../navigation/erpRovingFocus.js";
import {
  closeErpCommandPalette,
  subscribeErpCommandPalette,
  subscribeRegisteredScreenCommands,
} from "../store/erpCommandPalette.js";

function normalizeSearch(value) {
  return value.trim().toLowerCase();
}

function scoreCommand(command, query) {
  if (!query) {
    return command.order ?? 0;
  }

  const haystack = [
    command.label,
    command.group,
    command.hint,
    ...(command.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (command.label.toLowerCase().startsWith(query)) {
    return -20 + (command.order ?? 0);
  }

  if (haystack.includes(query)) {
    return -10 + (command.order ?? 0);
  }

  return Number.POSITIVE_INFINITY;
}

export default function ErpCommandPalette({
  activeRoute,
  shellCommands = [],
  menuCommands = [],
}) {
  const [visible, setVisible] = useState(false);
  const [screenRegistry, setScreenRegistry] = useState(() => new Map());
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchInputRef = useRef(null);
  const commandRefs = useRef([]);

  useEffect(() => {
    const unsubscribeOverlay = subscribeErpCommandPalette((snapshot) => {
      setVisible(snapshot.visible);
    });
    const unsubscribeCommands = subscribeRegisteredScreenCommands((snapshot) => {
      setScreenRegistry(snapshot);
    });

    return () => {
      unsubscribeOverlay();
      unsubscribeCommands();
    };
  }, []);

  const screenCommands = screenRegistry.get(activeRoute) ?? [];

  const commands = useMemo(() => {
    const combined = [...screenCommands, ...shellCommands, ...menuCommands].filter(
      Boolean
    );

    const seen = new Set();
    return combined.filter((command) => {
      if (!command?.id || seen.has(command.id)) {
        return false;
      }

      seen.add(command.id);
      return true;
    });
  }, [menuCommands, screenCommands, shellCommands]);

  const filteredCommands = useMemo(() => {
    const normalizedQuery = normalizeSearch(query);

    return commands
      .map((command) => ({
        ...command,
        score: scoreCommand(command, normalizedQuery),
      }))
      .filter((command) => Number.isFinite(command.score))
      .sort((left, right) => {
        if (left.score !== right.score) {
          return left.score - right.score;
        }

        return (left.order ?? 0) - (right.order ?? 0);
      });
  }, [commands, query]);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setActiveIndex(0);
      return;
    }

    const timerId = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [visible]);

  useEffect(() => {
    if (activeIndex < filteredCommands.length) {
      return;
    }

    setActiveIndex(filteredCommands.length > 0 ? filteredCommands.length - 1 : 0);
  }, [activeIndex, filteredCommands.length]);

  async function executeCommand(command) {
    if (!command || command.disabled) {
      return;
    }

    closeErpCommandPalette();
    await Promise.resolve(command.perform());
  }

  return (
    <ModalBase
      visible={visible}
      eyebrow="ERP Command Bar"
      title="Keyboard Command Center"
      message="Search any shell command, current-screen action, or allowed navigation target. Enter executes the highlighted command."
      onEscape={closeErpCommandPalette}
      initialFocusRef={searchInputRef}
      width="min(820px, calc(100vw - 32px))"
      actions={(
        <button
          type="button"
          onClick={closeErpCommandPalette}
          className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-100"
        >
          Esc Close
        </button>
      )}
    >
      <div className="grid gap-4">
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            Find Command
          </span>
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && filteredCommands.length > 0) {
                event.preventDefault();
                setActiveIndex(0);
                commandRefs.current[0]?.focus();
              }

              if (event.key === "Enter" && filteredCommands.length > 0) {
                event.preventDefault();
                void executeCommand(filteredCommands[activeIndex] ?? filteredCommands[0]);
              }
            }}
            placeholder="Search commands, screens, save actions, navigation, lock, logout..."
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/50 focus:bg-black/30"
          />
        </label>

        <div className="flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          <span className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-2">
            Ctrl+K Open
          </span>
          <span className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-2">
            Arrow Up/Down Move
          </span>
          <span className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-2">
            Enter Execute
          </span>
          <span className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-2">
            Esc Close
          </span>
        </div>

        <div className="max-h-[26rem] overflow-y-auto pr-1">
          {filteredCommands.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-white/12 bg-white/[0.03] px-5 py-5 text-sm leading-7 text-slate-400">
              No command matches the current search.
            </div>
          ) : (
            <div
              data-erp-nav-group="true"
              data-erp-nav-axis="vertical"
              className="space-y-3"
            >
              {filteredCommands.map((command, index) => {
                const highlighted = index === activeIndex;

                return (
                  <button
                    key={command.id}
                    ref={(element) => {
                      commandRefs.current[index] = element;
                    }}
                    type="button"
                    data-erp-nav-item="true"
                    disabled={command.disabled}
                    onFocus={() => setActiveIndex(index)}
                    onClick={() => void executeCommand(command)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void executeCommand(command);
                        return;
                      }

                      handleLinearNavigation(event, {
                        index,
                        refs: commandRefs.current,
                        orientation: "vertical",
                      });
                    }}
                    className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${
                      command.disabled
                        ? "cursor-not-allowed border-white/6 bg-white/[0.03] text-slate-500"
                        : highlighted
                          ? "border-emerald-400/30 bg-emerald-400/12 text-emerald-50"
                          : "border-white/8 bg-white/[0.03] text-slate-100"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                          {command.group}
                        </p>
                        <p className="mt-2 text-sm font-semibold">
                          {command.label}
                        </p>
                        {command.keywords?.length ? (
                          <p className="mt-2 text-xs leading-5 text-slate-400">
                            {command.keywords.join(" | ")}
                          </p>
                        ) : null}
                      </div>
                      {command.hint ? (
                        <span className="rounded-full border border-white/8 bg-black/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                          {command.hint}
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </ModalBase>
  );
}
