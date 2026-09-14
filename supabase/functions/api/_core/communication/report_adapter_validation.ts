/* Generic fail-closed validator for code-owned report-adapter output. */

import {
  assertReportEnumValue,
  resolveReportManifestField,
} from "./report_manifest/validation.ts";
import type {
  ReportDatasetManifest,
  ReportFieldManifest,
} from "./report_manifest/types.ts";

export type ReportAdapterOutputRow = Record<string, unknown>;

export type ReportAdapterOutputValidationErrorCode =
  | "REPORT_ADAPTER_OUTPUT_ROW_INVALID"
  | "REPORT_ADAPTER_OUTPUT_UNDECLARED_FIELD"
  | "REPORT_ADAPTER_OUTPUT_FIELD_MISSING"
  | "REPORT_ADAPTER_OUTPUT_IDENTITY_MISSING"
  | "REPORT_ADAPTER_OUTPUT_DUPLICATE_IDENTITY"
  | "REPORT_ADAPTER_OUTPUT_ENUM_INVALID"
  | "REPORT_ADAPTER_OUTPUT_INVALID_NUMBER"
  | "REPORT_ADAPTER_OUTPUT_INVALID_STRING"
  | "REPORT_ADAPTER_OUTPUT_INVALID_BOOLEAN";

export class ReportAdapterOutputValidationError extends Error {
  constructor(
    readonly code: ReportAdapterOutputValidationErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ReportAdapterOutputValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertFieldValue(field: ReportFieldManifest, value: unknown): void {
  if (field.data_type === "NUMBER" || field.data_type === "INTEGER") {
    if (
      !Number.isFinite(value) ||
      (field.data_type === "INTEGER" && !Number.isInteger(value))
    ) {
      throw new ReportAdapterOutputValidationError(
        "REPORT_ADAPTER_OUTPUT_INVALID_NUMBER",
        field.field_key,
      );
    }
    return;
  }
  if (field.data_type === "BOOLEAN") {
    if (typeof value !== "boolean") {
      throw new ReportAdapterOutputValidationError(
        "REPORT_ADAPTER_OUTPUT_INVALID_BOOLEAN",
        field.field_key,
      );
    }
    return;
  }
  if (typeof value !== "string") {
    throw new ReportAdapterOutputValidationError(
      "REPORT_ADAPTER_OUTPUT_INVALID_STRING",
      field.field_key,
    );
  }
  if (field.data_type === "ENUM") {
    try {
      assertReportEnumValue(field, value);
    } catch {
      throw new ReportAdapterOutputValidationError(
        "REPORT_ADAPTER_OUTPUT_ENUM_INVALID",
        field.field_key,
      );
    }
  }
}

function assertIdentityValue(value: unknown, fieldKey: string): string {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new ReportAdapterOutputValidationError(
      "REPORT_ADAPTER_OUTPUT_IDENTITY_MISSING",
      fieldKey,
    );
  }
  return String(value).trim();
}

/**
 * Validates an adapter's complete safe output shape before any future rule
 * engine or delivery code can see it.
 */
export function assertReportAdapterOutput(
  dataset: ReportDatasetManifest,
  rows: readonly unknown[],
): readonly ReportAdapterOutputRow[] {
  const declaredFields = new Map(
    dataset.fields.map((field) => [field.field_key, field]),
  );
  const identities = new Set<string>();
  return rows.map((candidate) => {
    if (!isRecord(candidate)) {
      throw new ReportAdapterOutputValidationError(
        "REPORT_ADAPTER_OUTPUT_ROW_INVALID",
      );
    }
    for (const key of Object.keys(candidate)) {
      if (!declaredFields.has(key)) {
        throw new ReportAdapterOutputValidationError(
          "REPORT_ADAPTER_OUTPUT_UNDECLARED_FIELD",
          key,
        );
      }
    }
    for (const field of dataset.fields) {
      if (!Object.prototype.hasOwnProperty.call(candidate, field.field_key)) {
        throw new ReportAdapterOutputValidationError(
          "REPORT_ADAPTER_OUTPUT_FIELD_MISSING",
          field.field_key,
        );
      }
      assertFieldValue(field, candidate[field.field_key]);
    }
    const identity = JSON.stringify(
      dataset.row_identity_field_keys.map((fieldKey) => {
        const field = resolveReportManifestField(dataset, fieldKey);
        assertFieldValue(field, candidate[fieldKey]);
        return assertIdentityValue(candidate[fieldKey], fieldKey);
      }),
    );
    if (identities.has(identity)) {
      throw new ReportAdapterOutputValidationError(
        "REPORT_ADAPTER_OUTPUT_DUPLICATE_IDENTITY",
        identity,
      );
    }
    identities.add(identity);
    return candidate;
  });
}
