/*
 * File-ID: 6.6D-AUTH-ME-CONTEXT
 * File-Path: supabase/functions/api/_core/auth/me_context.handler.ts
 * Gate: 6
 * Phase: 6
 * Domain: AUTH
 * Purpose: Read and update selected operational work-company context for the active session
 * Authority: Backend
 */

import { okResponse, errorResponse } from "../response.ts";
import type { SessionResolution } from "../../_pipeline/session.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import {
  listAvailableWorkContexts,
  listCanonicalCompanyIds,
  resolveDefaultWorkCompanyId,
  resolveDefaultWorkContextId,
} from "../../_shared/canonical_access.ts";
import { rebuildAclSessionMenuSnapshot } from "../../_shared/acl_runtime.ts";

interface MeContextReadInput {
  session: SessionResolution;
  requestId: string;
  req: Request;
}

interface MeContextUpdateInput extends MeContextReadInput {}

async function readRuntimeContext(
  activeSession: Extract<SessionResolution, { status: "ACTIVE" }>,
) {
  const { authUserId } = activeSession;
  const companyIds = await listCanonicalCompanyIds(serviceRoleClient, authUserId);

  const { data: companies, error: companyError } = companyIds.length === 0
    ? { data: [], error: null }
    : await serviceRoleClient
      .schema("erp_master")
      .from("companies")
      .select("id, company_code, company_name")
      .in("id", companyIds)
      .eq("status", "ACTIVE")
      .eq("company_kind", "BUSINESS")
      .order("company_code", { ascending: true });

  if (companyError) {
    throw new Error("ME_CONTEXT_COMPANY_READ_FAILED");
  }

  const availableCompanies = (companies ?? []).map((row) => ({
    id: row.id,
    company_code: row.company_code,
    company_name: row.company_name,
  }));

  let selectedCompanyId = activeSession.selectedCompanyId ?? null;

  if (!selectedCompanyId) {
    selectedCompanyId = await resolveDefaultWorkCompanyId(serviceRoleClient, authUserId);
  }

  if (
    selectedCompanyId &&
    !availableCompanies.some((company) => company.id === selectedCompanyId)
  ) {
    selectedCompanyId = availableCompanies[0]?.id ?? null;
  }

  const availableWorkContexts = selectedCompanyId
    ? await listAvailableWorkContexts(
      serviceRoleClient,
      authUserId,
      selectedCompanyId,
    )
    : [];
  let selectedWorkContextId = activeSession.selectedWorkContextId ?? null;

  if (
    selectedWorkContextId &&
    !availableWorkContexts.some(
      (workContext) => workContext.work_context_id === selectedWorkContextId,
    )
  ) {
    selectedWorkContextId = null;
  }

  if (!selectedWorkContextId && selectedCompanyId) {
    selectedWorkContextId = await resolveDefaultWorkContextId(
      serviceRoleClient,
      authUserId,
      selectedCompanyId,
    );
  }

  return {
    is_admin: activeSession.roleCode === "SA" || activeSession.roleCode === "GA",
    selected_company_id: selectedCompanyId,
    available_companies: availableCompanies,
    available_work_contexts: availableWorkContexts,
    current_company:
      availableCompanies.find((company) => company.id === selectedCompanyId) ?? null,
    selected_work_context:
      availableWorkContexts.find(
        (workContext) => workContext.work_context_id === selectedWorkContextId,
      ) ?? null,
  };
}

export async function meContextHandler(
  ctx: MeContextReadInput,
): Promise<Response> {
  const { session, requestId, req } = ctx;

  if (session.status !== "ACTIVE") {
    return errorResponse(
      "AUTH_NOT_AUTHENTICATED",
      "Not authenticated",
      requestId,
      "LOGOUT",
      401,
      undefined,
      req,
    );
  }

  try {
    const runtimeContext = await readRuntimeContext(session);
    return okResponse(runtimeContext, requestId, req);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "ME_CONTEXT_READ_FAILED",
      "Runtime context read failed",
      requestId,
      "NONE",
      403,
      undefined,
      req,
    );
  }
}

export async function updateMeContextHandler(
  ctx: MeContextUpdateInput,
): Promise<Response> {
  const { session, requestId, req } = ctx;

  if (session.status !== "ACTIVE") {
    return errorResponse(
      "AUTH_NOT_AUTHENTICATED",
      "Not authenticated",
      requestId,
      "LOGOUT",
      401,
      undefined,
      req,
    );
  }

  if (session.roleCode === "SA" || session.roleCode === "GA") {
    return errorResponse(
      "ME_CONTEXT_ADMIN_FIXED",
      "Admin universe does not switch work company",
      requestId,
      "NONE",
      400,
      undefined,
      req,
    );
  }

  const body = await req.json().catch(() => null);
  const selectedCompanyId =
    typeof body?.selected_company_id === "string"
      ? body.selected_company_id.trim()
      : session.selectedCompanyId ?? "";
  const requestedWorkContextId =
    typeof body?.selected_work_context_id === "string"
      ? body.selected_work_context_id.trim()
      : "";

  if (!selectedCompanyId) {
    return errorResponse(
      "ME_CONTEXT_COMPANY_REQUIRED",
      "selected_company_id required",
      requestId,
      "NONE",
      400,
      undefined,
      req,
    );
  }

  const availableCompanyIds = await listCanonicalCompanyIds(
    serviceRoleClient,
    session.authUserId,
  );

  if (!availableCompanyIds.includes(selectedCompanyId)) {
    return errorResponse(
      "ME_CONTEXT_COMPANY_FORBIDDEN",
      "Selected company is not available to this user",
      requestId,
      "NONE",
      403,
      undefined,
      req,
    );
  }

  const availableWorkContexts = await listAvailableWorkContexts(
    serviceRoleClient,
    session.authUserId,
    selectedCompanyId,
  );

  if (availableWorkContexts.length === 0) {
    return errorResponse(
      "ME_CONTEXT_WORK_CONTEXT_UNAVAILABLE",
      "Selected company has no available work context for this user",
      requestId,
      "NONE",
      403,
      undefined,
      req,
    );
  }

  let selectedWorkContextId = requestedWorkContextId;

  if (!selectedWorkContextId && selectedCompanyId === session.selectedCompanyId) {
    selectedWorkContextId = session.selectedWorkContextId ?? "";
  }

  if (
    selectedWorkContextId &&
    !availableWorkContexts.some(
      (workContext) => workContext.work_context_id === selectedWorkContextId,
    )
  ) {
    return errorResponse(
      "ME_CONTEXT_WORK_CONTEXT_FORBIDDEN",
      "Selected work context is not available to this user",
      requestId,
      "NONE",
      403,
      undefined,
      req,
    );
  }

  if (!selectedWorkContextId) {
    selectedWorkContextId = await resolveDefaultWorkContextId(
      serviceRoleClient,
      session.authUserId,
      selectedCompanyId,
    ) ?? "";
  }

  if (!selectedWorkContextId) {
    return errorResponse(
      "ME_CONTEXT_WORK_CONTEXT_REQUIRED",
      "selected_work_context_id required",
      requestId,
      "NONE",
      400,
      undefined,
      req,
    );
  }

  const { error: updateError } = await serviceRoleClient
    .schema("erp_core")
    .from("sessions")
    .update({
      selected_company_id: selectedCompanyId,
      selected_work_context_id: selectedWorkContextId,
    })
    .eq("session_id", session.sessionId)
    .eq("auth_user_id", session.authUserId)
    .eq("status", "ACTIVE");

  if (updateError) {
    return errorResponse(
      "ME_CONTEXT_UPDATE_FAILED",
      updateError.message,
      requestId,
      "NONE",
      500,
      undefined,
      req,
    );
  }

  const refreshedSession: Extract<SessionResolution, { status: "ACTIVE" }> = {
    ...session,
    selectedCompanyId,
    selectedWorkContextId,
  };

  try {
    await rebuildAclSessionMenuSnapshot(
      serviceRoleClient,
      session.authUserId,
      selectedCompanyId,
      selectedWorkContextId,
      session.sessionId,
    );

    const runtimeContext = await readRuntimeContext(refreshedSession);
    return okResponse(runtimeContext, requestId, req);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "ME_CONTEXT_READ_FAILED",
      "Runtime context read failed",
      requestId,
      "NONE",
      403,
      undefined,
      req,
    );
  }
}
