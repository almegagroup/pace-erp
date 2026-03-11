# PACE-ERP — STRUCTURAL GAP REGISTER
Version: 1.0

| ID | Gate | File Path | Category | Severity | Description | SSOT Ref | Code Ref | Impact | Status |
|----|------|----------|----------|----------|------------|----------|----------|--------|--------|

Severity Definitions:
🔴 CRITICAL   → Security breach / Isolation break / RLS violation
🟠 STRUCTURAL → Determinism violation / Execution ambiguity
🟡 LOGICAL    → Misalignment but non-breaking
🔵 COSMETIC   → Naming / formatting / clarity issue

| GAP-P2-01 | Phase-2 | acl.acl_versions | LOGICAL | 🟡 | Database does not enforce single active ACL version per company (no partial unique constraint on is_active). Runtime must guarantee exactly one active version; multiple or zero active versions must result in DENY. | Snapshot Determinism Clause | stepAcl → getActiveAclVersionId() | Ambiguity risk only if runtime guard removed | OPEN (Runtime-enforced, DB hardening optional) |

| GAP-P3-01 | Phase-3 | supabase/functions/api/_pipeline/acl.ts | LOGICAL | 🟡 | Authorization currently operates at route-level; action defaults to VIEW. Schema supports granular actions (WRITE / EDIT / DELETE / APPROVE) but runtime does not yet activate them. | Permission Resolution Rule | stepAcl action binding | Governance depth limitation; no security impact | OPEN (Planned Governance Hardening Phase-6) |

| GAP-P4-01 | Phase-4 | Route ↔ Menu Identity Mapping | LOGICAL | 🟡 | Backend routeKey (method:path) to ACL resource_code mapping is indirect and not enforced via centralized shared registry constant. Deterministic but not normalized. | Identity Binding Rule | runner.ts routeKey binding | Governance drift risk in future route expansion | OPEN (Normalization required before large feature expansion) |