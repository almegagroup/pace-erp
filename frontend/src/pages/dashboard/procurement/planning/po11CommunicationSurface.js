export const PO11_COMMUNICATION_PAGE = Object.freeze({
  txCode: "PO11",
  resourceCode: "PROC_PLANNING_VIEW",
  companyScoped: true,
});

const PO11_SURFACE_BY_TAB = Object.freeze({
  dashboard: "planning_dashboard",
  input: "monthly_plan_input",
  sloc: "sloc_group_setup",
  item: "item_group_setup",
  history: "history_archive",
});

export function resolvePO11CommunicationSurface({ showFullReport, activeTab }) {
  if (showFullReport === true) return "report_view";
  return PO11_SURFACE_BY_TAB[activeTab] ?? null;
}
