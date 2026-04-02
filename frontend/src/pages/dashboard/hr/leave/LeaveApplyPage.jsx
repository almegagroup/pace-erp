import HrWorkflowFoundationPage from "../HrWorkflowFoundationPage.jsx";

export default function LeaveApplyPage() {
  return (
    <HrWorkflowFoundationPage
      eyebrow="HR Management"
      title="Leave Apply"
      description="Users submit leave requests against the HR parent-company universe. Backdated leave stays capped at three days from the current date."
      metrics={[
        {
          label: "Backdate Window",
          value: "3 Days",
          caption: "Current date theke max three days back leave apply allowed.",
          tone: "amber",
        },
        {
          label: "Company Scope",
          value: "Parent HR",
          caption: "Leave always resolves in the HR parent-company lane, not work company runtime.",
          tone: "sky",
        },
        {
          label: "Form Mode",
          value: "Draft",
          caption: "Days auto-calculate from from-date and to-date before submit.",
          tone: "emerald",
        },
        {
          label: "Cancel Rule",
          value: "Pending Only",
          caption: "No approver decision hole request cancel allowed.",
          tone: "slate",
        },
      ]}
      notices={[
        {
          tone: "info",
          message:
            "This is the foundation business page. Next layer will connect it to request tables, auto day math, and actual workflow submit.",
        },
      ]}
      actions={[
        { key: "refresh", label: "Refresh", hint: "Alt+R", tone: "neutral" },
        { key: "new-draft", label: "New Draft", hint: "Alt+D", tone: "primary" },
      ]}
      footerHints={[
        "Leave uses parent-company HR scope",
        "Pending requests stay cancellable",
        "Approval route will follow exact resource rules later",
      ]}
      policyTitle="Leave Request Law"
      policyDescription="Leave request submit page will own request drafting only. Approval policy and approver rules stay separate."
      policyFields={[
        {
          label: "From / To",
          value: "Date range input",
          caption: "User picks leave period here.",
        },
        {
          label: "Days",
          value: "Auto-calculated",
          caption: "Manual entry na, date range theke derived hobe.",
        },
        {
          label: "Reason",
          value: "Required narrative",
          caption: "Business reason without blank submit.",
          multiline: true,
        },
      ]}
      workspaceTitle="Draft Surface"
      workspaceDescription="This page will hold the actual request form, local validation, and final send action."
      workspaceFields={[
        {
          label: "Validation",
          value: "Current date - 3 days max",
          caption: "Older backdate hole submit block.",
        },
        {
          label: "Submit Action",
          value: "SEND_REQUEST",
          caption: "Workflow request create korbe.",
        },
        {
          label: "Default Audience",
          value: "Employee self-service",
          caption: "Each user only own draft/request handle করবে.",
        },
      ]}
      routingTitle="Approval Routing"
      routingDescription="Request submit hole approver rules অনুযায়ী pending queue-তে যাবে."
      routingFields={[
        {
          label: "Approver Source",
          value: "Approver rule engine",
          caption: "Company + module + resource/action scope use হবে.",
        },
        {
          label: "Approval Mode",
          value: "ANYONE / SEQUENTIAL / MUST_ALL",
          caption: "Module and exact resource policy মিলিয়ে final behavior হবে.",
        },
        {
          label: "Escalation",
          value: "Later phase",
          caption: "Timeout বা auto-escalation এখনো wired না.",
        },
      ]}
      historyTitle="User Follow-up"
      historyDescription="Submit-er por request history page and approver scope history page separately request trail দেখাবে."
      historyFields={[
        {
          label: "My Requests",
          value: "Own request history",
          caption: "Employee own leave status দেখবে.",
        },
        {
          label: "Approval Scope History",
          value: "Approver visibility lane",
          caption: "Approver scope-e থাকলে full case history visible.",
        },
        {
          label: "Cancel",
          value: "Pending only",
          caption: "Decision আসার পরে cancel বন্ধ.",
        },
      ]}
    />
  );
}
