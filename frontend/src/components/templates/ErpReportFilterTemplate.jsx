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
  actions = [],
  notices = [],
  filterSection = null,
  reportSection = null,
  bottomSection = null,
  footerHints = [
    "Alt+Shift+F Or F3 Filter Target",
    "Arrow Keys Traverse Reports",
    "Enter Open Row",
    "Alt+R Or F4 Refresh Report",
    "Esc Back",
    "Ctrl+K Or F9 Command Bar",
  ],
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
        {reportSection ? (
          <ErpSectionCard {...reportSection} className="min-h-[560px]" />
        ) : null}
        {bottomSection ? <div>{bottomSection}</div> : null}
      </div>
    </ErpScreenScaffold>
  );
}
