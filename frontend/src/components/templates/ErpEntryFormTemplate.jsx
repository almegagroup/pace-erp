/*
 * File-ID: 9.11-FRONT
 * File-Path: frontend/src/components/templates/ErpEntryFormTemplate.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Provide the keyboard-native entry-form template with fixed work canvas and review rail
 * Authority: Frontend
 */

import ErpScreenScaffold from "./ErpScreenScaffold.jsx";
import ErpSelectionSection from "../forms/ErpSelectionSection.jsx";

const DEFAULT_FOOTER_HINTS = Object.freeze([
  "Tab Next Field",
  "Ctrl+S Save",
  "Esc Cancel",
  "Ctrl+K Command Bar",
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
      <div className="grid gap-[var(--erp-section-gap)]">
        <section className="grid gap-2 border-b border-slate-300 pb-3">
          {formEyebrow ? <ErpSelectionSection label={formEyebrow} /> : null}
          {formTitle ? (
            <div className="text-sm font-semibold text-slate-900">
              {formTitle}
            </div>
          ) : null}
          <div className="grid gap-[var(--erp-form-gap)]">
            {formContent}
          </div>
        </section>

        {bottomContent ? <div>{bottomContent}</div> : null}
      </div>
    </ErpScreenScaffold>
  );
}
