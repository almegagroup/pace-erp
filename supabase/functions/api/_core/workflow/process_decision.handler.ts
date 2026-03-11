/*
 * File-ID: 7.5.14
 * File-Path: supabase/functions/api/_core/workflow/process_decision.handler.ts
 * Gate: 7.5
 * Phase: Engine
 * Domain: Workflow
 * Purpose: Enterprise-grade decision processing handler
 * Authority: Backend
 */

import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { evaluateRouting as _evaluateRouting } from "./routing.engine.ts";
import { errorResponse } from "../response.ts";

interface HandlerContext {
  auth_user_id: string;
  roleCode: string;
  companyId: string;
  request_id: string;
}

interface ApproverMapRow {
  approver_id: string;
  company_id: string;
  module_code: string;
  approval_stage: number;
  approver_role_code: string | null;
  approver_user_id: string | null;
}
interface DecisionRow {
  stage_number: number;
  decision: "APPROVED" | "REJECTED";
}

export async function processDecisionHandler(
  req: Request,
  ctx: HandlerContext
): Promise<Response> {
  try {
    const body = await req.json();
    const { request_id, decision } = body;

    if (!request_id || !decision) {
      return errorResponse(
        "INVALID_INPUT",
        "request_id and decision are required",
        ctx.request_id
      );
    }

    if (!["APPROVED", "REJECTED"].includes(decision)) {
      return errorResponse(
        "INVALID_DECISION",
        "Decision must be APPROVED or REJECTED",
        ctx.request_id
      );
    }

    // =========================================================
    // STEP 1: Fetch workflow request
    // =========================================================

    const { data: workflow, error: wfError } = await serviceRoleClient
      .from("acl.workflow_requests")
      .select("*")
      .eq("request_id", request_id)
      .single();

    if (wfError || !workflow) {
      return errorResponse(
        "REQUEST_NOT_FOUND",
        "Workflow request not found",
        ctx.request_id
      );
    }

    // =========================================================
    // STEP 2: Basic State Check
    // =========================================================

    if (workflow.current_state !== "PENDING") {
      return errorResponse(
        "INVALID_STATE",
        "Only PENDING requests can be decided",
        ctx.request_id
      );
    }
    // =========================================================
// STEP 3: Self Approval Prevention (7.5.16)
// =========================================================

if (workflow.requester_auth_user_id === ctx.auth_user_id) {
  return errorResponse(
    "SELF_APPROVAL_BLOCKED",
    "Requester cannot approve their own request",
    ctx.request_id
  );
}
// =========================================================
// STEP 4: Approver Authorization Check
// =========================================================

const {
  data: approvers,
  error: approverError,
} = (await serviceRoleClient
  .from("acl.approver_map")
  .select("*")
  .eq("company_id", workflow.company_id)
  .eq("module_code", workflow.module_code)) as {
  data: ApproverMapRow[] | null;
  error: unknown;
};

if (approverError || !approvers || approvers.length === 0) {
  return errorResponse(
    "APPROVER_CONFIG_MISSING",
    "No approver configuration found",
    ctx.request_id
  );
}

// Check if current user is valid approver
const matchingApprover = approvers.find((a) => {
  if (a.approver_user_id) {
    return a.approver_user_id === ctx.auth_user_id;
  }
  if (a.approver_role_code) {
    return a.approver_role_code === ctx.roleCode;
  }
  return false;
});

if (!matchingApprover) {
  return errorResponse(
    "NOT_AUTHORIZED_APPROVER",
    "User is not authorized to approve this request",
    ctx.request_id
  );
}

// =========================================================
// STEP 4.5: ACL Snapshot Authorization Check (7.5.17)
// =========================================================

const { data: aclCheck, error: aclError } = await serviceRoleClient
  .from("acl.precomputed_acl_view")
  .select("auth_user_id")
  .eq("auth_user_id", ctx.auth_user_id)
  .eq("company_id", workflow.company_id)
  .eq("module_code", workflow.module_code)
  .maybeSingle();

if (aclError) {
  return errorResponse(
    "ACL_CHECK_FAILED",
    "Failed to validate ACL snapshot",
    ctx.request_id
  );
}

if (!aclCheck) {
  return errorResponse(
    "ACL_DENIED",
    "User not permitted by ACL snapshot",
    ctx.request_id
  );
}

// =========================================================
// STEP 5: Duplicate Decision Prevention
// =========================================================

const { data: existingDecision, error: decisionCheckError } =
  await serviceRoleClient
    .from("acl.workflow_decisions")
    .select("*")
    .eq("request_id", workflow.request_id)
    .eq("stage_number", matchingApprover.approval_stage)
    .eq("approver_auth_user_id", ctx.auth_user_id)
    .maybeSingle();

if (decisionCheckError) {
  return errorResponse(
    "DECISION_CHECK_FAILED",
    "Failed to verify existing decisions",
    ctx.request_id
  );
}

if (existingDecision) {
  return errorResponse(
    "DUPLICATE_DECISION",
    "Decision already submitted for this stage",
    ctx.request_id
  );
}

// =========================================================
// STEP 6: Stage Discipline Enforcement
// =========================================================

// Fetch all decisions for this request
const {
  data: allDecisions,
  error: allDecisionError,
} = (await serviceRoleClient
  .from("acl.workflow_decisions")
  .select("stage_number, decision")
  .eq("request_id", workflow.request_id)) as {
  data: DecisionRow[] | null;
  error: unknown;
};

if (allDecisionError) {
  return errorResponse(
    "DECISION_FETCH_FAILED",
    "Failed to fetch workflow decisions",
    ctx.request_id
  );
}

// Determine total stages from approver_map


// Sequential enforcement
if (workflow.approval_type === "SEQUENTIAL") {
  const decidedStages = (allDecisions ?? []).map(
  (d) => d.stage_number
);

  // Find lowest stage not yet decided
  let expectedStage = 1;
  while (decidedStages.includes(expectedStage)) {
    expectedStage++;
  }

  if (matchingApprover.approval_stage !== expectedStage) {
    return errorResponse(
      "INVALID_STAGE_ORDER",
      "Sequential approval must follow stage order",
      ctx.request_id
    );
  }
}

// =========================================================
// STEP 6.5: Override Detection (7.5.15)
// =========================================================

if (workflow.approval_type === "SEQUENTIAL") {
  const lowerDecisions = (allDecisions ?? []).filter(
    (d) => d.stage_number < matchingApprover.approval_stage
  );

  if (lowerDecisions.length > 0) {
    // Mark lower stage decisions as overridden
    const { error: overrideError } = await serviceRoleClient
      .from("acl.workflow_decisions")
      .update({
        overridden_by: ctx.auth_user_id,
      })
      .eq("request_id", workflow.request_id)
      .lt("stage_number", matchingApprover.approval_stage)
      .is("overridden_by", null);

    if (overrideError) {
      return errorResponse(
        "OVERRIDE_FAILED",
        "Failed to override lower stage decisions",
        ctx.request_id
      );
    }

    // Audit OVERRIDE event
    await serviceRoleClient
      .from("erp_audit.workflow_events")
      .insert({
        request_id: workflow.request_id,
        company_id: workflow.company_id,
        module_code: workflow.module_code,
        event_type: "OVERRIDE",
        stage_number: matchingApprover.approval_stage,
        decision: null,
        previous_state: workflow.current_state,
        new_state: workflow.current_state,
        actor_auth_user_id: ctx.auth_user_id,
      });
  }
}

// =========================================================
// STEP 7: Insert Decision
// =========================================================

const { error: atomicError } = await serviceRoleClient.rpc(
  "process_workflow_decision_atomic",
  {
    p_request_id: workflow.request_id,
    p_actor: ctx.auth_user_id,
    p_stage_number: matchingApprover.approval_stage,
    p_decision: decision,
  }
);

if (atomicError) {
  return errorResponse(
    "ATOMIC_DECISION_FAILED",
    atomicError.message,
    ctx.request_id
  );
}


// =========================================================
// STEP 8: Routing Evaluation
// =========================================================

// Re-fetch updated decisions
const {
  data: updatedDecisions,
  error: updatedDecisionError,
} = (await serviceRoleClient
  .from("acl.workflow_decisions")
  .select("stage_number, decision")
  .eq("request_id", workflow.request_id)) as {
  data: DecisionRow[] | null;
  error: unknown;
};

if (updatedDecisionError) {
  return errorResponse(
    "ROUTING_FETCH_FAILED",
    "Failed to fetch updated decisions",
    ctx.request_id
  );
}

// Calculate distinct stage count
const distinctStages = [
  ...new Set(approvers.map((a) => a.approval_stage)),
];
const totalStages = distinctStages.length;

// Call routing engine
const routingResult = _evaluateRouting({
  approvalType: workflow.approval_type,
  currentState: workflow.current_state,
  totalStages,
  decisions: (updatedDecisions ?? []).map((d) => ({
    stageNumber: d.stage_number,
    decision: d.decision,
  })),
});

// =========================================================
// STEP 9: Apply Routing Result (State Update)
// =========================================================

if (routingResult.newState) {
  const { error: updateError } = await serviceRoleClient
    .from("acl.workflow_requests")
    .update({
      current_state: routingResult.newState,
    })
    .eq("request_id", workflow.request_id);

  if (updateError) {
    return errorResponse(
      "STATE_UPDATE_FAILED",
      "Failed to update workflow state",
      ctx.request_id
    );
  }
}

// =========================================================
// STEP 10: Audit Trail Append (7.5.19)
// =========================================================

// Log DECISION event
await serviceRoleClient
  .from("erp_audit.workflow_events")
  .insert({
    request_id: workflow.request_id,
    company_id: workflow.company_id,
    module_code: workflow.module_code,
    event_type: "DECISION",
    stage_number: matchingApprover.approval_stage,
    decision,
    previous_state: workflow.current_state,
    new_state: routingResult.newState ?? workflow.current_state,
    actor_auth_user_id: ctx.auth_user_id,
  });

// Log STATE_CHANGE event (only if state changed)
if (routingResult.newState) {
  await serviceRoleClient
    .from("erp_audit.workflow_events")
    .insert({
      request_id: workflow.request_id,
      company_id: workflow.company_id,
      module_code: workflow.module_code,
      event_type: "STATE_CHANGE",
      stage_number: null,
      decision: null,
      previous_state: workflow.current_state,
      new_state: routingResult.newState,
      actor_auth_user_id: ctx.auth_user_id,
    });
}

    // Further strict logic will be added step-by-step

    return new Response(
      JSON.stringify({
        status: "ok",
        message: "Skeleton ready",
        request_id: ctx.request_id,
      }),
      { status: 200 }
    );

  } catch (_err) {
    return errorResponse(
      "PROCESS_DECISION_ERROR",
      "Unexpected error occurred",
      ctx.request_id
    );
  }
}
