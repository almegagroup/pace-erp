/*
 * File-ID: 9.13-FRONT
 * File-Path: frontend/src/components/templates/ErpApprovalReviewTemplate.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Provide the keyboard-native approval and review template on the shared work-canvas grammar
 * Authority: Frontend
 */

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
      footerHints={[
        "Alt+Shift+F Filter Target",
        "Arrow Keys Move Review Queue",
        "Esc Close Or Back",
        "Ctrl+K Command Bar",
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
        <div className="grid gap-4">
          {summarySection ? <ErpSectionCard {...summarySection} /> : null}
          {filterSection ? <ErpSectionCard {...filterSection} tone="accent" /> : null}
        </div>

        <div className="grid gap-4">
          {reviewSection ? (
            <ErpSectionCard {...reviewSection} className="min-h-[480px]" />
          ) : null}
          {bottomSection ? <div>{bottomSection}</div> : null}
        </div>

        {sideSection ? <ErpSectionCard {...sideSection} /> : null}
      </div>
    </ErpScreenScaffold>
  );
}
