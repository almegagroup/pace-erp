import {
  isCommunicationActionVisibilityQueryEnabled,
  isCommunicationActionVisible,
} from "./useCommunicationActionVisibility.js";
import {
  buildAutomationSettingsContextKey,
  isAutomationSettingsDrawerOpenForContext,
} from "./automationDrawerContext.js";
import {
  PO11_COMMUNICATION_PAGE,
  resolvePO11CommunicationSurface,
} from "../pages/dashboard/procurement/planning/po11CommunicationSurface.js";

function assertEquals<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("runtime action remains hidden until a successful visible response", () => {
  assertEquals(
    isCommunicationActionVisible({
      status: "pending",
      data: { visible: true },
    }),
    false,
  );
  assertEquals(
    isCommunicationActionVisible({ status: "error", data: { visible: true } }),
    false,
  );
  assertEquals(
    isCommunicationActionVisible({
      status: "success",
      data: { visible: false },
    }),
    false,
  );
  assertEquals(
    isCommunicationActionVisible({
      status: "success",
      data: { visible: true },
    }),
    true,
  );
});

Deno.test("runtime visibility query requires company only for company-scoped pages", () => {
  const common = {
    txCode: "PO11",
    resourceCode: "PROC_PLANNING_VIEW",
    surfaceKey: "planning_dashboard",
    channel: "EMAIL",
  };
  assertEquals(
    isCommunicationActionVisibilityQueryEnabled({
      ...common,
      companyScoped: true,
    }),
    false,
  );
  assertEquals(
    isCommunicationActionVisibilityQueryEnabled({
      ...common,
      companyScoped: false,
    }),
    true,
  );
  assertEquals(
    isCommunicationActionVisibilityQueryEnabled({
      ...common,
      companyScoped: true,
      companyId: "company-a",
    }),
    true,
  );
});

Deno.test("automation drawer is bound to the context that explicitly opened it", () => {
  const dashboardCompanyA = buildAutomationSettingsContextKey({
    companyId: "company-a",
    surfaceKey: "planning_dashboard",
    companyScoped: true,
  });
  const inputCompanyA = buildAutomationSettingsContextKey({
    companyId: "company-a",
    surfaceKey: "monthly_plan_input",
    companyScoped: true,
  });
  const reportCompanyA = buildAutomationSettingsContextKey({
    companyId: "company-a",
    surfaceKey: "report_view",
    companyScoped: true,
  });
  const dashboardCompanyB = buildAutomationSettingsContextKey({
    companyId: "company-b",
    surfaceKey: "planning_dashboard",
    companyScoped: true,
  });

  // Dashboard opens only after the user clicks its action.
  assertEquals(
    isAutomationSettingsDrawerOpenForContext({
      openedContextKey: dashboardCompanyA,
      currentContextKey: dashboardCompanyA,
    }),
    true,
  );

  // A successful new-surface/company visibility response cannot reopen this
  // drawer because it retains the old opening context key.
  assertEquals(
    isAutomationSettingsDrawerOpenForContext({
      openedContextKey: dashboardCompanyA,
      currentContextKey: inputCompanyA,
    }),
    false,
  );
  assertEquals(
    isAutomationSettingsDrawerOpenForContext({
      openedContextKey: dashboardCompanyA,
      currentContextKey: reportCompanyA,
    }),
    false,
  );
  assertEquals(
    isAutomationSettingsDrawerOpenForContext({
      openedContextKey: dashboardCompanyA,
      currentContextKey: dashboardCompanyB,
    }),
    false,
  );
});

Deno.test("PO11 resolves every stable runtime surface without label matching", () => {
  assertEquals(PO11_COMMUNICATION_PAGE, {
    txCode: "PO11",
    resourceCode: "PROC_PLANNING_VIEW",
    companyScoped: true,
  });
  assertEquals(
    resolvePO11CommunicationSurface({
      activeTab: "dashboard",
      showFullReport: false,
    }),
    "planning_dashboard",
  );
  assertEquals(
    resolvePO11CommunicationSurface({
      activeTab: "input",
      showFullReport: false,
    }),
    "monthly_plan_input",
  );
  assertEquals(
    resolvePO11CommunicationSurface({
      activeTab: "sloc",
      showFullReport: false,
    }),
    "sloc_group_setup",
  );
  assertEquals(
    resolvePO11CommunicationSurface({
      activeTab: "item",
      showFullReport: false,
    }),
    "item_group_setup",
  );
  assertEquals(
    resolvePO11CommunicationSurface({
      activeTab: "history",
      showFullReport: false,
    }),
    "history_archive",
  );
  assertEquals(
    resolvePO11CommunicationSurface({
      activeTab: "dashboard",
      showFullReport: true,
    }),
    "report_view",
  );
  assertEquals(
    resolvePO11CommunicationSurface({
      activeTab: "unknown",
      showFullReport: false,
    }),
    null,
  );
});
