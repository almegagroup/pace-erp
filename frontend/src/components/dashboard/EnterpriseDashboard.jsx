/*
 * File-ID: 9.1B-FRONT
 * File-Path: frontend/src/components/dashboard/EnterpriseDashboard.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Render keyboard-native protected dashboard workspaces on the shared ERP scaffold
 * Authority: Frontend
 */

import { useRef } from "react";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../templates/ErpScreenScaffold.jsx";
import { handleGridNavigation } from "../../navigation/erpRovingFocus.js";

function ActionCard({ action, index, gridRefs }) {
  const rowIndex = Math.floor(index / 2);
  const columnIndex = index % 2;

  return (
    <button
      ref={(element) => {
        gridRefs.current[rowIndex] ??= [];
        gridRefs.current[rowIndex][columnIndex] = element;
      }}
      data-workspace-primary-focus={index === 0 ? "true" : undefined}
      type="button"
      onClick={action.onClick}
      onKeyDown={(event) =>
        handleGridNavigation(event, {
          rowIndex,
          columnIndex,
          gridRefs: gridRefs.current,
        })
      }
      className="group rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-[0_12px_34px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-[0_18px_42px_rgba(14,116,144,0.12)]"
    >
      <div className="flex items-center justify-between gap-4">
        <span className="rounded-full bg-sky-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
          {action.badge}
        </span>
        <span className="text-slate-300 transition group-hover:text-sky-600">
          {"->"}
        </span>
      </div>
      <h3 className="mt-4 text-lg font-semibold text-slate-900">
        {action.title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {action.description}
      </p>
      {action.hint ? (
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {action.hint}
        </p>
      ) : null}
    </button>
  );
}

export default function EnterpriseDashboard({
  eyebrow,
  title,
  subtitle,
  stats = [],
  actions = [],
  topActions = [],
  notices = [],
  workspaceTitle = "Operator Action Queue",
  workspaceDescription = "Arrow keys move inside the card grid. Enter opens the focused workspace.",
  noteTitle = "Keyboard Grammar",
  noteItems = [],
  summaryTitle = "Workspace Snapshot",
  summaryItems = [],
}) {
  const actionGridRefs = useRef([]);

  const metrics = stats.map((item, index) => ({
    key: item.key ?? `${item.label}-${index}`,
    label: item.label,
    value: item.value,
    caption: item.caption ?? item.tag,
    tone: item.tone ?? "sky",
    badge: item.tag ?? "Live",
  }));

  return (
    <ErpScreenScaffold
      eyebrow={eyebrow}
      title={title}
      description={subtitle}
      actions={topActions}
      notices={notices}
      metrics={metrics}
    >
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <ErpSectionCard
          eyebrow="Action Workspace"
          title={workspaceTitle}
          description={workspaceDescription}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {actions.map((action, index) => (
              <ActionCard
                key={action.title}
                action={action}
                index={index}
                gridRefs={actionGridRefs}
              />
            ))}
          </div>
        </ErpSectionCard>

        <div className="grid gap-6">
          <ErpSectionCard eyebrow="Keyboard Mode" title={noteTitle}>
            <div className="space-y-3">
              {noteItems.map((item) => (
                <div
                  key={item}
                  className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700"
                >
                  {item}
                </div>
              ))}
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Live Summary" title={summaryTitle}>
            <div className="space-y-3">
              {summaryItems.map((item) => (
                <div
                  key={item}
                  className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700"
                >
                  {item}
                </div>
              ))}
            </div>
          </ErpSectionCard>
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
