# PACE_ERP Operation Management — SAP-Style Discovery and Feasibility

**Document Status:** DRAFT — Design Phase  
**Document Type:** Planning / Feasibility / Discovery / Design Readiness  
**Prepared For:** PACE-ERP Operation Management — Pre-Implementation  
**Constitution Reference:** PACE_ERP_MASTER_CONSTITUTION.md (FINAL)  
**Document Date:** 1 May 2026  
**Go-Live Target:** 1 July 2026  
**Cut-off Date:** 30 June 2026  

> This document is a planning and design document only.  
> No code. No migrations. No APIs. No React screens.  
> No implementation until design is frozen and approved.

---

## Table of Contents

- Part A — Foundation & Feasibility
- Part B — Organization & Governance
- Part C — Master Data Design
- Part D — Stock Architecture
- Part E — Go-Live & Migration Strategy
- Part F — Procurement Cycle
- Part G — Production & BOM
- Part H — FG, Dispatch & Returns
- Part I — Plant Transfer & GST Readiness
- Part J — Physical Inventory & Reports
- Part K — Design Freeze & Implementation Plan

---

# PART A — FOUNDATION & FEASIBILITY

---

## Section 1 — Executive Summary

PACE-ERP is an in-house ERP system built for a multi-plant, multi-company manufacturing and distribution business that has been running for approximately six years. The system already has a mature foundation layer covering authentication, session management, security pipeline, ACL, menu authority, navigation, admin governance, audit/observability, request pipeline discipline, gate-based architecture, SA Universe and ACL User Universe, and a full PACE Constitution / SSOT governance framework.

The next and most critical phase is the design and implementation of the **Operation Management** backbone — the real operational purpose of the ERP. This covers procurement, inventory, production, quality, dispatch, returns, plant transfers, costing, and physical inventory — all designed in the SAP-style discipline but adapted to PACE-ERP's architecture, governance model, and actual business reality.

This document is the complete planning, feasibility, discovery, design-readiness, and implementation-readiness reference for PACE-ERP Operation Management. It must be read, reviewed, and frozen before any coding begins.

### Key Facts

| Item | Detail |
|---|---|
| Business Type | Multi-plant manufacturing, centralized procurement, domestic + import |
| Plants | Multiple existing plants, 6+ years running |
| Companies | At least CMP003 and CMP010 confirmed, others possible |
| Procurement | Centralized wing; plans, creates, amends, tracks all POs |
| Production Types | Fixed formulation, Admix/flexible, Hybrid |
| Go-Live Date | 1 July 2026 |
| Cut-off Date | 30 June 2026 |
| Opening Stock Rule | 30 June 2026 closing stock = 1 July 2026 opening stock |
| Architecture Base | PACE Constitution compliant, backend-authority model |
| SAP Reference | MM, SD, PP, QM, WM, FI/CO, LE — adapted, not cloned |

### What This Document Covers

This document guides PACE-ERP from zero confusion to a complete, SAP-style Operation Management design. It covers:

1. Feasibility — what can be built, what cannot, what must be phased
2. Organization and governance model
3. Complete master data design
4. Stock architecture — storage, stock types, movement types
5. Go-live transition strategy from a running business
6. Opening stock, legacy PO, in-transit, and number series migration
7. Full procurement cycle from planning to GRN
8. Production — BOM, process order, costing, quality
9. FG, dispatch, returns, and reuse
10. Plant-to-plant transfer and GST future readiness
11. Physical inventory (PID) and reports
12. Approval matrix, audit, reversal/cancellation discipline
13. Design freeze checklist and implementation gate plan
14. Round-1 discovery questions to begin structured data gathering

---

## Section 2 — Feasibility Verdict

### A. Feasibility Verdict — Direct Answer

**Can PACE-ERP successfully build a SAP-style Operation Management system?**

**Yes. Fully possible with phased implementation.**

PACE-ERP already has the strongest possible foundation: a backend-authority model, ACL-controlled execution, document-based transaction discipline, a gate-based architecture, and a mature governance constitution. These are the hardest parts to build in any ERP — and they are already done.

What remains is to build the operational domain on top of this foundation. That is a well-defined, achievable engineering task — provided the design is frozen first, the SAP-style concepts are adapted (not blindly copied), and the implementation follows the phased gate plan.

**Verdict: High feasibility — Phase-1 operational backbone by 1 July 2026 is achievable if design is frozen by 31 May 2026.**

---

### B. What Can Be Built Strongly in PACE-ERP

| System Area | Assessment |
|---|---|
| MM-style procurement and inventory | Strongly achievable. Material master, supplier master, PO lifecycle, GRN, stock ledger, movement types, storage location, opening stock — all can be built with high fidelity. |
| SD-style dispatch and return | Achievable. Customer master, dispatch instruction, goods issue, customer return, return QA, reuse/scrap decision — all can be built in Phase-1/2. |
| PP-style BOM and process order | Achievable. Fixed BOM, multiple BOM, active BOM, process order, material issue, actual consumption, variance, FG receipt — all designed in Phase-1. Admix actual formula and hybrid deviation also covered. |
| QM-style quality stock and release | Achievable. Inward QA, production QA, FG QA, return QA, usage decision (release/block/reject/scrap) — all in Phase-1. |
| FI/CO-style costing layer | Partially achievable in Phase-1. Weighted average, direct batch cost, opening stock value, process order costing, FG actual cost — achievable. Full GL/FI integration is Phase-3. |
| WM-style storage location | Achievable. Storage location model, put-away, picking, stock-in-transit, dispatch hold — Phase-1. Bin-level is Phase-3. |
| LE-style logistics execution | Fully achievable in Phase-1. Consignment tracking, ETD/ETA, gate entry, plant transfer logistics, dispatch document, transporter/vehicle master — all Phase-1. |

---

### C. What Should NOT Be Copied Blindly from SAP

| SAP Concept | Why Not Copy Directly |
|---|---|
| Over-complex SAP transaction screens (ME21N, MIGO style) | Overwhelming for PACE users. Use SAP-inspired screen logic but simplify role-based field visibility. |
| Full FI document posting on every movement | Not practical for Phase-1. Design costing layer first; connect to full FI later. |
| Deep EWM / bin-level automation | Bin-level is a Phase-3 requirement. Storage-location level is sufficient for Phase-1. |
| Full MRP run (MD01/MD02 style) | Full MRP automation is Phase-3. Phase-1 uses procurement planning view with manual/semi-auto requirement generation. |
| SAP settlement / order settlement (KO88 style) | Not in Phase-1. Process order cost collection is sufficient initially. |
| Every rare movement type from day one | Only business-required movement types in Phase-1. Rare types designed but not activated. |
| Full batch classification and batch management | Basic batch/lot reference in Phase-1. Advanced batch classification later. |
| Quota arrangement (full automatic) | Design placeholder in Phase-1. Activation Phase-2. |
| Full transport management system | Basic transport reference in Phase-1. Full TMS later. |
| Full GST e-invoice and e-way bill automation | Design placeholders in Phase-1. Actual automation Phase-3. |

---

### D. What Should Be Simplified in Phase-1

| Area | Simplification Approach |
|---|---|
| Material master | Core fields only. Advanced classification later. Plant extension mandatory. |
| Supplier material source | Supplier + material + plant mapping. Full info record detail Phase-2. |
| Source list | Basic approved vendor list per material + plant. Quota Phase-2. |
| PO | Full PO lifecycle (create, amend, cancel, track). GST fields as placeholders. |
| Gate entry | Security gate entry document linked to PO. Weigh bridge optional. |
| GRN | GRN linked to gate entry and PO. Quality stock bucket automatic for QA-required materials. |
| QA | Usage decision: Release / Block / Reject / Scrap. Lab result fields optional Phase-1. |
| Stock ledger | Full movement-based ledger from day one. No shortcuts. |
| Opening stock | Controlled one-time migration. 561/563/565 movement. Approval required. |
| Legacy open PO | Migrated as open PO with remaining quantity. Not mixed with opening stock. |
| In-transit | Separate in-transit bucket. Not mixed with opening stock. |
| Number series | Company + section + document type + FY. Continue from last used number. |
| BOM | Header, version, active flag, effective date, component lines. Advanced alternative BOM Phase-2. |
| Process order | Full lifecycle. Costing collected. Actual vs planned. Variance flagged. |
| Dispatch | Dispatch instruction, picking, goods issue, challan. GST invoice placeholder. |
| PID | Full flow. System count, physical count, difference, approval, 701/702 posting. |
| Costing | Weighted average and direct batch cost in Phase-1. Standard cost and full CO later. |

---

### E. What Should Be Phased Later

| Area | Phase |
|---|---|
| Quota arrangement (automatic supplier allocation) | Phase-2 |
| Full MRP automation | Phase-3 |
| Bin-level warehouse management | Phase-3 |
| Full landed cost import accounting | Phase-2 |
| Full FI/CO integration (GL, cost center accounting) | Phase-3 |
| Advanced production scheduling | Phase-2 |
| Advanced batch genealogy and classification | Phase-2 |
| Automated vendor scoring | Phase-2 |
| Full transport management system | Phase-3 |
| Full GST invoice automation | Phase-3 |
| GST debit note / credit note automation | Phase-3 |
| E-way bill API integration | Phase-3 |
| Plant Maintenance (PM) module | Phase-3 |
| Project System (PS) full module | Phase-2/3 |
| Lab test integration | Phase-2 |

---

### F. Risk Assessment

| Risk Area | Risk Level | Explanation |
|---|---|---|
| Data model complexity | Medium | Many interlinked objects. Must be designed carefully before coding. |
| Movement-type correctness | High | Wrong movement type = wrong stock impact. Movement type master must be locked before go-live. |
| Opening stock accuracy | High | Old plants with 6 years of history. Physical count before cut-off is mandatory. |
| Legacy PO migration accuracy | High | Partial POs must be reconciled. Must not double-count received stock. |
| In-transit migration accuracy | High | Import and domestic in-transit must be separately tracked and not merged with opening stock. |
| Number series continuity | High | Wrong numbering breaks business continuity. Must be designed and tested before go-live. |
| Costing accuracy | Medium-High | Weighted average vs direct cost choice per material must be locked before go-live. Opening stock value must be correct. |
| UOM conversion accuracy | Medium | Multi-unit materials (packet, bottle, liter) need UOM conversion table locked before go-live. |
| BOM/version control | Medium | Old process orders must retain old BOM snapshot. BOM change must not affect historical orders. |
| Process order costing | Medium | Actual vs planned variance must be tracked from day one. |
| Plant transfer complexity | Medium | Two-step transfer with stock-in-transit adds complexity. Design must be complete before coding. |
| GST future-readiness | Low-Medium | Placeholders must be designed now. Actual GST automation is Phase-3. |
| User training | High | SAP-style screens are unfamiliar to users. Training must be planned before go-live. |
| Report correctness | Medium | Stock ledger reports must reconcile opening + receipts - issues = closing. Must be validated in trial migration. |
| Migration risk | High | Running business migration. Any error impacts live operations from Day 1. |
| Over-customization risk | Medium | PACE should not try to replicate every SAP edge case. Scope must be disciplined. |

---

### G. Success Conditions

PACE-ERP can build this successfully **only if** all of the following conditions are met:

- [ ] PACE_ERP_MASTER_CONSTITUTION.md is followed 100%
- [ ] Design is frozen before coding begins
- [ ] SAP-style concepts are adapted, not blindly copied
- [ ] Transaction posting engine is built before screens
- [ ] Stock ledger is the source of truth — no current stock without ledger
- [ ] Direct stock edit is absolutely forbidden
- [ ] Movement type master is locked before go-live
- [ ] Opening stock migration is a controlled, approved, one-time transaction
- [ ] Legacy open PO and in-transit are migrated separately from opening stock
- [ ] Number series continuity is designed and tested before go-live
- [ ] Costing policy (weighted average vs direct) is defined per material before go-live
- [ ] Business ownership and ACL assignment are clear before go-live
- [ ] Implementation is strictly phased — Phase-1 scope is not expanded without approval
- [ ] Trial migration is done before 25 June 2026
- [ ] Physical stock count happens on 30 June 2026
- [ ] Management sign-off on opening stock before 1 July 2026 posting

---

### H. Final Practical Confidence Level

| Area | Confidence |
|---|---|
| Phase-1 SAP-style operational backbone (MM + QM + PP + SD + LE + Costing) | **High — 85–90%** |
| Opening stock migration for old plants | **High — 90%** if physical count is done correctly |
| Legacy open PO migration | **High — 88%** with proper reconciliation |
| In-transit migration | **Medium-High — 82%** — import in-transit needs careful design |
| Number series continuity | **High — 95%** — clearly defined formats, straightforward implementation |
| Plant-to-plant transfer with stock-in-transit | **High — 90%** |
| GST-ready placeholders | **High — 92%** — design only, no automation |
| Full GST invoice automation | **Medium — 65%** — Phase-3, API/compliance dependent |
| Full MRP automation | **Medium — 60%** — Phase-3 |
| Full FI/CO integration | **Medium — 60%** — Phase-3 |
| Blind 1:1 SAP clone | **Not recommended** |
| PACE-adapted SAP-style ERP | **Strongly recommended — High feasibility** |

---

## Section 3 — Achievability Percentage by System Area

| System Area | SAP-Style Target | PACE Achievability % | Phase | Risk | Comment |
|---|---|---|---|---|---|
| MM — Material master | Full material master with classification | 92% | Phase-1 | Low | Core fields Phase-1. Advanced classification later. |
| MM — Material plant extension | Material usable only after plant extension | 95% | Phase-1 | Low | Hard rule. No plant extension = material blocked at that plant. |
| Supplier master | Full vendor master | 90% | Phase-1 | Low | Core fields Phase-1. Bank details / advanced fields Phase-2. |
| Supplier-material source / info record | Approved vendor per material + plant | 88% | Phase-1 | Medium | Must be validated before PO creation. |
| Approved source list | Valid vendor list per material + plant + period | 85% | Phase-1 | Medium | Source list controls PO vendor selection. |
| Quota arrangement | Automatic vendor split by ratio | 60% | Phase-2 | Medium | Design placeholder Phase-1. Activation Phase-2. |
| Procurement planning | Stock + open PO + in-transit + requirement view | 85% | Phase-1 | Medium | Semi-automated Phase-1. Full MRP Phase-3. |
| PR — Purchase Requirement | PR with approvals | 90% | Phase-1 | Low | Standard document flow. |
| PO lifecycle | Create, amend, cancel, close | 92% | Phase-1 | Low | Core of procurement. Must be complete Phase-1. |
| PO amendment / cancellation | Amendment with version history, cancellation with reason | 90% | Phase-1 | Low | Version history important for audit. |
| Legacy PO migration | Migrate open / partial POs at cut-off | 88% | Phase-0/1 | High | Reconciliation with opening stock mandatory. |
| PO number series continuity | Company + section + FY based numbering | 95% | Phase-0/1 | High | Must continue from last used number. |
| Consignment tracking | ETD/ETA, status, import/domestic | 92% | Phase-1 | Low | Full LE scope Phase-1. |
| Gate entry | Security gate document linked to PO | 92% | Phase-1 | Low | Mandatory for GRN handoff. |
| GRN | Goods receipt with movement 101 | 93% | Phase-1 | Low | Core MM. Must be complete Phase-1. |
| Inward QA | Usage decision: release/block/reject/scrap | 90% | Phase-1 | Low | After GRN, before unrestricted stock. |
| Storage location | Location-wise stock tracking | 92% | Phase-1 | Low | Must be designed before go-live. |
| Stock type model | Unrestricted, QA, blocked, rejected, in-transit etc. | 93% | Phase-1 | Low | Stock type master locked before go-live. |
| Movement type master | SAP-style movement codes | 90% | Phase-1 | High | Must be locked. Wrong movement = wrong stock. |
| Stock ledger | Full movement-based ledger | 95% | Phase-1 | High | This is the source of truth. No shortcut allowed. |
| Current stock snapshot | Real-time stock by material + plant + location + type | 93% | Phase-1 | Medium | Derived from ledger. Must always reconcile. |
| Opening stock migration | 561/563/565 posting with value | 90% | Phase-0/1 | High | Controlled one-time. Approval required. |
| PID / Physical inventory | PID document, count, difference, approval | 90% | Phase-1 | Medium | Full flow required from Phase-1. |
| 701 / 702 adjustment | Gain/loss posting after PID approval | 92% | Phase-1 | Medium | Only correction method after go-live. |
| Weighted average costing | Running average on GR and issue | 90% | Phase-1 | Medium | Must be calculated correctly at every GR and issue. |
| Direct batch costing | Specific batch valued at actual cost | 85% | Phase-1 | Medium | For import, project-specific, returned FG reuse. |
| Opening stock valuation | Quantity + value + rate at cut-off | 90% | Phase-0/1 | High | Wrong opening value = wrong costing forever. |
| Returned FG reuse valuation | Approved carrying value into new product | 82% | Phase-1 | Medium | Traceability and costing both required. |
| BOM | Header, version, lines, component types | 92% | Phase-1 | Low | Core PP object. |
| Multiple BOM | Alternative BOMs per material | 88% | Phase-1 | Medium | Version control critical. |
| Active BOM | One BOM active at a time per plant | 90% | Phase-1 | Medium | Active flag + effective date logic. |
| Fixed BOM planning | BOM-driven procurement requirement | 88% | Phase-1 | Medium | Explode BOM → requirement → PR. |
| Admix actual formula | Formula captured per process order | 87% | Phase-1 | Medium | No fixed BOM. Actual input captured at execution. |
| Hybrid BOM with deviation | BOM exists but controlled deviation allowed | 83% | Phase-1 | Medium | Deviation tolerance + approval required. |
| Production planning | Plan → requirement → process order | 85% | Phase-1 | Medium | Semi-manual Phase-1. Full MRP Phase-3. |
| Process order | Full lifecycle, BOM snapshot, costing | 90% | Phase-1 | Medium | Must include BOM snapshot at creation/release. |
| Material reservation | Reserve stock for process order | 90% | Phase-1 | Low | Standard PP step. |
| Material issue to production | 261 movement, actual consumption | 92% | Phase-1 | Low | Core production step. |
| Actual consumption and variance | Actual vs BOM planned, variance flag | 88% | Phase-1 | Medium | Variance beyond tolerance needs approval. |
| Production costing | Material + packing + reusable input cost | 87% | Phase-1 | Medium | FG actual cost derived from this. |
| Production quality | QA during production | 85% | Phase-1 | Medium | In-process QA may be simplified in Phase-1. |
| FG receipt | FG into FG store after production | 92% | Phase-1 | Low | Movement from production to FG stock. |
| FG QA | FG quality decision before dispatch | 90% | Phase-1 | Low | Release / block / reject / rework. |
| Dispatch | Dispatch instruction, pick, pack, goods issue (601) | 90% | Phase-1 | Low | Core SD step. |
| Sales return | Customer return 651 | 88% | Phase-1 | Low | Return QA decision after receipt. |
| Customer return | Return to unrestricted/quality/blocked/reuse | 87% | Phase-1 | Medium | Includes reuse/rework/scrap decision. |
| Reuse / rework / scrap | Decision and movement after return/production | 85% | Phase-1 | Medium | Costing impact must be correct. |
| Plant-to-plant stock transfer | One-step and two-step transfer | 90% | Phase-1 | Medium | Both modes required Phase-1. |
| One-step plant transfer | 301/302 — instant transfer | 92% | Phase-1 | Low | Simpler case. |
| Two-step plant transfer | 303/304 + 305/306 with in-transit | 88% | Phase-1 | Medium | Stock-in-transit bucket required. |
| Stock-in-transit | In-transit stock bucket, not at source or target | 90% | Phase-1 | Medium | Must not appear in either plant's free stock. |
| Inter-plant transfer approval | Approval workflow for transfer | 87% | Phase-1 | Low | Approval before issue posting. |
| Inter-plant dispatch document | Delivery challan / transfer document | 88% | Phase-1 | Low | Linked to transfer order. |
| Transfer receipt at target plant | Target plant GR + optional QA | 88% | Phase-1 | Low | Completes transfer cycle. |
| Future GST invoice readiness | Placeholder fields, document link layer | 90% | Phase-1 design | Low | Fields designed. No automation yet. |
| Future GST debit note readiness | Placeholder | 85% | Phase-1 design | Low | Design only. |
| Future GST credit note readiness | Placeholder | 85% | Phase-1 design | Low | Design only. |
| E-way bill reference readiness | Placeholder field | 88% | Phase-1 design | Low | Field reserved. API Phase-3. |
| Tax document linkage layer | Stock transfer + tax document link design | 87% | Phase-1 design | Low | Separate layers, linkable. |
| Reports | Stock ledger, current stock, movement, costing | 88% | Phase-1 | Medium | Must reconcile from ledger. No separate data source. |
| Audit trail | Append-only audit log for all transactions | 95% | Phase-1 | Low | PACE Constitution requires this. Already in architecture. |
| Reversal / cancellation | Reversal via movement type, not deletion | 93% | Phase-1 | Low | Constitutionally required. No manual delete. |
| SAP-style screens | Header + lines + tabs + status + document flow | 87% | Phase-1 | Low | Simplified for PACE users. ACL controls field visibility. |
| ACL ownership model | Who creates, approves, activates each object | 93% | Phase-1 | Low | Already in PACE foundation. Must be mapped to each operation object. |
| SA governance model | SA owns guardrails. ACL users own business work. | 95% | Phase-1 | Low | Core PACE principle. Must be strictly maintained. |
| PACE Constitution compliance | Backend authority, migration-first, audit, no direct stock edit | 100% | All phases | Non-negotiable | No deviation allowed. |

---

## Section 4 — PACE-ERP vs SAP-Style Approach

| Dimension | SAP Standard | PACE-ERP Approach |
|---|---|---|
| Architecture authority | SAP application server | PACE backend — single authority |
| Frontend role | SAP GUI / Fiori — some logic | PACE frontend — zero authority |
| ACL/authorization | SAP authorization objects | PACE ACL engine — backend evaluated |
| Transaction discipline | SAP document-based posting | PACE document-based posting engine |
| Stock ledger | SAP MSEG / MKPF | PACE stock ledger table — movement-based |
| Movement types | SAP standard + Z-types | PACE uses SAP-style codes + PACE custom 901–999 range |
| BOM management | CS01/CS02/CS03 | PACE BOM master with version + active flag |
| Process order | CO01/CO02/CO11N | PACE process order with BOM snapshot |
| Physical inventory | MI01/MI04/MI07 | PACE PID with system count + physical count + 701/702 |
| Opening stock | MB1C with 561 | PACE opening stock upload with approval + 561/563/565 |
| Vendor master | XK01/MK01 | PACE supplier master with company/plant extension |
| Material master | MM01 with views | PACE material master with company + plant extension |
| Number series | SAP number range objects | PACE number series — company + section + doc type + FY |
| Approval workflow | SAP workflow | PACE approval engine — ACL-controlled |
| Report | SAP standard reports | PACE reports from stock ledger — no shortcut |
| Cost | SAP material ledger / CO | PACE costing layer — weighted average + direct batch |
| GST | SAP FICO + CIN | PACE placeholder fields — full GST Phase-3 |
| Screens | SAP GUI / Fiori | PACE SAP-inspired screens — simplified, role-filtered |

---

## Section 5 — PACE Constitution Compliance Check

This section verifies that the proposed Operation Management design complies with every binding rule in PACE_ERP_MASTER_CONSTITUTION.md.

### 5.1 Backend-Only Authority

**Rule:** Backend is the single source of truth. Frontend has zero authority.

**Design Compliance:**
- All stock movements are validated and posted by the backend only.
- No stock quantity or value is calculated, modified, or stored by the frontend.
- Movement type rules, stock type transitions, costing calculations, approval evaluations — all backend.
- Frontend sends request. Backend validates, evaluates ACL, posts, returns result.
- **Status: COMPLIANT**

---

### 5.2 Frontend Zero Authority

**Rule:** Frontend must not perform auth logic, ACL logic, context resolution, or stock decisions.

**Design Compliance:**
- No movement type logic in frontend.
- No stock type calculation in frontend.
- No PO approval decision in frontend.
- No costing formula in frontend.
- Frontend displays data returned by backend only.
- **Status: COMPLIANT**

---

### 5.3 ACL-Controlled Execution

**Rule:** All access decisions are evaluated by the ERP ACL engine.

**Design Compliance:**
- Every operation object (PO create, GRN post, QA decision, dispatch, PID approve, plant transfer approve) will have an ACL capability assigned.
- No operation executes without ACL evaluation passing.
- SA sets capabilities. ACL users execute within those capabilities.
- **Status: COMPLIANT**

---

### 5.4 SA Universe vs ACL User Universe Separation

**Rule:** SA owns governance structures. ACL users own business operations within those guardrails.

**Design Compliance:**

SA-owned objects in Operation Management:
- Movement type master (locked)
- Stock type master (locked)
- Storage location type / framework
- Document type master
- Number series framework
- Approval rule framework
- Costing policy framework
- Company / plant / section structure
- Cost center framework

ACL-user-owned objects:
- Material master, supplier master, customer master
- BOM / formula
- PR, PO, consignment, gate entry, GRN
- QA decisions
- Process orders, production execution
- FG receipt, dispatch, returns
- PID
- Plant transfer requests within permission scope

- **Status: COMPLIANT**

---

### 5.5 Migration-First DB Law

**Rule:** All structural DB changes must be migrations — idempotent, order-safe, environment-agnostic. Manual DB edits forbidden.

**Design Compliance:**
- No operation management table will be created via manual DB edit.
- All new schemas (erp_inventory, erp_procurement, erp_production, erp_dispatch) will be created via migrations.
- Opening stock posting is a controlled transaction, not a manual insert.
- Legacy PO migration is a controlled import transaction, not a direct table insert.
- **Status: COMPLIANT — design enforces migration-first law**

---

### 5.6 No Direct Stock Edit

**Rule:** Direct stock edit is absolutely forbidden. All stock changes must go through the posting engine.

**Design Compliance:**
- No UI allows direct quantity change in stock table.
- No backend function allows direct UPDATE on stock ledger rows.
- Every stock change must create a stock document → posting engine validates → movement type rules applied → stock ledger appended → current stock snapshot updated.
- Opening stock uses 561/563/565 — still through the posting engine, not a direct insert.
- PID corrections use 701/702 — still through the posting engine.
- **Status: COMPLIANT — this is a hard architectural rule**

---

### 5.7 Document-Based Transaction Discipline

**Rule:** Every business transaction must be document-based with reference, status, audit trail, and reversal discipline.

**Design Compliance:**
- Every operation transaction (PO, GRN, QA, process order, dispatch, PID, plant transfer) is a document.
- Every document has: header, lines, status, reference document, posting log, approval log, audit/history.
- Cancellation/reversal is done via a reversal document (reversal movement type), not by deleting the original document.
- **Status: COMPLIANT**

---

### 5.8 RLS / Security Principles

**Rule:** Default = DENY. No row is visible or mutable unless explicitly allowed by backend ACL.

**Design Compliance:**
- All operation data tables will be under non-public schemas (erp_inventory, erp_procurement, erp_production, erp_dispatch, or similar).
- RLS will be enforced on erp_core-equivalent schemas.
- ACL evaluation precedes any handler.
- Company-scope and plant-scope filtering will be enforced at backend — a user scoped to Plant A cannot see Plant B's stock.
- **Status: COMPLIANT**

---

### 5.9 Auditability

**Rule:** erp_audit schema is INSERT-only (append-only). All transactions must have audit trail.

**Design Compliance:**
- Every stock document posting creates an audit entry.
- Every PO creation, amendment, cancellation creates an audit entry.
- Every QA decision creates an audit entry.
- Every approval action creates an audit entry.
- Every opening stock posting creates an audit entry.
- Every PID posting (701/702) creates an audit entry.
- Audit entries are never deleted or updated.
- **Status: COMPLIANT**

---

### 5.10 No Unauthorized Bypass

**Rule:** Pipeline, session, and context invariants are never bypassed. SA does not bypass the pipeline.

**Design Compliance:**
- No operation management function bypasses the request pipeline (Headers → CORS → CSRF → Rate limit → Session → Context → ACL → Handler).
- SA authority is evaluated by the ACL engine as highest-rank rule — not by bypassing the pipeline.
- Migration imports during go-live use controlled backend functions, not raw DB access.
- **Status: COMPLIANT**

---

### 5.11 No Redesign of Frozen Architecture

**Rule:** Existing frozen PACE gates and foundations must be respected. No redesign of already frozen architecture.

**Design Compliance:**
- Operation Management is a new domain being added on top of the existing frozen foundation.
- Authentication, session, ACL, menu authority, navigation, admin governance — none of these are touched.
- New schemas and tables are added as new layers.
- Existing gate freeze documents remain in force.
- **Status: COMPLIANT**

---

### 5.12 No Implementation Before Design Freeze

**Rule:** Design must be frozen before coding begins.

**Design Compliance:**
- This document is the design document.
- Coding will not begin until this document is reviewed, completed, and frozen.
- All design freeze documents listed in Part K must be completed and approved before any migration or code file is created.
- **Status: COMPLIANT — this is the purpose of this document**

---

### 5.13 Database Schema Access Law

**Rule:** All DB queries must use db.schema("schema").from("table"). No public schema. No db.from("schema.table").

**Design Compliance:**
- All new operation management tables will be under named schemas: erp_inventory, erp_procurement, erp_production, erp_dispatch, or as defined in design freeze.
- All backend queries will use explicit schema declaration.
- This will be enforced in code review for every operation management file.
- **Status: COMPLIANT — by design**

---

### 5.14 Cost Control Compliance

**Rule:** Single backend, single DB, pagination mandatory, no unbounded queries, active data = last 2 FY, archive older data.

**Design Compliance:**
- Stock ledger will be paginated in all list queries.
- Reports will use filtered queries — no full-table scans.
- Active stock data (current 2 FY) in primary tables.
- Older transaction history in archive tables (same DB).
- Deep archive (5+ years) in external storage.
- Stock ledger entries are never modified — INSERT only (append-only ledger).
- **Status: COMPLIANT**

---

### 5.15 File Discipline Law

**Rule:** Every file must start with the PACE file header (File-ID, File-Path, Gate, Phase, Domain, Purpose, Authority).

**Design Compliance:**
- All operation management backend files will include the required PACE file header.
- This is a code-phase requirement, not a design-phase requirement.
- It is noted here so that implementation does not begin without this discipline.
- Missing header = invalid file = must not be merged.
- **Status: NOTED — to be enforced during implementation**

---

### Constitution Compliance Summary

| Rule | Status |
|---|---|
| Backend-only authority | COMPLIANT |
| Frontend zero authority | COMPLIANT |
| ACL-controlled execution | COMPLIANT |
| SA Universe vs ACL User Universe | COMPLIANT |
| Migration-first DB law | COMPLIANT |
| No direct DB shortcuts | COMPLIANT |
| No direct stock edit | COMPLIANT |
| Document-based transaction discipline | COMPLIANT |
| RLS / security principles | COMPLIANT |
| Auditability | COMPLIANT |
| No unauthorized bypass | COMPLIANT |
| No redesign of frozen architecture | COMPLIANT |
| No implementation before design freeze | COMPLIANT |
| Database schema access law | COMPLIANT |
| Cost control compliance | COMPLIANT |
| File discipline law | NOTED — implementation phase |

**Overall Constitution Compliance: FULLY COMPLIANT by design.**

No proposed design in this document conflicts with PACE_ERP_MASTER_CONSTITUTION.md.

---

*— End of Part A —*

---

# PART B — ORGANIZATION & GOVERNANCE

---

## Section 6 — SAP Modules Used in PACE-ERP

PACE-ERP Operation Management draws from the following SAP modules. Each module is adapted — not blindly copied — to suit PACE-ERP's architecture, business reality, and constitution.

### 6.1 MM — Materials Management (Core — Phase-1 Full)

The largest and most critical module. Nothing in operations works without MM.

| MM Sub-area | PACE Coverage | Phase |
|---|---|---|
| Material master | Full — with company + plant extension | Phase-1 |
| Supplier / vendor master | Full — with company + plant extension | Phase-1 |
| Purchase Requirement (PR) | Full | Phase-1 |
| Purchase Order (PO) | Full lifecycle — create, amend, cancel, close | Phase-1 |
| PO amendment and cancellation | Full with version history | Phase-1 |
| Consignment tracking (ETD/ETA) | Full — import + domestic | Phase-1 |
| Gate entry | Full | Phase-1 |
| Goods Receipt (GRN) | Full — linked to gate entry + PO | Phase-1 |
| Inventory management | Full — storage location, stock type, movement type | Phase-1 |
| Movement types | SAP-style codes + PACE custom 901–999 | Phase-1 |
| Stock ledger | Full — append-only, movement-based | Phase-1 |
| Opening stock migration | 561/563/565 — controlled, approved | Phase-0/1 |
| Physical inventory (PID) | Full — 701/702 | Phase-1 |
| Plant-to-plant transfer | One-step (301) + two-step (303/305) | Phase-1 |
| Supplier-material source / info record | Full | Phase-1 |
| Approved source list | Full | Phase-1 |
| Quota arrangement | Placeholder Phase-1, activation Phase-2 | Phase-2 |
| Procurement planning view | Semi-automated Phase-1 | Phase-1 |
| Full MRP automation | Not Phase-1 | Phase-3 |

---

### 6.2 QM — Quality Management (Core — Phase-1 Full)

Quality gates exist at inward, production, FG, and return stages. All must be in Phase-1.

| QM Sub-area | PACE Coverage | Phase |
|---|---|---|
| Inward QA (after GRN) | Full — usage decision | Phase-1 |
| Production / in-process QA | Basic in Phase-1 | Phase-1 |
| FG QA (before dispatch) | Full — usage decision | Phase-1 |
| Return QA (after customer return) | Full — usage decision | Phase-1 |
| Quality stock bucket | Full | Phase-1 |
| Blocked stock bucket | Full | Phase-1 |
| Rejected stock bucket | Full | Phase-1 |
| Usage decision: Release / Block / Reject / Scrap | Full | Phase-1 |
| Lab result fields | Optional Phase-1, full Phase-2 | Phase-2 |
| Advanced batch classification | Phase-2 | Phase-2 |

---

### 6.3 PP — Production Planning (Core — Phase-1 Full)

Three production modes must be supported: Fixed BOM, Admix/Actual, and Hybrid.

| PP Sub-area | PACE Coverage | Phase |
|---|---|---|
| BOM / formula master | Full — header, version, active flag, lines | Phase-1 |
| Multiple BOM / alternative BOM | Full — version control | Phase-1 |
| Active BOM + effective date | Full | Phase-1 |
| Fixed BOM planning (BOM-driven procurement) | Full | Phase-1 |
| Admix actual formula capture | Full — per process order | Phase-1 |
| Hybrid BOM with deviation | Full — tolerance + approval | Phase-1 |
| Production planning view | Semi-manual Phase-1 | Phase-1 |
| Process order — full lifecycle | Full | Phase-1 |
| BOM snapshot at process order creation/release | Full — critical requirement | Phase-1 |
| Material reservation | Full | Phase-1 |
| Material issue to production (261) | Full | Phase-1 |
| Actual consumption vs planned | Full — variance tracked | Phase-1 |
| Variance approval | Full | Phase-1 |
| Production quality (in-process) | Basic Phase-1 | Phase-1 |
| FG receipt | Full | Phase-1 |
| Process order costing | Full | Phase-1 |
| Advanced production scheduling | Phase-2 | Phase-2 |
| Full MRP run | Phase-3 | Phase-3 |

---

### 6.4 SD — Sales & Distribution (Core — Phase-1 Full)

FG dispatch, customer returns, and reuse/rework/scrap decisions must be complete Phase-1.

| SD Sub-area | PACE Coverage | Phase |
|---|---|---|
| Customer master | Full | Phase-1 |
| Dispatch instruction / sales order | Full | Phase-1 |
| Delivery planning | Full | Phase-1 |
| Picking and packing | Full | Phase-1 |
| Goods issue for delivery (601) | Full | Phase-1 |
| Delivery challan | Full | Phase-1 |
| Customer return (651) | Full | Phase-1 |
| Return QA decision | Full | Phase-1 |
| Return to unrestricted (653) | Full | Phase-1 |
| Return to quality (655) | Full | Phase-1 |
| Return to blocked (657) | Full | Phase-1 |
| Returned FG reuse / rework / scrap | Full — costing impact | Phase-1 |
| Partial dispatch tracking | Full | Phase-1 |
| GST invoice | Placeholder Phase-1 | Phase-3 |
| Full order management | Phase-2 | Phase-2 |

---

### 6.5 FI/CO — Finance & Controlling (Partial — Costing Layer Phase-1)

Full FI/GL integration is Phase-3. Costing layer is Phase-1.

| FI/CO Sub-area | PACE Coverage | Phase |
|---|---|---|
| Material valuation — weighted average | Full | Phase-1 |
| Material valuation — direct batch cost | Full | Phase-1 |
| Opening stock value posting | Full | Phase-1 |
| GR stock value update | Full | Phase-1 |
| Issue value consumption | Full | Phase-1 |
| Process order cost collection | Full | Phase-1 |
| FG actual cost calculation | Full | Phase-1 |
| Returned FG reuse value | Full | Phase-1 |
| Scrap / write-off value | Full | Phase-1 |
| PID gain/loss value impact (701/702) | Full | Phase-1 |
| Cost center framework (SA-owned) | Placeholder Phase-1 | Phase-1 |
| Project cost (PS partial) | Phase-2 | Phase-2 |
| Full GL journal posting | Phase-3 | Phase-3 |
| Full FI/CO integration | Phase-3 | Phase-3 |
| GST tax accounting | Phase-3 | Phase-3 |

---

### 6.6 WM — Warehouse Management (Storage Location Level — Phase-1 Full)

Storage location level is Phase-1. Bin-level is Phase-3.

| WM Sub-area | PACE Coverage | Phase |
|---|---|---|
| Storage location master | Full | Phase-1 |
| Put-away (GRN → storage location) | Full | Phase-1 |
| Picking location (dispatch from location) | Full | Phase-1 |
| Dispatch hold location | Full | Phase-1 |
| Stock-in-transit logical bucket | Full | Phase-1 |
| Bin-level storage | Phase-3 | Phase-3 |
| Automated put-away rules | Phase-3 | Phase-3 |
| Full EWM | Phase-3 | Phase-3 |

---

### 6.7 LE — Logistics Execution (Full — Phase-1)

LE is fully required in Phase-1 because consignment tracking, gate entry, and plant transfer logistics are operationally critical.

| LE Sub-area | PACE Coverage | Phase |
|---|---|---|
| Consignment creation from PO | Full | Phase-1 |
| ETD / ETA tracking | Full | Phase-1 |
| Import vs domestic flag | Full | Phase-1 |
| Transporter / vehicle master | Full | Phase-1 |
| LR / waybill reference | Full | Phase-1 |
| Consignment status lifecycle | Full | Phase-1 |
| Partial receipt tracking | Full | Phase-1 |
| Delay / overdue flag | Full | Phase-1 |
| Gate entry document | Full | Phase-1 |
| Gate entry → GRN handoff | Full | Phase-1 |
| Outbound dispatch document | Full | Phase-1 |
| Delivery challan | Full | Phase-1 |
| Plant transfer logistics | Full | Phase-1 |
| Stock-in-transit tracking | Full | Phase-1 |
| Route master | Phase-2 | Phase-2 |
| E-way bill API integration | Phase-3 | Phase-3 |
| Full GST invoice generation | Phase-3 | Phase-3 |

---

### 6.8 PM — Plant Maintenance (Phase-3)

| PM Sub-area | PACE Coverage | Phase |
|---|---|---|
| Machine / equipment master | Phase-3 | Phase-3 |
| Spare parts issue | Phase-3 | Phase-3 |
| Repair outward / inward | Phase-3 | Phase-3 |
| Maintenance order | Phase-3 | Phase-3 |

---

### 6.9 PS — Project System (Partial — Phase-2)

| PS Sub-area | PACE Coverage | Phase |
|---|---|---|
| Project-wise material issue (221) | Phase-2 | Phase-2 |
| Project cost report | Phase-2 | Phase-2 |
| Full project system | Phase-3 | Phase-3 |

---

## Section 7 — PACE Governance Model: SA vs ACL Users

### 7.1 Core Principle

> SA creates guardrails. ACL users work inside those guardrails.

SA is not the daily data-entry admin. SA owns the system truth, governance structures, locked configuration, movement rules, and authorization framework. ACL users own business operations within those guardrails.

This separation is constitutionally required and must be respected in every operation management object.

---

### 7.2 SA-Owned Objects in Operation Management

These objects are created, maintained, and locked by SA. ACL users cannot create or modify these.

| Object | Why SA Owns It | Locked After? |
|---|---|---|
| Company master | Root business entity — structural truth | Yes — SA only |
| Plant / work context | Physical operation location — structural truth | Yes — SA only |
| Department framework | Organizational unit structure | Yes — SA only |
| Business section / operating section | Operating unit within plant/company | Yes — SA only |
| Storage location type / framework | Defines valid storage types | Yes — SA only |
| Cost center framework | CO structural unit | Yes — SA only |
| Stock type master | Defines valid stock buckets | Yes — locked |
| Movement type master | Defines all valid movements and rules | Yes — locked before go-live |
| Document type master | Defines valid document categories | Yes — locked |
| Number series framework | Company + section + doc type + FY series | Yes — SA sets, counter auto-increments |
| Approval rule framework | Who approves what, at what threshold | Yes — SA owned |
| ACL capabilities for operation | What each role can do in operations | Yes — SA assigns |
| Menu authority for operation | Which screens are visible to which role | Yes — SA assigns |
| Costing policy framework | Valuation method per material category | Yes — SA or authorized governance user |
| Custom movement policy | PACE 901–999 range movement rules | Yes — SA only |
| GST / tax document framework placeholder | Tax structure readiness | Yes — SA only |

---

### 7.3 ACL-User-Owned Objects in Operation Management

These objects are created and maintained by authorized ACL users within their company/plant/section scope.

| Object | Who Can Create | Who Can Approve | Scope |
|---|---|---|---|
| Material master | Authorized stores / procurement user | Stores manager or designated approver | Company-level |
| Material plant extension | Stores / procurement user at plant level | Plant stores manager | Plant-level |
| Supplier master | Procurement user | Procurement manager | Company-level |
| Supplier-material source | Procurement user | Procurement manager | Company + plant |
| Approved source list | Procurement manager | SA or designated approver | Company + plant |
| Customer master | Sales / dispatch user | Sales manager | Company-level |
| BOM / formula | Production / R&D user | Production manager / QA | Plant-level |
| Purchase Requirement (PR) | Procurement planner | Procurement manager | Company + plant |
| Purchase Order (PO) | Procurement user | Procurement manager | Company + plant |
| PO amendment | Procurement user | Procurement manager | PO scope |
| PO cancellation | Procurement manager | Senior procurement / management | PO scope |
| Consignment tracking | Procurement user | — (informational) | PO scope |
| Gate entry | Security / stores user | — (informational) | Plant-level |
| GRN | Stores user | Stores manager | Plant + storage location |
| QA decision | QA user | QA manager | Plant-level |
| Process order | Production user | Production manager | Plant-level |
| Material reservation | Production user | — (auto from process order) | Plant-level |
| Material issue to production | Stores / production user | — (within process order) | Plant-level |
| FG receipt | Production / stores user | — (within process order) | Plant-level |
| Dispatch instruction | Sales / dispatch user | Sales manager | Company-level |
| Goods issue for delivery | Dispatch / stores user | — (within dispatch instruction) | Plant-level |
| Plant transfer request | Stores / procurement user | Plant manager or designated | Plant-level |
| PID / physical inventory | Stores manager | Management / audit | Plant-level |
| Stock adjustment (701/702) | Stores manager | Management / audit sign-off | Plant-level |

---

### 7.4 Object Ownership Matrix — Summary

Every operation management object has the following ownership attributes defined:

| Attribute | Options |
|---|---|
| Who can create? | SA / specific ACL role |
| Who can edit? | Creator / designated role / no edit after posting |
| Who can approve? | Designated approver role |
| Who can activate? | SA / authorized role |
| Who can deactivate? | SA / authorized role |
| Who can cancel/reverse? | Authorized role with reason |
| Scope | Global / Company / Plant / Storage Location / Section / User |
| Approval required? | Yes / No / Conditional (value/type based) |
| Affects historical transactions? | Yes (read-only history) / No |

---

### 7.5 Authority Levels in Operation Management

| Level | Description | Examples |
|---|---|---|
| Level-1: System Truth | SA-owned, locked, governs all operations | Movement type, stock type, number series |
| Level-2: Business Master | ACL user-owned, governs transactions | Material master, supplier master, BOM |
| Level-3: Business Transaction | ACL user-executed, within master data guardrails | PO, GRN, process order, dispatch |

---

## Section 8 — Organization Structure

### 8.1 PACE Organization Hierarchy

```
PACE-ERP System
│
├── Company (e.g., CMP003, CMP010)
│   │
│   ├── Business Section / Operating Section
│   │   (e.g., Admix Section, Powder Section)
│   │
│   ├── Plant / Work Context
│   │   (e.g., Plant-A, Plant-B)
│   │   │
│   │   ├── Department
│   │   │   (e.g., Procurement, Production, Stores, QA, Dispatch)
│   │   │
│   │   └── Storage Location
│   │       (e.g., Main Store, QA Store, FG Store, Dispatch Hold)
│   │
│   └── Cost Center
│       (e.g., Production Cost Center, Overhead Cost Center)
│
└── Cross-Company Governance (SA level)
```

### 8.2 Key Rules for Organization Structure

1. **Company** is the root legal and financial entity. Every transaction is company-scoped.
2. **Plant** is the physical operating location. Stock exists at plant level. A company can have multiple plants.
3. **Business Section / Operating Section** is the operating unit within a company. It may span plants or be plant-specific. Procurement sections (Admix, Powder) are examples. Number series is section-specific.
4. **Storage Location** is the physical or logical stock holding area within a plant. Stock is tracked at storage location level from Phase-1.
5. **Department** is the functional unit (Procurement, Production, Stores, QA, Dispatch). ACL capabilities are department-aligned.
6. **Cost Center** is the CO unit for cost assignment. SA defines the framework. Production/process orders reference cost centers.

### 8.3 Confirmed Companies and Sections

| Company Code | Company | Business Section | PO Number Format | Notes |
|---|---|---|---|---|
| CMP003 | To be confirmed | Admix Section | AC/RPXXX/2026-27 | FY-based numbering |
| CMP003 | To be confirmed | Powder Section | ASC/POXXX/2026-27 | FY-based numbering |
| CMP010 | To be confirmed | (single or multiple) | Ji/POXXX/2026 | Year-only numbering |

> Note: Full company names, additional companies, additional sections, and additional plants are to be captured in Round-1 Discovery Questions.

### 8.4 Material Scope by Organization Level

| Object | Scope Rule |
|---|---|
| Material master | Created at company level |
| Material company extension | Required before material is active for company |
| Material plant extension | Required before material can be received/issued at plant |
| Material not in plant extension | Cannot be receipted, issued, or transferred at that plant |
| Supplier master | Created at company level |
| Supplier company extension | Required for supplier to be active for company |
| Supplier-material-plant mapping | Required before PO can be created for that combination |

---

## Section 9 — Business Section / Operating Section Model

### 9.1 What is a Business Section / Operating Section?

An Operating Section is a sub-unit within a company that represents a distinct operational identity. It may have:
- Its own procurement team or procurement workflow
- Its own PO number series
- Its own BOM / production type (Admix vs Fixed formulation vs Powder)
- Its own product lines
- Its own cost reporting

A single plant may house multiple operating sections. An operating section may span multiple plants.

### 9.2 Operating Section in Procurement

The procurement number series is section-specific. This means:

- CMP003 Admix Section uses: `AC/RPXXX/2026-27`
- CMP003 Powder Section uses: `ASC/POXXX/2026-27`
- CMP010 uses: `Ji/POXXX/2026`

This is a core requirement. The number series engine must be able to generate section-wise document numbers.

### 9.3 Operating Section Object Design Concept

| Attribute | Description |
|---|---|
| Section code | Unique identifier (e.g., CMP003-ADMIX, CMP003-POWDER) |
| Company | Parent company |
| Section name | Display name |
| Section type | Procurement / Production / Both |
| Number series | Linked number series definitions |
| Active plants | Plants where this section operates |
| Production mode | FIXED_BOM / ADMIX_ACTUAL / HYBRID / TRADING |
| ACL group | Which users belong to this section |
| Status | ACTIVE / INACTIVE |

### 9.4 Section Scope Rules

| Rule | Detail |
|---|---|
| Section must belong to a company | Cannot exist without company |
| Number series is section + company + doc type + FY | All four must match for correct number generation |
| Material plant extension is not section-specific | It is plant-specific — sections share plant stock |
| Process orders are section-specific | Section determines production mode |
| PO is section-specific | Section determines number series |
| GRN is plant-specific | Stock lands at plant + storage location |
| Cost reporting can be section-specific | Procurement cost, production cost by section |

---

## Section 10 — Approval Matrix Overview

The full approval matrix will be defined in Part K (Design Freeze). This section defines the framework.

### 10.1 Approval Framework Principles

1. Approvals are ACL-controlled — SA defines who can approve what.
2. Approval thresholds may be value-based (e.g., PO above ₹X needs senior approval).
3. Approval is a backend-evaluated step — not a frontend decision.
4. Pending approval = transaction is held in pending status — no stock impact yet.
5. Approved = transaction moves to next status and is eligible for posting.
6. Rejected = transaction moves to rejected status — creator can amend and resubmit or cancel.
7. Every approval action creates an audit entry.

### 10.2 Key Approval Points in Operation Management

> **AMENDMENT — Layer 2 Procurement Discovery (LOCKED):**
> PR (Purchase Requisition) removed from PACE-ERP. Plan → PO directly. No PR entity.
> Vendor master approver updated: any authorized approver (single level) — not role-specific.
> Vendor-Material Info Record: no approval required — Procurement team manages directly.

| Transaction | Approval Required? | Approver Level | Notes |
|---|---|---|---|
| PO creation | Yes | Procurement manager | Always |
| PO amendment | Yes | Procurement manager | Version history maintained |
| PO cancellation | Yes | Senior procurement / management | Reason required |
| Delivery tolerance override (PO level) | No approval — role-restricted | Authorized user only | Changes tolerance on that PO only |
| Opening stock upload | Yes | Stores manager + Management | One-time — critical |
| GRN posting | Conditional | Stores manager | Based on value or material |
| QA usage decision — Release | Yes | QA user (authorized) | Role-based approval |
| QA usage decision — Reject | Yes | QA manager | Higher approval |
| Process order creation | Conditional | Production manager | Based on quantity or value |
| Material issue to production | Conditional | Stores manager | Based on quantity |
| Actual consumption variance | Yes if beyond tolerance | Production manager | Tolerance defined in BOM |
| Dispatch instruction | Yes | Sales manager | |
| Goods issue for delivery | Yes | Dispatch manager | |
| Plant transfer request | Yes | Source plant manager | |
| Plant transfer receipt | Conditional | Target plant stores manager | |
| PID posting (P701/P702) | Yes | Management / audit sign-off | Critical — affects stock ledger |
| Returned FG reuse approval (FOR_REPROCESS) | Yes — role-restricted | Authorized user only | Role-restricted movement |
| BOM activation | Yes | Production manager + QA | New BOM activation |
| Vendor master activation | Yes | Any authorized approver | Single level |
| Vendor deactivation | Yes + Ledger balanced | Any authorized approver | Open payables must be zero |
| Vendor-Material Info Record | No approval | Procurement team direct | |
| Material master activation | Yes | Single approver | |
| Material plant extension activation | Yes | Plant stores manager | New material at plant |

### 10.3 Approval Status Values

| Status | Meaning |
|---|---|
| PENDING_APPROVAL | Submitted, waiting for approver action |
| APPROVED | Approved — eligible for posting |
| REJECTED | Rejected — creator must amend or cancel |
| RECALLED | Creator recalled before approver acted |
| ESCALATED | Sent to higher approver (if auto-escalation configured) |
| EXPIRED | Approval not acted on within configured time limit |

### 10.4 Approval Audit Rule

Every approval action must record:
- Who approved / rejected
- When (timestamp)
- What action taken
- Remarks (mandatory for rejection)
- Reference document
- System-generated audit entry (append-only)

---

*— End of Part B —*

---

# PART C — MASTER DATA DESIGN

---

## Section 11 — Material Master and Material Identity

### 11.1 What is Material Master?

Material Master is the central identity record for every item that moves through the business — raw material, packing material, consumable, spare, asset, semi-finished good, finished good, scrap, or service item. Every transaction — procurement, production, stock movement, dispatch — references the material master.

In SAP this is the MM01 object. In PACE-ERP it is the Material Master with company and plant extensions.

### 11.2 Material Categories

> **AMENDMENT — Round-4 Foundation Discovery (LOCKED):**
> Material type codes confirmed. INT replaces SEMI_FINISHED as the active intermediate type.
> TRA and CONS are provisions (SA activates when needed). SFG not needed — INT covers it.

| Code | Full Name | Status | Procurement | Production | Stock | Dispatch | Notes |
|---|---|---|---|---|---|---|---|
| RM | Raw Material | ✅ Active | Yes | Input | Yes | No | |
| PM | Packaging Material | ✅ Active | Yes | Input | Yes | No | |
| INT | Intermediate | ✅ Active | Optional | Input + Output | Yes | No | Produced internally, treated as RM in next stage. Never sold. |
| FG | Finished Goods | ✅ Active | No | Output | Yes | Yes | Has Shade Code + Pack Code + External SKU |
| TRA | Trading Goods | ⏸ Provision | Yes | No | Yes | Yes | SA activates when needed |
| CONS | Consumables | ⏸ Provision | Yes | Input | Yes | No | SA activates when needed |

### 11.3 Material Master — Core Fields

| Field | Description | Mandatory |
|---|---|---|
| Material code | System-generated unique code | Yes |
| Material name | Full descriptive name | Yes |
| Short name / display name | Abbreviated for screens | Yes |
| Material category | RAW_MATERIAL, PACKING_MATERIAL, etc. | Yes |
| Base UOM | Stock unit — the unit in which stock is tracked | Yes |
| Purchase UOM | Unit in which material is purchased | Yes |
| Issue UOM | Unit in which material is issued to production | Yes |
| Packing unit | e.g., 1 packet = 4 bottles | If applicable |
| HSN code | For GST readiness | Yes |
| Description | Detailed description | Yes |
| Specification | Technical spec / grade | Optional |
| Shelf life | Days — for expiry tracking | If applicable |
| Batch required | Yes / No — batch/lot tracking needed | Yes |
| QA required on inward | Yes / No | Yes |
| QA required on FG | Yes / No | Yes |
| Valuation method | WEIGHTED_AVERAGE / DIRECT_BATCH_COST | Yes |
| Planning mode | FIXED_BOM / ADMIX_ACTUAL / HYBRID / MTS / MTO / TRADING / NON_PRODUCTION | Yes |
| Status | ACTIVE / INACTIVE / BLOCKED | Yes |
| Created by | ACL user | Yes |
| Approved by | Authorized approver | Yes |
| Company | Company scope | Yes |

### 11.4 Material Naming and Coding Convention

> **AMENDMENT — Round-4 Foundation Discovery (LOCKED):**
> PACE Code format confirmed. Per material type sequential numbering. Financial year reset = NO (lifetime unique).

| Material Type | Prefix | Format | Example | Sequence Reset |
|---|---|---|---|---|
| RM | RM- | RM-XXXXX | RM-00001 | Never |
| PM | PM- | PM-XXXXX | PM-00001 | Never |
| INT | INT- | INT-XXXXX | INT-00001 | Never |
| FG | FG- | FG-XXXXX | FG-00001 | Never |
| TRA | TRA- | TRA-XXXXX | TRA-00001 | Never |
| CONS | CONS- | CONS-XXXXX | CONS-00001 | Never |

**PACE Code Rules:**
- System auto-generates — user cannot specify
- Per material type: independent sequence
- Once assigned: never changes, never reused
- Deactivation does not free the code
- External Code (legacy/vendor code) stored separately — optional, updateable anytime

### 11.5 Material Master — Status Lifecycle

```
DRAFT → PENDING_APPROVAL → ACTIVE → INACTIVE (if deactivated)
                         ↓
                      BLOCKED (if quality/regulatory hold)
```

- DRAFT: Created, not yet submitted for approval
- PENDING_APPROVAL: Submitted — cannot be used in transactions yet
- ACTIVE: Approved and usable — transactions can reference this material
- INACTIVE: Deactivated — no new transactions. Historical transactions remain.
- BLOCKED: Blocked by QA or management — no new transactions until unblocked.

### 11.6 Critical Material Master Rules

1. A material cannot be received, issued, or transferred at a plant without a valid, active material plant extension.
2. Valuation method cannot be changed after the first stock posting without SA approval and controlled process.
3. Base UOM cannot be changed after any transaction exists against the material.
4. Batch requirement flag cannot be changed after stock exists.
5. Deactivation does not delete historical stock or transactions.
6. Material category determines which movement types are valid for that material.

---

## Section 12 — Material Company and Plant Extension

### 12.1 Why Extensions Are Required

A material created at company level is not automatically usable everywhere. This is a critical SAP-style control. Without this:

- Any user could receive any material at any plant
- Stock would be created at unauthorized locations
- Procurement planning would be unreliable
- Costing policy could not be plant-specific

### 12.2 Material Company Extension

| Field | Description |
|---|---|
| Material | Reference to material master |
| Company | Company this extension applies to |
| Procurement allowed | Yes / No |
| Valuation method override | Override if different from material master default |
| Tax category / HSN override | Company-specific if needed |
| Status | ACTIVE / INACTIVE |
| Approved by | Procurement manager |

### 12.3 Material Plant Extension

| Field | Description | Mandatory |
|---|---|---|
| Material | Reference to material master | Yes |
| Company | Parent company | Yes |
| Plant | Plant where material is active | Yes |
| Storage locations allowed | Which storage locations this material can go to | Yes |
| QA required on inward | Plant-specific override | Yes |
| Safety stock quantity | Minimum stock level for planning | Optional |
| Reorder point | Trigger point for procurement requirement | Optional |
| Lead time (days) | Expected procurement / production lead time | Optional |
| Default storage location | Where GRN lands by default | Optional |
| Valuation method | Plant-level override if needed | Optional |
| Status | ACTIVE / INACTIVE | Yes |
| Activated by | Plant stores manager | Yes |

### 12.4 Extension Rules

| Rule | Detail |
|---|---|
| Material + Company extension required | Before any company-level transaction |
| Material + Company + Plant extension required | Before any plant-level transaction (GRN, issue, transfer) |
| Extension deactivation | Does not affect existing stock. No new transactions. |
| Cross-plant use | Same material can be extended to multiple plants |
| Plant-specific QA rule | Plant A may require QA on inward; Plant B may not — both controlled by extension |
| Extension approval | Required. Stores manager or plant manager approves. |

### 12.5 Extension Check in Transactions

| Transaction | Extension Check |
|---|---|
| PO creation | Supplier-material-plant mapping checked |
| Gate entry | Material plant extension checked |
| GRN posting | Material plant extension must be ACTIVE |
| Issue to production (261) | Material plant extension must be ACTIVE |
| Plant transfer — source | Material plant extension at source plant checked |
| Plant transfer — target | Material plant extension at target plant checked |
| Dispatch | Material plant extension at dispatch plant checked |

---

## Section 13 — UOM and Multi-Unit Conversion

### 13.1 Why Multi-UOM is Critical

Your business has materials with multiple units. Example: 1 packet = 4 bottles of 1 litre each. This means:

- Purchase UOM: Packet
- Stock UOM: Bottle or Litre
- Issue UOM: Litre
- Base UOM: Litre (stock ledger tracks in litres)

If UOM conversion is wrong, every quantity, every value, every report will be wrong. This must be designed and locked before go-live.

### 13.2 UOM Types

| UOM Type | Description | Example |
|---|---|---|
| Base UOM | Unit in which stock is tracked in ledger | KG, Litre, Nos, Meter |
| Purchase UOM | Unit in which PO and GRN are raised | Bag, Packet, Box, Drum |
| Issue UOM | Unit in which material is issued to production | KG, Litre, Nos |
| Sales / Dispatch UOM | Unit in which FG is dispatched | Carton, Box, Nos |
| Packing UOM | Unit that describes a packing configuration | 1 Carton = 12 bottles |

### 13.3 UOM Conversion Table

Each material must have a UOM conversion table defining:

| From UOM | To UOM | Conversion Factor | Direction |
|---|---|---|---|
| 1 Packet | 4 Bottle | 4 | Purchase → Stock |
| 1 Bottle | 1 Litre | 1 | Stock → Issue |
| 1 Bag | 50 KG | 50 | Purchase → Stock |
| 1 Drum | 200 Litre | 200 | Purchase → Stock |
| 1 Carton | 12 Nos | 12 | Dispatch UOM |

### 13.4 UOM Conversion Design Rules

1. Base UOM is the single unit for the stock ledger. All quantities in the ledger are in base UOM.
2. Conversion is applied at the point of entry (GRN, issue, dispatch) — backend converts to base UOM before posting.
3. Reports can display in any UOM but the ledger stores base UOM.
4. Conversion factor must be locked per material before go-live.
5. Changing a conversion factor after stock exists requires SA approval and a controlled correction process.
6. UOM conversion table is part of material master — plant extension can have overrides if needed.

### 13.5 UOM Conversion at Transaction Points

| Transaction | UOM Behavior |
|---|---|
| PO | Raised in purchase UOM. System shows equivalent base UOM. |
| GRN | Entered in purchase UOM. Converted to base UOM for stock posting. |
| Issue to production (261) | Entered in issue UOM. Converted to base UOM for ledger. |
| Dispatch (601) | Entered in dispatch/sales UOM. Converted to base UOM for ledger. |
| Stock report | Displayed in base UOM by default. Can be toggled to purchase UOM. |
| Opening stock upload | Must specify UOM. Conversion applied automatically. |

### 13.6 UOM Master

A global UOM master is required. Examples:

| Code | Name | Type |
|---|---|---|
| KG | Kilogram | Weight |
| G | Gram | Weight |
| MT | Metric Tonne | Weight |
| L | Litre | Volume |
| ML | Millilitre | Volume |
| NOS | Numbers / Pieces | Count |
| BOX | Box | Packing |
| BAG | Bag | Packing |
| PKT | Packet | Packing |
| DRM | Drum | Packing |
| CTN | Carton | Packing |
| MTR | Metre | Length |

---

## Section 14 — Vendor Master

> **AMENDMENT — Layer 2 Procurement Discovery (LOCKED):**
> Section fully updated. Old design superseded by Layer 2 discovery (Section 85.6).
> Key changes: Vendor types = DOMESTIC / IMPORT only. Payment terms = dynamic last used (no static field).
> Bank details = optional now. Multi-company support confirmed. Deactivation rules added.

### 14.1 What is Vendor Master?

Vendor Master is the identity record for every vendor who supplies materials or services. Every PO, GRN, and payment transaction references the vendor master.

### 14.2 Vendor Types

| Type | Description |
|---|---|
| DOMESTIC | BDT currency. GST applicable. API auto-fill from APIFLOW (BIN → Name, Address, GST auto-populated). |
| IMPORT | Foreign currency. Customs applicable. Manual entry. |

Only DOMESTIC and IMPORT exist in Phase-1. No "BOTH" type.

### 14.3 Vendor Master — Core Fields

| Field Group | Field | Mandatory | Notes |
|---|---|---|---|
| **Basic** | Vendor Code | Yes | System auto-generated |
| | Vendor Name | Yes | Legal/trade name |
| | Vendor Type | Yes | DOMESTIC / IMPORT |
| **Identity** | BIN Number | Domestic | API validation — triggers auto-fill |
| | TIN | Optional | |
| | Trade License | Optional | |
| **GST (Domestic)** | GST Number | Domestic | API auto-fill: Name, Address, Category |
| | GST Category | Domestic | From API |
| **Address** | Registered Address | Yes | Auto from API for Domestic |
| | Correspondence Address | Optional | |
| **Contact** | Primary Contact Person | Yes | |
| | Phone | Yes | |
| | Primary Email | Yes | For PO auto-mail |
| | CC Email List | Optional | All CC'd on PO auto-mail |
| **Import** | IEC Code | Import | Importer Exporter Code |
| | Import License | Import | |
| **Bank** | Bank Name | Optional | Mandatory in future |
| | Branch | Optional | |
| | Account Number | Optional | |
| | Routing Number | Optional | |
| **Payment** | Payment Terms | ❌ No static field | Dynamic — last used per vendor (see 14.5) |
| | Currency | Yes | Auto: BDT for Domestic, Foreign for Import |
| **Status** | Status | Yes | ACTIVE / INACTIVE / BLOCKED |
| **Audit** | Created By | Yes | Procurement team only |
| | Approved By | Yes | Any authorized approver (single level) |

### 14.4 Vendor Status Lifecycle

```
DRAFT → PENDING_APPROVAL → ACTIVE → INACTIVE / BLOCKED
```

- **BLOCKED:** No new POs. Existing open POs — Procurement team decides separately.
- **INACTIVE (Deactivated):** Historical POs remain. No new POs. Requires: (1) Ledger balanced — no open payables, (2) Approval required.

### 14.5 Payment Terms — Dynamic Last Used

> **No static payment terms field in Vendor Master.**

| Scenario | System Behaviour |
|---|---|
| New PO for vendor (first ever PO) | Blank → user enters manually |
| New PO for vendor (subsequent POs) | Auto-populated from last confirmed PO for this vendor |
| User changes on PO | Allowed — becomes new "last used" after PO confirmed |

**Rationale:** Static defaults become stale and cause errors. Dynamic last-used is always contextually correct and eliminates stale default risk.

### 14.6 PO Auto-Mail

On PO confirmation, system emails the PDF to:
- Vendor primary email
- All CC emails from CC list

### 14.7 Multi-Company Support

A vendor can be active in multiple companies simultaneously. Company-level mapping controls in which companies this vendor is usable.

### 14.8 Vendor Governance Rules

| Action | Who | Rule |
|---|---|---|
| Create | Procurement team | Only |
| Edit | Procurement team | |
| Approve | Any authorized approver | Single level |
| Block | Procurement team + Approval | |
| Deactivate | Procurement team + Approval | Ledger must be balanced first |
| Multi-company assign | Procurement team | |

### 14.9 Critical Vendor Master Rules

1. Vendor cannot be used in a PO without being ACTIVE.
2. Vendor must have a Vendor-Material Info Record for the specific material before PO line can be saved (see Section 15).
3. Blocking a vendor does not cancel existing open POs — Procurement team decides separately.
4. Vendor GSTIN is Phase-1 reference field — mandatory for GST invoice in Phase-3.
5. Bank details are optional in Phase-1 — will be made mandatory in a future phase.

---

## Section 15 — Vendor-Material Info Record (Approved Source List)

> **AMENDMENT — Layer 2 Procurement Discovery (LOCKED):**
> Sections 15 and 16 (old design) have been fully replaced.
> Old "Supplier-Material Source" and separate "Approved Source List" designs are SUPERSEDED.
> In PACE-ERP: the Vendor-Material Info Record is BOTH the purchasing info record AND the approved source list — a single entity.
> Reference: Section 84.5 (Foundation Layer) + Section 85.7 (Procurement Layer).

### 15.1 What is the Vendor-Material Info Record?

The Vendor-Material Info Record serves dual purpose in PACE-ERP:

1. **Purchasing Info Record** — vendor-specific procurement data (pack size, UOM conversion, lead time, last price)
2. **Approved Source List** — defines which vendors are approved to supply which materials

A Vendor-Material Info Record must exist and be Active for a vendor + material combination before a PO line can be saved. If no record exists → **hard block at PO line entry**.

### 15.2 Record Fields

| Field | Description | Mandatory |
|---|---|---|
| Vendor | Link to vendor master | Yes |
| Material | Link to material master (PACE code) | Yes |
| Vendor's Material Code | Vendor's own code/name for this material | Optional |
| Pack Size | Vendor-specific pack size (e.g., 25 KG Bag) | Yes |
| PO UOM | Vendor's unit of measure (e.g., Bag, Drum, Carton) | Yes |
| Conversion | PO UOM → Base UOM (e.g., 1 Bag = 25 KG) | Yes |
| Lead Time | Vendor's lead time in days for this material | Optional |
| Last Price | Reference price — auto-updated on every GRN confirmation | Auto |
| Status | ACTIVE / INACTIVE | Yes |

### 15.3 Approved Source Enforcement at PO

| Scenario | System Behaviour |
|---|---|
| Record exists, Status = ACTIVE | PO line allowed. PO UOM + last price auto-populated. |
| Record does not exist | **Hard block** — "This vendor is not an approved source for this material" |
| Record exists, Status = INACTIVE | **Hard block** — treated as not approved |

- No priority ranking between approved vendors. All active records equally selectable.
- Multiple vendors can be approved for the same material — user selects at PO time.
- No FIXED / PREFERRED / APPROVED hierarchy — approved means approved.

### 15.4 Multiple Vendors Per Material — Example

| Material | Vendor | Pack Size | PO UOM | Status |
|---|---|---|---|---|
| RM-00045 | V-00012 (ABC Chemicals) | 25 KG | Bag | ACTIVE |
| RM-00045 | V-00031 (XYZ Imports) | 50 KG | Bag | ACTIVE |
| RM-00045 | V-00055 (PQR Ltd) | 1 MT | Drum | INACTIVE |

PO for RM-00045 → V-00012 or V-00031 both allowed. V-00055 blocked.

### 15.5 Last Price Auto-Update

On every GRN confirmation:
- System updates "Last Price" on the Vendor-Material Info Record with the GRN rate.
- This becomes the default rate on next PO for that vendor + material combination.
- User can override rate on PO line — override does not affect the record until GRN confirms.

### 15.6 Governance

| Action | Who | Approval Required |
|---|---|---|
| Create | Procurement team | No — directly active |
| Edit | Procurement team | No — directly |
| Inactivate | Procurement team | No — directly |

### 15.7 PO Creation Validation Sequence

When a PO line is entered, backend validates in order:

1. Is the material ACTIVE? (Material master check)
2. Is the vendor ACTIVE? (Vendor master check)
3. Does a Vendor-Material Info Record exist for this vendor + material, Status = ACTIVE? → **If No: hard block**
4. Is the material extended to this plant? (Plant extension check)

If all pass → PO line saved. PO UOM and last price auto-populated from Info Record.

---

## Section 16 — Approved Source List

> **SUPERSEDED — Layer 2 Procurement Discovery (LOCKED)**
>
> This section's design is replaced by Section 15 (Vendor-Material Info Record).
>
> The separate "Approved Source List" entity with FIXED / PREFERRED / APPROVED source types is **not used in PACE-ERP**.
>
> In PACE-ERP: existence of an Active Vendor-Material Info Record = approved source. No separate entity required.
>
> The Quota Arrangement concept (Section 17) remains as Phase-2 provision and is unaffected.
>
> **For implementation: refer to Section 15 only. This section is archived for reference.**

---

## Section 17 — Quota Arrangement / Supplier Allocation

### 17.1 What is Quota Arrangement?

Quota Arrangement (SAP: MEQ1) defines how procurement requirement for a material is split between multiple approved suppliers by percentage.

Example:
- Material RM-00001, Plant-1 has requirement of 1000 KG
- Supplier A: 60% quota = 600 KG
- Supplier B: 40% quota = 400 KG

### 17.2 Phase Plan

| Phase | What is done |
|---|---|
| Phase-1 | Design and placeholder only. Fields reserved in Supplier-Material Source. |
| Phase-2 | Quota arrangement master and automatic quota-based PO suggestion activated. |

### 17.3 Quota Arrangement Design Fields (Placeholder)

| Field | Description |
|---|---|
| Material | Reference |
| Plant | Plant scope |
| Company | Company scope |
| Supplier | Reference to supplier |
| Quota percentage | % of total requirement allocated to this supplier |
| Valid from / to | Validity period |
| Minimum lot size | Minimum quantity per PO to this supplier |
| Status | ACTIVE / INACTIVE |

---

## Section 18 — Customer Master

### 18.1 What is Customer Master?

Customer Master is the identity record for every customer who receives dispatched finished goods. It is the SD equivalent of Supplier Master.

### 18.2 Customer Master — Core Fields

| Field | Description | Mandatory |
|---|---|---|
| Customer code | System-generated | Yes |
| Customer name | Legal/trade name | Yes |
| Customer type | DOMESTIC / EXPORT | Yes |
| Address | Delivery address | Yes |
| Billing address | May differ from delivery | Yes |
| GSTIN | GST registration (India) | If GST applicable |
| PAN | PAN number | Yes |
| Contact person | Primary contact | Yes |
| Phone / email | Contact details | Yes |
| Credit limit | Maximum outstanding allowed (Phase-2) | Phase-2 |
| Payment terms | Credit days | Yes |
| Currency | INR / USD etc. | Yes |
| Dispatch plant | Default plant from which goods are dispatched | Optional |
| Status | ACTIVE / INACTIVE / BLOCKED | Yes |
| Created by | Sales / dispatch user | Yes |
| Approved by | Sales manager | Yes |

### 18.3 Customer Status Lifecycle

```
DRAFT → PENDING_APPROVAL → ACTIVE → INACTIVE / BLOCKED
```

- BLOCKED: No new dispatches allowed. Existing pending dispatches held.

### 18.4 Customer-Product Mapping (Optional Phase-1)

Some businesses need to control which products can be dispatched to which customer. This is an optional control:

| Field | Description |
|---|---|
| Customer | Reference to customer master |
| Material / product | Reference to material master (FG) |
| Allowed | Yes / No |
| Price / rate | Customer-specific price (Phase-2) |
| Valid from / to | Validity period |

---

## Section 19 — Master Data Summary and Dependency Order

Before any transaction can be executed, master data must exist in the correct order. This sequence is mandatory:

```
Step 1:  Company master (SA creates)
Step 2:  Plant / work context (SA creates)
Step 3:  Business section / operating section (SA creates)
Step 4:  Department (SA creates)
Step 5:  Storage location (SA creates)
Step 6:  Stock type master (SA creates / locks)
Step 7:  Movement type master (SA creates / locks)
Step 8:  Number series framework (SA creates)
Step 9:  Cost center framework (SA creates)
Step 10: UOM master (SA creates)
Step 11: Material master (ACL user creates + approves)
Step 12: Material company extension (ACL user creates + approves)
Step 13: Material plant extension (ACL user creates + approves)
Step 14: Supplier master (ACL user creates + approves)
Step 15: Supplier company extension (ACL user creates + approves)
Step 16: Supplier-material source / info record (ACL user creates + approves)
Step 17: Approved source list (Procurement manager creates + approves)
Step 18: Customer master (ACL user creates + approves)
Step 19: BOM / formula (ACL user creates + approves) — after material master
Step 20: Opening stock (controlled one-time migration — after all master data is ready)
```

**Nothing in Step 11 and beyond can be done without Steps 1–10 being complete.**

**Nothing in Step 20 (opening stock) can be done without Steps 11–19 being complete.**

---

*— End of Part C —*

---

# PART D — STOCK ARCHITECTURE

---

## Section 20 — Storage Location Model

### 20.1 What is a Storage Location?

A Storage Location is the physical or logical area within a plant where stock is kept. Stock in PACE-ERP is tracked at the level of:

**Company → Plant → Storage Location → Material → Stock Type → Batch (if applicable)**

Without storage location, stock exists only "somewhere in the plant" — which is insufficient for a running multi-plant business.

### 20.2 Standard Storage Location Types

| Location Code | Name | Purpose | Stock Types Allowed |
|---|---|---|---|
| MAIN-STORE | Main Store | General raw material and packing material receipt and holding | UNRESTRICTED, QUALITY_INSPECTION |
| QA-STORE | QA Store | Materials under quality inspection after GRN | QUALITY_INSPECTION |
| REJECTED-STORE | Rejected Store | Materials rejected by QA | REJECTED |
| BLOCKED-STORE | Blocked Store | Materials blocked pending decision | BLOCKED |
| SCRAP-YARD | Scrap Yard | Scrapped / written-off material | SCRAP |
| PROD-STORE | Production Store | Materials issued/reserved for production | UNRESTRICTED, RESERVED |
| FG-STORE | FG Store | Finished goods after production | FG_UNRESTRICTED, FG_QA, FG_BLOCKED, FG_RESERVED |
| DISPATCH-HOLD | Dispatch Hold | FG confirmed for dispatch, held before vehicle loading | FG_SCHEDULED, DISPATCH_HOLD |
| RETURN-STORE | Return Store | Customer returns received, pending QA decision | RETURNED |
| ADMIX-STORE | Admix Store | Admix section raw material and WIP | UNRESTRICTED, RESERVED |
| TRANSIT-LOGICAL | Stock In Transit (logical) | Stock issued from source plant, not yet received at target | IN_TRANSIT |
| REPAIR-STORE | Repair Store | Spares and items sent out for repair (Phase-3) | UNRESTRICTED |

> Storage location codes and names are proposals. Actual locations will be confirmed in Round-1 discovery.

### 20.3 Storage Location Design Rules

1. Every GRN must post to a specific storage location — "plant stock" without location is not allowed.
2. QA-required materials on GRN must land in QA-STORE or QUALITY_INSPECTION bucket first.
3. After QA release, movement to MAIN-STORE UNRESTRICTED is done via 321.
4. FG after production receipt lands in FG-STORE.
5. FG after QA release moves to FG_UNRESTRICTED within FG-STORE.
6. Dispatch hold area is a controlled location — only authorized dispatch users can move stock here.
7. TRANSIT-LOGICAL is a system bucket — it has no physical location. It represents stock in motion between plants.
8. Each storage location belongs to exactly one plant.
9. SA defines storage locations. ACL users cannot create ad-hoc locations.

### 20.4 Storage Location Object Fields

| Field | Description | Mandatory |
|---|---|---|
| Location code | Unique within plant | Yes |
| Location name | Display name | Yes |
| Plant | Parent plant | Yes |
| Company | Parent company | Yes |
| Location type | Physical / Logical / Transit | Yes |
| Allowed stock types | Which stock types can exist here | Yes |
| Default for GRN | Is this the default landing location for GRN? | Optional |
| QA hold flag | Does stock here always require QA before release? | Yes |
| Dispatch allowed | Can stock be dispatched from here? | Yes |
| Status | ACTIVE / INACTIVE | Yes |

---

## Section 21 — Stock Type Model

### 21.1 What is a Stock Type?

Stock Type defines the status or condition of stock. The same material in the same storage location can be in different stock types at the same time. A movement type always defines which stock type it affects — both source and target.

Stock type is not just a label. It controls:
- Whether stock is available for production issue
- Whether stock is available for dispatch
- Whether stock can be transferred
- Whether stock is counted in available stock for procurement planning

### 21.2 Complete Stock Type Master

| Stock Type Code | Name | Available for Use? | Description |
|---|---|---|---|
| UNRESTRICTED | Unrestricted | Yes | Normal usable stock. Can be issued, transferred, dispatched. |
| QUALITY_INSPECTION | Quality Inspection | No | Under QA check. Cannot be used until released. |
| BLOCKED | Blocked | No | Blocked by QA or management. Cannot be used until decision. |
| REJECTED | Rejected | No | Failed QA. Awaiting return to vendor or scrap. |
| RESERVED | Reserved | Partially | Reserved for a specific process order or dispatch. Not freely available. |
| SCHEDULED | Scheduled | Partially | Allocated to a planned dispatch or production. |
| IN_TRANSIT | In Transit | No | Issued from source plant, not yet at target plant. |
| SCRAP | Scrap | No | Written off. No further use. Scrap value may apply. |
| RETURNED | Returned | No | Customer return received. Pending QA decision. |
| REWORK | Rework | No | Under rework / reprocessing. |
| REUSE_HOLD | Reuse Hold | No | Returned FG approved for reuse. Pending production team acceptance. |
| FG_QA | FG Quality Inspection | No | FG under QA check before dispatch clearance. |
| FG_UNRESTRICTED | FG Unrestricted | Yes | FG passed QA. Available for dispatch. |
| FG_BLOCKED | FG Blocked | No | FG blocked by QA or management. |
| FG_RESERVED | FG Reserved | Partially | FG reserved for a specific customer / dispatch instruction. |
| FG_SCHEDULED | FG Scheduled | Partially | FG confirmed for dispatch, loading pending. |
| DISPATCH_HOLD | Dispatch Hold | No | FG in dispatch hold area, vehicle loading pending. |
| FOR_REPROCESS | For Reprocess | No | FG or returned material approved for reuse as RM input in a new Process Order. Can only be consumed by a Process Order. Cannot be dispatched, transferred, or issued freely. Release to this state is role-restricted. |

> **FOR_REPROCESS — Added from Round-3 Admix Discovery:**
> Covers two scenarios:
> 1. Undispatched FG stock reclassified for use as RM in another Process Order
> 2. Rejected / returned material that passed QA re-evaluation and approved for reuse
> In both cases: original material code retained, weighted average cost flows into consuming Process Order.

### 21.3 Stock Type Transition Rules

Stock type transitions happen only through movement types. Direct stock type change is forbidden.

| From Stock Type | To Stock Type | Movement Type | Trigger |
|---|---|---|---|
| QUALITY_INSPECTION | UNRESTRICTED | 321 | QA release |
| UNRESTRICTED | QUALITY_INSPECTION | 322 | QA re-inspection |
| BLOCKED | UNRESTRICTED | 343 | Management release |
| UNRESTRICTED | BLOCKED | 344 | Management block |
| BLOCKED | QUALITY_INSPECTION | 349 | Send back to QA |
| QUALITY_INSPECTION | BLOCKED | 350 | QA decision — block |
| UNRESTRICTED | SCRAP | 551 | Write-off / scrap |
| QUALITY_INSPECTION | SCRAP | 553 | QA reject → scrap |
| BLOCKED | SCRAP | 555 | Blocked → scrap |
| RETURNED | UNRESTRICTED | 653 | Return QA release |
| RETURNED | QUALITY_INSPECTION | 655 | Return to QA |
| RETURNED | BLOCKED | 657 | Return blocked |
| UNRESTRICTED | FOR_REPROCESS | Custom (role-restricted) | FG reclassified for reuse as RM — authorized user only |
| BLOCKED | FOR_REPROCESS | Custom (role-restricted) | Rejected/returned material approved for reuse — authorized user only |
| QUALITY_INSPECTION | FOR_REPROCESS | Custom (role-restricted) | QA-passed return material moved to reprocess — authorized user only |
| FOR_REPROCESS | UNRESTRICTED | Custom (role-restricted) | Reprocess cancelled — returned to usable stock — authorized user only |
| FG_QA | FG_UNRESTRICTED | 321 (FG context) | FG QA release |
| FG_UNRESTRICTED | DISPATCH_HOLD | Custom/scheduled | Dispatch confirmation |
| UNRESTRICTED (opening) | — | 561 | Opening stock posting |

### 21.4 Procurement Planning: Available Stock Calculation

```
Available Stock for Planning =
  UNRESTRICTED stock
+ QUALITY_INSPECTION stock (if expected to pass)
- RESERVED stock
- SCHEDULED stock
+ Open PO pending quantity (not yet received)
+ IN_TRANSIT quantity (expected receipt)
- Planned production requirement (from process orders)
- Safety stock minimum
= Net Available / Shortage
```

This calculation is used by the procurement planning view to determine whether a PR / PO is needed.

---

## Section 22 — Movement Type Master

### 22.1 What is a Movement Type?

Movement Type is the most critical control in the stock architecture. Every single stock change — receipt, issue, transfer, scrap, return, adjustment — is executed through a movement type. The movement type defines:

- What stock type is affected (from / to)
- What storage location is affected
- What quantity impact occurs (+/-)
- What value impact occurs (+/-)
- What reference document is required
- What account assignment is required
- Whether approval is needed
- What the reversal movement type is

**Direct stock edit without movement type is absolutely forbidden.**

### 22.2 Goods Receipt Movements

| Code | Name | Description | Reversal |
|---|---|---|---|
| 101 | GR for Purchase Order | Standard goods receipt against PO. Stock → QUALITY_INSPECTION or UNRESTRICTED. | 102 |
| 102 | Reversal of 101 | Reverses a GR posting. Stock returns to PO open quantity. | — |
| 103 | GR into GR Blocked Stock | Receipt into blocked stock before inspection decision. | 104 |
| 104 | Reversal of 103 | Reverses GR blocked stock. | — |
| 105 | Release GR Blocked Stock | Releases blocked GR stock to UNRESTRICTED or QUALITY_INSPECTION. | 106 |
| 106 | Reversal of 105 | Reverses release. | — |

### 22.3 Vendor Return Movements

| Code | Name | Description | Reversal |
|---|---|---|---|
| 122 | Return to Vendor | Returns material from stock to vendor. Reduces stock. | 123 |
| 123 | Reversal of 122 | Reverses vendor return. | — |
| 161 | Return for Purchase Order | Return against a specific PO. | 162 |
| 162 | Reversal of 161 | Reverses 161. | — |

### 22.4 Goods Issue Movements

| Code | Name | Description | Reversal |
|---|---|---|---|
| 201 | Issue to Cost Center | Issues stock to a cost center (overhead, general use). | 202 |
| 202 | Reversal of 201 | | — |
| 221 | Issue to Project | Issues stock against a project code. | 222 |
| 222 | Reversal of 221 | | — |
| 241 | Issue to Asset | Issues stock for capital asset creation. | 242 |
| 242 | Reversal of 241 | | — |
| 251 | Issue for Sales (without SD) | Direct issue for sales without SD dispatch flow. | 252 |
| 252 | Reversal of 251 | | — |
| 261 | Issue to Production / Process Order | Core production issue. Reduces UNRESTRICTED stock. | 262 |
| 262 | Reversal of 261 | Reverses production issue. | — |

### 22.5 Stock Transfer Movements

| Code | Name | Description | Reversal |
|---|---|---|---|
| 301 | Plant-to-Plant Transfer (one step) | Immediate transfer. Source stock reduces, target stock increases. | 302 |
| 302 | Reversal of 301 | | — |
| 303 | Stock Transfer Issue (two-step, source) | Source plant issues stock. Moves to IN_TRANSIT. | 304 |
| 304 | Reversal of 303 | | — |
| 305 | Stock Transfer Receipt (two-step, target) | Target plant receives from IN_TRANSIT. | 306 |
| 306 | Reversal of 305 | | — |
| 309 | Material-to-Material Transfer | Transfer between different materials (repacking, conversion). | 310 |
| 310 | Reversal of 309 | | — |
| 311 | Storage Location Transfer (within plant) | Moves stock from one storage location to another within plant. | 312 |
| 312 | Reversal of 311 | | — |

### 22.6 Stock Type Transfer Movements

| Code | Name | Description | Reversal |
|---|---|---|---|
| 321 | Quality Inspection → Unrestricted | QA release — standard. | 322 |
| 322 | Unrestricted → Quality Inspection | Re-inspection or re-hold. | 321 |
| 343 | Blocked → Unrestricted | Management release of blocked stock. | 344 |
| 344 | Unrestricted → Blocked | Management block. | 343 |
| 349 | Blocked → Quality Inspection | Blocked sent back for QA review. | 350 |
| 350 | Quality Inspection → Blocked | QA decision to block. | 349 |
| 453 | Returns Blocked → Unrestricted | Return stock released to unrestricted. | 454 |
| 454 | Reversal of 453 | | — |
| 457 | Returns Blocked → Quality | Return sent to QA. | 458 |
| 458 | Reversal of 457 | | — |

### 22.7 Scrap / Write-off Movements

| Code | Name | Description | Reversal |
|---|---|---|---|
| 551 | Scrap from Unrestricted | Write-off from unrestricted stock. | 552 |
| 552 | Reversal of 551 | | — |
| 553 | Scrap from Quality Inspection | QA-rejected → scrap. | 554 |
| 554 | Reversal of 553 | | — |
| 555 | Scrap from Blocked | Blocked stock → scrap. | 556 |
| 556 | Reversal of 555 | | — |

### 22.8 Opening Stock Movements

| Code | Name | Description | Reversal |
|---|---|---|---|
| 561 | Opening Stock to Unrestricted | One-time migration posting of opening stock. | 562 |
| 562 | Reversal of 561 | Used only to correct before go-live. | — |
| 563 | Opening Stock to Quality Inspection | Opening stock directly into QA bucket. | 564 |
| 564 | Reversal of 563 | | — |
| 565 | Opening Stock to Blocked | Opening stock directly into blocked bucket. | 566 |
| 566 | Reversal of 565 | | — |

### 22.9 Physical Inventory Movements

| Code | Name | Description | Reversal |
|---|---|---|---|
| 701 | Physical Inventory Gain — Unrestricted | Physical count > system count. Increases stock. | Manual correction only |
| 702 | Physical Inventory Loss — Unrestricted | Physical count < system count. Decreases stock. | Manual correction only |
| 703 | Physical Inventory Gain — Quality | Gain in QA stock. | — |
| 704 | Physical Inventory Loss — Quality | Loss in QA stock. | — |
| 707 | Physical Inventory Gain — Blocked | Gain in blocked stock. | — |
| 708 | Physical Inventory Loss — Blocked | Loss in blocked stock. | — |

### 22.10 Sales / Dispatch Movements (SD)

| Code | Name | Description | Reversal |
|---|---|---|---|
| 601 | Goods Issue for Delivery | FG dispatched to customer. Stock reduced. | 602 |
| 602 | Reversal of 601 | | — |
| 651 | Sales Return | Customer returns FG. Stock received into RETURNED bucket. | 652 |
| 652 | Reversal of 651 | | — |
| 653 | Return → Unrestricted | Return QA passed — to unrestricted. | 654 |
| 654 | Reversal of 653 | | — |
| 655 | Return → Quality Inspection | Return to QA for inspection. | 656 |
| 656 | Reversal of 655 | | — |
| 657 | Return → Blocked | Return blocked pending decision. | 658 |
| 658 | Reversal of 657 | | — |

### 22.11 PACE Custom Movement Types (901–999 Range)

Custom movements for PACE-specific business processes. These do not override SAP standard movement codes.

| Code | Name | Description | Reversal |
|---|---|---|---|
| 901 | Returned FG → Reuse Input | Approved returned FG moved to REUSE_HOLD for production input. | 902 |
| 902 | Reversal of 901 | | — |
| 903 | Admix Reuse Input | Admix-specific reusable stock input to process order. | 904 |
| 904 | Reversal of 903 | | — |
| 905 | Repacking / Relabelling Issue | Stock issued for repacking or relabelling. | 906 |
| 906 | Reversal of 905 | | — |
| 907 | Repacking / Relabelling Receipt | Stock received after repacking or relabelling. | 908 |
| 908 | Reversal of 907 | | — |
| 909 | Rework Issue | Stock issued for rework process. | 910 |
| 910 | Reversal of 909 | | — |
| 911 | Rework Receipt | Stock received after rework. | 912 |
| 912 | Reversal of 911 | | — |

> Additional custom movement types in the 913–999 range are reserved for future business requirements. SA must approve any new custom movement type before activation.

### 22.12 Movement Type Master — Lock Rule

**The movement type master must be locked before go-live.**

After lock:
- No new movement type can be added without SA approval and design review.
- No existing movement type can be modified without SA approval.
- Any modification after lock must be treated as a structural change with migration.

### 22.13 — AMENDMENT: PACE P-Prefix (Round-4 Foundation Discovery)

> **Status: LOCKED — Supersedes all movement type codes above**
>
> All movement type codes in PACE-ERP are prefixed with **P** to establish distinct PACE-ERP identity while retaining SAP-familiar numbering convention.
>
> **Rule:** Every code in Sections 22.2 through 22.11 is read as P-prefixed.
> Example: 101 → **P101**, 261 → **P261**, 321 → **P321**, 601 → **P601**
>
> This applies to all existing and future movement types.
> The P-prefix is not cosmetic — it is the actual system code stored in the database.
>
> **Legal basis:** Movement type numbers are industry-standard inventory management concepts, not SAP intellectual property. P-prefix establishes PACE-ERP as a distinct system.

---

## Section 23 — Stock Document and Posting Engine Concept

### 23.1 The Posting Engine Principle

Every stock change in PACE-ERP must go through the Stock Posting Engine. This is a backend-only service. No frontend can call stock tables directly.

```
User Action (any transaction)
       ↓
Backend receives request
       ↓
ACL evaluation — is this user allowed to execute this movement?
       ↓
Stock Document created (status: PENDING or DRAFT)
       ↓
Validation Engine:
  - Movement type valid?
  - Material plant extension active?
  - Source stock type matches movement rule?
  - Sufficient quantity available?
  - Reference document valid? (PO, process order, dispatch instruction)
  - UOM conversion applied?
  - Approval required? → if yes, hold for approval
       ↓
Approval Engine (if required):
  - Approval request created
  - Approver notified
  - On approval → proceed
  - On rejection → document rejected, no posting
       ↓
Posting Engine:
  - Stock Ledger: INSERT new movement row (append-only)
  - Current Stock Snapshot: UPDATE quantity and value
  - Valuation Engine: calculate new weighted average or direct cost
  - Audit entry: INSERT into erp_audit (append-only)
       ↓
Stock Document: status → POSTED
       ↓
Reference document updated (PO received qty, process order issued qty, etc.)
```

### 23.2 Stock Document Structure

Every stock movement creates a Stock Document. This is the transaction record.

| Field | Description |
|---|---|
| Document number | System-generated, movement-type-series |
| Document date | Posting date |
| Movement type | Which movement (101, 261, 321, 701, etc.) |
| Material | Reference to material master |
| Company | Company scope |
| Plant | Plant scope |
| Source storage location | Where stock comes from |
| Target storage location | Where stock goes to |
| Source stock type | Stock type before movement |
| Target stock type | Stock type after movement |
| Quantity | In base UOM |
| UOM | Base UOM |
| Value | Quantity × valuation rate |
| Valuation rate | Rate applied at time of posting |
| Reference document type | PO / Process Order / Dispatch / PID / Transfer Order |
| Reference document number | Number of the reference document |
| Account assignment | Cost center / project / asset reference |
| Batch / lot | If batch tracking is active for material |
| Posted by | ACL user who executed |
| Posted on | Timestamp |
| Approval reference | If approval was required |
| Status | DRAFT / PENDING_APPROVAL / POSTED / REVERSED / CANCELLED |
| Reversal document | Reference to reversal document if reversed |

### 23.3 What Cannot Happen

| Forbidden Action | Why |
|---|---|
| Direct UPDATE on stock quantity table | Bypasses posting engine — forbidden |
| Direct INSERT into stock ledger | Bypasses validation — forbidden |
| Manual deletion of posted stock document | Forbidden — reversal movement required |
| Stock document edit after posting | Forbidden — post once, reverse if wrong |
| Movement without reference document (where required) | Validation rejects |
| Movement type not in master | Validation rejects |
| Issue beyond available quantity | Validation rejects (configurable tolerance) |

---

## Section 24 — Stock Ledger and Current Stock Snapshot

### 24.1 Stock Ledger

The Stock Ledger is the single source of truth for all stock. It is an append-only table. Rows are never updated or deleted after posting.

Every stock movement creates one or more ledger rows. The stock ledger is the audit-proof record of every quantity and value change.

**Stock Ledger Row Structure:**

| Field | Description |
|---|---|
| Ledger ID | Unique row identifier |
| Stock document number | Reference to stock document |
| Posting date | Date of movement |
| Company | Company |
| Plant | Plant |
| Storage location | Storage location |
| Material | Material |
| Batch / lot | If applicable |
| Stock type | UNRESTRICTED / QUALITY_INSPECTION / etc. |
| Movement type | 101 / 261 / 321 / 701 etc. |
| Direction | IN / OUT |
| Quantity | Base UOM quantity (positive) |
| UOM | Base UOM |
| Value | Monetary value of movement |
| Valuation rate | Rate at time of posting |
| Running balance quantity | Calculated running total (for reporting) |
| Running balance value | Calculated running value |
| Reference document type | PO / Process Order / Dispatch etc. |
| Reference document number | Reference |
| Posted by | ACL user |
| Posted on | Timestamp |

### 24.2 Current Stock Snapshot

The Current Stock Snapshot is derived from the stock ledger. It is a summary view showing the current position.

**Current Stock Snapshot Structure:**

| Field | Description |
|---|---|
| Company | Company |
| Plant | Plant |
| Storage location | Storage location |
| Material | Material |
| Batch / lot | If applicable |
| Stock type | Stock type bucket |
| Current quantity | Sum of all movements to date |
| Current value | Current total value |
| Current valuation rate | Current weighted average or last direct cost |
| Last updated | Timestamp of last movement |

### 24.3 Stock History Report Equation

Every material's stock history must satisfy:

```
Opening Stock (561/563/565)
+ All Receipts (101, 105, 653, 305, 311 IN, 321, 343, 901, 907, 911)
- All Issues (261, 201, 221, 241, 251, 601, 303, 311 OUT, 551, 553, 555)
± Stock Type Transfers (321, 322, 343, 344, 349, 350 — no net qty change)
± Physical Inventory Adjustments (701 gain / 702 loss)
± Plant Transfer Movements (301 IN/OUT, 303/305)
= Closing Stock (Current Stock Snapshot)
```

This equation must always balance. Any discrepancy is a data integrity violation.

### 24.4 Data Lifecycle and Archive

Following the PACE Constitution cost control rules:

| Data Layer | Content | Retention |
|---|---|---|
| Active tables | Current FY + previous FY stock ledger | Always in primary DB |
| Archive tables (same DB) | 3–5 FY old stock ledger | Queryable via backend |
| Deep archive (external storage) | 5+ years stock ledger | Compressed, fetched on demand |

Reports that query historical data must route through the backend's data layer selector — not directly to archive tables from frontend.

---

## Section 25 — Costing and Valuation Policy

### 25.1 Why Costing Policy Must Be Locked Before Go-Live

If the wrong valuation method is applied:
- Opening stock value will be wrong
- GR value will be miscalculated
- Process order cost will be wrong
- FG actual cost will be wrong
- Every report will be unreliable

Valuation method per material must be locked before go-live and cannot be changed without a controlled process.

### 25.2 Supported Valuation Methods

| Method Code | Name | Description | When to Use |
|---|---|---|---|
| WEIGHTED_AVERAGE | Moving Weighted Average | Rate recalculated at every GR. Issues consume at current average. | Most raw materials, packing materials, standard consumables |
| DIRECT_BATCH_COST | Direct / Specific Identification | Each batch carries its own actual cost. No averaging. | Imported materials, project-specific, expensive spares, returned FG reuse |
| STANDARD_COST | Standard / Planned Cost | Fixed rate set periodically. Variance tracked. | Optional Phase-2 for FG costing comparison |
| ACTUAL_PROCESS_COST | Actual Process Order Cost | FG cost = actual process order cost ÷ actual output. | All production outputs |
| MANUAL_APPROVED_COST | Manual Approved Rate | Rate set by approved authority. Used for special cases. | Returned FG reuse with management-approved value |
| SCRAP_VALUE | Scrap Realization Value | Scrap valued at net realization estimate. | Scrap / write-off |

### 25.3 Weighted Average Calculation

```
Example:

Existing stock:  100 KG @ ₹10.00 = ₹1,000
New GR:           50 KG @ ₹12.00 =   ₹600

New total quantity: 150 KG
New total value:  ₹1,600
New weighted average rate: ₹1,600 ÷ 150 = ₹10.67

Next issue will consume at ₹10.67 per KG
until the next GR updates the rate again.
```

### 25.4 Direct Batch Cost

| Scenario | How It Works |
|---|---|
| Import consignment | Each consignment is a distinct batch. Rate = (CIF value + customs + freight + handling) ÷ quantity. |
| Project-specific purchase | Rate = actual PO rate for that specific PO line. |
| Expensive spare | Rate = actual PO rate. No averaging with other stock. |
| Returned FG reuse | Rate = management-approved carrying value. Documented and approved. |

### 25.5 Process Order Costing

Process order collects all cost elements:

```
Process Order Cost =
  Raw material issues (at weighted average or direct batch rate)
+ Packing material issues (at weighted average or direct batch rate)
+ Consumables issues
+ Reusable input (returned FG or reuse stock) at approved carrying value
+ Direct additional costs (freight, processing charges if any)
─────────────────────────────────────────────────────────────
= Total Process Order Cost

FG Actual Cost per Unit =
  Total Process Order Cost ÷ Actual FG Output Quantity

Production Loss / Wastage =
  (Planned Output − Actual Output) × Expected Cost per Unit
```

### 25.6 Costing Policy Assignment

| Object | Where Valuation Method is Stored |
|---|---|
| Raw material | Material master — valuation method field |
| Packing material | Material master — valuation method field |
| Consumable | Material master — valuation method field |
| Spare part | Material master — typically DIRECT_BATCH_COST |
| FG | Always ACTUAL_PROCESS_COST |
| Scrap | Always SCRAP_VALUE |
| Returned FG for reuse | MANUAL_APPROVED_COST — per reuse event |

### 25.7 Opening Stock Valuation

Opening stock must include both quantity and value. The opening rate becomes the starting valuation rate.

| Stock Type | Valuation Approach |
|---|---|
| UNRESTRICTED | Quantity × approved opening rate |
| QUALITY_INSPECTION | Quantity × approved opening rate (pre-QA decision) |
| BLOCKED | Quantity × approved opening rate |

Opening rate source options:
- Last purchase price
- Weighted average as of cut-off date
- Management-approved rate
- Auditor-approved rate

Opening rate must be approved before the 561/563/565 posting.

### 25.8 PID Valuation Impact

| Movement | Value Impact |
|---|---|
| 701 — Physical Inventory Gain | + Quantity × current valuation rate |
| 702 — Physical Inventory Loss | − Quantity × current valuation rate |

PID adjustments affect both quantity and value. The new weighted average is recalculated after the posting.

### 25.9 Returned FG Reuse Valuation

When a customer returns FG and it is approved for reuse in another product:

1. Return received via 651 → RETURNED stock bucket.
2. QA decision: approved for reuse.
3. Movement 901 (PACE custom): RETURNED → REUSE_HOLD.
4. Management approves carrying value for this reuse batch.
5. Process order inputs this reuse stock at the approved carrying value (MANUAL_APPROVED_COST).
6. Process order cost is updated with this value.
7. FG actual cost of the new batch includes this reuse input cost.
8. Full traceability: returned batch → reuse approval → process order → new FG batch.

### 25.10 Valuation Reports Required

| Report | Description |
|---|---|
| Stock Valuation Report | Current stock quantity + value by material + plant + stock type |
| Material Movement Value Report | Value impact of each movement type |
| Process Order Cost Report | Planned vs actual cost per process order |
| FG Costing Report | Actual cost per FG unit by batch/process order |
| Weighted Average Rate History | Rate changes over time per material |
| PID Adjustment Value Report | Value impact of all 701/702 postings |
| Returned FG Reuse Valuation Report | Traceability and value of returned FG reuse |
| Opening Stock Valuation Audit Report | Complete opening stock with rates and approval trail |

---

*— End of Part D —*

---

# PART E — GO-LIVE & MIGRATION STRATEGY

---

## Section 26 — Go-Live Timeline

### 26.1 Critical Dates

| Date | Event |
|---|---|
| 1 May 2026 | Today — Document started. Discovery begins. |
| 31 May 2026 | Design freeze deadline. All design decisions must be locked. |
| 15 June 2026 | All master data templates ready. Migration templates ready. |
| 25 June 2026 | Trial migration complete. All flows tested. |
| 30 June 2026 | Business cut-off day. Physical stock count. Final PO balance. Final in-transit capture. |
| 1 July 2026 | Go-live. Opening stock posted. Legacy POs activated. New transactions begin. |
| After 1 July 2026 | Corrections only via PID / 701 / 702. No manual edits. |

### 26.2 This is Not a Fresh Company Implementation

This is a **running business migration**. Plants have been operating for 6+ years. This means:

- Opening stock is not zero
- Open POs exist with partial receipts
- Import and domestic consignments are in transit
- Gate entries and GRNs are pending
- QA decisions are pending
- PO number series must continue — not restart
- Business processes must not be disrupted on Day 1

Every design decision must account for this reality.

---

## Section 27 — 1 July 2026 Go-Live Readiness Plan

### 27.A — By 31 May 2026: Design Freeze

| Item | Owner | Status Target |
|---|---|---|
| Complete discovery — Round 1 through final | Architect + Business Owner | DONE |
| Freeze operation design scope | Architect + Business Owner | FROZEN |
| Freeze master data structures | Architect | FROZEN |
| Freeze movement type master | Architect + SA | FROZEN |
| Freeze stock type model | Architect + SA | FROZEN |
| Freeze storage location model | Business Owner + SA | FROZEN |
| Freeze costing policy per material category | Business Owner | FROZEN |
| Freeze opening stock migration method | Architect | FROZEN |
| Freeze legacy PO migration method | Architect | FROZEN |
| Freeze number series method | Business Owner + SA | FROZEN |
| Freeze plant transfer design | Architect | FROZEN |
| Freeze GST future-readiness placeholders | Architect | FROZEN |
| Freeze approval matrix | Business Owner | FROZEN |
| Freeze BOM / formula design | Architect | FROZEN |
| Freeze process order design | Architect | FROZEN |
| Freeze dispatch design | Architect | FROZEN |

### 27.B — By 15 June 2026: Templates Ready

| Template | Content | Owner |
|---|---|---|
| Material master template | Code, name, category, base UOM, purchase UOM, valuation method, planning mode, QA flag | Stores / Procurement |
| Material plant extension template | Material + plant + storage locations + QA flag | Stores manager |
| Supplier master template | Code, name, type, GSTIN, PAN, payment terms | Procurement |
| Supplier-material source template | Supplier + material + plant + valid dates | Procurement |
| Customer master template | Code, name, type, GSTIN, address | Sales |
| UOM conversion template | Material + from UOM + to UOM + factor | Stores |
| Storage location template | Location code + name + plant + allowed stock types | SA / Stores |
| Opening stock template | Material + plant + location + stock type + UOM + qty + rate + value + batch | Stores + Finance |
| Open PO migration template | PO number + supplier + material + plant + original qty + received qty + balance qty + rate | Procurement |
| In-transit template | Consignment ref + PO ref + supplier + material + qty + ETD + ETA + transport details | Procurement |
| Number series template | Company + section + doc type + FY + prefix + last used number | SA / Procurement |
| Cost center template | Code + name + company + plant | Finance / SA |

### 27.C — By 25 June 2026: Trial Migration

| Trial Activity | What to Verify |
|---|---|
| Trial opening stock upload | All materials post correctly at correct storage location and stock type. Values match. |
| Trial open PO migration | PO numbers preserved. Remaining quantities correct. |
| Trial in-transit migration | In-transit quantities correct. Not mixed with opening stock. |
| Trial GR flow on migrated PO | GRN against a migrated open PO works correctly. |
| Trial QA decision flow | QA release posts 321 correctly. QA reject posts 553 correctly. |
| Trial PO number generation | Next PO number continues from last used legacy number. |
| Trial stock ledger reports | Opening + receipts − issues = closing. Equation balances. |
| Trial costing reports | Weighted average calculates correctly after first GR. |
| Trial plant transfer flow | Stock-in-transit bucket created correctly. Target receipt works. |
| Trial PID flow | PID document → count → difference → 701/702 posting. |
| Trial dispatch flow | FG dispatch reduces FG stock via 601. |
| Reconciliation check | Opening stock + open PO + in-transit totals match old business records. |

### 27.D — On 30 June 2026: Business Cut-Off

| Activity | Owner | Deadline |
|---|---|---|
| Business cut-off declaration | Management | EOD 30 June |
| Physical stock count — all plants | Stores managers | Completed by 30 June |
| Closing stock finalized per plant | Stores + Finance | Approved by 30 June |
| Open PO balance finalized | Procurement | Approved by 30 June |
| In-transit position finalized | Procurement | Approved by 30 June |
| Pending GR/QA list finalized | Stores + QA | Approved by 30 June |
| Last PO number counter per series finalized | Procurement + SA | Documented by 30 June |
| Reconciliation sign-off | Finance + Management | Approved by 30 June |
| Management approval for go-live | Management | Signed off by 30 June |

### 27.E — On 1 July 2026: Go-Live Execution

| Activity | Sequence | Owner |
|---|---|---|
| Open PACE-ERP for go-live batch | 1 | SA |
| Activate number series in PACE | 2 | SA |
| Activate storage locations | 3 | SA |
| Activate movement type master | 4 | SA |
| Upload and activate master data | 5 | Stores + Procurement |
| Post opening stock (561/563/565) | 6 | Stores manager + Finance |
| Activate legacy open POs | 7 | Procurement |
| Activate in-transit consignments | 8 | Procurement |
| Verify opening stock report = 30 June closing stock | 9 | Finance |
| First live PO generation test | 10 | Procurement |
| First live GRN test | 11 | Stores |
| Open for normal business operations | 12 | All |

### 27.F — After 1 July 2026: Control Rules

| Rule | Detail |
|---|---|
| Opening stock correction | Only via PID / 701 / 702 after management approval. No re-upload. |
| PO number change | Forbidden. Number series is locked. |
| Direct stock edit | Absolutely forbidden. |
| Legacy data correction | Only via controlled transactions with audit trail. |
| New master data | Can be added via normal ACL user flow. |
| Report source | Stock ledger only. No manual calculations. |

---

## Section 28 — Cut-off Strategy: 30 June 2026 to 1 July 2026

### 28.1 Cut-off Rule

> 30 June 2026 closing stock = 1 July 2026 opening stock.

This means:
- Stock physically present and accepted into a valid stock bucket on 30 June = opening stock.
- Stock in transit on 30 June = in-transit migration (NOT opening stock).
- Stock received but pending GRN on 30 June = pending GRN migration (NOT opening stock).
- Stock received and GRN done but QA pending on 30 June = pending QA migration.

### 28.2 Cut-off Categories

| Category | Definition | Migration Method |
|---|---|---|
| Opening stock | Physically present, accepted, GRN done, QA released (or QA not required) as of 30 June | 561 / 563 / 565 posting |
| Opening stock — QA hold | GRN done, in QA inspection bucket as of 30 June | 563 posting (QUALITY_INSPECTION) |
| Opening stock — blocked | GRN done, in blocked stock as of 30 June | 565 posting (BLOCKED) |
| Legacy open PO | PO placed, not fully received as of 30 June | Open PO migration |
| Legacy in-transit | Dispatched by supplier, not yet arrived at plant as of 30 June | In-transit migration |
| Pending gate entry | Vehicle arrived at gate, gate entry not done as of 30 June | Pending gate migration |
| Pending GRN | Gate entry done, GRN not posted as of 30 June | Pending GRN migration |
| Pending inward QA | GRN done, QA decision not taken as of 30 June | Pending QA migration |
| Pending vendor return | Return initiated, not yet completed as of 30 June | Pending return migration |

### 28.3 What Must NOT Be Mixed

| Forbidden Mix | Why |
|---|---|
| In-transit quantity + opening stock | Double counting. In-transit is not yet physically received. |
| Pending GRN + opening stock | Stock is at gate but not accepted into stores. Cannot be opening stock. |
| Pending QA + unrestricted opening stock | QA not cleared. Must be in QA bucket, not unrestricted. |
| Open PO pending qty + opening stock | Open PO quantity has not arrived. Cannot be stock. |

---

## Section 29 — Opening Stock Migration Strategy

### 29.1 Opening Stock Migration Flow

```
Step 1: Physical stock count at all plants on 30 June 2026
       ↓
Step 2: Stores prepare opening stock register
        (Material + Plant + Storage Location + Stock Type + UOM + Qty + Rate + Value)
       ↓
Step 3: Finance validates rates and values
       ↓
Step 4: Upload opening stock draft into PACE (DRAFT status)
       ↓
Step 5: System validates:
        - Material plant extension active?
        - Storage location valid for material?
        - Stock type valid?
        - UOM conversion valid?
        - No duplicate lines?
        - Quantity > 0?
        - Rate and value present?
       ↓
Step 6: Validation errors reported → corrected
       ↓
Step 7: Opening stock draft reviewed by stores manager + finance
       ↓
Step 8: Approval by management / authorized approver
       ↓
Step 9: On 1 July 2026 — posting via 561 / 563 / 565
       ↓
Step 10: Stock ledger rows created
         Current stock snapshot updated
         Audit entry created
       ↓
Step 11: Opening stock report generated and reconciled
       ↓
Step 12: Opening stock LOCKED — no further edit allowed
```

### 29.2 Opening Stock Upload Template Fields

| Field | Mandatory | Notes |
|---|---|---|
| Company code | Yes | Must match master |
| Plant code | Yes | Must match master |
| Storage location code | Yes | Must be active at plant |
| Material code | Yes | Must have active plant extension |
| Stock type | Yes | UNRESTRICTED / QUALITY_INSPECTION / BLOCKED |
| Batch / lot number | If batch required | Must match batch requirement flag |
| Base UOM | Yes | Must match material base UOM |
| Quantity | Yes | > 0 |
| Opening rate (per base UOM) | Yes | In company currency |
| Opening value | Yes | = Quantity × Opening rate |
| Valuation method | Yes | Must match material master |
| Remarks | Optional | Source of rate, reference |

### 29.3 Opening Stock Validation Rules

| Validation | Action on Failure |
|---|---|
| Material not active | Reject line with error |
| Material plant extension not active | Reject line with error |
| Storage location not active | Reject line with error |
| Stock type not in stock type master | Reject line with error |
| UOM mismatch | Reject line with error |
| Batch required but missing | Reject line with error |
| Quantity ≤ 0 | Reject line with error |
| Rate or value missing | Reject line with error |
| Duplicate line (same material + plant + location + stock type + batch) | Reject duplicate with error |
| Value ≠ Quantity × Rate (tolerance ±0.01) | Warning — require confirmation |

### 29.4 Opening Stock Lock Rule

After opening stock is posted on 1 July 2026:
- Opening stock document is LOCKED.
- No line can be edited, deleted, or reposted.
- Any correction after go-live must go through PID (701/702) with approval.
- This is a constitutional requirement — no direct stock edit.

---

## Section 30 — Legacy Open PO Migration Strategy

### 30.1 Why Legacy PO Migration is Critical

Your plants have been running for years. On 30 June 2026 there will be:
- POs fully open (zero received)
- POs partially received (some qty received, balance pending)
- POs with multiple line items at different receipt stages

All of these must continue in PACE-ERP from 1 July 2026 without business disruption.

### 30.2 Legacy PO Migration Rule

**The golden rule:**

> If a PO had 1000 KG ordered and 600 KG was received before cut-off (and 600 KG is in opening stock), then only 400 KG should be migrated as open PO balance.

Do not bring 1000 KG as opening stock AND 1000 KG as open PO. That is double counting.

### 30.3 Legacy PO Balance Calculation

```
For each PO line:

Legacy Open Balance = Original PO Quantity
                    − Total Received Quantity (up to 30 June 2026)
                    − Total Cancelled/Rejected Quantity

If Legacy Open Balance > 0 → Migrate as open PO
If Legacy Open Balance = 0 → PO is complete. Do not migrate.
If Legacy Open Balance < 0 → Data error. Investigate before migration.
```

### 30.4 Legacy Open PO Migration Flow

```
Step 1: Extract open PO list from current system as of 30 June
       ↓
Step 2: For each PO line, calculate open balance quantity
       ↓
Step 3: Prepare migration template
       ↓
Step 4: Upload into PACE as Legacy PO (special migration document type)
       ↓
Step 5: System validates:
        - PO number format valid for company/section?
        - Supplier active in PACE?
        - Material active in PACE?
        - Material plant extension active?
        - Open balance > 0?
        - UOM valid?
        - Rate present?
       ↓
Step 6: Validation errors corrected
       ↓
Step 7: Approval by procurement manager
       ↓
Step 8: On 1 July 2026 — Legacy POs activated in PACE
       ↓
Step 9: Legacy POs appear in procurement planning as open PO quantities
       ↓
Step 10: New GRNs against these POs can proceed normally
```

### 30.5 Legacy Open PO Migration Template Fields

| Field | Mandatory | Notes |
|---|---|---|
| Company code | Yes | |
| Business section code | Yes | Determines number series |
| Original PO number | Yes | Preserved exactly — legacy number |
| PO date | Yes | Original PO date |
| Supplier code | Yes | Must be active in PACE |
| Material code | Yes | Must have active plant extension |
| Plant code | Yes | |
| Storage location (expected) | Optional | Default GRN location |
| Original ordered quantity | Yes | In purchase UOM |
| Already received quantity | Yes | Before cut-off |
| Open balance quantity | Yes | = Original − Received |
| Purchase UOM | Yes | |
| PO unit rate | Yes | In company currency |
| Expected delivery date | Optional | |
| Consignment reference | Optional | If in-transit linked |
| PO status | Yes | OPEN / PARTIAL |
| Remarks | Optional | |

### 30.6 Partial PO Handling

For partially received POs:
- The received quantity is already in opening stock (via 561).
- Only the balance quantity is migrated as open PO.
- In PACE, the migrated PO will show:
  - Original quantity: X
  - Already received: Y (pre-migration history)
  - Pending balance: Z = X − Y
- New GRNs against this PO will reduce the pending balance.

---

## Section 31 — Legacy In-Transit Consignment Migration

### 31.1 What is In-Transit at Cut-off?

In-transit consignments are materials that were dispatched by the supplier before 30 June 2026 but have not yet arrived at the plant gate. These are:
- Not part of opening stock (not physically received)
- Not part of open PO balance (supplier has already dispatched)
- They are a separate category: **stock-in-transit**

### 31.2 In-Transit Types

| Type | Description |
|---|---|
| Domestic in-transit | Supplier in India has dispatched. LR number exists. Vehicle in transit. |
| Import in-transit | Foreign supplier has shipped. Bill of lading exists. Customs clearance pending or in progress. |
| Import — at port / CFS | Material arrived at port. Customs clearance pending. Not yet at plant. |
| Import — cleared, road transit | Customs cleared. Road transport to plant underway. |

### 31.3 In-Transit Migration Flow

```
Step 1: Procurement identifies all in-transit consignments as of 30 June
       ↓
Step 2: For each consignment, capture all details
       ↓
Step 3: Prepare in-transit migration template
       ↓
Step 4: Upload into PACE as Migrated In-Transit Consignment
       ↓
Step 5: In PACE, these appear in:
        - Consignment tracker (status: IN_TRANSIT)
        - Procurement planning (expected receipt)
        - Stock-in-transit logical bucket
       ↓
Step 6: When material arrives after 1 July:
        → Gate entry done in PACE
        → GRN posted in PACE (305 or 101 depending on transfer type)
        → Stock ledger updated
        → In-transit bucket reduced
        → Plant stock increased
```

### 31.4 In-Transit Migration Template Fields

| Field | Mandatory | Notes |
|---|---|---|
| Company code | Yes | |
| Business section code | Yes | |
| PO number reference | Yes | Links to migrated open PO |
| Consignment reference number | Yes | Internal tracking reference |
| Supplier code | Yes | |
| Supplier invoice / packing list ref | Optional | |
| Material code | Yes | |
| Plant code (destination) | Yes | |
| In-transit quantity | Yes | In purchase UOM |
| Purchase UOM | Yes | |
| Consignment type | Yes | DOMESTIC / IMPORT |
| Transport mode | Yes | ROAD / SEA / AIR / RAIL |
| Transporter name | Optional | |
| LR number / Bill of Lading | Yes | |
| Dispatch date from supplier | Yes | |
| ETD (if import) | Optional | |
| ETA at plant | Yes | Expected arrival date |
| Import — customs status | If import | PENDING / IN_PROGRESS / CLEARED |
| Remarks | Optional | |

### 31.5 In-Transit Reconciliation Rule

```
For each PO line:

Original PO Qty = Opening Stock (received before cut-off)
               + In-Transit Qty (dispatched, not yet received)
               + Open PO Balance (not yet dispatched by supplier)

These three must sum to Original PO Qty.
Any discrepancy must be investigated before migration is approved.
```

---

## Section 32 — Pending Gate Entry / GR / QA Migration

### 32.1 Pending Gate Entry

Material has arrived at the plant gate on or before 30 June but gate entry is not yet completed.

**Migration approach:**
- These vehicles are physically at the gate.
- On 1 July, the gate entry is completed in PACE as a normal gate entry.
- GRN follows normally.
- No special migration document needed — process continues normally in PACE.
- Procurement team must flag these for immediate processing on 1 July.

### 32.2 Pending GRN

Gate entry done before cut-off but GRN not yet posted.

**Migration approach:**
- Gate entry reference exists.
- On 1 July, GRN is completed in PACE against the migrated open PO.
- Gate entry reference is noted in remarks.
- Stock lands in correct plant + storage location.
- This is not opening stock — it is a live transaction completed on 1 July.

### 32.3 Pending Inward QA

GRN posted before cut-off but QA decision not yet taken.

**Migration approach:**
- These materials are in QA store / QUALITY_INSPECTION bucket.
- They are included in opening stock as QUALITY_INSPECTION stock (via 563).
- On 1 July, QA team makes usage decision in PACE.
- If released: 321 movement → UNRESTRICTED.
- If rejected: 553 movement → SCRAP or 122 → vendor return initiated.

### 32.4 Pending Vendor Return

Return to vendor initiated before cut-off but not yet completed.

**Migration approach:**
- The stock under return must NOT be included in opening stock.
- It should be captured as BLOCKED or RETURNED stock in opening stock (via 565).
- Return process is completed in PACE after go-live via 122 movement.
- Procurement team must track and close these returns promptly after go-live.

---

## Section 33 — Existing PO Number Series Continuity

### 33.1 Why Number Series Continuity is Critical

Your business has existing PO numbers that suppliers know, accounts reference, and legal documents carry. If PACE resets the counter to 1 or uses a different format, it breaks:
- Supplier communication
- Finance reconciliation
- Legal/audit trail
- Business continuity

PACE must continue from the last used number without any gap.

### 33.2 Known Number Series Formats

| Company | Section | Format | Example | FY-based? |
|---|---|---|---|---|
| CMP003 | Admix Section | AC/RP{NNN}/YYYY-YY | AC/RP124/2026-27 | Yes |
| CMP003 | Powder Section | ASC/PO{NNN}/YYYY-YY | ASC/PO077/2026-27 | Yes |
| CMP010 | (to confirm) | Ji/PO{NNN}/YYYY | Ji/PO210/2026 | Year only |

### 33.3 Number Series Continuity Rule

```
If last PO on 30 June 2026 for CMP003 Admix = AC/RP124/2026-27
Then first new PACE PO on 1 July 2026 = AC/RP125/2026-27

If last PO on 30 June 2026 for CMP003 Powder = ASC/PO077/2026-27
Then first new PACE PO on 1 July 2026 = ASC/PO078/2026-27

If last PO on 30 June 2026 for CMP010 = Ji/PO210/2026
Then first new PACE PO on 1 July 2026 = Ji/PO211/2026
```

### 33.4 Number Series Design in PACE

Each number series is defined by:

| Attribute | Description |
|---|---|
| Company | CMP003, CMP010 etc. |
| Business section | Admix, Powder, etc. |
| Document type | PO, PR, GRN, Dispatch, Transfer, PID etc. |
| Financial year | 2026-27, 2027-28 etc. |
| Prefix | AC/RP, ASC/PO, Ji/PO etc. |
| Number format | NNN, NNNN etc. (number of digits) |
| Suffix | /YYYY-YY or /YYYY etc. |
| Current counter | Last used number |
| Next number | Current counter + 1 |
| Status | ACTIVE / INACTIVE |

### 33.5 Number Series Rules

1. SA defines the number series structure. ACL users cannot modify it.
2. Numbers are system-generated. Users cannot manually type a new PO number except in legacy migration mode.
3. Legacy migration mode is a one-time controlled import — SA-authorized.
4. Once legacy POs are loaded and the counter is set, normal mode begins.
5. In normal mode, next number is auto-assigned at PO creation.
6. Counter is locked — cannot be rolled back without SA approval.
7. FY change: new FY = counter resets to 1 (or configured start). This is automatic on FY boundary.
8. Legacy PO numbers are preserved exactly — they are imported with their original numbers, not renumbered.

### 33.6 Number Series for Other Documents

Number series is not only for POs. All documents need series:

| Document Type | Scope |
|---|---|
| Purchase Requirement (PR) | Company + Section + FY |
| Purchase Order (PO) | Company + Section + FY |
| GRN | Company + Plant + FY |
| Gate Entry | Company + Plant + FY |
| Quality Decision | Company + Plant + FY |
| Process Order | Company + Plant/Section + FY |
| Dispatch Instruction | Company + Section + FY |
| Delivery / Goods Issue | Company + Plant + FY |
| Plant Transfer Order | Company + FY |
| PID Document | Company + Plant + FY |
| Stock Document | Company + Plant + Movement Type range + FY |

---

## Section 34 — Cut-off Reconciliation Checklist

This reconciliation must be completed and signed off before go-live posting on 1 July 2026.

### 34.1 Per Material / Per Plant Reconciliation

For each material at each plant, the following must reconcile:

```
Physical closing stock on 30 June (A)
= Opening stock to be posted in PACE (B)
+ Pending QA stock (C) [to be posted as QUALITY_INSPECTION]
+ Pending blocked stock (D) [to be posted as BLOCKED]

Total stock = B + C + D = A ✓

Open PO balance quantity (E)
+ In-transit quantity (F)
+ Opening stock (A)
= Original PO ordered quantity for all open POs (G)

Verify: E + F + A = G ✓ (allowing for POs placed before legacy history)
```

### 34.2 Reconciliation Checklist Items

| # | Check | Verified By | Sign-off |
|---|---|---|---|
| 1 | All plants physically counted on 30 June | Stores manager | |
| 2 | Opening stock register matches physical count | Stores + Finance | |
| 3 | Opening stock value approved (rate × qty) | Finance | |
| 4 | No in-transit quantity included in opening stock | Procurement | |
| 5 | No pending GRN quantity included in opening stock | Stores | |
| 6 | Pending QA stock in QUALITY_INSPECTION bucket only | QA | |
| 7 | Blocked stock in BLOCKED bucket only | Stores | |
| 8 | Open PO balance = Original PO qty − Already received qty | Procurement | |
| 9 | In-transit consignments listed and quantities confirmed | Procurement | |
| 10 | Opening stock + Open PO + In-transit does not double-count | Finance | |
| 11 | Last PO number per series documented and verified | Procurement + SA | |
| 12 | All pending vendor returns captured as BLOCKED or RETURNED | Procurement | |
| 13 | Batch/lot details captured for batch-tracked materials | Stores | |
| 14 | UOM conversions verified for all materials | Stores | |
| 15 | Trial migration completed and reports verified | Architect | |
| 16 | Opening stock valuation rates approved by Finance | Finance + Management | |
| 17 | Management sign-off on entire reconciliation | Management | |

### 34.3 Reconciliation Failure Rule

If reconciliation fails for any material or plant:
- Go-live for that material/plant is paused.
- The discrepancy is investigated and corrected.
- Re-reconciliation is done.
- Management re-approves.
- Only then is opening stock posted for that material/plant.

**Partial go-live (some materials ready, others not) must be planned for.**

---

*— End of Part E —*

---

# PART F — PROCUREMENT CYCLE

---

## Section 35 — Centralized Procurement Planning

### 35.1 How Procurement Works in Your Business

Procurement is centralized. One procurement wing manages purchasing for all plants. They:
- View stock across all plants simultaneously
- Identify material shortages plant-wise
- Create purchase requirements
- Create, amend, and cancel POs
- Issue POs to suppliers
- Track every consignment (ETD/ETA)
- Manage both import and domestic procurement

This is a critical design requirement. The procurement planning view must be cross-plant and cross-company where the user has ACL scope.

### 35.2 Procurement Planning View

The planning view answers the question: **"What do I need to buy, for which plant, and how much?"**

```
For each material + plant combination:

Current Unrestricted Stock          (A)
+ Current QA Stock (expected pass)  (B)
+ Open PO pending quantity          (C)  [not yet received]
+ In-transit quantity               (D)  [dispatched, en route]
- Reserved stock                    (E)  [reserved for process orders]
- Scheduled dispatch stock          (F)  [committed to customers]
- Planned production requirement    (G)  [from open/planned process orders]
- Safety stock minimum              (H)  [configured in material plant ext.]
─────────────────────────────────────────────────
= Net Available / Shortage          (I)

If I < 0 → Shortage → PR may be needed
If I > 0 → Surplus or sufficient
```

### 35.3 Planning View Fields

| Field | Description |
|---|---|
| Material | Material code + name |
| Plant | Plant |
| Current unrestricted stock | From current stock snapshot |
| Current QA stock | From current stock snapshot |
| Open PO quantity | Sum of pending PO balances |
| In-transit quantity | Sum of migrated + live in-transit |
| Reserved quantity | From active process order reservations |
| Scheduled dispatch | From active dispatch instructions |
| Planned production req. | From planned/released process orders |
| Safety stock | From material plant extension |
| Net available / shortage | Calculated |
| Last GR date | From stock ledger |
| Average consumption | Calculated from last N days (configurable) |
| Suggested PR quantity | Shortage + safety stock buffer |

### 35.4 Planning Mode by Material

| Planning Mode | How Requirement is Determined |
|---|---|
| FIXED_BOM | BOM explosion from planned production orders → material requirement |
| ADMIX_ACTUAL | Historical consumption, min-max, management plan, expected production volume |
| HYBRID | BOM explosion + manual adjustment allowed |
| TRADING | Sales order driven — no production |
| NON_PRODUCTION | Min-max / manual |

### 35.5 Procurement Planning Authority

| Action | Who Can Do |
|---|---|
| View cross-plant planning | Authorized procurement planner (ACL) |
| Create PR from planning | Procurement planner |
| Approve PR | Procurement manager |
| Create PO from PR | Procurement user |
| View supplier-wise open position | Procurement user |
| View consignment status | Procurement user |
| Close completed POs | Procurement manager |

---

## Section 36 — Purchase Requirement (PR) Design

### 36.1 What is a PR?

A Purchase Requirement (PR) is the formal internal document that requests procurement to buy a material. It may be generated:
- Manually by stores / production team
- Automatically from procurement planning view (semi-auto in Phase-1)
- From BOM explosion of a production plan

### 36.2 PR Lifecycle

```
DRAFT → PENDING_APPROVAL → APPROVED → PO_CREATED → CLOSED / CANCELLED
                         ↓
                      REJECTED → (creator amends and resubmits)
```

### 36.3 PR Header Fields

| Field | Description | Mandatory |
|---|---|---|
| PR number | System-generated (company + section + FY series) | Yes |
| PR date | Date of creation | Yes |
| Company | Company scope | Yes |
| Business section | Section scope | Yes |
| Plant | For which plant | Yes |
| Required by date | When material is needed | Yes |
| PR type | PRODUCTION / MAINTENANCE / PROJECT / GENERAL | Yes |
| Priority | NORMAL / URGENT / CRITICAL | Yes |
| Created by | ACL user | Yes |
| Approval status | DRAFT / PENDING / APPROVED / REJECTED | Yes |

### 36.4 PR Line Fields

| Field | Description | Mandatory |
|---|---|---|
| Line number | Sequential | Yes |
| Material code | Reference to material master | Yes |
| Plant | Target plant for this line | Yes |
| Storage location | Expected storage location | Optional |
| Required quantity | In purchase UOM | Yes |
| Purchase UOM | | Yes |
| Required by date | Line-level date | Optional |
| Preferred supplier | From approved source list | Optional |
| Budget reference | Cost center / project | Optional |
| BOM reference | If auto-generated from BOM explosion | Optional |
| Status | OPEN / PO_CREATED / CLOSED / CANCELLED | Yes |

### 36.5 PR → PO Conversion

- One PR can become one or multiple POs (split by supplier or delivery date).
- One PO can cover multiple PRs (consolidated purchase).
- PR line status updates when PO is created against it.
- PR is closed when all lines have POs or are cancelled.

---

## Section 37 — PO Lifecycle Design

### 37.1 PO States

```
DRAFT
  ↓
PENDING_APPROVAL
  ↓
APPROVED
  ↓
ISSUED (sent to supplier)
  ↓
PARTIALLY_RECEIVED (first GRN done, balance open)
  ↓
FULLY_RECEIVED (all lines received)
  ↓
CLOSED (confirmed closed — no more receipts expected)
  ↓
CANCELLED (before any receipt)
```

### 37.2 PO Header Fields

| Field | Description | Mandatory |
|---|---|---|
| PO number | System-generated. Company + section + FY series. | Yes |
| PO date | Date of creation | Yes |
| Company | Company scope | Yes |
| Business section | Section (determines number series) | Yes |
| Supplier | Reference to supplier master | Yes |
| Plant | Delivery plant | Yes |
| Delivery address | Plant address or specific location | Yes |
| Currency | INR / USD / EUR etc. | Yes |
| Payment terms | Credit days, method | Yes |
| Expected delivery date | Overall PO delivery | Yes |
| PO type | DOMESTIC / IMPORT | Yes |
| PR reference | If generated from PR | Optional |
| Consignment reference | Auto-created on approval | System |
| Approval status | DRAFT / PENDING / APPROVED | Yes |
| PO status | DRAFT / ISSUED / PARTIAL / COMPLETE / CLOSED / CANCELLED | Yes |
| Version number | Increments on amendment | Yes |
| Remarks | | Optional |

### 37.3 PO Line Fields

| Field | Description | Mandatory |
|---|---|---|
| Line number | Sequential | Yes |
| Material code | Must have plant extension + supplier source | Yes |
| Material description | Auto-filled from master | Yes |
| Ordered quantity | In purchase UOM | Yes |
| Purchase UOM | | Yes |
| Base UOM equivalent | Auto-calculated | System |
| Unit rate | Price per purchase UOM | Yes |
| Line value | Quantity × rate | System |
| GST rate (placeholder) | For future GST | Optional |
| Expected delivery date | Line-level | Optional |
| Storage location | Expected GRN location | Optional |
| QA required | From material plant extension | System |
| Received quantity | Updated as GRNs are posted | System |
| Balance quantity | Ordered − Received | System |
| Line status | OPEN / PARTIAL / COMPLETE / CANCELLED | System |

### 37.4 PO Validation Rules at Creation

| Validation | Action on Failure |
|---|---|
| Supplier not active | Reject |
| Supplier-material source not active for this plant | Reject |
| Approved source list — supplier blocked or expired | Reject |
| Material plant extension not active | Reject |
| Quantity ≤ 0 | Reject |
| Rate ≤ 0 | Reject |
| Expected delivery date in past | Warning |
| Duplicate PO line (same material + plant) | Warning — allow with confirmation |

### 37.5 PO Issue to Supplier

After approval, PO can be issued (PDF / email). The PO document must contain:
- PO number and date
- Supplier details
- Material details, quantity, rate, value
- Delivery address
- Payment terms
- GST placeholder fields (GSTIN, HSN, tax rate — for future use)
- Authorized signatory

---

## Section 38 — PO Amendment and Cancellation

### 38.1 PO Amendment

A PO can be amended after approval. Each amendment creates a new version.

**Amendable fields:**
- Quantity (increase or decrease — subject to rules)
- Unit rate
- Expected delivery date
- Payment terms
- Remarks

**Non-amendable fields:**
- Supplier (cannot change supplier on existing PO — cancel and create new)
- Material (cannot change material on existing line — cancel line and add new)
- Company / Plant / Section

**Amendment Rules:**
- Quantity can be reduced only down to already received quantity. Cannot reduce below received qty.
- Quantity increase: standard amendment, requires re-approval.
- Rate change: requires re-approval regardless of direction.
- Each amendment is version-stamped (V1, V2, V3...).
- Supplier receives amended PO with version number.
- Amendment reason is mandatory.
- Full version history is preserved in PACE — no version is deleted.

### 38.2 PO Amendment Lifecycle

```
APPROVED PO
    ↓
Amendment initiated by procurement user
    ↓
Amendment saved as new version (status: AMENDMENT_PENDING)
    ↓
Approval by procurement manager
    ↓
APPROVED (V2, V3 etc.)
    ↓
Amended PO issued to supplier
```

### 38.3 PO Cancellation

**Cancellation Rules:**
- PO can be cancelled only if no GRN has been posted.
- If partial GRN exists, only the remaining open lines can be cancelled.
- Cancellation reason is mandatory.
- Cancelled PO lines are not deleted — they remain with status CANCELLED.
- Consignment tracking linked to cancelled PO is also cancelled/closed.
- PR lines linked to cancelled PO revert to APPROVED status (available for new PO).

**Cancellation Approval:**
- Full PO cancellation requires procurement manager or senior approval.
- Partial line cancellation may be done by procurement user with procurement manager approval.

---

## Section 39 — Import and Domestic Consignment Tracking

### 39.1 Consignment Creation

A consignment is created automatically when a PO is approved. It represents the expected physical shipment.

One PO may have multiple consignments (e.g., supplier splits delivery into two shipments).
One consignment may cover lines from one PO.

### 39.2 Consignment Status Lifecycle

```
CREATED (on PO approval)
    ↓
CONFIRMED (supplier confirms dispatch schedule)
    ↓
DISPATCHED (supplier dispatches — ETD confirmed)
    ↓
IN_TRANSIT (material in motion)
    ↓
    [For import: AT_PORT → CUSTOMS_PENDING → CUSTOMS_CLEARED]
    ↓
ARRIVED (vehicle arrived at plant gate)
    ↓
GATE_ENTRY_DONE (security gate entry completed)
    ↓
GRN_PENDING (in stores, awaiting GRN posting)
    ↓
GRN_DONE (GRN posted)
    ↓
QA_PENDING (if QA required)
    ↓
QA_DONE (QA decision taken)
    ↓
CLOSED (all lines received and closed)
    ↓
PARTIALLY_CLOSED (some lines closed, some pending)
```

### 39.3 Consignment Header Fields

| Field | Description | Mandatory |
|---|---|---|
| Consignment reference | System-generated | Yes |
| PO reference | Linked PO number | Yes |
| Supplier | From PO | Yes |
| Company / Plant | From PO | Yes |
| Consignment type | DOMESTIC / IMPORT | Yes |
| Supplier dispatch date (ETD) | Date supplier dispatches | Yes |
| Expected arrival date (ETA) | Expected at plant gate | Yes |
| Transport mode | ROAD / SEA / AIR / RAIL | Yes |
| Transporter name | | Optional |
| LR number | For road transport | If domestic |
| Bill of Lading number | For sea/air import | If import |
| Vehicle number | | Optional |
| Supplier invoice reference | | Optional |
| Total consignment value | | Optional |
| Import — port of entry | | If import |
| Import — customs BE number | Bill of Entry | If import |
| Import — customs clearance date | | If import |
| Import — CHA details | Customs House Agent | If import |
| Current status | Lifecycle status | System |
| Delay flag | Auto if ETA passed and not arrived | System |
| Remarks | | Optional |

### 39.4 Consignment Tracking View for Procurement

The procurement team's consignment view shows:
- All open consignments across all plants (within ACL scope)
- Filter by status, supplier, material, plant, date range
- Overdue / delayed consignments highlighted
- Import consignments with customs status
- ETD vs ETA vs actual arrival tracking
- Linked PO and GRN status

---

## Section 40 — Security Gate Entry

### 40.1 What is Gate Entry?

Gate Entry is the security checkpoint record created when a vehicle carrying materials arrives at the plant gate. It is the first physical confirmation that a consignment has arrived.

Gate Entry → GRN is the mandatory sequence. No GRN without gate entry.

### 40.2 Gate Entry Flow

```
Vehicle arrives at plant gate
    ↓
Security / gate staff opens gate entry in PACE
    ↓
Supplier reference / PO number / consignment ref entered
    ↓
System shows expected materials from linked PO/consignment
    ↓
Gate staff records:
  - Vehicle number
  - Driver name
  - Transporter details
  - Physical document check (invoice, DC, LR)
  - Weigh bridge (if applicable)
    ↓
Materials in vehicle matched against PO (visual check)
    ↓
Any discrepancy flagged in gate entry remarks
    ↓
Gate entry saved → Gate Pass generated
    ↓
Vehicle allowed into premises
    ↓
Consignment status updated: ARRIVED → GATE_ENTRY_DONE
    ↓
Stores notified for GRN
```

### 40.3 Gate Entry Document Fields

| Field | Description | Mandatory |
|---|---|---|
| Gate entry number | System-generated | Yes |
| Gate entry date and time | | Yes |
| Plant | Which plant | Yes |
| PO reference | Linked PO | Yes |
| Consignment reference | Linked consignment | Yes |
| Supplier name | From PO | Yes |
| Vehicle number | | Yes |
| Driver name | | Optional |
| Transporter | | Optional |
| LR number | | Yes (if road) |
| Supplier invoice number | | Optional |
| Supplier DC number | | Optional |
| Weigh bridge in-weight | | If applicable |
| Materials preview | From PO lines | System |
| Discrepancy flag | Yes / No | Yes |
| Discrepancy remarks | If flag = Yes | Conditional |
| Gate pass number | System-generated | Yes |
| Time in | | Yes |
| Inward by | Gate staff ACL user | Yes |
| Status | OPEN / CLOSED | Yes |

### 40.4 Gate Entry Rules

1. Gate entry requires a valid linked PO. Unscheduled deliveries must have a special gate entry with mandatory reason and supervisor approval.
2. Gate entry cannot be backdated without approval.
3. Gate entry is informational — it does not post stock. Only GRN posts stock.
4. One gate entry can lead to one or more GRNs (if multi-material or split).
5. Gate entry is linked to consignment — consignment status updates automatically.

---

## Section 41 — Stores GR and Location-wise Receipt

### 41.1 GRN Flow

```
Gate Entry done (Gate Pass received by stores)
    ↓
Stores opens GRN in PACE
    ↓
Gate entry reference + PO reference linked
    ↓
System loads PO lines with pending balance quantity
    ↓
Stores enters received quantity per line
    ↓
Storage location selected (or defaulted from material plant ext.)
    ↓
UOM conversion applied automatically
    ↓
If material requires QA:
    → Stock lands in QUALITY_INSPECTION bucket
    → QA notification triggered
If material does not require QA:
    → Stock lands in UNRESTRICTED bucket
    ↓
GRN posted (Movement 101)
    ↓
Stock ledger updated
Current stock snapshot updated
PO received quantity updated
Consignment status → GRN_DONE / QA_PENDING
    ↓
GRN document created with unique number
```

### 41.2 GRN Header Fields

| Field | Description | Mandatory |
|---|---|---|
| GRN number | System-generated (company + plant + FY series) | Yes |
| GRN date | Posting date | Yes |
| Company | | Yes |
| Plant | | Yes |
| PO reference | Linked PO | Yes |
| Gate entry reference | Linked gate entry | Yes |
| Consignment reference | Linked consignment | Yes |
| Supplier | From PO | Yes |
| Supplier invoice number | | Optional |
| Supplier invoice date | | Optional |
| Received by | Stores ACL user | Yes |
| Status | DRAFT / POSTED / REVERSED | Yes |

### 41.3 GRN Line Fields

| Field | Description | Mandatory |
|---|---|---|
| Line number | | Yes |
| PO line reference | | Yes |
| Material | From PO | Yes |
| Storage location | Where material is placed | Yes |
| Received quantity | In purchase UOM | Yes |
| Purchase UOM | | Yes |
| Base UOM quantity | Auto-calculated | System |
| Movement type | 101 (auto) | System |
| Stock type | QUALITY_INSPECTION (if QA required) or UNRESTRICTED | System |
| Batch / lot | If batch tracking active | Conditional |
| Weigh bridge out-weight | If applicable | Optional |
| Actual weight | Net weight received | Optional |
| Shortage / excess vs PO | Calculated | System |
| Remarks | | Optional |

### 41.4 GRN Rules

1. GRN quantity cannot exceed PO pending balance quantity (configurable tolerance for over-delivery).
2. GRN always references a valid PO line — free-form GRN without PO is not allowed except for special cases (opening stock, legacy migration).
3. Multiple GRNs can be posted against one PO (partial deliveries).
4. GRN reversal (102) is allowed only with approval and reason, and only if QA decision has not yet been taken.
5. GRN date cannot be before gate entry date.
6. Storage location must be active for the material at the plant.
7. Batch number is mandatory if material has batch tracking flag = Yes.

---

## Section 42 — Inward Quality

### 42.1 Inward QA Flow

```
GRN posted → Stock in QUALITY_INSPECTION bucket
    ↓
QA team notified (or QA team pulls pending QA list)
    ↓
QA team opens QA decision in PACE
    ↓
QA team records inspection details:
  - Sample taken
  - Test results (optional Phase-1)
  - Observations
    ↓
Usage Decision:
  RELEASE → 321 → UNRESTRICTED stock
  PARTIAL RELEASE → 321 for release qty, remainder stays in QA or moves to BLOCKED/REJECTED
  BLOCK → 350 → BLOCKED stock (pending further decision)
  REJECT → material moves to REJECTED stock
  SCRAP → 553 → SCRAP stock (if QA decides immediate scrap)
    ↓
Stock ledger updated for each decision
    ↓
QA decision document created and locked
    ↓
Procurement notified (for rejected/blocked — vendor action required)
```

### 42.2 QA Decision Document Fields

| Field | Description | Mandatory |
|---|---|---|
| QA decision number | System-generated | Yes |
| QA decision date | | Yes |
| Company / Plant | | Yes |
| GRN reference | Linked GRN | Yes |
| Material | From GRN | Yes |
| Storage location | Current QA location | Yes |
| Batch / lot | If applicable | Conditional |
| QA stock quantity | Quantity under inspection | Yes |
| Decision | RELEASE / PARTIAL / BLOCK / REJECT / SCRAP | Yes |
| Release quantity | If partial or full release | Conditional |
| Block quantity | If partial or full block | Conditional |
| Reject quantity | If rejected | Conditional |
| Scrap quantity | If scrap | Conditional |
| Test result summary | | Optional Phase-1 |
| Rejection reason | If REJECT or BLOCK | Conditional |
| QA user | Who made decision | Yes |
| Approval by | QA manager (for REJECT/BLOCK) | Conditional |
| Status | PENDING / DECIDED / POSTED | Yes |

### 42.3 Post-QA Movement Summary

| QA Decision | Movement Type | From Stock Type | To Stock Type |
|---|---|---|---|
| Full release | 321 | QUALITY_INSPECTION | UNRESTRICTED |
| Partial release | 321 (for release qty) | QUALITY_INSPECTION | UNRESTRICTED |
| Block | 350 | QUALITY_INSPECTION | BLOCKED |
| Reject → vendor return | 122 | QUALITY_INSPECTION | Vendor (stock reduced) |
| Reject → scrap | 553 | QUALITY_INSPECTION | SCRAP |
| Re-inspection needed | No movement | QUALITY_INSPECTION | QUALITY_INSPECTION (remark updated) |

### 42.4 QA Rules

1. QA decision is required for every GRN line where material has QA flag = Yes.
2. Stock in QUALITY_INSPECTION cannot be issued to production until released.
3. QA rejection triggers procurement team notification automatically.
4. Vendor return after QA rejection uses movement 122 (Return to Vendor).
5. QA decision is a posted document — it cannot be edited after posting. Correction requires a new QA decision or reversal movement.
6. Material in BLOCKED status can be re-evaluated at any time by authorized QA / management.

---

## Section 43 — Raw Material, Packing Material, and Consumable Stock

### 43.1 Post-QA Stock Flow by Material Category

After inward QA, stock moves to UNRESTRICTED in the appropriate storage location:

| Category | Typical Flow |
|---|---|
| Raw Material | GRN → QA Store (QA_INSPECTION) → QA Release (321) → Main Store (UNRESTRICTED) |
| Packing Material | GRN → QA Store → QA Release → Packing Store (UNRESTRICTED) |
| Consumable | GRN → Main Store (UNRESTRICTED) — often no QA unless critical |
| Spare Part | GRN → Main Store → QA if required → UNRESTRICTED |
| Import Material | GRN (post customs) → QA Store → QA Release → UNRESTRICTED |

### 43.2 Stock Available for Production Issue

Only UNRESTRICTED stock can be issued to production via 261.

If material is in QUALITY_INSPECTION, BLOCKED, or REJECTED — it cannot be issued until:
- QA releases it (321 → UNRESTRICTED), or
- Management override with approval (exceptional cases only, audited)

### 43.3 Minimum Stock and Reorder

From material plant extension:
- **Safety stock**: below this level → procurement planning flags shortage
- **Reorder point**: below this level → automatic PR suggestion in planning view

These are advisory — final procurement decision is with procurement planner.

---

*— End of Part F —*

---

# PART G — PRODUCTION & BOM

---

## Section 44 — BOM / Formula Master

### 44.1 What is a BOM?

A Bill of Materials (BOM) defines the recipe or formula for producing a finished good or semi-finished good. It lists every input material, its quantity, and its role in the production process.

In PACE-ERP, BOM is the central planning and costing reference for all production. Three types of products use BOM differently:

| Production Mode | BOM Role |
|---|---|
| FIXED_BOM | BOM is fixed. Procurement and production are BOM-driven. Deviation requires approval. |
| ADMIX_ACTUAL | No fixed BOM. Actual formula is captured per process order at execution. |
| HYBRID | Standard BOM exists. Controlled deviation is allowed within tolerance. Beyond tolerance needs approval. |

### 44.2 BOM Header Fields

| Field | Description | Mandatory |
|---|---|---|
| BOM number | System-generated | Yes |
| BOM name / description | Descriptive name | Yes |
| Output material | FG or semi-FG this BOM produces | Yes |
| Output quantity (base) | Standard batch size | Yes |
| Output UOM | Base UOM of output material | Yes |
| BOM version | V1, V2, V3 etc. | Yes |
| BOM type | FIXED / ADMIX / HYBRID | Yes |
| Company | Company scope | Yes |
| Plant | Plant where this BOM applies | Yes |
| Effective from | Date from which BOM is valid | Yes |
| Effective to | End date (or open) | Optional |
| Active flag | Only one version active at a time per material + plant | Yes |
| Approval status | DRAFT / PENDING / APPROVED / ACTIVE / SUPERSEDED | Yes |
| Approved by | Production manager + QA | Yes |
| Created by | Production / R&D user | Yes |
| Remarks | | Optional |

### 44.3 BOM Line Fields

| Field | Description | Mandatory |
|---|---|---|
| Line number | Sequential | Yes |
| Component material | Input material reference | Yes |
| Component type | RAW_MATERIAL / PACKING_MATERIAL / CONSUMABLE / PROCESS_AID / REUSABLE_INPUT / BYPRODUCT / WASTAGE | Yes |
| Required quantity | Per batch (at base output quantity) | Yes |
| UOM | Issue UOM | Yes |
| Base UOM equivalent | Auto-calculated | System |
| % of output | Percentage by weight/volume (informational) | Optional |
| Wastage % | Expected wastage for this component | Optional |
| Scrap / byproduct flag | Is this line a byproduct or wastage output? | Yes |
| Optional flag | Is this component optional or mandatory? | Yes |
| Remarks | | Optional |

### 44.4 BOM Version and Active BOM Rules

This is one of the most critical design rules in the entire system.

```
Rule 1: Only one BOM version can be ACTIVE at a time per output material + plant.

Rule 2: When a new BOM version is activated:
        - Old active version is marked SUPERSEDED
        - New version becomes ACTIVE from its effective date

Rule 3: Old BOM must not affect old process orders.
        - Process orders created before the BOM change retain the OLD BOM snapshot
        - The new BOM applies only to NEW process orders created after activation

Rule 4: BOM snapshot is taken at process order creation or release — whichever is configured.
        - This snapshot is permanently stored on the process order
        - Even if BOM changes later, the process order uses its own frozen snapshot

Rule 5: BOM activation requires approval.
        - Production manager + QA approval before a new version goes ACTIVE
        - Activation cannot be done without sign-off

Rule 6: BOM cannot be deleted if it has been used in any process order.
        - SUPERSEDED status is the final state — not deletion
```

### 44.5 Alternative BOM

For some materials, multiple valid BOMs may exist:
- Different formulations for different markets
- Different packaging configurations
- Seasonal formulation changes

Alternative BOMs:
- Have the same output material but different line compositions
- Only one is ACTIVE at a time
- Selection at process order creation (if multiple alternatives exist and are approved)
- Each alternative has its own version history

### 44.6 BOM Where-Used

The system must support "where-used" queries:
- For any component material: which BOMs use it?
- For any output material: which BOMs exist (all versions)?
- For any active BOM: what is the full component list?
- For any process order: which BOM version/snapshot was used?

This is critical for:
- Impact analysis when a raw material is changed or blocked
- Procurement planning (BOM explosion)
- Costing (which BOM drives what cost)

---

## Section 45 — Multiple BOM, Active BOM, and Effective Date

### 45.1 BOM Version Lifecycle

```
DRAFT (created, not submitted)
    ↓
PENDING_APPROVAL (submitted for review)
    ↓
APPROVED (approved but not yet active — waiting for effective date)
    ↓
ACTIVE (currently in use — effective date reached and activated)
    ↓
SUPERSEDED (replaced by newer version — all historical data retained)
```

### 45.2 Effective Date Logic

| Scenario | Behavior |
|---|---|
| New BOM effective from 1 August 2026 | Process orders created before 1 August use old BOM. On/after 1 August, system suggests new BOM. |
| Immediate activation | Effective date = today. All new process orders use new BOM from now. |
| Old process order mid-run | Old BOM snapshot is frozen at order creation. New BOM does not affect it. |
| Backdated effective date | Not allowed without SA approval — prevents historical corruption. |

### 45.3 BOM Change Impact at Go-Live

At go-live on 1 July 2026:
- All active BOMs as of 30 June must be loaded into PACE.
- These are the starting BOM versions.
- Process orders created in PACE from 1 July use these BOMs.
- Any BOM change after go-live follows the full version + approval + activation flow.

---

## Section 46 — Fixed BOM Product Planning

### 46.1 How Fixed BOM Drives Procurement

For products with FIXED_BOM planning mode:

```
Production Plan (e.g., produce 10,000 KG of Product X)
    ↓
BOM Explosion:
  Active BOM for Product X:
  - RM-001: 500 KG per 1000 KG output → need 5,000 KG
  - PM-002: 200 boxes per 1000 KG output → need 2,000 boxes
  - CS-003: 10 KG per 1000 KG output → need 100 KG
    ↓
For each component:
  Gross Requirement = BOM quantity × planned output
  Less: Current UNRESTRICTED stock
  Less: Open PO quantity
  Less: In-transit quantity
  = Net Requirement
    ↓
If Net Requirement > 0 → Create PR
```

### 46.2 BOM Explosion Rules

1. BOM explosion uses the ACTIVE BOM at the time of planning.
2. If BOM changes between planning and production, the process order snapshot is what matters for execution.
3. Wastage percentage in BOM lines is included in gross requirement calculation.
4. Byproduct lines are excluded from procurement requirement (they are outputs, not inputs).
5. Optional components are flagged — planner decides whether to include.

---

## Section 47 — Admix / Actual Formula Production

### 47.1 What is Admix Production?

Admix production has no pre-defined fixed formula. The actual formulation is determined at the time of production — batch by batch. This is the opposite of Fixed BOM.

Key characteristics:
- No active BOM governs what must go in
- The production team decides the actual inputs per batch
- The formula is recorded on the process order as it is executed
- Procurement planning is based on historical consumption, management plans, or expected volume

### 47.2 Admix Procurement Planning

Since there is no BOM to explode, procurement planning for Admix uses:

| Planning Method | Description |
|---|---|
| Historical consumption | Average consumption over last N batches or N days |
| Min-max planning | Keep stock between minimum and maximum levels |
| Management plan | Management-defined production volume × expected consumption ratio |
| Expected production volume | Planned batches × estimated per-batch consumption |
| Manual requirement entry | Procurement planner enters requirement directly |

### 47.3 Admix Process Order — Formula Capture

```
Admix Process Order created (no BOM snapshot — just output target)
    ↓
Production execution begins
    ↓
Production team issues materials to process order (261)
  - Each issue creates a ledger entry
  - System records: material + quantity + rate + process order reference
    ↓
All issues accumulate as actual formula for this batch
    ↓
Process order actual consumption = sum of all 261 issues
    ↓
FG output received (actual quantity)
    ↓
Process order closed
    ↓
Actual formula = all materials issued to this process order
Actual cost = sum of all issued material values ÷ actual output
```

### 47.4 Admix Reuse Input

Admix products may also accept returned FG or reusable stock as input. This is captured via PACE custom movement 903 (Admix Reuse Input). The carrying value of the reuse stock is included in process order cost.

---

## Section 48 — Hybrid BOM with Deviation

### 48.1 What is Hybrid Production?

Hybrid products have a standard BOM but allow controlled deviation from it. This is between Fixed BOM (no deviation) and Admix (no BOM at all).

Use cases:
- Product formulation changes slightly based on raw material lot quality
- Minor component substitution is allowed within approved limits
- Seasonal adjustment to formulation within tolerance

### 48.2 Deviation Tolerance

Each BOM line for a Hybrid product has:

| Field | Description |
|---|---|
| Standard quantity | BOM-defined quantity per batch |
| Lower tolerance % | Maximum allowed % reduction |
| Upper tolerance % | Maximum allowed % increase |
| Substitution allowed | Yes / No |
| Approved substitute material | If substitution allowed — which material |

### 48.3 Hybrid Deviation at Process Order

```
Process Order created from Hybrid BOM snapshot
    ↓
Material issued to production (261)
    ↓
System compares each issue against BOM snapshot:
  - Within tolerance → allowed, no action
  - Beyond tolerance → DEVIATION FLAG raised
    ↓
Deviation approval required:
  - Production manager reviews deviation
  - Approves or rejects
  - Reason and approval recorded
    ↓
Process order proceeds
    ↓
At closure: BOM snapshot vs actual consumption variance report generated
```

### 48.4 Hybrid BOM Records Kept

For each Hybrid process order:
- BOM snapshot (what was planned)
- Actual consumption (what was issued)
- Deviation records (line-by-line)
- Deviation approvals (who approved what)
- Final variance report

---

## Section 49 — Production Planning

### 49.1 Production Plan Structure

Production planning in Phase-1 is semi-manual. Full MRP automation is Phase-3.

| Planning Layer | Description |
|---|---|
| Production plan | Management or production manager defines planned output for a period |
| Material requirement | For FIXED_BOM: BOM explosion. For ADMIX: historical/manual. |
| Capacity check | Basic check — is there enough production capacity? (Phase-2 for detail) |
| Process order creation | From plan, process orders are created for each batch |

### 49.2 Production Plan Fields

| Field | Description | Mandatory |
|---|---|---|
| Plan number | System-generated | Yes |
| Plan period | Week / Month | Yes |
| Company / Plant / Section | Scope | Yes |
| Output material | FG to be produced | Yes |
| Planned output quantity | In output UOM | Yes |
| Planned start date | | Yes |
| Planned end date | | Yes |
| BOM reference | Active BOM at time of planning | System |
| Planning mode | FIXED_BOM / ADMIX / HYBRID | System |
| Status | DRAFT / APPROVED / IN_PROGRESS / CLOSED | Yes |
| Created by | Production planner | Yes |
| Approved by | Production manager | Yes |

---

## Section 50 — Process Order

### 50.1 What is a Process Order?

A Process Order is the execution document for one production batch. It authorizes production to consume materials and produce output. It is the PP equivalent of a production order in SAP (PP-PI Process Order / CO01).

Every batch of production = one process order.

### 50.2 Process Order Lifecycle

```
DRAFT
  ↓
PLANNED (materials identified, BOM snapshot taken)
  ↓
RELEASED (approved for execution, materials can be reserved/issued)
  ↓
MATERIAL_RESERVED (reservation documents created)
  ↓
IN_PRODUCTION (first material issue done)
  ↓
PARTIAL_COMPLETED (some FG received, production ongoing)
  ↓
QA_PENDING (all FG produced, QA decision awaited)
  ↓
COMPLETED (FG QA done, all materials reconciled)
  ↓
CLOSED (cost settled, variance approved, order locked)
  ↓
CANCELLED (before any material issued — with reason and approval)
```

### 50.3 Process Order Header Fields

| Field | Description | Mandatory |
|---|---|---|
| Process order number | System-generated (company + section + FY) | Yes |
| Process order date | Creation date | Yes |
| Company / Plant / Section | Scope | Yes |
| Output material | FG / semi-FG to be produced | Yes |
| Planned output quantity | In output UOM | Yes |
| Production mode | FIXED_BOM / ADMIX / HYBRID | Yes |
| BOM snapshot reference | BOM version frozen at creation/release | If FIXED/HYBRID |
| BOM snapshot date | Date snapshot was taken | If FIXED/HYBRID |
| Planned start date | | Yes |
| Planned end date | | Yes |
| Actual start date | Filled on first issue | System |
| Actual end date | Filled on completion | System |
| Actual output quantity | Filled as FG is received | System |
| Status | Lifecycle status | Yes |
| Cost center | For cost assignment | Yes |
| Created by | Production user | Yes |
| Approved by | Production manager | Yes |

### 50.4 BOM Snapshot Rule — Critical

When a process order is created or released (configurable):

1. System reads the ACTIVE BOM for the output material + plant.
2. A complete copy (snapshot) of all BOM lines is stored on the process order.
3. This snapshot is immutable — it is frozen.
4. Even if the BOM changes after this point, this process order uses its own frozen snapshot.
5. The snapshot includes: material, component type, standard quantity, UOM, wastage %, tolerances (if hybrid).

This ensures old process orders are never affected by new BOM versions.

### 50.5 Process Order Cost Collection

The process order accumulates all cost as execution happens:

| Cost Element | Source | Movement |
|---|---|---|
| Raw material cost | Issue to production | 261 |
| Packing material cost | Issue to production | 261 |
| Consumable cost | Issue to production | 261 |
| Reusable input cost | Reuse movement | 901 / 903 |
| Direct additional cost | Manual entry (freight, processing) | Manual posting |
| Reversal (if any) | 262 reversal entries | 262 |

```
Total Process Order Cost =
  Sum of all 261 issue values
+ Sum of all reuse input values
+ Any direct additional costs
- Sum of any 262 reversals

FG Actual Cost per Unit =
  Total Process Order Cost ÷ Actual FG Output Quantity

Production Variance =
  (Planned Cost from BOM) − (Actual Process Order Cost)
```

---

## Section 51 — Material Reservation

### 51.1 What is Material Reservation?

When a process order is released, it creates Material Reservations. A reservation is a soft hold on UNRESTRICTED stock — it signals that this quantity is committed to this process order and should not be used for anything else.

Reservations do not reduce stock quantity. They reduce the "freely available" quantity in procurement planning.

### 51.2 Reservation Document Fields

| Field | Description |
|---|---|
| Reservation number | System-generated |
| Process order reference | Parent process order |
| Material | Component material |
| Plant | Plant |
| Storage location | Preferred issue location |
| Required quantity | From BOM snapshot or planned actual |
| UOM | Issue UOM |
| Required by date | Process order planned start date |
| Issued quantity | Updated as 261 issues are posted |
| Balance quantity | Required − Issued |
| Status | OPEN / PARTIAL / FULLY_ISSUED / CANCELLED |

### 51.3 Reservation Rules

1. Reservation is created automatically on process order release.
2. UNRESTRICTED stock − Reserved stock = freely available stock (for planning).
3. Reservation does not block the stock — it is advisory. Production can still be overridden by stores if needed (with approval).
4. Reservation is closed when fully issued or when process order is closed/cancelled.
5. Excess reservation (if BOM changes mid-order) must be manually reduced with reason.

---

## Section 52 — Material Issue to Production

### 52.1 Issue Flow

```
Process order RELEASED and reservations exist
    ↓
Stores opens material issue in PACE
    ↓
Process order reference selected
    ↓
System loads BOM snapshot / reservation list
    ↓
Stores enters actual issue quantity per component
    ↓
Issue UOM entered → converted to base UOM automatically
    ↓
Movement 261 posted:
  UNRESTRICTED stock (Main Store) → Consumed
  Stock ledger updated
  Reservation balance updated
  Process order issued quantity updated
    ↓
Issue document created
```

### 52.2 Issue Rules

1. Issue requires a valid, released process order reference.
2. Issue cannot exceed what is in UNRESTRICTED stock at the specified storage location.
3. Over-issue beyond BOM quantity for FIXED BOM raises a warning (or deviation flag for HYBRID).
4. Reversal of issue (262) is allowed with approval if material was issued incorrectly.
5. Multiple issue documents can be posted against one process order (issues can happen in stages).
6. After all material is issued and production is complete, the process order moves to QA_PENDING.

---

## Section 53 — Actual Consumption and Variance

### 53.1 Actual vs Planned Comparison

For FIXED_BOM and HYBRID process orders, the system compares:

```
For each BOM component:

Planned Quantity (from BOM snapshot × actual output ratio)
Actual Issued Quantity (from all 261 postings)
Variance = Actual − Planned
Variance % = (Variance ÷ Planned) × 100
```

### 53.2 Variance Categories

| Variance | Description | Action |
|---|---|---|
| Within tolerance | Acceptable. No action needed. | Recorded, no approval |
| Beyond upper tolerance | Over-consumption. Investigation needed. | Deviation approval required |
| Beyond lower tolerance | Under-consumption. Material may remain unused. | Reconciliation required |
| Substitution used | Different material issued than BOM specified. | Substitution approval required |

### 53.3 Variance Report

The variance report per process order shows:
- Output material and process order number
- Planned output vs actual output
- For each component: planned qty, actual qty, variance qty, variance %
- Total planned cost vs total actual cost
- Cost variance
- Deviation approvals if any

### 53.4 Admix Variance

For ADMIX process orders, there is no BOM to compare against. Instead:
- Historical average consumption is used as a reference
- Significant deviation from historical average is flagged
- Production manager reviews and approves

---

## Section 54 — Production Costing

### 54.1 Cost Flow in Production

```
Process Order opened
    ↓
Materials issued (261):
  Each issue = qty × current valuation rate
  (WEIGHTED_AVERAGE or DIRECT_BATCH_COST per material)
    ↓
All issue values accumulated on process order
    ↓
FG produced and received
    ↓
Process order closed
    ↓
FG Actual Cost per unit = Total Issue Cost ÷ Actual FG Output Qty
    ↓
FG stock valued at this actual cost
    ↓
Variance = Planned BOM cost − Actual cost
```

### 54.2 Production Loss and Wastage

| Concept | Description |
|---|---|
| Planned wastage | From BOM wastage % — expected loss in production |
| Actual wastage | Planned output − Actual output |
| Wastage value | Wastage qty × input material cost per unit of output |
| Scrap recovery | If wastage has scrap value — SCRAP_VALUE method |
| Net FG cost | After accounting for wastage and scrap recovery |

### 54.3 Process Order Cost Report

| Cost Element | Planned | Actual | Variance |
|---|---|---|---|
| Raw material | ₹X | ₹X | ₹X |
| Packing material | ₹X | ₹X | ₹X |
| Consumables | ₹X | ₹X | ₹X |
| Reusable input | ₹X | ₹X | ₹X |
| Direct extra cost | ₹X | ₹X | ₹X |
| **Total cost** | ₹X | ₹X | ₹X |
| FG output quantity | X | X | X |
| **Cost per unit** | ₹X | ₹X | ₹X |

---

## Section 55 — Production Quality

### 55.1 In-Process QA

During production, quality checks may be required at defined stages:
- After mixing / blending
- After filling
- After packaging

In Phase-1, in-process QA is basic:
- QA team records observations against process order
- Pass / hold / rework decision
- If rework: production continues with rework
- If hold: process order moves to BLOCKED status pending QA decision

### 55.2 Production QA Document Fields

| Field | Description | Mandatory |
|---|---|---|
| QA check number | System-generated | Yes |
| Process order reference | | Yes |
| Stage | MIXING / FILLING / PACKAGING / OTHER | Yes |
| Check date | | Yes |
| Parameters checked | Free text or checklist Phase-1 | Optional |
| Result | PASS / FAIL / REWORK_REQUIRED | Yes |
| QA user | | Yes |
| Remarks | | Optional |

---

## Section 56 — FG Receipt

### 56.1 FG Receipt Flow

```
Production complete → Process order IN_PRODUCTION
    ↓
Production team initiates FG receipt in PACE
    ↓
Process order reference selected
    ↓
FG quantity entered (actual output in output UOM)
    ↓
Storage location: FG-STORE
    ↓
If FG QA required:
    Stock lands in FG_QA stock type
If FG QA not required:
    Stock lands in FG_UNRESTRICTED stock type
    ↓
Stock ledger updated
Process order actual output updated
FG Actual Cost calculated (if process order has all issues posted)
    ↓
FG receipt document created
    ↓
Process order status → QA_PENDING (if FG QA required) or COMPLETED
```

### 56.2 FG Receipt Document Fields

| Field | Description | Mandatory |
|---|---|---|
| FG receipt number | System-generated | Yes |
| Receipt date | | Yes |
| Company / Plant | | Yes |
| Process order reference | | Yes |
| Output material | FG material | Yes |
| FG storage location | FG-STORE | Yes |
| Received quantity | Actual output | Yes |
| Output UOM | | Yes |
| Stock type | FG_QA or FG_UNRESTRICTED | System |
| Batch / lot | If FG is batch-tracked | Conditional |
| Actual cost per unit | Calculated from process order | System |
| Wastage quantity | Planned − Actual | System |
| Remarks | | Optional |

### 56.3 Partial FG Receipt

Production may produce FG in multiple runs:
- First run: 400 KG received → partial FG receipt
- Second run: 600 KG received → second partial FG receipt
- Total: 1000 KG → process order completes

Each partial receipt posts a separate stock document. Process order tracks cumulative received quantity.

---

## Section 57 — FG QA and FG Stock Types

### 57.1 FG QA Flow

```
FG received into FG_QA stock type
    ↓
QA team notified
    ↓
QA team opens FG QA decision in PACE
    ↓
FG sample checked
    ↓
Usage Decision:
  RELEASE → stock moves to FG_UNRESTRICTED (321 in FG context)
  REWORK → stock moves to REWORK bucket → rework process order created
  BLOCK → stock moves to FG_BLOCKED (350 in FG context)
  REJECT → stock moves to rejected / scrap
    ↓
QA decision document posted
Stock ledger updated
```

### 57.2 FG Stock Type Transitions

| From | To | Trigger | Movement |
|---|---|---|---|
| FG_QA | FG_UNRESTRICTED | QA release | 321 (FG context) |
| FG_QA | FG_BLOCKED | QA block | 350 (FG context) |
| FG_QA | REWORK | QA rework decision | Custom movement |
| FG_UNRESTRICTED | FG_RESERVED | Dispatch reservation | System |
| FG_UNRESTRICTED | FG_SCHEDULED | Dispatch confirmation | System |
| FG_SCHEDULED | DISPATCH_HOLD | Dispatch hold | System |
| DISPATCH_HOLD | — | Goods issue (601) | 601 — stock removed |
| FG_BLOCKED | FG_UNRESTRICTED | Management release | 343 (FG context) |

### 57.3 FG Batch Tracking

If FG is batch-tracked:
- Each FG receipt gets a unique batch / lot number
- Batch carries: process order ref, production date, FG cost, QA status
- Dispatch is done from a specific batch
- Customer return is linked to specific batch
- Full traceability: raw material batch → process order → FG batch → dispatch → customer

---

*— End of Part G —*

---

# PART H — FG, DISPATCH & RETURNS

---

## Section 58 — FG Reservation and Dispatch Hold

### 58.1 FG Stock Flow Before Dispatch

Once FG passes QA and moves to FG_UNRESTRICTED, it follows this path before physical dispatch:

```
FG_UNRESTRICTED (available)
    ↓
Dispatch Instruction created → FG_RESERVED (soft allocation to specific customer/order)
    ↓
Dispatch confirmed and vehicle arranged → FG_SCHEDULED
    ↓
FG physically moved to dispatch area → DISPATCH_HOLD
    ↓
Vehicle loaded and dispatched → Goods Issue (601) → Stock removed from system
```

### 58.2 FG Stock Type Meanings for Dispatch

| Stock Type | Meaning | Can Be Dispatched? |
|---|---|---|
| FG_UNRESTRICTED | Available, no commitment yet | Yes — can be allocated |
| FG_QA | Under quality inspection | No |
| FG_BLOCKED | Blocked by QA or management | No |
| FG_RESERVED | Soft-allocated to a dispatch instruction | Only against that instruction |
| FG_SCHEDULED | Confirmed for dispatch, vehicle arranged | Only against that instruction |
| DISPATCH_HOLD | In dispatch area, loading pending | Only against that instruction |

### 58.3 Available FG for New Orders

When a new dispatch instruction is created, the system checks:

```
FG Available for New Allocation =
  FG_UNRESTRICTED quantity
− FG_RESERVED quantity (already allocated)
− FG_SCHEDULED quantity
− DISPATCH_HOLD quantity
= Net freely available FG
```

If net available < required dispatch quantity → system warns. Dispatch instruction can still be created as backorder.

---

## Section 59 — Sales Order / Dispatch Instruction

### 59.1 What is a Dispatch Instruction?

A Dispatch Instruction (DI) is the PACE-ERP equivalent of a Sales Order or Delivery Order. It is the authorization to dispatch a specific quantity of FG to a specific customer from a specific plant.

In SAP terms, this covers elements of VA01 (Sales Order) and VL01N (Delivery).

### 59.2 Dispatch Instruction Lifecycle

```
DRAFT
  ↓
PENDING_APPROVAL
  ↓
APPROVED
  ↓
STOCK_RESERVED (FG reserved against this DI)
  ↓
PICKING_IN_PROGRESS
  ↓
PACKED
  ↓
DISPATCH_HOLD (ready, awaiting vehicle)
  ↓
DISPATCHED (goods issue posted — 601)
  ↓
DELIVERED (proof of delivery if applicable)
  ↓
CLOSED
  ↓
PARTIALLY_DISPATCHED (if partial dispatch done)
  ↓
CANCELLED (before any dispatch)
```

### 59.3 Dispatch Instruction Header Fields

| Field | Description | Mandatory |
|---|---|---|
| DI number | System-generated (company + section + FY) | Yes |
| DI date | Creation date | Yes |
| Company | Company scope | Yes |
| Business section | Section scope | Yes |
| Dispatch plant | From which plant | Yes |
| Customer | Reference to customer master | Yes |
| Delivery address | Customer delivery location | Yes |
| Required delivery date | Customer's requested date | Yes |
| Dispatch type | DOMESTIC / EXPORT | Yes |
| Priority | NORMAL / URGENT | Yes |
| Sales reference | Customer PO number or order reference | Optional |
| Status | Lifecycle status | Yes |
| Created by | Sales / dispatch user | Yes |
| Approved by | Sales manager | Yes |
| GST invoice reference | Placeholder — future | Optional |
| E-way bill reference | Placeholder — future | Optional |

### 59.4 Dispatch Instruction Line Fields

| Field | Description | Mandatory |
|---|---|---|
| Line number | Sequential | Yes |
| Material | FG material | Yes |
| Dispatch storage location | From which FG store | Yes |
| Ordered quantity | Customer order quantity | Yes |
| Dispatch UOM | In dispatch/sales UOM | Yes |
| Base UOM equivalent | Auto-calculated | System |
| FG batch / lot | Specific batch if required | Optional |
| Reserved quantity | Soft allocation from FG_UNRESTRICTED | System |
| Dispatched quantity | Updated on each partial dispatch | System |
| Balance quantity | Ordered − Dispatched | System |
| Unit rate | Customer price (Phase-2) | Optional Phase-1 |
| Line status | OPEN / PARTIAL / COMPLETE / CANCELLED | System |

---

## Section 60 — Delivery Planning, Picking, and Packing

### 60.1 Picking

Picking is the process of physically collecting FG from the FG store for a dispatch instruction.

```
Dispatch Instruction APPROVED
    ↓
Picking list generated from DI lines
    ↓
Stores / dispatch staff pick FG from FG-STORE:
  - Verify material, batch, quantity
  - Match against picking list
    ↓
Picking confirmation done in PACE
    ↓
FG status updated: FG_RESERVED → FG_SCHEDULED
    ↓
Packing begins
```

### 60.2 Packing

Packing records the packaging details:
- How many cartons / boxes / pallets
- Gross weight / net weight
- Packing date
- Packer identification

Packing document is linked to the DI and becomes the basis for the delivery challan.

### 60.3 Delivery Challan

The Delivery Challan (DC) is the physical document that goes with the goods. It contains:
- Challan number and date
- Dispatching company and plant details
- Customer name and delivery address
- Material list, quantity, batch, UOM
- Vehicle number, driver, transporter, LR number
- Gross weight, net weight
- GST placeholder fields (GSTIN, HSN, tax rate — for future invoice)
- Authorized signatory

The challan is generated from PACE and is the reference document for the goods issue posting.

---

## Section 61 — Goods Issue for Delivery

### 61.1 Goods Issue Flow

```
FG in DISPATCH_HOLD — vehicle loaded
    ↓
Dispatch user opens Goods Issue in PACE
    ↓
Dispatch Instruction reference selected
    ↓
System loads DI lines with scheduled quantities
    ↓
Dispatch user confirms actual dispatch quantity
  (may be partial — less than scheduled)
    ↓
Movement 601 posted:
  FG stock reduced from DISPATCH_HOLD
  Stock ledger updated
  DI dispatched quantity updated
    ↓
Goods Issue document created
Delivery Challan finalized
    ↓
DI status → DISPATCHED or PARTIALLY_DISPATCHED
    ↓
Future: GST invoice triggered (Phase-3)
```

### 61.2 Goods Issue Document Fields

| Field | Description | Mandatory |
|---|---|---|
| GI number | System-generated | Yes |
| GI date | Posting date | Yes |
| Company / Plant | | Yes |
| DI reference | Linked dispatch instruction | Yes |
| Customer | From DI | Yes |
| Vehicle number | | Yes |
| Driver name | | Optional |
| Transporter | | Optional |
| LR number | | Yes |
| Material | From DI lines | Yes |
| Dispatch quantity | Actual dispatched quantity | Yes |
| Dispatch UOM | | Yes |
| Base UOM equivalent | System | System |
| FG batch / lot | | Conditional |
| Storage location | From DISPATCH_HOLD | Yes |
| Movement type | 601 (auto) | System |
| Challan number | Reference | Yes |
| GST invoice placeholder | Future | Optional |
| Posted by | Dispatch ACL user | Yes |
| Status | POSTED / REVERSED | System |

### 61.3 Partial Dispatch

One DI can have multiple goods issue postings:
- First dispatch: 400 units → DI PARTIALLY_DISPATCHED
- Second dispatch: 600 units → DI DISPATCHED / CLOSED

Each GI posting creates a separate stock document and delivery challan.

### 61.4 Goods Issue Reversal (602)

GI can be reversed only:
- With approval and reason
- Only on the same day or within configured window
- If the vehicle has returned with goods (failed delivery)
- Reversal restores FG stock to FG_UNRESTRICTED
- DI reverts to previous status

---

## Section 62 — Customer Return / FG Return

### 62.1 Why FG Returns Must Be Handled Carefully

When a customer returns FG:
- The returned FG may or may not be sellable again
- It must go through QA before any decision
- Its value must be handled correctly in costing
- It may be reused in another production batch — traceability required
- It may be reworked and redispatched
- It may be scrapped

Every decision has a different movement type and a different costing impact.

### 62.2 Customer Return Flow

```
Customer returns FG
    ↓
Return receipt at plant gate (gate entry if applicable)
    ↓
Return GR posted — Movement 651:
  FG received into RETURNED stock type
  Stock ledger updated
  Return document created (linked to original GI / DI)
    ↓
QA team notified for return QA
    ↓
Return QA decision:
  ACCEPT_UNRESTRICTED → 653 → FG_UNRESTRICTED
  ACCEPT_QA → 655 → QUALITY_INSPECTION
  BLOCK → 657 → FG_BLOCKED
  REUSE → 901 → REUSE_HOLD (approved for use in production)
  REWORK → Rework process initiated
  SCRAP → 553 / 555 → SCRAP
    ↓
Movement posted, stock ledger updated
    ↓
Return document closed
```

### 62.3 Return Document Fields

| Field | Description | Mandatory |
|---|---|---|
| Return number | System-generated | Yes |
| Return date | | Yes |
| Company / Plant | | Yes |
| Customer | Reference | Yes |
| Original DI reference | If linked to specific dispatch | Optional |
| Original GI reference | If linked to specific goods issue | Optional |
| Return reason | Customer reason | Yes |
| Material | FG material | Yes |
| Return quantity | In dispatch UOM | Yes |
| Dispatch UOM | | Yes |
| Base UOM equivalent | System | System |
| FG batch / lot | Specific returned batch | Optional |
| Storage location | RETURN-STORE | Yes |
| Movement type | 651 (auto) | System |
| Return QA decision | Filled by QA | Yes |
| Return value | Quantity × valuation rate | System |
| Posted by | ACL user | Yes |

### 62.4 Return Valuation

When FG is returned:
- The returned stock is valued at the FG valuation rate at the time of return
- If accepted back to FG_UNRESTRICTED: it joins FG stock at its carried value
- If approved for reuse in production: MANUAL_APPROVED_COST is set
- If scrapped: SCRAP_VALUE is applied

---

## Section 63 — Reuse, Rework, and Scrap Decision

### 63.1 Three Post-Return Paths

After return QA, three major paths are possible:

```
RETURNED FG
    ↓
QA Decision:
    ├── REUSE → Approved for production input
    ├── REWORK → Sent for reprocessing
    └── SCRAP → Written off
```

### 63.2 Path 1 — Reuse

Returned FG is approved for use as an input in another production batch.

```
QA approves reuse
    ↓
Management approves carrying value (MANUAL_APPROVED_COST)
    ↓
Movement 901: RETURNED → REUSE_HOLD
    ↓
Reuse stock appears in production planning as available input
    ↓
Production creates process order
    ↓
Reuse stock issued to process order (Movement 901 or 903)
    ↓
Reuse value included in process order cost
    ↓
FG actual cost of new batch includes reuse input
    ↓
Full traceability maintained:
  Original FG batch → Return → Reuse approval → New process order → New FG batch
```

**Reuse costing rule:**
- Carrying value is management-approved, not original FG cost
- This prevents inflated costs if returned FG has degraded value
- Approval is audited

### 63.3 Path 2 — Rework

FG can be repaired, reprocessed, or relabelled.

```
QA approves rework
    ↓
Movement 909: RETURNED → REWORK stock type
    ↓
Rework process order created
    ↓
Rework inputs issued (additional materials, packing etc.)
    ↓
Reworked FG received back (Movement 911)
    ↓
Reworked FG QA decision
    ↓
If passed: FG_UNRESTRICTED
If failed: SCRAP
    ↓
Rework cost = original returned FG value + additional rework inputs
```

### 63.4 Path 3 — Scrap

FG cannot be used or reworked. It is written off.

```
QA approves scrap
    ↓
Movement 553 or 555: RETURNED / BLOCKED → SCRAP stock
    ↓
Scrap value assessed (SCRAP_VALUE method)
    ↓
Write-off value = Original value − Scrap realization value
    ↓
Stock ledger updated
    ↓
Scrap document created
    ↓
Scrap may be physically disposed or sold as scrap
```

### 63.5 Scrap from Production

Production wastage/scrap is also handled via 551/553/555:
- Production loss during process order
- QA-rejected FG after production
- Unusable batch

Scrap value recoverable from production scrap is credited back to process order cost.

### 63.6 Reuse/Rework/Scrap Decision Approval Matrix

| Decision | Approver | Additional Approver |
|---|---|---|
| Reuse — QA approval | QA manager | |
| Reuse — value approval | Management / Finance | Mandatory |
| Rework | QA manager + Production manager | |
| Scrap | QA manager | Management (above threshold) |
| Scrap with high value write-off | Management + Finance | Mandatory |

---

## Section 64 — Customer-wise and Material-wise Dispatch Reports

### 64.1 Dispatch Reports Required

| Report | Description |
|---|---|
| Dispatch register | All dispatches in period by date, customer, material, quantity, value |
| Customer-wise dispatch summary | Total dispatched to each customer in period |
| Material-wise dispatch summary | Total dispatched per FG material in period |
| Pending dispatch report | All DIs approved but not yet dispatched |
| Partial dispatch report | DIs with partial dispatch — balance pending |
| Return register | All customer returns in period with QA decision |
| Reuse register | All reuse approvals with traceability |
| Rework register | All rework events with before/after quantities |
| Scrap register | All FG scrap events with value write-off |
| FG stock ageing | FG stock by age — to flag slow-moving FG |
| Batch traceability report | From RM batch → process order → FG batch → customer |

---

*— End of Part H —*

---

# PART I — PLANT TRANSFER & GST READINESS

---

## Section 65 — Plant-to-Plant Stock Transfer Design

### 65.1 Why Plant Transfer Needs Careful Design

Plant-to-plant stock transfer is not a simple storage location change. Depending on the business context it may involve:

- Different GST registrations (GSTIN) at source and target
- Legal requirement for a tax invoice or stock transfer invoice
- E-way bill requirement for movement above threshold value
- Physical transport with LR number and vehicle details
- Stock-in-transit period where material is neither at source nor at target
- Return/reversal of a transfer
- Valuation at transfer price

Getting this wrong means:
- Stock appears at both plants or neither plant
- Tax compliance risk
- Audit failure
- Business process disruption

### 65.2 Transfer Scenario Classification

Before designing the movement, the system must classify the transfer:

| Scenario | Description | GST Applicable? | Tax Document? | Two-step needed? |
|---|---|---|---|---|
| Same company, same GSTIN, same state | Internal movement within same GST entity | No | No | Optional |
| Same company, same GSTIN, different location | Internal movement, same GST entity | No | No | Optional |
| Same company, different GSTIN (different state / branch) | Intra-company but different GST registration | Yes (IGST) | Yes — Stock Transfer Invoice | Yes |
| Different companies, same group | Inter-company transfer | Yes | Yes — Tax Invoice | Yes |
| Different companies, different group | External sale / purchase | Full SD/MM flow | Yes — Commercial Invoice | Full SD+MM |

**For Phase-1: Scenarios 1 and 2 are the primary focus. Scenario 3 design placeholders are mandatory. Scenarios 4–5 are Phase-3.**

### 65.3 One-Step Plant Transfer (Movement 301/302)

Used when:
- Same company, same GSTIN
- No tax document required
- No stock-in-transit period needed
- Transfer is immediate and verified

```
Transfer Request created
    ↓
Approval (source plant manager)
    ↓
One-step posting: Movement 301
  Source plant stock → Decreases (UNRESTRICTED or specified stock type)
  Target plant stock → Increases (UNRESTRICTED or QA depending on target rule)
    ↓
Both postings happen in a single transaction
Stock ledger updated for both plants
    ↓
Transfer document created
    ↓
Reversal: Movement 302 (if needed, with approval)
```

**Key rule:** Source stock must be available before posting. System validates quantity at source.

### 65.4 Two-Step Plant Transfer with Stock-in-Transit (303/304 + 305/306)

Used when:
- Physical transport is involved
- Time gap exists between dispatch from source and receipt at target
- GST document may be required (future)
- E-way bill may be required (future)
- Target plant needs to do independent QA on receipt

```
STEP 1 — SOURCE PLANT SIDE:

Transfer Request created
    ↓
Approval by source plant manager
    ↓
Stock Transfer Order created
    ↓
Source plant issues stock — Movement 303:
  Source UNRESTRICTED → IN_TRANSIT (logical bucket)
  Source plant stock decreases
  IN_TRANSIT stock increases
    ↓
Dispatch document created:
  Vehicle number, driver, transporter, LR number
  Expected dispatch date
  Expected receipt date
  Material, quantity, value
  GST placeholder fields (GSTIN source/target, HSN, tax rate)
  E-way bill placeholder
    ↓
Material physically dispatched

—————————————————————————————————

STEP 2 — TARGET PLANT SIDE:

Material arrives at target plant gate
    ↓
Gate entry at target plant (if applicable)
    ↓
Target plant receives stock — Movement 305:
  IN_TRANSIT stock decreases
  Target plant stock increases:
    → QUALITY_INSPECTION (if QA required at target)
    → UNRESTRICTED (if no QA required)
    ↓
Target plant QA decision (if applicable)
    ↓
Transfer closure: both steps reconciled
    ↓
Stock Transfer Order status → CLOSED
```

### 65.5 Stock-in-Transit Ledger

During the period between 303 and 305, the material exists in the IN_TRANSIT logical bucket. This bucket:

- Is not physical inventory at any plant
- Is not available for issue or dispatch from either plant
- Appears in procurement planning as "expected receipt" at target plant
- Can be queried: "what is currently in transit and when is it expected?"

**IN_TRANSIT Ledger Entry:**

| Field | Description |
|---|---|
| Transfer order reference | Parent transfer order |
| Material | Material in transit |
| Source company / plant | Issued from |
| Target company / plant | Expected at |
| Quantity | In base UOM |
| Valuation rate | At time of issue |
| Value | Quantity × rate |
| Dispatch date | Date of 303 posting |
| Expected receipt date | ETA at target |
| Actual receipt date | Filled on 305 posting |
| Status | IN_TRANSIT / PARTIALLY_RECEIVED / RECEIVED / REVERSED |

### 65.6 Stock Transfer Order Document Fields

| Field | Description | Mandatory |
|---|---|---|
| Transfer order number | System-generated | Yes |
| Transfer type | ONE_STEP / TWO_STEP | Yes |
| Source company | | Yes |
| Source plant | | Yes |
| Source storage location | | Yes |
| Source GSTIN | Placeholder | Optional Phase-1 |
| Target company | | Yes |
| Target plant | | Yes |
| Target storage location | Expected | Yes |
| Target GSTIN | Placeholder | Optional Phase-1 |
| Material | | Yes |
| Batch / lot | If applicable | Conditional |
| Transfer quantity | | Yes |
| Transfer UOM | | Yes |
| Valuation rate at transfer | | Yes |
| Transfer value | Quantity × rate | System |
| Transfer price type | AT_COST / AT_AGREED_PRICE | Yes |
| GST applicability flag | Yes / No | Yes |
| Tax document required | Yes / No (future) | Yes |
| Transport required | Yes / No | Yes |
| Vehicle number | | If transport |
| Transporter name | | If transport |
| LR number | | If transport |
| Expected dispatch date | | Yes |
| Expected receipt date | | Yes |
| E-way bill reference | Placeholder | Optional |
| GST invoice reference | Placeholder | Optional |
| Status | DRAFT / APPROVED / ISSUED / IN_TRANSIT / RECEIVED / CLOSED | Yes |
| Approval by | Source plant manager | Yes |

### 65.7 Transfer Valuation Rules

| Transfer Scenario | Valuation Method |
|---|---|
| Same company, same GSTIN | AT_COST — transfer at current weighted average rate. No profit. |
| Same company, different GSTIN | AT_COST or AT_AGREED_PRICE — tax document requires declared value |
| Different companies | AT_AGREED_PRICE — commercial transfer price |

Transfer value affects:
- Source plant: stock decreases at the transfer value
- Target plant: stock received at the transfer value (becomes new valuation rate at target if different)
- Weighted average at target is recalculated after 305 receipt

### 65.8 Transfer Return and Reversal

| Scenario | Method |
|---|---|
| One-step transfer reversal | Movement 302 — with approval and reason |
| Two-step — before 305 (material still in transit) | Cancel the transfer order. Movement 304 to reverse the 303 issue. Stock returns to source. |
| Two-step — after 305 (received at target) | Initiate a return transfer from target back to source. New transfer order in reverse direction. |
| Partial return | Transfer return for partial quantity. Balance stays at target. |

---

## Section 66 — Inter-Plant Transfer Approval and Document Flow

### 66.1 Approval Flow

```
Transfer Request created by stores / procurement user
    ↓
Submitted for approval
    ↓
Source plant manager approves
    ↓
If cross-company or different GSTIN:
  Finance / management approval also required
    ↓
Transfer Order created and activated
    ↓
Source plant executes 303 / 301
    ↓
Target plant executes 305 (two-step)
    ↓
Transfer closure by source plant manager
```

### 66.2 Document Flow for Plant Transfer

```
Transfer Request
    ↓
Transfer Approval
    ↓
Stock Transfer Order
    ↓
Transfer Issue Document (303 / 301)
    ↓
Inter-Plant Dispatch Document (Delivery Challan)
    ↓
[Future: GST Stock Transfer Invoice / E-way Bill]
    ↓
Target Gate Entry (if applicable)
    ↓
Transfer Receipt Document (305 / GRN at target)
    ↓
Target QA Decision (if applicable)
    ↓
Transfer Closure Document
```

---

## Section 67 — GST Future Readiness Design

### 67.1 Design Principle

> Do not implement full GST now. But design all placeholders so GST can be added later without redesigning plant transfer or dispatch.

The stock transfer and dispatch documents must carry all GST-relevant fields as placeholders from Phase-1. When GST automation is implemented in Phase-3, these fields are activated — the document structure does not change.

**The inventory layer and the tax document layer must be separate but linkable.**

```
Stock Transfer Order / Dispatch Instruction
    │
    ├── Inventory Layer (Phase-1 active)
    │     Stock movement, quantity, value, movement type
    │
    └── Tax Document Layer (Phase-3 active)
          GST Invoice / Stock Transfer Invoice
          GST Debit Note / Credit Note
          E-way Bill Reference
```

### 67.2 GST Placeholder Fields — Required in Phase-1 Design

These fields must exist on dispatch and plant transfer documents from Phase-1, even if not populated:

| Field | Document | Phase-1 Status |
|---|---|---|
| Source GSTIN | Plant Transfer, Dispatch | Placeholder |
| Target / Customer GSTIN | Plant Transfer, Dispatch | Placeholder |
| HSN / SAC code | Material master | Placeholder |
| Tax category | Material master | Placeholder |
| Place of supply | Plant Transfer, Dispatch | Placeholder |
| Bill From details | Plant Transfer | Placeholder |
| Ship From details | Plant Transfer | Placeholder |
| Bill To details | Dispatch | Placeholder |
| Ship To details | Dispatch | Placeholder |
| Taxable value | Plant Transfer, Dispatch | Placeholder |
| CGST rate / amount | Plant Transfer, Dispatch | Placeholder |
| SGST rate / amount | Plant Transfer, Dispatch | Placeholder |
| IGST rate / amount | Plant Transfer, Dispatch | Placeholder |
| Total tax amount | Plant Transfer, Dispatch | Placeholder |
| Total invoice value | Plant Transfer, Dispatch | Placeholder |
| Tax invoice number | Dispatch, Plant Transfer | Placeholder |
| E-way bill number | Plant Transfer, Dispatch | Placeholder |
| E-way bill valid till | Plant Transfer | Placeholder |
| GST document status | All | NOT_APPLICABLE / PENDING / GENERATED / CANCELLED |

### 67.3 GST Invoice (Future — Phase-3)

A GST Invoice is required when:
- FG is dispatched to a customer (B2B or B2C)
- Stock is transferred between plants with different GSTINs
- Stock is transferred to a different company

When implemented in Phase-3, the GST invoice will:
- Be linked to the dispatch instruction / stock transfer order
- Carry all tax fields filled with real values
- Have a unique invoice number (as per GST rules)
- Be cancellable via a credit note
- Be IRN-generated (e-invoice) if turnover threshold applies

**Phase-1 commitment:** All fields reserved. No computation. Status = NOT_APPLICABLE or PENDING.

### 67.4 GST Debit Note (Future — Phase-3)

A GST Debit Note is issued when:
- Taxable value of a transaction needs to be increased after invoice
- Additional tax is charged

When implemented:
- Linked to original invoice
- Carries amendment reason
- Updates tax liability

**Phase-1 commitment:** Document type reserved in document type master. No implementation.

### 67.5 GST Credit Note (Future — Phase-3)

A GST Credit Note is issued when:
- Customer returns goods
- Discount is given post-invoice
- Taxable value is reduced

When implemented:
- Linked to original invoice and return document
- Carries reason code
- Reduces tax liability

**Phase-1 commitment:** Document type reserved. Linked to return document from Phase-1. No computation yet.

### 67.6 E-way Bill Reference (Future — Phase-3)

E-way bill is required for movement of goods above ₹50,000 value within India.

When implemented:
- Generated via NIC API
- Linked to dispatch instruction or plant transfer order
- E-way bill number stored on the document
- Valid till date tracked
- Extension / cancellation tracked

**Phase-1 commitment:**
- E-way bill number field exists on document
- Valid till field exists
- Status field: NOT_GENERATED / GENERATED / CANCELLED / EXPIRED
- API integration: Phase-3

### 67.7 Tax Document Layer Design Rule

```
RULE: Stock movement and tax document are separate layers.

Stock posting (601, 303, 305 etc.)
  → Updates stock ledger
  → Updates current stock snapshot
  → Is independent of whether tax invoice exists

Tax invoice (Phase-3)
  → References the stock document
  → Carries all GST fields
  → Has its own number, status, cancel/amend flow
  → Does NOT re-post stock

If GST invoice is cancelled (credit note):
  → Tax document status changes
  → Stock is NOT automatically reversed
  → Stock reversal (602 etc.) is a separate decision

This separation ensures:
  → Stock accuracy is never dependent on GST status
  → GST can be added without redesigning stock flow
  → Audit trail for both layers is independent
```

---

## Section 68 — Plant Transfer Reports

### 68.1 Required Reports

| Report | Description |
|---|---|
| Plant transfer register | All transfers in period — source, target, material, quantity, value |
| Stock-in-transit report | All material currently in IN_TRANSIT bucket with expected receipt dates |
| Overdue in-transit report | In-transit shipments past expected receipt date |
| Transfer closure report | All transfers closed in period |
| Transfer return report | All transfer returns/reversals |
| Inter-plant stock position | Current stock at each plant with in-transit summary |
| Transfer valuation report | Value of stock transferred between plants |
| GST readiness report | All transfer documents with GST placeholder field status (Phase-1: shows NOT_APPLICABLE or PENDING) |

---

*— End of Part I —*

---

# PART J — PHYSICAL INVENTORY & REPORTS

---

## Section 69 — PID / Physical Inventory Document

### 69.1 What is a PID?

A Physical Inventory Document (PID) is the formal document used to conduct a stock count and reconcile the physical count with the system stock. It is the only authorized method to adjust stock quantity after go-live.

In SAP this maps to MI01 (create PID), MI04 (enter count), MI07 (post difference).

**Critical rule:** After go-live, no stock quantity can be adjusted except through a PID with movement 701 (gain) or 702 (loss). No manual stock edit. No direct table update.

### 69.2 When PID is Used

| Scenario | PID Required? |
|---|---|
| Annual physical stock taking | Yes |
| Cycle count (partial stock taking) | Yes |
| Spot check by auditor | Yes |
| Stock discrepancy investigation | Yes |
| Correction after go-live opening stock error | Yes |
| Opening stock correction on 1 July 2026 | Yes — only via PID after go-live |

### 69.3 PID Lifecycle

```
Step 1: PID Created
  - Plant, storage location, material (or all materials)
  - System stock snapshot captured at creation time
  - Stock is optionally "frozen" (no movements during count)
  ↓
Step 2: Physical Count
  - Stores team physically counts
  - Count entered into PACE against each PID line
  - Multiple count entries allowed (for large warehouses)
  ↓
Step 3: Difference Calculated
  - System compares physical count vs system count (at PID creation time)
  - Difference = Physical Count − System Count
  - Positive difference = GAIN (701)
  - Negative difference = LOSS (702)
  ↓
Step 4: Review
  - Stores manager reviews all differences
  - Large differences investigated
  - Recount if required
  ↓
Step 5: Approval
  - Management / authorized approver signs off on differences
  - No posting without approval
  ↓
Step 6: Posting
  - 701 posts gain — increases UNRESTRICTED stock
  - 702 posts loss — decreases UNRESTRICTED stock
  - Each line posted individually
  - Stock ledger updated
  - Current stock snapshot updated
  - Audit entry created
  ↓
Step 7: PID Closed
  - PID status → POSTED
  - No further modification allowed
  - Reports generated
```

### 69.4 PID Document Header Fields

| Field | Description | Mandatory |
|---|---|---|
| PID number | System-generated (company + plant + FY series) | Yes |
| PID date | Date of count | Yes |
| Company | | Yes |
| Plant | | Yes |
| Storage location | Specific location or ALL | Yes |
| Count type | FULL / CYCLE / SPOT | Yes |
| Count reference | Annual audit ref, cycle ref etc. | Optional |
| Stock freeze flag | Freeze movements during count? | Yes |
| Status | DRAFT / COUNT_IN_PROGRESS / REVIEW / PENDING_APPROVAL / POSTED / CLOSED | Yes |
| Created by | Stores manager | Yes |
| Approved by | Management / audit | Yes |
| Posting date | Date of 701/702 posting | System |

### 69.5 PID Line Fields

| Field | Description | Mandatory |
|---|---|---|
| Line number | Sequential | Yes |
| Material | Material code | Yes |
| Storage location | | Yes |
| Stock type | UNRESTRICTED / QA / BLOCKED | Yes |
| Batch / lot | If applicable | Conditional |
| System stock quantity | Captured at PID creation | System |
| System UOM | Base UOM | System |
| Physical count quantity | Entered by stores | Yes |
| Difference quantity | Physical − System | System |
| Difference type | GAIN / LOSS / NIL | System |
| Movement type | 701 (gain) / 702 (loss) / none | System |
| Difference value | Difference qty × valuation rate | System |
| Recount flag | Yes / No | Optional |
| Recount quantity | If recount done | Conditional |
| Posting status | PENDING / POSTED / SKIPPED | System |
| Remarks | Reason for difference | Conditional |

### 69.6 Movement Types for PID

| Movement | Description | Stock Type |
|---|---|---|
| 701 | Physical inventory gain — unrestricted | UNRESTRICTED |
| 702 | Physical inventory loss — unrestricted | UNRESTRICTED |
| 703 | Physical inventory gain — quality inspection | QUALITY_INSPECTION |
| 704 | Physical inventory loss — quality inspection | QUALITY_INSPECTION |
| 707 | Physical inventory gain — blocked | BLOCKED |
| 708 | Physical inventory loss — blocked | BLOCKED |

### 69.7 PID Approval Rules

| Difference Threshold | Approval Required |
|---|---|
| Zero difference | No approval — auto-close |
| Small difference (within configured % tolerance) | Stores manager approval |
| Large difference (above tolerance) | Management approval mandatory |
| High-value difference (above configured value) | Finance + Management approval |
| Negative stock after posting | Not allowed — error raised before posting |

### 69.8 PID and Valuation

When 701 (gain) is posted:
- Stock quantity increases
- Stock value increases = Gain qty × current weighted average rate
- Weighted average rate does not change (quantity increases at existing rate)

When 702 (loss) is posted:
- Stock quantity decreases
- Stock value decreases = Loss qty × current weighted average rate
- Weighted average rate does not change (quantity reduces at existing rate)

### 69.9 PID Restrictions

1. PID cannot be backdated without SA approval.
2. Only one active PID per storage location at a time (to prevent double counting).
3. Stock freeze during count: movements to/from frozen location are held or blocked (configurable).
4. PID cannot be deleted after posting — it is a permanent audit record.
5. If a PID posting error is found, a new corrective PID must be created — not a reversal of 701/702.

---

## Section 70 — Reports and Stock History

### 70.1 Report Design Principle

**All reports are derived from the stock ledger. No report uses a separate data source.**

Every stock quantity, every value, every movement shown in a report must trace back to a posted stock document in the ledger. If it cannot be traced, it is a data integrity issue, not a report issue.

```
Stock Ledger
  ↓
Backend query (filtered, paginated)
  ↓
Report
```

No frontend calculation of stock quantities. No frontend aggregation of values. Backend returns the result.

### 70.2 Core Stock Reports

| Report | Description | Key Filters |
|---|---|---|
| Current Stock Report | Snapshot of all stock by material + plant + location + stock type | Material, plant, company, stock type, date |
| Stock Ledger Report | Full movement history for a material | Material, plant, date range, movement type |
| Stock History Report | Opening + movements + closing for a period | Material, plant, period |
| Material Movement Report | All movements for a material in a period | Material, plant, movement type, date range |
| Stock Ageing Report | Stock held for how many days (FIFO-based) | Material, plant, location |
| Slow Moving Stock Report | Materials with no movement in N days | Plant, days threshold |
| Dead Stock Report | Materials with no movement in > 180 days | Plant |
| Negative Stock Alert | Any material with negative quantity | Plant |
| Stock Valuation Report | Qty + value + rate by material + plant | Plant, company, date |

### 70.3 Procurement Reports

| Report | Description |
|---|---|
| Open PO Report | All POs with pending balance quantity |
| PO Status Report | Status of all POs in a period |
| PO Delivery Tracking | Expected vs actual delivery per PO |
| Overdue PO Report | POs with expected delivery date passed |
| Consignment Status Report | All active consignments with current status |
| In-transit Report | All material currently in transit |
| Supplier Performance Report | On-time delivery, rejection rate by supplier |
| GRN Summary Report | All GRNs in a period by supplier, material, plant |
| QA Decision Report | Release/reject/block/scrap by material, supplier |
| Vendor Return Report | All 122 movements in period |

### 70.4 Production Reports

| Report | Description |
|---|---|
| Production Plan vs Actual | Planned output vs actual output by period |
| Process Order Status Report | All process orders with current status |
| Process Order Cost Report | Planned vs actual cost per process order |
| Material Consumption Report | All 261 issues in period by material, process order |
| Production Variance Report | Variance per process order — qty and value |
| FG Production Report | FG produced per material, per period |
| BOM Usage Report | Which BOMs are active, which process orders used them |
| BOM Where-Used Report | For a component — which BOMs use it |

### 70.5 Dispatch and Sales Reports

| Report | Description |
|---|---|
| Dispatch Register | All dispatches in period |
| Customer-wise Dispatch Report | Total dispatched to each customer |
| Material-wise Dispatch Report | Total dispatched per FG |
| Pending Dispatch Report | DIs approved but not dispatched |
| Customer Return Register | All returns with QA decision |
| FG Stock Report | Current FG stock by material, type, location |
| FG Batch Traceability | RM → process order → FG → customer |

### 70.6 Plant Transfer Reports

| Report | Description |
|---|---|
| Transfer Register | All transfers in period |
| Stock-in-Transit Report | All material currently in IN_TRANSIT |
| Overdue In-Transit Report | Past expected receipt date |
| Inter-plant Stock Position | Stock at each plant + in-transit |

### 70.7 Costing and Valuation Reports

| Report | Description |
|---|---|
| Material Valuation Report | Current stock value by material + plant |
| Weighted Average Rate History | Rate changes over time per material |
| Process Order Costing Report | Full cost breakdown per process order |
| FG Actual Cost Report | Actual cost per FG unit by batch |
| Scrap / Write-off Report | All scrap and write-off events with value |
| PID Adjustment Report | All 701/702 postings with value impact |
| Opening Stock Audit Report | Full opening stock with rates and approval trail |

### 70.8 Management Dashboard (Phase-2)

A management summary dashboard showing:
- Total stock value by plant
- Current stock alerts (negative, below safety stock)
- Open PO value and expected receipt
- In-transit value
- Production plan vs actual (current month)
- Dispatch plan vs actual (current month)
- Pending QA items
- Overdue POs and consignments

---

## Section 71 — Audit, Document Flow, Reversal and Cancellation

### 71.1 Audit Architecture

PACE Constitution requires erp_audit schema to be INSERT-only (append-only). Every operation management transaction creates an audit record.

**Every audit entry must contain:**

| Field | Description |
|---|---|
| Audit ID | Unique identifier |
| Event type | DOCUMENT_CREATED / APPROVED / REJECTED / POSTED / REVERSED / CANCELLED |
| Document type | PO / GRN / PROCESS_ORDER / DISPATCH / PID / TRANSFER etc. |
| Document number | Reference |
| Changed by | ACL user |
| Changed on | Timestamp |
| Previous status | Before change |
| New status | After change |
| Field changed | If specific field (for amendments) |
| Old value | Previous value |
| New value | New value |
| IP address | User's IP at time of action |
| Session reference | PACE session ID |
| Remarks | If reason required |

Audit entries are never deleted, never updated, never reversed. They are the permanent forensic record.

### 71.2 Document Flow

Every PACE operation document has a Document Flow view showing the complete chain:

```
Example for a GRN:

PR (PR-2026-0045)
  ↓
PO (PO-AC/RP125/2026-27)
  ↓
Consignment (CONS-2026-0089)
  ↓
Gate Entry (GE-2026-0112)
  ↓
GRN (GRN-2026-0201)
  ↓
QA Decision (QA-2026-0098)
  ↓
Stock Document (SD-101-2026-0201)
  ↓
Stock Ledger entries (LEDGER rows)
```

From any document, the user can navigate forward or backward in the document flow. This is critical for audit and investigation.

### 71.3 Reversal Discipline

**Golden rule: No document is deleted. Errors are corrected by reversal.**

| Document Type | Reversal Method | Reversal Movement |
|---|---|---|
| GRN (101) | Reversal GRN | 102 |
| QA release (321) | Not directly reversible — new QA decision | 322 |
| Issue to production (261) | Reversal issue | 262 |
| Goods issue dispatch (601) | Reversal GI | 602 |
| Customer return (651) | Reversal of return | 652 |
| Plant transfer issue (303) | Reversal | 304 |
| Plant transfer receipt (305) | Reversal | 306 |
| One-step transfer (301) | Reversal | 302 |
| Scrap (551/553/555) | Reversal | 552/554/556 |
| Opening stock (561/563/565) | Reversal (before go-live only) | 562/564/566 |
| PID (701/702) | New corrective PID — no direct reversal | New 701/702 |
| Vendor return (122) | Reversal | 123 |

### 71.4 Cancellation Discipline

Cancellation is different from reversal:

| Concept | Reversal | Cancellation |
|---|---|---|
| What it does | Reverses a POSTED transaction | Cancels a document that has NOT been posted yet |
| When used | After posting — to undo stock impact | Before posting — to abandon the transaction |
| Stock impact | Yes — counter-movement posted | No — no stock was ever posted |
| Example | Reversing a GRN after it was posted | Cancelling a PO before GRN |
| Audit | Yes — reversal document created | Yes — cancellation reason recorded |

Cancellation rules:
- Cancellation requires a reason.
- Cancellation is approved by the same or higher authority as creation.
- Cancelled documents are retained with CANCELLED status — not deleted.
- Cancelled PO lines do not affect received quantities.

### 71.5 Document Immutability Rules

| Action | Allowed? |
|---|---|
| Edit a POSTED document | No — reversal required |
| Delete a POSTED document | Never |
| Delete a CANCELLED document | Never |
| Edit a DRAFT document | Yes |
| Edit a PENDING_APPROVAL document | Only by creator before approval action |
| Back-date a document | Only with SA approval |
| Change movement type on a posted document | Never |
| Change quantity on a posted document | Never |

---

## Section 72 — SAP-Style Screen Map

### 72.1 Screen Design Principle

PACE-ERP uses SAP-inspired screen discipline but simplified for actual users:
- Header section with key document information
- Line item table with relevant columns
- Tabs for: Main / Additional Info / Document Flow / Approval Log / Audit History
- Status bar showing current document status
- Action buttons controlled by ACL + document status
- Create / Change / Display modes
- Reversal and cancellation as separate actions — not embedded in the main form

### 72.2 Screen Map by Transaction

| Module | Screen | SAP Equivalent | Key Elements |
|---|---|---|---|
| MM | Material Master | MM01/MM02/MM03 | Header tabs: Basic / UOM / Procurement / Production / Valuation / Plant Extensions |
| MM | Supplier Master | XK01/MK01 | Header tabs: Basic / Address / Financial / Procurement |
| MM | Supplier-Material Source | ME11/ME12 | Header + Validity + Price Info |
| MM | Purchase Requirement | ME51N | Header + Lines + Status |
| MM | Purchase Order | ME21N/ME22N | Header + Lines + Delivery + Status + Document Flow |
| LE | Consignment Tracker | Custom | Status timeline + ETD/ETA + Transport + Document Flow |
| LE | Gate Entry | Custom | Header + Vehicle + Material list + Gate Pass |
| MM | GRN | MIGO (101) | Header + Lines + Storage Location + Batch + Document Flow |
| QM | QA Decision | QA11 | Header + Lines + Decision + Movements + Audit |
| PP | BOM | CS01/CS02 | Header + Lines + Version + Active Flag + Where-Used |
| PP | Process Order | CO01/CO11N | Header + BOM Snapshot + Issue Lines + FG Receipt + Cost + Status |
| MM | PID | MI01/MI04/MI07 | Header + System Count + Physical Count + Difference + Approval |
| SD | Dispatch Instruction | VA01 | Header + Lines + Reservation + Status + Document Flow |
| SD | Goods Issue | VL02N | Header + Lines + Vehicle + Challan + Document Flow |
| SD | Customer Return | VL01N return | Header + Lines + QA Decision + Stock Type |
| MM | Plant Transfer | Custom | Header + Source/Target + Lines + Movement + Status + GST Fields |
| MM | Stock Ledger | MB51 | Filtered by material / plant / movement type / date |
| MM | Current Stock | MMBE | Material + Plant + Location + Stock Type grid |
| FI/CO | Stock Valuation | MB52 | Material + Plant + Value + Rate |

### 72.3 Common Screen Elements Across All Documents

Every operation document screen must have:

- **Document number** (top, prominent)
- **Status badge** (DRAFT / APPROVED / POSTED / CANCELLED etc.)
- **Create / Change / Display mode indicator**
- **Header section** — compact, key fields
- **Lines section** — tabular, scrollable, filterable
- **Tabs:**
  - Main (default view)
  - Additional Info (extra fields, collapsed by default)
  - Document Flow (linked documents chain)
  - Approval Log (who approved/rejected when)
  - Audit History (all changes)
- **Action buttons** — visible only if ACL allows and status permits:
  - Save Draft
  - Submit for Approval
  - Approve / Reject
  - Post
  - Reverse
  - Cancel
  - Print / Export PDF
- **Reference document links** — clickable navigation to related documents

### 72.4 ACL-Controlled Field Visibility

Not all fields are visible to all users:

| User Role | Field Visibility |
|---|---|
| Procurement user | Procurement fields, pricing |
| Stores user | Storage location, quantity, batch — no pricing |
| QA user | QA fields, decisions — no pricing |
| Finance user | Valuation, cost, pricing |
| Management | All fields |
| SA | All fields + governance fields |

Field-level ACL is enforced by the backend — frontend shows only what backend returns.

---

*— End of Part J —*

---

# PART K — DESIGN FREEZE & IMPLEMENTATION PLAN

---

## Section 73 — Risk Register

### 73.1 Risk Categories

| Risk ID | Risk Area | Description | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | Opening stock accuracy | Physical count on 30 June is inaccurate. Wrong opening stock posted. All subsequent reports are wrong from Day 1. | High | Critical | Mandatory physical count with cross-verification. Finance approval before posting. Trial migration before 25 June. |
| R-02 | Legacy PO double counting | Open PO balance is miscalculated. Received qty + open balance ≠ original PO qty. | Medium | High | Reconciliation formula enforced. Three-way check: opening stock + open PO + in-transit = original PO. Finance sign-off. |
| R-03 | In-transit migration error | Import consignments in customs wrongly included in opening stock. | Medium | High | Clear classification rule: gate entry done = opening stock. No gate entry = in-transit only. |
| R-04 | Number series continuity break | PO numbering resets or jumps. Supplier confusion. Audit failure. | Low | High | Last-used number documented and verified before go-live. SA configures counter directly. Trial run mandatory. |
| R-05 | Movement type error | Wrong movement type used = wrong stock type impact. Stock appears in wrong bucket. | Medium | High | Movement type master locked before go-live. User training on correct movements. Backend validation on every posting. |
| R-06 | BOM snapshot not frozen | New BOM change accidentally affects in-progress process orders. | Low | High | Snapshot taken at process order creation/release. System stores immutable copy. BOM change does not touch existing orders. |
| R-07 | Valuation method mismatch | Wrong valuation method assigned to material. Opening stock rate wrong. Weighted average corrupted from Day 1. | Medium | Critical | Valuation method locked per material before opening stock. Finance approval of opening rates. Cannot change after first posting. |
| R-08 | UOM conversion error | Wrong conversion factor. 1 packet = 4 bottles entered as 1 packet = 1 bottle. All quantities multiplied wrong. | Medium | High | UOM conversion table verified by stores before go-live. Trial migration tests conversions. |
| R-09 | Material plant extension missing | Material exists at company level but not extended to plant. GRN fails on Day 1. | High | Medium | Full material-plant extension list prepared and validated in trial migration. |
| R-10 | Supplier source mapping missing | Supplier not mapped to material + plant. PO creation fails. | High | Medium | Full supplier-material-plant mapping prepared and validated. Source list verified. |
| R-11 | Plant transfer valuation | Stock transferred at wrong rate. Target plant weighted average corrupted. | Medium | Medium | Transfer price type locked. Valuation rule per transfer scenario documented and approved. |
| R-12 | Pending QA in wrong stock bucket | Pending QA items on 30 June included in UNRESTRICTED opening stock instead of QA bucket. | Medium | High | QA pending list separately captured. Posted as QUALITY_INSPECTION (563) not unrestricted (561). |
| R-13 | Over-customization | Too many custom movement types, custom stock types, custom fields added. System becomes unmanageable. | Medium | Medium | Strict scope discipline. All custom additions require SA approval and design review. |
| R-14 | User training gap | Users do not understand SAP-style transaction discipline. Free-form entries, wrong documents. | High | High | Training program before go-live. User guides per role. Test users on sandbox before live. |
| R-15 | Report vs ledger discrepancy | Reports show different numbers than stock ledger. Audit failure. | Low | Critical | All reports strictly sourced from ledger. No separate calculation. Report reconciliation test before go-live. |
| R-16 | Approval bottleneck | Too many approvals slow down operations. Production halts waiting for approvals. | Medium | Medium | Approval matrix reviewed for practical thresholds. Auto-approval for low-value standard transactions if appropriate. |
| R-17 | GST placeholder fields missing | GST fields not designed in Phase-1. Phase-3 requires redesign of dispatch and transfer documents. | Low | High | All GST placeholder fields mandatorily included in Phase-1 document design. No post-freeze additions needed. |
| R-18 | Archive strategy delay | Stock ledger grows too large in active tables. Queries slow after 2 years. | Low | Medium | Archive design in place from Phase-1. 2-FY active, 3-5 FY archive tables, older external storage. |
| R-19 | Partial go-live complexity | Some plants/materials ready, others not. Hybrid operation creates confusion. | Medium | Medium | Clear go-live scope per plant. Migration status dashboard before go-live. Rules for hybrid operation period. |
| R-20 | Cost center not mapped | Process orders without cost center. Cost reporting fails. | Medium | Medium | Cost center framework mapped before go-live. All production sections linked to cost center. |

---

## Section 74 — Gap Control Checklist

This checklist must be completed and verified before implementation begins. Every item must have a status of FROZEN or DEFERRED (with reason and phase).

### 74.A — Governance and Architecture

| # | Item | Status |
|---|---|---|
| G-01 | PACE Constitution compliance verified for all operation design | |
| G-02 | SA-owned objects vs ACL-user-owned objects defined for every object | |
| G-03 | Backend-only authority confirmed for all stock movements | |
| G-04 | No direct stock edit possible from any frontend path | |
| G-05 | All documents have audit trail to erp_audit (append-only) | |
| G-06 | ACL capability defined for every operation transaction | |
| G-07 | Request pipeline compliance confirmed for all new endpoints | |
| G-08 | All new DB tables under named schema (not public) | |
| G-09 | Migration-first law confirmed — no manual DB edits planned | |
| G-10 | File discipline law noted for all implementation files | |

### 74.B — Organization and Master Data

| # | Item | Status |
|---|---|---|
| M-01 | Company master defined — all companies confirmed | |
| M-02 | Plant / work context defined — all plants confirmed | |
| M-03 | Business section / operating section defined — all sections confirmed | |
| M-04 | Storage location model designed and approved | |
| M-05 | Stock type master designed and locked | |
| M-06 | Movement type master designed and locked | |
| M-07 | Number series — all company + section + doc type + FY series defined | |
| M-08 | Cost center framework designed | |
| M-09 | Material category list confirmed | |
| M-10 | Material master template complete | |
| M-11 | Material company extension logic confirmed | |
| M-12 | Material plant extension logic confirmed | |
| M-13 | UOM master complete — all UOMs listed | |
| M-14 | UOM conversion table — all materials with multi-unit verified | |
| M-15 | Supplier master template complete | |
| M-16 | Supplier-material source / info record design confirmed | |
| M-17 | Approved source list design confirmed | |
| M-18 | Customer master template complete | |
| M-19 | BOM component type list confirmed | |
| M-20 | Valuation method assigned per material category — approved | |

### 74.C — Go-Live and Migration

| # | Item | Status |
|---|---|---|
| L-01 | Cut-off date confirmed: 30 June 2026 | |
| L-02 | Go-live date confirmed: 1 July 2026 | |
| L-03 | Physical stock count plan confirmed for 30 June | |
| L-04 | Opening stock migration method approved | |
| L-05 | Opening stock template validated | |
| L-06 | Opening stock includes quantity + rate + value per line | |
| L-07 | Pending QA stock captured as QUALITY_INSPECTION (not unrestricted) | |
| L-08 | Blocked stock captured as BLOCKED (not unrestricted) | |
| L-09 | Legacy open PO migration method approved | |
| L-10 | Legacy PO balance = original qty − received qty confirmed | |
| L-11 | In-transit migration method approved | |
| L-12 | Domestic in-transit captured separately from import in-transit | |
| L-13 | Pending gate entry handling confirmed | |
| L-14 | Pending GRN handling confirmed | |
| L-15 | Pending vendor return handling confirmed | |
| L-16 | No double-counting rule verified: opening stock + open PO + in-transit | |
| L-17 | Last PO number per series confirmed and documented | |
| L-18 | Number series counter set correctly before go-live | |
| L-19 | Trial migration completed and reconciled before 25 June | |
| L-20 | Management sign-off on opening stock before 1 July posting | |

### 74.D — Procurement Cycle

| # | Item | Status |
|---|---|---|
| P-01 | Procurement planning view design confirmed | |
| P-02 | Net available formula confirmed | |
| P-03 | PR lifecycle and fields confirmed | |
| P-04 | PO lifecycle and fields confirmed | |
| P-05 | PO amendment version history design confirmed | |
| P-06 | PO cancellation rules confirmed | |
| P-07 | Consignment status lifecycle confirmed | |
| P-08 | Gate entry document design confirmed | |
| P-09 | GRN design confirmed — storage location mandatory | |
| P-10 | GRN → QA routing logic confirmed per material | |
| P-11 | Inward QA usage decision flow confirmed | |
| P-12 | Vendor return (122) design confirmed | |
| P-13 | Import consignment — customs status fields confirmed | |
| P-14 | ETD/ETA tracking design confirmed | |

### 74.E — Stock Architecture

| # | Item | Status |
|---|---|---|
| S-01 | All storage locations defined per plant | |
| S-02 | All stock types defined and locked | |
| S-03 | Movement type master complete — all required movements listed | |
| S-04 | PACE custom movement range 901–999 reserved and documented | |
| S-05 | Stock document structure confirmed | |
| S-06 | Posting engine flow confirmed — no shortcut allowed | |
| S-07 | Stock ledger structure confirmed — append-only | |
| S-08 | Current stock snapshot design confirmed | |
| S-09 | Stock history equation confirmed — balances | |
| S-10 | Batch/lot tracking requirement confirmed per material | |
| S-11 | Costing policy confirmed — weighted average vs direct batch | |
| S-12 | Opening stock valuation method confirmed | |
| S-13 | Process order cost collection design confirmed | |
| S-14 | FG actual cost calculation confirmed | |
| S-15 | Returned FG reuse valuation confirmed | |
| S-16 | PID full flow confirmed — 701/702 only correction method after go-live | |
| S-17 | Archive strategy confirmed — 2-FY active, 3-5 archive, older external | |

### 74.F — Production and BOM

| # | Item | Status |
|---|---|---|
| B-01 | BOM structure confirmed — header, version, active flag, lines | |
| B-02 | BOM version lifecycle confirmed | |
| B-03 | Active BOM — one active at a time rule confirmed | |
| B-04 | BOM snapshot at process order creation/release confirmed | |
| B-05 | Old process orders retain old BOM snapshot — confirmed | |
| B-06 | Fixed BOM planning mode — BOM explosion logic confirmed | |
| B-07 | Admix actual formula capture per process order confirmed | |
| B-08 | Hybrid BOM deviation tolerance design confirmed | |
| B-09 | Process order lifecycle confirmed | |
| B-10 | Material reservation design confirmed | |
| B-11 | Material issue (261) design confirmed | |
| B-12 | Actual consumption vs BOM comparison design confirmed | |
| B-13 | Variance approval threshold defined | |
| B-14 | Production QA design confirmed | |
| B-15 | FG receipt design confirmed | |
| B-16 | FG QA and stock type transitions confirmed | |
| B-17 | FG batch tracking requirement confirmed | |

### 74.G — Dispatch, Returns, Transfer

| # | Item | Status |
|---|---|---|
| D-01 | Dispatch Instruction design confirmed | |
| D-02 | Picking and packing flow confirmed | |
| D-03 | Delivery challan design confirmed — GST placeholders included | |
| D-04 | Goods Issue (601) design confirmed | |
| D-05 | Partial dispatch design confirmed | |
| D-06 | Customer return (651) design confirmed | |
| D-07 | Return QA decision flow confirmed | |
| D-08 | Reuse flow (901) — costing and traceability confirmed | |
| D-09 | Rework flow confirmed | |
| D-10 | Scrap decision (551/553/555) confirmed | |
| D-11 | Plant transfer scenario classification confirmed | |
| D-12 | One-step transfer (301) design confirmed | |
| D-13 | Two-step transfer (303+305) design confirmed | |
| D-14 | Stock-in-transit logical bucket design confirmed | |
| D-15 | Transfer valuation rule confirmed per scenario | |
| D-16 | Transfer return/reversal design confirmed | |
| D-17 | GST placeholder fields on all dispatch/transfer documents confirmed | |
| D-18 | Inventory layer and tax layer separation confirmed | |
| D-19 | E-way bill field placeholder confirmed | |

### 74.H — Reports and Audit

| # | Item | Status |
|---|---|---|
| R-01 | All reports sourced from stock ledger only — confirmed | |
| R-02 | Stock history equation verified in trial migration | |
| R-03 | Document flow navigation confirmed for all documents | |
| R-04 | Audit trail — every transaction creates audit entry | |
| R-05 | Reversal discipline — no deletion, reversal movement only | |
| R-06 | Cancellation discipline — status CANCELLED, not deleted | |
| R-07 | Document immutability rules confirmed | |
| R-08 | Report pagination confirmed — no unbounded queries | |
| R-09 | Archive data routing confirmed — backend handles layer selection | |
| R-10 | Management dashboard design confirmed (Phase-2) | |

---

## Section 75 — Final Design Freeze Documents Required Before Coding

All of the following documents must exist, be reviewed, and be frozen before any implementation file is created. Each document is a separate SSOT.

| # | Document Name | Owner | Status Required |
|---|---|---|---|
| 1 | Operation Process Map | Architect + Business Owner | FROZEN |
| 2 | PACE Constitution Compliance Note | Architect | FROZEN |
| 3 | Governance & Object Ownership Matrix | Architect + SA | FROZEN |
| 4 | Organization Structure SSOT | Business Owner + SA | FROZEN |
| 5 | Business Section / Operating Section SSOT | Business Owner + SA | FROZEN |
| 6 | Master Data SSOT | Business Owner | FROZEN |
| 7 | Material Extension Design | Architect | FROZEN |
| 8 | Supplier Source / Procurement Source Design | Architect | FROZEN |
| 9 | UOM Conversion Design | Stores + Architect | FROZEN |
| 10 | Storage Location SSOT | Business Owner + SA | FROZEN |
| 11 | Stock Type SSOT | Architect + SA | FROZEN |
| 12 | Movement Type Master | Architect + SA | FROZEN |
| 13 | Costing & Valuation Policy | Finance + Architect | FROZEN |
| 14 | Opening Stock Migration Design | Architect | FROZEN |
| 15 | Legacy Open PO Migration Design | Architect | FROZEN |
| 16 | Legacy In-transit Migration Design | Architect | FROZEN |
| 17 | Number Series Continuity Design | SA + Procurement | FROZEN |
| 18 | Cut-off Reconciliation Design | Finance + Architect | FROZEN |
| 19 | Stock Posting Engine Design | Architect | FROZEN |
| 20 | Procurement Planning Design | Architect | FROZEN |
| 21 | PR / PO / Consignment Design | Architect | FROZEN |
| 22 | Gate Entry + GRN Design | Architect | FROZEN |
| 23 | Quality Design | Architect | FROZEN |
| 24 | BOM / Formula Design | Architect | FROZEN |
| 25 | Fixed BOM Planning Design | Architect | FROZEN |
| 26 | Admix Actual Formula Design | Architect | FROZEN |
| 27 | Hybrid BOM Deviation Design | Architect | FROZEN |
| 28 | Process Order Design | Architect | FROZEN |
| 29 | Production Costing Design | Finance + Architect | FROZEN |
| 30 | FG / Dispatch Design | Architect | FROZEN |
| 31 | Return / Reuse / Rework / Scrap Design | Architect | FROZEN |
| 32 | Plant-to-Plant Transfer Design | Architect | FROZEN |
| 33 | GST Future-Readiness Design | Finance + Architect | FROZEN |
| 34 | PID / Physical Inventory Design | Architect | FROZEN |
| 35 | Approval Matrix | Business Owner | FROZEN |
| 36 | Report Matrix | Business Owner + Architect | FROZEN |
| 37 | SAP-style Screen Map | Architect | FROZEN |
| 38 | Implementation Gate Plan | Architect | FROZEN |

**No implementation begins until all 38 documents are FROZEN.**

---

## Section 76 — Recommended Implementation Gate Plan

### Gate Structure for Operation Management

```
Gate-10: Operation Management Foundation
  ├── DB schema design (erp_inventory, erp_procurement, erp_production, erp_dispatch)
  ├── Movement type master table
  ├── Stock type master table
  ├── Storage location master
  ├── Number series engine
  ├── Stock posting engine (core)
  ├── Stock ledger table (append-only)
  ├── Current stock snapshot table
  └── Audit integration for all new tables

Gate-11: Master Data (L1)
  ├── Material master + company extension + plant extension
  ├── UOM master + conversion table
  ├── Supplier master + company extension
  └── Cost center master
  [NOTE: Vendor-Material Info Record, Approved Source List → Gate-13.2 (PO validation dependency)
         Customer Master → Gate-13.9 (Sales/Dispatch dependency)]

Gate-12: Opening Stock & Legacy Migration
  ├── Opening stock upload and validation
  ├── 561 / 563 / 565 posting
  ├── Legacy open PO migration
  ├── Legacy in-transit migration
  ├── Number series counter setup
  └── Migration reconciliation reports

Gate-13: Procurement Cycle — Full L2 (expanded — see Section 103 for complete detail)
  ├── Gate-13.1: L2 Masters (Port, Transit, Lead Time, Material Category, Transporter, CHA)
  ├── Gate-13.2: Purchase Order + Vendor-Material Info Record + Approved Source List
  ├── Gate-13.3: Consignment Tracking (CSN + ETA Cascade + Alerts + Tracker)
  ├── Gate-13.4: Gate Entry + Inbound Gate Exit
  ├── Gate-13.5: GRN
  ├── Gate-13.6: Inward QA
  ├── Gate-13.7: STO + Inter-Company Distribution
  ├── Gate-13.8: RTV + Debit Note + Exchange + Invoice Verification
  └── Gate-13.9: Sales/Dispatch RM/PM + Customer Master
  [NOTE: PR removed — no PR in PACE-ERP. Section 87.1 authoritative.]

Gate-14: Production & BOM
  ├── BOM master — version, active flag, snapshot
  ├── Process order full lifecycle
  ├── Material reservation
  ├── Material issue (261/262)
  ├── Actual consumption and variance
  ├── FG receipt
  ├── FG QA
  └── Production costing

Gate-15: Dispatch & Returns
  ├── Dispatch Instruction
  ├── Picking and packing
  ├── Goods Issue (601/602)
  ├── Delivery challan
  ├── Customer return (651/653/655/657)
  ├── Reuse (901)
  ├── Rework (909/911)
  └── Scrap (551/553/555)

Gate-16: Plant Transfer & Stock Movements
  ├── One-step transfer (301/302)
  ├── Two-step transfer (303/304 + 305/306)
  ├── Stock-in-transit bucket
  ├── Storage location transfer (311/312)
  ├── Stock type transfer (321/322/343/344/349/350)
  └── PID / Physical Inventory (701/702)

Gate-17: Reports & Closing
  ├── Stock ledger report
  ├── Current stock report
  ├── Procurement reports
  ├── Production reports
  ├── Dispatch reports
  ├── Costing reports
  ├── PID reports
  └── Document flow navigation

Gate-18: Advanced (Post Go-Live)
  ├── Quota arrangement
  ├── Full MRP planning
  ├── Management dashboard
  ├── Bin-level WM
  ├── GST invoice automation
  └── E-way bill API integration
```

---

## Section 77 — What Must Be Built Before 1 July 2026

| # | Item | Gate |
|---|---|---|
| 1 | DB schema and tables for all operation domains | Gate-10 |
| 2 | Movement type master + stock type master | Gate-10 |
| 3 | Stock posting engine | Gate-10 |
| 4 | Stock ledger (append-only) | Gate-10 |
| 5 | Current stock snapshot | Gate-10 |
| 6 | Number series engine | Gate-10 |
| 7 | Audit integration for all new tables | Gate-10 |
| 8 | Material master + extensions | Gate-11 |
| 9 | UOM master + conversion | Gate-11 |
| 10 | Supplier master + extensions | Gate-11 |
| 11 | Vendor-Material Info Record + Approved Source List | Gate-13.2 |
| 12 | Customer master | Gate-13.9 |
| 13 | Opening stock upload and posting (561/563/565) | Gate-12 |
| 14 | Legacy open PO migration | Gate-12 |
| 15 | In-transit migration | Gate-12 |
| 16 | Number series counter setup and validation | Gate-12 |
| 17 | Migration reconciliation reports | Gate-12 |
| 18 | Procurement planning view | Gate-13 |
| 19 | PR / PO full lifecycle | Gate-13 |
| 20 | PO amendment and cancellation | Gate-13 |
| 21 | Consignment tracking | Gate-13 |
| 22 | Gate entry | Gate-13 |
| 23 | GRN | Gate-13 |
| 24 | Inward QA | Gate-13 |
| 25 | BOM master with version and snapshot | Gate-14 |
| 26 | Process order full lifecycle | Gate-14 |
| 27 | Material issue (261) and reservation | Gate-14 |
| 28 | FG receipt and FG QA | Gate-14 |
| 29 | Dispatch Instruction and Goods Issue (601) | Gate-15 |
| 30 | Customer return and QA decision | Gate-15 |
| 31 | Reuse / rework / scrap movements | Gate-15 |
| 32 | One-step and two-step plant transfer | Gate-16 |
| 33 | Stock-in-transit | Gate-16 |
| 34 | PID / 701 / 702 | Gate-16 |
| 35 | Core stock and procurement reports | Gate-17 |
| 36 | Document flow navigation | Gate-17 |

---

## Section 78 — What Can Be Built After Go-Live

| # | Item | Phase |
|---|---|---|
| 1 | Quota arrangement (automatic supplier split) | Phase-2 |
| 2 | Management dashboard | Phase-2 |
| 3 | Advanced BOM — alternative BOM selection UI | Phase-2 |
| 4 | Advanced production scheduling | Phase-2 |
| 5 | Project-wise material issue (221) | Phase-2 |
| 6 | Landed cost import accounting | Phase-2 |
| 7 | Advanced supplier performance scoring | Phase-2 |
| 8 | Lab result integration for QA | Phase-2 |
| 9 | Route master for logistics | Phase-2 |
| 10 | Full cost center reporting | Phase-2 |
| 11 | Full MRP automation | Phase-3 |
| 12 | Bin-level warehouse management | Phase-3 |
| 13 | GST invoice automation | Phase-3 |
| 14 | GST debit note / credit note automation | Phase-3 |
| 15 | E-way bill API integration | Phase-3 |
| 16 | Full FI/GL journal integration | Phase-3 |
| 17 | Plant Maintenance (PM) module | Phase-3 |
| 18 | Full Project System (PS) module | Phase-3 |
| 19 | Advanced batch genealogy and classification | Phase-3 |
| 20 | Customer credit limit management | Phase-3 |

---

## Section 79 — Round-1 Discovery Questions

These are the only questions asked in Round-1. Do not proceed to Round-2 until all Round-1 answers are received.

Round-1 covers: Governance ownership, company/plant/section structure, PO number formats, material identity basics, UOM basics, and opening stock/migration source records.

---

### R1-Q01 — Company Structure

1. How many companies are there in total? Please list all company codes and full legal names.
2. For each company: what is the primary business (manufacturing, trading, both)?
3. Are there any companies that share a GST registration (same GSTIN)?
4. Are there any companies that operate under the same management but are legally separate?

---

### R1-Q02 — Plant and Work Context

1. How many plants/factories are there in total? Please list all plants, their names, and which company they belong to.
2. For each plant: what type of production happens there? (Fixed formulation / Admix / Both / No production / Trading only)
3. Are there any plants that belong to more than one company?
4. Are there any plants that are purely warehouses or distribution centers with no production?

---

### R1-Q03 — Business Section / Operating Section

1. How many business sections or operating sections are there within each company?
2. Please confirm: CMP003 has Admix Section and Powder Section — are there any other sections?
3. For CMP010: how many sections are there? Please name them.
4. Do different sections have completely separate procurement teams or is it one shared team?
5. Are there any sections where the same material is bought under different section codes?

---

### R1-Q04 — PO Number Series

1. For each company and section, what is the exact PO number format currently in use?
2. What is the last PO number used as of today (1 May 2026) for each series? (We will confirm the 30 June number closer to cut-off, but current number helps design the counter.)
3. Is the number counter per financial year (resets on 1 April) or calendar year or continuous?
4. For CMP010 — the format shown is Ji/POXXX/2026 — does this reset on 1 January each year?
5. Are there any other document series that must continue from legacy? (GRN numbers, Gate Entry numbers, etc.)

---

### R1-Q05 — Material Identity

1. How are materials currently identified? Is there an existing material code system?
2. If yes: what is the format? (e.g., RM-0001, PM-0001, or alphanumeric)
3. Should PACE continue the existing material codes or create a new coding system?
4. Are there any materials that are used across multiple companies under the same code?
5. Are there any materials with the same physical description but different codes at different plants? (duplicates to be merged or kept separate?)
6. Approximately how many materials are there in total? (rough count by category: RM, PM, consumable, FG, spare, etc.)

---

### R1-Q06 — Material Plant Extension

1. Are all materials used in all plants, or are there materials restricted to specific plants?
2. For import materials — do they arrive at a specific port/plant first, then transfer to other plants?
3. Are there any materials that are produced at one plant and transferred to another as semi-finished goods?

---

### R1-Q07 — UOM and Multi-Unit

1. What are the most common purchase UOMs currently in use? (e.g., KG, Litre, Bag, Packet, Drum, Box)
2. Can you give 3–5 examples of materials where the purchase unit and the stock/issue unit are different? (e.g., 1 bag = 50 KG, 1 drum = 200 litres, 1 packet = 4 bottles × 1 litre)
3. Are there any materials where the customer-facing unit is different from the production issue unit?
4. Are there any materials measured by count (NOS) where the weight is also tracked?

---

### R1-Q08 — Opening Stock Source Records

1. What system or register currently holds the stock records? (Excel, Tally, old ERP, physical register?)
2. Is the current stock register organized by plant + storage location, or just by plant?
3. Does the current record include stock value and rate, or only quantity?
4. Are there any materials currently in QA hold or blocked status that need to be captured separately?
5. Is there any batch/lot tracking currently in use for any material?

---

### R1-Q09 — Open PO Source Records

1. Where are current open POs tracked? (Excel, Tally, old ERP, manual?)
2. For each open PO, do you have: original quantity, received quantity, and balance quantity?
3. Do you have the original PO rate for each open PO line?
4. Are there any POs where the supplier has partially invoiced but material is not yet received?

---

### R1-Q10 — In-Transit Source Records

1. How many consignments are typically in transit at any given time?
2. For import consignments: at what stage are they tracked? (Pre-shipment / In-sea / At port / Customs / Road to plant)
3. Do you have ETD and ETA records for current in-transit consignments?
4. Are there any consignments where partial quantity arrived and partial is still in transit against the same PO line?
5. For import in-transit: is there a CHA (Customs House Agent) or freight forwarder who provides status updates?

---

> **Round-1 is complete. Please answer the above questions. Round-2 will cover: storage location details, stock type requirements, costing policy per material, BOM details, and production planning model.**

---

## Section 80 — Round-1 Discovery Answers (Documented)

**Date Captured:** 6 May 2026
**Status:** COMPLETE — All Round-1 answers received

---

### R1-A01 — Company Structure

| Item | Answer |
|---|---|
| Total companies | 12 currently |
| Future growth | May increase — structure is not fixed |
| All manufacturing? | No — not all companies are manufacturing |
| Structure fixed? | No — flexible, may change |

**Design Impact:**
- Company master must support unlimited company entries
- Company type field required: MANUFACTURING / TRADING / BOTH / OTHER
- SA must be able to add new companies without system change
- No hardcoded company count anywhere in the system

---

### R1-A02 — Plant / Work Context

| Item | Answer |
|---|---|
| Plants per company | 1 company = 1 plant |
| Total plants | 12 (one per company) |
| Plant-company relationship | 1:1 |

**Design Impact:**
- In PACE-ERP, company scope and plant scope are effectively the same for this business
- Stock ledger can use company + plant as a combined scope without confusion
- Cross-plant transfer = cross-company transfer in this case
- Material plant extension = material company extension effectively (but kept separate in design for future flexibility)

---

### R1-A03 — Business Section / Operating Section

| Item | Answer |
|---|---|
| Multi-section companies | A few — similar to CMP003 structure |
| Single-section companies | Most companies |
| CMP003 confirmed sections | Admix Section, Powder Section |
| Other sections | To be confirmed per company in Round-2 |

**Design Impact:**
- Section is optional per company — not every company has multiple sections
- If company has only one section, it operates as a default single section
- Number series, procurement team, and production mode are section-specific
- System must support 1 to N sections per company

---

### R1-A04 — PO Number Series

| Item | Answer |
|---|---|
| All companies have formats? | Yes — all companies have existing PO number formats |
| Format per company | Different for each company |
| Configuration method | SA must be able to configure format via UI per company + section |
| Hardcoded formats | Not acceptable — fully configurable |

**Design Impact:**
- Number series engine must be fully configurable via SA UI
- Per series, SA configures: company + section + document type + FY + prefix + number format + suffix
- No format is hardcoded in the system
- Legacy formats are preserved exactly — migrated via SA configuration before go-live
- New PO numbers auto-generate from configured format after go-live

---

### R1-A05 — Material Identity / Material Code

| Item | Answer |
|---|---|
| Existing codes | Some materials have existing codes, some do not |
| PACE code system | New system-generated code for all materials (mandatory) |
| External / legacy code | Maintained where it exists (optional field) |
| Dual code system | Yes — PACE code (primary) + External code (optional, linkable) |
| External code added later | When external code is linked to PACE code, it reflects everywhere automatically |

**Design Impact:**
- Material master has two code fields:
  - **PACE Material Code** — system-generated, always present, primary identifier
  - **External / Legacy Code** — manually entered, optional, updatable
- External code is searchable — user can search by either code
- When external code is added or updated on a material, all linked transactions, reports, BOM lines, and procurement records show the updated external code
- No material can exist without a PACE code
- Multiple external codes per material may be needed (supplier code, customer code) — to be confirmed in Round-2

---

### R1-A06 — Material Categories Confirmed

| Category | Business Name | PACE Code |
|---|---|---|
| Raw Material | RM | RAW_MATERIAL |
| Packing Material | PM | PACKING_MATERIAL |
| Intermediate | Intermediate | INTERMEDIATE |
| Finished Good | FG | FINISHED_GOOD |
| Others | To confirm in Round-2 | TBC |

**Design Impact:**
- `INTERMEDIATE` is used instead of `SEMI_FINISHED` — reflects actual business terminology
- Document updated accordingly
- Other categories (Consumable, Spare, Asset, Trading, Scrap, Service) to be confirmed in Round-2

---

### R1-A07 — UOM and Multi-Unit Conversion

| Scenario | Purchase Unit | Receive Unit | Issue / Use Unit | Conversion |
|---|---|---|---|---|
| Bag material (variable weight) | Bag | Bag | KG | 1 bag = 25 KG / 50 KG / 100 KG / 1 MT (varies) |
| Packet → Pieces | Packet | Packet | Pcs | 1 packet = 100 pcs |
| Packet → Bottle → Litre | Packet | Packet | Litre | 1 packet = 4 bottles = 4 litres |
| MT / KG material | MT or KG or Bag | MT or KG or Bag | KG | Standard metric conversion |

**Key User Requirement:**
> User enters quantity in whatever unit they are using. System converts to base UOM automatically. All stock, reports, and costing use base UOM internally.

**Design Impact:**

1. Every material has a **Base UOM** — stock ledger always stores in base UOM
2. **Purchase UOM**, **Issue UOM**, **Dispatch UOM** can each be different from base UOM
3. UOM conversion table per material defines all conversion factors
4. **Variable conversion flag** for bag-type materials:
   - Some bags are 25 KG, some are 50 KG
   - At GRN time, user enters actual weight received — system uses that for conversion
   - OR material has separate entries per bag size (25KG-bag, 50KG-bag)
   - To be confirmed in Round-2 which approach is preferred
5. User can enter in any configured UOM — backend converts before posting
6. Reports can display in any UOM — base UOM is the default

---

### R1-A08 — Opening Stock Source

| Item | Answer |
|---|---|
| Source system | Google Sheet — one per company |
| Prepared by | Business owner / stores per company |
| Preparation date | By 30 June 2026 |
| Content | Stock per material per company |

**Design Impact:**
- Opening stock upload template must be Google Sheet compatible
- Template format: downloadable from PACE, fillable in Google Sheets, uploadable back
- Validation runs on upload — errors reported line by line
- After validation and approval, 561/563/565 posting happens
- Upload template must include: Company, Plant, Storage Location, Material (PACE code + external code), Stock Type, UOM, Quantity, Rate, Value, Batch (if applicable), Remarks

---

### R1-A09 — Open PO Source

| Item | Answer |
|---|---|
| Source system | Google Sheet — already maintained |
| Data available | Yes — original qty, received qty, balance qty, rate |
| Migration format | Google Sheet → PACE upload template |

**Design Impact:**
- Open PO migration template must be Google Sheet compatible
- Template must preserve original PO numbers exactly
- Balance qty = original qty − received qty (validated on upload)
- Rate per line required for valuation
- Legacy PO numbers imported as-is — no renumbering

---

### R1-A10 — In-Transit Source

| Item | Answer |
|---|---|
| Source system | Google Sheet — already maintained |
| Import detail level | To be confirmed in Round-2 |
| Migration format | Google Sheet → PACE upload template |

**Design Impact:**
- In-transit migration template must be Google Sheet compatible
- Import vs domestic flag required per consignment
- Customs stage detail (at port / customs pending / cleared) to be confirmed in Round-2
- In-transit quantities must not overlap with opening stock — reconciliation mandatory

---

### Round-1 Summary — Design Decisions Locked

| Decision | Locked Value |
|---|---|
| Total companies at go-live | 12 — expandable |
| Plants per company | 1:1 relationship |
| Section model | Optional per company — 1 to N sections |
| Number series | Fully SA-configurable via UI — no hardcoding |
| Material code | Dual code: PACE code (mandatory) + External code (optional, linkable) |
| Material categories | RM, PM, INTERMEDIATE, FG — others to confirm Round-2 |
| UOM | User enters any unit — backend converts to base UOM — variable conversion for bags |
| Opening stock source | Google Sheet per company — upload template needed |
| Open PO source | Google Sheet — upload template needed |
| In-transit source | Google Sheet — upload template needed |

---

**Round-1 Status: COMPLETE**
**Next: Round-2 — Storage locations, stock types, costing policy, BOM details, production modes**

---

## Section 81 — MAJOR ARCHITECTURAL DECISION: Operation Type Template Model

**Decision Date:** 6 May 2026
**Status:** LOCKED
**Impact:** Affects entire Operation Management design approach

---

### 81.1 The Problem with Company-Specific Design

The initial approach in this document assumed company-specific designs:
- CMP003 → Admix design
- CMP003 → Powder design
- CMP010 → its own design

This approach creates:
- Duplication — same logic built multiple times
- Maintenance burden — one change needs updating in multiple places
- Inflexibility — adding a new company requires new build
- Complexity — system grows with every company added

---

### 81.2 The Correct Approach: Operation Type Template Model

> **Build operation types once. Assign to companies as needed.**

Instead of company-specific designs, PACE-ERP will build **Operation Type Templates**. Each template defines a complete operational mode — procurement, production, QA, dispatch — with its own rules and configuration.

A company is then assigned one or more Operation Types. The system delivers the correct operational behavior based on the assigned template.

```
Operation Type Templates (built once):
  ├── LIQUID_ADMIX
  ├── POWDER
  ├── TRADING
  ├── (others — defined in dedicated session)
  └── ...

Company Assignment:
  ├── CMP003 → LIQUID_ADMIX + POWDER
  ├── Company-X → LIQUID_ADMIX only
  ├── Company-Y → TRADING only
  └── Company-Z → POWDER + TRADING
```

---

### 81.3 What an Operation Type Template Defines

Each Operation Type Template configures:

| Configuration Area | Example |
|---|---|
| Production mode | FIXED_BOM / ADMIX_ACTUAL / HYBRID / TRADING |
| BOM required | Yes / No |
| QA flow | Lab test mandatory / Visual only / None |
| Procurement planning mode | BOM-driven / Min-max / Manual |
| Stock types active | Which stock types apply |
| Movement types active | Which movements are allowed |
| Number series pattern | Document numbering behavior |
| Approval rules | Which transactions need approval |
| Reports active | Which reports are relevant |
| Cost method | Weighted average / Direct (Phase-2) |
| Dispatch mode | Order mandatory / Direct allowed |
| Return handling | Reuse / Rework / Scrap options |

---

### 81.4 What Happens When a Company is Assigned a Template

When SA assigns an Operation Type to a company:
- That company's users see only the relevant screens and transactions
- Movement types, stock types, and approval rules are inherited from the template
- Number series is configured per company + template
- The company gets the full operational capability of that template
- No separate build needed for that company

---

### 81.5 Tweaks Within a Template

Each template has internal configuration options — tweaks — that allow minor differences without breaking the template structure.

Example:
- LIQUID_ADMIX template has a tweak: "reuse input allowed: Yes/No"
- POWDER template has a tweak: "humidity-controlled storage: Yes/No"

These tweaks are not designed now. They will be defined in a **dedicated Operation Type design session** for each template — when the business is ready for that discussion.

---

### 81.6 Design Sequence Impact

This architectural decision changes the design sequence:

**Old sequence (wrong):**
```
Design for CMP003 → Design for CMP010 → Design for others
```

**New sequence (correct):**
```
Step 1: Identify all Operation Types needed across all companies
Step 2: Design each Operation Type Template thoroughly
Step 3: Assign companies to templates
Step 4: Configure company-specific tweaks within template
Step 5: Go-live per company based on template assignment
```

---

### 81.7 Document Review Required

The following sections in this document were written with company-specific thinking. They must be reviewed and updated to reflect the Operation Type Template model:

| Section | Current State | Required Update |
|---|---|---|
| Section 8 — Organization Structure | References company-specific structure | Add Operation Type layer |
| Section 9 — Business Section Model | Section tied to company | Section tied to Operation Type |
| Section 46 — Fixed BOM Planning | Written generically — OK | Minor review |
| Section 47 — Admix Production | Written generically — OK | Minor review |
| Section 49 — Production Planning | References company/section | Add template context |
| Section 75 — Design Freeze Documents | Company-specific documents listed | Update to template-based documents |
| Section 76 — Implementation Gate Plan | Gates not template-aware | Update gates to include template design gate |

---

### 81.8 New Gate Added: Gate-10A — Operation Type Template Design

Before any implementation begins, a new gate is required:

**Gate-10A: Operation Type Template Design**
- Identify all Operation Types (dedicated session)
- Design each template fully — with all tweaks
- Map all companies to their templates
- SA configures template assignments
- Freeze all templates before coding

**This gate must complete before Gate-10 (Foundation) begins.**

---

### 81.9 Operation Type Identification — To Be Done

The actual Operation Types will be defined in a dedicated session. At that time:
- Business owner lists all distinct operational modes
- Each mode is designed as a template
- Tweaks within each mode are defined
- Company-to-template mapping is created and frozen

**Status: PENDING — Dedicated session required**

---

### 81.10 What This Does NOT Change

This decision does not change:
- PACE Constitution compliance
- Backend-authority model
- Stock ledger and posting engine design
- Movement type master
- Master data structure (material, supplier, customer)
- Opening stock migration approach
- Number series design
- Go-live timeline
- Round-1 and Round-2 answers

The core operational backbone remains the same. Only the **delivery and assignment model** changes — from company-specific to template-based.

---

**Architectural Decision Status: LOCKED**
**Operation Type Detail Design: PENDING — Dedicated session**
**Document Review: Required for sections listed in 81.7**

---

## Section 82 — Round-2 Discovery Answers (Documented)

**Date Captured:** 6 May 2026
**Status:** COMPLETE — All Round-2 answers received

---

### R2-A01 — Storage Location

| Item | Answer |
|---|---|
| Physical stores | Not formally separated in all plants |
| System approach | Logically defined in system — physical separation not mandatory |
| Code format | SAP-style — R001, P001, F001 etc. |
| Configuration | SA UI থেকে per company/plant configure করা যাবে |

**SAP Correction Applied:**
- Storage Location = Physical/logical place (R001, P001, F001)
- Stock Type = Status of stock within that location (Unrestricted, QA, Blocked)
- QA is NOT a separate storage location — it is a stock type within any location
- This is the correct SAP approach — confirmed and locked

**Proposed Storage Location Codes:**

| Code | Name | Purpose |
|---|---|---|
| R001 | Raw Material Store | RM and PM receipt and storage |
| P001 | Production Store | Materials staged for production |
| F001 | Finished Goods Store | FG after production |
| D001 | Dispatch Area | FG ready for dispatch |
| S001 | Scrap Area | Scrapped material |
| B001 | Blocked Store | Blocked material (if physically separated) |
| TK001 | Tank Location | Liquid material in tanks (if applicable) |

> Actual codes per company will be confirmed and configured by SA before go-live.

---

### R2-A02 — Stock Type Model

| Item | Answer |
|---|---|
| Base approach | SAP standard stock types |
| Expandable | Yes — master table approach, SA adds new types via UI |
| Phase-1 stock types | SAP standard 4 |
| Future stock types | Addable without system change |

**Stock Type Master — Phase-1 Active:**

| Code | Name | Available for Issue? |
|---|---|---|
| UNRESTRICTED | Unrestricted | Yes |
| QUALITY_INSPECTION | Quality Inspection | No — until 321 posted |
| BLOCKED | Blocked | No — role-restricted release to UNRESTRICTED |
| IN_TRANSIT | In Transit | No — logical state, 303/305 movement |
| FOR_REPROCESS | For Reprocess | No — Process Order consumption only, role-restricted |

> **FOR_REPROCESS added from Round-3 Admix Discovery.**
> Blocked → UNRESTRICTED reversal requires role-restricted movement (authorized persons only).

**Stock Types — Reserved, Activatable Later:**
- SCRAP, RETURNED, REUSE_HOLD, RESERVED, SCHEDULED — designed in system, SA activates when needed

**Design Rule:**
- Each stock type in master table has: code, name, available for issue flag, available for dispatch flag, requires approval to move flag, system/custom flag, active flag
- SA UI allows adding new stock types without developer involvement

---

### R2-A03 — Costing / Valuation Policy

| Item | Answer |
|---|---|
| Primary method | Weighted Average — all materials including import |
| Direct Batch Cost | Phase-2 provision — not Phase-1 |
| Import materials | Weighted Average (not direct cost) |
| Batch tracking | For traceability — not for separate valuation in Phase-1 |

**Design Rule:**
- Material master: valuation method field = WEIGHTED_AVERAGE (default, only option in Phase-1)
- DIRECT_BATCH_COST field exists in design and UI but is locked/non-selectable in Phase-1
- SA unlocks DIRECT_BATCH_COST option in Phase-2 when business is ready
- Weighted average engine fully built in Phase-1

---

### R2-A04 — BOM

| Item | Answer |
|---|---|
| BOM documented | Yes — available with business owner |
| Format | To be shared — will be used for PACE migration |
| BOM migration | Google Sheet / existing format → PACE BOM upload |

**Design Impact:**
- BOM upload template needed — compatible with existing BOM format
- BOM version 1 for all existing products loaded at go-live
- Future BOM changes follow full version + approval + activation flow

---

### R2-A05 — Production Modes by Company

| Company | Production Mode |
|---|---|
| CMP003 | All three: Fixed BOM + Admix/Flexible + Hybrid |
| Some companies | Admix/Flexible only (Mode 2) |
| Some companies | Fixed BOM + Hybrid (Mode 1 + 3) |
| Remaining companies | Non-manufacturing (Trading or other) |

**Design Impact:**
- Production mode is material-specific — not just company-specific
- Same company can have materials of different production modes
- Operation Type Template will define which modes are active per template
- CMP003 is the most complex — ideal test case for trial migration

---

### R2-A06 — Quality Management

| Item | Answer |
|---|---|
| QA type | Lab test mandatory |
| Visual check only | Not sufficient |
| 321 required | Yes — mandatory for all inward materials |
| Stock flow | GRN → QUALITY_INSPECTION → Lab test → QA decision → 321 → UNRESTRICTED |

**Design Impact:**
- Material master: QA required flag = YES (default)
- Lab result capture fields in Phase-1 — simple form (test name, result, passed/failed)
- 321 can only be posted by authorized QA user after lab result recorded
- No material goes to UNRESTRICTED without 321 posting

---

### R2-A07 — Physical Inventory / PID

| Count Type | Frequency |
|---|---|
| Cycle Count | Ongoing — rotating material selection |
| Quarterly Count | Every quarter |
| Annual / Year End | Full inventory at year end |

**Design Impact:**
- PID count type field: CYCLE / QUARTERLY / ANNUAL / SPOT
- Multiple PIDs can be open simultaneously for different materials/locations
- Cycle count: material or category selection flexible
- Annual count: all materials, all locations, all stock types
- Approval threshold varies by count type and difference value

---

### R2-A08 — Plant Transfer

| Item | Answer |
|---|---|
| Transfer happens | Yes — regularly |
| Physical transport | Yes — vehicle used |
| Commercial document | Required in some cases, not all |
| Decision per transfer | Case-by-case |

**Design Impact:**
- Two-step transfer (303 + 305) is the standard — physical transport involved
- Transfer Order has flag: COMMERCIAL_DOCUMENT_REQUIRED: Yes / No
- SA or authorized user can define rules: which plant-to-plant combinations require commercial document
- When required: challan generated, GST placeholder fields active
- When not required: internal transfer document only
- Stock-in-transit bucket active during transit period

---

### R2-A09 — Dispatch / Sales

| Item | Answer |
|---|---|
| Order mandatory | Yes — dispatch cannot happen without customer order |
| Ad-hoc dispatch | Not allowed |
| Flow | Order → Dispatch Instruction → Picking → Goods Issue (601) |

**Design Impact:**
- Goods Issue (601) posting requires valid, approved Dispatch Instruction
- Dispatch Instruction requires customer order reference (mandatory field)
- System enforces sequence — no shortcut allowed
- Backend validates order reference before allowing GI posting

---

### R2-A10 — Customer Return

| Item | Answer |
|---|---|
| Returns happen | Yes |
| Typical outcome | Reuse or Rework — as per requirement |
| Scrap | Rarely — not the default path |

**Design Impact:**
- Return QA decision options: REUSE / REWORK / SCRAP
- SCRAP option available but not default
- Reuse: Movement 901 → REUSE_HOLD → production input with approved value
- Rework: separate rework process order created
- All three paths fully designed in Phase-1

---

### R2-A11 — Reports

| Report Category | Required |
|---|---|
| Current stock position | Yes — critical |
| PO status / pending deliveries | Yes — critical |
| Production vs plan | Yes — critical |
| Dispatch summary | Yes |
| Cost reports | Yes |

**Design Impact:**
- All report categories are Phase-1 requirements
- No report category deferred to Phase-2
- All reports sourced from stock ledger — no separate calculation
- Management needs visibility across all categories

---

### Round-2 Summary — Additional Design Decisions Locked

| Decision | Locked Value |
|---|---|
| Storage location model | SAP-style codes (R001, P001, F001) — SA configures per company |
| QA = stock type, not location | Confirmed — correct SAP approach |
| Stock type model | Expandable master table — Phase-1: 4 SAP standard types |
| Costing | Weighted Average Phase-1. Direct cost provision reserved for Phase-2. |
| BOM | Available — to be shared for migration |
| Production modes | Material-specific — not company-specific |
| QA | Lab test mandatory — 321 required before UNRESTRICTED |
| PID | Cycle + Quarterly + Annual — all supported |
| Plant transfer | Two-step. Commercial document = case by case flag. |
| Dispatch | Order mandatory — no ad-hoc dispatch |
| Customer return | Reuse / Rework primary. Scrap rare. |
| Reports | All categories — Phase-1 |

---

**Round-2 Status: COMPLETE**
**Major Architectural Decision Locked: Operation Type Template Model (Section 81)**
**Next: Operation Type Template Design Session — dedicated discussion**

---

---

## Section 83 — Round-3 Discovery Answers: Admix / Liquid Operation Type

**Discovery Session Date:** May 2026
**Scope:** Admix / Liquid production operation type — detailed business process discovery
**Status:** IN PROGRESS — vessel design and tolerance values pending

---

### 83.1 — Order Number Structure

| Item | Decision |
|---|---|
| Formulation Order Number | External — received from customer/external system, NOT generated by PACE-ERP |
| Sales Order Number | External — received from customer/external system, NOT generated by PACE-ERP |
| Process PO Number | Internal — PACE-ERP generates |
| Packing PO Number | Internal — PACE-ERP generates |
| Formulation Order → Process PO | One-to-many (partial batches allowed) |
| Formulation Order Number at creation | Optional — can be blank, filled later |
| Formulation Order Number update | Allowed — via controlled system action, full audit trail (old value preserved) |

**Design Rule:** Formulation Order Number and Sales Order Number are reference fields only — stored on Process PO and Packing PO respectively. Direct DB edit is not required or permitted; system provides a tracked update action.

---

### 83.2 — Production Types: MTO vs MTS

| Type | Trigger | Formulation Order No | Notes |
|---|---|---|---|
| Make-to-Order (MTO) | Formulation Order received | Required at creation | Custom / variable formulation products |
| Make-to-Stock (MTS) | Advance production (fixed formulation) | Blank at creation, filled at mapping | Fixed-formulation products produced proactively |

**MTS Flow:**
```
Produce FG in advance (no order)
     ↓
Formulation Order + Sales Order arrive
     ↓
Map to existing FG stock
     ↓
Dispatch
```

---

### 83.3 — Stroke System (Formulation Templates)

| Item | Decision |
|---|---|
| Stroke definition | Pre-defined named formulation templates (Stroke 1, Stroke 2, ...) |
| Stroke recall | At Process PO creation — user selects stroke |
| Costing basis | Current rates at time of order (not historical stroke rates) |
| Customer-specific strokes | No — same stroke available for all customers |
| Ordered stroke cost | Captured at Process PO creation (based on current rates) |
| Actual stroke cost | Captured at actual goods issue |
| Variance | Ordered cost vs actual cost → finance reconciliation → receivable/payable |

---

### 83.4 — Process PO and Packing PO (Two-Order Model)

**Process PO:**
- Covers formulation/stroke-based production
- Consumes RM components
- Produces: unpacked / bulk FG or Intermediate RM
- Linked to: Formulation Order Number (reference)

**Packing PO:**
- Separate from Process PO
- Packing type decided at **FG Declaration time**
- Packing BOM pulled automatically at creation
- Components: qty editable (min = 0, no delete), new lines addable
- In-order goods movement: 261 (issue) and 262 (reversal) from within order
- Linked to: Sales Order Number (reference)

**Packing Change Scenarios:**

| Scenario | Trigger | Action |
|---|---|---|
| Pre-declaration change | Drum → Tank before FG declared | Amendment at FG Declaration, new Packing PO |
| Post-pack logistics change | Drum packed, truck unavailable, tank arranged | Reverse Packing PO, create new Packing PO (tank) |
| Cost impact | Always | Packing type change = costing update = invoice update |

**Packing is never part of Stroke definition.**

---

### 83.5 — Intermediate RM

| Item | Decision |
|---|---|
| All products | No — only applicable products have intermediate step |
| Flow | RM → [Process PO 1] → Intermediate RM stock → [Process PO 2 + other RMs] → FG |
| Intermediate PO type | Separate independent Process PO |
| Formulation Order Number on Intermediate PO | Not required — intermediate is treated as any other RM |
| Material code | Intermediate RM has its own PACE material code |
| Stock | Goes into inventory like any RM — weighted average cost tracked |
| Reusability | Intermediate RM stock can be consumed by any compatible FG Process PO |

---

### 83.6 — FG Reuse and Return Reuse

| Scenario | Flow | Stock Type Path |
|---|---|---|
| Undispatched FG → RM reuse | Authorized user reclassifies FG stock | UNRESTRICTED → FOR_REPROCESS |
| Rejected / returned material → reuse | QA re-evaluation → approval | BLOCKED / QA → FOR_REPROCESS |
| FOR_REPROCESS consumption | Process PO issues this material as RM component | FOR_REPROCESS → (consumed, stock reduced) |
| FOR_REPROCESS cancelled | Authorized user reverses | FOR_REPROCESS → UNRESTRICTED |

**Design Rules:**
- Material code retained (no new code created for reprocessing)
- Weighted average cost of reprocessed material flows into consuming Process PO costing
- All FOR_REPROCESS movements: role-restricted, full audit trail

---

### 83.7 — Batch Number

| Item | Decision |
|---|---|
| Format | Follows existing business batch number format (to be provided by business owner) |
| PACE-ERP role | Continue existing format — does not generate new format |
| Reset | Resets every financial year |
| Generation | PACE-ERP generates sequential numbers per financial year following provided format |

> **Action Required:** Business owner to share existing batch number format before implementation.

---

### 83.8 — FIFO and Expiry Tracking

| Item | Decision |
|---|---|
| Scope | Material-level flag — ON/OFF per material |
| GRN tracking | Expiry-enabled materials: expiry date captured at GRN time |
| Stock tracking | GRN-level lot tracking (each GRN = separate lot with own stock + expiry) |
| Goods Issue behavior | FIFO list shown (oldest GRN first), expiry date visible per GRN line |
| Auto-split | If quantity spans multiple GRNs → auto-split into multiple lines |
| Non-consuming stock | Approaching-expiry GRNs not being consumed → escalation |

**FIFO Goods Issue Example:**
```
Process Order needs 100 kg of Material X

Goods Issue Screen (FIFO order):
  Line 1: GRN-001 → 40 kg  | Expiry: 30-Jun-2026  ← oldest
  Line 2: GRN-002 → 60 kg  | Expiry: 15-Sep-2026  ← auto-split

User reviews → confirms → movement posted
```

---

### 83.9 — Machine / Mixer Master and Assignment

| Item | Decision |
|---|---|
| Entity name | Machine / Mixer (not "vessel" — covers mixers, tanks, any production equipment) |
| Master attributes | Machine name, Company/Plant assignment, Active/Inactive flag |
| Plant assignment | Company or Plant level — SA defines |
| Master managed by | SA only (create, edit, deactivate) |
| Process PO assignment | Mandatory — user selects from dropdown list of machines for that plant |
| Multi-PO assignment | Allowed — one machine can appear on multiple active Process POs simultaneously |
| Capacity conflict check | Not required — no blocking on simultaneous assignment |

**Design Rule:**
- Machine master is SA-controlled master data
- Plant users see only machines assigned to their plant
- At Process PO creation: machine field is mandatory, cannot save without selection

---

### 83.10 — Under / Over Delivery Tolerance

| Item | Decision |
|---|---|
| Scope | All production orders — not Admix-specific |
| Level | FG Material Master |
| Enable / Disable | Per FG material — configured via UI by SA/authorized user |
| Under Delivery Tolerance | % value — set per FG material when enabled |
| Over Delivery Tolerance | % value — set per FG material when enabled |
| Breach behavior | HARD BLOCK — goods movement not allowed |
| Override | Authorized user opens specific PO → edits tolerance for that PO only |
| Override scope | That PO only — material master tolerance unchanged |
| Audit trail | Mandatory on every override (who, when, old value, new value) |
| Override authority | Role-restricted — approved users only |

**Design Rule:**
- At Process PO creation: tolerance values copied from FG material master
- Material master is the default source — PO holds its own copy (overridable)
- Disabled tolerance = no check, goods movement proceeds freely
- SA manages which materials have tolerance enabled via material master UI

---

### 83.11 — Shelf Life

| Item | Decision |
|---|---|
| FG shelf life | Required — expiry date tracked |
| RM shelf life | Required — expiry date tracked (linked to FIFO + expiry flag per material) |
| Expired stock path | Blocked stock type |
| Blocked → Unrestricted reversal | Role-restricted action only (authorized personnel) |

---

### Round-3 Summary — Admix/Liquid Decisions Locked

| Decision | Locked Value |
|---|---|
| Order number model | Formulation Order No + Sales Order No = external reference. Process PO + Packing PO = PACE-ERP generated |
| Formulation Order No update | Controlled system action — full audit trail |
| Production types | MTO (custom) + MTS (fixed formulation) — both supported |
| Stroke system | Pre-defined templates, current rate costing, ordered vs actual variance tracked |
| Two-order model | Process PO (formulation) + Packing PO (packing) — always separate |
| Packing type lock | FG Declaration time |
| Packing change | Reverse Packing PO + create new — cost + invoice updated |
| Intermediate RM | Separate independent Process PO, own material code, own stock |
| FG reuse / return reuse | FOR_REPROCESS stock type, role-restricted, material code retained, cost flows through |
| Batch number | Existing format (TBD), financial year reset, PACE-ERP continues sequence |
| FIFO + expiry tracking | Material-level ON/OFF flag, GRN-level lot tracking, auto-split at goods issue |
| Expiry → Blocked | Automatic. Blocked → Unrestricted: role-restricted only |
| Vessel assignment | Per batch — master design pending |
| Tolerance | Under + over delivery — values pending |
| Stock types (final Phase-1) | UNRESTRICTED, QUALITY_INSPECTION, BLOCKED, IN_TRANSIT, FOR_REPROCESS |

---

**Round-3 Status: IN PROGRESS**
**Pending:** Vessel master design, tolerance values, batch number format
**Next:** Complete Admix discovery → move to other Operation Types

---

---

## Section 84 — Foundation Layer Discovery (Layer 1 — Complete)

**Discovery Session:** May 2026
**Scope:** Material Master, Storage Location, Stock Architecture, Movement Types
**Status:** COMPLETE

---

### 84.1 — Material Types (Confirmed)

| Code | Name | Status | Notes |
|---|---|---|---|
| RM | Raw Material | ✅ Active | |
| PM | Packaging Material | ✅ Active | |
| INT | Intermediate | ✅ Active | Produced internally, treated as RM in next stage, never sold |
| FG | Finished Goods | ✅ Active | Has Shade Code + Pack Code + External SKU |
| TRA | Trading Goods | ⏸ Provision | SA activates when needed |
| CONS | Consumables | ⏸ Provision | SA activates when needed |

**SFG not needed** — INT covers all intermediate/semi-finished scenarios. INT material, when ready, is always treated as RM in the next stage, never sold externally.

---

### 84.2 — Material Master Core Fields (Confirmed)

**Basic Identification:**

| Field | Notes |
|---|---|
| PACE Code | Auto-generated. Format: RM-00001, FG-00001 etc. Never changes. |
| External / Legacy Code | Optional, updateable anytime. All references update automatically. |
| Material Description | Short + Long |
| Material Type | RM / PM / INT / FG / TRA / CONS |
| Material Group / Category | For reporting grouping |
| Active / Inactive flag | SA controlled |

**FG-specific fields:**

| Field | Notes |
|---|---|
| Shade Code | Production identity (e.g., 13540908) — FG only |
| Pack Code | Pack size variant (e.g., 320 = 20KG pack) — FG only |
| External SKU | Shade Code + Pack Code concatenated (e.g., 13540908320) — FG only |

**UOM:**

| Field | Notes |
|---|---|
| Base UOM | Primary stock unit |
| Alternative UOM | Multiple allowed |
| Conversion factor | Per alt UOM |
| Variable conversion flag | For bags where weight varies per GRN |

**Procurement / Planning (Plant-specific — per plant extension):**

| Field | Notes |
|---|---|
| Procurement type | External / In-house / Both |
| Lead time | Days |
| Safety stock level | Per plant |
| Reorder point | Per plant |
| Minimum order quantity | Per PO |
| Default storage location | Per plant — where GRN lands by default |
| Import / Domestic flag | Affects costing |

**Production (FG / INT only):**

| Field | Notes |
|---|---|
| Production mode | Fixed BOM / Admix-Stroke / Hybrid |
| BOM exists flag | Yes / No |
| Delivery tolerance enabled | Yes / No |
| Under delivery tolerance % | If enabled — copied to Process PO at creation |
| Over delivery tolerance % | If enabled — copied to Process PO at creation |

**Batch / Traceability:**

| Field | Notes |
|---|---|
| Batch tracking flag | Yes / No |
| Batch number series | Which prefix series (linked to Batch Series Master) |
| FIFO tracking flag | Yes / No — material level ON/OFF |
| Expiry tracking flag | Yes / No |
| Shelf life duration | Days / Months |
| Min remaining shelf life at GRN | Days — minimum expiry remaining when received |

**Valuation / Costing:**

| Field | Notes |
|---|---|
| Valuation method | WEIGHTED_AVERAGE (Phase-1 only) |
| Valuation class | For costing grouping |
| Current weighted average rate | System calculated |

**Tax / Compliance:**

| Field | Notes |
|---|---|
| HSN / SAC code | GST placeholder |
| GST rate category | Placeholder — tax layer separate |

**Alternative Materials:**

| Field | Notes |
|---|---|
| Primary material | This material itself |
| Alternatives list | Materials that can substitute — per product BOM |

---

### 84.3 — Material Master Governance

| Action | Who | Approval | Notes |
|---|---|---|---|
| Create | Material Controller | Yes — single Approver | Goes Draft → Pending → Active |
| Edit | Material Controller | Yes — re-approval required | Current version active until approved |
| Deactivate | SA / Approver | N/A | Zero stock + no open PO + no open orders required |
| Bulk migration upload | SA | No approval | Directly Active |
| View | Role-based (ACL) | — | |

**Deactivation Hard Block Conditions:**
```
Block if ANY of:
  → Physical stock > 0
  → Open PO exists for this material
  → Open Process Order references this material
  → Open Packing Order references this material
```

---

### 84.4 — Material Category Group (Functional Equivalence)

For materials that are functionally interchangeable (e.g., RDP group: Vinnapass 5010N, DA 1100, RP4099):

| Design Element | Decision |
|---|---|
| Category Group Master | SA defines groups (e.g., RDP_GRP) + members |
| BOM approach | Primary material + alternatives listed (NOT category reference) |
| Planning | Category group used for aggregate requirement calculation |
| PO / Consumption | Specific material only — not category |
| Validation at Process Order | System checks: is this alternative valid for this product? |

**BOM Example:**
```
Product A BOM:
  → DA1100 (primary) | Alternatives: RP4099, 5010N

Product B BOM:
  → DA1100 (primary) | Alternatives: 5010N only (RP4099 not valid here)
```

---

### 84.5 — Vendor-Material Info Record

Separate record (not in Material Master, not in Vendor Master):

| Field | Notes |
|---|---|
| Material (PACE code) | |
| Vendor | |
| Vendor's material code / description | |
| Vendor UOM + pack size conversion | e.g., Vendor A: 1 packet = 100 KG, Vendor B: 1 packet = 200 KG |
| Lead time | Days |
| Last purchase price | Reference |
| Preferred vendor flag | |
| Valid from / to date | |

---

### 84.6 — Storage Location Architecture

| Design Element | Decision |
|---|---|
| Location master | Global — defined once |
| Plant assignment | SA maps location to plant via UI |
| User visibility | ACL + Context filtered — user sees only their plant's locations |
| Multi-company users | ACL grants multiple plants — context switch to see each |
| Active locations | RM Areas (R001, R002, R003...), PM Area (P001), Shop Floor (S001), Tank (T001) |
| FG Area | F001 (and others as needed) |
| Outdoor / Yard | Provision only — SA adds when needed |
| New location | SA creates globally → maps to plant → active |

**Location Transfer Rule:**
```
SA configures per source → destination pair:
  One-step or Two-step

Two-step (confirmed):
  S001 → F001 (Shop Floor → FG Area)
  P303 → P305 (Plant to Plant)
  Any functional boundary crossing — SA configures

One-step (confirmed):
  R001 → R002 (Same functional area)
  Other same-zone transfers — SA configures
```

---

### 84.7 — Stock Architecture

| Design Element | Decision |
|---|---|
| Stock Ledger | Append-only (INSERT only). Source of truth. Follows erp_audit pattern. |
| Current Stock Snapshot | Maintained per movement. Fast reads. Summary table (Constitution compliant). |
| Integrity check | Periodic backend job — Snapshot vs Ledger reconciliation. SA alert on discrepancy. |
| Write | Always to Ledger first |
| Read | Always from Snapshot |
| Audit | Always from Ledger |
| Archive | Ledger follows Part 4 Hybrid Archive (2 FY active, 3-5 FY archive, 5+ external) |
| Snapshot | Always active — never archived |

**Constitution compliance confirmed:**
- Section 2.3 (append-only) ✅
- Part 2 Section 5 (< 500ms, summary tables) ✅
- Part 2 Article 6 (no unbounded queries) ✅
- Part 4 (Hybrid Archive Architecture) ✅

---

### 84.8 — Movement Types (P-Prefix — Complete List)

**All movement types carry PACE P-prefix. Legal basis: movement type numbers are industry-standard concepts, not SAP IP.**

| Code | Name | Reversal |
|---|---|---|
| **GRN / Procurement** | | |
| P101 | GRN receipt (PO) | P102 |
| P102 | P101 reversal | — |
| P103 | GRN to blocked stock | P104 |
| P104 | P103 reversal | — |
| P122 | Return to vendor (unrestricted) | P123 |
| P123 | P122 reversal | — |
| P124 | Return to vendor (blocked) | P125 |
| P125 | P124 reversal | — |
| **Stock Type Transfer** | | |
| P321 | QA → Unrestricted | P322 |
| P322 | Unrestricted → QA | P321 |
| P323 | QA → Blocked | P324 |
| P324 | P323 reversal | — |
| P343 | Blocked → Unrestricted (role-restricted) | P344 |
| P344 | Unrestricted → Blocked | P343 |
| P349 | Blocked → QA | P350 |
| P350 | QA → Blocked | P349 |
| **Location Transfer** | | |
| P311 | Same plant, location A → B | P312 |
| P312 | P311 reversal | — |
| **Plant Transfer** | | |
| P303 | Source plant issue (two-step) | P304 |
| P304 | P303 reversal | — |
| P305 | Destination plant receive (two-step) | P306 |
| P306 | P305 reversal | — |
| **Production** | | |
| P101 | FG receipt from production order | P102 |
| P261 | GI to production/process order | P262 |
| P262 | P261 reversal | — |
| **Dispatch** | | |
| P601 | GI for dispatch (delivery) | P602 |
| P602 | P601 reversal | — |
| **Customer Returns** | | |
| P651 | Customer return receipt | P652 |
| P652 | P651 reversal | — |
| P653 | Return → Unrestricted | P654 |
| P654 | P653 reversal | — |
| P655 | Return → QA | P656 |
| P656 | P655 reversal | — |
| P657 | Return → Blocked | P658 |
| P658 | P657 reversal | — |
| **Physical Inventory** | | |
| P561 | Opening stock | P562 |
| P562 | P561 reversal | — |
| P701 | PID surplus (count > book) | Manual correction |
| P702 | PID deficit (count < book) | Manual correction |
| **Scrap** | | |
| P551 | Scrap from Unrestricted | P552 |
| P552 | P551 reversal | — |
| P553 | Scrap from QA | P554 |
| P554 | P553 reversal | — |
| P555 | Scrap from Blocked | P556 |
| P556 | P555 reversal | — |
| **Reclassification** | | |
| P309 | Material to material (FOR_REPROCESS) | P310 |
| P310 | P309 reversal | — |
| **FOR_REPROCESS (role-restricted)** | | |
| P901 | Unrestricted → FOR_REPROCESS | P902 |
| P902 | P901 reversal | — |
| P903 | Blocked → FOR_REPROCESS | P904 |
| P904 | P903 reversal | — |
| P905 | QA → FOR_REPROCESS | P906 |
| P906 | P905 reversal | — |

---

### 84.9 — Foundation Layer Summary

| Area | Status | Key Decisions |
|---|---|---|
| Material Types | ✅ Locked | RM, PM, INT, FG active. TRA, CONS provision. |
| PACE Code format | ✅ Locked | Prefix + sequential. Never resets. Auto-generated. |
| Material Master fields | ✅ Locked | Full attribute list confirmed including FG-specific fields |
| Material governance | ✅ Locked | Material Controller creates, single Approver. Migration = direct active. |
| Material Category Group | ✅ Locked | Primary + alternatives in BOM. Category for planning only. |
| Vendor-Material Info | ✅ Locked | Separate record with vendor-specific pack size + conversion |
| Storage Location | ✅ Locked | Global master + plant mapping. ACL filtered. |
| Location Transfer Rule | ✅ Locked | SA configures one-step/two-step per source-destination pair |
| Stock Architecture | ✅ Locked | Ledger (append-only) + Snapshot (fast read). Constitution compliant. |
| Movement Types | ✅ Locked | P-prefix. Complete list. Legally distinct from SAP. |

---

**Layer 1 — Foundation: COMPLETE**
**Next: Layer 2 — Procurement Discovery**

---

## Section 85 — Layer 2: Procurement Discovery

**Session Date:** 9 May 2026
**Status:** ✅ COMPLETE
**Scope:** Plan Management, Purchase Order, Gate Entry, GRN, Invoice Verification, Vendor Master, Approved Source List, Receiving Location Logic

---

### 85.1 — Plan Management

#### 85.1.1 Plan Types

| Plan Type | Period | Version Retention | Authority |
|---|---|---|---|
| Rolling Plan | 3 months ahead (current + 2) | Last 3 versions only | Authorized planners |
| Final Plan | Current month | All versions retained | Authorized planners |
| Extra Plan | Ad-hoc (any period) | All versions retained | Authorized planners |

#### 85.1.2 Plan Governance Rules

1. Plans are created and updated by users with Plan authority — no approval workflow required.
2. Plan history is **archived, never deleted**. Versions beyond retention limit are archived (not purged).
3. Archive is accessible for audit and reference but not editable.
4. Rationale for archiving: Business needs to know what was planned vs what happened. Deletion destroys audit trail.

#### 85.1.3 Procurement Planning by Operation Type

| Operation Type | Planning Method |
|---|---|
| Admix / Liquid | Manual RM requirement entry by planner |
| Powder (Fixed BOM) | BOM explosion with effectivity date — **deferred to dedicated session** |

#### 85.1.4 Powder BOM Explosion Logic (Deferred — Framework Only)

- BOM effectivity: BOM valid-from dates determine which BOM version applies.
- When BOM changes mid-period: production volume split proportionally by effectivity date.
- Formula for net requirement: User to provide in dedicated Powder planning session.
- Import future planning: Deferred to dedicated session.

#### 85.1.5 Plan → PO Flow

- No Purchase Requisition (PR) entity required.
- After plan is finalized, authorized user directly creates PO referencing the plan period.
- Plan provides context and traceability — not a mandatory system-enforced prerequisite for PO.
- Rationale: PR adds administrative step without operational value for this business model.

---

### 85.2 — Purchase Order

#### 85.2.1 PO Types

| PO Type | Usage |
|---|---|
| Domestic PO | Domestic vendor, GST applicable |
| Import PO | Import vendor, customs applicable |

#### 85.2.2 PO Header

| Field | Rule |
|---|---|
| PO Number | System auto-generated (number series per company) |
| Vendor | Selected from approved vendor master |
| PO Date | System date, user can back-date within policy |
| Delivery Date | User entered |
| Company | Mandatory |
| Payment Terms | Auto-populated from last used terms for this vendor (dynamic default) |
| Currency | Auto-populated based on vendor type (BDT for Domestic, Foreign for Import) |
| Remarks | Free text optional |

#### 85.2.3 PO Line Items

| Field | Rule |
|---|---|
| Material | Selected — must exist in Approved Source List for this vendor (hard block) |
| Quantity | User entered in PO UOM |
| PO UOM | From Vendor-Material Info Record (vendor-specific pack size) |
| Rate | From Vendor-Material Info Record (last price) — user can override |
| Delivery Location | Storage location — defaults from Material Master, overridable |
| Delivery Tolerance | Enabled/disabled per material master setting |

#### 85.2.4 Approved Source List Enforcement on PO

- When user selects vendor + material on a PO line:
  - System checks Vendor-Material Info Record for that vendor + material combination.
  - If record exists and is active → **proceed**.
  - If record does not exist or is inactive → **hard block**. PO line cannot be saved.
  - Error message: "This vendor is not an approved source for this material."
- To add a new vendor-material combination: Procurement team creates Vendor-Material Info Record first, then raises PO.

#### 85.2.5 Delivery Tolerance Rules

| Scenario | Behaviour |
|---|---|
| Tolerance disabled for material | No tolerance check. Any quantity accepted. |
| Tolerance enabled, within limit | GRN proceeds normally. |
| Tolerance enabled, breach detected | **Hard block** — GRN cannot be posted. |
| Tolerance breach override | Authorized user opens that specific PO → changes tolerance limit for that PO only → GRN proceeds. |

- No approval workflow for tolerance override — authorized user acts directly on PO.
- Tolerance is a material-level setting (ON/OFF + %). PO-level override is a one-time exception.

#### 85.2.6 PO Amendment Rules

| Action | Rule |
|---|---|
| Add new line item | Allowed |
| Change quantity (increase/decrease) | Allowed |
| Set line item quantity to zero | Effectively cancels that line — allowed |
| Delete a line item | **Not allowed** — quantity set to zero is the close mechanism |
| Cancel full PO | Allowed if no GRN posted against it |
| Close PO | Allowed — closes open quantity, blocks further GRN |

#### 85.2.7 PO Output

- PO preview: Rendered HTML in browser. Not a stored PDF.
- PO send: PDF generated on-demand at time of send/download. Never stored.
- Auto-mail: PO emailed to vendor contact (email + CC list from vendor master) on PO confirmation.

---

### 85.3 — Gate Entry

#### 85.3.1 Gate Entry Purpose

Gate Entry is the **consignment creation point**. Every material arrival is captured at the gate before Stores processes the GRN. Security team operates gate entry.

#### 85.3.2 Gate Entry Flow

```
Vendor arrives with materials and invoice
    ↓
Security opens Gate Entry in PACE
    ↓
4 mandatory fields entered:
  1. PO Number
  2. PO Line Item
  3. Quantity (as per delivery)
  4. Vendor Invoice Number
    ↓
System validates:
  - PO Number exists and is open
  - Line Item is valid on that PO
  - Quantity within PO open quantity (tolerance considered)
    ↓
Gate Entry Number auto-generated
    ↓
Gate Entry document printed / shown to driver
    ↓
Vehicle proceeds to Stores
    ↓
Stores GRN references Gate Entry Number
```

#### 85.3.3 Gate Entry Design Principles

- Vendor puts only **PO Number** on the invoice — no complex reference numbers required.
- Security captures **Vendor Invoice Number** at gate — this differentiates multiple deliveries against the same PO line.
- Same PO line delivered twice on same day → different Vendor Invoice Numbers → two separate Gate Entries → two separate GRNs.
- System tracks cumulative GRN quantity against PO line — over-delivery detected at gate and/or GRN time.

#### 85.3.4 Multiple Deliveries — Example

```
PO Line: RM-00045 → 10,000 KG ordered

Delivery 1: Vendor Invoice INV-001 → 5,000 KG → Gate Entry GE-0001
Delivery 2: Vendor Invoice INV-002 → 5,500 KG → Gate Entry GE-0002

At GE-0002: System shows cumulative = 10,500 KG against 10,000 KG order
→ Over-delivery detected → tolerance check applied
```

#### 85.3.5 Gate Entry Fields

| Field | Type | Rule |
|---|---|---|
| PO Number | Lookup | Mandatory. Must be open PO. |
| PO Line Item | Lookup | Mandatory. Loaded from PO. |
| Quantity | Number | Mandatory. In PO UOM. |
| Vendor Invoice Number | Text | Mandatory. Unique per gate entry. |
| Vehicle Number | Text | Optional |
| Driver Name | Text | Optional |
| Remarks | Text | Optional |
| Gate Entry Number | Auto | System generated |
| Gate Entry Date/Time | Auto | System timestamp |

---

### 85.4 — Goods Receipt Note (GRN)

#### 85.4.1 GRN Flow

```
Stores opens GRN in PACE
    ↓
References Gate Entry Number
    ↓
System loads: PO details, material, quantity, vendor invoice number
    ↓
Stores verifies physical quantity
    ↓
Stores enters:
  - Actual received quantity (if different from gate)
  - Receiving storage location (defaulted, overridable)
  - Batch number / Lot number
  - Expiry date (if FIFO/expiry enabled for material)
    ↓
Movement P101 posted:
  GRN stock → UNRESTRICTED (or QA_STOCK if QA required — QM module)
  Stock ledger updated
  Snapshot updated
    ↓
GRN Number auto-generated
    ↓
GRN document created (link to Gate Entry, PO, Vendor Invoice)
```

#### 85.4.2 GRN Stock Type at Receipt

| Material QA requirement | Initial stock type on GRN |
|---|---|
| No QA required | UNRESTRICTED |
| QA required (set in material master) | QA_STOCK |

> **Note:** QA Pass/Fail / MCT testing is part of the **QM Module (Layer 6)**. GRN only determines initial stock type. QM module handles the transition from QA_STOCK → UNRESTRICTED or BLOCKED.

#### 85.4.3 FIFO and Expiry at GRN

| Material Setting | GRN Behaviour |
|---|---|
| FIFO + Expiry OFF | No lot tracking. Simple quantity receipt. |
| FIFO + Expiry ON | Batch/lot number mandatory. Expiry date mandatory. System maintains GRN-level lot for FIFO issue. |

- At goods issue: System auto-splits by FIFO order (oldest GRN lot first).
- Expiry check: System warns / blocks if lot is expired at time of issue.

#### 85.4.4 GRN Amendment Rules

| Action | Rule |
|---|---|
| GRN reversal (P102) | Allowed with approval. Reverses stock movement and resets PO open quantity. |
| GRN edit after post | Not allowed. Reversal + fresh GRN is the correction path. |

#### 85.4.5 Receiving Storage Location — 3-Level Hierarchy

| Level | Source | Override |
|---|---|---|
| Default | Material Master → "Default Receiving Location" field | Base default |
| Override 1 | PO Line Item — specify delivery location | Overrides material master default |
| Override 2 | GRN time — stores team can change | Overrides PO line location |

- Rationale: One material type may have multiple storage locations (RM Store 1, RM Store 2). Flexibility required at GRN level.

---

### 85.5 — Invoice Verification

#### 85.5.1 Scope

Invoice Verification is an in-system process (SAP-style — not external tracker).

#### 85.5.2 Entry Authority

| Team | Role |
|---|---|
| Stores / Security | Can enter invoice at gate or GRN time |
| Procurement Team | Can enter invoice in system |

#### 85.5.3 Domestic vs Import

Invoice verification behavior differs for Domestic and Import:
- **Domestic:** GST invoice structure applies.
- **Import:** Customs invoice, Bill of Entry, freight, insurance apply.

> **Detail to be finalized at build time** — user will provide actual domestic and import invoice formats at implementation stage.

#### 85.5.4 Material Failure Impact on Invoice

If material fails QA after GRN:
- Return to vendor → Invoice adjusted / credit note raised.
- Reuse (FOR_REPROCESS) → Invoice paid, material tracked separately.
- Both paths are valid — decision made per case.

---

### 85.6 — Vendor Master

#### 85.6.1 Vendor Types

| Type | Description |
|---|---|
| Domestic | BDT currency. GST applicable. API auto-fill from APIFLOW. |
| Import | Foreign currency. Customs applicable. Manual entry. |

Only these two types exist in Phase-1.

#### 85.6.2 Vendor Master Fields

| Field Group | Fields |
|---|---|
| Basic | Vendor Code (auto), Vendor Name, Vendor Type (Domestic/Import) |
| Identity | BIN number (Domestic — API validated), TIN (optional), Trade License |
| GST | GST Number — API auto-fill triggers: Name, Address, Category auto-populated |
| Address | Registered address (auto from API for Domestic), correspondence address |
| Contact | Primary contact person, Phone, Email, CC Email list (for PO auto-mail) |
| Bank | Bank Name, Branch, Account Number, Routing Number — **Optional now, mandatory later** |
| Status | Active / Blocked / Pending Approval |
| Company Mapping | Active in one or multiple companies |

#### 85.6.3 Payment Terms — Dynamic Last Used

| Design Decision | Rule |
|---|---|
| Static default in vendor master | ❌ Not used |
| Dynamic "last used" per vendor | ✅ Confirmed |

- Vendor master has **no static payment terms field**.
- When creating a new PO for a vendor: system auto-populates payment terms from the **last confirmed PO for that vendor**.
- If no previous PO exists: system shows blank → user enters manually.
- After user confirms PO: that payment terms becomes the new "last used" for next PO.
- Rationale: Static defaults become stale and cause errors. Dynamic last-used is always contextually correct.

#### 85.6.4 Vendor Governance

| Action | Rule |
|---|---|
| Create vendor | Procurement team only |
| Edit vendor | Procurement team |
| Approve vendor | Required — any authorized approver (single level) |
| Block/Deactivate vendor | Ledger must be balanced (no open payables) + approval required |
| Multi-company | Vendor can be active in multiple companies simultaneously |

#### 85.6.5 PO Auto-Mail

On PO confirmation, system automatically emails the PO PDF (generated on-demand) to:
- Vendor primary contact email
- All CC emails listed in vendor master

---

### 85.7 — Vendor-Material Info Record (Approved Source List)

#### 85.7.1 Purpose

The Vendor-Material Info Record serves **dual purpose**:
1. Vendor-specific procurement data (pack size, UOM conversion, lead time, last price)
2. **Approved Source List** — defines which vendors are approved to supply which materials

#### 85.7.2 Record Fields

| Field | Description |
|---|---|
| Vendor | Link to vendor master |
| Material | Link to material master |
| Pack Size | Vendor-specific pack size (e.g., 25 KG Bag) |
| PO UOM | Vendor's unit of measure (e.g., Bag, Drum, Carton) |
| Conversion | PO UOM → Base UOM (e.g., 1 Bag = 25 KG) |
| Lead Time | Vendor's lead time in days for this material |
| Last Price | Auto-updated on each confirmed GRN |
| Approved Source | ✅ Active / ❌ Inactive |

#### 85.7.3 Approved Source Enforcement

| Scenario | System Behaviour |
|---|---|
| Vendor-Material Info Record exists (Active) | PO line allowed |
| Vendor-Material Info Record does not exist | **Hard block** — PO line cannot be saved |
| Vendor-Material Info Record exists but Inactive | **Hard block** — treated as not approved |

- No priority ranking between approved vendors. All approved vendors are equally selectable.
- To use a new vendor for a material: Procurement team creates the Info Record first, then raises PO.

#### 85.7.4 Info Record Governance

| Action | Rule |
|---|---|
| Create | Procurement team — directly, no approval required |
| Edit | Procurement team — directly, no approval required |
| Inactivate | Procurement team — directly |

#### 85.7.5 Last Price Auto-Update

On every GRN confirmation:
- System updates "Last Price" on the Vendor-Material Info Record with the GRN rate.
- This becomes the default rate on next PO for that vendor-material combination.
- User can override rate on PO line.

---

### 85.8 — Layer 2 Procurement Summary

| Area | Status | Key Decisions |
|---|---|---|
| Plan Management | ✅ Locked | Rolling (3 months, last 3 versions), Final (all versions), Extra (all versions). Archive, never delete. No PR needed. |
| Procurement Planning | ✅ Locked | Admix = manual. Powder = BOM explosion (deferred). |
| Purchase Order | ✅ Locked | Domestic + Import. Hard block on unapproved vendor-material. Tolerance = hard block + authorized override on PO. |
| PO Amendment | ✅ Locked | No delete — qty zero to cancel line. |
| Gate Entry | ✅ Locked | PO + Line + Qty + Vendor Invoice Number. Auto Gate Entry Number. Consignment tracking foundation. |
| GRN | ✅ Locked | References Gate Entry. FIFO + expiry optional per material. 3-level location hierarchy. |
| Receiving Location | ✅ Locked | Material Master default → PO line override → GRN time override. |
| Invoice Verification | 🔶 Framework Locked | In-system (SAP-style). Domestic + Import differ. Detail at build time with actual invoices. |
| Vendor Master | ✅ Locked | Domestic + Import. API integration. Dynamic payment terms. Bank optional. Approval required. |
| Approved Source List | ✅ Locked | Vendor-Material Info Record = Approved Source List. Hard block on PO. No priority. Procurement team manages directly. |

---

**Layer 2 — Procurement: COMPLETE**
**Next: Layer 3 — Production Discovery**

---

---

# DOCUMENT COMPLETION SUMMARY

| Part | Sections | Status |
|---|---|---|
| Part A — Foundation & Feasibility | 1–5 | COMPLETE |
| Part B — Organization & Governance | 6–10 | COMPLETE |
| Part C — Master Data Design | 11–19 | COMPLETE |
| Part D — Stock Architecture | 20–25 | COMPLETE |
| Part E — Go-Live & Migration Strategy | 26–34 | COMPLETE |
| Part F — Procurement Cycle | 35–43 | COMPLETE |
| Part G — Production & BOM | 44–57 | COMPLETE |
| Part H — FG, Dispatch & Returns | 58–64 | COMPLETE |
| Part I — Plant Transfer & GST Readiness | 65–68 | COMPLETE |
| Part J — Physical Inventory & Reports | 69–72 | COMPLETE |
| Part K — Design Freeze & Implementation Plan | 73–79 | COMPLETE |
| Round-1 Discovery Answers | 80 | COMPLETE |
| Architectural Decision: Operation Type Template | 81 | COMPLETE |
| Round-2 Discovery Answers | 82 | COMPLETE |
| Round-3 Discovery: Admix/Liquid Operation Type | 83 | IN PROGRESS |
| Foundation Layer Discovery (Layer 1) | 84 | ✅ COMPLETE |
| Procurement Layer Discovery (Layer 2) | 85 | ✅ COMPLETE |
| Phase-0 Freeze Record | 86 | ✅ COMPLETE |

**Total Sections: 86**

**Document Status: DRAFT — Active Discovery Phase**

**Next Actions:**
- Complete Admix discovery (batch number format — user to provide)
- Layer 3 — Production Discovery
- Layer 4 — Quality Management Discovery
- Layer 5 — Dispatch & Returns Discovery
- Layer 6 — Plant Transfer Discovery
- Layer 7 — Physical Inventory & Reports Discovery
- Correct Sections flagged in 81.7 (company-specific thinking → template model)
- Design freeze by 31 May 2026 → Implementation begins

---

---

## Section 86 — Phase-0 Design Freeze Record

**Freeze Date:** 9 May 2026
**Status:** ✅ FROZEN FOR IMPLEMENTATION
**Scope:** Layer 1 (Foundation) + Layer 2 (Procurement)

---

### 86.1 — Document Conflicts Resolved

The following conflicts between early-draft sections and Layer 1/2 discovery decisions have been corrected:

| Section | Conflict | Resolution |
|---|---|---|
| Section 10 — Approval Matrix | PR creation listed as approval point | PR removed from PACE-ERP. Plan → PO directly. Row removed. Delivery tolerance override rule added. |
| Section 14 — Supplier Master | Static payment terms field. Bank details Phase-2. Vendor type "BOTH". Old governance. | Fully rewritten per Section 85.6 decisions. Dynamic payment terms. Bank optional. DOMESTIC/IMPORT only. |
| Section 15 — Supplier-Material Source | Separate entity with validity dates, preferred/approved flags | Fully replaced. Vendor-Material Info Record = Approved Source List (single entity). |
| Section 16 — Approved Source List | Separate entity with FIXED/PREFERRED/APPROVED hierarchy | Superseded. Marked archived. Section 15 is the SSOT. |

---

### 86.2 — Layer 1 Design: FROZEN ✅

| Area | Section | Status |
|---|---|---|
| Material Types | 11.2, 84.1 | ✅ FROZEN |
| PACE Code Format | 11.4, 84.2 | ✅ FROZEN |
| Material Master Fields | 11.3, 84.2 | ✅ FROZEN |
| Material Master Governance | 84.3 | ✅ FROZEN |
| Material Category Group | 84.4 | ✅ FROZEN |
| Vendor-Material Info Record | 84.5, 15 | ✅ FROZEN |
| Storage Location Architecture | 20, 84.6 | ✅ FROZEN |
| Location Transfer Rule | 84.6 | ✅ FROZEN |
| Stock Architecture (Ledger + Snapshot) | 24, 84.7 | ✅ FROZEN |
| Stock Types (5 Phase-1 types) | 21, 82 | ✅ FROZEN |
| Movement Types (P-prefix complete list) | 22, 84.8 | ✅ FROZEN |
| Stock Posting Engine Design | 23 | ✅ FROZEN |
| UOM & Conversion | 13 | ✅ FROZEN |

---

### 86.3 — Layer 2 Design: FROZEN ✅

| Area | Section | Status |
|---|---|---|
| Plan Management (Rolling/Final/Extra) | 85.1 | ✅ FROZEN |
| No PR — Plan → PO directly | 85.1.5 | ✅ FROZEN |
| Purchase Order (Header + Lines) | 85.2 | ✅ FROZEN |
| PO Amendment Rules | 85.2.6 | ✅ FROZEN |
| Delivery Tolerance (hard block + PO override) | 85.2.5 | ✅ FROZEN |
| Gate Entry (4-field) | 85.3 | ✅ FROZEN |
| GRN (flow + stock type + FIFO) | 85.4 | ✅ FROZEN |
| Receiving Location (3-level hierarchy) | 85.4.5 | ✅ FROZEN |
| Invoice Verification (framework) | 85.5 | 🔶 Framework only — detail at build time |
| Vendor Master | 14, 85.6 | ✅ FROZEN |
| Vendor-Material Info Record / Approved Source List | 15, 85.7 | ✅ FROZEN |
| Approved Source Hard Block at PO | 15.3, 85.7.3 | ✅ FROZEN |
| Dynamic Payment Terms (last used) | 14.5, 85.6.3 | ✅ FROZEN |

---

### 86.4 — What is NOT Frozen (Implementation must not touch these yet)

| Area | Status |
|---|---|
| Layer 3 — Production & BOM | 🔴 Design in progress |
| Layer 4 — Quality Management | 🔴 Design not started |
| Layer 5 — Dispatch & Returns | 🔴 Design not started |
| Layer 6 — Plant Transfer | 🔴 Design not started |
| Layer 7 — PID & Reports | 🔴 Design not started |
| Operation Type Templates (Gate-10A) | 🔴 Dedicated session pending |
| Invoice Verification detail | 🔶 Deferred — user to provide invoice formats |
| Batch number format | 🔶 User to provide existing format |
| Admix planning formula | 🔶 User to provide |
| Consignment Tracking (LE full design) | 🔶 Deferred |

---

### 86.5 — Implementation Authorization

**Layer 1 and Layer 2 are hereby frozen and authorized for implementation.**

Implementation must proceed in Gate order:
```
Gate-10: DB Foundation → Stock Posting Engine → Ledger → Snapshot
Gate-11: Material Master → UOM → Vendor Master → Cost Center Master
Gate-12: Opening Stock Migration → Legacy PO → Number Series
Gate-13: Full L2 Procurement Cycle (9 sub-gates — see Section 103 for complete detail)
  Gate-13.1: L2 Masters
  Gate-13.2: PO + Vendor-Material Info Record + Approved Source List
  Gate-13.3: CSN + ETA Cascade + Alerts
  Gate-13.4: Gate Entry + Inbound Gate Exit
  Gate-13.5: GRN
  Gate-13.6: Inward QA
  Gate-13.7: STO + Distribution
  Gate-13.8: RTV + Debit Note + Invoice Verification
  Gate-13.9: Sales/Dispatch RM/PM + Customer Master
```

**Notes:**
- PR (Purchase Requirement) removed from scope — Section 87.1 authoritative. No PR in PACE-ERP.
- Vendor-Material Info Record + Approved Source List moved from Gate-11 → Gate-13.2
- Customer Master moved from Gate-11 → Gate-13.9
- Gate-13 is now fully expanded per Section 103 design

**No implementation beyond Gate-13 until Layer 3 design is frozen.**

---

**Phase-0 Status: COMPLETE**
**Implementation: AUTHORIZED for L1 + L2**
**L2 Design Reference: Sections 85–103**
**Next Design Session: Layer 3 — Production Discovery**

---

---

---

---

## Section 87 — Layer 2 SAP Audit Gap Resolution (10 May 2026)

**Session Date:** 10 May 2026
**Status:** ✅ PARTIALLY FROZEN
**Scope:** SAP MM cross-check gaps resolved. 12 decisions locked. Consignment Tracking (Gap #13) design in progress — not yet frozen.

---

### 87.1 — Gap #1: PR vs No-PR Contradiction

**Decision: No PR entity. Plan → PO directly. CONFIRMED.**

- Section 36 (Purchase Requirement design) is hereby **SUPERSEDED and ARCHIVED**.
- Procurement team does all planning and raises POs directly against the plan.
- No Purchase Requisition document exists in PACE-ERP.
- PO header references Plan period for traceability.
- Section 35.5 authority table rows referencing PR are void.

---

### 87.2 — Gap #2: Incoterms on Import PO

**Decision: Dynamic last-used Incoterm — same pattern as Payment Terms.**

| Rule | Detail |
|---|---|
| Field location | Import PO header — mandatory for IMPORT type POs |
| Domestic PO | Incoterm field not shown — not applicable |
| Default on new PO | Auto-loaded from last confirmed PO for this vendor |
| First PO (no history) | Blank — Procurement team enters manually |
| Override | Always allowed — Procurement team changes per deal |
| After PO confirmed | That Incoterm becomes new last-used for this vendor |
| Applicable terms | FOB / CIF / CFR / EXW / CIP / DAP / DDP and any new terms added by Procurement Manager |

---

### 87.3 — Gap #3: Account Assignment / Cost Center on PO Line

**Decision: Mandatory Cost Center on every PO line. Manual selection. No auto-populate.**

| Rule | Detail |
|---|---|
| Field location | PO line — mandatory |
| Mandatory | Yes — PO line cannot be saved without Cost Center |
| Auto-populate | ❌ None — no default from Material Master or elsewhere |
| Reason | Same material (e.g., Caustic Soda) goes to different sections — cost center is context-dependent, not material-dependent |
| Selection source | SA-managed Cost Center Master (company-scoped dropdown) |
| One PO line | One Cost Center |

---

### 87.4 — Gap #4: Payment Terms — Structured Master + Governance

**Decision: Structured Payment Terms Master managed by Procurement Manager.**

#### Payment Terms Master Fields

| Field | Type | Description |
|---|---|---|
| Code | Auto | PT-001, PT-002 etc. |
| Name | Text | Display name (e.g., "Net 30 from Invoice Date") |
| Payment Method | Enum | CREDIT / ADVANCE / LC / TT / DA / DP / MIXED |
| Reference Date | Enum | INVOICE_DATE / GRN_DATE / BL_DATE / SHIPMENT_DATE / N_A |
| Credit Days | Number | Nullable — for credit-based terms |
| Advance % | Number | Nullable — for advance/mixed terms |
| LC Type | Enum | AT_SIGHT / USANCE / N_A |
| Usance Days | Number | Nullable — for LC usance |
| Description | Free text | Full human-readable condition |
| Active | Boolean | Inactive terms hidden from selection |

#### Governance

| Rule | Detail |
|---|---|
| Who manages | Procurement Manager (ACL-controlled authority) |
| SA involvement | Not required — Procurement Manager adds new terms independently |
| New term | Procurement Manager adds when new vendor/deal requires it |
| Extensible | Yes — new Payment Methods / Reference Date types added as needed |

#### Usage on Vendor Master and PO

| Location | Rule |
|---|---|
| Vendor Master | Optional default payment term (PT Master reference) |
| PO creation | Dynamic last-used from last confirmed PO for this vendor |
| First PO (no history) | Vendor's default term loads; if none → blank → manual entry |
| Override | Always allowed — Procurement selects any active term from PT Master |
| After PO confirmed | That term becomes new last-used for this vendor |

---

### 87.5 — Gap #5: Intercompany PO

**Decision: Option A — Separate PO per company. No cross-company PO.**

| Rule | Detail |
|---|---|
| PO Company | Mandatory header field — one PO belongs to one company |
| Procurement team | Centralized — same team raises POs on behalf of all companies |
| CMP003 material | CMP003 PO → stock comes into CMP003 |
| CMP010 material | CMP010 PO → stock comes into CMP010 |
| Cross-company PO | Does not exist in PACE-ERP |
| Intercompany movement | Handled via Plant Transfer (separate document), not PO |
| ACL scope | Procurement team users have multi-company scope |

---

### 87.6 — Gap #6: PO Knock-off (replaces "Final Delivery Flag")

**Decision: No "Final Delivery" flag on GRN. Separate PO Knock-off action by Procurement team.**

| Rule | Detail |
|---|---|
| GRN | Simple receipt posting — no final delivery toggle |
| PO Knock-off | Separate explicit action by Procurement team |
| Purpose | Close POs that are over-serviced or under-serviced |
| Scope | Individual PO line OR entire PO |
| After knock-off | PO line status → CLOSED. Remaining open qty → cancelled |
| Reason | Mandatory — Procurement team enters reason |
| Authority | Authorized Procurement users |
| Trigger | Vendor cannot deliver remainder / over-tolerance delivery accepted |

---

### 87.7 — Gap #7: Weigh Bridge — Tare / Net Weight

**Decision: Weigh bridge fields on Gate Entry + Gate Exit. Tank/bulk items only.**

| Rule | Detail |
|---|---|
| Applicable materials | Tank/bulk liquid items only |
| Flag | Material Master → "Weigh Bridge Required" boolean |
| Gate Entry (In-weight) | Gross weight — full truck on arrival |
| Gate Exit (Out-weight) | Tare weight — empty truck after unloading |
| Net weight | Auto-calculated = In-weight − Out-weight |
| GRN | Net weight from weigh bridge used to verify actual received qty |
| Non-weigh materials | Bag / drum / piece / carton — weigh bridge fields hidden |

---

### 87.8 — Gap #8: Backdated Gate Entry

**Decision: Backdating allowed. No approval required.**

| Rule | Detail |
|---|---|
| Backdating | Allowed — normal business operation |
| Approval | Not required |
| System timestamp | Always recorded automatically (cannot be altered) |
| User-entered date | Backdated date entered by gate staff |
| Audit trail | Both system timestamp and user-entered date stored — full traceability |

---

### 87.9 — Gap #9: Freight Terms on PO + Landed Cost

**Decision: Freight Terms mandatory on every PO. Landed Cost entry by Accounts — any time after GRN.**

#### Freight Terms on PO

| Scenario | Description |
|---|---|
| FOR (Free on Road) | Vendor arranges transport, delivers to plant. No freight entry in PACE. |
| Vendor Arranges — Buyer Pays | Vendor books transport, but company pays freight. Freight amount entered as separate line. |
| Buyer Arranges — Buyer Pays | Company arranges own transport. Freight cost entered separately. |

| Rule | Detail |
|---|---|
| Field location | PO header — mandatory for all PO types (import and domestic) |
| Domestic | FOR / Freight Separate distinction fully applicable |
| Import | Freight/Insurance already part of Incoterms (CIF/CFR) — but local freight from port to plant entered separately |
| Freight amount | Entered on PO if known; can be updated later |

#### Landed Cost

| Component | Description |
|---|---|
| Material Cost | PO rate × GRN quantity |
| Freight | Port to plant / vendor to plant transport |
| Insurance | If not included in Incoterm |
| Customs Duty | Import only |
| CHA Charges | Clearing and Handling Agent fees — import |
| Loading / Unloading | Labour charges at port or plant |

| Rule | Detail |
|---|---|
| Who enters | Accounts section — not Procurement |
| When | Any time after GRN is posted — no deadline |
| Granularity | Per shipment / consignment |
| Debit Note link | When material is rejected, landed cost is captured in the Debit Note value |
| Retroactive | Allowed — landed cost can be entered or corrected after GRN |

---

### 87.10 — Gap #10: PO Approval Authority

**Decision: Procurement Head approves POs. Delegation via PACE role designation system.**

| Rule | Detail |
|---|---|
| Approver | Procurement Head (designated role in PACE ACL) |
| Unavailable | Next level up — designated in PACE role hierarchy |
| Delegation | Configurable in PACE — SA designates which role/user covers approval |
| System | PACE already has role-based approval designation infrastructure |
| Scope | PO creation approval + Amendment approval (for rate/qty changes — see 87.11) |

---

### 87.11 — Gap #11: PO Amendment Approval Scope

**Decision: Rate and Qty changes require approval. All other amendments do not.**

| Amendment Type | Approval Required |
|---|---|
| Rate change | ✅ Yes — Procurement Head |
| Quantity change | ✅ Yes — Procurement Head |
| Delivery date change | ❌ No |
| Remarks / notes | ❌ No |
| Cost Center change | ❌ No |
| Incoterm change | ❌ No |
| Payment Terms change | ❌ No |

---

### 87.12 — Gap #12: PO Cancellation

**Decision: PO Cancellation does not require approval.**

| Rule | Detail |
|---|---|
| Approval | ❌ Not required |
| Authority | Authorized Procurement user |
| Condition | PO must have zero GRN quantity (no receipts posted) |
| Partial receipt | Only undelivered lines can be knocked off — not cancellation |
| Audit | Cancellation reason mandatory. System timestamp recorded. |

---

### 87.15 — Global Document Number Series (11 May 2026)

**Decision: Movement documents share a global number series across all same-group companies.**

| Document Type | Number Series | Rule |
|---|---|---|
| PO Number | Company-specific | Prefix/suffix per company — already frozen |
| GRN / Movement Document | **Global** | One shared counter across all same-group companies |
| Invoice Number | **Global** | One shared counter across all same-group companies |
| Process/Transaction Documents | **Global** | One shared counter across all same-group companies |

| Rule | Detail |
|---|---|
| Condition | Applies only when companies are under the same group |
| Same group | Two companies doing GRN simultaneously → MVT-00001, MVT-00002 — no overlap |
| Different group | Separate number series — not shared |
| Rationale | SAP standard — operational documents are globally unique within a client/group |

---

### 87.16 — PACE → Tally Cross-Reference Strategy (11 May 2026)

**Decision: PACE replaces GSheets. PACE document numbers flow to Tally as cross-reference until Tally is replaced.**

#### Current State
```
GSheets (operations + document numbers) → Tally (cross-reference)
```

#### After PACE Go-Live (July 2026)
```
PACE (operations + document numbers) → Tally (cross-reference)
GSheets deprecated. PACE is the operational system.
Tally continues as financial system with PACE document numbers as reference.
```

#### Future State (Tally Replacement Phase)
```
PACE handles everything.
Tally cross-reference fields phased out.
```

| Rule | Detail |
|---|---|
| PACE document numbers | Globally generated (per 87.15) |
| Tally cross-reference | PACE document numbers entered in Tally — same pattern as GSheets today |
| Invoice | PACE generates its own invoice number. Tally invoice number also stored in PACE as reference during transition. |
| GST Invoicing | Future phase — when PACE handles GST invoicing, Tally invoice number field removed from PACE |
| Timeline | Cross-reference continues until PACE formally replaces Tally (separate project decision) |

---

### 87.17 — Sales/Dispatch Module — RM/PM Outward Sale (11 May 2026)

**Decision: Sales/Dispatch module in scope for July 1. Basic flow only. Handled by Stores + Accounts.**

#### Two Triggers — Same Sale Process

| Trigger | Who Creates | Who Tracks |
|---|---|---|
| STO (internal group) | Procurement team creates STO | Procurement tracks |
| External Customer PO | Customer sends PO — no Procurement involvement | Stores + Accounts |

Regardless of trigger — the sale/dispatch process is **identical**.

#### Sale Process (Both STO and External)

```
STO reference / Customer PO reference
    ↓
Stores → Stock issue (RM/PM leaves stock)
    ↓
Delivery Challan generated
    ↓
Accounts → Sales Invoice generated (global number series)
    ↓
Dispatch / Delivery to customer
```

#### July 1 Scope — Basic Only

| Feature | July 1 |
|---|---|
| Sale against Customer PO | ✅ |
| Sale against STO | ✅ |
| Stock issue | ✅ |
| Delivery Challan | ✅ |
| Sales Invoice (global number) | ✅ |
| Returns / Debit Note | ❌ Later phase |
| Credit Note | ❌ Later phase |
| QC on outward | ❌ Later phase |

#### Authority

| Action | Who |
|---|---|
| STO creation | Procurement team |
| Delivery Challan + Invoice | Stores + Accounts |
| External customer PO handling | Stores + Accounts |

---

### 87.13 — Conflicts Resolved in This Session

| Section | Old State | Resolution |
|---|---|---|
| Section 36 — Purchase Requirement | Full PR design present | **SUPERSEDED** — No PR in PACE-ERP. Plan → PO directly. |
| Section 85.1.5 — No PR confirmation | Stated but Section 36 contradicted | **CONFIRMED** — Section 36 archived. 87.1 is authoritative. |
| Section 85.6.3 — Dynamic payment terms | Only days-based terms | **EXTENDED** — Full structured Payment Terms Master (87.4) |
| Section 85.2 — PO header | Incoterms missing | **ADDED** — Dynamic last-used Incoterm on Import PO (87.2) |
| Section 85.2 — PO line | Cost Center missing | **ADDED** — Mandatory Cost Center on PO line (87.3) |

---

### 87.14 — Updated L2 Freeze Status

| Area | Section | Status |
|---|---|---|
| Plan Management | 85.1 | ✅ FROZEN |
| No PR — Plan → PO directly | 87.1 | ✅ FROZEN (Section 36 archived) |
| Purchase Order (Header + Lines) | 85.2, 87.2, 87.3 | ✅ FROZEN (Incoterms + Cost Center added) |
| Payment Terms Master | 87.4 | ✅ FROZEN |
| PO Amendment Rules | 85.2.6 | ✅ FROZEN |
| Delivery Tolerance | 85.2.5 | ✅ FROZEN |
| PO Knock-off | 87.6 | ✅ FROZEN |
| Intercompany PO | 87.5 | ✅ FROZEN |
| Gate Entry | 85.3, 87.7, 87.8 | ✅ FROZEN (Weigh bridge + backdating added) |
| GRN | 85.4 | ✅ FROZEN |
| Receiving Location (3-level) | 85.4.5 | ✅ FROZEN |
| Vendor Master | 14, 85.6, 87.4 | ✅ FROZEN |
| Vendor-Material Info Record / ASL | 15, 85.7 | ✅ FROZEN |
| Approved Source Hard Block at PO | 15.3, 85.7.3 | ✅ FROZEN |
| Freight Terms on PO | 87.9 | ✅ FROZEN |
| Landed Cost (Accounts entry, post-GRN) | 87.9 | ✅ FROZEN |
| PO Approval Authority | 87.10 | ✅ FROZEN |
| PO Amendment Approval Scope | 87.11 | ✅ FROZEN (Rate + Qty only) |
| PO Cancellation | 87.12 | ✅ FROZEN (No approval required) |
| Global Document Number Series | 87.15 | ✅ FROZEN |
| PACE → Tally Cross-Reference Strategy | 87.16 | ✅ FROZEN |
| Sales/Dispatch Module (RM/PM outward) | 87.17 | ✅ FROZEN (Basic scope — July 1) |
| Invoice Verification | 85.5 | 🔶 Framework only — scope TBD |
| Consignment Tracking | 39 | 🔶 Design in progress — not frozen |
| Procurement Planning UI | 35 | 🔶 Scope TBD |
| Inward QA (post-GRN) | 42 | 🔶 Layer assignment TBD |

---

*— End of Section 87 —*

---

## Section 88 — Consignment Tracking System Design (11 May 2026)

**Session Date:** 11 May 2026
**Status:** ✅ FROZEN
**Scope:** Full consignment tracker design — GE redesign, CSN structure, distribution, STO flow, planning view.

---

### 88.1 — Gate Entry Redesign (Header + Lines)

**Decision: GE is a multi-line document. One GE = one truck arrival.**

Prior design (Section 85.3) assumed single PO + single line. This is superseded.

```
GE Header:
  Vehicle Number, Date/Time, Driver, Gate Staff

GE Lines (multiple):
  Line 1: PO-001 → Line Item 3 → Invoice INV-001 → 5,000 KG
  Line 2: PO-045 → Line Item 1 → Invoice INV-007 → 200 KG
  Line 3: PO-001 → Line Item 5 → Invoice INV-001 → 100 KG
```

| Rule | Detail |
|---|---|
| One GE | One truck arrival |
| Multiple PO lines | Allowed — different POs, different line items |
| Multiple vendors | Allowed — vendor auto-identified from PO, not entered separately |
| GE Number | Auto-generated, global number series |

---

### 88.2 — CSN Auto-creation from PO

**Decision: PO confirm → one CSN auto-created per line item. Global number series.**

| Rule | Detail |
|---|---|
| Trigger | PO confirmation |
| Granularity | One CSN per PO line item |
| Example | PO with 3 line items → 3 CSNs |
| Number series | Global (same-group companies share counter) |
| Initial status | ORDERED |
| Initial details | Empty — Procurement fills tracking info later |

---

### 88.3 — Mother CSN + Sub CSN (Distribution Planning)

**Decision: Procurement can create Sub CSNs under a Mother CSN for cross-company distribution planning.**

```
CSN-055 [MOTHER] — CMP003, 25MT
    ├── Sub CSN-067 — CMP004, 5MT
    └── Sub CSN-085 — CMP005, 10MT
```

| Rule | Detail |
|---|---|
| Sub CSN creation | Procurement team — anytime |
| Sub CSN edit/delete | Anytime — full control |
| Port-to-destination details | Sub CSNs have own LR/Truck/ETA (different after port) |
| Vessel/BL/ETA (pre-port) | Mother CSN details — automatically same in all Sub CSNs |
| Planning view | Sub CSNs used when they exist — Mother CSN not shown |
| GE screen (importing company) | Mother CSN shown with full qty |
| Any company | Any company's PO can be the importing company — scenario applies universally |

#### Mother CSN Status with Sub CSNs

| Sub CSN State | Mother CSN Shows |
|---|---|
| Some GE done, some not | PARTLY ARRIVED |
| All Sub CSNs GE + GRN done | FULLY DISTRIBUTED |
| No Sub CSNs | Standard status flow (88.5) |

Mother CSN tracks physical arrival at importing company independently. Sub CSN statuses do not drive Mother CSN status.

---

### 88.4 — Sub CSN → STO Transformation

**Decision: Sub CSN transforms in-place when mapped to STO. No delete. No new CSN.**

```
Sub CSN-067 [IMPORT, CMP004, 5MT]
    ↓ STO-001 mapped
CSN-067 [LOCAL, CMP004, 5MT, STO-001]
    - Import fields: cleared
    - LOCAL fields active: LR, Truck, ETA plant
    - Detached from Mother CSN (independent)
    - Origin reference preserved: Mother CSN-055
```

| Rule | Detail |
|---|---|
| Transform | In-place — same record updated |
| Delete | ❌ Not deleted |
| New CSN | ❌ Not created |
| Detachment | Sub CSN becomes independent after STO mapping |
| Origin reference | Preserved — Mother CSN reference kept for traceability |
| Document Flow | PO → CSN-055 (Mother) → [Sub: CSN-067] → STO-001 → GE → GRN |

---

### 88.5 — Distribution Scenarios

**Decision: Three distribution scenarios — all handled via Mother/Sub CSN structure.**

**Scenario A — Full qty to PO company:**
```
CSN-055 (CMP003, 25MT) → GE → GRN → Close
No Sub CSNs needed.
```

**Scenario B — PO company + other companies:**
```
Mother CSN-055 (CMP003, 25MT)
Sub CSN-067 (CMP004, 5MT) → STO-001 → LOCAL
Sub CSN-085 (CMP005, 10MT) → STO-002 → LOCAL
CMP003 → full 25MT GRN → then STO distributes
```

**Scenario C — Nothing stays at PO company:**
```
Mother CSN-055 (CMP003, 25MT)
Sub CSN-067 (CMP004, 10MT) → STO-001 → LOCAL
Sub CSN-085 (CMP005, 15MT) → STO-002 → LOCAL
CMP003 GRN mandatory (PO in CMP003 name) → all STOed out → CMP003 net = 0
```

All three scenarios possible for any company in the group.

---

### 88.6 — GE to CSN Linking + BOE/Invoice Rules

**Decision: Security selects CSN at GE time. BOE/Invoice display depends on scenario.**

**GE Screen Flow:**
```
Security sees company-specific open CSNs
→ Enters physical BOE/Invoice number (verification)
→ Selects CSN (system mapping)
→ Enters actual qty
→ GE created → CSN status: ARRIVED
```

**Display Rules:**

| Scenario | GE Shows | Invoice Entry |
|---|---|---|
| Import — Mother CSN, same company | BOE number + Invoice number | At GE |
| Import — Sub CSN → STO → LOCAL (destination) | BOE number only | Stores enters at GRN |
| Domestic | Invoice number | At GE |

| Rule | Detail |
|---|---|
| Company scope | Security sees only their company's CSNs |
| BOE timing | Import: Procurement fills before arrival (BOE received at port before delivery) |
| Two actions | Enter physical number (verify) + select CSN (map) — separate |

---

### 88.7 — CSN Status Flow

**Standard flow:**
```
ORDERED → IN_TRANSIT → ARRIVED → GRN_DONE / CLOSED
```

| Transition | Trigger |
|---|---|
| ORDERED → IN_TRANSIT | Procurement enters dispatch details (vessel/BL/LR) |
| IN_TRANSIT → ARRIVED | Security creates GE against CSN |
| ARRIVED → GRN_DONE | Stores posts GRN |

---

### 88.8 — Partial Dispatch — Balance CSN Auto-create

**Decision: System auto-creates balance CSN on partial dispatch or partial GRN.**

**At dispatch:**
```
CSN-055: PO qty = 25MT
Procurement enters dispatch qty: 15MT
→ CSN-055: 15MT (IN_TRANSIT)
→ CSN-056: 10MT (ORDERED — auto-created, balance)
```

**At GRN:**
```
GRN qty = CSN qty → CSN auto-close
GRN qty < CSN qty → balance qty → new CSN auto-created
PO total qty fully received → PO auto-close
```

**Unplanned arrival (no advance details):**
```
CSN exists (ORDERED, details empty — auto-created from PO)
Security → GE (enters qty from physical delivery)
Stores → GRN
System → balance CSN auto-create or close
Procurement → fills tracking details retroactively
```

---

### 88.9 — Auto-fill from GE/GRN to Tracker

**Decision: Fields entered at GE or GRN auto-populate in CSN tracker. Single entry, multiple places.**

| Entry Point | Auto-fills in Tracker |
|---|---|
| GE | Invoice/BOE number, Gate Entry date, Arrived qty |
| GRN | GRN date, Actual received qty, Transporter, LR number |
| STO | LR number (delayed ok), Dispatch date |

**LR number delayed entry:**
- Plant dispatches → transporter godown → LR number comes later
- Procurement enters LR in STO → tracker auto-updates
- Tracker entry → STO auto-updates
- Single source — enter anywhere, syncs everywhere

---

### 88.10 — Single Window Tracker View

**Decision: Procurement team has one flat list view of all active CSNs. UI to be designed in separate session before build.**

Concept: All CSNs visible in one screen. Filter by company, status, material, type, date. Color coding by status. Inline edit for key fields. Mother-Sub relationship visually indicated. Click-through to full detail.

---

### 88.11 — Document Flow — Bi-directional Navigation

**Decision: Full document chain navigable in any direction. SAP Document Flow equivalent.**

```
PO → CSN (Mother) → Sub CSN → STO → CSN (LOCAL) → GE → GRN → Invoice

Any direction:
PO → GRN ✓
GRN → PO ✓
STO → Mother CSN → PO ✓
```

Every document linked with full lineage preserved even after Sub CSN detachment.

---

### 88.12 — STO Visibility and Workflow

**Decision: Dispatching and receiving company Stores + Accounts see open STOs automatically.**

```
Procurement → STO create
    ↓
Dispatching company Stores + Accounts → open STO visible automatically
    → Dispatch (stock issue, LR, truck) without Procurement involvement
    ↓
Receiving company Stores + Accounts → open STO visible automatically
    → Security GE → Stores GRN → stock posted
```

| Rule | Detail |
|---|---|
| STO close condition | PO balance = 0 |
| STO types | Consignment distribution + Independent inter-plant transfer |
| Both types | Same workflow |
| LR delayed | Procurement enters later in STO → flows to tracker |

---

### 88.13 — Planning View — Per Company

**Decision: Each company sees only their own incoming consignments. UI to be designed before build.**

| Source | Shown in Planning |
|---|---|
| Direct PO (vendor → company) | ✅ |
| STO incoming (another company → this company) | ✅ |
| Sub CSNs exist | Sub CSN qtys shown (not Mother) |
| No Sub CSNs | Mother CSN qty shown |

Plant team uses planning view for space planning, worker/vehicle arrangement, readiness.

---

*— End of Section 88 —*

---

## Section 89 — Supply Chain Tracking: Masters, ETA Cascade, and CSN Field Design (11 May 2026)

**Session Date:** 11 May 2026
**Status:** ✅ FROZEN
**Scope:** Port Master, Port-to-Plant Transit Master, Material Category Master, Lead Time Masters (Import + Domestic), ETA Cascade rules (Import + Domestic), Date field definitions, CSN full field list.

---

### 89.1 — Date Field Definitions

These fields originate from the GSheet supply chain tracker. All are now formally defined for PACE implementation.

| PACE Field Name | GSheet Ref | Meaning | Entry Method |
|---|---|---|---|
| Scheduled ETA to Port | O | Expected arrival date at discharge port — entered at PO creation | Manual by Procurement at PO |
| ETD (Estimated Time of Departure) | Y | Estimated vessel departure from loading port | Auto = Scheduled ETA to Port − Sail Time; Manually overridable |
| BL Date / LR Date | Z | For Import: Bill of Lading date = Actual Time of Departure (ATD). For Domestic: LR Date = ATD | Manual by Procurement when received |
| ETA at Port | AH | Estimated arrival date at discharge port | Auto = ETD + Sail Time; Updates when BL Date entered (AH = BL Date + Sail Time); Manually overridable |
| ATA at Port | AI | Actual arrival at port (vessel berthed) — Import only | Manual by Procurement |
| Post-Clearance LR Date | AP | Import: Date truck departs port after customs clearance. Domestic: Same as LR Date (= ATD) | Manual by Procurement |
| Gate Entry Date | AR | Actual arrival at plant — entered by Security at GE | Auto-filled from GE creation |
| Sail Time | BV | Days from loading port to discharge port — from Lead Time Master | From Lead Time Master (Vendor + Mat. Category + Port) |
| Clearance Days | BQ | Expected customs clearance time at port — from Lead Time Master | From Lead Time Master |
| Port-to-Plant Transit | BR | Days from discharge port to destination plant — from Transit Master | From Port-to-Plant Transit Master |

**Key Rules:**
- Y (ETD) is Estimated Time of **Departure** — not arrival. Auto-calculated. When Z (BL Date) is entered, Z becomes the effective ETD.
- AH (ETA at Port) always recalculates from the most current available date.
- O is ETA to Port (destination). O already includes sail time from vendor side — do NOT add Sail Time again when using O.
- BV (Sail Time) is only used with Z: AH = Z + BV.

---

### 89.2 — ETA Cascade — Import Shipments

**Principle: ETA to Plant is always calculated from the most accurate date available. As each checkpoint date is entered, ETA automatically recalculates.**

#### Step-by-step from PO creation to GRN:

```
Step 1 — PO Created:
  Procurement enters: O (Scheduled ETA to Port)
  System auto-calculates:
    → ETD (Y) = O − Sail Time
    → ETA at Port (AH) = ETD + Sail Time = O
    → ETA to Plant = O + Clearance Days + Port-to-Plant Transit Days

Step 2 — Vessel Departs (BL Date received):
  Procurement enters: Z (BL Date = ATD)
  System recalculates:
    → ETA at Port (AH) = Z + Sail Time
    → ETA to Plant = AH + Clearance Days + Port-to-Plant Transit Days

Step 3 — Vessel Arrives at Port (ATA):
  Procurement enters: AI (ATA at Port)
  System recalculates:
    → ETA to Plant = AI + Clearance Days + Port-to-Plant Transit Days

Step 4 — Customs Cleared, Truck Dispatched (LR Date):
  Procurement enters: AP (Post-Clearance LR Date)
  System recalculates:
    → ETA to Plant = AP + Port-to-Plant Transit Days

Step 5 — Gate Entry:
  Security creates GE → AR (Gate Entry Date) filled automatically
  ETA to Plant: ACTUAL ARRIVAL — no further calculation needed
```

#### ETA to Plant Priority Logic:

| Checkpoint Available | ETA to Plant Formula |
|---|---|
| AR entered (GE done) | Actual — no estimate |
| AP entered | AP + Port-to-Plant Transit Days |
| AI entered | AI + Clearance Days + Port-to-Plant Transit Days |
| AH available | AH + Clearance Days + Port-to-Plant Transit Days |
| O only (at PO) | O + Clearance Days + Port-to-Plant Transit Days |

AH is driven by (in priority): BL Date + Sail Time > ETD + Sail Time > Scheduled ETA to Port (O).

**Procurement can manually override AH at any time.** Override flag preserved. Manual entry is highest priority.

---

### 89.3 — ETA Cascade — Domestic Shipments

```
Step 1 — PO Created:
  System fetches Lead Time from Domestic Lead Time Master (Vendor + Destination Company)
  → ETA to Plant (estimated) = PO Date + Transit Days

Step 2 — Truck Dispatched (LR Date received):
  Procurement / Stores enters: Z / AP (LR Date = ATD)
  System recalculates:
    → ETA to Plant = LR Date + Transit Days

Step 3 — Gate Entry:
  Security creates GE → AR (Gate Entry Date) filled automatically
  ETA to Plant: ACTUAL ARRIVAL
```

| Checkpoint Available | ETA to Plant Formula |
|---|---|
| AR entered | Actual — no estimate |
| AP / Z entered (LR Date) | LR Date + Transit Days (from Domestic Lead Time Master) |
| PO only | PO Date + Transit Days |

For domestic, there is no Port, no AH, no AI, no Sail Time. AP = Z = LR Date.

---

### 89.4 — Port Master

**SA-managed. Referenced by CSN, Lead Time Master, Port-to-Plant Transit Master.**

| Field | Type | Rules |
|---|---|---|
| Port Code | Code | Unique, system-generated |
| Port Name | Text | Full name (e.g., Kolkata Port, JNPT, Chennai) |
| Port Type | Dropdown | SEA / AIR / LAND |
| State | Text | Indian state where port is located |
| Country | Text | Default India; other for future |
| CHA (Default) | Reference | Optional — preferred Clearing Agent for this port |
| Active | Flag | Inactive ports hidden from dropdowns |

---

### 89.5 — Port-to-Plant Transit Master

**SA-managed. Drives "Port-to-Plant Transit Days" in ETA cascade.**

| Field | Type | Rules |
|---|---|---|
| Port | Reference → Port Master | Discharge port |
| Destination Company | Reference → Company | Receiving plant/company |
| Transit Days | Number | Days from port gate out to plant gate |
| Mode | Dropdown | ROAD / RAIL / MULTI-MODAL |
| Remarks | Text | Optional |
| Active | Flag | |

**Key Design Rule:** Transit time is per Port + Destination Company combination — NOT per material. Same port, same company always has the same transit days regardless of material.

**Example:**
| Port | Company | Transit Days |
|---|---|---|
| Kolkata Port | CMP003 | 1 |
| Kolkata Port | CMP004 | 4 |
| JNPT | CMP003 | 7 |
| JNPT | CMP004 | 8 |

---

### 89.6 — Material Category Master

**SA-managed. Used for procurement planning grouping. Separate from Material Category Group (functional equivalents).**

| Field | Type | Rules |
|---|---|---|
| Category Code | Code | Unique, system-generated |
| Category Name | Text | e.g., Raw Material - Fibre, Packaging - Carton |
| Description | Text | Optional |
| Active | Flag | |

**Design Rule:** Material Category in this master is a planning grouping dimension. It tells "what type of material this is" for planning dashboards, ETA grouping, and lead time lookup. It is NOT the same as Material Category Group which groups functionally equivalent materials for substitution/planning.

Each Material is mapped to one Material Category.

---

### 89.7 — Lead Time Master — Import

**SA-managed. Drives Sail Time and Clearance Days for import ETA cascade.**

| Field | Type | Rules |
|---|---|---|
| Vendor | Reference → Vendor Master | Supplying vendor |
| Material Category | Reference → Material Category Master | Category of material |
| Port of Loading | Text / Reference | Vendor's dispatch port |
| Port of Discharge | Reference → Port Master | Destination port in India |
| Sail Time (Days) | Number | BV — vessel transit days |
| Clearance Days | Number | BQ — expected customs clearance at discharge port |
| Effective From | Date | Version control start |
| Effective To | Date | Version control end; blank = current |
| Active | Flag | |

**Usage in ETA cascade:**
- Sail Time → used to auto-calculate ETD from Scheduled ETA to Port, and ETA at Port from BL Date
- Clearance Days → used to calculate ETA to Plant from AH or AI

---

### 89.8 — Lead Time Master — Domestic

**SA-managed. Drives Transit Days for domestic ETA cascade.**

| Field | Type | Rules |
|---|---|---|
| Vendor | Reference → Vendor Master | Supplying vendor |
| Destination Company | Reference → Company | Receiving plant |
| Transit Days | Number | Days from LR Date to plant arrival |
| Effective From | Date | Version control start |
| Effective To | Date | Version control end; blank = current |
| Active | Flag | |

**Usage:** When LR Date entered → ETA to Plant = LR Date + Transit Days. When only PO exists → ETA to Plant = PO Date + Transit Days.

---

### 89.9 — CSN Full Field List

**Auto-created on PO confirmation (one per PO line item). Global number series.**

#### Header Fields (All CSNs)

| Field | Type | Rules |
|---|---|---|
| CSN Number | Code | Auto, global number series |
| CSN Type | Dropdown | IMPORT / DOMESTIC |
| Status | Dropdown | ORDERED / IN_TRANSIT / ARRIVED / GRN_DONE / CLOSED |
| Company | Reference | Destination / PO company |
| PO Number | Reference → PO | Source PO |
| PO Line Item | Number | Line item reference |
| Vendor | Auto from PO | |
| Material | Auto from PO | |
| Material Category | Auto from Material | |
| PO Qty | Decimal | From PO line |
| UOM | From PO | |
| Dispatch Qty | Decimal | Entered by Procurement at dispatch |
| Is Mother CSN | Flag | Set if Sub CSNs exist under this CSN |
| Mother CSN Reference | Reference | Populated if this is a Sub CSN |
| STO Number | Reference → STO | Populated when Sub CSN transforms via STO mapping |
| Invoice Number | Text | From vendor — entered at GE (domestic) or GRN (import STO) |

#### Import-Specific Fields

| Field | Type | Notes |
|---|---|---|
| Port of Loading | Text | Vendor's dispatch port |
| Port of Discharge | Reference → Port Master | India destination port |
| Vessel Name | Text | |
| Voyage Number | Text | |
| BL Number | Text | Bill of Lading number |
| BOE Number | Text | Bill of Entry — entered by Procurement before arrival |
| CHA | Text / Reference | Clearing Agent |
| Scheduled ETA to Port | Date | O — entered at PO creation |
| ETD | Date | Y — auto from O − Sail Time; manually overridable |
| BL Date | Date | Z — Actual Time of Departure |
| ETA at Port | Date | AH — auto; updates from BL Date; manually overridable |
| ETA at Port Override Flag | Flag | Set when AH entered manually |
| ATA at Port | Date | AI — actual vessel arrival at port |
| Post-Clearance LR Date | Date | AP — truck leaves port after customs |
| Transporter (Port-to-Plant) | Text / Reference | |
| LR Number (Port-to-Plant) | Text | |
| Vehicle Number (Port-to-Plant) | Text | |

#### Domestic-Specific Fields

| Field | Type | Notes |
|---|---|---|
| LR Date | Date | Z / AP — ATD; truck departure from vendor |
| Transporter | Text / Reference | |
| LR Number | Text | |
| Vehicle Number | Text | |

#### Arrival + GRN Fields (All CSNs)

| Field | Type | Notes |
|---|---|---|
| Gate Entry Date | Date | AR — auto-filled from GE |
| GE Number | Reference → GE | Auto-filled when GE created |
| GRN Date | Date | Auto-filled from GRN |
| GRN Number | Reference → GRN | Auto-filled when GRN posted |
| Received Qty | Decimal | Auto-filled from GRN |
| ETA to Plant (Calculated) | Date | Auto — always latest calculation per cascade rules |
| Remarks | Text | Procurement free text |
| Created By | User | |
| Created At | Timestamp | |
| Last Updated By | User | |
| Last Updated At | Timestamp | |

---

### 89.10 — ETA Cascade Summary — Single View

```
IMPORT FLOW:
  PO Created
    ↓ O entered (Scheduled ETA to Port)
    ↓ Y auto = O − Sail Time (ETD)
    ↓ AH auto = Y + Sail Time = O (ETA at Port)
    → ETA to Plant = O + Clearance + Port-to-Plant

  BL Date (Z) received
    ↓ AH = Z + Sail Time (updated)
    → ETA to Plant = AH + Clearance + Port-to-Plant

  ATA at Port (AI) entered
    → ETA to Plant = AI + Clearance + Port-to-Plant

  Post-Clearance LR Date (AP) entered
    → ETA to Plant = AP + Port-to-Plant

  Gate Entry (AR) created
    → ETA ACTUAL — calculation complete

DOMESTIC FLOW:
  PO Created
    → ETA to Plant = PO Date + Transit Days (from master)

  LR Date entered (Z / AP)
    → ETA to Plant = LR Date + Transit Days

  Gate Entry (AR) created
    → ETA ACTUAL — calculation complete
```

**Key Principle:** The system always uses the most downstream (most accurate) date available. Procurement does not need to "trigger recalculation" — it happens automatically on every date entry.

---

*— End of Section 89 —*

---

## Section 90 — PO & CSN Extended Tracking: LC, Vessel Booking, Rebate, Vendor Indent (11 May 2026)

**Session Date:** 11 May 2026
**Status:** ✅ FROZEN
**Scope:** LC tracking, vessel booking follow-up alerts, rebate flag, vendor indent number — PO-level flags carrying into CSN.

---

### 90.1 — LC (Letter of Credit) Tracking

**Decision: LC fields live entirely in the CSN Tracker — not at PO level. Payment Term is at PO level only. All LC tracking and alerts operate from the tracker.**

#### PO-Level Fields

| Field | Type | Rules |
|---|---|---|
| Payment Term | Dropdown | LC / TT / DP / OPEN / etc. |
| LC Required | Flag | Auto-set Y when Payment Term = LC. Carries to CSN |

#### CSN Tracker Fields (LC section — visible only when LC Required = Y)

| Field | Type | Rules |
|---|---|---|
| LC Required | Auto from PO | Controls visibility of LC section in tracker |
| LC Due Date | Date | Auto = ETD − 10 days. Recalculates when ETD changes in CSN |
| LC Opened Date | Date | Manual entry by Procurement. Entering = LC opened |
| LC Number | Text | LC reference number from bank. Entering = LC done |

**LC is considered complete when both LC Opened Date AND LC Number are entered. Either missing = LC not complete.**

#### Alert Logic

| Condition | Alert |
|---|---|
| LC Required = Y AND (LC Opened Date or LC Number empty) AND today ≥ LC Due Date | 🔴 LC Overdue |
| LC Required = Y AND (LC Opened Date or LC Number empty) AND today = LC Due Date − 3 days | 🟡 LC due in 3 days |
| Both LC Opened Date AND LC Number entered | Alert auto-dismissed |

---

### 90.2 — Vessel Booking Follow-up

**Decision: Vessel Booking Confirmed Date is a field in the CSN Tracker. Entering this date = booking is done. If not entered after PO Date + 3 days → alert triggers automatically. No separate "expected by" date needed.**

#### How it works

- PO confirmed → CSN created (ORDERED)
- Procurement confirms vessel booking with vendor → enters Vessel Booking Confirmed Date in CSN Tracker
- If this date is still empty 3 days after PO Date → alert triggers
- Date entered → alert auto-dismissed

#### CSN Tracker Field

| Field | Type | Rules |
|---|---|---|
| Vessel Booking Confirmed Date | Date | Manual entry by Procurement. Import only. Entering this = vessel booking done |

#### Alert Logic

| Condition | Alert |
|---|---|
| CSN Type = IMPORT AND Vessel Booking Confirmed Date is empty AND today > PO Date + 3 days | 🟡 Vessel booking not confirmed — follow up with vendor |
| Vessel Booking Confirmed Date is entered | Alert auto-dismissed |

Alert visible in Procurement Dashboard and CSN Tracker for relevant CSN.

---

### 90.3 — Rebate Flag

**Decision: Rebate flag at PO level. Carries to CSN. Full rebate tracker to be designed in a later session.**

#### PO-Level Fields

| Field | Type | Rules |
|---|---|---|
| Has Rebate | Flag | Y / N — set by Procurement at PO creation |
| Rebate Remarks | Text | Brief note on rebate terms (free text for now) |

#### CSN-Level Fields (carried from PO)

| Field | Type | Rules |
|---|---|---|
| Has Rebate | Auto from PO | Visible on CSN for awareness |
| Rebate Remarks | Auto from PO | Read-only on CSN |

**Rebate Tracker:** Full design deferred. Flag + remarks capture ensures no consignment with rebate is missed. Tracker to be designed as a separate sub-module once basic procurement flow is live.

---

### 90.4 — Vendor Indent Number

**Decision: Vendor gives their own reference/indent number against our PO. Captured per CSN. Controlled by a sticky vendor-level flag.**

#### Vendor Master Flag

| Field | Type | Rules |
|---|---|---|
| Indent Number Required | Flag | Default: OFF. Set at Vendor Master level by SA |

**Sticky behavior:** Once turned ON for a vendor, all new POs with that vendor automatically have indent tracking active. Remains ON until explicitly turned OFF in Vendor Master. Procurement does not need to toggle per PO.

#### PO-Level

| Field | Type | Rules |
|---|---|---|
| Indent Required | Flag | Auto-inherited from Vendor Master. Procurement can override per PO |

#### CSN-Level

| Field | Type | Rules |
|---|---|---|
| Vendor Indent Number | Text | Manual entry by Procurement. Shown only if Indent Required = Y on PO |
| Indent Required | Auto from PO | Controls field visibility |

**UI Rule:** If Indent Required = N on the PO, Vendor Indent Number field is hidden on CSN. If Y, field is visible and editable.

---

### 90.5 — PO Extended Fields Summary

All new PO-level fields introduced in this section:

| Field | Source | Carries to CSN |
|---|---|---|
| Payment Term | Procurement | ✅ (LC Required auto-derived) |
| LC Required | Auto from Payment Term | ✅ (controls LC section visibility in tracker) |
| Has Rebate | Manual | ✅ |
| Rebate Remarks | Manual | ✅ |
| Indent Required | Auto from Vendor Master / override | ✅ (controls field visibility) |

LC tracking fields (LC Due Date, LC Opened Date, LC Number) are in CSN Tracker only — not at PO level.

---

### 90.6 — CSN Extended Fields Summary

All new CSN-level fields from this section (additions to 89.9):

| Field | Type | Applies To |
|---|---|---|
| Payment Term | Auto from PO | All |
| LC Required | Auto from PO | Import |
| LC Due Date | Auto = ETD − 10 days, recalculates | Import, when LC Required = Y |
| LC Opened Date | Manual | Import, when LC Required = Y |
| LC Number | Manual | Import, when LC Required = Y |
| Vessel Booking Confirmed Date | Manual | Import |
| Has Rebate | Auto from PO | All |
| Rebate Remarks | Auto from PO | All |
| Indent Required | Auto from PO | All |
| Vendor Indent Number | Manual | All (if Indent Required = Y) |

---

### 90.7 — Alert System — Tab Structure

**Decision: Alert system in Procurement Dashboard / CSN Tracker is tab-based. Each alert type has its own tab. Alerts appear only on the relevant tab — not mixed.**

| Tab | Shows | Relevant To |
|---|---|---|
| LC Alerts | CSNs where LC Required = Y and LC not completed (LC Opened Date or LC Number missing) past or near due date | Procurement / Finance |
| Vessel Booking | Import CSNs where Vessel Booking Confirmed Date is empty and PO Date + 3 days passed | Procurement |
| (Future tabs) | Other follow-up types as designed | TBD |

**Design Rules:**
- Each tab shows only its own alert type — no mixing
- Count badge on each tab showing number of pending alerts
- Clicking a row opens the relevant CSN directly
- Alert auto-clears from tab when the required action is completed (date/number entered)
- Tabs with zero alerts are empty but still visible (not hidden)

---

*— End of Section 90 —*

---

## Section 91 — Bulk CSN Type + GE Weighment Design (11 May 2026)

**Session Date:** 11 May 2026
**Status:** ✅ FROZEN
**Scope:** Bulk PO indicator, Bulk CSN type design, RST/Weighment fields on Gate Entry.

---

### 91.1 — Bulk / Tanker PO Indicator

**Decision: PO-level indicator distinguishes Standard, Bulk, and Tanker POs. CSN type derives from this indicator.**

| Field | Level | Type | Rules |
|---|---|---|---|
| Delivery Type | PO | Dropdown | STANDARD / BULK / TANKER. Default STANDARD |
| CSN Type | CSN | Auto | STANDARD → IMPORT or DOMESTIC. BULK or TANKER → BULK |

- STANDARD: regular CSN flow — full tracking, alerts, ETA cascade
- BULK: loose solid materials (coal, sand, chemicals in bags, etc.) — weighment-based qty
- TANKER: liquid materials (oils, chemicals, etc.) — weighment-based qty (gross/tare/net)

Both BULK and TANKER follow the same Bulk CSN flow (Section 91.2). No separate CSN type for Tanker — both map to CSN Type = BULK.

---

### 91.2 — Bulk CSN Design

**Bulk CSN is a simplified type. No tracking fields, no alerts, no ETA cascade. Quantity is weighment-based.**

#### Key Differences from Regular CSN

| Feature | Regular CSN (IMPORT/DOMESTIC) | Bulk CSN |
|---|---|---|
| Type | IMPORT / DOMESTIC | BULK |
| Tracking fields | Vessel, BL, LC, ETA cascade, follow-up dates | ❌ None |
| Alerts | LC overdue, Vessel Booking, etc. | ❌ None |
| Mother / Sub CSN | ✅ | ❌ |
| GEs per CSN | One shipment = one GE | Multiple trucks → multiple GEs, same CSN open |
| Quantity basis | Invoice qty / counted qty | Net Weight (Gross − Tare from weighment) |
| Status flow | ORDERED → IN_TRANSIT → ARRIVED → GRN_DONE | OPEN → CLOSED |
| CSN closes when | GRN posted for full qty | PO balance reaches zero |
| Planning view | ✅ | ✅ (shows open balance) |

#### Bulk CSN Fields

| Field | Type | Rules |
|---|---|---|
| CSN Number | Auto | Global number series |
| CSN Type | Auto | BULK |
| Status | Dropdown | OPEN / CLOSED |
| Company | Auto from PO | |
| PO Number | Auto from PO | |
| PO Line Item | Auto from PO | |
| Vendor | Auto from PO | |
| Material | Auto from PO | |
| Material Category | Auto from Material | |
| PO Qty | Decimal | Total ordered qty (weight-based UOM) |
| Total Received Qty | Decimal | Cumulative net weight from all GRNs against this CSN |
| Balance Qty | Auto | PO Qty − Total Received Qty |
| Payment Term | Auto from PO | |
| Has Rebate | Auto from PO | |
| Rebate Remarks | Auto from PO | |
| Indent Required | Auto from PO | |
| Vendor Indent Number | Manual | If Indent Required = Y |
| Remarks | Text | Free text |

No vessel, BL, LC, ETD, ETA, Sail Time, Clearance or Port fields on Bulk CSN.

#### Multiple GE / GRN Against One Bulk CSN

```
CSN-BULK-001 (CMP003, Coal, 500MT, OPEN)
    ├── GE-101 → GRN-201 → 80MT (Net Weight)
    ├── GE-102 → GRN-202 → 75MT (Net Weight)
    ├── GE-103 → GRN-203 → 90MT (Net Weight)
    └── ... continues until 500MT received → CSN CLOSED
```

CSN remains OPEN and accepts new GEs until PO balance = 0.

---

### 91.3 — GE Weighment Fields (All GE Types)

**Decision: RST Number, Gross Weight, Tare Weight, Net Weight added to Gate Entry for all GE types. Mandatory for Bulk/Tanker GEs. Optional for Standard GEs.**

#### Fields Added to GE (Gate Entry)

These fields are at **GE Line level** — each GE line (each PO line item on the truck) can have its own weighment record.

| Field | Type | Mandatory | Rules |
|---|---|---|---|
| RST Number | Text | BULK/TANKER: ✅ Yes. STANDARD: ❌ No | Weighbridge Slip / Road Side Ticket number |
| Gross Weight | Decimal | BULK/TANKER: ✅ Yes. STANDARD: ❌ No | Total weight of truck + material (KG / MT) |
| Tare Weight | Decimal | BULK/TANKER: ✅ Yes. STANDARD: ❌ No | Empty truck weight (KG / MT) |
| Net Weight | Decimal | Auto | Auto = Gross − Tare. Read-only when both entered. Manually overridable |

**Rules:**
- BULK / TANKER GE → RST, Gross, Tare all mandatory. System cannot save GE without these
- STANDARD GE → all four fields optional (supplementary info only)
- Net Weight auto-calculates when Gross and Tare both entered
- Net Weight can be entered manually if weighbridge gives net directly (Gross/Tare not required in that case)
- Every truck = one GE record — per-truck weighment preserved permanently
- Security enters these fields at time of GE creation

#### Bulk CSN GE → GRN Qty Flow

```
GE Line: Bulk CSN-001
  RST: W-4521
  Gross Weight: 28,500 KG
  Tare Weight:   6,200 KG
  Net Weight:   22,300 KG  ← auto

GRN: Received Qty = 22,300 KG (auto-filled from Net Weight)
```

For Bulk CSN, GRN received qty defaults to Net Weight from GE. Stores can override if needed.

---

*— End of Section 91 —*

---

## Section 92 — Stock Transfer Order (STO) Full Design (11 May 2026)

**Session Date:** 11 May 2026
**Status:** ✅ FROZEN
**Scope:** STO types, header, lines, transfer pricing, dispatch flow (Gate Exit + Delivery Challan), receipt flow (GE + GRN), status flow, close conditions.

---

### 92.1 — STO Types

| Type | Description | Trigger |
|---|---|---|
| CONSIGNMENT_DISTRIBUTION | Sub CSN → STO transform. Distributing imported material from PO company to other companies | Sub CSN mapped to STO by Procurement |
| INTER_PLANT | Independent inter-company stock transfer — not related to any import consignment | Procurement creates directly |

Both types follow the **same document structure and workflow.** No behavioural difference after creation.

---

### 92.2 — STO Header Fields

| Field | Type | Rules |
|---|---|---|
| STO Number | Auto | Global number series |
| STO Date | Date | System date. Backdating allowed (same rule as GE) |
| STO Type | Dropdown | CONSIGNMENT_DISTRIBUTION / INTER_PLANT |
| Sending Company | Reference → Company | Material moves out of this company |
| Receiving Company | Reference → Company | Material moves into this company |
| Status | Auto | CREATED → DISPATCHED → RECEIVED → CLOSED |
| Related CSN | Reference → CSN | For CONSIGNMENT_DISTRIBUTION only. Auto-linked from Sub CSN transform |
| Created By | User | Procurement team |
| Remarks | Text | Optional |

---

### 92.3 — STO Line Fields

| Field | Type | Rules |
|---|---|---|
| Line Number | Auto | Sequential |
| Material | Reference → Material Master | |
| Quantity | Decimal | |
| UOM | From Material Master | |
| Sending Storage Location | Reference | From sending company |
| Receiving Storage Location | Reference | Default from Material Master (receiving company). Overridable at GRN |
| Transfer Price | Decimal | Default = last used transfer price for this Material + Sending Company + Receiving Company. Editable by Procurement before dispatch |
| Transfer Price Currency | Auto from Company | |
| Dispatched Qty | Decimal | Auto-filled from Gate Exit |
| Received Qty | Decimal | Auto-filled from GRN |
| Balance Qty | Auto | Quantity − Received Qty |

**Transfer Price rule:** Same dynamic last-used pattern as Payment Terms and Incoterms — loads last confirmed transfer price for this material/company pair. First time → blank → Procurement enters manually. After STO confirmed → becomes new last-used.

Transfer Price editable by Procurement any time before Delivery Challan is generated (i.e., before dispatch).

---

### 92.4 — STO Status Flow

```
CREATED
    ↓ Stores issues stock + Gate Exit done
DISPATCHED
    ↓ Gate Entry at receiving company
IN_TRANSIT  (optional intermediate — if GE not immediate)
    ↓ GRN posted at receiving company
RECEIVED
    ↓ All lines fully received OR Procurement knocks off balance
CLOSED
```

| Status | Meaning |
|---|---|
| CREATED | STO made. Visible to both companies. No stock movement yet |
| DISPATCHED | Stock issued from sending company. Gate Exit done. Delivery Challan generated |
| RECEIVED | GRN posted at receiving company for all lines |
| CLOSED | STO fully closed — all qty received or balance knocked off |

Partial receipt: STO remains RECEIVED (partially) until all lines closed. Each line has its own received qty and balance.

---

### 92.5 — Dispatch Flow (Sending Company)

```
Procurement creates STO → status: CREATED
    ↓
Sending company Stores: sees open STO automatically
    ↓
Stores picks stock from Sending Storage Location
    ↓
Stores posts stock issue (movement type: STO_ISSUE)
    → Stock deducted from sending company
    → Delivery Challan auto-generated
    ↓
Gate staff: Gate Exit
    → Vehicle Number, Driver, Transporter, LR Number, Dispatch Qty, Date/Time
    → Gate Exit Number auto-generated
    ↓
STO status → DISPATCHED
    ↓
LR Number flows to CSN tracker (if CONSIGNMENT_DISTRIBUTION type)
```

#### Delivery Challan — Auto-generated on Stock Issue

| Field | Source |
|---|---|
| Delivery Challan Number | Auto, global number series |
| Date | System date |
| STO Reference | Auto |
| Sending Company | From STO |
| Receiving Company | From STO |
| Material, Qty, UOM | From STO line |
| Transfer Price | From STO line |
| Total Value | Auto = Qty × Transfer Price |
| Transporter / LR / Vehicle | From Gate Exit |

Delivery Challan is auto-generated and cannot be manually created. Trigger = stock issue posting.

---

### 92.6 — Gate Exit (Sending Company)

**Decision: Gate Exit is a document at the sending company. Mirrors Gate Entry structure. Recorded when loaded truck leaves the plant.**

#### Gate Exit Header

| Field | Type | Rules |
|---|---|---|
| Gate Exit Number | Auto | Global number series |
| Gate Exit Date/Time | Auto + user-entry | System timestamp always recorded. User enters date (backdating allowed) |
| Vehicle Number | Text | Mandatory |
| Driver Name | Text | Optional |
| Gate Staff | Auto | Logged-in user |

#### Gate Exit Lines

| Field | Type | Rules |
|---|---|---|
| STO Reference | Reference → STO | Mandatory |
| STO Line | Reference | |
| Material | Auto from STO | |
| Dispatch Qty | Decimal | Mandatory |
| Transporter | Text / Reference | Optional |
| LR Number | Text | Optional — can be entered later in STO/CSN |
| RST Number | Text | BULK/TANKER: Mandatory. STANDARD: Optional |
| Gross Weight | Decimal | BULK/TANKER: Mandatory. STANDARD: Optional |
| Tare Weight | Decimal | BULK/TANKER: Mandatory. STANDARD: Optional |
| Net Weight | Decimal | Auto = Gross − Tare. Manually overridable |

Same weighment rules as Gate Entry (Section 91.3) apply at Gate Exit.

---

### 92.7 — Receipt Flow (Receiving Company)

```
Receiving company Security: sees incoming STO automatically
    ↓
Truck arrives → Gate Entry (same GE flow as vendor delivery)
    → GE references STO (instead of PO)
    → RST / weighment fields filled (if Bulk/Tanker)
    ↓
Receiving company Stores: sees open STO + GE automatically
    ↓
Stores posts GRN (movement type: STO_RECEIPT)
    → Stock added to receiving company
    → STO received qty updated
    ↓
If all STO lines fully received → STO status: CLOSED
```

#### GE for STO Receipt

GE for incoming STO is the same Gate Entry document (Section 88.1 / 91.3) with one difference:

| Regular GE | STO GE |
|---|---|
| References PO + Line Item | References STO + STO Line |
| Vendor Invoice Number mandatory | Delivery Challan Number (from sending side) |

All other GE rules (weighment, multi-line, auto-link) apply identically.

---

### 92.8 — STO Visibility Rules

| Company | What They See |
|---|---|
| Sending Company (Stores + Accounts) | Open STOs where they are the sender. Can dispatch |
| Receiving Company (Stores + Accounts) | Open STOs where they are the receiver. Can GRN |
| Procurement Team | All STOs — all companies (multi-company scope) |
| Other companies | ❌ Not visible |

---

### 92.9 — STO Close / Knock-off

| Scenario | Action |
|---|---|
| All qty received | STO auto-closes |
| Partial receipt, remainder not coming | Procurement knocks off balance (reason mandatory) |
| Amendment before dispatch | Qty / Price changeable — no approval required (unlike PO) |
| Cancellation (no dispatch done) | Procurement can cancel. No approval. Reason mandatory |

---

### 92.10 — Document Flow

```
PO → CSN (Mother) → Sub CSN → STO → Delivery Challan → Gate Exit (sending)
                                   ↓
                              Gate Entry (receiving) → GRN
```

Full bi-directional navigation from any point in the chain (same rule as 88.11).

---

*— End of Section 92 —*

---

## Section 93 — GRN Complete Field List (11 May 2026)

**Session Date:** 11 May 2026
**Status:** ✅ FROZEN
**Scope:** GRN header, GRN lines, batch/lot rules, stock posting, weighment tally, post-GRN auto-updates.

---

### 93.1 — GRN Structure

**One GRN = One GE. GRN cannot span multiple GEs.**

GRN is a header + line document. Lines are loaded from the referenced GE — Stores does not manually add lines.

---

### 93.2 — GRN Header Fields

| Field | Type | Rules |
|---|---|---|
| GRN Number | Auto | Global number series |
| GRN Date | Date | System date. Backdating allowed |
| Posting Date | Date | Defaults to GRN Date. Overridable (financial posting date) |
| Company | Auto | From GE |
| Gate Entry Reference | Reference → GE | Mandatory. One per GRN. Loaded on selection |
| PO Reference | Auto from GE | |
| STO Reference | Auto from GE | If GRN is for STO receipt |
| Vendor | Auto from PO | |
| Movement Type | Auto | P101 (standard GRN) / STO_RECEIPT (STO GRN) |
| Posted By | Auto | Logged-in Stores user |
| Remarks | Text | Optional |

---

### 93.3 — GRN Line Fields

Lines auto-loaded from GE. Stores cannot add or delete lines — only edit qty and receiving fields.

| Field | Type | Rules |
|---|---|---|
| Line Number | Auto | From GE line |
| Material | Auto from GE | |
| PO / STO Line Reference | Auto from GE | |
| GE Qty | Decimal | Read-only. Reference — what Security recorded at gate |
| Net Weight (Weighbridge) | Decimal | Read-only. Auto from GE Gross − Gate Exit Tare (for BULK/TANKER). Blank for STANDARD |
| Received Qty | Decimal | **Stores enters actual received qty**. For BULK/TANKER defaults to Net Weight — overridable |
| UOM | Auto from PO | |
| Discrepancy | Auto | GE Qty − Received Qty. Shown for reference. Positive = shortage, Negative = excess |
| Storage Location | Reference | Default from 3-level hierarchy (Material Master → PO line → GRN override). Stores can change |
| Stock Type | Auto | UNRESTRICTED (no QA) / QA_STOCK (QA required — from Material Master) |
| Batch / Lot Number | Text | Manual entry by Stores. **Required only if material has Batch Tracking = ON in Material Master**. Skip if not applicable |
| Expiry Date | Date | Required only if material has FIFO + Expiry = ON in Material Master. Skip otherwise |
| Invoice Number | Text | For import STO GRN — Stores enters vendor invoice. For direct PO GRN — auto from GE |

---

### 93.4 — Batch / Lot Number Rules

| Material Setting | GRN Behaviour |
|---|---|
| Batch Tracking = OFF | Batch field hidden. No entry required |
| Batch Tracking = ON | Batch / Lot Number mandatory. Stores enters manually |
| PM (Packaging Material) | Typically Batch Tracking = OFF. Field not shown |
| RM with lot variation | Batch Tracking = ON. Each GRN lot gets its own batch |

System does **not** auto-generate batch numbers. Stores enters the vendor's lot/batch reference or an internal identifier as decided operationally. If no batch applicable → field is skipped entirely.

---

### 93.5 — Weighbridge Tally (Bulk / Tanker)

For BULK / TANKER deliveries, received qty is derived from weighbridge:

```
Gate Entry:   Truck arrives loaded → Gross Weight recorded
              Unloading happens
Gate Exit:    Empty truck leaves → Tare Weight recorded
              Net Weight = Gross − Tare (auto-calculated by system)

GRN:          Received Qty defaults to Net Weight
              Stores can override if physical count differs
              System shows: GE Gross / Gate Exit Tare / Net Weight / Stores Entered Qty
              Discrepancy = Net Weight − Stores Entered Qty flagged in report
```

**System tally report:** After GRN, system generates a weighment tally showing GE Gross, Gate Exit Tare, Net Weight, GRN Received Qty, and any discrepancy. Available to Stores and Accounts.

---

### 93.6 — Post-GRN Auto-Updates

On GRN posting, system automatically:

| Update | Details |
|---|---|
| Stock Ledger | +Received Qty at Storage Location, Stock Type per line |
| Snapshot | Updated for company + material + location + batch |
| PO Open Qty | Reduced by Received Qty on each line |
| CSN Status | → GRN_DONE (regular CSN) / Cumulative total updated (Bulk CSN) |
| Vendor-Material Info Record | Last Price updated with GRN rate |
| Bulk CSN Balance | Total Received Qty updated. CSN CLOSED if PO balance = 0 |

---

### 93.7 — GRN Amendment / Reversal

| Action | Rule |
|---|---|
| Edit after posting | ❌ Not allowed |
| Reversal (P102) | Allowed with approval. Reverses stock movement. Resets PO open qty. CSN status reverts |
| Re-GRN after reversal | Fresh GRN required |

---

*— End of Section 93 —*

---

## Section 94 — Transporter Master (11 May 2026)

**Session Date:** 11 May 2026
**Status:** ✅ FROZEN
**Scope:** Transporter Master fields, usage direction, context-filtered dropdowns, governance.

---

### 94.1 — Transporter Master Fields

| Field | Type | Rules |
|---|---|---|
| Transporter Code | Auto | System-generated. Global |
| Transporter Name | Text | Mandatory |
| Usage Direction | Dropdown | INBOUND / OUTBOUND / BOTH. Mandatory |
| Mode | Dropdown | ROAD / RAIL / COURIER / MULTI-MODAL |
| Contact Person | Text | Optional |
| Phone | Text | Optional |
| Email | Text | Optional |
| PAN Number | Text | Optional — for TDS applicability |
| GST Number | Text | Optional |
| Address | Text | Optional |
| Active | Flag | Inactive transporters hidden from all dropdowns |

---

### 94.2 — Usage Direction Rules

| Usage Direction | Meaning |
|---|---|
| INBOUND | Handles incoming deliveries (vendor → plant). Procurement side |
| OUTBOUND | Handles outgoing dispatches (plant → customer / plant). Dispatch/Sales side |
| BOTH | Works both ways — appears in both inbound and outbound dropdowns |

**Context-filtered dropdown:** Dropdown list shown to user depends on the document context:

| Document Context | Dropdown Shows |
|---|---|
| CSN, GE (inbound), GRN | INBOUND + BOTH only |
| Gate Exit, STO dispatch, Sales/Dispatch | OUTBOUND + BOTH only |

This keeps each team's list short and relevant. No duplicate records needed for shared transporters.

---

### 94.3 — Governance

| Action | Authority |
|---|---|
| Create INBOUND transporter | Procurement team |
| Create OUTBOUND transporter | Dispatch / Sales team |
| Create BOTH transporter | Either team |
| Edit | Creating team (or SA) |
| Deactivate | Creating team (or SA) |
| SA involvement | Not required for routine operations |

---

### 94.4 — Usage Points in PACE

| Document | Direction | Field | Rule |
|---|---|---|---|
| CSN (Import) | Inbound | Transporter (Port-to-Plant) | INBOUND + BOTH dropdown. Optional |
| CSN (Domestic) | Inbound | Transporter | INBOUND + BOTH dropdown. Optional |
| Gate Entry (inbound) | Inbound | Transporter | INBOUND + BOTH dropdown. Optional |
| Gate Exit (STO dispatch) | Outbound | Transporter | OUTBOUND + BOTH dropdown. Optional |
| Sales / Dispatch | Outbound | Transporter | OUTBOUND + BOTH dropdown. Optional |

Free text entry allowed at all usage points — if transporter is not in master, user can type name directly. Handles one-time or unregistered transporters without blocking operations.

---

*— End of Section 94 —*

---

## Section 95 — CHA Master (Clearing and Handling Agent) (11 May 2026)

**Session Date:** 11 May 2026
**Status:** ✅ FROZEN
**Scope:** CHA Master fields, governance, usage points.

---

### 95.1 — CHA Master Fields

| Field | Type | Rules |
|---|---|---|
| CHA Code | Auto | System-generated. Global |
| CHA Name | Text | Mandatory |
| CHA License Number | Text | Mandatory — customs broker license number |
| GST Number | Text | Optional |
| PAN Number | Text | Optional — for TDS |
| Contact Person | Text | Optional |
| Phone | Text | Optional |
| Email | Text | Optional |
| Address | Text | Optional |
| Ports | Multi-select → Port Master | Ports where this CHA operates. Optional — for reference/filter |
| Active | Flag | Inactive CHA hidden from dropdowns |

---

### 95.2 — Governance

| Action | Authority |
|---|---|
| Create | Procurement team |
| Edit | Procurement team |
| Deactivate | Procurement team |
| SA involvement | Not required |

---

### 95.3 — Usage Points in PACE

| Document | Field | Rule |
|---|---|---|
| CSN (Import) | CHA | Reference → CHA Master. Optional. Procurement enters when known |
| Port Master | Default CHA | Reference → CHA Master. Optional default per port |
| Landed Cost | CHA Charges | CHA reference for cost allocation |

Free text allowed at CSN level — if CHA is not in master, Procurement can type directly. Master reference preferred for tracking and reporting.

---

*— End of Section 95 —*

---

## Section 96 — Customer Master (11 May 2026)

**Session Date:** 11 May 2026
**Status:** ✅ FROZEN
**Scope:** Customer Master fields, governance, usage in Sales/Dispatch module.

---

### 96.1 — Customer Master Fields

| Field Group | Field | Type | Rules |
|---|---|---|---|
| Basic | Customer Code | Auto | System-generated. Global |
| Basic | Customer Name | Text | Mandatory |
| Basic | Customer Type | Dropdown | DOMESTIC / EXPORT |
| Identity | GST Number | Text | Domestic — API auto-fill triggers: Name, Address auto-populated |
| Identity | PAN Number | Text | Optional |
| Identity | Trade License | Text | Optional |
| Address | Registered Address | Text | Auto from GST API for Domestic. Manual for Export |
| Address | Correspondence Address | Text | Optional — if different from registered |
| Contact | Contact Person | Text | Optional |
| Contact | Phone | Text | Optional |
| Contact | Email | Text | Optional |
| Financial | Payment Terms | Reference → Payment Terms Master | Dynamic last-used — same pattern as Vendor Master |
| Financial | Credit Limit | Decimal | Optional. For credit sales tracking |
| Company | Company Mapping | Multi-select | Which companies this customer can buy from |
| Status | Active | Flag | Inactive customers hidden from dropdowns |
| Status | Status | Dropdown | ACTIVE / BLOCKED / PENDING_APPROVAL |

---

### 96.2 — Governance

| Action | Rule |
|---|---|
| Create | Stores / Accounts team |
| Edit | Stores / Accounts team |
| Approve | Required — authorized approver (single level, same as Vendor Master) |
| Block / Deactivate | Authorized user. Reason mandatory |
| Multi-company | Customer can be active for multiple companies simultaneously |

---

### 96.3 — Payment Terms — Dynamic Last Used

Same pattern as Vendor Master (Section 85.6.3):
- No static default in Customer Master
- New sales document auto-loads payment terms from last confirmed sales invoice for this customer
- First transaction → blank → Stores/Accounts enters manually
- After invoice confirmed → becomes new last-used for this customer

---

### 96.4 — Usage Points in PACE

| Document | Field | Rule |
|---|---|---|
| Customer PO (Sales) | Customer | Reference → Customer Master |
| Delivery Challan (Sales) | Customer | Auto from Customer PO |
| Sales Invoice | Customer | Auto from Customer PO |

---

*— End of Section 96 —*

---

## Section 97 — Sales / Dispatch Module: RM/PM Outward (11 May 2026)

**Session Date:** 11 May 2026
**Status:** ✅ FROZEN
**Scope:** RM/PM outward sale only. FG dispatch in Logistics module (separate). Proper SO → Stock Issue → Delivery Challan → GST Invoice. No GST portal integration for now.

---

### 97.1 — Scope Boundary

| In Scope (L2) | Out of Scope |
|---|---|
| RM / PM outward sale to external customers | FG dispatch → Logistics module |
| RM / PM outward via STO (inter-company) | GST portal / e-invoice integration → later phase |
| Sales Order, Delivery Challan, GST Invoice | Returns, Credit Note, Debit Note → later phase |
| Stores + Accounts team handles | QC on outward → later phase |

---

### 97.2 — Two Triggers — Same Sale Process

| Trigger | Who Creates Controlling Document | Flow |
|---|---|---|
| External Customer PO | Stores / Accounts creates SO in PACE | SO → Stock Issue → Delivery Challan → GST Invoice |
| STO (inter-company) | Procurement creates STO (Section 92) | STO → Stock Issue → Delivery Challan (auto) → Transfer Invoice |

Both follow the same dispatch workflow after the controlling document is created.

---

### 97.3 — Sales Order (SO) — External Customer

**Proper SO document. Created in PACE when customer sends their PO.**

#### SO Header Fields

| Field | Type | Rules |
|---|---|---|
| SO Number | Auto | Global number series |
| SO Date | Date | System date. Backdating allowed |
| Company | Reference | Selling company |
| Customer | Reference → Customer Master | Mandatory |
| Customer PO Number | Text | Customer's own PO reference. Mandatory |
| Customer PO Date | Date | Optional |
| Delivery Address | Text | Defaults from Customer Master. Overridable |
| Payment Terms | Reference → Payment Terms Master | Dynamic last-used from Customer Master |
| Status | Auto | CREATED → ISSUED → INVOICED → CLOSED |
| Created By | Auto | Stores / Accounts user |
| Remarks | Text | Optional |

#### SO Line Fields

| Field | Type | Rules |
|---|---|---|
| Line Number | Auto | Sequential |
| Material | Reference → Material Master | RM / PM only — other material types blocked |
| Quantity | Decimal | Mandatory |
| UOM | From Material Master | |
| Rate | Decimal | Mandatory. Stores / Accounts enters |
| Discount % | Decimal | Optional |
| Net Rate | Auto | Rate − Discount |
| GST Rate | From Material Master | Auto-populated. Overridable |
| GST Amount | Auto | Calculated from Net Rate × Qty × GST Rate |
| Total Value | Auto | Net Rate × Qty + GST |
| Issue Storage Location | Reference | From which location stock will be issued. Default from Material Master |

---

### 97.4 — Stock Issue (Dispatch)

```
Stores opens SO (or STO)
    ↓
Selects lines to dispatch (full or partial)
    ↓
System checks stock availability at Issue Storage Location
    → Insufficient stock → warning shown (no hard block — Stores decides)
    ↓
Stores confirms stock issue (no approval required)
    ↓
Movement posted: SALES_ISSUE (external) / STO_ISSUE (inter-company)
    → Stock deducted from selling company
    ↓
Delivery Challan auto-generated
    ↓
Gate Exit recorded by Security
```

**Partial dispatch:** Allowed. SO remains open for balance. Balance can be dispatched in subsequent issues.

---

### 97.5 — Delivery Challan

**Auto-generated on stock issue. Cannot be manually created.**

| Field | Type | Rules |
|---|---|---|
| DC Number | Auto | Global number series |
| DC Date | Auto | System date |
| SO / STO Reference | Auto | |
| Company (Seller) | Auto | |
| Customer / Receiving Company | Auto | |
| Delivery Address | Auto from SO | |
| Material, Qty, UOM, Rate | Auto from SO lines issued | |
| Total Value | Auto | |
| Transporter | Text / Reference | Stores fills at dispatch time |
| Vehicle Number | Text | Stores / Security fills |
| LR Number | Text | Optional — can enter later |
| Driver Name | Text | Optional |
| Remarks | Text | Optional |

---

### 97.6 — GST Sales Invoice

**Created by Accounts after Delivery Challan. GST format. No portal submission for now.**

| Field | Type | Rules |
|---|---|---|
| Invoice Number | Auto | Global number series |
| Invoice Date | Date | Accounts enters. Backdating allowed |
| Company (Seller) | Auto | |
| Customer | Auto from SO/DC | |
| DC Reference | Reference → Delivery Challan | Mandatory |
| SO Reference | Auto from DC | |
| Material, Qty, Rate | Auto from DC | |
| Taxable Value | Auto | |
| GST Type | Auto | CGST+SGST (intra-state) / IGST (inter-state) — based on seller + buyer state |
| GST Rate | Auto from SO line | |
| GST Amount | Auto | |
| Total Invoice Value | Auto | |
| Payment Terms | Auto from SO | |
| Remarks | Text | Optional |

**GST portal integration:** Not in scope for July 1. Invoice is GST-format compliant for manual filing. Portal e-invoice integration in a later phase.

---

### 97.7 — Status Flow

```
SO: CREATED → (partial/full issue) → ISSUED → (invoice raised) → INVOICED → CLOSED
DC: AUTO_GENERATED → (gate exit done) → DISPATCHED
Invoice: DRAFT → POSTED
```

SO closes when all lines fully dispatched and invoiced, or when Stores/Accounts knocks off balance.

---

### 97.8 — Authority

| Action | Who |
|---|---|
| Create SO | Stores / Accounts |
| Create STO (for inter-company) | Procurement team |
| Stock Issue | Stores (no approval required) |
| Delivery Challan | Auto — no manual creation |
| GST Invoice | Accounts |
| Gate Exit | Security |

---

*— End of Section 97 —*

---

## Section 98 — Return to Vendor (RTV), Debit Note & Exchange (11 May 2026)

**Session Date:** 11 May 2026
**Status:** ✅ FROZEN
**Scope:** RTV triggers, movement types, Gate Exit, settlement modes (Debit Note / Next Invoice Adjust / Exchange), debit note pricing, exchange flow, import RTV, partial return.

---

### 98.1 — RTV Triggers

| Reason | Example |
|---|---|
| QA Failure | Material fails lab/visual inspection after GRN |
| Excess Delivery | Vendor sent more than PO qty, excess returned |
| Wrong Material | Incorrect material delivered |
| Damaged | Material arrived damaged |
| Quality Deviation | Below spec but not full failure — partial return |
| Any other reason | Free text reason field on RTV document |

All reasons valid. Reason mandatory on every RTV.

---

### 98.2 — Stock Flow Before Return

Material must be in **BLOCKED** stock before RTV can be posted.

```
Path 1 — QA Failure:
  GRN → QA_STOCK → QA Fail (P321 fail) → BLOCKED → RTV (P122)

Path 2 — Direct Return (no QA process):
  Material in UNRESTRICTED → Move to BLOCKED (P344) → RTV (P122)
```

| Movement | Action |
|---|---|
| P321 (fail) | QA fail → QA_STOCK to BLOCKED |
| P344 | Manual transfer → UNRESTRICTED to BLOCKED |
| P122 | Return to Vendor → BLOCKED to OUT (stock leaves company) |

**Rule:** P122 only allowed from BLOCKED stock. Material cannot be returned directly from UNRESTRICTED or QA_STOCK.

---

### 98.3 — RTV Document Fields

#### RTV Header

| Field | Type | Rules |
|---|---|---|
| RTV Number | Auto | Global number series |
| RTV Date | Date | System date. Backdating allowed |
| Company | Auto | |
| Vendor | Auto from original GRN | |
| Original GRN Reference | Reference → GRN | Mandatory |
| Original PO Reference | Auto from GRN | |
| Return Reason | Dropdown + Text | Category + free text. Mandatory |
| Settlement Mode | Dropdown | DEBIT_NOTE / NEXT_INVOICE_ADJUST / EXCHANGE |
| Exchange Reference | Reference → Exchange | Auto-created if Settlement Mode = EXCHANGE |
| Status | Auto | CREATED → DISPATCHED → SETTLED |
| Created By | Auto | Stores / Accounts user |
| Remarks | Text | Optional |

#### RTV Lines

| Field | Type | Rules |
|---|---|---|
| Line Number | Auto | |
| Material | Auto from GRN | |
| Original GRN Qty | Decimal | Read-only. Reference |
| Return Qty | Decimal | Stores enters. Can be partial (less than GRN qty) |
| UOM | Auto from GRN | |
| Storage Location | Auto from BLOCKED stock location | |
| Movement Type | Auto | P122 |

**Partial return:** Allowed. Return Qty can be less than original GRN Qty. Remaining stays in BLOCKED until disposition.

---

### 98.4 — Gate Exit on RTV

When vendor's truck collects returned material:

```
RTV created → status: CREATED
    ↓
Stores moves material to staging (physical)
    ↓
Security: Gate Exit
  → RTV reference
  → Vehicle Number, Driver
  → Transporter (optional)
  → Actual Return Qty confirmed
  → RST / Weighment (if BULK/TANKER — mandatory)
    ↓
P122 movement posted → stock leaves company
RTV status → DISPATCHED
```

---

### 98.5 — Settlement Modes

#### Mode 1: DEBIT_NOTE

Formal debit note raised against vendor.

**Debit Note Pricing Rules (based on Freight Terms on original PO):**

| Freight Term | Debit Note Value |
|---|---|
| FOR (vendor delivers to plant) | Material Value + Unloading Charges (at receipt) + Loading Charges (at return) |
| Freight Separate (buyer pays freight) | Material Value + Freight + Other Landed Costs + Loading + Unloading |

Landed Cost values (freight, insurance, handling) pulled from Landed Cost record (Section 87.9) linked to original GRN.

| Debit Note Field | Type | Rules |
|---|---|---|
| Debit Note Number | Auto | Global number series |
| Date | Date | Accounts enters |
| RTV Reference | Auto | |
| Vendor | Auto | |
| Material Value | Auto | Return Qty × Original GRN Rate |
| Freight (if applicable) | Auto from Landed Cost | Proportional to return qty |
| Other Landed Costs | Auto from Landed Cost | Proportional |
| Loading Charges | Manual | Accounts enters |
| Unloading Charges | Manual | Accounts enters (from original receipt) |
| Total Debit Note Value | Auto | Sum of all components |
| Status | Dropdown | DRAFT → SENT → ACKNOWLEDGED → SETTLED |

#### Mode 2: NEXT_INVOICE_ADJUST

No formal debit note. Return value tracked as pending adjustment against vendor.

```
RTV dispatched (P122 done)
    ↓
System records: Vendor X has pending return credit = ₹Y
    ↓
Next invoice arrives from Vendor X
    ↓
Accounts processes invoice:
  System shows: "Pending return adjustment: ₹Y"
  Accounts deducts from invoice → pays net amount
    ↓
Adjustment marked as SETTLED
```

Pending adjustments visible in vendor account view. No debit note document created.

#### Mode 3: EXCHANGE

Vendor takes back defective material and sends replacement.

```
Step 1 — Return leg:
  RTV (P122) + Gate Exit
  Exchange Reference Number auto-created
  Debit Note raised (or Next Invoice — Accounts decides)

Step 2 — Replacement leg:
  Vendor sends replacement
  Normal GE → GRN (references same Exchange Reference Number)

Step 3 — Settlement:
  New Invoice − Return Value = Net payable/receivable
  Accounts settles net amount
```

Both transactions linked via **Exchange Reference Number**. Document flow shows full exchange chain.

---

### 98.6 — Import RTV

For import materials (foreign vendor), physical return is usually not practical.

| Settlement Option | How it works |
|---|---|
| Credit Note from vendor | Vendor issues credit note → value adjusted in next payment |
| Next Shipment Adjustment | Vendor adjusts qty/value in next shipment |
| Replacement in next shipment | Exchange mode — replacement comes in next container |

RTV document still created in PACE (for stock movement P122 and record). Settlement Mode = NEXT_INVOICE_ADJUST or EXCHANGE. Physical Gate Exit may not happen for import returns — Gate Exit optional in this case.

---

### 98.7 — RTV Status Flow

```
CREATED → (Gate Exit done) → DISPATCHED → (settlement done) → SETTLED
```

For EXCHANGE: both RTV and replacement GRN must be completed before status = SETTLED.

---

*— End of Section 98 —*

---

## Section 99 — Document Number Series — Complete Design (11 May 2026)

**Session Date:** 11 May 2026
**Status:** ✅ FROZEN
**Scope:** Number series format for all documents. Supersedes Section 33.6 for document scope. Section 33.1–33.5 (PO continuity rules) remain valid.

---

### 99.1 — Core Rules

| Rule | Detail |
|---|---|
| PO | Company + Section specific. Prefix/suffix format. FY-based. Continues from last used number (Section 33) |
| STO | Company + Section specific. Prefix/suffix format. Format to be defined per company at implementation |
| All other operational documents | **Global** — one shared counter across all same-group companies. Pure numeric only. No prefix, no suffix, no FY |
| Invoice | **Global**. Special format: YYYY + MM + incremental digits |
| SAP alignment | Movement/operational documents are client-level global in SAP. PACE follows same principle |

---

### 99.2 — Document Number Format Table

| Document | Scope | Format | Example | FY Reset |
|---|---|---|---|---|
| Purchase Order | Company + Section | Prefix/NNN/YYYY-YY (existing patterns) | AC/RP125/2026-27 | Yes |
| STO | Company + Section | Prefix/STO/NNN/YYYY-YY (format TBD per company) | TBD | Yes |
| CSN | Global | Pure numeric | 000001, 000002 | Never |
| Gate Entry | Global | Pure numeric | 000001, 000002 | Never |
| Gate Exit | Global | Pure numeric | 000001, 000002 | Never |
| GRN | Global | Pure numeric | 000001,000002 | Never |
| Delivery Challan | Global | Pure numeric | 000001, 000002 | Never |
| Sales Order | Company | Pure numeric | 000001, 000002 | Never |
| RTV | Global | Pure numeric | 000001, 000002 | Never |
| Debit Note | Global | Pure numeric | 000001, 000002 | Never |
| Exchange Reference | Global | Pure numeric | 000001, 000002 | Never |
| Invoice (Sales + Purchase) | Global | YYYYMM + incremental | 202607000001 | Never |

---

### 99.3 — Invoice Number Format Detail

```
Format: YYYYMM + incremental digits (zero-padded)
Example: 202607000001 (July 2026, first invoice)
         202607000002 (July 2026, second invoice)
         202608000001 (August 2026, first invoice of month)
```

| Component | Detail |
|---|---|
| YYYY | 4-digit year |
| MM | 2-digit month (01–12) |
| Incremental | Sequential digits — continues globally across months and years. Never resets |
| Scope | Global — one counter across all same-group companies and all invoice types |

Invoice number is globally unique and lifetime unique. The YYYY+MM prefix is for human readability — the incremental portion never resets.

---

### 99.4 — Conflict Resolution: Section 33.6

Section 33.6 listed GRN, Gate Entry as "Company + Plant + FY" scoped. This is now **superseded** by Section 87.15 and this section.

| Document | Section 33.6 (old) | Section 99 (current — AUTHORITATIVE) |
|---|---|---|
| GRN | Company + Plant + FY | Global, pure numeric |
| Gate Entry | Company + Plant + FY | Global, pure numeric |
| Process Order | Company + Plant/Section + FY | Governed by Layer 3 design |
| Dispatch/Delivery | Company + Section + FY | Global, pure numeric |

Section 33.6 is hereby **archived**. Section 99.2 is the authoritative number format reference.

---

### 99.5 — STO Number Format (To Be Defined)

STO follows same prefix/suffix pattern as PO. Actual format is company and section specific. To be confirmed per company at implementation time, following the same continuity rules as PO (Section 33.3).

---

*— End of Section 99 —*

---

## Section 100 — Invoice Verification — Full Design (11 May 2026)

**Session Date:** 11 May 2026
**Status:** ✅ FROZEN
**Scope:** Invoice Verification (IV) for domestic and import. 3-way match. GST verification. Multiple GRNs per invoice. Import landed cost bills handled separately.

---

### 100.1 — Scope and Authority

| Item | Detail |
|---|---|
| Who can post IV | Stores + Accounts (both) |
| Process type | In-system (SAP MIRO equivalent) |
| Domestic | Vendor GST invoice → 3-way match + GST verification |
| Import — Vendor Invoice | 3-way match (same as domestic) |
| Import — Other bills (freight, BOE, CHA, insurance) | Accounts enters separately → Landed Cost module (Section 87.9) |
| Match required | Yes — system blocks posting if outside tolerance |
| Tolerance | 50% (rate variance between PO rate and Invoice rate) |
| Multiple GRNs | One IV can reference multiple GRN lines from same vendor |

---

### 100.2 — 3-Way Match Logic

```
PO Rate × GRN Qty = Expected Value
Invoice Rate × Invoice Qty = Invoice Value

Match Check:
  |Invoice Rate − PO Rate| / PO Rate ≤ 50% → ✅ MATCH — can post
  |Invoice Rate − PO Rate| / PO Rate > 50% → ❌ BLOCKED — cannot post
```

**Qty Match:**
- Invoice Qty must equal GRN Qty (exact match)
- If vendor invoices partial qty → only that qty posted. Balance remains open for next IV

**Hard Block:** System will not allow posting if rate variance > 50%. No override without correcting the discrepancy. User must either:
- Correct the invoice entry (if data entry error), OR
- Amend the PO rate (via PO amendment + approval flow), then re-verify

---

### 100.3 — Invoice Verification Document Fields

#### IV Header

| Field | Type | Rules |
|---|---|---|
| IV Number | Auto | Global number series (pure numeric — Section 99) |
| IV Date | Date | System date. Backdating allowed |
| Company | Auto | From vendor/GRN |
| Vendor | Reference → Vendor Master | Mandatory |
| Vendor Invoice Number | Text | Vendor's own invoice number. Mandatory |
| Vendor Invoice Date | Date | Date on vendor's physical invoice |
| PO Reference | Reference → PO | Auto-loaded when GRN lines selected |
| Status | Auto | DRAFT → MATCHED → POSTED / BLOCKED |
| Posted By | Auto | User |
| Remarks | Text | Optional |

#### IV Lines (loaded from GRN selection)

| Field | Type | Rules |
|---|---|---|
| Line Number | Auto | |
| GRN Reference | Reference → GRN | Selected by user. Multiple GRNs allowed |
| GRN Line | Reference | |
| Material | Auto from GRN | |
| GRN Qty | Decimal | Read-only. From GRN |
| Invoice Qty | Decimal | User enters from vendor invoice |
| PO Rate | Decimal | Read-only. From PO |
| Invoice Rate | Decimal | User enters from vendor invoice |
| Rate Variance % | Auto | |(Invoice Rate − PO Rate)| / PO Rate × 100 |
| Match Status | Auto | ✅ MATCHED / ❌ BLOCKED |
| Taxable Value | Auto | Invoice Rate × Invoice Qty |

#### Domestic GST Fields (per line)

| Field | Type | Rules |
|---|---|---|
| GST Rate | Auto from Material Master | Overridable |
| GST Type | Auto | CGST+SGST (intra-state) / IGST (inter-state) |
| CGST Amount | Auto | Taxable Value × CGST Rate |
| SGST Amount | Auto | Taxable Value × SGST Rate |
| IGST Amount | Auto | Taxable Value × IGST Rate (inter-state) |
| Invoice GST Amount | Decimal | User enters GST amount from vendor invoice |
| GST Match | Auto | System compares calculated vs entered. Flag if different |

#### Import — Vendor Invoice (same as domestic 3-way match)

No additional fields beyond the base IV. Other import costs (freight, BOE, CHA) go to Landed Cost.

---

### 100.4 — Import Bills — Landed Cost Entry

For import consignments, bills arrive at different times and from different parties. Accounts enters these separately in the Landed Cost module:

| Bill Type | Who Sends | Who Enters in PACE |
|---|---|---|
| Vendor Invoice | Overseas vendor | Accounts |
| Freight Bill | Shipping line / forwarder | Accounts |
| BOE (Bill of Entry) | Customs / CHA | Accounts |
| CHA Charges | Clearing Agent | Accounts |
| Insurance | Insurer | Accounts |
| Port Charges | Port authority | Accounts |

**Design rule:** Procurement does not know which bills will come or how many. Accounts receives bills as they arrive and enters in system against the CSN/GRN reference. Each bill is a separate Landed Cost entry (Section 87.9).

---

### 100.5 — IV Status Flow

```
DRAFT (user building IV)
    ↓ All lines MATCHED
MATCHED (ready to post)
    ↓ User posts
POSTED (liability created — payment can be processed)

OR

DRAFT
    ↓ Any line BLOCKED (rate variance > 50%)
BLOCKED (cannot post — user must resolve)
    ↓ Discrepancy resolved (PO amended or invoice corrected)
MATCHED → POSTED
```

---

### 100.6 — Partial Invoice

Vendor may invoice partial qty against a GRN:

```
GRN: RM-001 → 1,000 KG received
Vendor Invoice 1: 600 KG → IV posted for 600 KG
Vendor Invoice 2: 400 KG → IV posted for 400 KG (balance)
```

Each partial IV is a separate IV document. System tracks invoiced vs un-invoiced qty per GRN line. PO/GRN invoice status shows PARTIALLY_INVOICED until all qty invoiced.

---

### 100.7 — IV and Payment Flow

```
IV POSTED → Payment liability recorded in system
            ↓
            Accounts processes payment (via Tally during transition)
            PACE IV reference used in Tally for cross-reference
            ↓
            Future: PACE handles full payment workflow
```

No payment can be processed without a posted IV. IV is the payment authorization document.

---

*— End of Section 100 —*

---

## Section 101 — Inward QA Module Design (11 May 2026)

**Session Date:** 11 May 2026
**Status:** ✅ FROZEN
**Scope:** Inward QA full design — trigger, QA document, test types, usage decision, partial QA, movement types, authority. Compiles decisions from Sections 6.2, 12, 21, 22, and this session.

---

### 101.1 — QA Trigger

| Rule | Detail |
|---|---|
| Trigger | GRN posted with stock type = QA_STOCK |
| QA required flag | Material Master: "QA required on inward = Y". Plant Extension can override per plant |
| If QA = N | GRN posts directly to UNRESTRICTED. No QA document |
| If QA = Y | GRN posts to QA_STOCK. QA document auto-created. Pending QA team action |
| Who does QA | QA team (separate from Stores and Procurement) |

---

### 101.2 — QA Document (Inspection Lot)

One QA document per GRN line that lands in QA_STOCK.

#### QA Document Header

| Field | Type | Rules |
|---|---|---|
| QA Document Number | Auto | Global number series (pure numeric) |
| QA Date Created | Auto | On GRN posting |
| Company | Auto from GRN | |
| Plant | Auto from GRN | |
| GRN Reference | Auto | |
| PO Reference | Auto | |
| Material | Auto from GRN | |
| Vendor | Auto from GRN | |
| Batch / Lot Number | Auto from GRN | If batch tracked |
| QA_STOCK Qty | Auto from GRN | Total qty pending QA decision |
| Status | Auto | PENDING → IN_PROGRESS → DECIDED |
| Assigned To | Reference → QA User | QA team assigns to specific QA officer |

#### QA Document Lines — Test Results

| Field | Type | Rules |
|---|---|---|
| Test Type | Dropdown | VISUAL / MCT / LAB / OTHER |
| Test Parameter | Text | What was tested (e.g., Moisture Content, Colour, Odour) |
| Test Result | Text | Actual result entered |
| Acceptable Range | Text | From Material Spec (reference) |
| Pass / Fail | Dropdown | PASS / FAIL |
| Tested By | Auto | Logged-in QA user |
| Test Date | Date | |
| Remarks | Text | Optional |

**Phase-1 scope:** VISUAL and MCT tests captured manually. LAB test results entered manually by QA team. Lab integration (Phase-2) will allow direct import of lab results.

---

### 101.3 — Usage Decision

After tests complete, QA officer/manager makes Usage Decision on the QA document.

| Usage Decision | Meaning | Movement Type | Resulting Stock Type |
|---|---|---|---|
| RELEASE | Material accepted — passes QA | P321 | QA_STOCK → UNRESTRICTED |
| BLOCK | Material held — further investigation needed | P344 | QA_STOCK → BLOCKED |
| REJECT | Material rejected — return to vendor | P344 | QA_STOCK → BLOCKED (then RTV: P122) |
| SCRAP | Material destroyed — no return | P553 | QA_STOCK → SCRAP (stock out) |
| FOR_REPROCESS | Failed QA but approved for reuse as RM in production | Role-restricted | QA_STOCK → FOR_REPROCESS |

#### Authority

| Decision | Authority |
|---|---|
| RELEASE | QA User (authorized) |
| BLOCK | QA User (authorized) |
| REJECT | QA Manager (higher authority) |
| SCRAP | QA Manager (higher authority) |
| FOR_REPROCESS | Role-restricted authorized user (Section 21) |

---

### 101.4 — Partial QA Decision

**Partial decision allowed — different portions of same lot can get different decisions.**

```
GRN: 1,000 KG → QA_STOCK

QA Decision:
  700 KG → RELEASE (P321) → UNRESTRICTED
  200 KG → REJECT  (P344) → BLOCKED → RTV
  100 KG → SCRAP   (P553) → out

System posts three separate movements on same QA document.
Total must equal original QA_STOCK qty.
```

Each partial decision line has its own qty, decision, movement type, and authority check.

---

### 101.5 — Stock Flow — Full Picture

```
GRN (P101) → QA_STOCK
               ↓ Usage Decision
       ┌────────────────────────────┐
       ↓          ↓           ↓         ↓
  UNRESTRICTED  BLOCKED   FOR_REPROCESS  SCRAP
  (P321)        (P344)    (role-restricted) (P553)
                  ↓
              RTV (P122)
              or hold
```

---

### 101.6 — QA Parameters by Material Type

Test parameters are material-specific. QA team configures which tests apply to which materials in Material Master (QA parameter list). Phase-1: manual configuration by SA/QA manager. Phase-2: full test plan with specification limits.

| Material Category | Typical Tests (Phase-1) |
|---|---|
| RM — Chemical | Visual, MCT, Lab (manual entry) |
| RM — Fibre | Visual, MCT |
| PM — Carton / Box | Visual only |
| PM — Bags | Visual only |
| Bulk / Tanker | Visual, MCT, density check (manual) |

QA team can add or skip tests per material as needed. No hard lock on test list in Phase-1.

---

### 101.7 — Layer Assignment

| QA Stage | Layer | Status |
|---|---|---|
| Inward QA (after GRN) | **L2 — Procurement** | ✅ Designed here (Section 101) |
| Production / In-process QA | L3 — Production | Design in L3 session |
| FG QA (before dispatch) | L5 — Dispatch | Design in L5 session |
| Return QA (customer return) | L5 — Dispatch | Design in L5 session |

Inward QA is formally assigned to **Layer 2 (Procurement)** — it is part of the procurement receipt cycle (GRN → QA → stock release). All other QA stages belong to their respective layers.

---

*— End of Section 101 —*

---

## Section 102 — Inbound Gate Exit (Bulk / Tanker Tare Weight) (11 May 2026)

**Session Date:** 11 May 2026
**Status:** ✅ FROZEN
**Scope:** Gate Exit document for inbound delivery trucks (after unloading). Tare weight capture for Bulk/Tanker. Net Weight calculation. Flows to GRN.

---

### 102.1 — Purpose

For BULK/TANKER inbound deliveries, quantity is determined by weighment:
```
Truck arrives loaded → Gate Entry → Gross Weight
Material unloaded at Stores
Empty truck exits → Gate Exit → Tare Weight
Net Weight = Gross Weight − Tare Weight → flows to GRN
```

Standard (non-bulk) inbound deliveries do not require Gate Exit. Gate Exit is mandatory for BULK/TANKER inbound, optional for STANDARD.

---

### 102.2 — Inbound Gate Exit Document Fields

#### Header

| Field | Type | Rules |
|---|---|---|
| Gate Exit Number | Auto | Global number series (pure numeric) |
| Gate Exit Date/Time | Auto + user-entry | System timestamp always recorded. User enters date/time of actual exit |
| Company | Auto | |
| Plant | Auto | |
| Gate Entry Reference | Reference → GE | Mandatory. Links this exit to the arrival |
| Vehicle Number | Auto from GE | Confirm or override |
| Driver Name | Auto from GE | Optional. Confirm or override |
| Gate Staff | Auto | Logged-in Security user |

#### Weighment Fields

| Field | Type | Mandatory | Rules |
|---|---|---|---|
| RST Number (Tare) | Text | BULK/TANKER: ✅ Yes. STANDARD: ❌ No | Weighbridge slip for tare. May be same slip as entry or separate |
| Tare Weight | Decimal | BULK/TANKER: ✅ Yes. STANDARD: ❌ No | Empty truck weight (KG / MT) |
| Net Weight | Decimal | Auto | Gross Weight (from GE) − Tare Weight. Auto-calculated. Read-only |
| Net Weight Override | Decimal | Optional | If weighbridge issues final net directly — enter here. Overrides auto-calculation |

---

### 102.3 — Net Weight Flow

```
Gate Entry: Gross Weight = 28,500 KG
Gate Exit:  Tare Weight  =  6,200 KG
            Net Weight   = 22,300 KG (auto = 28,500 − 6,200)

GRN: Received Qty defaults to 22,300 KG
     Stores can override if needed
     Discrepancy report generated if overridden
```

Net Weight from Gate Exit → auto-updates in Gate Entry record → GRN received qty defaults to this value.

---

### 102.4 — Rules

| Rule | Detail |
|---|---|
| One Gate Exit per Gate Entry | Each inbound GE can have only one Gate Exit |
| BULK/TANKER | Gate Exit mandatory before GRN can be posted |
| STANDARD | Gate Exit optional — GRN can be posted without Gate Exit |
| RST flexibility | Some weighbridges issue one RST with gross + tare + net. In this case, RST entered at Gate Entry (gross) and same RST referenced at Gate Exit (tare). Both valid |
| Backdating | Allowed — same rule as Gate Entry |
| Gate Exit after GRN | Not allowed — Gate Exit must be done before GRN for BULK/TANKER |

---

### 102.5 — Document Flow

```
CSN → GE (Gross Weight) → [Unloading] → Gate Exit (Tare Weight) → GRN (Net Weight) → QA → Stock
```

Full bi-directional navigation: GRN → Gate Exit → GE → CSN → PO.

---

*— End of Section 102 —*

---

## Section 103 — L2 Implementation Plan (11 May 2026)

**Session Date:** 11 May 2026
**Status:** ✅ FROZEN
**Scope:** Full Layer 2 implementation plan. Gate structure, task list, dependencies, verification criteria. Codex implements — verification by document review against design sections.

---

### 103.1 — L2 Gate Structure

Gate-13 (original single gate) is expanded into 9 sub-gates for L2. All sub-gates must complete before L3 begins.

```
Gate-13.1: L2 Masters
  ├── Payment Terms Master
  ├── Port Master
  ├── Port-to-Plant Transit Master
  ├── Material Category Master (procurement planning grouping)
  ├── Lead Time Master — Import
  ├── Lead Time Master — Domestic
  ├── Transporter Master (INBOUND/OUTBOUND/BOTH + context-filtered dropdown)
  └── CHA Master

Gate-13.2: Purchase Order
  ├── Vendor-Material Info Record (Approved Source List)
  ├── Purchase Order — full lifecycle
  │   ├── Header (all fields: Incoterms, Cost Center, Freight Terms, Payment Terms, Delivery Type flag)
  │   ├── Lines (material, qty, rate, UOM, storage location, cost center)
  │   ├── STANDARD / BULK / TANKER indicator
  │   ├── LC Required flag (from Payment Terms)
  │   ├── Has Rebate flag
  │   ├── Indent Required flag (sticky from Vendor Master)
  │   └── PO Confirm → CSN auto-creation trigger
  ├── PO Amendment (rate + qty → approval. Others → no approval)
  ├── PO Approval workflow
  ├── PO Cancellation (no approval, reason mandatory)
  ├── PO Knock-off (individual line or full PO)
  └── PO Auto-mail (PDF on confirm → vendor email + CC)

Gate-13.3: Consignment Tracking System (CSN)
  ├── CSN auto-creation on PO confirm (one per line item)
  ├── CSN types: IMPORT / DOMESTIC / BULK
  ├── CSN full field list (Section 89.9 + Section 90.6)
  │   ├── Import fields: Vessel, BL, BOE, LC, ETD, ETA cascade
  │   ├── Domestic fields: LR Date, Transporter
  │   ├── Common: Vendor Indent, Rebate, Vessel Booking Confirmed Date
  │   └── Bulk CSN: simplified fields, multiple GE per CSN
  ├── ETA Cascade engine
  │   ├── Import: O → Y → AH → AI → AP → AR auto-recalculation
  │   └── Domestic: PO Date / LR Date + Transit Days
  ├── Mother CSN + Sub CSN structure
  ├── Sub CSN → STO transform (in-place, origin reference preserved)
  ├── CSN status flow (ORDERED → IN_TRANSIT → ARRIVED → GRN_DONE)
  ├── Partial dispatch → balance CSN auto-create
  ├── Alert system
  │   ├── LC overdue / due-in-3-days alert
  │   ├── Vessel Booking Confirmed Date missing alert (PO + 3 days)
  │   └── Alert tab UI (LC tab / Vessel Booking tab / count badge)
  └── Single Window Tracker view (flat list, filter, inline edit)

Gate-13.4: Gate Entry + Inbound Gate Exit
  ├── Gate Entry redesign — Header + Lines
  │   ├── Header: vehicle, date/time, driver, gate staff
  │   ├── Lines: PO/STO ref, CSN ref, invoice/BOE number, qty
  │   └── Weighment fields: RST, Gross, Tare, Net (BULK/TANKER mandatory)
  ├── GE-CSN auto-linking
  ├── GE visibility: company-scoped open CSNs
  ├── Backdating (allowed, system timestamp preserved)
  ├── Inbound Gate Exit (Section 102)
  │   ├── Tare weight entry (BULK/TANKER mandatory)
  │   ├── Net Weight = Gross (from GE) − Tare (auto)
  │   └── Net Weight flows to GRN
  └── Gate Exit for STO receipt (same GE document, STO reference)

Gate-13.5: GRN
  ├── GRN document (one per GE)
  ├── GRN field list (Section 93)
  │   ├── Lines auto-loaded from GE
  │   ├── Received Qty (Stores enters), GE Qty (read-only), Discrepancy (auto)
  │   ├── Storage Location (3-level hierarchy)
  │   ├── Stock Type (auto from Material Master QA flag)
  │   ├── Batch/Lot (manual, if material requires)
  │   └── Expiry Date (if FIFO + Expiry ON)
  ├── Weighbridge tally (GE Gross + Gate Exit Tare → Net → GRN default)
  ├── Post-GRN auto-updates (stock ledger, snapshot, PO balance, CSN status, last price)
  ├── GRN reversal (P102, with approval)
  └── GRN → IV link (invoiced status tracking)

Gate-13.6: Inward QA
  ├── QA document auto-create on GRN (if QA required = Y)
  ├── QA document fields (Section 101)
  │   ├── Test lines: test type, parameter, result, pass/fail
  │   └── Assignment to QA officer
  ├── Usage decision engine
  │   ├── RELEASE → P321 (QA_STOCK → UNRESTRICTED)
  │   ├── BLOCK → P344 (QA_STOCK → BLOCKED)
  │   ├── REJECT → P344 → RTV queue
  │   ├── SCRAP → P553
  │   └── FOR_REPROCESS → role-restricted movement
  ├── Partial QA decision (multiple qty splits, multiple movements)
  └── Authority enforcement (QA user vs QA manager)

Gate-13.7: STO + Inter-Company Distribution
  ├── STO full lifecycle (Section 92)
  │   ├── Types: CONSIGNMENT_DISTRIBUTION / INTER_PLANT
  │   ├── Header + Lines (transfer price dynamic last-used)
  │   ├── Status flow: CREATED → DISPATCHED → RECEIVED → CLOSED
  │   └── Knock-off + cancellation
  ├── Sub CSN → STO transform flow
  ├── STO dispatch (sending side)
  │   ├── Stock issue (STO_ISSUE movement)
  │   ├── Delivery Challan auto-generation
  │   └── Gate Exit (outbound, Section 92.6 + weighment for BULK/TANKER)
  ├── STO receipt (receiving side)
  │   ├── GE (STO reference + Delivery Challan number)
  │   └── GRN (STO_RECEIPT movement)
  ├── STO visibility (sending + receiving company Stores + Accounts)
  └── LR Number flow: Gate Exit → CSN tracker sync

Gate-13.8: Return to Vendor + Invoice Verification
  ├── RTV document (Section 98)
  │   ├── All trigger types (QA fail, excess, wrong, damaged)
  │   ├── Stock path: BLOCKED → P122
  │   ├── Partial return
  │   └── Settlement modes: DEBIT_NOTE / NEXT_INVOICE_ADJUST / EXCHANGE
  ├── RTV Gate Exit (truck collects returned material)
  ├── Debit Note
  │   ├── Pricing rules by Freight Term (Section 98.5)
  │   └── Landed cost proportional allocation
  ├── Next Invoice Adjust — pending credit tracking per vendor
  ├── Exchange Reference — two linked transactions (RTV + replacement GRN)
  ├── Invoice Verification — Section 100
  │   ├── 3-way match (PO rate vs GRN qty vs Invoice — 50% tolerance)
  │   ├── Hard block on mismatch
  │   ├── Domestic GST fields (CGST/SGST/IGST verification)
  │   ├── Multiple GRNs per IV
  │   ├── Partial invoice tracking
  │   └── IV → payment authorization
  └── Import Landed Cost entry (Accounts — freight, BOE, CHA, insurance)

Gate-13.9: Sales / Dispatch (RM/PM Outward)
  ├── Customer Master (Section 96)
  ├── Sales Order full lifecycle (Section 97)
  │   ├── Header (Customer PO reference, Payment Terms)
  │   └── Lines (RM/PM only, rate, GST rate, issue location)
  ├── Stock issue — SALES_ISSUE movement (no approval)
  ├── Delivery Challan auto-generation
  ├── Gate Exit (outbound sales)
  ├── GST Sales Invoice (Accounts creates — CGST/SGST/IGST auto)
  └── SO status flow (CREATED → ISSUED → INVOICED → CLOSED)
```

---

### 103.2 — Full Task List with Gate Assignment

| # | Task | Gate | Design Ref | Depends On |
|---|---|---|---|---|
| 1 | Payment Terms Master — CRUD + governance | 13.1 | 87.4 | — |
| 2 | Port Master — CRUD | 13.1 | 89.4 | — |
| 3 | Port-to-Plant Transit Master — CRUD | 13.1 | 89.5 | Port Master |
| 4 | Material Category Master — CRUD | 13.1 | 89.6 | — |
| 5 | Lead Time Master Import — CRUD | 13.1 | 89.7 | Port Master, Material Category Master |
| 6 | Lead Time Master Domestic — CRUD | 13.1 | 89.8 | — |
| 7 | Transporter Master — CRUD + usage direction + context dropdown | 13.1 | 94 | — |
| 8 | CHA Master — CRUD | 13.1 | 95 | Port Master |
| 9 | Vendor-Material Info Record (Approved Source List) — CRUD | 13.2 | 85.7 | Vendor Master (L1) |
| 10 | PO — header + lines (all fields) | 13.2 | 85.2, 87.2–87.9 | Vendor Master, Info Record |
| 11 | PO — STANDARD/BULK/TANKER indicator | 13.2 | 91.1 | PO |
| 12 | PO — LC Required flag from Payment Terms | 13.2 | 90.1 | PO, Payment Terms Master |
| 13 | PO — Rebate flag + Indent flag (sticky from Vendor Master) | 13.2 | 90.3, 90.4 | PO |
| 14 | PO Amendment (rate/qty → approval, others → free) | 13.2 | 87.11 | PO |
| 15 | PO Approval workflow | 13.2 | 87.10 | PO |
| 16 | PO Cancellation + Knock-off | 13.2 | 87.12, 87.6 | PO |
| 17 | PO Auto-mail (PDF on confirm) | 13.2 | 85.2.7 | PO |
| 18 | CSN auto-creation engine (PO confirm → one per line) | 13.3 | 88.2 | PO |
| 19 | CSN full field list — IMPORT/DOMESTIC/BULK types | 13.3 | 89.9, 90.6, 91.2 | CSN engine |
| 20 | ETA cascade engine (Import + Domestic) | 13.3 | 89.2, 89.3 | CSN, Lead Time Masters |
| 21 | Mother CSN + Sub CSN structure | 13.3 | 88.3 | CSN |
| 22 | Sub CSN → STO transform | 13.3 | 88.4 | CSN, STO (13.7) |
| 23 | Partial dispatch → balance CSN auto-create | 13.3 | 88.8 | CSN |
| 24 | CSN Alert engine (LC + Vessel Booking) | 13.3 | 90.1, 90.2, 90.7 | CSN |
| 25 | Single Window Tracker view + alert tabs | 13.3 | 88.10, 90.7 | CSN, Alerts |
| 26 | Gate Entry — Header + Lines redesign | 13.4 | 88.1 | CSN |
| 27 | GE — Weighment fields (RST/Gross/Tare/Net) | 13.4 | 91.3 | GE |
| 28 | GE — CSN auto-link + company-scoped visibility | 13.4 | 88.6 | GE, CSN |
| 29 | Inbound Gate Exit (tare weight + net calculation) | 13.4 | 102 | GE |
| 30 | GRN — full field list (one per GE) | 13.5 | 93 | GE, Gate Exit |
| 31 | GRN — weighbridge tally + discrepancy report | 13.5 | 93.5 | GRN, Gate Exit |
| 32 | GRN — post-GRN auto-updates (stock, PO, CSN, last price) | 13.5 | 93.6 | GRN, Stock Engine |
| 33 | GRN reversal (P102) | 13.5 | 93.7 | GRN |
| 34 | QA document auto-create from GRN | 13.6 | 101.1, 101.2 | GRN |
| 35 | QA — test result entry (Visual/MCT/Lab) | 13.6 | 101.2 | QA document |
| 36 | QA — usage decision engine + movements (P321/P344/P553) | 13.6 | 101.3 | QA document |
| 37 | QA — partial decision (multiple qty splits) | 13.6 | 101.4 | QA usage decision |
| 38 | QA — authority enforcement (QA user vs QA manager) | 13.6 | 101.3 | QA, ACL |
| 39 | STO — full lifecycle (CONSIGNMENT_DISTRIBUTION + INTER_PLANT) | 13.7 | 92 | CSN, Stock Engine |
| 40 | STO — dispatch (stock issue + DC auto-generate + Gate Exit) | 13.7 | 92.5, 92.6 | STO |
| 41 | STO — receipt (GE + GRN at receiving company) | 13.7 | 92.7 | STO, GE, GRN |
| 42 | STO — visibility rules (sending/receiving company) | 13.7 | 92.8 | STO, ACL |
| 43 | RTV — document + movement (P344 + P122) | 13.8 | 98 | Stock Engine, QA |
| 44 | RTV — Gate Exit | 13.8 | 98.4 | RTV, Gate Exit |
| 45 | Debit Note — pricing rules by Freight Term | 13.8 | 98.5 | RTV, Landed Cost |
| 46 | Next Invoice Adjust — pending credit tracking | 13.8 | 98.5 | RTV |
| 47 | Exchange Reference — two linked transactions | 13.8 | 98.5 | RTV, GRN |
| 48 | Invoice Verification — 3-way match + 50% tolerance | 13.8 | 100 | PO, GRN |
| 49 | IV — GST fields (CGST/SGST/IGST verification) | 13.8 | 100.3 | IV |
| 50 | IV — partial invoice + invoiced balance tracking | 13.8 | 100.6 | IV |
| 51 | Landed Cost entry (Accounts — import bills) | 13.8 | 87.9, 100.4 | GRN |
| 52 | Customer Master — CRUD + approval | 13.9 | 96 | — |
| 53 | Sales Order — full lifecycle (RM/PM only) | 13.9 | 97 | Customer Master, Stock |
| 54 | Stock issue — SALES_ISSUE + DC auto-generate | 13.9 | 97.4, 97.5 | SO, Stock Engine |
| 55 | GST Sales Invoice (Accounts) | 13.9 | 97.6 | SO, DC |
| 56 | Planning view per company (incoming CSNs) | 13.3 | 88.13 | CSN, STO |

---

### 103.3 — Gate Dependencies

```
Gate-13.1 (Masters) must complete first — no dependencies on other L2 gates
    ↓
Gate-13.2 (PO) — needs Masters + L1 Vendor Master
    ↓
Gate-13.3 (CSN) — needs PO + Masters
    ↓
Gate-13.4 (GE + Gate Exit) — needs CSN
    ↓
Gate-13.5 (GRN) — needs GE + Gate Exit
    ↓
Gate-13.6 (Inward QA) — needs GRN
    ↓
Gate-13.7 (STO) — needs CSN + GE + GRN (can run in parallel with 13.6)
    ↓
Gate-13.8 (RTV + IV) — needs GRN + QA + Stock Engine
    ↓
Gate-13.9 (Sales/Dispatch) — needs Customer Master + Stock Engine (can start after 13.1)
```

---

### 103.4 — Verification Checklist per Gate

For each gate, Codex implements and verification confirms:

#### Gate-13.1 — Masters
- [ ] All 8 masters created with correct fields
- [ ] Governance rules enforced (who can CRUD)
- [ ] Context-filtered dropdown on Transporter (INBOUND/OUTBOUND/BOTH)
- [ ] Port → Port-to-Plant → Lead Time chain works correctly

#### Gate-13.2 — PO
- [ ] PO confirm triggers CSN auto-creation
- [ ] Approved Source List hard block on PO line
- [ ] STANDARD/BULK/TANKER indicator visible and functional
- [ ] LC Required auto-sets from Payment Terms
- [ ] Indent flag sticky behavior from Vendor Master
- [ ] PO Amendment: rate/qty needs approval, others don't
- [ ] PO Auto-mail sends PDF on confirm
- [ ] PO number format matches company + section pattern (Section 33)

#### Gate-13.3 — CSN
- [ ] One CSN auto-created per PO line on confirm
- [ ] CSN type = IMPORT/DOMESTIC based on PO; BULK if Delivery Type = BULK/TANKER
- [ ] ETA to Plant recalculates on every date field entry
- [ ] Mother/Sub CSN creation, edit, delete works
- [ ] Sub CSN transforms in-place on STO mapping
- [ ] Partial dispatch creates balance CSN automatically
- [ ] LC alert fires on due date. Dismissed on LC Opened Date + LC Number entry
- [ ] Vessel Booking alert fires after PO + 3 days with empty Vessel Booking Confirmed Date
- [ ] Alert tabs show correct counts. Auto-clear on completion

#### Gate-13.4 — GE + Gate Exit
- [ ] GE is Header + Lines (multi-PO, multi-line)
- [ ] Vendor auto-identified from PO (not manually entered)
- [ ] Only company-scoped open CSNs shown to Security
- [ ] RST/Gross/Tare mandatory for BULK/TANKER GE
- [ ] Inbound Gate Exit: Tare entered → Net = GE Gross − Tare auto
- [ ] Net Weight flows to GRN default

#### Gate-13.5 — GRN
- [ ] One GRN per GE — cannot span multiple GEs
- [ ] GRN lines auto-loaded from GE
- [ ] BULK/TANKER: GRN qty defaults to Net Weight. Stores can override
- [ ] Discrepancy (GE Qty − GRN Qty) shown
- [ ] Batch/Lot shown only if material has Batch Tracking = ON
- [ ] Post-GRN: stock ledger, snapshot, PO balance, CSN status all updated
- [ ] Last price updated on Vendor-Material Info Record
- [ ] GRN reversal resets all auto-updates

#### Gate-13.6 — Inward QA
- [ ] QA document auto-created for materials with QA required = Y
- [ ] Test lines can be added with type/parameter/result/pass-fail
- [ ] Usage decision posts correct movement type
- [ ] Partial decision: sum of partial qtys = original QA_STOCK qty
- [ ] REJECT → BLOCKED stock, then available for RTV
- [ ] FOR_REPROCESS: role-restricted, not available to regular QA users

#### Gate-13.7 — STO
- [ ] STO types (CONSIGNMENT_DISTRIBUTION / INTER_PLANT) behave identically after creation
- [ ] Transfer price defaults to last used (Vendor-Material Info Record pattern)
- [ ] Delivery Challan auto-generates on stock issue
- [ ] Sending company sees STO in their dispatch queue
- [ ] Receiving company sees STO in their inbound queue
- [ ] STO Gate Exit: weighment mandatory for BULK/TANKER
- [ ] STO receipt GE uses Delivery Challan number (not vendor invoice)

#### Gate-13.8 — RTV + IV
- [ ] RTV only allowed from BLOCKED stock (P122)
- [ ] Direct return from UNRESTRICTED: P344 first, then P122
- [ ] Three settlement modes available and functional
- [ ] Debit Note value = correct formula per Freight Terms
- [ ] Next Invoice Adjust shows pending credit on vendor's next IV
- [ ] IV hard blocks if rate variance > 50%
- [ ] GST type (CGST+SGST vs IGST) auto from seller + buyer state
- [ ] Multiple GRNs can be selected in one IV
- [ ] Partial invoice: invoiced balance tracked correctly per GRN line

#### Gate-13.9 — Sales/Dispatch
- [ ] SO only allows RM/PM materials (other types blocked)
- [ ] Stock issue: no approval needed
- [ ] DC auto-generated on stock issue — cannot be manually created
- [ ] GST Invoice: CGST+SGST for intra-state, IGST for inter-state — auto
- [ ] SO partial dispatch: SO stays open for balance
- [ ] Invoice number format: YYYYMM + incremental (Section 99)

---

### 103.5 — Global Rules — Verify Across All Gates

| Rule | Verify |
|---|---|
| Global number series (pure numeric) | GRN, GE, Gate Exit, CSN, DC, RTV, Debit Note, Exchange — all global, no prefix, no FY reset |
| Invoice number format | YYYYMM + incremental. Global |
| PO number format | Company + Section prefix/suffix. Continues from last used (Section 33) |
| Audit trail | Every document creation, edit, posting has audit entry |
| Bi-directional document flow | PO ↔ CSN ↔ GE ↔ GRN ↔ QA ↔ STO ↔ RTV — navigable in any direction |
| Company scope | Every document is company-scoped. Users see only their company's data |
| Stock posting engine | Every transaction uses stock posting engine. No direct stock edit |
| ACL enforcement | Every action gated by ACL capability check |

---

### 103.6 — What Goes to Phase-2 (Post Go-Live)

| Item | Reason Deferred |
|---|---|
| Single Window Tracker UI (full) | Concept frozen — UI design separate session |
| Planning Dashboard UI | Concept frozen — UI design separate session |
| Rebate Tracker full design | Flag captured — full workflow later |
| Lab test result integration | Phase-2 (Section 6.2) |
| GST portal / e-invoice integration | Phase-3 |
| STO number series format | TBD per company at implementation |
| Batch number format | User to provide existing format |

---

*— End of Section 103 —*

---

---

*PACE_ERP Operation Management — SAP-Style Discovery and Feasibility*
*Document Version: 1.0 | Date: 1 May 2026 | Status: DRAFT*
*Constitution Reference: PACE_ERP_MASTER_CONSTITUTION.md (FINAL)*
