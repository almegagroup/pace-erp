import HrWorkflowFoundationPage from "../HrWorkflowFoundationPage.jsx";

export default function OutWorkApplyPage() {
  return (
    <HrWorkflowFoundationPage
      eyebrow="HR Management"
      title="Out Work Apply"
      description="Users record official company work outside the office. Workflow stays close to leave, but destination becomes a reusable company-owned master."
      metrics={[
        { label: "Purpose", value: "Office External Work", caption: "Leave na, company kajer baire movement.", tone: "sky" },
        { label: "Destination", value: "Reusable", caption: "Company-wise dropdown plus user-created option.", tone: "emerald" },
        { label: "Backdate Window", value: "3 Days", caption: "Leave-like date validation can stay aligned initially.", tone: "amber" },
        { label: "Cancel Rule", value: "Pending Only", caption: "Decision ashar age cancel allowed.", tone: "slate" },
      ]}
      notices={[
        {
          tone: "info",
          message:
            "Destination create modal is part of this module foundation. User can add a new company-scoped destination when preferred one is missing.",
        },
      ]}
      actions={[
        { key: "refresh", label: "Refresh", hint: "Alt+R", tone: "neutral" },
        { key: "new-draft", label: "New Draft", hint: "Alt+D", tone: "primary" },
      ]}
      footerHints={[
        "Destination stays company-scoped",
        "Create destination via modal",
        "Approval law can mirror leave initially",
      ]}
      policyTitle="Out Work Request Law"
      policyDescription="This request pattern stays close to leave but carries business travel destination context."
      policyFields={[
        { label: "Date Range", value: "From / To", caption: "Out work period." },
        { label: "Days", value: "Auto-calculated", caption: "Derived from date span." },
        { label: "Destination", value: "Dropdown + create modal", caption: "User can add missing destination." },
      ]}
      workspaceTitle="Destination Capture"
      workspaceDescription="The page should help future case observation by preserving destination identity and address."
      workspaceFields={[
        { label: "Destination Name", value: "Master-backed", caption: "Preferred reusable label." },
        { label: "Address", value: "Stored with destination", caption: "Essential for later review and audit." },
        { label: "Create Modal", value: "Name + address", caption: "Adds reusable company destination." },
      ]}
      routingTitle="Approval Routing"
      routingDescription="Out Work approval can largely mirror leave, but still remains its own exact resource scope."
      routingFields={[
        { label: "Rule Source", value: "Approver rule engine", caption: "Can reuse same approvers with separate resource codes." },
        { label: "Parent Company", value: "HR-style governance", caption: "If policy stays aligned with leave." },
        { label: "Later Audit", value: "Destination-aware", caption: "Specific destination history becomes searchable later." },
      ]}
      historyTitle="Request Trail"
      historyDescription="Employee history, approver history, and register pages will mirror the leave pattern."
      historyFields={[
        { label: "My Requests", value: "Own out work history", caption: "Status and cancel support." },
        { label: "Approval Scope", value: "Approver history", caption: "Scope-wide visibility stays intact." },
        { label: "Register", value: "Management oversight", caption: "Destination-aware reporting surface." },
      ]}
    />
  );
}
