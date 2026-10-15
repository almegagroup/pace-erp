import { aggregateLeadTimes, distributionStats, leadTimeMetrics, wholeDays } from "./historical_procurement.logic.ts";

Deno.test("historical domestic lead time uses actual dispatch and inward dates", () => {
  const result = leadTimeMetrics({ company_id: "c", vendor_id: "v", material_id: "m", supply_type: "LOCAL", order_date: "2026-09-01", dispatch_date: "2026-09-04", etd_date: null, atd_date: null, ata_port_date: null, boe_date: null, lr_date: null, inward_date: "2026-09-08", cancellation_flag: false, validation_status: "VALIDATED" });
  if (!result) throw new Error("expected result");
  if (result.metrics.po_to_dispatch_days !== 3 || result.metrics.dispatch_to_inward_days !== 4 || result.metrics.po_to_inward_days !== 7) throw new Error("incorrect domestic lead times");
});

Deno.test("import lead time never substitutes ETA for actual arrival", () => {
  const result = leadTimeMetrics({ company_id: "c", vendor_id: "v", material_id: "m", supply_type: "IMPORT", order_date: "2026-08-01", dispatch_date: null, etd_date: "2026-08-10", atd_date: "2026-08-12", ata_port_date: null, boe_date: null, lr_date: null, inward_date: null, cancellation_flag: false, validation_status: "VALIDATED" });
  if (!result) throw new Error("expected result");
  if (result.metrics.sailing_days !== null || result.metrics.po_to_plant_days !== null) throw new Error("scheduled values must not become actuals");
});

Deno.test("cancelled or invalid historical movements do not become lead-time samples", () => {
  const rows = aggregateLeadTimes([{ company_id: "c", vendor_id: "v", material_id: "m", supply_type: "LOCAL", order_date: "2026-09-01", dispatch_date: "2026-09-02", etd_date: null, atd_date: null, ata_port_date: null, boe_date: null, lr_date: null, inward_date: "2026-09-03", cancellation_flag: true, validation_status: "VALIDATED" }], "VENDOR");
  if (rows.length !== 0) throw new Error("cancelled movement was included");
});

Deno.test("distribution reports median, p80, p90 and variability", () => {
  const stats = distributionStats([1, 2, 3, 4, 5]);
  if (stats.sample_count !== 5 || stats.median !== 3 || stats.p80 !== 4.2 || stats.p90 !== 4.6 || stats.variability === null) throw new Error("unexpected distribution");
  if (wholeDays("2026-09-02", "2026-09-01") !== null) throw new Error("negative duration accepted");
});
