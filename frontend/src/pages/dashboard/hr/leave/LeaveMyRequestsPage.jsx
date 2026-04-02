import HrWorkflowFoundationPage from "../HrWorkflowFoundationPage.jsx";

export default function LeaveMyRequestsPage() {
  return (
    <HrWorkflowFoundationPage
      eyebrow="HR Management"
      title="My Leave Requests"
      description="Employee own leave request history with status tracking and pending-stage cancellation."
      metrics={[
        { label: "Viewer", value: "Self", caption: "Only own leave requests appear here.", tone: "sky" },
        { label: "Cancel", value: "Pending", caption: "Decision ashar age cancel allowed.", tone: "amber" },
        { label: "Status Trail", value: "Full", caption: "Submitted, approved, rejected, cancelled all visible.", tone: "emerald" },
        { label: "Company Scope", value: "Parent HR", caption: "Same HR scope as leave apply.", tone: "slate" },
      ]}
      notices={[
        {
          tone: "info",
          message:
            "This history page is business-facing. It will later read request ledger rows instead of static placeholders.",
        },
      ]}
      actions={[
        { key: "refresh", label: "Refresh", hint: "Alt+R", tone: "neutral" },
        { key: "open-apply", label: "Open Apply", hint: "Alt+A", tone: "primary" },
      ]}
      footerHints={[
        "Self history only",
        "Pending cancel remains available",
        "Approver history stays in separate page",
      ]}
      policyTitle="History Contract"
      policyDescription="This page does not approve anything. It only shows request lifecycle from employee perspective."
      policyFields={[
        { label: "Visible Rows", value: "Own requests only", caption: "Cross-user visibility না." },
        { label: "Status", value: "Pending / Approved / Rejected / Cancelled", caption: "Canonical request states." },
        { label: "Cancel Trigger", value: "Before first decision", caption: "Once any decision lands, cancel closes." },
      ]}
      workspaceTitle="Request Ledger"
      workspaceDescription="Each row will expose request dates, days, reason, created time, and current status."
      workspaceFields={[
        { label: "Date Range", value: "From / To", caption: "Original leave period." },
        { label: "Day Count", value: "Stored snapshot", caption: "Submit-time computed value." },
        { label: "Decision Snapshot", value: "Latest decision summary", caption: "Approver timeline summary." },
      ]}
      routingTitle="Decision Visibility"
      routingDescription="Employee should know what happened to the request, but cannot alter routing from this screen."
      routingFields={[
        { label: "Inbox Visibility", value: "No", caption: "Approver inbox is separate." },
        { label: "Timeline", value: "Readable", caption: "Who acted and when will show here." },
        { label: "Reopen", value: "No", caption: "Cancelled or rejected requests remain historical only." },
      ]}
      historyTitle="Next Steps"
      historyDescription="This page becomes the user's permanent audit trail for leave."
      historyFields={[
        { label: "Apply Again", value: "New request", caption: "Fresh request uses leave apply page." },
        { label: "Approval Scope", value: "Separate page", caption: "Approvers use approval scope history." },
        { label: "HR Register", value: "Supervisor/HR", caption: "Management reporting stays in register page." },
      ]}
    />
  );
}
