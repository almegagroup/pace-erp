import HrWorkflowFoundationPage from "../HrWorkflowFoundationPage.jsx";

export default function OutWorkApprovalInboxPage() {
  return (
    <HrWorkflowFoundationPage
      eyebrow="HR Management"
      title="Out Work Approval Inbox"
      description="Pending out-work cases waiting for decision from the current approver, including destination context."
      metrics={[
        { label: "Queue", value: "Pending", caption: "Only current approver scope cases.", tone: "amber" },
        { label: "Decision", value: "Approve / Reject", caption: "Action happens here.", tone: "emerald" },
        { label: "Destination", value: "Visible", caption: "Approver sees destination before deciding.", tone: "sky" },
        { label: "Stages", value: "Supported", caption: "Future sequential enforcement remains available.", tone: "slate" },
      ]}
      notices={[
        {
          tone: "warning",
          message:
            "Out Work inbox mirrors leave inbox, but destination visibility is mandatory so approvers know where the user went.",
        },
      ]}
      actions={[
        { key: "refresh", label: "Refresh", hint: "Alt+R", tone: "neutral" },
        { key: "focus-queue", label: "Focus Queue", hint: "Alt+Q", tone: "primary" },
      ]}
      footerHints={[
        "Pending decisions only",
        "Destination is part of approval context",
        "History remains readable after closure",
      ]}
      policyTitle="Decision Gate"
      policyDescription="This page is for active pending cases and should not turn into a general history dump."
      policyFields={[
        { label: "Allowed Actions", value: "APPROVE / REJECT", caption: "Same decision pattern as leave." },
        { label: "Destination Check", value: "Required context", caption: "Destination supports business review." },
        { label: "Self Approval", value: "Blocked", caption: "Requester cannot approve own out-work case." },
      ]}
      workspaceTitle="Pending Case Grid"
      workspaceDescription="Each row will later show requester, date span, destination, address, and reason."
      workspaceFields={[
        { label: "Destination", value: "Name + address", caption: "Core context for out-work cases." },
        { label: "Requester", value: "Snapshot", caption: "Requester identity at submit time." },
        { label: "Reason", value: "Visible", caption: "Approver gets business explanation." },
      ]}
      routingTitle="Approver Law"
      routingDescription="ANYONE, SEQUENTIAL, and MUST_ALL patterns stay available exactly like leave."
      routingFields={[
        { label: "ANYONE", value: "Any listed approver", caption: "Others still see scope history." },
        { label: "SEQUENTIAL", value: "Order enforced", caption: "Later stage waits for earlier stage." },
        { label: "MUST_ALL", value: "All listed approvers", caption: "Stage closes after all actions." },
      ]}
      historyTitle="After Decision"
      historyDescription="Closed cases move out of inbox but remain visible to approvers and reporting viewers."
      historyFields={[
        { label: "Approver View", value: "Scope history", caption: "Decision trail remains visible." },
        { label: "Employee View", value: "My Out Work Requests", caption: "Requester sees updated status." },
        { label: "Management View", value: "Out Work Register", caption: "Reporting lane remains separate." },
      ]}
    />
  );
}
