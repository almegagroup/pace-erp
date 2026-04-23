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
  "Enter Open Row",
  "Alt+A Action Rail",
  "Alt+C Work Canvas",
  "Alt+R Or F4 Refresh",
  "Esc Back",
  "Ctrl+K Or F9 Command Bar",
]);

export default function ErpMasterListTemplate({
  eyebrow,
  title,
  actions = [],
  notices = [],
  filterSection = null,
  listSection = null,
  bottomSection = null,
  footerHints = DEFAULT_FOOTER_HINTS,
}) {
  return (
    <ErpScreenScaffold
      eyebrow={eyebrow}
      title={title}
      actions={actions}
      notices={notices}
      footerHints={footerHints}
    >
      <div className="grid gap-4">
        {filterSection ? <ErpSectionCard {...filterSection} tone="accent" /> : null}
        {listSection ? (
          <ErpSectionCard {...listSection} className="min-h-[560px]" />
        ) : null}
        {bottomSection ? <div>{bottomSection}</div> : null}
      </div>
    </ErpScreenScaffold>
  );
}
