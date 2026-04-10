/*
 * File-ID: ID-6.1 + ID-6.1A
 * File-Path: supabase/functions/api/_shared/role_ladder.ts
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Provide canonical role codes, numeric ranks, and deterministic normalization helpers.
 * Authority: Backend
 */

export const ROLE = Object.freeze({
  SA: "SA",
  GA: "GA",
  DIRECTOR: "DIRECTOR",
  L4_MANAGER: "L4_MANAGER",
  L3_MANAGER: "L3_MANAGER",
  L2_AUDITOR: "L2_AUDITOR",
  L1_AUDITOR: "L1_AUDITOR",
  L2_MANAGER: "L2_MANAGER",
  L1_MANAGER: "L1_MANAGER",
  L4_USER: "L4_USER",
  L3_USER: "L3_USER",
  L2_USER: "L2_USER",
  L1_USER: "L1_USER",
} as const);

export type RoleCode = (typeof ROLE)[keyof typeof ROLE];

export const ROLE_RANK: Record<RoleCode, number> = Object.freeze({
  SA: 999,
  GA: 888,
  DIRECTOR: 100,
  L4_MANAGER: 95,
  L3_MANAGER: 90,
  L2_AUDITOR: 80,
  L1_AUDITOR: 70,
  L2_MANAGER: 60,
  L1_MANAGER: 50,
  L4_USER: 40,
  L3_USER: 30,
  L2_USER: 20,
  L1_USER: 10,
});

/**
 * Deterministic normalization.
 * Accepts messy inputs (case, spaces, hyphens) and returns canonical RoleCode.
 * Unknown inputs return null (caller must default-deny).
 */
export function normalizeRoleCode(input: unknown): RoleCode | null {
  if (typeof input !== "string") return null;
  const raw = input.trim().toUpperCase().replace(/\s+/g, "_").replace(/-+/g, "_");

  // Accept common short aliases (minimal set; no guessing beyond deterministic mapping)
  const aliasMap: Record<string, RoleCode> = {
    "SUPER_ADMIN": ROLE.SA,
    "GLOBAL_ADMIN": ROLE.GA,
    "DIR": ROLE.DIRECTOR,
    "DIRECTOR": ROLE.DIRECTOR,
    "SA": ROLE.SA,
    "GA": ROLE.GA,
    "L4_MANAGER": ROLE.L4_MANAGER,
    "L3_MANAGER": ROLE.L3_MANAGER,
    "L2_AUDITOR": ROLE.L2_AUDITOR,
    "L1_AUDITOR": ROLE.L1_AUDITOR,
    "L2_MANAGER": ROLE.L2_MANAGER,
    "L1_MANAGER": ROLE.L1_MANAGER,
    "L4_USER": ROLE.L4_USER,
    "L3_USER": ROLE.L3_USER,
    "L2_USER": ROLE.L2_USER,
    "L1_USER": ROLE.L1_USER,
  };

  return aliasMap[raw] ?? null;
}

export function getRoleRank(role: unknown): number | null {
  const code = normalizeRoleCode(role);
  if (!code) return null;
  return ROLE_RANK[code];
}

export function isSuperAdmin(role: unknown): boolean {
  return normalizeRoleCode(role) === ROLE.SA;
}

export function isGlobalAdmin(role: unknown): boolean {
  return normalizeRoleCode(role) === ROLE.GA;
}

export function compareRoleRank(a: unknown, b: unknown): number | null {
  const ra = getRoleRank(a);
  const rb = getRoleRank(b);
  if (ra === null || rb === null) return null;
  return ra - rb; // >0 means a higher
}

export function isSameOrHigher(a: unknown, b: unknown): boolean {
  const diff = compareRoleRank(a, b);
  if (diff === null) return false;
  return diff >= 0;
}
