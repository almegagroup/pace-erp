/*
 * File-ID: 7.5.14
 * File-Path: supabase/functions/api/_core/workflow/routing.engine.ts
 * Gate: 7.5
 * Phase: Engine
 * Domain: Workflow
 * Purpose: Deterministic approval routing evaluation (pure logic, no DB mutation)
 * Authority: Backend
 */

export type ApprovalType = "ANYONE" | "SEQUENTIAL" | "MUST_ALL";

export type WorkflowState =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export interface RoutingInput {
  approvalType: ApprovalType;
  currentState: WorkflowState;
  totalStages: number;
  decisions: Array<{
    stageNumber: number;
    decision: "APPROVED" | "REJECTED";
  }>;
}

export interface RoutingResult {
  newState: WorkflowState | null;
  shouldActivateNextStage: boolean;
  nextStageNumber: number | null;
}

/**
 * Main routing evaluator.
 * Pure function.
 * No DB mutation.
 */
export function evaluateRouting(input: RoutingInput): RoutingResult {
  switch (input.approvalType) {
    case "ANYONE":
      return handleAnyone(input);

    case "SEQUENTIAL":
      return handleSequential(input);

    case "MUST_ALL":
      return handleMustAll(input);

    default:
      throw new Error("UNKNOWN_APPROVAL_TYPE");
  }
}

/**
 * ANYONE logic
 */
function handleAnyone(input: RoutingInput): RoutingResult {
  // Placeholder logic (will refine next step)
  const hasDecision = input.decisions.length > 0;

  if (!hasDecision) {
    return {
      newState: null,
      shouldActivateNextStage: false,
      nextStageNumber: null,
    };
  }

  const firstDecision = input.decisions[0];

  return {
    newState: firstDecision.decision === "APPROVED" ? "APPROVED" : "REJECTED",
    shouldActivateNextStage: false,
    nextStageNumber: null,
  };
}

/**
 * SEQUENTIAL logic
 */
function handleSequential(input: RoutingInput): RoutingResult {
  const decidedStages = input.decisions.map((d) => d.stageNumber);
  const highestDecidedStage = Math.max(0, ...decidedStages);

  // If any rejection → immediate reject
  const hasRejection = input.decisions.some((d) => d.decision === "REJECTED");

  if (hasRejection) {
    return {
      newState: "REJECTED",
      shouldActivateNextStage: false,
      nextStageNumber: null,
    };
  }

  if (highestDecidedStage >= input.totalStages) {
    return {
      newState: "APPROVED",
      shouldActivateNextStage: false,
      nextStageNumber: null,
    };
  }

  return {
    newState: null,
    shouldActivateNextStage: true,
    nextStageNumber: highestDecidedStage + 1,
  };
}

/**
 * MUST_ALL logic
 */
function handleMustAll(input: RoutingInput): RoutingResult {
  const hasRejection = input.decisions.some((d) => d.decision === "REJECTED");

  if (hasRejection) {
    return {
      newState: "REJECTED",
      shouldActivateNextStage: false,
      nextStageNumber: null,
    };
  }

  if (input.decisions.length >= input.totalStages) {
    return {
      newState: "APPROVED",
      shouldActivateNextStage: false,
      nextStageNumber: null,
    };
  }

  return {
    newState: null,
    shouldActivateNextStage: false,
    nextStageNumber: null,
  };
}