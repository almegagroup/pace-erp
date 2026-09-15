import {
  assertSurfaceHasDataset,
  CommunicationRuleValidationError,
  datasetsForSurface,
  parseAutomationRuleInput,
  parseRuleConfigurationIdentity,
  ruleRpcArgs,
  validateActivation,
  validateDatasetAndColumns,
} from "./rule_configuration.handlers.ts";

function assertEquals<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertThrows(code: string, action: () => unknown): void {
  try {
    action();
  } catch (error) {
    if (error instanceof CommunicationRuleValidationError && error.code === code) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: null,
    rule_name: "Daily Critical Stock Alert",
    dataset_key: null,
    subject_template: "{{company_name}} alert {{date}}",
    schedule_kind: "MANUAL",
    schedule_time: null,
    schedule_timezone: "Asia/Kolkata",
    weekly_days: [],
    monthly_day: null,
    skip_empty: true,
    version_no: null,
    recipients: [],
    columns: [],
    ...overrides,
  };
}

Deno.test("rule identity accepts Email company context", () => {
  assertEquals(parseRuleConfigurationIdentity({
    tx_code: "PO11", resource_code: "PROC_PLANNING_VIEW", surface_key: "planning_dashboard",
    company_id: "company-1", channel: "EMAIL",
  }).channel, "EMAIL");
});

Deno.test("rule identity rejects a missing selected company", () => {
  assertThrows("COMMUNICATION_RULE_CONTEXT_INVALID", () => parseRuleConfigurationIdentity({
    tx_code: "PO11", resource_code: "PROC_PLANNING_VIEW", surface_key: "planning_dashboard", channel: "EMAIL",
  }));
});

Deno.test("rule identity rejects a non-email channel", () => {
  assertThrows("COMMUNICATION_RULE_CONTEXT_INVALID", () => parseRuleConfigurationIdentity({
    tx_code: "PO11", resource_code: "PROC_PLANNING_VIEW", surface_key: "planning_dashboard", company_id: "company-1", channel: "WHATSAPP",
  }));
});

Deno.test("incomplete draft remains structurally safe", () => {
  const parsed = parseAutomationRuleInput(draft({ subject_template: "", recipients: [], columns: [] }));
  assertEquals(parsed.skip_empty, true);
  assertEquals(parsed.dataset_key, null);
});

Deno.test("draft validates a known safe subject token", () => {
  assertEquals(parseAutomationRuleInput(draft({ subject_template: "{{company_code}} {{critical_count}}" })).subject_template, "{{company_code}} {{critical_count}}");
});

Deno.test("unknown subject token is rejected", () => {
  assertThrows("COMMUNICATION_RULE_SUBJECT_TOKEN_INVALID", () => parseAutomationRuleInput(draft({ subject_template: "{{secret}}" })));
});

Deno.test("malformed subject token is rejected", () => {
  assertThrows("COMMUNICATION_RULE_SUBJECT_INVALID", () => parseAutomationRuleInput(draft({ subject_template: "{{company_name}" })));
});

Deno.test("subject does not accept HTML", () => {
  assertThrows("COMMUNICATION_RULE_SUBJECT_INVALID", () => parseAutomationRuleInput(draft({ subject_template: "<b>alert</b>" })));
});

Deno.test("manual schedule is structurally valid", () => {
  assertEquals(parseAutomationRuleInput(draft()).schedule_kind, "MANUAL");
});

Deno.test("daily schedule permits a configured time", () => {
  assertEquals(parseAutomationRuleInput(draft({ schedule_kind: "DAILY", schedule_time: "09:30" })).schedule_time, "09:30");
});

Deno.test("daily schedule rejects weekly data", () => {
  assertThrows("COMMUNICATION_RULE_SCHEDULE_INVALID", () => parseAutomationRuleInput(draft({ schedule_kind: "DAILY", weekly_days: [1] })));
});

Deno.test("weekly schedule normalizes weekday order", () => {
  assertEquals(parseAutomationRuleInput(draft({ schedule_kind: "WEEKLY", schedule_time: "09:30", weekly_days: [5, 1] })).weekly_days, [1, 5]);
});

Deno.test("weekly schedule rejects duplicate weekday", () => {
  assertThrows("COMMUNICATION_RULE_WEEKLY_DAYS_INVALID", () => parseAutomationRuleInput(draft({ schedule_kind: "WEEKLY", weekly_days: [1, 1] })));
});

Deno.test("weekly schedule rejects out-of-range weekday", () => {
  assertThrows("COMMUNICATION_RULE_WEEKLY_DAYS_INVALID", () => parseAutomationRuleInput(draft({ schedule_kind: "WEEKLY", weekly_days: [8] })));
});

Deno.test("monthly schedule permits a validated day", () => {
  assertEquals(parseAutomationRuleInput(draft({ schedule_kind: "MONTHLY", schedule_time: "09:30", monthly_day: 31 })).monthly_day, 31);
});

Deno.test("monthly schedule rejects invalid day", () => {
  assertThrows("COMMUNICATION_RULE_MONTHLY_DAY_INVALID", () => parseAutomationRuleInput(draft({ schedule_kind: "MONTHLY", monthly_day: 32 })));
});

Deno.test("only code-owned timezone is accepted", () => {
  assertThrows("COMMUNICATION_RULE_TIMEZONE_INVALID", () => parseAutomationRuleInput(draft({ schedule_timezone: "UTC" })));
});

Deno.test("recipient accepts valid TO CC and BCC rows", () => {
  const result = parseAutomationRuleInput(draft({ recipients: [
    { recipient_type: "TO", email: "to@example.com", active: true, display_order: 1 },
    { recipient_type: "CC", email: "cc@example.com", active: true, display_order: 2 },
    { recipient_type: "BCC", email: "bcc@example.com", active: false, display_order: 3 },
  ] }));
  assertEquals(result.recipients.length, 3);
});

Deno.test("recipient email is normalized", () => {
  assertEquals(parseAutomationRuleInput(draft({ recipients: [
    { recipient_type: "TO", email: "USER@Example.COM", active: true, display_order: 1 },
  ] })).recipients[0].email, "user@example.com");
});

Deno.test("invalid recipient email is rejected", () => {
  assertThrows("COMMUNICATION_RULE_RECIPIENT_INVALID", () => parseAutomationRuleInput(draft({ recipients: [
    { recipient_type: "TO", email: "not-an-email", active: true, display_order: 1 },
  ] })));
});

Deno.test("duplicate recipient type and email is rejected", () => {
  assertThrows("COMMUNICATION_RULE_RECIPIENT_DUPLICATE", () => parseAutomationRuleInput(draft({ recipients: [
    { recipient_type: "TO", email: "same@example.com", active: true, display_order: 1 },
    { recipient_type: "TO", email: "SAME@example.com", active: true, display_order: 2 },
  ] })));
});

Deno.test("duplicate recipient order is rejected", () => {
  assertThrows("COMMUNICATION_RULE_RECIPIENT_ORDER_DUPLICATE", () => parseAutomationRuleInput(draft({ recipients: [
    { recipient_type: "TO", email: "to@example.com", active: true, display_order: 1 },
    { recipient_type: "CC", email: "cc@example.com", active: true, display_order: 1 },
  ] })));
});

Deno.test("duplicate display column is rejected", () => {
  assertThrows("COMMUNICATION_RULE_COLUMN_DUPLICATE", () => parseAutomationRuleInput(draft({ columns: [
    { field_key: "material_name", display_order: 1 }, { field_key: "material_name", display_order: 2 },
  ] })));
});

Deno.test("duplicate display column order is rejected", () => {
  assertThrows("COMMUNICATION_RULE_COLUMN_ORDER_DUPLICATE", () => parseAutomationRuleInput(draft({ columns: [
    { field_key: "material_name", display_order: 1 }, { field_key: "planning_status", display_order: 1 },
  ] })));
});

Deno.test("conditions payload is rejected before persistence", () => {
  assertThrows("COMMUNICATION_RULE_UNSAFE_PAYLOAD", () => parseAutomationRuleInput(draft({ conditions: [] })));
});

Deno.test("raw SQL payload is rejected before persistence", () => {
  assertThrows("COMMUNICATION_RULE_UNSAFE_PAYLOAD", () => parseAutomationRuleInput(draft({ query: "select 1" })));
});

Deno.test("activation requires a dataset", () => {
  assertThrows("COMMUNICATION_RULE_ACTIVE_DATASET_REQUIRED", () => validateActivation(parseAutomationRuleInput(draft()), null));
});

Deno.test("activation requires a selected display column", () => {
  const rule = parseAutomationRuleInput(draft({
    dataset_key: "planning_alert",
    recipients: [{ recipient_type: "TO", email: "to@example.com", active: true, display_order: 1 }],
  }));
  assertThrows("COMMUNICATION_RULE_ACTIVE_COLUMNS_REQUIRED", () => validateActivation(rule, {} as never));
});

Deno.test("activation requires an active TO recipient", () => {
  const rule = parseAutomationRuleInput(draft({
    dataset_key: "planning_alert", columns: [{ field_key: "material_name", display_order: 1 }],
  }));
  assertThrows("COMMUNICATION_RULE_ACTIVE_TO_REQUIRED", () => validateActivation(rule, {} as never));
});

Deno.test("activation requires a subject", () => {
  const rule = parseAutomationRuleInput(draft({
    dataset_key: "planning_alert", subject_template: "", columns: [{ field_key: "material_name", display_order: 1 }],
    recipients: [{ recipient_type: "TO", email: "to@example.com", active: true, display_order: 1 }],
  }));
  assertThrows("COMMUNICATION_RULE_ACTIVE_SUBJECT_REQUIRED", () => validateActivation(rule, {} as never));
});

Deno.test("activation requires time for daily schedule", () => {
  const rule = parseAutomationRuleInput(draft({
    dataset_key: "planning_alert", schedule_kind: "DAILY", subject_template: "Daily alert",
    columns: [{ field_key: "material_name", display_order: 1 }],
    recipients: [{ recipient_type: "TO", email: "to@example.com", active: true, display_order: 1 }],
  }));
  assertThrows("COMMUNICATION_RULE_ACTIVE_SCHEDULE_INVALID", () => validateActivation(rule, {} as never));
});

const PO11_PAGE = { id: "po11-menu-id", tx_code: "PO11", resource_code: "PROC_PLANNING_VIEW", title: "Procurement Planning" };

// --- No-dataset surface must fail closed server-side (Issue 3) ---

Deno.test("a surface with a bound dataset is not rejected", () => {
  assertSurfaceHasDataset(PO11_PAGE, "planning_dashboard");
});

Deno.test("bootstrap on a no-dataset surface safely reports zero datasets", () => {
  assertEquals(datasetsForSurface(PO11_PAGE, "monthly_plan_input"), []);
});

Deno.test("a no-dataset surface cannot create a new rule", () => {
  assertThrows("COMMUNICATION_RULE_DATASET_UNAVAILABLE", () => assertSurfaceHasDataset(PO11_PAGE, "monthly_plan_input"));
  assertThrows("COMMUNICATION_RULE_DATASET_UNAVAILABLE", () => assertSurfaceHasDataset(PO11_PAGE, "sloc_group_setup"));
  assertThrows("COMMUNICATION_RULE_DATASET_UNAVAILABLE", () => assertSurfaceHasDataset(PO11_PAGE, "item_group_setup"));
  assertThrows("COMMUNICATION_RULE_DATASET_UNAVAILABLE", () => assertSurfaceHasDataset(PO11_PAGE, "history_archive"));
});

Deno.test("a dataset bound to another surface is rejected", () => {
  const rule = parseAutomationRuleInput(draft({ dataset_key: "planning_alert" }));
  assertThrows("COMMUNICATION_RULE_DATASET_INVALID", () => validateDatasetAndColumns(PO11_PAGE, "monthly_plan_input", rule));
});

Deno.test("a valid dataset bound to the current surface is accepted", () => {
  const rule = parseAutomationRuleInput(draft({ dataset_key: "planning_alert" }));
  const dataset = validateDatasetAndColumns(PO11_PAGE, "planning_dashboard", rule);
  assertEquals(dataset?.dataset_key, "planning_alert");
});

Deno.test("an unknown dataset key is rejected", () => {
  const rule = parseAutomationRuleInput(draft({ dataset_key: "invented_dataset" }));
  assertThrows("COMMUNICATION_RULE_DATASET_INVALID", () => validateDatasetAndColumns(PO11_PAGE, "planning_dashboard", rule));
});

Deno.test("an unknown display field is rejected even for a bound dataset", () => {
  const rule = parseAutomationRuleInput(draft({
    dataset_key: "planning_alert",
    columns: [{ field_key: "invented_field", display_order: 1 }],
  }));
  assertThrows("COMMUNICATION_RULE_COLUMN_INVALID", () => validateDatasetAndColumns(PO11_PAGE, "planning_dashboard", rule));
});

Deno.test("a non-displayable field (row identity) is rejected", () => {
  const rule = parseAutomationRuleInput(draft({
    dataset_key: "planning_alert",
    columns: [{ field_key: "decision_key", display_order: 1 }],
  }));
  assertThrows("COMMUNICATION_RULE_COLUMN_INVALID", () => validateDatasetAndColumns(PO11_PAGE, "planning_dashboard", rule));
});

// --- Lifecycle: a generic save can never smuggle a lifecycle status (Issue 2) ---

Deno.test("the generic save RPC payload never carries a lifecycle status field", () => {
  const rule = parseAutomationRuleInput(draft({ id: "rule-1", version_no: 4 }));
  const resolved = { identity: { company_id: "company-1", surface_enrollment_id: "ignored", channel: "EMAIL" as const, tx_code: "PO11", resource_code: "PROC_PLANNING_VIEW", surface_key: "planning_dashboard" }, surfaceEnrollmentId: "surface-enrollment-1" };
  const args = ruleRpcArgs(resolved, rule, { auth_user_id: "user-1" });
  assertEquals("p_status" in args, false);
  assertEquals(args.p_rule_id, "rule-1");
  assertEquals(args.p_company_id, "company-1");
  assertEquals(args.p_surface_enrollment_id, "surface-enrollment-1");
  assertEquals(args.p_expected_version_no, 4);
  assertEquals(args.p_actor, "user-1");
});
