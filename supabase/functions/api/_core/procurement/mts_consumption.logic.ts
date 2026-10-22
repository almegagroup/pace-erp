/*
 * PO22 family consumption preference — deterministic evidence layer.
 *
 * This is deliberately a helper for the existing requirement allocator and daily
 * projection, not a second planner.  Eligibility, company scope, exclusive
 * protection, narrow-group precedence and physical-stock accounting are hard
 * constraints owned by those callers.  This module only ranks alternatives
 * that are already feasible and records missing commercial evidence as UNKNOWN.
 */

export type EvidenceState = "CONFIRMED" | "TENTATIVE" | "UNKNOWN" | "UNAVAILABLE";
export type CashState = "PAID" | "PAYABLE" | "UNKNOWN";

export type ConsumptionCandidate = Readonly<{
  material_id: string;
  /** Posted, unrestricted stock after reservations/transfer commitments. */
  free_physical_qty: number;
  /** OWN/exclusive Target or Critical reserve. Never consumed by this helper. */
  protected_qty: number;
  eligible: boolean;
  /** Quantity of confirmed future arrivals; projected only, never Store stock. */
  confirmed_future_qty?: number;
  tentative_future_qty?: number;
  unknown_eta_qty?: number;
  replenishment_state?: EvidenceState;
  supplier_reliability_pct?: number | null;
  inventory_age_days?: number | null;
  slow_moving_excess_qty?: number;
  unit_value_inr?: number | null;
  cash_state?: CashState;
  future_unit_cost_inr?: number | null;
  vendor_credit_days?: number | null;
  operational_cost_score?: number | null;
}>;

export type ConsumptionChoice = Readonly<{
  material_id: string;
  executable_free_qty: number;
  preference_score: number;
  allocation_qty: number;
  dynamic_ratio: number;
  future_supply_state: EvidenceState;
  cash_state: CashState;
  reasons: readonly string[];
  unknowns: readonly string[];
}>;

const EPS = 0.000001;
const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const finiteNonNegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * Ranks feasible, unprotected physical stock.  The score is deliberately
 * bounded: a financial preference can resolve alternatives but cannot turn an
 * ineligible/protected/future lot into executable inventory.
 *
 * Higher score means "consume earlier": slow/old excess and a material with
 * reliable replenishment get a modest rotation preference.  Material with no
 * reliable future source receives a preservation penalty, unless it is genuine
 * slow-moving excess.  Paid cash is sunk; a payable balance is shown as a
 * current commitment but is not falsely treated as a reason to consume stock.
 */
export function rankConsumptionCandidates(candidates: readonly ConsumptionCandidate[]): ConsumptionChoice[] {
  const choices = candidates.map((candidate) => {
    const unknowns: string[] = [];
    const reasons: string[] = [];
    const free = Math.max(0, finiteNonNegative(candidate.free_physical_qty) - finiteNonNegative(candidate.protected_qty));
    const state = candidate.replenishment_state ?? "UNKNOWN";
    const cash = candidate.cash_state ?? "UNKNOWN";
    if (!candidate.eligible) reasons.push("Ineligible material is excluded by the caller.");
    if (candidate.protected_qty && candidate.protected_qty > 0) reasons.push(`OWN/Target protection retains ${round(candidate.protected_qty)}.`);
    if ((candidate.unknown_eta_qty ?? 0) > EPS) unknowns.push("future ETA");
    if (candidate.supplier_reliability_pct === null || candidate.supplier_reliability_pct === undefined) unknowns.push("supplier reliability");
    if (candidate.inventory_age_days === null || candidate.inventory_age_days === undefined) unknowns.push("stock age");
    if (candidate.unit_value_inr === null || candidate.unit_value_inr === undefined) unknowns.push("inventory valuation");
    if (candidate.future_unit_cost_inr === null || candidate.future_unit_cost_inr === undefined) unknowns.push("future purchase cost");
    if (cash === "UNKNOWN") unknowns.push("cash/payment state");

    if (free <= EPS || !candidate.eligible) {
      // An ineligible location/material is visibility evidence only.  Returning
      // zero here prevents a low-score row from being used after every eligible
      // alternative has been exhausted.
      return { material_id: candidate.material_id, executable_free_qty: candidate.eligible ? round(free) : 0, preference_score: 0, allocation_qty: 0, dynamic_ratio: 0, future_supply_state: state, cash_state: cash, reasons, unknowns };
    }

    const excess = Math.min(free, finiteNonNegative(candidate.slow_moving_excess_qty));
    const ageBoost = Math.min(0.30, finiteNonNegative(candidate.inventory_age_days) / 730);
    const excessBoost = Math.min(0.50, excess / free * 0.50);
    const reliableSupplyBoost = state === "CONFIRMED" ? 0.20 : state === "TENTATIVE" ? 0.08 : 0;
    const preserveForSupply = state === "UNAVAILABLE" ? -0.30 : state === "UNKNOWN" ? -0.12 : 0;
    const reliability = candidate.supplier_reliability_pct;
    const reliabilityBoost = typeof reliability === "number" && Number.isFinite(reliability) ? Math.max(-0.10, Math.min(0.10, (reliability - 50) / 500)) : 0;
    // A short/advance future payment term is a small preference to use eligible
    // existing stock first, deferring a new cash outflow.  It is not applied
    // when the term is absent, and is intentionally too small to beat safety.
    const cashAvoidanceBoost = typeof candidate.vendor_credit_days === "number" && Number.isFinite(candidate.vendor_credit_days)
      ? Math.max(0, Math.min(0.08, (30 - candidate.vendor_credit_days) / 375)) : 0;
    // Value is a tie-breaker only; high price never defeats coverage protection.
    const valueBoost = Math.min(0.12, finiteNonNegative(candidate.unit_value_inr) / 100_000);
    const operationalPenalty = Math.min(0.15, finiteNonNegative(candidate.operational_cost_score) / 1_000);
    const score = Math.max(0.05, 1 + ageBoost + excessBoost + reliableSupplyBoost + preserveForSupply + reliabilityBoost + cashAvoidanceBoost + valueBoost - operationalPenalty);
    if (excess > EPS) reasons.push(`Slow-moving eligible excess ${round(excess)} receives a rotation preference.`);
    if (state === "UNAVAILABLE" || state === "UNKNOWN") reasons.push(`Future replenishment is ${state}; preserve non-excess stock.`);
    if ((candidate.confirmed_future_qty ?? 0) > EPS) reasons.push("Confirmed future supply supports normal rotation; it remains projected until receipt.");
    if (cash === "PAID") reasons.push("Historical paid inventory is sunk cash, not a forced-consumption reason.");
    if (cash === "PAYABLE") reasons.push("Payable inventory is a current commitment; no payment date was inferred.");
    return { material_id: candidate.material_id, executable_free_qty: round(free), preference_score: round(score), allocation_qty: 0, dynamic_ratio: 0, future_supply_state: state, cash_state: cash, reasons, unknowns };
  });
  return choices.sort((a, b) => b.preference_score - a.preference_score || b.executable_free_qty - a.executable_free_qty || a.material_id.localeCompare(b.material_id));
}

/**
 * Allocates one group demand against already-feasible alternatives.  Re-run it
 * after every dated receipt or proposed lot: ratios are output from the actual
 * same-run quantities, never stored or maintained by a user.
 */
export function allocateDynamicConsumption(candidates: readonly ConsumptionCandidate[], requiredQty: number): { choices: ConsumptionChoice[]; uncovered_qty: number } {
  let remaining = Math.max(0, finiteNonNegative(requiredQty));
  const ranked = rankConsumptionCandidates(candidates).map((choice) => ({ ...choice }));
  for (const choice of ranked) {
    if (remaining <= EPS) break;
    const take = Math.min(choice.executable_free_qty, remaining);
    choice.allocation_qty = round(take);
    remaining -= take;
  }
  const allocated = ranked.reduce((sum, choice) => sum + choice.allocation_qty, 0);
  for (const choice of ranked) choice.dynamic_ratio = allocated > EPS ? round(choice.allocation_qty / allocated) : 0;
  return { choices: ranked, uncovered_qty: round(Math.max(0, remaining)) };
}
