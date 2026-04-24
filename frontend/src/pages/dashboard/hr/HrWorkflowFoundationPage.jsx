import ErpScreenScaffold from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";

function renderDenseFieldRows(fields = []) {
  return (
    <div className="grid gap-1">
      {fields.map((field) => (
        <div
          key={field.label}
          className="grid grid-cols-[180px_1fr] gap-x-3 border-b border-slate-200 py-1 text-sm text-slate-800"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            {field.label}
          </div>
          <div className="min-w-0">
            <div className="font-medium text-slate-900">{field.value}</div>
            {field.caption ? (
              <div className="text-xs text-slate-500">{field.caption}</div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function HrWorkflowFoundationPage({
  eyebrow,
  title,
  notices,
  actions,
  footerHints,
  policyTitle,
  policyFields,
  workspaceTitle,
  workspaceFields,
  routingTitle,
  routingFields,
  historyTitle,
  historyFields,
}) {
  return (
    <ErpScreenScaffold
      eyebrow={eyebrow}
      title={title}
      notices={notices}
      actions={actions}
      footerHints={footerHints}
    >
      <div className="grid gap-[var(--erp-section-gap)]">
        <section className="grid gap-2">
          <ErpSelectionSection label="Policy Frame" />
          <div className="text-sm font-semibold text-slate-900">{policyTitle}</div>
          {renderDenseFieldRows(policyFields)}
        </section>
        <section className="grid gap-2">
          <ErpSelectionSection label="Workspace" />
          <div className="text-sm font-semibold text-slate-900">{workspaceTitle}</div>
          {renderDenseFieldRows(workspaceFields)}
        </section>
        <section className="grid gap-2">
          <ErpSelectionSection label="Approval" />
          <div className="text-sm font-semibold text-slate-900">{routingTitle}</div>
          {renderDenseFieldRows(routingFields)}
        </section>
        <section className="grid gap-2">
          <ErpSelectionSection label="History" />
          <div className="text-sm font-semibold text-slate-900">{historyTitle}</div>
          {renderDenseFieldRows(historyFields)}
        </section>
      </div>
    </ErpScreenScaffold>
  );
}
