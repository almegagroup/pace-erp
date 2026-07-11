# CODEX-GATE27.17-SFG-QA-CONCRETE-TRIAL-TASK-BRIEF

**Gate:** 27.17
**Domain:** PRODUCTION
**Title:** Add a third, optional "Concrete Trial" (`CT`) test group to SFG Result Recording, alongside MCT/OTHR
**Scope:** 1 small migration + 1 frontend file only (`SfgResultRecordingPage.jsx`)
**Dependency:** Gate-27.16 (done)
**Reference doc:** feasibility §83.4 "SFG Result Recording" note (LOCKED 2026-07-11, Concrete Trial addendum)

---

## 0. Ground facts already verified — do NOT re-derive

- `erp_master.qa_test_method.test_group` has `CHECK (test_group = ANY (ARRAY['MCT','OTHR']))` — must be widened to include `'CT'`.
- `qa_test_method`/`qa_category_test_config` are **shared** with Procurement's Inward QA page. That page's own frontend (`frontend/src/pages/dashboard/procurement/qa/QAQueuePage.jsx`) hardcodes rendering of only MCT/OTHR sections — it will never render a `CT` group even after this schema widening. **Do not touch that file.**
- Business owner confirmed: Concrete Trial is a **third group**, not a method inside OTHR, and behaves exactly like OTHR — **optional**, never gates decision submission (only MCT's `anyMctFail`/`allMctFilled` gating logic applies; `CT` must not be added to those checks).

---

## Change 1 — Migration (new file, additive only)

Create `supabase/migrations/20260711220000_gate27_sfg_qa_concrete_trial.sql`. Idempotent.

```sql
BEGIN;

ALTER TABLE erp_master.qa_test_method DROP CONSTRAINT IF EXISTS qa_test_method_test_group_check;
ALTER TABLE erp_master.qa_test_method ADD CONSTRAINT qa_test_method_test_group_check
  CHECK (test_group = ANY (ARRAY['MCT','OTHR','CT']));

COMMIT;
```

Confirm the real constraint name first (`SELECT conname FROM pg_constraint WHERE conrelid = 'erp_master.qa_test_method'::regclass AND contype = 'c'`) and use the actual name in the `DROP CONSTRAINT IF EXISTS` — do not guess a name that might not match.

**Do not apply this migration** — Claude applies to Dev via MCP.

---

## Change 2 — Frontend: `frontend/src/pages/dashboard/production/SfgResultRecordingPage.jsx` only

Inside `SfgQaExpandedPanel`:

1. Add a `ctConfigs` derived list next to the existing `mctConfigs`/`othrConfigs`:
   ```js
   const ctConfigs = useMemo(() => categoryConfigs.filter((c) => c.qa_test_method?.test_group === "CT"), [categoryConfigs]);
   ```
2. Add a `ctMethodsQuery` next to the existing `mctMethodsQuery`/`othrMethodsQuery`, same shape, `test_group: "CT"`.
3. Add a `ctMethods` derived array the same way `mctMethods`/`othrMethods` are derived.
4. In the render section that currently does:
   ```jsx
   <div className="grid gap-2 lg:grid-cols-2">
     {renderMethodGroup("MCT", mctConfigs, mctMethods)}
     {renderMethodGroup("OTHR", othrConfigs, othrMethods)}
   </div>
   ```
   change the grid to 3 columns (`lg:grid-cols-3`) and add the third call:
   ```jsx
   {renderMethodGroup("CT", ctConfigs, ctMethods)}
   ```
5. In `renderMethodGroup`, the group label switch currently reads `group === "MCT" ? "MCT (mandatory)" : "OTHR (optional)"` — change to a 3-way: `MCT (mandatory)` / `OTHR (optional)` / `Concrete Trial (optional)` for `group === "CT"`.
6. In `handleResultSave`, the line `const testType = config.qa_test_method?.test_group === "OTHR" ? "OTHER" : "MCT";` maps a test_group to the `sfg_qa_test_line.test_type` enum (`VISUAL/MCT/LAB/OTHER` — confirmed this enum is unrelated to and untouched by this task). Map `CT` to `"OTHER"` too (same as OTHR) — do not add a new `test_type` enum value, this task only adds a new `test_group`, not a new `sfg_qa_test_line.test_type`.
7. **Do not touch** `anyMctFail`, `failedMctMethods`, `allMctFilled`, or any decision-submission gating logic — those must remain MCT-only, exactly as locked.
8. **Do not touch** `frontend/src/pages/dashboard/procurement/qa/QAQueuePage.jsx` or any other Procurement file.

---

## Hard rules
1. Only the migration + `SfgResultRecordingPage.jsx`. No other file.
2. `CT` is optional — never wire it into any mandatory/gating check.
3. Confirm the real constraint name before writing the `DROP CONSTRAINT IF EXISTS` line.
4. No raw UUIDs, no new business logic beyond adding the third group's render/query wiring mirroring MCT/OTHR exactly.

## Verification
1. Confirm the migration's constraint name matches what's actually in the DB (query it first).
2. Confirm `anyMctFail`/`allMctFilled`/decision-gating code is unchanged (diff should show zero lines touched there).
3. Confirm `QAQueuePage.jsx` (procurement) has zero diff.

## Log + commit
Append one `docs/Codex-Log.md` entry. **Do not run git commands.**
