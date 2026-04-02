import HrWorkflowFoundationPage from "../HrWorkflowFoundationPage.jsx";

export default function LeaveApprovalScopeHistoryPage() {
  return (
    <HrWorkflowFoundationPage
      eyebrow="HR Management"
      title="Leave Approval Scope History"
      description="All leave requests where the current user belongs to the approval scope, even when another approver already took the decision."
      metrics={[
        { label: "Visibility", value: "Scope-wide", caption: "Not limited to cases personally decided.", tone: "sky" },
        { label: "Decision Trail", value: "Full", caption: "All approver actions remain readable.", tone: "emerald" },
        { label: "Use Case", value: "Audit", caption: "Approvers track what happened across their scope.", tone: "amber" },
        { label: "Viewer", value: "Approver", caption: "Only approval-scope users should open this page.", tone: "slate" },
      ]}
      notices={[
        {
          tone: "info",
          message:
            "This page follows the clarified business rule: approver scope history means all cases in my approval universe, not only the ones I personally acted on.",
        },
      ]}
      actions={[
        { key: "refresh", label: "Refresh", hint: "Alt+R", tone: "neutral" },
        { key: "open-inbox", label: "Open Inbox", hint: "Alt+I", tone: "primary" },
      ]}
      footerHints={[
        "Scope history is wider than personal decisions",
        "Other approvers' actions stay visible",
        "Good for manager and approver review rhythm",
      ]}
      policyTitle="Scope Meaning"
      policyDescription="If the current user is in the approver list for a case, that case belongs to this history, regardless of who actually decided."
      policyFields={[
        { label: "Example", value: "Ankan + Shyamal cases", caption: "Pradip sees both if he belongs to both approver lists." },
        { label: "Decision Actor", value: "Any approver", caption: "Others' actions still remain visible." },
        { label: "Permission", value: "Read-only history", caption: "Pending action stays in inbox page." },
      ]}
      workspaceTitle="History Ledger"
      workspaceDescription="This page should eventually support filters by requester, status, date span, and decision actor."
      workspaceFields={[
        { label: "Requester Filter", value: "Supported later", caption: "Specific user history search needed." },
        { label: "Decision Timeline", value: "Stage + actor + timestamp", caption: "Full workflow trail." },
        { label: "Current Status", value: "Always visible", caption: "Final state remains attached." },
      ]}
      routingTitle="Approver Experience"
      routingDescription="Approvers need context beyond their own clicks, especially in ANYONE and multi-stage approval cases."
      routingFields={[
        { label: "ANYONE", value: "All candidates keep visibility", caption: "One acts, others still review." },
        { label: "SEQUENTIAL", value: "Earlier stage visible", caption: "Later stages see route progression." },
        { label: "Specific User Lookup", value: "Planned", caption: "Approver can inspect one user's full trail." },
      ]}
      historyTitle="Reporting Tie-in"
      historyDescription="This page is approver-centric. Management-wide reporting will sit in HR register pages."
      historyFields={[
        { label: "Approver View", value: "Scope history", caption: "Operational follow-up and memory aid." },
        { label: "Manager View", value: "Register / report", caption: "Decision authority and reporting stay separate." },
        { label: "Requester View", value: "My Leave Requests", caption: "Employee gets own perspective there." },
      ]}
    />
  );
}
