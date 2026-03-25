import EnterpriseDashboard from "../../../components/dashboard/EnterpriseDashboard.jsx";
import { openScreen } from "../../../navigation/screenStackEngine.js";

export default function SAHome() {
  const stats = [
    {
      label: "Companies",
      value: "24",
      tag: "Live",
    },
    {
      label: "Users",
      value: "312",
      tag: "Active",
    },
    {
      label: "Pending Signups",
      value: "08",
      tag: "Queue",
    },
    {
      label: "Snapshot Health",
      value: "99.2%",
      tag: "Runtime",
    },
  ];

  const actions = [
    {
      badge: "Provision",
      title: "Create Company",
      description: "Launch the company setup workspace for a fresh operational entity.",
      onClick: () => openScreen("SA_COMPANY_CREATE"),
    },
    {
      badge: "Govern",
      title: "User Control",
      description: "Review users, role posture, and lifecycle state from the admin control surface.",
      onClick: () => openScreen("SA_USERS"),
    },
    {
      badge: "Approve",
      title: "Signup Requests",
      description: "Process incoming signup approvals with a clear enterprise review queue.",
      onClick: () => openScreen("SA_SIGNUP_REQUESTS"),
    },
  ];

  return (
    <EnterpriseDashboard
      eyebrow="Super Admin Command"
      title="Super Admin Dashboard"
      subtitle="Use the shortcuts below to move into company setup, user control, and signup review."
      stats={stats}
      actions={actions}
    />
  );
}
