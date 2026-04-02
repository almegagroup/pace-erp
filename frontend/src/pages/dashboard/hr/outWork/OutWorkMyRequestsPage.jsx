import HrWorkflowFoundationPage from "../HrWorkflowFoundationPage.jsx";

export default function OutWorkMyRequestsPage() {
  return (
    <HrWorkflowFoundationPage
      eyebrow="HR Management"
      title="My Out Work Requests"
      description="Users track their own out-work requests, status trail, destination, and pending cancellation rights."
      metrics={[
        { label: "Viewer", value: "Self", caption: "Own out-work requests only.", tone: "sky" },
        { label: "Destination", value: "Visible", caption: "Each request keeps destination context.", tone: "emerald" },
        { label: "Cancel", value: "Pending", caption: "No decision hole cancel possible.", tone: "amber" },
        { label: "History", value: "Full", caption: "Submitted through final status timeline.", tone: "slate" },
      ]}
      notices={[
        {
          tone: "info",
          message:
            "This page mirrors Leave history but keeps destination and address trace attached to each out-work request.",
        },
      ]}
      actions={[
        { key: "refresh", label: "Refresh", hint: "Alt+R", tone: "neutral" },
        { key: "open-apply", label: "Open Apply", hint: "Alt+A", tone: "primary" },
      ]}
      footerHints={[
        "Destination snapshot remains visible",
        "Pending cancel stays open",
        "Approval and reporting stay separate",
      ]}
      policyTitle="History Contract"
      policyDescription="User-facing history page only; no approver decision action here."
      policyFields={[
        { label: "Rows", value: "Own requests", caption: "No cross-user visibility." },
        { label: "Destination", value: "Stored snapshot", caption: "Name and address context stay attached." },
        { label: "Status", value: "Pending / Approved / Rejected / Cancelled", caption: "Canonical workflow states." },
      ]}
      workspaceTitle="Request Ledger"
      workspaceDescription="Out-work history should later expose destination filters and timeline details."
      workspaceFields={[
        { label: "Destination Filter", value: "Planned", caption: "Useful when user repeats destinations." },
        { label: "Date Range", value: "Stored", caption: "Request-time period remains visible." },
        { label: "Reason", value: "Readable", caption: "Business justification stays intact." },
      ]}
      routingTitle="Decision Visibility"
      routingDescription="Users need final decision visibility without inheriting approver powers."
      routingFields={[
        { label: "Approver Trail", value: "Readable", caption: "Who acted and when stays visible." },
        { label: "Pending Cancel", value: "Allowed", caption: "Before any decision lands." },
        { label: "Reopen", value: "No", caption: "Closed requests stay historical." },
      ]}
      historyTitle="Next Surfaces"
      historyDescription="Approvers and management will review out-work through their own dedicated pages."
      historyFields={[
        { label: "Approver Inbox", value: "Separate", caption: "Pending queue for approvers only." },
        { label: "Scope History", value: "Separate", caption: "Approver-wide case history." },
        { label: "Register", value: "Management", caption: "Cross-user reporting and oversight." },
      ]}
    />
  );
}
