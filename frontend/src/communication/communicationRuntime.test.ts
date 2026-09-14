import { isCommunicationActionVisible } from "./useCommunicationActionVisibility.js";
import {
  PO11_COMMUNICATION_PAGE,
  resolvePO11CommunicationSurface,
} from "../pages/dashboard/procurement/planning/po11CommunicationSurface.js";

function assertEquals<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("runtime action remains hidden until a successful visible response", () => {
  assertEquals(isCommunicationActionVisible({ status: "pending", data: { visible: true } }), false);
  assertEquals(isCommunicationActionVisible({ status: "error", data: { visible: true } }), false);
  assertEquals(isCommunicationActionVisible({ status: "success", data: { visible: false } }), false);
  assertEquals(isCommunicationActionVisible({ status: "success", data: { visible: true } }), true);
});

Deno.test("PO11 resolves every stable runtime surface without label matching", () => {
  assertEquals(PO11_COMMUNICATION_PAGE, { txCode: "PO11", resourceCode: "PROC_PLANNING_VIEW" });
  assertEquals(resolvePO11CommunicationSurface({ activeTab: "dashboard", showFullReport: false }), "planning_dashboard");
  assertEquals(resolvePO11CommunicationSurface({ activeTab: "input", showFullReport: false }), "monthly_plan_input");
  assertEquals(resolvePO11CommunicationSurface({ activeTab: "sloc", showFullReport: false }), "sloc_group_setup");
  assertEquals(resolvePO11CommunicationSurface({ activeTab: "item", showFullReport: false }), "item_group_setup");
  assertEquals(resolvePO11CommunicationSurface({ activeTab: "history", showFullReport: false }), "history_archive");
  assertEquals(resolvePO11CommunicationSurface({ activeTab: "dashboard", showFullReport: true }), "report_view");
  assertEquals(resolvePO11CommunicationSurface({ activeTab: "unknown", showFullReport: false }), null);
});
