/*
 * File-ID: 9.11-FRONT
 * File-Path: frontend/src/components/templates/ErpEntryFormTemplate.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Provide the keyboard-native entry-form template with fixed work canvas and review rail
 * Authority: Frontend
 */

import ErpScreenScaffold, {
  ErpSectionCard,
} from "./ErpScreenScaffold.jsx";

const DEFAULT_FOOTER_HINTS = Object.freeze([
  "Enter Next Field",
  "Shift+Enter Previous Field",
  "Alt+PageDown Next Section",
  "Alt+PageUp Previous Section",
  "Ctrl+S Or F2 Save Action",
  "Alt+Shift+P Or F7 Primary Target",
]);

export default function ErpEntryFormTemplate({
  eyebrow,
  title,
  actions = [],
  notices = [],
  formEyebrow = "Entry Form",
  formTitle,
  formContent,
  bottomContent,
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
        <ErpSectionCard
          eyebrow={formEyebrow}
          title={formTitle}
          tone="accent"
        >
          {formContent}
        </ErpSectionCard>

        {bottomContent ? <div>{bottomContent}</div> : null}
      </div>
    </ErpScreenScaffold>
  );
}
