import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";

function renderFieldPreviews(fields = []) {
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {fields.map((field) => (
        <ErpFieldPreview
          key={field.label}
          label={field.label}
          value={field.value}
          caption={field.caption}
          multiline={field.multiline}
          tone={field.tone}
        />
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
      <ErpSectionCard
        eyebrow="Policy Frame"
        title={policyTitle}
        tone="accent"
      >
        {renderFieldPreviews(policyFields)}
      </ErpSectionCard>

      <ErpSectionCard
        eyebrow="Workspace"
        title={workspaceTitle}
      >
        {renderFieldPreviews(workspaceFields)}
      </ErpSectionCard>

      <ErpSectionCard
        eyebrow="Approval"
        title={routingTitle}
        tone="warning"
      >
        {renderFieldPreviews(routingFields)}
      </ErpSectionCard>

      <ErpSectionCard
        eyebrow="History"
        title={historyTitle}
        tone="success"
      >
        {renderFieldPreviews(historyFields)}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
