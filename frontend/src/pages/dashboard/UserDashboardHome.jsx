import EnterpriseDashboard from "../../components/dashboard/EnterpriseDashboard.jsx";

export default function UserDashboardHome() {
  const stats = [
    {
      label: "My Tasks",
      value: "14",
      tag: "Queue",
      helper: "Work items currently assigned to you across approval, review, and execution stages.",
    },
    {
      label: "Approvals Today",
      value: "06",
      tag: "Flow",
      helper: "Transactions that reached your desk during the current working cycle.",
    },
    {
      label: "Module Access",
      value: "09",
      tag: "Scope",
      helper: "Business workspaces available to your role in the current company context.",
    },
    {
      label: "Execution Pace",
      value: "91%",
      tag: "Trend",
      helper: "Operational throughput against the expected benchmark for today.",
    },
  ];

  const actions = [
    {
      badge: "Work",
      title: "Priority Queue",
      description: "Start with the highest-impact tasks waiting for your action right now.",
      onClick: () => {},
    },
    {
      badge: "Review",
      title: "Approvals Board",
      description: "See pending approvals and keep the workflow lane moving without delays.",
      onClick: () => {},
    },
    {
      badge: "Track",
      title: "Performance Signals",
      description: "Watch execution progress, bottlenecks, and throughput indicators in one place.",
      onClick: () => {},
    },
  ];

  const feedRows = [
    {
      title: "Two approvals are nearing the SLA threshold",
      detail: "Review the oldest items first to keep the process lane healthy.",
      status: "Watch",
    },
    {
      title: "Inventory workflow completed without exception",
      detail: "The latest operational batch closed cleanly and is ready for posting.",
      status: "Done",
    },
    {
      title: "Department queue is lighter than yesterday",
      detail: "Current workload suggests space to clear backlog before close of day.",
      status: "Good",
    },
  ];

  return (
    <EnterpriseDashboard
      eyebrow="Operational Workspace"
      title="Move through your daily ERP work with a clearer queue, faster decisions, and fewer blind spots."
      subtitle="Built for execution teams who need a calm, high-signal workspace. Keep the day organized, see what matters first, and push work forward without losing process discipline."
      stats={stats}
      actions={actions}
      focusTitle="Current Focus"
      focusBody="Treat this as your enterprise launchpad. Start with urgent tasks, watch throughput, and keep approval bottlenecks from slowing down the rest of the organization."
      feedTitle="Execution Feed"
      feedRows={feedRows}
    />
  );
}
