import ErpScreenScaffold, {
  ErpSectionCard,
} from "./ErpScreenScaffold.jsx";

export default function ErpMasterListTemplate({
  eyebrow,
  title,
  description,
  actions = [],
  notices = [],
  metrics = [],
  summarySection = null,
  filterSection = null,
  listSection = null,
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
      {summarySection ? (
        <ErpSectionCard {...summarySection} />
      ) : null}

      {filterSection ? (
        <div className={summarySection ? "mt-6" : ""}>
          <ErpSectionCard {...filterSection} />
        </div>
      ) : null}

      {listSection ? (
        <div className={summarySection || filterSection ? "mt-6" : ""}>
          <ErpSectionCard {...listSection} />
        </div>
      ) : null}
    </ErpScreenScaffold>
  );
}
