import HrWorkflowFoundationPage from "../HrWorkflowFoundationPage.jsx";

export default function OutWorkApprovalScopeHistoryPage() {
  return (
    <HrWorkflowFoundationPage
      eyebrow="HR Management"
      title="Out Work Approval Scope History"
      description="All out-work cases where the current user belongs to the approver scope, whether or not the user personally made the decision."
      metrics={[
        { label: "Visibility", value: "Scope-wide", caption: "Not limited to personal actions.", tone: "sky" },
        { label: "Destination Trail", value: "Retained", caption: "Case destination remains part of history.", tone: "emerald" },
        { label: "Use Case", value: "Audit", caption: "Approvers review what happened across their scope.", tone: "amber" },
        { label: "Viewer", value: "Approver", caption: "History belongs to approval scope users.", tone: "slate" },
      ]}
      notices={[
        {
          tone: "info",
          message:
            "This page follows the same clarified rule as leave: if the case was in my approver scope, I can review its full history even if someone else acted first.",
        },
      ]}
      actions={[
        { key: "refresh", label: "Refresh", hint: "Alt+R", tone: "neutral" },
        { key: "open-inbox", label: "Open Inbox", hint: "Alt+I", tone: "primary" },
      ]}
      footerHints={[
        "Scope history wider than personal decisions",
        "Destination still visible in closed cases",
        "Good for approver memory and audit",
      ]}
      policyTitle="Scope Meaning"
      policyDescription="Approver scope history is a visibility surface, not merely a personal action log."
      policyFields={[
        { label: "Inclusion Rule", value: "I was an approver candidate", caption: "Enough to see the case later." },
        { label: "Decision Actor", value: "Any approver", caption: "Others' decisions remain visible." },
        { label: "Read Mode", value: "History", caption: "Pending actions stay in inbox page." },
      ]}
      workspaceTitle="History Ledger"
      workspaceDescription="This page will later support requester, destination, status, and actor filters."
      workspaceFields={[
        { label: "Destination Search", value: "Planned", caption: "Specific destination case lookup later." },
        { label: "Requester Search", value: "Planned", caption: "Approver can inspect one user's trail." },
        { label: "Timeline", value: "Stage + actor + time", caption: "Full workflow trail remains readable." },
      ]}
      routingTitle="Approver Experience"
      routingDescription="Out-work approvals need the same wide history visibility as leave."
      routingFields={[
        { label: "ANYONE", value: "All candidates still see case", caption: "One actor closes, others still review." },
        { label: "SEQUENTIAL", value: "Route progression visible", caption: "Stage-by-stage understanding stays possible." },
        { label: "Specific User Full History", value: "Planned", caption: "Matches clarified business need." },
      ]}
      historyTitle="Reporting Tie-in"
      historyDescription="Approver history stays separate from management reporting, but the pattern aligns."
      historyFields={[
        { label: "Approver View", value: "Scope history", caption: "Operational and audit review." },
        { label: "Manager View", value: "Register", caption: "Read/report authority can be broader." },
        { label: "Requester View", value: "My Out Work Requests", caption: "Employee gets own timeline there." },
      ]}
    />
  );
}
