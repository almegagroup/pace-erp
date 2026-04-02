import HrWorkflowFoundationPage from "../HrWorkflowFoundationPage.jsx";

export default function OutWorkRegisterPage() {
  return (
    <HrWorkflowFoundationPage
      eyebrow="HR Management"
      title="Out Work Register"
      description="Management and HR oversight view for out-work cases, with destination-aware reporting and no dependency on approver status."
      metrics={[
        { label: "Audience", value: "HR / Management", caption: "Plant manager, director, HR as permitted by ACL.", tone: "sky" },
        { label: "Decision Power", value: "Separate", caption: "Read authority does not imply approval authority.", tone: "amber" },
        { label: "Coverage", value: "Cross-user", caption: "Wider than employee or approver-only pages.", tone: "emerald" },
        { label: "Destination Lens", value: "Reporting", caption: "Supports later destination analysis.", tone: "slate" },
      ]}
      notices={[
        {
          tone: "neutral",
          message:
            "This register is the right place for managerial visibility when someone is not an approver but still needs to monitor cases.",
        },
      ]}
      actions={[
        { key: "refresh", label: "Refresh", hint: "Alt+R", tone: "neutral" },
        { key: "open-history", label: "Approval History", hint: "Alt+H", tone: "primary" },
      ]}
      footerHints={[
        "Reporting access is ACL-driven",
        "Destination analytics can land here later",
        "Approver rights remain separate",
      ]}
      policyTitle="Reporting Law"
      policyDescription="Out-work register supports observation and audit, not inbox-style approval action."
      policyFields={[
        { label: "Viewer Type", value: "Observer / manager / HR", caption: "May be approver or non-approver." },
        { label: "Approver Needed", value: "No", caption: "Register visibility is separate from approver-map." },
        { label: "Use Case", value: "Review and oversight", caption: "Not active decision processing." },
      ]}
      workspaceTitle="Register Layout"
      workspaceDescription="This page should later expose filters by employee, destination, date window, and status."
      workspaceFields={[
        { label: "Destination Filter", value: "Planned", caption: "Critical for observation pattern you described." },
        { label: "Employee Search", value: "Planned", caption: "Specific user trail lookup can live here." },
        { label: "Decision Snapshot", value: "Visible", caption: "Latest approval outcome and trail summary." },
      ]}
      routingTitle="Authority Split"
      routingDescription="Reporting access remains different from approval authority."
      routingFields={[
        { label: "Approver", value: "Can decide", caption: "Only if approver rule grants action authority." },
        { label: "Observer", value: "Can read", caption: "Management visibility without decision power." },
        { label: "ACL Target", value: "READ grant", caption: "Separate reporting permission path." },
      ]}
      historyTitle="Operational Follow-up"
      historyDescription="This page becomes the broad reporting surface for out-work just as leave register does for leave."
      historyFields={[
        { label: "Pattern Reuse", value: "Matches leave register", caption: "Consistent HR governance design." },
        { label: "Observation", value: "Destination-aware", caption: "Better for later incident/specific case review." },
        { label: "Export / Reports", value: "Later phase", caption: "Can become downloadable reporting surface." },
      ]}
    />
  );
}
