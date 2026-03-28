import ErpScreenScaffold, {
  ErpSectionCard,
} from "./ErpScreenScaffold.jsx";

export default function ErpEntryFormTemplate({
  eyebrow,
  title,
  description,
  actions = [],
  notices = [],
  metrics = [],
  formEyebrow = "Entry Form",
  formTitle,
  formDescription,
  formContent,
  sideContent,
  bottomContent,
}) {
  return (
    <ErpScreenScaffold
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={actions}
      notices={notices}
      metrics={metrics}
    >
      <div className="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
        <ErpSectionCard
          eyebrow={formEyebrow}
          title={formTitle}
          description={formDescription}
        >
          {formContent}
        </ErpSectionCard>

        <div className="grid gap-6">
          {sideContent}
        </div>
      </div>

      {bottomContent ? <div className="mt-6">{bottomContent}</div> : null}
    </ErpScreenScaffold>
  );
}
