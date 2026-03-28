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
  "Ctrl+S Save Action",
  "Alt+Shift+P Primary Target",
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
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_320px]">
        <div className="grid gap-4">
          <ErpSectionCard
            eyebrow={formEyebrow}
            title={formTitle}
            description={formDescription}
            tone="accent"
          >
            {formContent}
          </ErpSectionCard>

          {bottomContent ? <div>{bottomContent}</div> : null}
        </div>

        <ErpSectionCard
          eyebrow="Reference Rail"
          title="Live Review Context"
          description="Reference values stay fixed on the right while the operator moves down the worksheet."
        >
          <div className="grid gap-2">{sideContent}</div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
