# CODEX TASK — Communication Automation Phase 1 Foundation

**Status:** READY FOR APPROVAL — DO NOT IMPLEMENT UNTIL BUSINESS OWNER SAYS `YES`  
**Date:** 2026-09-14  
**Branch:** `dev`  
**Master plan:** `docs/PACE-ERP-COMMUNICATION-AUTOMATION-MASTER-PLAN.md`

---

## Read first

1. `CLAUDE.md` — mandatory development rules, migration rules, ACL/company-scope conventions, bug-pattern checklist, guard scripts, and Dev→Prod workflow.
2. `docs/PACE-ERP-COMMUNICATION-AUTOMATION-MASTER-PLAN.md` — full design lock and phase sequence.
3. Existing menu/ACL/session patterns used by current SA/admin pages before adding any route/handler/data model.
4. Existing migration naming/integrity conventions and current `erp_menu` / ACL patterns.

Do not infer missing conventions. Read the current implementation first and follow the repository's existing architecture.

---

## Phase 1 Goal

Build only the **safe communication capability registry foundation**.

At the end of Phase 1 the backend must be able to answer, for a known page and channel:

- Is this page technically supported by the Communication Automation framework?
- Is this channel currently enabled by central runtime configuration?

Phase 1 is **not** an email-sending phase.

---

## Hard scope boundary

### IN scope

- database foundation for page communication capability registry,
- technical channel constants/contracts,
- initial PO11 registration as Email-capable,
- runtime Email enablement flag,
- backend read contract/service/handler for registry state,
- backend validation so unsupported page/channel combinations cannot be activated,
- ACL/security/grants/indexes/audit columns consistent with PACE conventions,
- tests/guards/documentation required to verify the above.

### OUT of scope — do not touch

- MSG91 API or credentials,
- SMTP or any real email provider,
- automation rules,
- recipients,
- TO/CC/BCC,
- subject templates,
- schedule/frequency/time configuration,
- `pg_cron` scheduler,
- delivery queue/outbox,
- retry engine,
- delivery history,
- condition builder,
- preview,
- PO11 report adapter,
- PO11 `CRITICAL` / `REPLENISH` data extraction,
- PO11 automation drawer/button,
- WhatsApp sending,
- production database changes.

If implementation requires any of the above, stop and report the dependency instead of expanding scope.

---

## Locked model

The framework must distinguish two different facts:

### Technical capability

Example:

`PO11 supports EMAIL = true`

This is developer-controlled. An SA must not be able to convert an unsupported page/channel into a supported integration merely by changing data.

### Runtime enablement

Example:

`PO11 EMAIL enabled = false/true`

This is runtime configuration that the later SA page will toggle.

Do not collapse these two concepts into one boolean.

---

## Work Stream A — Repository discovery before code

Before editing anything, inspect and document in the implementation summary:

1. Current menu/page identity conventions (`tx_code`, `resource_code`, route/page key).
2. Current SA/admin backend route and ACL pattern.
3. Existing audit-column conventions (`created_by`, `created_at`, `last_updated_by`, etc.).
4. Existing schemas used for similar central configuration.
5. Existing RLS/grant/service-role patterns for backend-managed configuration tables.
6. Current migration timestamp/integrity workflow.
7. Current route ACL registry pattern and guard scripts that will be affected.

Prefer reuse over inventing a parallel architecture.

---

## Work Stream B — Database foundation

Create a migration using the repository's current migration conventions.

Target logical schema:

`erp_communication`

If repository/security conventions make another schema demonstrably better, stop and flag the discrepancy before changing the locked master-plan model.

### B.1 `page_registry`

Create the foundation table for developer-supported page/channel capabilities and runtime switches.

Required logical fields:

- `id` UUID primary key
- stable page identity, using existing PACE conventions; preferably include enough of:
  - `tx_code`
  - `resource_code`
  - stable page key if existing code requires it
- human-readable title if the central control UI will need it later
- optional route reference if consistent with current page registry/menu conventions
- `active`
- `supports_email`
- `email_enabled`
- `supports_whatsapp`
- `whatsapp_enabled`
- audit fields following current PACE conventions

### B.2 Constraints

At minimum enforce:

- unique stable page identity,
- `email_enabled = true` cannot exist when `supports_email = false`,
- `whatsapp_enabled = true` cannot exist when `supports_whatsapp = false`,
- allowed values/types are constrained at database/application level where appropriate.

If separate child rows per channel fit existing architecture better than booleans, that may be proposed **before implementation**, but do not silently diverge from the master plan.

### B.3 Indexes

Add only useful indexes for expected lookups, e.g. by stable page identity / active state. Avoid speculative indexing.

### B.4 Security

Follow existing PACE patterns for:

- grants,
- RLS if used for similar backend-owned configuration,
- service access,
- mutation restrictions.

Do not make this table directly writable from untrusted frontend clients.

---

## Work Stream C — Seed/register PO11

Register PO11 using the verified identity from the current repository/menu model:

- Tx Code: `PO11`
- Page: Procurement Planning
- Resource code: `PROC_PLANNING_VIEW`
- Route: `/dashboard/procurement/planning` if the current branch still matches this verified route

Before writing the seed/migration, re-check the dev branch/menu model so the migration does not rely on stale assumptions.

Initial capability:

- `supports_email = true`
- `supports_whatsapp = false` for the live implementation phase

Initial runtime state:

- `email_enabled = false` unless the business owner explicitly instructs otherwise during implementation
- `whatsapp_enabled = false`

Do not hard-code CMP003/CMP006 into this registry. Company-specific rules belong to a later phase.

---

## Work Stream D — Backend communication registry contract

Add a small backend domain/service layer following existing Fastify/Supabase architecture.

It must support a read operation conceptually like:

`getPageCommunicationCapabilities(pageIdentity)`

Expected response shape may be adjusted to existing API conventions, but should communicate at minimum:

```json
{
  "page": {
    "tx_code": "PO11",
    "resource_code": "PROC_PLANNING_VIEW"
  },
  "channels": {
    "email": {
      "supported": true,
      "enabled": false
    },
    "whatsapp": {
      "supported": false,
      "enabled": false
    }
  }
}
```

Do not expose internal database details unnecessarily.

### D.1 Validation contract

Add a reusable validation/helper that later mutation endpoints can use to reject:

- unknown page,
- unsupported channel,
- inactive page registry entry,
- enabling a channel that is not technically supported.

Phase 1 does not need the final SA mutation endpoint unless the current architecture requires it for proving the model. The actual SA central-control UI/API is Phase 2.

### D.2 Route/ACL

If exposing an HTTP read route:

- follow existing authenticated route style,
- add route-ACL registry entry if required by PACE conventions,
- use the appropriate existing resource/action pattern,
- do not hard-code role names.

If a new dedicated communication resource code is required, document why and keep creation consistent with the project's menu/ACL constitution. Do not invent a broad privilege bypass.

---

## Work Stream E — Shared channel constants/types

Create the smallest reusable contract needed for later phases.

Supported logical channel values:

- `EMAIL`
- `WHATSAPP`

WhatsApp is a reserved future channel only. Do not add delivery logic.

Avoid over-engineering a large notification framework in Phase 1.

---

## Work Stream F — Verification

Required verification before declaring Phase 1 complete:

1. Migration applies cleanly on dev.
2. Migration integrity check passes according to `CLAUDE.md`.
3. PO11 registry row exists with correct technical capability and initial runtime state.
4. Database rejects invalid state such as `email_enabled=true` when `supports_email=false`.
5. Backend read contract returns PO11 capability state correctly.
6. Unknown page returns the expected safe not-found/unsupported response.
7. No MSG91/provider secret/code exists in the diff.
8. No scheduler/rule/recipient/queue tables were added outside scope.
9. Route ACL guard passes if a route was added.
10. Company-scope, frontend payload, hardcoded-role, JSX/ESLint/Deno/type checks relevant to touched files show zero new failures.
11. Existing PO11 behavior is unchanged.
12. No production changes are made.

Document any pre-existing baseline failures separately; do not misreport them as Phase 1 regressions.

---

## Acceptance criteria

Phase 1 is complete only when all of the following are true:

- `erp_communication` foundation exists in dev,
- PO11 is technically registered for Email,
- runtime Email enablement is independently represented,
- unsupported channel enablement is prevented,
- backend code can safely read the registry state,
- ACL/security conventions are respected,
- no email is actually sent,
- no page UI is added yet,
- verification passes with no new regressions,
- implementation summary lists every file/migration changed and exact verification commands/results.

---

## Implementation sequence

When explicitly approved with `YES`, execute in this order:

1. Read-first discovery.
2. Confirm final table/route/ACL naming from current repo conventions.
3. Add dev migration.
4. Apply migration to dev only and run migration integrity checks.
5. Add backend registry model/service/read contract.
6. Add minimal route/ACL wiring only if required.
7. Register/verify PO11.
8. Run targeted + repository guard checks.
9. Review diff for scope leakage/security issues.
10. Report results; stop. Do not begin Phase 2.

---

## Explicit implementation gate

**Do not execute this task merely because this file exists.**

Implementation starts only after the business owner explicitly says:

`YES`

After Phase 1 is implemented and verified, stop and request/await approval for Phase 2. Do not automatically continue.
