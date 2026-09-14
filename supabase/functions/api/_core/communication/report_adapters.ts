/* Code-owned registry of real Communication report adapters. */

import { REPORT_MANIFEST_REGISTRY } from "./report_manifest/index.ts";
import { createReportAdapterRegistry } from "./report_adapter_registry.ts";
import { PO11_PLANNING_ALERT_REPORT_ADAPTER } from "./adapters/po11_planning_alert.adapter.ts";

export * from "./report_adapter_registry.ts";
export * from "./report_adapter_validation.ts";
export {
  createPO11PlanningAlertReportAdapter,
  PO11_PLANNING_ALERT_REPORT_ADAPTER,
  type PO11PlanningAlertAdapterContext,
} from "./adapters/po11_planning_alert.adapter.ts";

export const REPORT_ADAPTER_REGISTRY = createReportAdapterRegistry(
  REPORT_MANIFEST_REGISTRY,
  [PO11_PLANNING_ALERT_REPORT_ADAPTER],
);
