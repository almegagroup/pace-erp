import EnterpriseDashboard from "../../../components/dashboard/EnterpriseDashboard.jsx";
import { openScreen } from "../../../navigation/screenStackEngine.js";

export default function SAHome() {
  const stats = [
    {
      label: "Companies",
      value: "24",
      tag: "Landscape",
      helper: "Multi-company operating units aligned under the central governance model.",
    },
    {
      label: "Users",
      value: "312",
      tag: "Identity",
      helper: "Provisioned workforce identities ready for lifecycle, access, and audit control.",
    },
    {
      label: "Pending Signups",
      value: "08",
      tag: "Queue",
      helper: "Requests waiting for approval before onboarding into the secured ERP boundary.",
    },
    {
      label: "Snapshot Health",
      value: "99.2%",
      tag: "Runtime",
      helper: "Menu and access snapshots are serving from the current administrative baseline.",
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

  const feedRows = [
    {
      title: "North Cluster rollout is ready for activation",
      detail: "Governance checks cleared. Waiting for final admin sign-off.",
      status: "Ready",
    },
    {
      title: "Quarter close user review window opened",
      detail: "Privilege and assignment review cycle is now live across all companies.",
      status: "Live",
    },
    {
      title: "Signup queue remained within SLA today",
      detail: "Approval latency held under the expected enterprise threshold.",
      status: "Stable",
    },
  ];

  return (
    <EnterpriseDashboard
      eyebrow="Super Admin Command"
      title="Enterprise governance, identity control, and rollout readiness in one operational cockpit."
      subtitle="Monitor platform posture, move quickly on provisioning decisions, and keep the entire ERP landscape aligned with a single administrative standard."
      stats={stats}
      actions={actions}
      focusTitle="Current Focus"
      focusBody="Prioritize entity provisioning, user governance, and intake approvals. This dashboard is tuned for central admin work where speed matters, but traceability and policy discipline matter even more."
      feedTitle="Control Plane Feed"
      feedRows={feedRows}
    />
  );
}
