import {
  assertReportCondition,
  assertReportEnumValue,
  assertReportManifestDefinitions,
  ReportManifestValidationError,
  resolveReportManifestField,
  resolveReportOutputFields,
} from "./validation.ts";
import { createReportManifestRegistry } from "./registry.ts";
import { PO11_PLANNING_ALERT_REPORT_DATASET } from "./po11_planning_alert.ts";
import { REPORT_MANIFEST_REGISTRY } from "./index.ts";
import type { ReportDatasetManifest } from "./types.ts";
import {
  findCommunicationSurfaceManifest,
  listCommunicationSurfaces,
} from "../surface_manifest.ts";

const PO11_PAGE = { tx_code: "PO11", resource_code: "PROC_PLANNING_VIEW" };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertErrorCode(action: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  assert(
    thrown instanceof ReportManifestValidationError,
    `Expected ${code} to throw ReportManifestValidationError`,
  );
  assert(thrown.code === code, `Expected ${code}, received ${thrown.code}`);
}

function validDataset(): ReportDatasetManifest {
  return {
    dataset_key: "test_alert",
    label: "Test Alert",
    page: PO11_PAGE,
    surface_keys: ["planning_dashboard"],
    row_identity_field_keys: ["decision_key"],
    default_display_field_keys: ["material_name", "planning_status"],
    fields: [
      {
        field_key: "decision_key",
        label: "Decision Key",
        data_type: "STRING",
        displayable: false,
        conditionable: false,
        allowed_operators: [],
        format_kind: "TEXT",
      },
      {
        field_key: "material_name",
        label: "Material Name",
        data_type: "STRING",
        displayable: true,
        conditionable: true,
        allowed_operators: ["EQ", "NE", "IN", "NOT_IN"],
        format_kind: "TEXT",
      },
      {
        field_key: "planning_status",
        label: "Planning Status",
        data_type: "ENUM",
        displayable: true,
        conditionable: true,
        allowed_operators: ["EQ", "NE", "IN", "NOT_IN"],
        format_kind: "ENUM_LABEL",
        enum_values: [
          { value: "CRITICAL", label: "Critical" },
          { value: "NORMAL", label: "Normal" },
        ],
      },
      {
        field_key: "available_stock_qty",
        label: "Available Stock",
        data_type: "NUMBER",
        displayable: true,
        conditionable: true,
        allowed_operators: ["EQ", "GT"],
        format_kind: "QUANTITY",
      },
      {
        field_key: "is_active",
        label: "Active",
        data_type: "BOOLEAN",
        displayable: true,
        conditionable: true,
        allowed_operators: ["EQ"],
        format_kind: "BOOLEAN",
      },
    ],
  };
}

Deno.test("report manifest definition accepts a valid manifest", () => {
  assertReportManifestDefinitions([validDataset()]);
});

Deno.test("report manifest definition rejects duplicate dataset keys", () => {
  const dataset = validDataset();
  assertErrorCode(
    () =>
      assertReportManifestDefinitions([dataset, {
        ...validDataset(),
        dataset_key: dataset.dataset_key,
      }]),
    "REPORT_MANIFEST_DUPLICATE_DATASET_KEY",
  );
});

Deno.test("report manifest definition rejects duplicate field keys", () => {
  const dataset = validDataset();
  dataset.fields = [...dataset.fields, { ...dataset.fields[0] }];
  assertErrorCode(
    () => assertReportManifestDefinitions([dataset]),
    "REPORT_MANIFEST_DUPLICATE_FIELD_KEY",
  );
});

Deno.test("report manifest definition rejects empty stable keys", () => {
  const dataset = validDataset();
  dataset.dataset_key = "";
  assertErrorCode(
    () => assertReportManifestDefinitions([dataset]),
    "REPORT_MANIFEST_EMPTY_STABLE_KEY",
  );
});

Deno.test("report manifest definition rejects an empty field key", () => {
  const dataset = validDataset();
  dataset.fields = dataset.fields.map((field) =>
    field.field_key === "material_name" ? { ...field, field_key: "" } : field
  );
  assertErrorCode(
    () => assertReportManifestDefinitions([dataset]),
    "REPORT_MANIFEST_EMPTY_STABLE_KEY",
  );
});

Deno.test("report manifest definition rejects an ENUM without an allowlist", () => {
  const dataset = validDataset();
  const statusField = resolveReportManifestField(dataset, "planning_status");
  const { enum_values: _ignored, ...withoutAllowlist } = statusField;
  dataset.fields = dataset.fields.map((field) =>
    field.field_key === "planning_status"
      ? (withoutAllowlist as unknown as ReportDatasetManifest["fields"][number])
      : field
  );
  assertErrorCode(
    () => assertReportManifestDefinitions([dataset]),
    "REPORT_MANIFEST_INVALID_ENUM_DEFINITION",
  );
});

Deno.test("report manifest definition rejects an ENUM with an empty allowlist", () => {
  const dataset = validDataset();
  dataset.fields = dataset.fields.map((field) =>
    field.field_key === "planning_status"
      ? ({
        ...field,
        enum_values: [],
      } as ReportDatasetManifest["fields"][number])
      : field
  );
  assertErrorCode(
    () => assertReportManifestDefinitions([dataset]),
    "REPORT_MANIFEST_INVALID_ENUM_DEFINITION",
  );
});

Deno.test("report manifest definition rejects duplicate enum values", () => {
  const dataset = validDataset();
  dataset.fields = dataset.fields.map((field) =>
    field.field_key === "planning_status"
      ? ({
        ...field,
        enum_values: [
          { value: "CRITICAL", label: "Critical" },
          { value: "CRITICAL", label: "Critical again" },
        ],
      } as ReportDatasetManifest["fields"][number])
      : field
  );
  assertErrorCode(
    () => assertReportManifestDefinitions([dataset]),
    "REPORT_MANIFEST_INVALID_ENUM_DEFINITION",
  );
});

Deno.test("report manifest definition rejects a blank enum value", () => {
  const dataset = validDataset();
  dataset.fields = dataset.fields.map((field) =>
    field.field_key === "planning_status"
      ? ({
        ...field,
        enum_values: [{ value: " ", label: "Critical" }],
      } as ReportDatasetManifest["fields"][number])
      : field
  );
  assertErrorCode(
    () => assertReportManifestDefinitions([dataset]),
    "REPORT_MANIFEST_INVALID_ENUM_DEFINITION",
  );
});

Deno.test("report manifest definition rejects a blank enum label", () => {
  const dataset = validDataset();
  dataset.fields = dataset.fields.map((field) =>
    field.field_key === "planning_status"
      ? ({
        ...field,
        enum_values: [{ value: "CRITICAL", label: " " }],
      } as ReportDatasetManifest["fields"][number])
      : field
  );
  assertErrorCode(
    () => assertReportManifestDefinitions([dataset]),
    "REPORT_MANIFEST_INVALID_ENUM_DEFINITION",
  );
});

Deno.test("report manifest definition rejects enum metadata on a non-ENUM field", () => {
  const dataset = validDataset();
  dataset.fields = dataset.fields.map((field) =>
    field.field_key === "material_name"
      ? ({
        ...field,
        enum_values: [{ value: "MATERIAL", label: "Material" }],
      } as unknown as ReportDatasetManifest["fields"][number])
      : field
  );
  assertErrorCode(
    () => assertReportManifestDefinitions([dataset]),
    "REPORT_MANIFEST_INVALID_ENUM_DEFINITION",
  );
});

Deno.test("report manifest definition rejects an unknown communication surface", () => {
  const dataset = validDataset();
  dataset.surface_keys = ["not_a_surface"];
  assertErrorCode(
    () => assertReportManifestDefinitions([dataset]),
    "REPORT_MANIFEST_INVALID_SURFACE_BINDING",
  );
});

Deno.test("report manifest definition rejects an identity field that is not declared", () => {
  const dataset = validDataset();
  dataset.row_identity_field_keys = ["missing_identity"];
  assertErrorCode(
    () => assertReportManifestDefinitions([dataset]),
    "REPORT_MANIFEST_IDENTITY_FIELD_NOT_FOUND",
  );
});

Deno.test("report manifest definition rejects a missing default display field", () => {
  const dataset = validDataset();
  dataset.default_display_field_keys = ["missing_field"];
  assertErrorCode(
    () => assertReportManifestDefinitions([dataset]),
    "REPORT_MANIFEST_DEFAULT_FIELD_NOT_FOUND",
  );
});

Deno.test("report manifest definition rejects a non-displayable default field", () => {
  const dataset = validDataset();
  dataset.default_display_field_keys = ["decision_key"];
  assertErrorCode(
    () => assertReportManifestDefinitions([dataset]),
    "REPORT_MANIFEST_DEFAULT_FIELD_NOT_DISPLAYABLE",
  );
});

Deno.test("report manifest definition rejects an operator incompatible with its field type", () => {
  const dataset = validDataset();
  dataset.fields = dataset.fields.map((field) =>
    field.field_key === "material_name"
      ? { ...field, allowed_operators: ["GT"] }
      : field
  );
  assertErrorCode(
    () => assertReportManifestDefinitions([dataset]),
    "REPORT_MANIFEST_FIELD_OPERATOR_INCOMPATIBLE",
  );
});

Deno.test("report registry resolves a valid page, surface, and dataset", () => {
  const registry = createReportManifestRegistry([validDataset()]);
  assert(
    registry.resolveDataset(PO11_PAGE, "planning_dashboard", "test_alert")
      .dataset_key === "test_alert",
    "Expected the requested dataset",
  );
});

Deno.test("report registry rejects a valid-but-unbound surface", () => {
  const registry = createReportManifestRegistry([validDataset()]);
  assertErrorCode(
    () =>
      registry.resolveDataset(PO11_PAGE, "monthly_plan_input", "test_alert"),
    "REPORT_MANIFEST_SURFACE_NOT_BOUND",
  );
});

Deno.test("report registry rejects an unknown page", () => {
  const registry = createReportManifestRegistry([validDataset()]);
  assertErrorCode(
    () =>
      registry.resolveDataset(
        { tx_code: "PO99", resource_code: "UNKNOWN_REPORT" },
        "planning_dashboard",
        "test_alert",
      ),
    "REPORT_MANIFEST_PAGE_NOT_FOUND",
  );
});

Deno.test("runtime resolution and field permissions fail closed", () => {
  const dataset = validDataset();
  const registry = createReportManifestRegistry([dataset]);
  assertErrorCode(
    () => registry.resolveDataset(PO11_PAGE, "planning_dashboard", "unknown"),
    "REPORT_MANIFEST_DATASET_NOT_FOUND",
  );
  assertErrorCode(
    () => resolveReportManifestField(dataset, "unknown"),
    "REPORT_MANIFEST_FIELD_NOT_FOUND",
  );
  assertErrorCode(
    () => resolveReportOutputFields(dataset, ["decision_key"]),
    "REPORT_MANIFEST_FIELD_NOT_DISPLAYABLE",
  );
  assertErrorCode(
    () =>
      assertReportCondition(dataset, {
        field_key: "decision_key",
        operator_key: "EQ",
      }),
    "REPORT_MANIFEST_FIELD_NOT_CONDITIONABLE",
  );
  assertErrorCode(
    () =>
      assertReportCondition(dataset, {
        field_key: "material_name",
        operator_key: "LIKE",
      }),
    "REPORT_MANIFEST_OPERATOR_NOT_FOUND",
  );
  assertErrorCode(
    () =>
      assertReportCondition(dataset, {
        field_key: "is_active",
        operator_key: "GT",
      }),
    "REPORT_MANIFEST_OPERATOR_TYPE_INCOMPATIBLE",
  );
  assertErrorCode(
    () =>
      assertReportCondition(dataset, {
        field_key: "available_stock_qty",
        operator_key: "IS_EMPTY",
      }),
    "REPORT_MANIFEST_OPERATOR_NOT_ALLOWED",
  );
});

Deno.test("runtime enum values and duplicate output columns are validated", () => {
  const dataset = validDataset();
  const statusField = resolveReportManifestField(dataset, "planning_status");
  assertReportEnumValue(statusField, "CRITICAL");
  assertErrorCode(
    () => assertReportEnumValue(statusField, "REPLENISH"),
    "REPORT_MANIFEST_ENUM_VALUE_INVALID",
  );
  assertErrorCode(
    () =>
      resolveReportOutputFields(dataset, ["material_name", "material_name"]),
    "REPORT_MANIFEST_DUPLICATE_OUTPUT_FIELD",
  );
});

Deno.test("runtime malformed ENUM definitions cannot bypass validation", () => {
  const dataset = validDataset();
  const statusField = resolveReportManifestField(dataset, "planning_status");
  const { enum_values: _ignored, ...withoutAllowlist } = statusField;
  const missingAllowlistField =
    withoutAllowlist as ReportDatasetManifest["fields"][number];
  const emptyAllowlistField = {
    ...statusField,
    enum_values: [],
  } as ReportDatasetManifest["fields"][number];
  assertErrorCode(
    () => assertReportEnumValue(missingAllowlistField, "ANY_VALUE"),
    "REPORT_MANIFEST_INVALID_ENUM_DEFINITION",
  );
  assertErrorCode(
    () => assertReportEnumValue(emptyAllowlistField, "ANY_VALUE"),
    "REPORT_MANIFEST_INVALID_ENUM_DEFINITION",
  );
});

Deno.test("PO11 Planning Alert metadata is registered, bounded, and metadata-only", () => {
  assertReportManifestDefinitions([PO11_PLANNING_ALERT_REPORT_DATASET]);
  const dataset = REPORT_MANIFEST_REGISTRY.resolveDataset(
    PO11_PAGE,
    "planning_dashboard",
    "planning_alert",
  );
  assert(
    dataset === PO11_PLANNING_ALERT_REPORT_DATASET,
    "Expected registered PO11 dataset",
  );
  assert(
    REPORT_MANIFEST_REGISTRY.listDatasetsForPage(PO11_PAGE).filter(
      (item) => item.dataset_key === "planning_alert",
    ).length === 1,
    "planning_alert must be unique for PO11",
  );
  const statusField = resolveReportManifestField(dataset, "planning_status");
  assert(
    JSON.stringify(statusField.enum_values?.map((item) => item.value)) ===
      JSON.stringify(["CRITICAL", "REPLENISH", "NORMAL"]),
    "Planning Status must use only the stable PO11 business values",
  );
  const publicManifest = JSON.stringify(dataset).toLowerCase();
  assert(
    !/(schema|table|column|select|from|sql)/.test(publicManifest),
    "Manifest must not expose database internals",
  );
  assert(
    !("loadRows" in (dataset as unknown as Record<string, unknown>)),
    "Manifest must not contain an adapter",
  );
  const communicationManifest = findCommunicationSurfaceManifest(dataset.page);
  const communicationSurfaceKeys = new Set(
    listCommunicationSurfaces(communicationManifest).map((item) => item.key),
  );
  assert(
    dataset.surface_keys.every((key) => communicationSurfaceKeys.has(key)),
    "Every report binding must exist in the Communication Surface Manifest",
  );
  const fieldKeys = new Set(dataset.fields.map((field) => field.field_key));
  assert(
    dataset.row_identity_field_keys.every((key) => fieldKeys.has(key)),
    "Row identity must reference only declared fields",
  );
});
