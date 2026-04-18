import { createClient } from "@supabase/supabase-js";
import { listCanonicalCompanyIds } from "./canonical_access.ts";

type DbClient = ReturnType<typeof createClient>;

type WorkContextAssignmentRow = {
  work_context_id: string;
  company_id: string;
};

type WorkContextProjectRow = {
  work_context_id: string;
  project_id: string;
};

type CompanyProjectRow = {
  company_id: string;
  project_id: string;
};

type DirectProjectRow = {
  project_id: string;
};

type ActiveProjectRow = {
  id: string;
};

export type EffectiveProjectAccess = {
  eligibleCompanyIds: string[];
  inheritedProjectIds: string[];
  directProjectOverrideIds: string[];
  effectiveProjectIds: string[];
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}

export async function resolveEffectiveProjectAccess(
  db: DbClient,
  authUserId: string,
  companyId?: string | null,
): Promise<EffectiveProjectAccess> {
  const eligibleCompanyIds = companyId
    ? [companyId]
    : await listCanonicalCompanyIds(db, authUserId);

  if (eligibleCompanyIds.length === 0) {
    return {
      eligibleCompanyIds: [],
      inheritedProjectIds: [],
      directProjectOverrideIds: [],
      effectiveProjectIds: [],
    };
  }

  const [{ data: directProjectRows }, { data: workContextAssignments }] = await Promise.all([
    db
      .schema("erp_map")
      .from("user_projects")
      .select("project_id")
      .eq("auth_user_id", authUserId),
    db
      .schema("erp_acl")
      .from("user_work_contexts")
      .select("work_context_id, company_id")
      .eq("auth_user_id", authUserId)
      .in("company_id", eligibleCompanyIds),
  ]);

  const directProjectIds = uniqueStrings(
    ((directProjectRows ?? []) as DirectProjectRow[]).map((row) => row.project_id),
  );
  const assignments = (workContextAssignments ?? []) as WorkContextAssignmentRow[];
  const workContextIds = uniqueStrings(assignments.map((row) => row.work_context_id));

  const { data: workContextProjectRows } = workContextIds.length === 0
    ? { data: [] }
    : await db
      .schema("erp_map")
      .from("work_context_projects")
      .select("work_context_id, project_id")
      .in("work_context_id", workContextIds);

  const mappedProjectIds = uniqueStrings(
    ((workContextProjectRows ?? []) as WorkContextProjectRow[]).map((row) => row.project_id),
  );
  const candidateProjectIds = uniqueStrings([...directProjectIds, ...mappedProjectIds]);

  if (candidateProjectIds.length === 0) {
    return {
      eligibleCompanyIds,
      inheritedProjectIds: [],
      directProjectOverrideIds: [],
      effectiveProjectIds: [],
    };
  }

  const [{ data: companyProjectRows }, { data: activeProjectRows }] = await Promise.all([
    db
      .schema("erp_map")
      .from("company_projects")
      .select("company_id, project_id")
      .in("company_id", eligibleCompanyIds)
      .in("project_id", candidateProjectIds),
    db
      .schema("erp_master")
      .from("projects")
      .select("id")
      .eq("status", "ACTIVE")
      .in("id", candidateProjectIds),
  ]);

  const activeProjectIdSet = new Set(
    ((activeProjectRows ?? []) as ActiveProjectRow[]).map((row) => row.id),
  );
  const companyProjectKeySet = new Set(
    ((companyProjectRows ?? []) as CompanyProjectRow[]).map((row) => `${row.company_id}:${row.project_id}`),
  );

  const workContextProjectMap = new Map<string, string[]>();
  for (const row of (workContextProjectRows ?? []) as WorkContextProjectRow[]) {
    const current = workContextProjectMap.get(row.work_context_id) ?? [];
    current.push(row.project_id);
    workContextProjectMap.set(row.work_context_id, current);
  }

  const inheritedProjectIds = uniqueStrings(
    assignments.flatMap((assignment) =>
      (workContextProjectMap.get(assignment.work_context_id) ?? []).filter((projectId) =>
        activeProjectIdSet.has(projectId) &&
        companyProjectKeySet.has(`${assignment.company_id}:${projectId}`)
      )
    ),
  );

  const directProjectOverrideIds = directProjectIds.filter((projectId) =>
    activeProjectIdSet.has(projectId) &&
    eligibleCompanyIds.some((eligibleCompanyId) =>
      companyProjectKeySet.has(`${eligibleCompanyId}:${projectId}`)
    )
  );

  return {
    eligibleCompanyIds,
    inheritedProjectIds,
    directProjectOverrideIds,
    effectiveProjectIds: uniqueStrings([
      ...inheritedProjectIds,
      ...directProjectOverrideIds,
    ]),
  };
}

export async function hasEffectiveProjectAccess(
  db: DbClient,
  authUserId: string,
  companyId: string,
  projectId: string,
): Promise<boolean> {
  const access = await resolveEffectiveProjectAccess(db, authUserId, companyId);
  return access.effectiveProjectIds.includes(projectId);
}
