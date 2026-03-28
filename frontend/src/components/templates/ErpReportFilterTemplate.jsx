import ErpScreenScaffold, {
  ErpSectionCard,
} from "./ErpScreenScaffold.jsx";

export default function ErpReportFilterTemplate({
  eyebrow,
  title,
  description,
  actions = [],
  notices = [],
  metrics = [],
 summarySection = null,
  filterSection = null,
  reportSection = null,
  sideSection = null,
  bottomSection = null,
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
      {summarySection ? <ErpSectionCard {...summarySection} /> : null}

      {(filterSection || reportSection || sideSection) ? (
        <div className={summarySection ? "mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]" : "grid gap-6 xl:grid-cols-[0.9fr_1.1fr]"}>
          <div className="grid gap-6">
            {filterSection ? <ErpSectionCard {...filterSection} /> : null}
            {sideSection ? <ErpSectionCard {...sideSection} /> : null}
          </div>

          {reportSection ? <ErpSectionCard {...reportSection} /> : null}
        </div>
      ) : null}

      {bottomSection ? <div className="mt-6">{bottomSection}</div> : null}
    </ErpScreenScaffold>
  );
}
