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
  "Alt+Shift+F Search Target",
  "Arrow Keys Move Through Lists",
  "Alt+A Action Rail",
  "Alt+C Work Canvas",
  "Alt+R Refresh",
  "Ctrl+K Command Bar",
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
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="grid gap-4">
          {summarySection ? <ErpSectionCard {...summarySection} /> : null}
          {filterSection ? <ErpSectionCard {...filterSection} tone="accent" /> : null}
          {sideSection ? <ErpSectionCard {...sideSection} /> : null}
        </div>

        <div className="grid gap-4">
          {listSection ? (
            <ErpSectionCard {...listSection} className="min-h-[480px]" />
          ) : null}
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
