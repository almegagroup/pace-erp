/*
 * File-ID: 27.0
 * File-Path: supabase/functions/api/_core/production/production.shared.ts
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Shared context type, role guards, and helper utilities for all production handlers.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";

export type ProdHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

// SA, GA, DIRECTOR, Managers, Auditors — full write + approve authority
const MANAGER_OR_SA_ROLES = new Set([
  "SA", "GA", "DIRECTOR",
  "L4_MANAGER", "L3_MANAGER",
  "L2_AUDITOR", "L1_AUDITOR",
  "L2_MANAGER",
]);

// SA-only (config operations)
export function assertSARole(ctx: ProdHandlerContext): void {
  if (ctx.roleCode !== "SA") {
    throw new Error("PROD_SA_REQUIRED");
  }
}

// Manager+ or Auditor — used for approve actions and config writes
export function assertManagerOrSARole(ctx: ProdHandlerContext): void {
  if (!MANAGER_OR_SA_ROLES.has(ctx.roleCode)) {
    throw new Error("PROD_MANAGER_OR_SA_REQUIRED");
  }
}

// Any authenticated user with production capability can read
export function assertProdReadRole(_ctx: ProdHandlerContext): void {
  // Protected upstream by ACL capability check.
}

export function parseBody(req: Request): Promise<Record<string, unknown>> {
  return req.json().catch(() => ({} as Record<string, unknown>));
}

export function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

export function toUpperTrimmedString(value: unknown): string {
  return toTrimmedString(value).toUpperCase();
}

export function parsePositiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseNonNegativeNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parsePositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && Number.isInteger(n) ? n : null;
}

export function getIdFromPath(req: Request, segmentIndex = 3): string {
  return new URL(req.url).pathname.split("/").filter(Boolean)[segmentIndex] ?? "";
}
