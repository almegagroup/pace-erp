import EnterpriseDashboard from "../../../components/dashboard/EnterpriseDashboard.jsx";

export default function GAHome() {
  const stats = [
    {
      label: "Group Companies",
      value: "07",
      tag: "Portfolio",
      helper: "Operating companies currently monitored under the active group governance layer.",
    },
    {
      label: "Shared Policies",
      value: "18",
      tag: "Standard",
      helper: "Common control patterns applied across the group for consistent execution.",
    },
    {
      label: "Open Exceptions",
      value: "05",
      tag: "Attention",
      helper: "Cross-company deviations that require coordination before the next review cycle.",
    },
    {
      label: "Operational Readiness",
      value: "96.8%",
      tag: "Health",
      helper: "Current rollout readiness across departments, modules, and shared workflows.",
    },
  ];

  const actions = [
    {
      badge: "Observe",
      title: "Portfolio Overview",
      description: "Track cross-company readiness, policy drift, and active governance obligations.",
      onClick: () => {},
    },
    {
      badge: "Align",
      title: "Shared Standards",
      description: "Review group-wide standards and verify they remain aligned across business units.",
      onClick: () => {},
    },
    {
      badge: "Escalate",
      title: "Exception Desk",
      description: "Surface operational exceptions that need regional coordination and follow-up.",
      onClick: () => {},
    },
  ];

  const feedRows = [
    {
      title: "Two subsidiaries crossed green readiness threshold",
      detail: "Deployment posture improved after module baseline sync completed overnight.",
      status: "Green",
    },
    {
      title: "One procurement template flagged for harmonization",
      detail: "A group-level process variance was detected during workflow comparison.",
      status: "Review",
    },
    {
      title: "Group audit package prepared for the next cycle",
      detail: "Central summaries are generated and ready for executive review.",
      status: "Prepared",
    },
  ];

  return (
    <EnterpriseDashboard
      eyebrow="Group Admin View"
      title="See the full company portfolio, enforce common standards, and keep shared operations synchronized."
      subtitle="This cockpit is designed for group-level visibility: less raw provisioning, more coordination, exception control, and performance alignment across the business network."
      stats={stats}
      actions={actions}
      focusTitle="Current Focus"
      focusBody="Use this space to track where group standards are holding, where deviations are emerging, and which entities need intervention before those small drifts become execution risks."
      feedTitle="Group Operations Feed"
      feedRows={feedRows}
    />
  );
}
