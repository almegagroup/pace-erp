/*
 * File-ID: 9.14-FRONT
 * File-Path: frontend/src/components/templates/ErpReportFilterTemplate.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Provide the keyboard-native report and filter template on the shared work-canvas grammar
 * Authority: Frontend
 */

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
      footerHints={[
        "Alt+Shift+F Filter Target",
        "Arrow Keys Traverse Reports",
        "Alt+R Refresh Report",
        "Ctrl+K Command Bar",
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="grid gap-4">
          {summarySection ? <ErpSectionCard {...summarySection} /> : null}
          {filterSection ? <ErpSectionCard {...filterSection} tone="accent" /> : null}
          {sideSection ? <ErpSectionCard {...sideSection} /> : null}
        </div>

        <div className="grid gap-4">
          {reportSection ? (
            <ErpSectionCard {...reportSection} className="min-h-[480px]" />
          ) : null}
          {bottomSection ? <div>{bottomSection}</div> : null}
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
