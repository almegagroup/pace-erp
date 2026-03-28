import ErpScreenScaffold, {
  ErpSectionCard,
} from "./ErpScreenScaffold.jsx";

export default function ErpApprovalReviewTemplate({
  eyebrow,
  title,
  description,
  actions = [],
  notices = [],
  metrics = [],
  summarySection = null,
  filterSection = null,
  reviewSection = null,
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

      {(filterSection || reviewSection || sideSection) ? (
        <div className={summarySection ? "mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]" : "grid gap-6 xl:grid-cols-[1.15fr_0.85fr]"}>
          <div className="grid gap-6">
            {filterSection ? <ErpSectionCard {...filterSection} /> : null}
            {reviewSection ? <ErpSectionCard {...reviewSection} /> : null}
          </div>

          {sideSection ? <ErpSectionCard {...sideSection} /> : null}
        </div>
      ) : null}

      {bottomSection ? <div className="mt-6">{bottomSection}</div> : null}
    </ErpScreenScaffold>
  );
}
