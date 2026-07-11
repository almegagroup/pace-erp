# GATE-27 (L3 Production) — CODEX DRIVER GUIDE & IMPLEMENTATION SEQUENCE

**Purpose:** Let implementation of the **already-locked** Gate-27 design continue by driving Codex directly, even when Claude is unavailable. Claude verifies each landed task on return and keeps the sequence moving. **Nothing here introduces new design — every item points to a locked feasibility §83.x section.**

**Owner note:** Run the tasks **in order, one at a time**. Each task = one brief = one Codex run = one log entry. Do not start the next task until the current one's Codex run has finished and logged.

---

## 0. How to run one task with Codex

```bash
timeout 500 codex exec --skip-git-repo-check 'Read the task brief at "docs/Operation Management/implementation-specs/<BRIEF-FILE>.md" and implement it EXACTLY as written. Implement ONLY what the brief locks — invent no extra design. Do NOT run any git commands. When done, append one entry to docs/Codex-Log.md using its existing template.'
```

**After Codex finishes a task:**
1. Codex will have edited files + appended to `docs/Codex-Log.md`.
2. **Do NOT push.** Leave the changes for Claude to verify on return (Claude reviews, fixes any drift, applies migrations to Dev, then commits). If you prefer to commit yourself to snapshot progress, use a message ending with `Co-Authored-By: Codex <codex@openai.com>` and **do not push** — but leaving it uncommitted is fine too; Claude will sort it.
3. Move to the next brief in the sequence.

**⚠️ Migrations can't be applied by Codex** (it has no DB access). A task with a migration gets the *file written* but the table/columns won't exist in Dev until the migration is **applied**. Either wait for Claude (applies via MCP on return) or apply yourself with `supabase db push`. Until applied, that task's backend code will error at runtime — that's expected, not a bug.

---

## 1. Guardrails — every task must obey (Codex + reviewer)

These come from `PACE_ERP_MASTER_CONSTITUTION.md`, `CLAUDE.md` §8A/§8B/§8C, and the memory rules. A task that violates one is **not** done.

- **Implement ONLY the locked design** (the referenced §83.x). No extra fields, no "improvements," no reserve-at-approve-instead-of-Standard, nothing outside the brief. (User finalizes design → doc → then implement; Codex never designs.)
- **Zero errors bar:** no 400 / 403 / 500 on any flow. New routes MUST be registered in `_acl/route-acl-registry.ts` (unregistered = 403). New `erp_*` schema must be exposed in Supabase Dashboard (not a migration) before its endpoints work.
- **R-01:** never render a raw UUID; resolve every FK to a code/name (backend bulk `.in()` resolve, frontend shows name or `—`).
- **useQuery, not useEffect+setState** for data fetching (CLAUDE.md §8A Rule 2).
- **Batch, don't loop** (CLAUDE.md §8B): independent per-row DB work → one batched `.in()` / `Promise.all`; dependent (stock posting) → keep sequential + `// DEPENDENT:` comment.
- **Schema-first** (Constitution §16): always `serviceRoleClient.schema("x").from("y")`.
- **Migrations** (Constitution §10): idempotent, order-safe (`IF NOT EXISTS` / `DROP … IF EXISTS`). Business/operational DATA = MCP (dev+prod separately), never a migration.
- **File header** (Constitution §9): every file keeps the full header block.
- **post_stock_movement** (CLAUDE.md §8C): call it with the plain business document_number repeatedly if needed; it assigns item_number itself — never add `-OUT`/suffix.

### Known Codex gotchas (seen this session — watch for these on review)
- **Em-dash / unicode corruption:** Codex's PowerShell file writes have turned `—` into mojibake (`â€"`) and reformatted whitespace it wasn't asked to. On review, grep the touched file for mojibake and revert any unrequested reformat. (Claude repaired 2 such artifacts in Gate-27.3.)
- Codex sometimes touches sections the brief said to leave alone — diff carefully against "out of scope."

---

## 2. Sequence (dependency order)

Legend: ✅ done · 🟢 brief written, ready to run · ⚪ brief not yet written (Claude writes on return, or Codex implements from the §ref under the guardrails).

| # | ID | Title | Locked ref | Migration? | Brief | Status |
|---|----|-------|-----------|-----------|-------|--------|
| — | 27.3 | Process PO Create 400 fix (send po_type + segment_code) | §83.4 | no | `CODEX-GATE27.3-PROCESSPO-CREATE-FIX-TASK-BRIEF.md` | ✅ DONE + committed `25b450e` |
| — | 27.4 | Reservation (reserve@Standard, clear@Prune) + availability netting + Prune endpoint | §83.5, §83.4 | yes | `CODEX-GATE27.4-RESERVATION-PRUNE-TASK-BRIEF.md` | ✅ DONE + committed `b93f462` (Codex-run during downtime, Claude-verified, migration applied to Dev) |
| — | 27.5 | QA Queue (PR16) field-mismatch fix — list shows blank/zero/raw-UUID today | §83.4 (PR16) | no | `CODEX-GATE27.5-QAQUEUE-FIELD-FIX-TASK-BRIEF.md` | ✅ DONE + committed `b93f462` (Codex-run during downtime, Claude-verified) |
| 1 | 27.6 | **Consolidated brief** — Process PO full chain: Standard (machine + po_type branching) → QA Approve/Reject (cascade-to-PRUNED fix) → PR10 Edit (new) → Start Batch (MTS-skip-QA fix) → INT complete-int (new) → Final (Approved/AP-Approved/Variance/substitution) → Verify (QI hold + P321 auto-release + reservation-issue + `process_order_line_reco` commit) → CORS (3-movement P262+P322+P102 + reservation reinstate + reco void) — DB+BE+FE | §83.3 (substitution registry), §83.4 (whole lifecycle), §83.5 (reservation/reco/INT), §83.7 (batch), §83.9 (machine) | **yes** | `CODEX-GATE27.6-PROCESSPO-FULL-CHAIN-TASK-BRIEF.md` | 🟢 READY — **supersedes the old separate 27.6–27.10/27.12(partial) stub rows below**, which are now merged into this one brief. **User confirmed:** INT/MTEST completion sets `status='VERIFIED'` (reuse, no new status value). |

**~~Old stub rows (superseded by 27.6 above — do not use separately)~~:** machine_id (was 27.6), po_type branching (was 27.7), Final draft cols (was 27.8), Verify posting + reco table (was 27.9), CORS reversal (was 27.10) — all merged into the one consolidated `CODEX-GATE27.6-PROCESSPO-FULL-CHAIN-TASK-BRIEF.md`.

**Still separate, not yet briefed (deliberately out of the 27.6 consolidated brief's scope — see its §4):**
| # | ID | Title | Locked ref | Status |
|---|----|-------|-----------|--------|
| 2 | 27.11 | PR16 expandable QA-queue full rebuild (batch# column, sort order, formulation grid) + PR17 Batch Number Release true design (note: existing `BatchReleasePage.jsx` is NOT actually PR17 — it's a differently-purposed "Manager triggers Start Batch" page; leave it alone until this item) | §83.4 (PR16/PR17) | ⚪ |
| 3 | 27.13 | Polished dedicated MTEST page (functionally MTEST already works via the existing create endpoint per 27.6 §2.1 — this would just be a nicer dedicated UI) | §83.4 (MTEST) | ⚪ |

**⚠️ Codex self-authored 7 briefs during the downtime this guide describes (`CODEX-GATE27.6` through `27.13` old-numbering + a `BRIEF-STATUS` doc) without being asked to.** These were **NOT reviewed by Claude** and are **superseded/replaced** by the reviewed `CODEX-GATE27.6-PROCESSPO-FULL-CHAIN-TASK-BRIEF.md` above. **Do not run any Codex-self-authored brief** — per the project's standing rule, Codex must only implement what a Claude-reviewed brief locks, never design its own scope. If you still have those files, they can be deleted once Claude confirms 27.6 (this consolidated one) covers their intent (Claude will reconcile on return).

**Data setup (MCP, Claude on return — Dev only; user does Prod later):** seed `production_segment_location_config` for the test company; populate `production_mode` on materials; load opening stock for test strokes' RMs. Needed before any *live* zero-error run of the Standard→Verify chain.

---

## 3. Open decisions

- **Resolved (2026-07-11):** Availability netting (Gate-27.4) nets at **material + company** level (interim, segment config empty) — done, no longer open.
- **Resolved (2026-07-11):** INT/MTEST single-action completion sets `process_order.status = 'VERIFIED'` (user-confirmed, reuse not new value) — locked into `CODEX-GATE27.6-PROCESSPO-FULL-CHAIN-TASK-BRIEF.md`.
- **Open, flagged inside 27.6's brief itself (§3.1):** whether a reusable `ErpSelectionScreen` component already exists in this codebase for the Constitution Rule-5 criteria-first PO-create pattern — Codex is instructed to check and fall back gracefully (log a follow-up) rather than build a new shared component under this brief.

---

## 4. What Claude does on return (verification protocol)
For each task the user ran while away:
1. Read the Codex-Log.md entry + `git diff` (or the committed diff) for that task.
2. Verify against the brief + the locked §83.x: scope match, no drift, no raw UUID, useQuery, §8B loops, §8C stock posting, mojibake/whitespace check.
3. Apply any migration to Dev via MCP; reconcile the local migration filename to the MCP-recorded timestamp (see CLAUDE.md "Migration Naming Fix").
4. Fix drift / bugs; re-run `deno check` / eslint.
5. Append a dated verification entry to `OM-IMPLEMENTATION-LOG.md` (established format).
6. Commit (`Co-Authored-By: Codex` + `Co-Authored-By: Claude Opus 4.8`), then continue the sequence.

---

*Last updated: 2026-07-11 (Gate-27.3 done; 27.4 + 27.5 briefs ready).*
