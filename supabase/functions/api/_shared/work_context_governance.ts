/*
 * File-ID: 0.5C
 * File-Path: supabase/functions/api/_shared/work_context_governance.ts
 * Gate: 0
 * Phase: 0
 * Domain: SECURITY
 * Purpose: Keep system work contexts aligned with company and department lifecycle events
 * Authority: Backend
 */

import type { DbClient } from "./db_client.ts";

type DepartmentWorkContextInput = {
  companyId: string;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  isActive?: boolean;
};

function normalizeDepartmentContextCode(departmentCode: string): string {
  return `DEPT_${departmentCode.trim().toUpperCase()}`;
}

export async function ensureGeneralOpsWorkContext(
  db: DbClient,
  companyId: string,
  isActive = true,
): Promise<void> {
  const { error } = await db
    .schema("erp_acl")
    .from("work_contexts")
    .upsert(
      {
        company_id: companyId,
        work_context_code: "GENERAL_OPS",
        work_context_name: "General Operations",
        description: "Default company-wide operational work context.",
        department_id: null,
        is_system: true,
        is_active: isActive,
      },
      {
        onConflict: "company_id,work_context_code",
      },
    );

  if (error) {
    throw new Error("GENERAL_WORK_CONTEXT_UPSERT_FAILED");
  }
}

export async function ensureDepartmentWorkContext(
  db: DbClient,
  input: DepartmentWorkContextInput,
): Promise<void> {
  const { error } = await db
    .schema("erp_acl")
    .from("work_contexts")
    .upsert(
      {
        company_id: input.companyId,
        work_context_code: normalizeDepartmentContextCode(input.departmentCode),
        work_context_name: input.departmentName.trim(),
        description: `System work context for department ${input.departmentCode.trim().toUpperCase()}.`,
        department_id: input.departmentId,
        is_system: true,
        is_active: input.isActive !== false,
      },
      {
        onConflict: "company_id,work_context_code",
      },
    );

  if (error) {
    throw new Error("DEPARTMENT_WORK_CONTEXT_UPSERT_FAILED");
  }
}

export async function ensureCompanyOperationalWorkContexts(
  db: DbClient,
  companyId: string,
): Promise<void> {
  await ensureGeneralOpsWorkContext(db, companyId, true);

  const { data: departments, error } = await db
    .schema("erp_master")
    .from("departments")
    .select("id, department_code, department_name")
    .eq("company_id", companyId)
    .eq("status", "ACTIVE");

  if (error) {
    throw new Error("DEPARTMENT_WORK_CONTEXT_FETCH_FAILED");
  }

  for (const department of departments ?? []) {
    await ensureDepartmentWorkContext(db, {
      companyId,
      departmentId: department.id,
      departmentCode: department.department_code,
      departmentName: department.department_name,
      isActive: true,
    });
  }
}

export async function setSystemWorkContextsActiveState(
  db: DbClient,
  companyId: string,
  isActive: boolean,
): Promise<void> {
  const { error } = await db
    .schema("erp_acl")
    .from("work_contexts")
    .update({
      is_active: isActive,
    })
    .eq("company_id", companyId)
    .eq("is_system", true);

  if (error) {
    throw new Error("SYSTEM_WORK_CONTEXT_STATE_SYNC_FAILED");
  }
}
