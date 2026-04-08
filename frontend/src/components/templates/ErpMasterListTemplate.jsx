/*
 * File-ID: 9.12-FRONT
 * File-Path: frontend/src/components/templates/ErpMasterListTemplate.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Provide the keyboard-native master list template with fixed control rail and dense work canvas
 * Authority: Frontend
 */

import ErpScreenScaffold, {
  ErpSectionCard,
} from "./ErpScreenScaffold.jsx";

const DEFAULT_FOOTER_HINTS = Object.freeze([
  "Alt+Shift+F Or F3 Search Target",
  "Arrow Keys Move Through Lists",
  "Alt+A Action Rail",
  "Alt+C Work Canvas",
  "Alt+R Or F4 Refresh",
  "Ctrl+K Or F9 Command Bar",
]);

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
  sideSection = null,
  footerHints = DEFAULT_FOOTER_HINTS,
}) {
  return (
    <ErpScreenScaffold
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={actions}
      notices={notices}
      metrics={metrics}
      footerHints={footerHints}
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
            {listSection ? (
              <ErpSectionCard {...listSection} className="min-h-[560px]" />
            ) : null}
          </div>
          {sideSection || summarySection ? (
            <div className="grid gap-4">
              {sideSection ? <ErpSectionCard {...sideSection} /> : null}
              {summarySection ? <ErpSectionCard {...summarySection} /> : null}
            </div>
          ) : null}
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
