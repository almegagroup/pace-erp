import HrWorkflowFoundationPage from "../HrWorkflowFoundationPage.jsx";

export default function LeaveApprovalInboxPage() {
  return (
    <HrWorkflowFoundationPage
      eyebrow="HR Management"
      title="Leave Approval Inbox"
      description="Pending leave requests waiting for the current approver under exact company, resource, and action rules."
      metrics={[
        { label: "Queue", value: "Pending", caption: "Only requests awaiting current approver scope.", tone: "amber" },
        { label: "Decision", value: "Approve / Reject", caption: "Inbox is action-oriented.", tone: "emerald" },
        { label: "Scope", value: "Approver-only", caption: "Non-approvers should not see this lane.", tone: "sky" },
        { label: "Routing", value: "Stage Aware", caption: "Sequential flow later respects stage order.", tone: "slate" },
      ]}
      notices={[
        {
          tone: "warning",
          message:
            "Approver inbox remains separate from history and reporting pages. This page is for pending decisions only.",
        },
      ]}
      actions={[
        { key: "refresh", label: "Refresh", hint: "Alt+R", tone: "neutral" },
        { key: "focus-queue", label: "Focus Queue", hint: "Alt+Q", tone: "primary" },
      ]}
      footerHints={[
        "Pending approvals only",
        "Exact resource/action rules apply",
        "History remains visible even after decision elsewhere",
      ]}
      policyTitle="Decision Gate"
      policyDescription="This page is where approvers act. It should never become a reporting-only list."
      policyFields={[
        { label: "Allowed Actions", value: "APPROVE / REJECT", caption: "Later optional comments can attach." },
        { label: "Decision Rule", value: "Workflow + ACL", caption: "Approver must also hold approve permission." },
        { label: "Self Approval", value: "Blocked", caption: "Requester cannot approve own case." },
      ]}
      workspaceTitle="Pending Case Grid"
      workspaceDescription="Each pending row will show requester, period, days, reason, and current route stage."
      workspaceFields={[
        { label: "Requester", value: "User profile snapshot", caption: "Requester identity at submit time." },
        { label: "Leave Span", value: "Date range + days", caption: "Core request summary for fast review." },
        { label: "Route Stage", value: "Current pending stage", caption: "Important for sequential approval." },
      ]}
      routingTitle="Approver Law"
      routingDescription="ANYONE, SEQUENTIAL, and MUST_ALL will all eventually land here with different behavior."
      routingFields={[
        { label: "ANYONE", value: "Any listed approver may close stage", caption: "Others still see history later." },
        { label: "SEQUENTIAL", value: "Order enforced", caption: "Later stage waits for earlier stage." },
        { label: "MUST_ALL", value: "All listed approvers", caption: "Stage closes only when all act." },
      ]}
      historyTitle="After Decision"
      historyDescription="Once acted, the row leaves inbox but remains visible in approval scope history."
      historyFields={[
        { label: "Post-Decision", value: "Moves to scope history", caption: "Approver can still review later." },
        { label: "Employee View", value: "My Leave Requests", caption: "Requester sees updated status there." },
        { label: "HR Oversight", value: "Leave Register", caption: "Management/reporting page remains separate." },
      ]}
    />
  );
}
