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
  const rowIndex = index;
  const columnIndex = 0;

  return (
    <button
      ref={(element) => {
        gridRefs.current[rowIndex] ??= [];
        gridRefs.current[rowIndex][columnIndex] = element;
      }}
      data-workspace-primary-focus={index === 0 ? "true" : undefined}
      type="button"
      onClick={action.onClick}
      disabled={action.disabled}
      onKeyDown={(event) =>
        handleGridNavigation(event, {
          rowIndex,
          columnIndex,
          gridRefs: gridRefs.current,
        })
      }
      className={`group grid w-full grid-cols-[100px_minmax(0,1fr)_110px] items-center border px-4 py-3 text-left transition ${
        action.disabled
          ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
          : "border-slate-300 bg-white hover:border-sky-300 hover:bg-sky-50"
      }`}
    >
      <span className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${action.disabled ? "text-slate-400" : "text-sky-700"}`}>
        {action.badge}
      </span>
      <span className="min-w-0">
        <span className={`block text-sm font-semibold ${action.disabled ? "text-slate-500" : "text-slate-900"}`}>
          {action.title}
        </span>
        <span className={`mt-1 block truncate text-xs ${action.disabled ? "text-slate-400" : "text-slate-500"}`}>
          {action.description}
        </span>
      </span>
      <span className={`justify-self-end text-[10px] font-semibold uppercase tracking-[0.16em] transition ${action.disabled ? "text-slate-400" : "text-slate-500 group-hover:text-sky-700"}`}>
        {action.hint || "Enter"}
      </span>
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
      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <ErpSectionCard
          eyebrow="Action Workspace"
          title={workspaceTitle}
          description={workspaceDescription}
        >
          <div className="grid gap-2">
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

        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Keyboard Mode" title={noteTitle}>
            <div className="grid gap-2">
              {noteItems.map((item) => (
                <div
                  key={item}
                  className="border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
                >
                  {item}
                </div>
              ))}
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Live Summary" title={summaryTitle}>
            <div className="grid gap-2">
              {summaryItems.map((item) => (
                <div
                  key={item}
                  className="border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
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
