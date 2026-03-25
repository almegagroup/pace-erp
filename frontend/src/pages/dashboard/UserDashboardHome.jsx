import EnterpriseDashboard from "../../components/dashboard/EnterpriseDashboard.jsx";

export default function UserDashboardHome() {
  const stats = [
    {
      label: "My Tasks",
      value: "14",
      tag: "Queue",
    },
    {
      label: "Approvals Today",
      value: "06",
      tag: "Flow",
    },
    {
      label: "Module Access",
      value: "09",
      tag: "Scope",
    },
    {
      label: "Execution Pace",
      value: "91%",
      tag: "Trend",
    },
  ];

  const actions = [
    {
      badge: "Work",
      title: "Priority Queue",
      description: "Start with the highest-priority items waiting for you.",
      onClick: () => {},
    },
    {
      badge: "Review",
      title: "Approvals Board",
      description: "Open the current approval queue and keep work moving.",
      onClick: () => {},
    },
    {
      badge: "Track",
      title: "Performance Signals",
      description: "Track pace, workload, and immediate operational signals.",
      onClick: () => {},
    },
  ];

  return (
    <EnterpriseDashboard
      eyebrow="Operational Workspace"
      title="User Dashboard"
      subtitle="Keep the current work queue, approvals, and access summary in a clean workspace."
      stats={stats}
      actions={actions}
    />
  );
}
