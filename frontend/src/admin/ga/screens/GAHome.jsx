import EnterpriseDashboard from "../../../components/dashboard/EnterpriseDashboard.jsx";

export default function GAHome() {
  const stats = [
    {
      label: "Group Companies",
      value: "07",
      tag: "Portfolio",
    },
    {
      label: "Shared Policies",
      value: "18",
      tag: "Standard",
    },
    {
      label: "Open Exceptions",
      value: "05",
      tag: "Attention",
    },
    {
      label: "Operational Readiness",
      value: "96.8%",
      tag: "Health",
    },
  ];

  const actions = [
    {
      badge: "Observe",
      title: "Portfolio Overview",
      description: "Track cross-company readiness and operational posture.",
      onClick: () => {},
    },
    {
      badge: "Align",
      title: "Shared Standards",
      description: "Review the shared standards used across the group.",
      onClick: () => {},
    },
    {
      badge: "Escalate",
      title: "Exception Desk",
      description: "Surface the items that still need follow-up and coordination.",
      onClick: () => {},
    },
  ];

  return (
    <EnterpriseDashboard
      eyebrow="Group Admin View"
      title="Group Admin Dashboard"
      subtitle="Keep a simple view of portfolio status, shared standards, and exception follow-up."
      stats={stats}
      actions={actions}
    />
  );
}
