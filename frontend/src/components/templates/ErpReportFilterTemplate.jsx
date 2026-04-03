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
        "Alt+Shift+F Or F3 Filter Target",
        "Arrow Keys Traverse Reports",
        "Alt+R Or F4 Refresh Report",
        "Ctrl+K Or F9 Command Bar",
      ]}
    >
      <div className="grid gap-4">
        {filterSection ? <ErpSectionCard {...filterSection} tone="accent" /> : null}
        <div
          className={`grid gap-4 ${
            summarySection || sideSection
              ? "xl:grid-cols-[minmax(0,1.45fr)_360px]"
              : "grid-cols-1"
          }`}
        >
          <div className="min-w-0">
            {reportSection ? (
              <ErpSectionCard {...reportSection} className="min-h-[560px]" />
            ) : null}
          </div>
          {summarySection || sideSection ? (
            <div className="grid gap-4">
              {summarySection ? <ErpSectionCard {...summarySection} /> : null}
              {sideSection ? <ErpSectionCard {...sideSection} /> : null}
            </div>
          ) : null}
        </div>
        {bottomSection ? <div>{bottomSection}</div> : null}
      </div>
    </ErpScreenScaffold>
  );
}
