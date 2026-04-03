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
  description,
  actions = [],
  notices = [],
  metrics = [],
  formEyebrow = "Entry Form",
  formTitle,
  formDescription,
  formContent,
  sideContent,
  bottomContent,
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
        <div
          className={`grid gap-4 ${
            sideContent ? "xl:grid-cols-[minmax(0,1.5fr)_360px]" : "grid-cols-1"
          }`}
        >
          <ErpSectionCard
            eyebrow={formEyebrow}
            title={formTitle}
            description={formDescription}
            tone="accent"
          >
            {formContent}
          </ErpSectionCard>

          {sideContent ? (
            <ErpSectionCard
              eyebrow="Workspace Tools"
              title="Context Rail"
              description="Keep helper data, search anchors, and last action context beside the worksheet."
            >
              <div className="grid gap-2">{sideContent}</div>
            </ErpSectionCard>
          ) : null}
        </div>

        {bottomContent ? <div>{bottomContent}</div> : null}
      </div>
    </ErpScreenScaffold>
  );
}
