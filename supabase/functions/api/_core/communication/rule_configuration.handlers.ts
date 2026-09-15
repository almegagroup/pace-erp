/*
 * Communication Automation — Phase 6 runtime rule configuration.
 *
 * Configuration is intentionally resolved from the code-owned surface and
 * report manifests.  The browser supplies neither database objects nor a
 * direct Supabase query; every operation below proves the exact selected
 * company, page, surface and EDIT permission before touching a rule.
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { getServiceRoleClientWithContext } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import {
  REPORT_MANIFEST_REGISTRY,
  type ReportDatasetManifest,
} from "./report_manifest/index.ts";
import {
  assertCommunicationSurfaceSupported,
  findCommunicationSurfaceManifest,
  type CommunicationChannel,
  type CommunicationManifestPageIdentity,
  type CommunicationSurface,
} from "./surface_manifest.ts";

type HandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

type RuntimeCatalogPage = {
  id: string;
  tx_code: string | null;
  resource_code: string;
  title: string;
};

type PageEnrollment = {
  id: string;
  active: boolean;
  email_enabled: boolean;
};

type SurfaceEnrollment = {
  id: string;
  active: boolean;
};

export const COMMUNICATION_RULE_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE"] as const;
export const COMMUNICATION_SCHEDULE_KINDS = ["MANUAL", "DAILY", "WEEKLY", "MONTHLY"] as const;
export const COMMUNICATION_TIMEZONES = ["Asia/Kolkata"] as const;
export const COMMUNICATION_SUBJECT_TOKENS = [
  "{{company_code}}",
  "{{company_name}}",
  "{{date}}",
  "{{page_name}}",
  "{{report_name}}",
  "{{critical_count}}",
  "{{replenishment_count}}",
] as const;

type RuleStatus = (typeof COMMUNICATION_RULE_STATUSES)[number];
type ScheduleKind = (typeof COMMUNICATION_SCHEDULE_KINDS)[number];
type RecipientType = "TO" | "CC" | "BCC";

export type RuleConfigurationIdentity = {
  tx_code: string;
  resource_code: string;
  surface_key: string;
  company_id: string;
  channel: CommunicationChannel;
};

export type AutomationRecipientInput = {
  recipient_type: RecipientType;
  email: string;
  active: boolean;
  display_order: number;
};

export type AutomationColumnInput = {
  field_key: string;
  display_order: number;
};

export type AutomationRuleInput = {
  id: string | null;
  rule_name: string;
  dataset_key: string | null;
  subject_template: string;
  schedule_kind: ScheduleKind;
  schedule_time: string | null;
  schedule_timezone: string;
  weekly_days: number[];
  monthly_day: number | null;
  skip_empty: boolean;
  version_no: number | null;
  recipients: AutomationRecipientInput[];
  columns: AutomationColumnInput[];
};

export class CommunicationRuleValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(code);
    this.name = "CommunicationRuleValidationError";
  }
}

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "conditions",
  "sql",
  "query",
  "table_name",
  "column_name",
  "where",
  "template_function",
  "match_state",
]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function fail(code: string, message: string): never {
  throw new CommunicationRuleValidationError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trimmedString(value: unknown, maxLength = 160): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function nullableTrimmedString(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  const normalized = trimmedString(value, maxLength);
  if (!normalized) fail("COMMUNICATION_RULE_INPUT_INVALID", "Rule configuration contains invalid values.");
  return normalized;
}

function requireOnlyKeys(record: Record<string, unknown>, allowed: readonly string[], code: string): void {
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    fail(code, "The request contains unsupported configuration fields.");
  }
}

function assertNoForbiddenPayloadKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoForbiddenPayloadKeys);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key.toLowerCase())) {
      fail("COMMUNICATION_RULE_UNSAFE_PAYLOAD", "Conditions, SQL, preview, and delivery configuration are not available.");
    }
    assertNoForbiddenPayloadKeys(child);
  }
}

export function parseRuleConfigurationIdentity(value: unknown): RuleConfigurationIdentity {
  if (!isRecord(value)) fail("COMMUNICATION_RULE_CONTEXT_INVALID", "A valid automation context is required.");
  const txCode = trimmedString(value.tx_code, 80);
  const resourceCode = trimmedString(value.resource_code, 160);
  const surfaceKey = trimmedString(value.surface_key, 160);
  const companyId = trimmedString(value.company_id, 160);
  const channel = trimmedString(value.channel, 30);
  if (!txCode || !resourceCode || !surfaceKey || !companyId || channel !== "EMAIL") {
    fail("COMMUNICATION_RULE_CONTEXT_INVALID", "A valid automation context is required.");
  }
  return {
    tx_code: txCode,
    resource_code: resourceCode,
    surface_key: surfaceKey,
    company_id: companyId,
    channel: "EMAIL",
  };
}

function parseRecipient(value: unknown): AutomationRecipientInput {
  if (!isRecord(value)) fail("COMMUNICATION_RULE_RECIPIENT_INVALID", "Recipient rows are invalid.");
  requireOnlyKeys(value, ["recipient_type", "email", "active", "display_order"], "COMMUNICATION_RULE_RECIPIENT_INVALID");
  const type = trimmedString(value.recipient_type, 8);
  const email = trimmedString(value.email, 320)?.toLocaleLowerCase();
  const displayOrder = value.display_order;
  if (
    (type !== "TO" && type !== "CC" && type !== "BCC") ||
    !email || !EMAIL_PATTERN.test(email) ||
    typeof value.active !== "boolean" ||
    !Number.isInteger(displayOrder) || (displayOrder as number) < 1
  ) {
    fail("COMMUNICATION_RULE_RECIPIENT_INVALID", "Each recipient needs a valid type, email, active state, and order.");
  }
  return {
    recipient_type: type,
    email,
    active: value.active,
    display_order: displayOrder as number,
  };
}

function parseColumn(value: unknown): AutomationColumnInput {
  if (!isRecord(value)) fail("COMMUNICATION_RULE_COLUMN_INVALID", "Selected columns are invalid.");
  requireOnlyKeys(value, ["field_key", "display_order"], "COMMUNICATION_RULE_COLUMN_INVALID");
  const fieldKey = trimmedString(value.field_key, 100);
  if (!fieldKey || !Number.isInteger(value.display_order) || (value.display_order as number) < 1) {
    fail("COMMUNICATION_RULE_COLUMN_INVALID", "Each selected column needs a field and display order.");
  }
  return { field_key: fieldKey, display_order: value.display_order as number };
}

function validateSubjectTemplate(value: string): void {
  if (value.length > 500 || /[\r\n<>]/.test(value)) {
    fail("COMMUNICATION_RULE_SUBJECT_INVALID", "Subject must be plain text on one line.");
  }
  const tokens = value.match(/\{\{[^{}]*\}\}/g) ?? [];
  const remainder = value.replace(/\{\{[^{}]*\}\}/g, "");
  if (remainder.includes("{") || remainder.includes("}")) {
    fail("COMMUNICATION_RULE_SUBJECT_INVALID", "Subject contains a malformed token.");
  }
  for (const token of tokens) {
    if (!(COMMUNICATION_SUBJECT_TOKENS as readonly string[]).includes(token)) {
      fail("COMMUNICATION_RULE_SUBJECT_TOKEN_INVALID", "Subject contains an unsupported token.");
    }
  }
}

function parseWeeklyDays(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 7 || value.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
    fail("COMMUNICATION_RULE_WEEKLY_DAYS_INVALID", "Weekdays must be unique values from Monday (1) to Sunday (7).");
  }
  const days = value as number[];
  if (new Set(days).size !== days.length) {
    fail("COMMUNICATION_RULE_WEEKLY_DAYS_INVALID", "Weekdays cannot be repeated.");
  }
  return [...days].sort((left, right) => left - right);
}

function validateScheduleShape(rule: Pick<AutomationRuleInput, "schedule_kind" | "schedule_time" | "schedule_timezone" | "weekly_days" | "monthly_day">): void {
  if (!(COMMUNICATION_TIMEZONES as readonly string[]).includes(rule.schedule_timezone)) {
    fail("COMMUNICATION_RULE_TIMEZONE_INVALID", "Choose a supported timezone.");
  }
  if (rule.schedule_time !== null && !TIME_PATTERN.test(rule.schedule_time)) {
    fail("COMMUNICATION_RULE_TIME_INVALID", "Schedule time must use HH:MM.");
  }
  if (rule.monthly_day !== null && (!Number.isInteger(rule.monthly_day) || rule.monthly_day < 1 || rule.monthly_day > 31)) {
    fail("COMMUNICATION_RULE_MONTHLY_DAY_INVALID", "Monthly day must be from 1 to 31.");
  }
  if (rule.schedule_kind === "MANUAL" && (rule.schedule_time !== null || rule.weekly_days.length > 0 || rule.monthly_day !== null)) {
    fail("COMMUNICATION_RULE_SCHEDULE_INVALID", "Manual rules cannot contain recurrence fields.");
  }
  if (rule.schedule_kind === "DAILY" && (rule.weekly_days.length > 0 || rule.monthly_day !== null)) {
    fail("COMMUNICATION_RULE_SCHEDULE_INVALID", "Daily rules cannot contain weekly or monthly fields.");
  }
  if (rule.schedule_kind === "WEEKLY" && rule.monthly_day !== null) {
    fail("COMMUNICATION_RULE_SCHEDULE_INVALID", "Weekly rules cannot contain a monthly day.");
  }
  if (rule.schedule_kind === "MONTHLY" && rule.weekly_days.length > 0) {
    fail("COMMUNICATION_RULE_SCHEDULE_INVALID", "Monthly rules cannot contain weekdays.");
  }
}

export function parseAutomationRuleInput(value: unknown): AutomationRuleInput {
  assertNoForbiddenPayloadKeys(value);
  if (!isRecord(value)) fail("COMMUNICATION_RULE_INPUT_INVALID", "Rule configuration is required.");
  requireOnlyKeys(value, [
    "id", "rule_name", "dataset_key", "subject_template", "schedule_kind", "schedule_time",
    "schedule_timezone", "weekly_days", "monthly_day", "skip_empty", "version_no", "recipients", "columns",
  ], "COMMUNICATION_RULE_INPUT_INVALID");

  const id = nullableTrimmedString(value.id, 160);
  const ruleName = trimmedString(value.rule_name, 160);
  const datasetKey = nullableTrimmedString(value.dataset_key, 100);
  const subject = value.subject_template === undefined || value.subject_template === null
    ? ""
    : typeof value.subject_template === "string" ? value.subject_template.trim() : null;
  const scheduleKind = value.schedule_kind;
  const scheduleTime = value.schedule_time === undefined || value.schedule_time === null || value.schedule_time === ""
    ? null
    : typeof value.schedule_time === "string" ? value.schedule_time : null;
  const timezone = value.schedule_timezone === undefined || value.schedule_timezone === null || value.schedule_timezone === ""
    ? "Asia/Kolkata"
    : trimmedString(value.schedule_timezone, 80);
  const monthlyDay = value.monthly_day === undefined || value.monthly_day === null || value.monthly_day === ""
    ? null
    : value.monthly_day;
  const versionNo = value.version_no === undefined || value.version_no === null ? null : value.version_no;

  if (!ruleName || subject === null || !timezone ||
    !(COMMUNICATION_SCHEDULE_KINDS as readonly unknown[]).includes(scheduleKind) ||
    !Array.isArray(value.recipients) || !Array.isArray(value.columns) ||
    (versionNo !== null && (!Number.isInteger(versionNo) || (versionNo as number) < 1)) ||
    typeof value.skip_empty !== "boolean") {
    fail("COMMUNICATION_RULE_INPUT_INVALID", "Rule configuration contains invalid values.");
  }

  const recipients = value.recipients.map(parseRecipient);
  const columns = value.columns.map(parseColumn);
  if (recipients.length > 100 || columns.length > 100) {
    fail("COMMUNICATION_RULE_INPUT_INVALID", "Too many recipients or selected columns.");
  }
  if (new Set(recipients.map((row) => `${row.recipient_type}\u001f${row.email}`)).size !== recipients.length) {
    fail("COMMUNICATION_RULE_RECIPIENT_DUPLICATE", "A recipient may appear once for each recipient type.");
  }
  if (new Set(recipients.map((row) => row.display_order)).size !== recipients.length) {
    fail("COMMUNICATION_RULE_RECIPIENT_ORDER_DUPLICATE", "Recipient display order cannot be repeated.");
  }
  if (new Set(columns.map((row) => row.field_key)).size !== columns.length) {
    fail("COMMUNICATION_RULE_COLUMN_DUPLICATE", "A selected column cannot be repeated.");
  }
  if (new Set(columns.map((row) => row.display_order)).size !== columns.length) {
    fail("COMMUNICATION_RULE_COLUMN_ORDER_DUPLICATE", "Column display order cannot be repeated.");
  }

  const rule: AutomationRuleInput = {
    id,
    rule_name: ruleName,
    dataset_key: datasetKey,
    subject_template: subject,
    schedule_kind: scheduleKind as ScheduleKind,
    schedule_time: scheduleTime,
    schedule_timezone: timezone,
    weekly_days: parseWeeklyDays(value.weekly_days ?? []),
    monthly_day: monthlyDay as number | null,
    skip_empty: value.skip_empty,
    version_no: versionNo as number | null,
    recipients,
    columns,
  };
  validateSubjectTemplate(rule.subject_template);
  validateScheduleShape(rule);
  return rule;
}

export function validateDatasetAndColumns(
  page: CommunicationManifestPageIdentity,
  surfaceKey: string,
  rule: AutomationRuleInput,
): ReportDatasetManifest | null {
  if (!rule.dataset_key) {
    if (rule.columns.length > 0) {
      fail("COMMUNICATION_RULE_DATASET_REQUIRED", "Choose a dataset before selecting columns.");
    }
    return null;
  }
  let dataset: ReportDatasetManifest;
  try {
    dataset = REPORT_MANIFEST_REGISTRY.resolveDataset(page, surfaceKey, rule.dataset_key);
  } catch {
    fail("COMMUNICATION_RULE_DATASET_INVALID", "This dataset is not available for the selected surface.");
  }
  const displayableFields = new Set(
    dataset.fields.filter((field) => field.displayable).map((field) => field.field_key),
  );
  if (rule.columns.some((column) => !displayableFields.has(column.field_key))) {
    fail("COMMUNICATION_RULE_COLUMN_INVALID", "Selected columns must be displayable fields in the chosen dataset.");
  }
  return dataset;
}

export function validateActivation(rule: AutomationRuleInput, dataset: ReportDatasetManifest | null): void {
  if (!rule.rule_name || !dataset) {
    fail("COMMUNICATION_RULE_ACTIVE_DATASET_REQUIRED", "An active rule needs a valid dataset.");
  }
  if (rule.columns.length === 0) {
    fail("COMMUNICATION_RULE_ACTIVE_COLUMNS_REQUIRED", "An active rule needs at least one selected column.");
  }
  if (!rule.recipients.some((recipient) => recipient.active && recipient.recipient_type === "TO")) {
    fail("COMMUNICATION_RULE_ACTIVE_TO_REQUIRED", "An active rule needs at least one active TO recipient.");
  }
  if (!rule.subject_template) {
    fail("COMMUNICATION_RULE_ACTIVE_SUBJECT_REQUIRED", "An active rule needs a subject.");
  }
  if (
    (rule.schedule_kind === "DAILY" && !rule.schedule_time) ||
    (rule.schedule_kind === "WEEKLY" && (!rule.schedule_time || rule.weekly_days.length === 0)) ||
    (rule.schedule_kind === "MONTHLY" && (!rule.schedule_time || rule.monthly_day === null))
  ) {
    fail("COMMUNICATION_RULE_ACTIVE_SCHEDULE_INVALID", "Complete the schedule before activating this rule.");
  }
}

type ResolvedConfigurationContext = {
  db: ReturnType<typeof getServiceRoleClientWithContext>;
  identity: RuleConfigurationIdentity;
  page: RuntimeCatalogPage;
  surface: CommunicationSurface;
  surfaceEnrollmentId: string;
};

async function resolveConfigurationContext(
  identity: RuleConfigurationIdentity,
  ctx: HandlerContext,
): Promise<ResolvedConfigurationContext> {
  const pageIdentity: CommunicationManifestPageIdentity = {
    tx_code: identity.tx_code,
    resource_code: identity.resource_code,
  };
  const manifest = findCommunicationSurfaceManifest(pageIdentity);
  if (!manifest || manifest.page.company_scoped !== true) {
    fail("COMMUNICATION_RULE_CONTEXT_UNAVAILABLE", "Automation settings are not available for this page.");
  }
  let surface: CommunicationSurface;
  try {
    surface = assertCommunicationSurfaceSupported(manifest, identity.surface_key, identity.channel);
  } catch {
    fail("COMMUNICATION_RULE_SURFACE_INVALID", "Automation settings are not available for this surface.");
  }
  await assertCompanyScope(ctx, identity.company_id);
  const db = getServiceRoleClientWithContext(ctx.context);
  const { data: pageData, error: pageError } = await db
    .schema("erp_menu")
    .from("menu_master")
    .select("id, tx_code, resource_code, title")
    .eq("tx_code", identity.tx_code)
    .eq("resource_code", identity.resource_code)
    .eq("menu_type", "PAGE")
    .eq("is_active", true)
    .maybeSingle();
  if (pageError) throw new Error("COMMUNICATION_RULE_PAGE_READ_FAILED");
  const page = pageData as RuntimeCatalogPage | null;
  if (!page) fail("COMMUNICATION_RULE_CONTEXT_UNAVAILABLE", "Automation settings are not available for this page.");

  const { data: enrollmentData, error: enrollmentError } = await db
    .schema("erp_communication")
    .from("page_enrollment")
    .select("id, active, email_enabled")
    .eq("page_menu_id", page.id)
    .maybeSingle();
  if (enrollmentError) throw new Error("COMMUNICATION_RULE_ENROLLMENT_READ_FAILED");
  const enrollment = enrollmentData as PageEnrollment | null;
  if (!enrollment?.active || !enrollment.email_enabled) {
    fail("COMMUNICATION_RULE_CONTEXT_UNAVAILABLE", "Automation settings are not enabled for this page.");
  }
  const { data: surfaceData, error: surfaceError } = await db
    .schema("erp_communication")
    .from("surface_enrollment")
    .select("id, active")
    .eq("page_enrollment_id", enrollment.id)
    .eq("surface_key", surface.key)
    .maybeSingle();
  if (surfaceError) throw new Error("COMMUNICATION_RULE_SURFACE_READ_FAILED");
  const surfaceEnrollment = surfaceData as SurfaceEnrollment | null;
  if (!surfaceEnrollment?.active) {
    fail("COMMUNICATION_RULE_CONTEXT_UNAVAILABLE", "Automation settings are not enabled for this surface.");
  }
  if (!await canMaintainCompanyResource(ctx, identity.company_id, page.resource_code, "EDIT")) {
    fail("COMMUNICATION_RULE_EDIT_DENIED", "You do not have permission to configure automation for this company.");
  }
  return { db, identity, page, surface, surfaceEnrollmentId: surfaceEnrollment.id };
}

type AutomationRuleRow = {
  id: string;
  rule_name: string;
  status: RuleStatus;
  dataset_key: string | null;
  subject_template: string;
  schedule_kind: ScheduleKind;
  schedule_time: string | null;
  schedule_timezone: string;
  weekly_days: number[] | null;
  monthly_day: number | null;
  skip_empty: boolean;
  version_no: number;
  created_at: string;
  last_updated_at: string;
};

function publicRule(rule: AutomationRuleRow, recipients: AutomationRecipientInput[], columns: AutomationColumnInput[]) {
  return {
    id: rule.id,
    rule_name: rule.rule_name,
    status: rule.status,
    dataset_key: rule.dataset_key,
    subject_template: rule.subject_template,
    schedule_kind: rule.schedule_kind,
    schedule_time: rule.schedule_time ? rule.schedule_time.slice(0, 5) : null,
    schedule_timezone: rule.schedule_timezone,
    weekly_days: rule.weekly_days ?? [],
    monthly_day: rule.monthly_day,
    skip_empty: rule.skip_empty,
    version_no: rule.version_no,
    recipients,
    columns,
    created_at: rule.created_at,
    last_updated_at: rule.last_updated_at,
  };
}

async function readRuleForContext(
  resolved: ResolvedConfigurationContext,
  ruleId: string,
) {
  const { data, error } = await resolved.db
    .schema("erp_communication")
    .from("automation_rule")
    .select("id, rule_name, status, dataset_key, subject_template, schedule_kind, schedule_time, schedule_timezone, weekly_days, monthly_day, skip_empty, version_no, created_at, last_updated_at")
    .eq("id", ruleId)
    .eq("company_id", resolved.identity.company_id)
    .eq("surface_enrollment_id", resolved.surfaceEnrollmentId)
    .eq("channel", resolved.identity.channel)
    .maybeSingle();
  if (error) throw new Error("COMMUNICATION_RULE_READ_FAILED");
  const rule = data as AutomationRuleRow | null;
  if (!rule) fail("COMMUNICATION_RULE_NOT_FOUND", "Automation rule was not found in this context.");
  const [{ data: recipientData, error: recipientError }, { data: columnData, error: columnError }] = await Promise.all([
    resolved.db.schema("erp_communication").from("automation_recipient")
      .select("recipient_type, email, active, display_order")
      .eq("automation_rule_id", rule.id).order("display_order", { ascending: true }),
    resolved.db.schema("erp_communication").from("automation_rule_column")
      .select("field_key, display_order")
      .eq("automation_rule_id", rule.id).order("display_order", { ascending: true }),
  ]);
  if (recipientError || columnError) throw new Error("COMMUNICATION_RULE_CHILD_READ_FAILED");
  return publicRule(
    rule,
    ((recipientData ?? []) as AutomationRecipientInput[]),
    ((columnData ?? []) as AutomationColumnInput[]),
  );
}

export function datasetsForSurface(page: RuntimeCatalogPage, surfaceKey: string) {
  return REPORT_MANIFEST_REGISTRY.listDatasetsForPage(page)
    .filter((dataset) => dataset.surface_keys.includes(surfaceKey))
    .map((dataset) => ({
      dataset_key: dataset.dataset_key,
      label: dataset.label,
      description: dataset.description ?? null,
      default_display_field_keys: [...dataset.default_display_field_keys],
      fields: dataset.fields.filter((field) => field.displayable).map((field) => ({
        field_key: field.field_key,
        label: field.label,
        data_type: field.data_type,
        format_kind: field.format_kind,
      })),
    }));
}

function statusForError(code: string): number {
  if (code === "COMMUNICATION_RULE_EDIT_DENIED" || code === "COMPANY_SCOPE_VIOLATION") return 403;
  if (code === "COMMUNICATION_RULE_NOT_FOUND") return 404;
  if (code === "COMMUNICATION_RULE_VERSION_CONFLICT") return 409;
  if (code.startsWith("COMMUNICATION_RULE_") || code.startsWith("REPORT_MANIFEST_")) return 400;
  return 500;
}

function responseForError(error: unknown, ctx: HandlerContext, req: Request): Response {
  const code = error instanceof CommunicationRuleValidationError
    ? error.code
    : (error as Error)?.message || "COMMUNICATION_RULE_EXCEPTION";
  const message = error instanceof CommunicationRuleValidationError
    ? error.message
    : code === "COMPANY_SCOPE_VIOLATION"
      ? "You do not have access to the selected company."
      : "Unable to process automation rule configuration.";
  return errorResponse(code, message, ctx.request_id, "NONE", statusForError(code), undefined, req);
}

export async function getCommunicationConfigurationBootstrapHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const resolved = await resolveConfigurationContext(parseRuleConfigurationIdentity({
      tx_code: url.searchParams.get("tx_code"),
      resource_code: url.searchParams.get("resource_code"),
      surface_key: url.searchParams.get("surface_key"),
      company_id: url.searchParams.get("company_id"),
      channel: url.searchParams.get("channel") ?? "EMAIL",
    }), ctx);
    const { data, error } = await resolved.db
      .schema("erp_communication")
      .from("automation_rule")
      .select("id, rule_name, status, dataset_key, version_no, last_updated_at")
      .eq("company_id", resolved.identity.company_id)
      .eq("surface_enrollment_id", resolved.surfaceEnrollmentId)
      .eq("channel", resolved.identity.channel)
      .order("rule_name", { ascending: true });
    if (error) throw new Error("COMMUNICATION_RULE_LIST_FAILED");
    return okResponse({
      page: { tx_code: resolved.page.tx_code, resource_code: resolved.page.resource_code, title: resolved.page.title },
      surface: { key: resolved.surface.key, label: resolved.surface.label },
      channel: resolved.identity.channel,
      datasets: datasetsForSurface(resolved.page, resolved.surface.key),
      subject_tokens: [...COMMUNICATION_SUBJECT_TOKENS],
      schedule_kinds: [...COMMUNICATION_SCHEDULE_KINDS],
      timezones: [...COMMUNICATION_TIMEZONES],
      skip_empty_default: true,
      rules: data ?? [],
    }, ctx.request_id, req);
  } catch (error) {
    return responseForError(error, ctx, req);
  }
}

export async function getCommunicationRuleHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const ruleId = trimmedString(url.searchParams.get("rule_id"), 160);
    if (!ruleId) fail("COMMUNICATION_RULE_ID_INVALID", "Rule ID is required.");
    const resolved = await resolveConfigurationContext(parseRuleConfigurationIdentity({
      tx_code: url.searchParams.get("tx_code"), resource_code: url.searchParams.get("resource_code"),
      surface_key: url.searchParams.get("surface_key"), company_id: url.searchParams.get("company_id"),
      channel: url.searchParams.get("channel") ?? "EMAIL",
    }), ctx);
    return okResponse({ rule: await readRuleForContext(resolved, ruleId) }, ctx.request_id, req);
  } catch (error) {
    return responseForError(error, ctx, req);
  }
}

async function parseMutationRequest(req: Request): Promise<{ identity: RuleConfigurationIdentity; rule: AutomationRuleInput }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    fail("COMMUNICATION_RULE_INPUT_INVALID", "Rule configuration is required.");
  }
  assertNoForbiddenPayloadKeys(body);
  if (!isRecord(body)) fail("COMMUNICATION_RULE_INPUT_INVALID", "Rule configuration is required.");
  requireOnlyKeys(body, ["tx_code", "resource_code", "surface_key", "company_id", "channel", "rule"], "COMMUNICATION_RULE_INPUT_INVALID");
  return { identity: parseRuleConfigurationIdentity(body), rule: parseAutomationRuleInput(body.rule) };
}

async function fetchRuleStatus(resolved: ResolvedConfigurationContext, ruleId: string): Promise<RuleStatus> {
  const { data, error } = await resolved.db
    .schema("erp_communication")
    .from("automation_rule")
    .select("status")
    .eq("id", ruleId)
    .eq("company_id", resolved.identity.company_id)
    .eq("surface_enrollment_id", resolved.surfaceEnrollmentId)
    .eq("channel", resolved.identity.channel)
    .maybeSingle();
  if (error) throw new Error("COMMUNICATION_RULE_READ_FAILED");
  const row = data as { status: RuleStatus } | null;
  if (!row) fail("COMMUNICATION_RULE_NOT_FOUND", "Automation rule was not found in this context.");
  return row.status;
}

/**
 * A brand-new rule can never be created on a surface with zero bound Report
 * Manifest datasets -- the frontend already hides "New Rule" there, but a
 * direct API call must be rejected server-side too (fail closed, never an
 * invented/fallback dataset).
 */
export function assertSurfaceHasDataset(page: RuntimeCatalogPage, surfaceKey: string): void {
  if (datasetsForSurface(page, surfaceKey).length === 0) {
    fail("COMMUNICATION_RULE_DATASET_UNAVAILABLE", "No automation dataset is available for this surface.");
  }
}

async function prepareRuleMutation(
  req: Request,
  ctx: HandlerContext,
): Promise<{ resolved: ResolvedConfigurationContext; rule: AutomationRuleInput; dataset: ReportDatasetManifest | null }> {
  const { identity, rule } = await parseMutationRequest(req);
  const resolved = await resolveConfigurationContext(identity, ctx);
  if (!rule.id) assertSurfaceHasDataset(resolved.page, resolved.surface.key);
  const dataset = validateDatasetAndColumns(resolved.page, resolved.surface.key, rule);
  return { resolved, rule, dataset };
}

export function ruleRpcArgs(
  resolved: Pick<ResolvedConfigurationContext, "identity" | "surfaceEnrollmentId">,
  rule: AutomationRuleInput,
  ctx: Pick<HandlerContext, "auth_user_id">,
) {
  return {
    p_rule_id: rule.id,
    p_company_id: resolved.identity.company_id,
    p_surface_enrollment_id: resolved.surfaceEnrollmentId,
    p_channel: resolved.identity.channel,
    p_rule_name: rule.rule_name,
    p_dataset_key: rule.dataset_key,
    p_subject_template: rule.subject_template,
    p_schedule_kind: rule.schedule_kind,
    p_schedule_time: rule.schedule_time ? `${rule.schedule_time}:00` : null,
    p_schedule_timezone: rule.schedule_timezone,
    p_weekly_days: rule.weekly_days,
    p_monthly_day: rule.monthly_day,
    p_skip_empty: rule.skip_empty,
    p_expected_version_no: rule.version_no,
    p_recipients: rule.recipients,
    p_columns: rule.columns,
    p_actor: ctx.auth_user_id,
  };
}

function failOnRuleRpcError(error: { message: string; code?: string }, saveFailedCode: string): never {
  if (error.message.includes("COMMUNICATION_RULE_VERSION_CONFLICT")) {
    fail("COMMUNICATION_RULE_VERSION_CONFLICT", "This rule changed in another session. Reload it before saving.");
  }
  if (error.message.includes("COMMUNICATION_RULE_NOT_FOUND")) {
    fail("COMMUNICATION_RULE_NOT_FOUND", "Automation rule was not found in this context.");
  }
  if (error.code === "23505") {
    fail("COMMUNICATION_RULE_NAME_DUPLICATE", "A rule with this name already exists for this surface.");
  }
  throw new Error(saveFailedCode);
}

/**
 * Generic save/update. Status is never taken from the caller: a new rule is
 * always created DRAFT, and an existing rule always keeps whatever status it
 * already has (DRAFT -> DRAFT, ACTIVE -> ACTIVE, INACTIVE -> INACTIVE). Only
 * activateCommunicationRuleHandler/deactivateCommunicationRuleHandler may
 * change lifecycle status, and only through their own explicit RPCs.
 */
export async function saveCommunicationRuleHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    const { resolved, rule, dataset } = await prepareRuleMutation(req, ctx);
    if (rule.id) {
      // An ACTIVE rule must stay valid across every ordinary edit -- a save
      // that would quietly leave it ACTIVE but no longer meeting activation
      // requirements (e.g. its last TO recipient removed) is rejected rather
      // than silently degrading what the scheduler will later treat as live.
      const currentStatus = await fetchRuleStatus(resolved, rule.id);
      if (currentStatus === "ACTIVE") validateActivation(rule, dataset);
    }
    const { data, error } = await resolved.db.schema("erp_communication").rpc("save_automation_rule", ruleRpcArgs(resolved, rule, ctx));
    if (error) failOnRuleRpcError(error, "COMMUNICATION_RULE_SAVE_FAILED");
    const savedId = (data as Array<{ rule_id: string }> | null)?.[0]?.rule_id;
    if (!savedId) throw new Error("COMMUNICATION_RULE_SAVE_FAILED");
    return okResponse({ rule: await readRuleForContext(resolved, savedId) }, ctx.request_id, req);
  } catch (error) {
    return responseForError(error, ctx, req);
  }
}

export async function activateCommunicationRuleHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    const { resolved, rule, dataset } = await prepareRuleMutation(req, ctx);
    validateActivation(rule, dataset);
    const { data, error } = await resolved.db.schema("erp_communication").rpc("activate_automation_rule", ruleRpcArgs(resolved, rule, ctx));
    if (error) failOnRuleRpcError(error, "COMMUNICATION_RULE_ACTIVATE_FAILED");
    const savedId = (data as Array<{ rule_id: string }> | null)?.[0]?.rule_id;
    if (!savedId) throw new Error("COMMUNICATION_RULE_ACTIVATE_FAILED");
    return okResponse({ rule: await readRuleForContext(resolved, savedId) }, ctx.request_id, req);
  } catch (error) {
    return responseForError(error, ctx, req);
  }
}

export async function deactivateCommunicationRuleHandler(req: Request, ctx: HandlerContext): Promise<Response> {
  try {
    let body: unknown;
    try { body = await req.json(); } catch { fail("COMMUNICATION_RULE_INPUT_INVALID", "Rule configuration is required."); }
    assertNoForbiddenPayloadKeys(body);
    if (!isRecord(body)) fail("COMMUNICATION_RULE_INPUT_INVALID", "Rule configuration is required.");
    requireOnlyKeys(body, ["tx_code", "resource_code", "surface_key", "company_id", "channel", "rule_id", "version_no"], "COMMUNICATION_RULE_INPUT_INVALID");
    const identity = parseRuleConfigurationIdentity(body);
    const ruleId = trimmedString(body.rule_id, 160);
    if (!ruleId || !Number.isInteger(body.version_no) || (body.version_no as number) < 1) {
      fail("COMMUNICATION_RULE_INPUT_INVALID", "Rule ID and version are required.");
    }
    const resolved = await resolveConfigurationContext(identity, ctx);
    const { data, error } = await resolved.db.schema("erp_communication").rpc("set_automation_rule_status", {
      p_rule_id: ruleId,
      p_company_id: resolved.identity.company_id,
      p_surface_enrollment_id: resolved.surfaceEnrollmentId,
      p_channel: resolved.identity.channel,
      p_status: "INACTIVE",
      p_expected_version_no: body.version_no,
      p_actor: ctx.auth_user_id,
    });
    if (error) {
      if (error.message.includes("COMMUNICATION_RULE_VERSION_CONFLICT")) {
        fail("COMMUNICATION_RULE_VERSION_CONFLICT", "This rule changed in another session. Reload it before deactivating.");
      }
      if (error.message.includes("COMMUNICATION_RULE_NOT_FOUND")) {
        fail("COMMUNICATION_RULE_NOT_FOUND", "Automation rule was not found in this context.");
      }
      if (error.message.includes("COMMUNICATION_RULE_INVALID_TRANSITION")) {
        fail("COMMUNICATION_RULE_INVALID_TRANSITION", "Only an active rule can be deactivated.");
      }
      throw new Error("COMMUNICATION_RULE_DEACTIVATE_FAILED");
    }
    const ruleIdFromRpc = (data as Array<{ rule_id: string }> | null)?.[0]?.rule_id;
    if (!ruleIdFromRpc) throw new Error("COMMUNICATION_RULE_DEACTIVATE_FAILED");
    return okResponse({ rule: await readRuleForContext(resolved, ruleIdFromRpc) }, ctx.request_id, req);
  } catch (error) {
    return responseForError(error, ctx, req);
  }
}
