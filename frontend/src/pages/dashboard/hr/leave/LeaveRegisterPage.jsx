import HrWorkflowFoundationPage from "../HrWorkflowFoundationPage.jsx";

export default function LeaveRegisterPage() {
  return (
    <HrWorkflowFoundationPage
      eyebrow="HR Management"
      title="HR Leave Register"
      description="Parent-company HR and reporting authorities review the broader leave ledger here without turning the page into an approval inbox."
      metrics={[
        { label: "Audience", value: "HR / Reporting", caption: "For HR, plant managers, directors as permitted by ACL.", tone: "sky" },
        { label: "Decision Power", value: "Optional", caption: "Report visibility is separate from approver power.", tone: "amber" },
        { label: "Coverage", value: "Cross-user", caption: "Wider than employee self history.", tone: "emerald" },
        { label: "Scope", value: "Parent HR", caption: "Matches leave governance company universe.", tone: "slate" },
      ]}
      notices={[
        {
          tone: "neutral",
          message:
            "This page is for oversight and reporting. Approver actions still belong in the approval inbox.",
        },
      ]}
      actions={[
        { key: "refresh", label: "Refresh", hint: "Alt+R", tone: "neutral" },
        { key: "open-history", label: "Approval History", hint: "Alt+H", tone: "primary" },
      ]}
      footerHints={[
        "Reporting access != approver authority",
        "Best place for plant-manager and director visibility",
        "Parent-company HR scope remains authoritative",
      ]}
      policyTitle="Reporting Law"
      policyDescription="This register supports observation, search, and management review without changing approval ownership."
      policyFields={[
        { label: "Read Mode", value: "Reporting / audit", caption: "Not meant to replace inbox decisions." },
        { label: "Users Visible", value: "Cross-user", caption: "Controlled by ACL reporting access." },
        { label: "Approver Needed", value: "No", caption: "Viewer may be non-approver but still authorized." },
      ]}
      workspaceTitle="Register Layout"
      workspaceDescription="This page should later expose filters by employee, department, decision state, and date window."
      workspaceFields={[
        { label: "Employee Search", value: "Planned", caption: "Specific user history lookup fits here too." },
        { label: "Department Lens", value: "Planned", caption: "Useful for plant and HR reporting." },
        { label: "Decision Snapshot", value: "Visible", caption: "Latest decision and timeline summary." },
      ]}
      routingTitle="Authority Split"
      routingDescription="Reporting visibility and decision authority are not the same thing."
      routingFields={[
        { label: "Approver", value: "Can decide", caption: "If mapped by approver rules." },
        { label: "Observer", value: "Can read", caption: "Plant manager/director style visibility." },
        { label: "ACL Target", value: "Separate READ grant", caption: "Not approver-map driven." },
      ]}
      historyTitle="Management Follow-up"
      historyDescription="The register becomes the broad operational and audit surface for leave."
      historyFields={[
        { label: "Escalation Checks", value: "Later", caption: "Future SLA/escalation views can live here." },
        { label: "Pattern Reuse", value: "Out Work register", caption: "Same governance pattern can repeat." },
        { label: "Export / Reports", value: "Later phase", caption: "Can become printable/reportable once data exists." },
      ]}
    />
  );
}
