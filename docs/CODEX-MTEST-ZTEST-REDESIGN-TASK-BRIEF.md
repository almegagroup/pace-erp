# CODEX TASK — MTEST/ZTEST Full Redesign (Two-Order Model, Reusable Pack BOM 001 PM Template, Per-Company Batch Number Format)

## Read first

1. `docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`
   **Section 120** — this is the locked design this brief implements. Read it in full before
   touching any code; this brief is the "how", §120 is the "what and why".
2. `CLAUDE.md` — specifically:
   - The 13 recurring bug patterns checklist (top of the ACL/business-page section) — check every
     one of these against every file you touch in this task, not just the ones that look obviously
     relevant.
   - §8A (no raw UUIDs in any response/UI you touch), §8B (batch vs sequential loop rule — you will
     hit this directly in Work Stream D), §8C/§8D (stock posting engine rules — Verify already
     posts through `post_document`, do not bypass it).
   - The "Bug-Pattern Guard Playbook" if anything you find here looks like a new instance of one of
     the 13 patterns (it shouldn't, but check).
3. Existing worked examples of a full-cycle Process PO, to copy the pattern rather than invent a
   new one: `process_order.handlers.ts`'s `qaApproveProcessOrderHandler`, `startBatchHandler`,
   `finalizeProcessOrderHandler`, `verifyProcessOrderHandler` — all already correctly implement
   MTO/HPS's 5-stage cycle. This task's Work Stream A is almost entirely *removing* MTEST-specific
   special-casing from these functions so MTEST falls through to the exact same code path MTO/HPS
   already use — it is **not** writing new lifecycle logic.

## Hard scope boundary — read this twice

**This task is for MTEST/ZTEST only.** ("ZTEST" and "MTEST" are the same PO type — the business
owner confirmed this in the same conversation as §114.5. `po_type` on `process_order` is always the
literal string `MTEST`; "ZTEST" is a display/legacy name that appears in a few places described
below and must be reconciled to `MTEST`, not the other way around.)

Every change in this brief must leave the following **byte-for-byte behaviorally unchanged**:
- MTO, HPS, MTS, INT Process PO lifecycle, valuation, and reservation behavior.
- Existing MTO/HPS/MTS/INT batch number generation (same prefix + 5-digit zero-padded serial,
  same table, same values for existing rows).
- Existing Pack BOM behavior for 599/000/510-family fixed and non-fixed pack codes other than `001`.

Before opening a PR, run the full existing test/guard suite (`deno check` on every backend file you
touch, `eslint` on every frontend file you touch, and every CI guard script under `scripts/` —
`stock-posting-guard.mjs`, `route-acl-registry-guard.mjs`, `hardcoded-role-check-guard.mjs`,
`company-scope-guard.mjs`, `company-scope-write-acl-guard.mjs`, `wrong-company-source-guard.mjs`,
`resource-code-domain-guard.mjs`, `frontend-payload-guard.mjs`, `approver-chain-guard.mjs`) and
confirm zero new findings. Also run `node scripts/migration-integrity-check.mjs`'s printed SQL
against dev after applying your migration and confirm `in_sync = true`.

---

## Work Stream A — Process PO: MTEST gets the exact same 5-stage cycle as MTO/HPS (including Verify)

**Current state (verified 2026-08-15):** MTEST already correctly goes through
`Standard → QA Approve → Start Batch → BATCH_STARTED` — `qaApproveProcessOrderHandler`,
`qaRejectProcessOrderHandler`, and `startBatchHandler` already treat MTEST exactly like MTO/HPS (no
change needed in these three functions). The only place MTEST is special-cased away from MTO/HPS is
`finalizeProcessOrderHandler`, where a 2026-08-12 decision made MTEST post stock directly at Final
(skipping Verify) — that decision is now reversed.

### A.1 — `finalizeProcessOrderHandler` (`process_order.handlers.ts`, ~line 2646)

```ts
const postsAtFinal = po.po_type === "INT" || po.po_type === "MTEST";
```

Change to:

```ts
const postsAtFinal = po.po_type === "INT";
```

Once this changes, MTEST Process Orders at BATCH_STARTED that call Final will go through the
**same non-posting branch MTO/HPS/MTS already use** — Final only records actuals via
`applyFinalOrVerifyLineUpdates` and moves status to `FINAL`, with no stock posting. Verify what the
"else" branch (non-`postsAtFinal`) currently does for MTO/HPS and confirm it needs zero MTEST-specific
changes — it shouldn't, since it's already type-agnostic apart from the `postsAtFinal` gate itself.

Update the comment above this line (currently says "Locked 2026-08-12: INT and MTEST have no Verify
stage") to reflect the new state and reference feasibility §120.1.

### A.2 — `verifyProcessOrderHandler` (`process_order.handlers.ts`, ~line 2829)

**This function is already fully po_type-agnostic** — it gates only on `po.status !== "FINAL"`, no
po_type check anywhere. Once A.1 lands, MTEST Process Orders at FINAL will already be verifiable
through this exact function with **zero code changes needed here** — same real valuation as MTO/HPS
(RM/INT issue at current UNRESTRICTED rate, SFG receipt costed as RMC + conversion rate, QI
auto-release via P321, all through `post_document` in one transaction). This is the direct
consequence of "completely like MTO/HPS" — MTEST batches will now get real costing instead of the
old `unit_value: 0` shortcut. Confirm this is understood and intended (it follows directly from the
locked instruction, but it is a real behavior change worth being explicit about in the PR
description).

**⚠️ Concrete blocker — LOCKED decision, but the mechanism needs care, read this fully before
coding:** `verifyProcessOrderHandler` hard-blocks with `PROD_PO_CONVERSION_RATE_MISSING` if
`resolveConversionRate(companyId, segment_code, materialId, today)` returns null. Today,
`deriveSegmentCode()` (`ProductionPOCreatePage.jsx`) has no MTEST case and falls through to
`return ""` for MTEST — meaning `segment_code` would be blank on every MTEST Process PO, and
`resolveConversionRate` will never find a matching config, so **every MTEST Verify will hard-block**
unless this is resolved.

**Locked (business owner, 2026-08-15): MTEST's `segment_code` must resolve to the real family
segment (`ADMIX`/`HPS`/`IWC`/`POWDER`) of whatever Prodshade is actually under test** — the same
rate config that Prodshade's real MTO/HPS/MTS production POs already use, matching "completely like
MTO/HPS" literally. `segment_code` must never end up blank for a real MTEST PO.

**The mechanism is not straightforward — investigate before implementing, do not assume a simple
one-line fix:** `deriveSegmentCode(poType, mtsSegmentCode)` derives segment from `poType` alone for
MTO/HPS/INT (`MTO→ADMIX`, `HPS→HPS`, `INT→INT`), which works because those Process POs' own
`po_type` directly encodes the family. MTEST cannot use the same trick — a Stroke usable for MTEST
testing is itself stored with `stroke_master.po_type = 'MTEST'` (confirmed:
`strokeOptions`/`strokePoType === "MTEST" || strokePoType === "INT"` filter in
`ProductionPOCreatePage.jsx`), **not** the underlying family it's actually testing — so there is no
field to read "ADMIX" or "HPS" off of the selected Stroke directly. MTS already solves an
analogous problem the same way you should default to here: MTS also cannot auto-derive its segment
(`IWC` vs `POWDER`) from `po_type` alone, so it exposes a manual **segment dropdown**
(`MTS_SEGMENTS = ["IWC", "POWDER"]`, wired through `mtsSegmentCode` state →
`deriveSegmentCode("MTS", mtsSegmentCode)`). **Default plan: give MTEST the same manual
segment-selection field at Process PO create**, reusing the real family options (`ADMIX`, `HPS`,
`IWC`, `POWDER` — confirm the exact canonical list against `conversion_cost_config`'s own segment
values, don't invent new segment strings), wired the same way MTS's dropdown is. Only deviate from
this (e.g. auto-deriving from the selected Prodshade material or its linked Stroke history) if you
find a genuine, already-existing field/relationship that reliably carries this information for
every MTEST creation path (both the Prodshade+Stroke path and the direct-FG-SKU `mtestSkuPath`) —
do not invent a new implicit linkage, and do not merge with MTEST simply
  hard-blocked in dev because no one configured a segment/rate for it — that would make this whole
  redesign untestable.

### A.3 — Machine, stroke, manual-line rules — no change

Confirm (do not change) that these MTEST exemptions still hold after A.1/A.2: no machine required
(§83.9), no stroke/BOM required, RM lines entered manually via `body.lines` at create
(`createProcessOrderHandler`, ~line 1844), explicit output storage location required instead of
segment-config lookup (~line 1845). None of this is in scope to change.

### A.4 — Reco / AP-Approved — no change

`skipReco = ["MTS", "INT", "MTEST"].includes(...)` (~line 3259) stays as-is. MTS already goes
through Verify with reco skipped, proving reco-skip and Verify are independent — no conflict with
A.1/A.2.

---

## Work Stream B — Packing PO (PTEST): genuine second document, and a naming inconsistency to fix

**Current state:** the mapping from Process PO type to Packing PO type already exists
(`PROCESS_TO_PACKING_PO_TYPE` in `productionTypeLabels.js`: both `MTEST` and `ZTEST` keys map to
`PTEST`) but has never been exercised end-to-end, because MTEST previously completed everything in
one document. Once Work Stream A lands, a Packing PO can be created against a Process PO's
`VERIFIED` MTEST batch, exactly like MTO/HPS.

### B.1 — Confirm the Packing PO create flow actually works for a VERIFIED MTEST batch

Trace `ProductionPOCreatePage.jsx`'s Packing tab end to end for `source_po_type = MTEST`: SKU
picker (`packingActiveBomsQ`, filtered by an ACTIVE Pack BOM existing for the SKU), stroke
resolution (`resolveApprovedStroke` in `pack_bom.handlers.ts`, exact-match on
`stroke_master.po_type`), and the actual `createPackingOrderHandler` call
(`packing_order.handlers.ts`). Do this as a live dev-data trace, not by reading code in isolation —
confirm each lookup actually returns a row for a real MTEST company/prodshade/stroke combination
before assuming the chain works.

### B.2 — Real naming inconsistency found, must be reconciled to `MTEST`

Three different literal strings currently exist for the same concept, and they do **not** agree:

| File | Symbol | Current value(s) |
|---|---|---|
| `ProductionPOCreatePage.jsx` | `PACKING_SOURCE_TYPES` array | includes `"ZTEST"`, **not** `"MTEST"` |
| `productionTypeLabels.js` | `PROCESS_TO_PACKING_PO_TYPE` | has **both** `MTEST` and `ZTEST` keys → `PTEST` |
| `packing_order.handlers.ts` | `mapPackingTypeToSourceType("PTEST")` | returns `"ZTEST"` only, never `"MTEST"` |
| `packing_order.handlers.ts` | `mapSourceTypeToPackingType()` | accepts **both** `"ZTEST"` and `"MTEST"` → `PTEST` |
| `process_order.handlers.ts` | `VALID_PO_TYPES`, `PROCESS_TYPES` | `MTEST` only, `ZTEST` never appears |
| `opening_genealogy.handlers.ts` | `source_po_type` comparison (~line 727) | compares against whatever string was stored — inherits whichever of the two ends up live |

**Fix:** standardize on `MTEST` everywhere as the canonical value (it's Process PO's own
authoritative `po_type`, and what `stroke_master.po_type`/`process_order.po_type` actually store).
Concretely:
- `PACKING_SOURCE_TYPES`: change `"ZTEST"` → `"MTEST"`.
- `mapPackingTypeToSourceType("PTEST")`: return `"MTEST"` instead of `"ZTEST"`.
- Leave `PROCESS_TO_PACKING_PO_TYPE` and `mapSourceTypeToPackingType()`'s dual-acceptance of both
  strings in place (harmless, and protects any already-created dev rows that may have `"ZTEST"`
  stored in `source_po_type` from a prior manual test — do not silently break those).
- **Before changing this, run a live DB check** (`select distinct source_po_type from
  erp_production.packing_order where source_po_type in ('MTEST','ZTEST')`, both dev and prod) to
  see whether any real row already has `"ZTEST"` stored — if so, this is a data-migration question
  (do these rows need a backfill?), not just a code fix. Report what you find.

### B.3 — Packing PO status/lifecycle — no change

Packing PO (PTEST or otherwise) still has no Verify step (Create/Standard → Final only) — this is
an existing, separately-locked rule (§83.4, reconfirmed multiple times in the doc) and is
**out of scope** for this task. Do not add a Verify stage to Packing PO.

---

## Work Stream C — Pack BOM 001: stays non-fixed, but PM material list becomes a reusable template

**Locked design:** feasibility §120.3. `bom_required` stays `false` for pack code `001` (per-pack
quantity is genuinely case-to-case) — **do not flip it to `true`**. The fix is that the PM
*material identity* becomes reusable (saved once on the Pack BOM), while quantity is still entered
fresh on every Packing PO.

**Current state (code-verified, this is the good news — backend needs zero changes):**
`createPackBomHandler` (`pack_bom.handlers.ts`) already accepts `pmLines` for non-fixed pack codes
and inserts them with `qty: null` (`qty: bomRequired ? parsePositiveNumber(line.qty) : null`), and
auto-approves the BOM to `ACTIVE` immediately (no PR06 approval needed for non-fixed codes) — this
was clearly built to support exactly this use case, it was just never wired up on the frontend.

### C.1 — `PackBomCreatePage.jsx`: stop disabling the PM Lines table for non-fixed pack codes

Find:
```jsx
<PackBomLinesTable
  lines={pmLines}
  setLines={setPmLines}
  ...
  disabled={!bomRequired}
/>
```
Change so material selection stays enabled regardless of `bomRequired`. The submit filter already
does the right thing without any change (`validPm = pmLines.filter((line) => line.material_id &&
(!bomRequired || Number(line.qty) > 0))` — for non-fixed BOMs it only requires `material_id`, qty
is optional). Check `PackBomLinesTable`'s own internal implementation — if its `disabled` prop
disables the qty column too (which you want, for non-fixed codes — quantity genuinely doesn't
belong on the Pack BOM here), you may need a second, more granular prop (e.g. `qtyDisabled` separate
from a full `disabled`) rather than reusing the same flag for both columns. Look at the component
before deciding — don't guess its internal structure.

Update the "PM Lines" section's copy/label for non-fixed pack codes to make the semantics clear to
the user — something like "PM Lines (material list only — quantity entered fresh on each Packing
PO)" — exact wording is not locked, use judgment matching this app's existing copy style (see
CDS content rules in your environment for tone: sentence case, no exclamation marks, plain).

### C.2 — `ProductionPOCreatePage.jsx` Packing tab: read the Pack BOM's PM lines for non-fixed codes too

Find:
```jsx
const packingEffectivePmLines = packingBomRequired ? packingBomPmPreviewLines : packingManualPmPreviewLines;
```

This currently means: for `bomRequired=false` (599/000/001), the Packing PO create flow **always**
starts from an empty manually-built list (`packingManualPmLines`, a fresh `useState([])`) and
**never** reads `packingBomPmPreviewLines` (the actual saved PM lines on the Pack BOM), even after
C.1 makes those lines exist.

Change so that for non-fixed pack codes, if the Pack BOM has PM lines saved (post-C.1), those
populate the starting list — material pre-filled, quantity field blank/editable per Packing PO
instance — instead of forcing the user to pick materials from scratch every time. The user must
still be able to add extra ad-hoc PM lines beyond the template (some cases may need something not
in the usual set) — do not make the template exclusive/locked.

Concretely: derive a `packingBomPmTemplateLines` from `packingBom`'s own PM lines (same source
`packingBomPmPreviewLines` already reads from) regardless of `packingBomRequired`, and seed
`packingManualPmLines`'s initial state from it when the SKU/Pack BOM selection changes, instead of
always starting from `[]`. Preserve the existing "add ad-hoc line" UI so the user can still append
beyond the template.

### C.3 — Scope check

This template-reuse behavior is locked for pack code `001` specifically (§120.3). Whether it should
also apply to 599/510/000 is **not** part of this task — if your C.1/C.2 fix naturally applies to
all non-fixed pack codes (which it likely will, since the mechanism doesn't need to be pack-code-
specific), that's fine and probably desirable, but do not go out of your way to build pack-code-
specific gating for this — the existing `bom_required` flag is already the right generic switch.

---

## Work Stream D — Batch number: per-company selectable numbering method

**Locked design:** feasibility §120.4. Full spec below; implement exactly this, this is the one
work stream with zero open questions.

### D.1 — Migration

New migration file (follow this repo's `<timestamp>_<name>.sql` convention, and the §8A "Migration
Integrity" rule — reconcile `supabase_migrations.schema_migrations` immediately after applying via
MCP, verify with `scripts/migration-integrity-check.mjs`):

```sql
ALTER TABLE erp_production.batch_number_series
  ADD COLUMN numbering_method TEXT NOT NULL DEFAULT 'PLAIN'
    CHECK (numbering_method IN ('PLAIN', 'CONTINUOUS_DATE', 'MONTHLY_RESET_MONYY')),
  ADD COLUMN serial_pad_width INTEGER NOT NULL DEFAULT 5
    CHECK (serial_pad_width BETWEEN 1 AND 10),
  ADD COLUMN reset_period TEXT NULL;
```

`DEFAULT 'PLAIN'` and `DEFAULT 5` on existing columns mean every current MTO/HPS/MTS row is
unaffected — confirm this with a before/after row-count + value diff on dev after applying.

### D.2 — `generateBatchNumber()` (`batch_series.handlers.ts`, ~line 583)

**Two things must change here, not one:**

1. **Real, pre-existing race-condition bug found while reading this function for this task — fix
   it as part of this change, not as scope creep.** The current implementation is
   read-then-write (`SELECT current_count` → compute `nextCount` in JS → separate `UPDATE`), which
   directly violates CLAUDE.md §8B's mandatory rule ("নতুন কোনো number-series বা counter function
   বানালে অবশ্যই single atomic `UPDATE ... RETURNING` pattern ব্যবহার করো... কখনো `SELECT`-এর পরে
   আলাদা `UPDATE` করবে না")। Two concurrent Start Batch calls against the same series can read the
   same `current_count` and both write the same `nextCount`, producing a **duplicate batch number**.
   Since you are rewriting this function anyway for `numbering_method` support, convert it to a
   single atomic statement — either a Postgres function (`UPDATE ... SET current_count =
   current_count + 1 ... RETURNING current_count`, with the monthly-reset branch's conditional reset
   folded into the same statement via a `CASE`) called through one RPC, or an equivalent atomic
   single round-trip. Do **not** change this function's external signature or behavior for
   `PLAIN`-method rows beyond making the increment atomic — MTO/HPS/MTS must produce byte-identical
   batch numbers to today, just via a race-safe path.

2. **New branching on `numbering_method`** to build the final string:
   - `PLAIN` (existing default): `${prefix}${paddedSerial}` — unchanged output.
   - `CONTINUOUS_DATE`: `${prefix}${DD-MM-YYYY of today}/${paddedSerial}` — serial never resets,
     date is a stamp only (does not gate or affect the counter).
   - `MONTHLY_RESET_MONYY`: `${prefix}${MMYY of today}/${paddedSerial}` — if the row's stored
     `reset_period` does not equal the current `MMYY`, reset the serial to start fresh **within the
     same atomic statement** (`current_count` becomes 1 for this call, not 0-then-increment as two
     steps) and update `reset_period` to the current `MMYY` in that same write.
   - `paddedSerial` uses the row's own `serial_pad_width`, not the hardcoded `5` currently in the
     function.

   Verify against the two concrete examples from §120.4:
   - CMP003, prefix e.g. `PREFIX`, `CONTINUOUS_DATE`, pad width 5, generated 2026-08-15, 101st
     batch → `PREFIX15-08-2026/00101`.
   - CMP006, prefix `BMAM`, `MONTHLY_RESET_MONYY`, pad width 4, first batch of August 2026 →
     `BMAM0826/0001`.

### D.3 — SA Batch Series page (`SAProductionBatchSeriesPage.jsx`)

Add, per row, alongside the existing Prefix field:
- **"Numbering Method"** dropdown — options `Plain`, `Continuous + Date`, `Monthly Reset` (label
  text not locked, match this app's existing SA-page dropdown style).
- **"Serial Digits"** number input (the `serial_pad_width` value).

No company name may be hardcoded anywhere in this UI or its backend handler — any company assigned
to any `batch_type` row must be able to pick any method. This is the whole point of the requirement
("future company এলে SA page থেকে decide হয়") — if you find yourself writing `if (companyCode ===
'CMP003')` anywhere, stop, that is exactly the pattern being avoided.

### D.4 — Explicitly OUT of this task's scope — do not do this part

Creating the actual `batch_number_series` rows for CMP003 (MTEST, `CONTINUOUS_DATE`, pad 5) and
CMP006 (MTEST, `MONTHLY_RESET_MONYY`, pad 4) is **operational data**, not code — per CLAUDE.md's
MCP-vs-migration rule, this happens via MCP after this PR merges, done by Claude/business, not by
you. Do not add a data-seeding migration for these specific rows. Your job ends at: the mechanism
exists, is selectable from the SA page, and produces correct output for a row configured either way
— prove that with a manually-inserted test row in your own dev testing, then remove it, unless
asked otherwise.

---

## ACL / menu — check, likely no new resource needed

Packing PO (PTEST) creation reuses the existing `PROD_PO_CREATE` resource family (same page, same
route, just a different `po_type`/`source_po_type` value) — confirm this via
`route-acl-registry.ts` rather than assuming. Process PO Verify already has a `PROD_PO_VERIFY`
resource with no po_type restriction at the ACL layer (matches the handler being po_type-agnostic,
confirmed in Work Stream A.2) — confirm no menu/ACL row anywhere filters MTEST out by type. If you
find one, flag it rather than silently removing it — it may be intentional and this brief may be
missing context.

## 13-pattern checklist — apply explicitly, not just "should be fine"

Before considering any part of this done, re-check every file you touched against CLAUDE.md's 13
recurring bug patterns individually — this repo's own established discipline (see the "Bug-Pattern
Guard Playbook" note) is that this checklist gets skipped by assumption more often than it gets
actually re-applied per concrete change. Patterns most likely to be relevant here, specifically:
- #2 (company-scope gap) — every new/changed handler in Work Streams A/B/D must validate company
  scope on writes, not just reads.
- #6 (one resource code reused for two different actions) — do not let Packing PO's PTEST path
  quietly reuse a resource_code meant for something semantically different.
- #10 (small config/data traps) — the `numbering_method` CHECK constraint, `reset_period` format,
  and the ZTEST/MTEST string reconciliation in Work Stream B.2 are exactly this shape of trap.
- #13 (frontend payload missing a backend-required field) — run `scripts/frontend-payload-guard.mjs`
  after your frontend changes in Work Streams B and C, since both touch payload construction for
  existing write endpoints.

## Verification plan

1. `deno check` on every backend file touched (physical baseline: `process_order.handlers.ts`,
   `packing_order.handlers.ts`, `pack_bom.handlers.ts`, `batch_series.handlers.ts`,
   `productionTypeLabels.js`'s backend-side equivalents if any) — zero new errors versus the
   pre-existing baseline noise (`.range()`/`.or()`/`.gt()` typing, already documented elsewhere in
   this repo — do not attempt to fix those, they are out of scope).
2. `eslint` on every frontend file touched.
3. All CI guard scripts listed in "Hard scope boundary" above — zero new findings.
4. `scripts/migration-integrity-check.mjs` against dev, `in_sync = true`.
5. Live dev-data walkthrough (not just code reading) for one full MTEST cycle: Create → QA Approve →
   Start Batch → Final → Verify → create Packing PO (PTEST) against the Verified batch → Final the
   Packing PO. Confirm batch number, valuation, and stock postings all look correct at each step,
   and that this same walkthrough for an existing MTO or HPS PO produces byte-identical results to
   before this change (run one as a control).
6. Confirm zero impact on INT (still posts at Final, no Verify) and MTS (still Standard→StartBatch,
   no QA gate) by running one control cycle of each.

## Commit convention

Follow this repo's established pattern: clear commit messages explaining the "why", ending with
`Co-Authored-By: Codex`. Multiple commits are fine and encouraged — one per Work Stream (A/B/C/D) is
a reasonable split, since each is independently reviewable and this makes it easier to bisect if
something regresses MTO/HPS/MTS/INT.
