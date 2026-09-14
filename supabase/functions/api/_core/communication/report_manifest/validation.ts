import {
  findCommunicationSurfaceManifest,
  listCommunicationSurfaces,
} from "../surface_manifest.ts";
import {
  isKnownReportConditionOperator,
  isOperatorCompatibleWithReportFieldType,
} from "./operators.ts";
import {
  REPORT_FIELD_DATA_TYPES,
  REPORT_FORMAT_KINDS,
  type ReportConditionOperatorKey,
  type ReportDatasetManifest,
  type ReportFieldManifest,
} from "./types.ts";

export type ReportManifestValidationErrorCode =
  | "REPORT_MANIFEST_PAGE_NOT_FOUND"
  | "REPORT_MANIFEST_SURFACE_NOT_BOUND"
  | "REPORT_MANIFEST_DATASET_NOT_FOUND"
  | "REPORT_MANIFEST_FIELD_NOT_FOUND"
  | "REPORT_MANIFEST_FIELD_NOT_DISPLAYABLE"
  | "REPORT_MANIFEST_FIELD_NOT_CONDITIONABLE"
  | "REPORT_MANIFEST_OPERATOR_NOT_FOUND"
  | "REPORT_MANIFEST_OPERATOR_TYPE_INCOMPATIBLE"
  | "REPORT_MANIFEST_OPERATOR_NOT_ALLOWED"
  | "REPORT_MANIFEST_ENUM_VALUE_INVALID"
  | "REPORT_MANIFEST_DUPLICATE_OUTPUT_FIELD"
  | "REPORT_MANIFEST_DUPLICATE_DATASET_KEY"
  | "REPORT_MANIFEST_DUPLICATE_FIELD_KEY"
  | "REPORT_MANIFEST_EMPTY_STABLE_KEY"
  | "REPORT_MANIFEST_INVALID_SURFACE_BINDING"
  | "REPORT_MANIFEST_IDENTITY_FIELD_NOT_FOUND"
  | "REPORT_MANIFEST_DEFAULT_FIELD_NOT_FOUND"
  | "REPORT_MANIFEST_DEFAULT_FIELD_NOT_DISPLAYABLE"
  | "REPORT_MANIFEST_FIELD_OPERATOR_INCOMPATIBLE"
  | "REPORT_MANIFEST_FIELD_OPERATOR_REQUIRED"
  | "REPORT_MANIFEST_INVALID_FIELD_DEFINITION"
  | "REPORT_MANIFEST_INVALID_ENUM_DEFINITION";

export class ReportManifestValidationError extends Error {
  constructor(
    readonly code: ReportManifestValidationErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ReportManifestValidationError";
  }
}

function assertNonEmptyStableKey(value: string, detail: string): void {
  if (!value.trim()) {
    throw new ReportManifestValidationError(
      "REPORT_MANIFEST_EMPTY_STABLE_KEY",
      detail,
    );
  }
}

function assertNoDuplicates(
  keys: readonly string[],
  code: Extract<
    ReportManifestValidationErrorCode,
    | "REPORT_MANIFEST_DUPLICATE_DATASET_KEY"
    | "REPORT_MANIFEST_DUPLICATE_FIELD_KEY"
    | "REPORT_MANIFEST_INVALID_FIELD_DEFINITION"
  >,
  detail: string,
): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) throw new ReportManifestValidationError(code, detail);
    seen.add(key);
  }
}

function assertDeclaredFieldKey(
  fieldsByKey: ReadonlyMap<string, ReportFieldManifest>,
  fieldKey: string,
  missingCode:
    | "REPORT_MANIFEST_IDENTITY_FIELD_NOT_FOUND"
    | "REPORT_MANIFEST_DEFAULT_FIELD_NOT_FOUND",
): ReportFieldManifest {
  const field = fieldsByKey.get(fieldKey);
  if (!field) throw new ReportManifestValidationError(missingCode, fieldKey);
  return field;
}

function validateEnumDefinition(field: ReportFieldManifest): void {
  const runtimeEnumValues = (
    field as unknown as { enum_values?: unknown }
  ).enum_values;
  if (field.data_type !== "ENUM") {
    if (runtimeEnumValues !== undefined) {
      throw new ReportManifestValidationError(
        "REPORT_MANIFEST_INVALID_ENUM_DEFINITION",
        field.field_key,
      );
    }
    return;
  }

  const enumValues = runtimeEnumValues;
  if (!Array.isArray(enumValues) || enumValues.length === 0) {
    throw new ReportManifestValidationError(
      "REPORT_MANIFEST_INVALID_ENUM_DEFINITION",
      field.field_key,
    );
  }
  const values = new Set<string>();
  for (const enumValue of enumValues) {
    const record = enumValue && typeof enumValue === "object"
      ? enumValue as Record<string, unknown>
      : null;
    const enumValueKey = record?.value;
    const enumValueLabel = record?.label;
    if (
      typeof enumValueKey !== "string" || !enumValueKey.trim() ||
      typeof enumValueLabel !== "string" || !enumValueLabel.trim() ||
      values.has(enumValueKey)
    ) {
      throw new ReportManifestValidationError(
        "REPORT_MANIFEST_INVALID_ENUM_DEFINITION",
        field.field_key,
      );
    }
    values.add(enumValueKey);
  }
}

function validateFieldDefinition(field: ReportFieldManifest): void {
  assertNonEmptyStableKey(field.field_key, "field_key");
  if (!field.label.trim()) {
    throw new ReportManifestValidationError(
      "REPORT_MANIFEST_INVALID_FIELD_DEFINITION",
      field.field_key,
    );
  }
  if (!REPORT_FIELD_DATA_TYPES.includes(field.data_type)) {
    throw new ReportManifestValidationError(
      "REPORT_MANIFEST_INVALID_FIELD_DEFINITION",
      field.field_key,
    );
  }
  if (!REPORT_FORMAT_KINDS.includes(field.format_kind)) {
    throw new ReportManifestValidationError(
      "REPORT_MANIFEST_INVALID_FIELD_DEFINITION",
      field.field_key,
    );
  }
  if (!Array.isArray(field.allowed_operators)) {
    throw new ReportManifestValidationError(
      "REPORT_MANIFEST_INVALID_FIELD_DEFINITION",
      field.field_key,
    );
  }
  if (!field.conditionable && field.allowed_operators.length > 0) {
    throw new ReportManifestValidationError(
      "REPORT_MANIFEST_INVALID_FIELD_DEFINITION",
      field.field_key,
    );
  }
  if (field.conditionable && field.allowed_operators.length === 0) {
    throw new ReportManifestValidationError(
      "REPORT_MANIFEST_FIELD_OPERATOR_REQUIRED",
      field.field_key,
    );
  }
  assertNoDuplicates(
    field.allowed_operators,
    "REPORT_MANIFEST_INVALID_FIELD_DEFINITION",
    `${field.field_key}.allowed_operators`,
  );
  for (const operator of field.allowed_operators) {
    if (!isKnownReportConditionOperator(operator)) {
      throw new ReportManifestValidationError(
        "REPORT_MANIFEST_FIELD_OPERATOR_INCOMPATIBLE",
        field.field_key,
      );
    }
    if (!isOperatorCompatibleWithReportFieldType(field.data_type, operator)) {
      throw new ReportManifestValidationError(
        "REPORT_MANIFEST_FIELD_OPERATOR_INCOMPATIBLE",
        field.field_key,
      );
    }
  }
  validateEnumDefinition(field);
}

/** Validates developer-authored definitions before a registry is usable. */
export function assertReportManifestDefinitions(
  datasets: readonly ReportDatasetManifest[],
): void {
  const datasetKeys: string[] = [];
  for (const dataset of datasets) {
    assertNonEmptyStableKey(dataset.dataset_key, "dataset_key");
    datasetKeys.push(dataset.dataset_key);
    if (
      !dataset.label.trim() || !dataset.page.resource_code.trim() ||
      !dataset.page.tx_code?.trim()
    ) {
      throw new ReportManifestValidationError(
        "REPORT_MANIFEST_INVALID_FIELD_DEFINITION",
        dataset.dataset_key,
      );
    }
    if (dataset.surface_keys.length === 0 || dataset.fields.length === 0) {
      throw new ReportManifestValidationError(
        "REPORT_MANIFEST_INVALID_FIELD_DEFINITION",
        dataset.dataset_key,
      );
    }
    const communicationManifest = findCommunicationSurfaceManifest(
      dataset.page,
    );
    const availableSurfaceKeys = new Set(
      listCommunicationSurfaces(communicationManifest).map((surface) =>
        surface.key
      ),
    );
    for (const surfaceKey of dataset.surface_keys) {
      assertNonEmptyStableKey(surfaceKey, `${dataset.dataset_key}.surface_key`);
      if (!availableSurfaceKeys.has(surfaceKey)) {
        throw new ReportManifestValidationError(
          "REPORT_MANIFEST_INVALID_SURFACE_BINDING",
          surfaceKey,
        );
      }
    }
    assertNoDuplicates(
      dataset.surface_keys,
      "REPORT_MANIFEST_INVALID_FIELD_DEFINITION",
      `${dataset.dataset_key}.surface_keys`,
    );

    for (const field of dataset.fields) validateFieldDefinition(field);
    const fieldKeys = dataset.fields.map((field) => field.field_key);
    assertNoDuplicates(
      fieldKeys,
      "REPORT_MANIFEST_DUPLICATE_FIELD_KEY",
      dataset.dataset_key,
    );
    const fieldsByKey = new Map(
      dataset.fields.map((field) => [field.field_key, field]),
    );

    if (
      dataset.default_display_field_keys.length === 0 ||
      dataset.row_identity_field_keys.length === 0
    ) {
      throw new ReportManifestValidationError(
        "REPORT_MANIFEST_INVALID_FIELD_DEFINITION",
        dataset.dataset_key,
      );
    }
    assertNoDuplicates(
      dataset.default_display_field_keys,
      "REPORT_MANIFEST_INVALID_FIELD_DEFINITION",
      `${dataset.dataset_key}.default_display_field_keys`,
    );
    for (const fieldKey of dataset.default_display_field_keys) {
      assertNonEmptyStableKey(
        fieldKey,
        `${dataset.dataset_key}.default_display_field_key`,
      );
      const field = assertDeclaredFieldKey(
        fieldsByKey,
        fieldKey,
        "REPORT_MANIFEST_DEFAULT_FIELD_NOT_FOUND",
      );
      if (!field.displayable) {
        throw new ReportManifestValidationError(
          "REPORT_MANIFEST_DEFAULT_FIELD_NOT_DISPLAYABLE",
          fieldKey,
        );
      }
    }

    assertNoDuplicates(
      dataset.row_identity_field_keys,
      "REPORT_MANIFEST_INVALID_FIELD_DEFINITION",
      `${dataset.dataset_key}.row_identity_field_keys`,
    );
    for (const fieldKey of dataset.row_identity_field_keys) {
      assertNonEmptyStableKey(
        fieldKey,
        `${dataset.dataset_key}.row_identity_field_key`,
      );
      assertDeclaredFieldKey(
        fieldsByKey,
        fieldKey,
        "REPORT_MANIFEST_IDENTITY_FIELD_NOT_FOUND",
      );
    }
  }
  assertNoDuplicates(
    datasetKeys,
    "REPORT_MANIFEST_DUPLICATE_DATASET_KEY",
    "dataset_key",
  );
}

export function resolveReportManifestField(
  dataset: ReportDatasetManifest,
  fieldKey: string,
): ReportFieldManifest {
  const field = dataset.fields.find((candidate) =>
    candidate.field_key === fieldKey
  );
  if (!field) {
    throw new ReportManifestValidationError(
      "REPORT_MANIFEST_FIELD_NOT_FOUND",
      fieldKey,
    );
  }
  return field;
}

/**
 * Output columns reject duplicates.  Keeping that rule server-side makes
 * report ordering and future template substitution deterministic.
 */
export function resolveReportOutputFields(
  dataset: ReportDatasetManifest,
  requestedFieldKeys: readonly string[],
): readonly ReportFieldManifest[] {
  const seen = new Set<string>();
  return requestedFieldKeys.map((fieldKey) => {
    if (seen.has(fieldKey)) {
      throw new ReportManifestValidationError(
        "REPORT_MANIFEST_DUPLICATE_OUTPUT_FIELD",
        fieldKey,
      );
    }
    seen.add(fieldKey);
    const field = resolveReportManifestField(dataset, fieldKey);
    if (!field.displayable) {
      throw new ReportManifestValidationError(
        "REPORT_MANIFEST_FIELD_NOT_DISPLAYABLE",
        fieldKey,
      );
    }
    return field;
  });
}

export function assertReportCondition(
  dataset: ReportDatasetManifest,
  input: { field_key: string; operator_key: string },
): ReportFieldManifest {
  const field = resolveReportManifestField(dataset, input.field_key);
  if (!field.conditionable) {
    throw new ReportManifestValidationError(
      "REPORT_MANIFEST_FIELD_NOT_CONDITIONABLE",
      input.field_key,
    );
  }
  if (!isKnownReportConditionOperator(input.operator_key)) {
    throw new ReportManifestValidationError(
      "REPORT_MANIFEST_OPERATOR_NOT_FOUND",
      input.operator_key,
    );
  }
  const operator: ReportConditionOperatorKey = input.operator_key;
  if (!isOperatorCompatibleWithReportFieldType(field.data_type, operator)) {
    throw new ReportManifestValidationError(
      "REPORT_MANIFEST_OPERATOR_TYPE_INCOMPATIBLE",
      input.operator_key,
    );
  }
  if (!field.allowed_operators.includes(operator)) {
    throw new ReportManifestValidationError(
      "REPORT_MANIFEST_OPERATOR_NOT_ALLOWED",
      input.operator_key,
    );
  }
  return field;
}

export function assertReportEnumValue(
  field: ReportFieldManifest,
  value: string,
): void {
  if (field.data_type !== "ENUM") return;
  validateEnumDefinition(field);
  const enumValues = (
    field as unknown as { enum_values?: readonly { value: string }[] }
  ).enum_values;
  if (!enumValues || !enumValues.some((option) => option.value === value)) {
    throw new ReportManifestValidationError(
      "REPORT_MANIFEST_ENUM_VALUE_INVALID",
      value,
    );
  }
}
