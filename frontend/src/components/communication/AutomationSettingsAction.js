/** Creates an existing ERP action-strip descriptor only after server approval. */
export function createAutomationSettingsAction({ visible, onClick }) {
  if (visible !== true) return null;
  return {
    key: "automation-settings",
    label: "Automation Settings",
    tone: "neutral",
    onClick,
  };
}
