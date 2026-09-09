# AC10 production ACL verification

Runtime rollout completed in dev and production. The local migration file `20260908190039_ac10_exact_role_or_accounts_acl.sql` was later deleted at the user's request. The applied function and remote migration record remain; history reconciliation is pending.

The existing capability configuration was present in prod, but the shared engine intersected role and context grants. Active production snapshots contained no AC10 decisions. The correction adds a candidate path only for CAP_ACC_RECO_DATA: exact assigned role grant OR work-context grant. Existing deny precedence and all other capability behavior remain intact.

Production versions: CMP003 105, CMP006 105, CMP010 50, CMP014 23. Sources captured into fresh versions; ACL snapshots and per-user menus rebuilt. Migration history matched the repository before the local migration file was deleted; it no longer matches after deletion.

Verified against real production users: Accounts L1_USER, L2_USER, L3_USER, L4_USER and L2_MANAGER allowed; DIRECTOR, L3_MANAGER, L1_AUDITOR and L2_AUDITOR allowed in their non-Accounts contexts. Non-Accounts ordinary users/managers, including L4_MANAGER, have no access. ACL-MASTER's DIRECTOR user allowed. The new snapshots contain 22 allowed user/company/context combinations. No unrelated ACL decision changed; no AC10 ACL/menu visibility mismatch. Atomic assertions would roll back on either a scope mismatch or an unrelated ACL change.

CMP010 has no Accounts work context; existing Accounts contexts in CMP003, CMP006 and CMP014 all have the grant. No company context was invented. This verification used database snapshots, not browser login tests.

Production security advisor reported existing configuration issues in untouched objects: three RLS-enabled tables without policies and disabled leaked-password protection. The migration creates no permanent tables, preserves SECURITY INVOKER and existing search_path, and changes no table grants or auth settings. References: [RLS advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Initial production automatic approval review rejected the shared function replacement. Before retrying, a read-only evaluation against each production active version proved zero non-AC10 changes (AC10 additions: CMP003 12, CMP006 9, CMP010 1, CMP014 0). The retry included this evidence and succeeded.
