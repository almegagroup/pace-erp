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
        "Alt+Shift+F Or F3 Filter Target",
        "Arrow Keys Move Review Queue",
        "Esc Close Or Back",
        "Ctrl+K Or F9 Command Bar",
      ]}
    >
      <div className="grid gap-4">
        {filterSection ? <ErpSectionCard {...filterSection} tone="accent" /> : null}
        <div
          className={`grid gap-4 ${
            sideSection || summarySection
              ? "xl:grid-cols-[minmax(0,1.45fr)_360px]"
              : "grid-cols-1"
          }`}
        >
          <div className="min-w-0">
            {reviewSection ? (
              <ErpSectionCard {...reviewSection} className="min-h-[560px]" />
            ) : null}
          </div>
          {sideSection || summarySection ? (
            <div className="grid gap-4">
              {sideSection ? <ErpSectionCard {...sideSection} tone="accent" /> : null}
              {summarySection ? <ErpSectionCard {...summarySection} /> : null}
            </div>
          ) : null}
        </div>
        {bottomSection ? <div>{bottomSection}</div> : null}
      </div>
    </ErpScreenScaffold>
  );
}
