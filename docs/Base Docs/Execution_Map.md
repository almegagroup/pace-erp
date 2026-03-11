# EXECUTION DETERMINISM MAP

==========================================================
REQUEST ENTRY
==========================================================

Entry File:
supabase/functions/api/_pipeline/runner.ts

Middleware Chain Order:
Headers →
CORS →
CSRF →
RateLimit →
Session Resolve →
Session Lifecycle Enforcement →
Context Resolve →
ACL →
Route Handler →
Response

Invariant:
No route reachable before ACL resolution.

==========================================================
SESSION LAYER
==========================================================

File:
supabase/functions/api/_core/session/session.create.ts
supabase/functions/api/_core/auth/login.handler.ts

Session Creation:
On login → session row inserted in erp_core.sessions.

Token Validation:
Supabase JWT validated before context resolution.

User Binding:
authUserId extracted from token and bound to request object.

Determinism:
If token invalid → hard stop (no context resolution).

==========================================================
CONTEXT RESOLUTION
==========================================================

File:
supabase/functions/api/_pipeline/context.ts

Parent/Work Resolution:
Company resolution via erp_map.user_companies.

Universe Detection:
SA / GA → Admin Universe.
Company-bound roles → ACL Universe.

Version Binding:
Exactly one ACL version must be selected per company
by deterministic runtime resolver.

If:
- No version found → DENY
- Multiple active versions detected → DENY

Database does not enforce single active version.
Determinism guaranteed by runtime logic.

Failure Mode:
If company resolution fails → DENY.

==========================================================
ACL RESOLUTION
==========================================================

File:
supabase/functions/api/_pipeline/acl.ts

stepAcl.ts:
Reads snapshot row from acl.precomputed_acl_view.

Snapshot Source:
acl.precomputed_acl_view

Fallback Logic:
If snapshot row missing → DENY.

Resolver Precedence:
1. Public route? → ALLOW
2. Context must be RESOLVED → else DENY
3. Mandatory input sanity check → else DENY
4. Snapshot query executed
5. resolveAcl precedence applied:
   - Admin precedence
   - Module enablement
   - User override
   - Role permission
   - Capability permission
6. Final decision must be ALLOW
Else → DENY (fail-closed)

Implementation Note:
Authorization currently route-based.
Action treated as VIEW unless extended.

==========================================================
HANDLER EXECUTION
==========================================================

Route:
Defined in runner.ts as:
"POST:/api/..."

Handler File:
Multiple under:
supabase/functions/api/_core/**

Permission Gate:
All handlers executed only after ACL pass.

Post-Handler Mutation:
DB mutations (insert/update/delete) occur only inside handler.
No mutation detected before ACL.

==========================================================
RESPONSE CONSISTENCY
==========================================================

Output Format:
Standard JSON response.
Success / Error structured via shared response.ts.

Error Structure:
Permission failure → deterministic DENY response.
Context failure → hard stop.

Determinism Check:
Pipeline strictly ordered.
No early DB mutation.
No bypass detected.
Snapshot empty → full deny.