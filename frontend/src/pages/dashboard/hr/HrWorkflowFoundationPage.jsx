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
  description,
  metrics,
  notices,
  actions,
  footerHints,
  policyTitle,
  policyDescription,
  policyFields,
  workspaceTitle,
  workspaceDescription,
  workspaceFields,
  routingTitle,
  routingDescription,
  routingFields,
  historyTitle,
  historyDescription,
  historyFields,
}) {
  return (
    <ErpScreenScaffold
      eyebrow={eyebrow}
      title={title}
      description={description}
      metrics={metrics}
      notices={notices}
      actions={actions}
      footerHints={footerHints}
    >
      <ErpSectionCard
        eyebrow="Policy Frame"
        title={policyTitle}
        description={policyDescription}
        tone="accent"
      >
        {renderFieldPreviews(policyFields)}
      </ErpSectionCard>

      <ErpSectionCard
        eyebrow="Workspace"
        title={workspaceTitle}
        description={workspaceDescription}
      >
        {renderFieldPreviews(workspaceFields)}
      </ErpSectionCard>

      <ErpSectionCard
        eyebrow="Approval"
        title={routingTitle}
        description={routingDescription}
        tone="warning"
      >
        {renderFieldPreviews(routingFields)}
      </ErpSectionCard>

      <ErpSectionCard
        eyebrow="History"
        title={historyTitle}
        description={historyDescription}
        tone="success"
      >
        {renderFieldPreviews(historyFields)}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
