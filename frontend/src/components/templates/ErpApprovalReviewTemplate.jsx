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
  actions = [],
  notices = [],
  filterSection = null,
  reviewSection = null,
  bottomSection = null,
  footerHints = [
    "Alt+Shift+F Or F3 Filter Target",
    "Arrow Keys Move Review Queue",
    "Enter Open Row",
    "Alt+R Or F4 Refresh",
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
        {reviewSection ? (
          <ErpSectionCard {...reviewSection} className="min-h-[560px]" />
        ) : null}
        {bottomSection ? <div>{bottomSection}</div> : null}
      </div>
    </ErpScreenScaffold>
  );
}
