import type {
  ReportConditionOperatorKey,
  ReportFieldDataType,
} from "./types.ts";

export type ReportConditionOperatorDefinition = {
  key: ReportConditionOperatorKey;
  label: string;
};

export const REPORT_CONDITION_OPERATORS: Readonly<
  Record<ReportConditionOperatorKey, ReportConditionOperatorDefinition>
> = {
  EQ: { key: "EQ", label: "=" },
  NE: { key: "NE", label: "!=" },
  IN: { key: "IN", label: "IN" },
  NOT_IN: { key: "NOT_IN", label: "NOT IN" },
  GT: { key: "GT", label: ">" },
  GTE: { key: "GTE", label: ">=" },
  LT: { key: "LT", label: "<" },
  LTE: { key: "LTE", label: "<=" },
  BETWEEN: { key: "BETWEEN", label: "BETWEEN" },
  IS_EMPTY: { key: "IS_EMPTY", label: "IS EMPTY" },
  IS_NOT_EMPTY: { key: "IS_NOT_EMPTY", label: "IS NOT EMPTY" },
};

const TEXT_OPERATORS: readonly ReportConditionOperatorKey[] = [
  "EQ",
  "NE",
  "IN",
  "NOT_IN",
  "IS_EMPTY",
  "IS_NOT_EMPTY",
];

const ORDERED_VALUE_OPERATORS: readonly ReportConditionOperatorKey[] = [
  "EQ",
  "NE",
  "IN",
  "NOT_IN",
  "GT",
  "GTE",
  "LT",
  "LTE",
  "BETWEEN",
  "IS_EMPTY",
  "IS_NOT_EMPTY",
];

export const REPORT_TYPE_OPERATORS: Readonly<
  Record<ReportFieldDataType, readonly ReportConditionOperatorKey[]>
> = {
  STRING: TEXT_OPERATORS,
  ENUM: TEXT_OPERATORS,
  NUMBER: ORDERED_VALUE_OPERATORS,
  INTEGER: ORDERED_VALUE_OPERATORS,
  DATE: ORDERED_VALUE_OPERATORS,
  DATETIME: ORDERED_VALUE_OPERATORS,
  BOOLEAN: ["EQ", "NE"],
};

export function isKnownReportConditionOperator(
  value: string,
): value is ReportConditionOperatorKey {
  return Object.prototype.hasOwnProperty.call(
    REPORT_CONDITION_OPERATORS,
    value,
  );
}

export function isOperatorCompatibleWithReportFieldType(
  dataType: ReportFieldDataType,
  operator: ReportConditionOperatorKey,
): boolean {
  return REPORT_TYPE_OPERATORS[dataType].includes(operator);
}
