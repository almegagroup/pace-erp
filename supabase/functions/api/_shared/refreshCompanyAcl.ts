/*
 * File-Path: supabase/functions/api/_shared/refreshCompanyAcl.ts
 * Purpose: after a company's module/project setup changes, rebuild its ACL version + every user's menu
 *          (public.refresh_company_acl). Best-effort: the setup change itself already succeeded, so a failure
 *          here is logged and reported, never thrown -- an admin can re-run the same action to retry.
 */
import { getServiceRoleClientWithContext } from "./serviceRoleClient.ts";

type Db = ReturnType<typeof getServiceRoleClientWithContext>;

export async function refreshCompanyAcl(
  db: Db,
  companyId: string,
  reason: string,
): Promise<{ refreshed: boolean; users_rebuilt: number }> {
  try {
    const { data, error } = await db.rpc("refresh_company_acl", {
      p_company_id: companyId,
      p_description: reason,
    });
    if (error) throw error;
    return { refreshed: true, users_rebuilt: Number(data ?? 0) };
  } catch (e) {
    console.warn("REFRESH_COMPANY_ACL_FAILED", { company_id: companyId, error: String(e) });
    return { refreshed: false, users_rebuilt: 0 };
  }
}
