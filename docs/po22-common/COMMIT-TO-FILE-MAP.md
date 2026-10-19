# PO22 Implementation Map — commits, touched files, integration status
**Observed:** 2026-10-19 via GitHub commit metadata and `main...agent/codex` compare. The comparison reported **17 commits ahead, 0 behind** and **25 changed paths** at that moment. This is not a permanent HEAD and is not a release. Every agent must repeat compare before acting.

## Accepted main foundation vs unpromoted Codex
| Commit | State | Role |
|---|---|---|
| `12762593` | In `main` (per integration register) | PO22 CM/NM Requirement engine; approved NM Requirement Days |
| `69199690` | In `main` (per register) | Multi-pack view |
| `843b47f` | In `main` (per register) | Approved Phase 2D design |
| `c7dfe79e`, `dc4a24e6` | In `main` (per register) | Phase 3A immutable normalization and strict evidence |
| `ba8aca7e`, `02e4d6cd` | In `main` (per register) | Phase 3B pure adapter and table foundation |
| `74c406d8` | On `agent/codex` | Phase 3B API+reader+receiving+snapshot+selection foundation and migration proposal |
| `40cc0b63` | On `agent/codex` | PO/GE/CSN/GRN source identity follow-up |
| `a256fe8a` | On `agent/codex` | Split STO CSN identity from direct PO-line CSN |
| `2ba56276` | On `agent/codex` | Phase 3C shared-stock allocator |
| `3c0ce204` | On `agent/codex` | Phase 3D daily coverage/advisory base |
| `f2ff8d5f` | On `agent/codex` | Unknown coverage policy fail-closed |
| `2ac5bcb1` | On `agent/codex` | Hardening group matching and target/critical arrival timing; newer code supersedes prior review of early 3C/3D commits |
| `31029d43` | On `agent/codex` | PO21 demand evidence source reader/adaptation |
| `4b1925cd` | On `agent/codex` | Company-scoped GET requirement-demand-evidence endpoint and VIEW ACL |
| `910ec92e` | On `agent/codex` | Updates Integration Register for endpoint |
| `d50e1e02` | On `agent/codex` | Earlier Phase 3D register hardening |

These commits are a **curated named set**, not a claim that all 17 in compare were individually enumerated. Inspect Git's full log and missing doc commits on live branch when exhaustive commit chronology is necessary.

## Commit → exact touched files (GitHub metadata)
| Commit | Touched files |
|---|---|
| `74c406d8` | `docs/mts-planning/PO22-PHASE-3B-SOURCE-ADAPTER-AND-PERSISTENCE-REPORT.md`; `_acl/route-acl-registry.ts`; `_core/procurement/mts_optimizer_phase3b.handlers.ts`; `mts_optimizer_phase3b.persistence.logic.ts`, `mts_optimizer_phase3b.persistence.test.ts`, `mts_optimizer_phase3b.persistence.ts`, `mts_optimizer_phase3b_receiving.logic.test.ts`, `mts_optimizer_phase3b_receiving.logic.ts`, `mts_optimizer_phase3b_source.reader.ts`; `_routes/procurement.routes.ts`; `supabase/migrations/20261019070346_mts_optimizer_phase3b_selection_save_rpc.sql` |
| `40cc0b63` | `docs/mts-planning/PO22-PHASE-3B-SOURCE-ADAPTER-AND-PERSISTENCE-REPORT.md`, `mts_optimizer_phase3b_receiving.logic.test.ts`, `mts_optimizer_phase3b_receiving.logic.ts`, `mts_optimizer_phase3b_source.reader.ts` |
| `a256fe8a` | `docs/INTEGRATION-REGISTER.md`, Phase 3B report, Phase 3B receiving logic/test/source.reader |
| `2ba56276` | `mts_optimizer_input.types.ts`, `mts_optimizer_phase3c.logic.test.ts`, `mts_optimizer_phase3c.logic.ts`, `mts_optimizer_phase3c.types.ts` |
| `3c0ce204` | `mts_optimizer_phase3d.logic.test.ts`, `mts_optimizer_phase3d.logic.ts`, `mts_optimizer_phase3d.types.ts` |
| `f2ff8d5f` | Phase 3D logic + test |
| `2ac5bcb1` | Phase 3C logic, tests and types; Phase 3D logic and tests |
| `31029d43` | `mts_optimizer_phase3c_demand.logic.test.ts`, `mts_optimizer_phase3c_demand.logic.ts`, `mts_optimizer_phase3c_source.reader.ts`, `mts_requirement.handlers.ts`, `mts_requirement.logic.ts` |
| `4b1925cd` | `_acl/route-acl-registry.ts`, `mts_optimizer_phase3b.handlers.ts`, `_routes/procurement.routes.ts` |
| `910ec92e`, `d50e1e02` | `docs/INTEGRATION-REGISTER.md` |

Abbreviated file names in this table are located under `supabase/functions/api/_core/procurement/` unless prefix `_acl` (`supabase/functions/api/_acl/`) or `_routes` (`supabase/functions/api/_routes/`); full paths are in the following complete compare list.

## Full changed file inventory at compare
```
docs/BRANCH-WORKFLOW.md
docs/INTEGRATION-REGISTER.md
docs/mts-planning/PO22-PHASE-3B-SOURCE-ADAPTER-AND-PERSISTENCE-REPORT.md
supabase/functions/api/_acl/route-acl-registry.ts
supabase/functions/api/_core/procurement/mts_optimizer_input.types.ts
supabase/functions/api/_core/procurement/mts_optimizer_phase3b.handlers.ts
supabase/functions/api/_core/procurement/mts_optimizer_phase3b.persistence.logic.ts
supabase/functions/api/_core/procurement/mts_optimizer_phase3b.persistence.test.ts
supabase/functions/api/_core/procurement/mts_optimizer_phase3b.persistence.ts
supabase/functions/api/_core/procurement/mts_optimizer_phase3b_receiving.logic.test.ts
supabase/functions/api/_core/procurement/mts_optimizer_phase3b_receiving.logic.ts
supabase/functions/api/_core/procurement/mts_optimizer_phase3b_source.reader.ts
supabase/functions/api/_core/procurement/mts_optimizer_phase3c.logic.test.ts
supabase/functions/api/_core/procurement/mts_optimizer_phase3c.logic.ts
supabase/functions/api/_core/procurement/mts_optimizer_phase3c.types.ts
supabase/functions/api/_core/procurement/mts_optimizer_phase3c_demand.logic.test.ts
supabase/functions/api/_core/procurement/mts_optimizer_phase3c_demand.logic.ts
supabase/functions/api/_core/procurement/mts_optimizer_phase3c_source.reader.ts
supabase/functions/api/_core/procurement/mts_optimizer_phase3d.logic.test.ts
supabase/functions/api/_core/procurement/mts_optimizer_phase3d.logic.ts
supabase/functions/api/_core/procurement/mts_optimizer_phase3d.types.ts
supabase/functions/api/_core/procurement/mts_requirement.handlers.ts
supabase/functions/api/_core/procurement/mts_requirement.logic.ts
supabase/functions/api/_routes/procurement.routes.ts
supabase/migrations/20261019070346_mts_optimizer_phase3b_selection_save_rpc.sql
```

## Function-by-function navigation
- `mts_requirement.handlers.ts`: company-scoped loadPlanLines, loadStrokeSettings, loadFormulationMasters, loadMaterialRows, loadConversions, materialInfoMap, existing unchanged Requirement endpoints.
- `mts_requirement.logic.ts`: `effectivePlanAt`, `explodeDemand`, approved calculation engine; newly exposed immutable source fields. `buildRequirementRows()` is baseline and must remain unchanged.
- `mts_optimizer_phase3c_source.reader.ts`: load PO21/source masters → explode → adapt; currently source ids list includes all loaded plan lines rather than exactly contributing effective line IDs; do not claim per-demand plan version provenance.
- `mts_optimizer_phase3c_demand.logic.ts`: one immutable stroke/BOM source line per demand, `Use Primary=No` material-null group pool, actual group/membership ID and UOM fail-closed.
- `mts_optimizer_phase3b_source.reader.ts` / `phase3b_receiving.logic.ts`: physical PO, gate entry, CSN/STO/Sub-CSN, GRN and reservation/stock provenance. Never count ETA as executable.
- `mts_optimizer_phase3c.logic.ts`: joint physical fixed/group allocator. Verify latest `2ac5bcb1` fixes before filing stale mismatch defect.
- `mts_optimizer_phase3d.logic.ts`: target/critical daily coverage and tentative lot scheduling; verify latest `2ac5bcb1`, not only initial `3c0ce204` logic.
- `mts_optimizer_phase3b.handlers.ts` + `procurement.routes.ts` + `route-acl-registry.ts`: company resource guard and endpoints including `GET /api/procurement/mts-optimizer/requirement-demand-evidence`.
- `mts_optimizer_phase3b.persistence.ts` and migration SQL: snapshot/selection contracts, not permission to run migrations.

## Recorded tests vs independent verification
Source `agent/codex:docs/INTEGRATION-REGISTER.md` reports 57/57 → 66/66 → 70/70 → 71/71 → 73/73 → **78/78** across phases; Deno check, guard scripts and frontend build results are in the full copied register. These were reported from Codex, NOT rerun as part of this common-document update.

## Non-negotiable operational limitation
No `main`/`dev` promotions, migrations, ACL apply, deploy or operational data writes are authorized by these docs. Agent implementation is not accepted/deployed. PROD read-only source verification is allowed when bounded, otherwise ask.
