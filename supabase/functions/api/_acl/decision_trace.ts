/*
 * File-ID: ID-6.16A
 * File-Path: supabase/functions/api/_acl/decision_trace.ts
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Structured ACL decision trace (explainability)
 * Authority: Backend
 *
 * NOTE:
 * - This file NEVER decides ALLOW / DENY
 * - It ONLY records "why" a decision happened
 * - Used for audit, debugging, preview-as-user
 */

/* =========================================================
 * Trace Types
 * ========================================================= */

export type AclTraceLayer =
  | "ADMIN_BYPASS"
  | "MODULE_HARD_DENY"
  | "USER_OVERRIDE_DENY"
  | "USER_OVERRIDE_ALLOW"
  | "ROLE_PERMISSION"
  | "CAPABILITY_PERMISSION"
  | "DEFAULT_DENY";

export type AclTraceEntry = {
  layer: AclTraceLayer;
  outcome: "ALLOW" | "DENY" | "SKIPPED";
  reason: string;
  meta?: Record<string, unknown>;
};

export type AclDecisionTrace = {
  final_decision: "ALLOW" | "DENY";
  entries: AclTraceEntry[];
};

/* =========================================================
 * Trace Builder
 * ========================================================= */

export function createDecisionTrace(): {
  add: (entry: AclTraceEntry) => void;
  finalize: (decision: "ALLOW" | "DENY") => AclDecisionTrace;
} {
  const entries: AclTraceEntry[] = [];

  return {
    add(entry: AclTraceEntry) {
      entries.push(entry);
    },

    finalize(decision: "ALLOW" | "DENY"): AclDecisionTrace {
      return {
        final_decision: decision,
        entries,
      };
    },
  };
}
