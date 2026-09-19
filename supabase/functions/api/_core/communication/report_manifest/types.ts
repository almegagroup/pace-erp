/*
 * Communication Automation — Report Manifest contract.
 *
 * This module intentionally describes only safe, business-level metadata.
 * A future report adapter may turn an authoritative PACE page result into
 * these field keys, but manifest consumers never receive database metadata.
 */

import type { CommunicationManifestPageIdentity } from "../surface_manifest.ts";

export const REPORT_FIELD_DATA_TYPES = [
  "STRING",
  "NUMBER",
  "INTEGER",
  "BOOLEAN",
  "DATE",
  "DATETIME",
  "ENUM",
] as const;

export type ReportFieldDataType = (typeof REPORT_FIELD_DATA_TYPES)[number];

export const REPORT_FORMAT_KINDS = [
  "TEXT",
  "DECIMAL",
  "QUANTITY",
  "INTEGER",
  "DATE",
  "DATETIME",
  "ENUM_LABEL",
  "BOOLEAN",
] as const;

export type ReportFormatKind = (typeof REPORT_FORMAT_KINDS)[number];

export type ReportConditionOperatorKey =
  | "EQ"
  | "NE"
  | "IN"
  | "NOT_IN"
  | "GT"
  | "GTE"
  | "LT"
  | "LTE"
  | "BETWEEN"
  | "IS_EMPTY"
  | "IS_NOT_EMPTY";

export type ReportManifestEnumValue = {
  value: string;
  label: string;
};

type ReportFieldManifestBase = {
  /** Stable application contract, never a client-supplied database column. */
  field_key: string;
  label: string;
  displayable: boolean;
  conditionable: boolean;
  allowed_operators: readonly ReportConditionOperatorKey[];
  format_kind: ReportFormatKind;
};

/**
 * Fixed enum values are part of the persisted rule contract.  Keeping this a
 * discriminated union catches a missing allowlist while developers author a
 * manifest; validation still protects malformed values at runtime.
 */
export type ReportEnumFieldManifest = ReportFieldManifestBase & {
  data_type: "ENUM";
  enum_values: readonly ReportManifestEnumValue[];
};

export type ReportNonEnumFieldManifest = ReportFieldManifestBase & {
  data_type: Exclude<ReportFieldDataType, "ENUM">;
  enum_values?: never;
};

export type ReportFieldManifest =
  | ReportEnumFieldManifest
  | ReportNonEnumFieldManifest;

export type ReportDatasetManifest = {
  /** Stable application contract, never a table, query, or SQL expression. */
  dataset_key: string;
  label: string;
  description?: string;
  page: CommunicationManifestPageIdentity;
  surface_keys: readonly string[];
  fields: readonly ReportFieldManifest[];
  default_display_field_keys: readonly string[];
  row_identity_field_keys: readonly string[];
  empty_output_is_meaningful?: boolean;
  intended_row_grain?: string;
};

/**
 * Phase 4 may implement this behind a code-owned adapter registry.  The
 * report manifest itself neither carries nor exposes an adapter implementation.
 */
export type ReportDatasetAdapter<Row, Context = unknown> = {
  dataset_key: string;
  loadRows(context: Context): Promise<readonly Row[]>;
};
