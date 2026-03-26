/*
 * File-ID: 9.1B-FRONT
 * File-Path: frontend/src/components/dashboard/EnterpriseDashboard.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Render dense keyboard-first protected dashboard workspaces
 * Authority: Frontend
 */

import { useRef } from "react";

function moveFocus(refs, nextIndex) {
  const target = refs[nextIndex];

  if (target instanceof HTMLElement) {
    target.focus();
  }
}

function StatRow({ item, index }) {
  return (
    <article className="grid grid-cols-[70px_1fr_auto] items-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-3">
      <span className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {(index + 1).toString().padStart(2, "0")}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {item.label}
        </p>
        <p className="mt-1 font-mono text-2xl font-semibold text-slate-900">
          {item.value}
        </p>
      </div>
      <span className="rounded-md border border-slate-300 bg-slate-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-700">
        {item.tag}
      </span>
    </article>
  );
}

function ActionRow({ action, index, refs, onKeyDown }) {
  return (
    <button
      ref={(element) => {
        refs.current[index] = element;
      }}
      type="button"
      onClick={action.onClick}
      onKeyDown={(event) => onKeyDown(event, index)}
      className="grid w-full grid-cols-[56px_1fr_auto] items-center gap-4 border-b border-slate-200 bg-white px-4 py-4 text-left transition hover:bg-slate-50 focus:bg-sky-50 last:border-b-0"
    >
      <span className="font-mono text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
        {(index + 1).toString().padStart(2, "0")}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {action.badge}
        </span>
        <span className="mt-1 block text-base font-semibold text-slate-900">
          {action.title}
        </span>
        <span className="mt-1 block text-sm leading-6 text-slate-600">
          {action.description}
        </span>
      </span>
      <span className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
        Enter
      </span>
    </button>
  );
}

export default function EnterpriseDashboard({
  eyebrow,
  title,
  subtitle,
  stats,
  actions,
}) {
  const actionRefs = useRef([]);

  function handleActionKeyDown(event, index) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(actionRefs, (index + 1) % actions.length);
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(actionRefs, (index - 1 + actions.length) % actions.length);
    }

    if (event.key === "Home") {
      event.preventDefault();
      moveFocus(actionRefs, 0);
    }

    if (event.key === "End") {
      event.preventDefault();
      moveFocus(actionRefs, actions.length - 1);
    }
  }

  return (
    <section className="min-h-full bg-[#e6edf2] px-4 py-4 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-xl border border-slate-300 bg-white px-5 py-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-4xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600">
                {eyebrow}
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                {title}
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                {subtitle}
              </p>
            </div>
            <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Workspace Mode
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                Keyboard-first protected shell
              </p>
              <p className="mt-1 text-xs text-slate-600">
                F6 changes zone, arrows move inside lists.
              </p>
            </div>
          </div>
        </div>

        <section className="mt-4 rounded-xl border border-slate-300 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Status Strip
              </p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">
                Operating Snapshot
              </h2>
            </div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-slate-500">
              Read-only counters
            </p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            {stats.map((item, index) => (
              <StatRow key={item.label} item={item} index={index} />
            ))}
          </div>
        </section>

        <section className="mt-4 rounded-xl border border-slate-300 bg-white shadow-sm">
          <div className="border-b border-slate-300 px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Action Workspace
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">
                  Operator Action Queue
                </h2>
              </div>
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-slate-500">
                Up or Down moves between actions
              </p>
            </div>
          </div>

          <div>
            {actions.map((action, index) => (
              <ActionRow
                key={action.title}
                action={action}
                index={index}
                refs={actionRefs}
                onKeyDown={handleActionKeyDown}
              />
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
