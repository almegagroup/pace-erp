import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../components/templates/ErpScreenScaffold.jsx";
import { openScreen } from "../../../navigation/screenStackEngine.js";

export default function SAOrgBootstrapRetired() {
  return (
    <ErpScreenScaffold
      eyebrow="Org Bootstrap"
      title="Organization Bootstrap UI Retired"
      description="The previous bootstrap UI has been withdrawn. Backend logic is preserved, and a new SA-first workflow will replace this screen later."
      actions={[
        {
          key: "control-panel",
          label: "Control Panel",
          tone: "neutral",
          onClick: () => openScreen("SA_CONTROL_PANEL", { mode: "replace" }),
        },
      ]}
    >
      <ErpSectionCard
        eyebrow="Status"
        title="UI Removed, Logic Preserved"
        description="This workspace is intentionally not active right now. Use the focused SA governance screens while the bootstrap flow is redesigned."
      />
    </ErpScreenScaffold>
  );
}
