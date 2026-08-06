# CODEX TASK — New Guard: Route / ACL-Registry Mismatch (Bug Pattern #8)

## Objective

Build a new CI guard script, `scripts/route-acl-registry-guard.mjs`, that
statically catches a route dispatched in `supabase/functions/api/_routes/*.routes.ts`
with **no matching entry** in `supabase/functions/api/_acl/route-acl-registry.ts`
— today this is only caught at **runtime**, the moment someone actually hits
that exact path in a deployed environment (it throws `ROUTE_ACL_NOT_REGISTERED`,
a 500). Read `CLAUDE.md`'s pattern #8 ("Route / ACL registry mismatch") for
the rule this guard enforces: *"Every new or changed route must be matched
against the real route-acl-registry.ts method/path pattern. Never assume the
registry already matches the route name."*

This is a pure **build-time-prevention** guard — the goal is a developer (or
Codex) adding a new route line to a `*.routes.ts` file gets a CI failure
immediately, with the exact missing route printed, instead of a live 500 in
staging/prod days later.

---

## Read first — do this before writing any code

1. `supabase/functions/api/_acl/route-acl-registry.ts` — the registry. Two
   shapes to understand:
   - `EXACT_ROUTE_ACL: Record<string, RouteAclMeta>` — a flat object literal
     keyed by literal strings like `"GET:/api/procurement/purchase-orders"`.
   - `PATTERN_ROUTE_ACL: PatternAclEntry[]` — an array of
     `{ pattern: RegExp, methods: { [METHOD]: RouteAclMeta } }` entries, for
     param routes (e.g. `/^\/api\/procurement\/purchase-orders\/[^/]+$/`).
   - `RouteAclMeta` is either `{ skipAcl: true }` (public/utility route,
     intentionally unauthenticated-ACL-wise) or
     `{ skipAcl: false, resourceCode, action }`.
   - The runtime resolver `lookupRouteAcl(method, pathname)` (near the
     bottom of the file, exported) tries exact match first, then walks
     `PATTERN_ROUTE_ACL` testing each `.pattern.test(pathname)`. Your guard
     should mirror this same two-tier resolution logic, not reinvent a
     different one.
   - There's also `ACL_SUPPORT_ROUTES` (a small hardcoded `Set` inside
     `supabase/functions/api/_pipeline/runner.ts`, NOT in the registry file
     itself — e.g. `"GET:/api/me"`) for a handful of session/support routes
     that bypass the registry check entirely before `lookupRouteAcl` is even
     called. Read `runner.ts` around line 34-45 and 209-220 to see exactly
     how `ACL_SUPPORT_ROUTES` and `lookupRouteAcl` combine — your guard must
     treat `ACL_SUPPORT_ROUTES` entries as "intentionally exempt," not as
     missing registrations.

2. `supabase/functions/api/_routes/*.routes.ts` — nine files
   (`acl.routes.ts`, `admin.routes.ts`, `hr.routes.ts`, `menu.routes.ts`,
   `om.routes.ts`, `procurement.routes.ts`, `production.routes.ts`,
   `session.routes.ts`, `workflow.routes.ts`). Each dispatches
   `(req, ctx)` to a handler using **two mixed styles in the same file**
   (confirmed in `procurement.routes.ts`):
   - A `switch (routeKey)` block where `routeKey` is built as
     `` `${req.method}:${pathname}` `` (or similar — check each file, the
     exact variable name may differ) and cases look like
     `case "POST:/api/procurement/purchase-orders":`.
   - A sequence of `if (/^\/api\/.../.test(pathname) && req.method === "POST")`
     blocks for param routes, and occasionally a shared
     `if (/pattern/.test(pathname)) { if (req.method === "GET") {...} if (req.method === "PUT") {...} }`
     nesting style (see `procurement.routes.ts` lines ~559-569 and ~587-594
     for real examples of this nested form — method checks living INSIDE a
     shared pathname-regex `if`, not paired with `&&` on the same line).

3. **⚠️ Line-ending trap, confirmed today (2026-08-06) via `file` on every
   route file:**
   ```
   acl.routes.ts        — CRLF, LF (mixed)
   admin.routes.ts      — LF only
   hr.routes.ts         — LF only
   menu.routes.ts       — LF only (UTF-8)
   om.routes.ts         — LF only
   procurement.routes.ts — CRLF only
   production.routes.ts — CRLF, LF (mixed), UTF-8
   session.routes.ts    — LF only
   workflow.routes.ts   — CRLF, LF (mixed)
   ```
   Several files have **mixed CRLF+LF within the same file**. Do not assume
   a uniform line ending anywhere. Read each file as raw text and normalize
   (`content.replace(/\r\n/g, "\n")`) before running any line-based or
   regex-based extraction — this exact class of bug (silently truncating or
   misparsing content because of an unhandled `\r`) already cost significant
   debugging time today building a different script
   (`build-page-manifest.mjs`, not part of this repo — a one-off analysis
   tool). Don't repeat it.

---

## Step 1 — Extract every dispatched route from `_routes/*.routes.ts`

For each of the 9 files, extract every `{ method, pathTest }` pair the file
actually dispatches to a handler, where `pathTest` is either:
- a literal path string (from a `case "METHOD:/literal/path":` inside a
  `switch`), or
- a regex source string (from an `if (/regex/.test(pathname) ...)` guard —
  capture the **exact regex source**, e.g. `^\/api\/procurement\/purchase-orders\/[^/]+$`).

Handle both dispatch shapes:
- `switch (someVar) { case "METHOD:/path": return await handler(...); ... }`
  — extract every `case` string literal that matches the
  `` `${method}:${path}` `` shape (starts with an HTTP verb + `:`).
- `if (/regex/.test(pathname) && req.method === "METHOD") { return await handler(...); }`
  — one `{ pattern, method }` pair per such `if`.
- The nested form: `if (/regex/.test(pathname)) { if (req.method === "GET") {...} if (req.method === "PUT") {...} }`
  — this yields **multiple** `{ pattern, method }` pairs sharing one regex
  (one per inner `if (req.method === ...)` block). Do not miss the inner
  blocks — a naive single-level scan will only find the outer `if` and
  silently drop the method-specific ones.

You do not need a real JS/TS parser for this — line-scanning with a small
state machine (track whether you're inside a `switch`, track brace depth to
know when a nested `if (req.method === ...)` block belongs to an enclosing
`if (/regex/.test(pathname))`) is sufficient and matches how the existing
guard scripts in this repo are built (see
`scripts/hardcoded-role-check-guard.mjs` for the house style: plain regex +
`readFileSync`, no AST library). Keep it simple and readable over clever.

Skip any route inside a comment (`//` or `/* */`) — a quick heuristic (strip
`//...` to end of line, strip `/* ... */` blocks) before scanning is enough;
don't over-engineer comment-stripping.

---

## Step 2 — Extract every registered entry from `route-acl-registry.ts`

- Parse `EXACT_ROUTE_ACL`'s object literal: every
  `"METHOD:/literal/path": { ... },` line → one exact-route registration.
- Parse `PATTERN_ROUTE_ACL`'s array: every `{ pattern: /regex/, methods: { GET: {...}, POST: {...} } }`
  entry → one `{ patternSource, methods: [list of HTTP verbs present] }`
  registration.
- Also collect `ACL_SUPPORT_ROUTES` from `supabase/functions/api/_pipeline/runner.ts`
  (a `new Set([...])` of `"METHOD:/path"` strings) — these count as
  "intentionally exempt," same as a found registry entry, for the purposes
  of this guard (they never reach `lookupRouteAcl` at runtime, so a missing
  registry entry for one of these is not a bug).

---

## Step 3 — Cross-check and report

For every dispatched route found in Step 1:
1. If it's an exact literal path → check it exists as a key in
   `EXACT_ROUTE_ACL` OR in `ACL_SUPPORT_ROUTES`. If neither, **FAIL**.
2. If it's a regex-based route → check there's a `PATTERN_ROUTE_ACL` entry
   whose `pattern` source string is **identical** (after normalizing: strip
   the `^`/`$` anchors and leading/trailing slashes consistently, or just
   compare raw source strings first and only fall back to a looser
   comparison if that produces suspicious near-misses) to the dispatched
   route's regex, AND whose `methods` object has an entry for the dispatched
   HTTP method. If no matching pattern entry, or the pattern matches but the
   specific method is missing from `methods`, **FAIL**.
3. A route matching via `skipAcl: true` in the registry, or present in
   `ACL_SUPPORT_ROUTES`, is a genuine pass — do not require a
   `resourceCode`/`action` for those.

Print every failure clearly:
```
FAIL — route dispatched in supabase/functions/api/_routes/production.routes.ts
but NOT found in route-acl-registry.ts:
  POST:/api/production/some-new-endpoint
```

Also, as a **non-fatal INFO-level** section (do not fail the build on
these — this is house style, see how `stock-posting-guard.mjs`'s
`legacy_untagged_posting` check is INFO-only for the same reason: catching a
huge pre-existing backlog would make the guard useless as a ratchet), report
any `PATTERN_ROUTE_ACL`/`EXACT_ROUTE_ACL` entries that don't correspond to
**any** currently-dispatched route in `_routes/*.routes.ts` — these are
likely dead/stale registry entries (a route was removed from a `.routes.ts`
file but its registry entry was never cleaned up). List them, don't fail on
them.

---

## Step 4 — Establish a BASELINE if needed, then wire into CI

Run the script. If it finds real, currently-existing mismatches (routes
dispatched with no registry entry — this would be a live, undiscovered
500-on-first-hit bug in production if it exists), **do not silently
baseline them the way the role-check guard does** — a missing ACL
registration is a security-relevant gap, not a style nit. Instead:
- If you find any, list them clearly in your final report to the human
  reviewer (do not fix them yourself — this is a different task from
  building the detector).
- If you find zero (most likely, since `lookupRouteAcl`'s runtime
  `ROUTE_ACL_NOT_REGISTERED` throw means any such gap would already have
  surfaced as a live bug if that route were ever called), the guard should
  simply pass clean — no BASELINE mechanism is needed for this guard at all
  (unlike the role-check guard, there's no legitimate reason for a
  dispatched route to lack a registry entry, so zero-tolerance from day one
  is correct here).

Add a new step to `.github/workflows/ci-basic.yml`, matching the existing
style exactly (see the "Hardcoded role-check guard" / "Approver-chain guard"
/ "Resource-code domain guard" steps for the pattern):
```yaml
      - name: Route/ACL registry guard
        run: node scripts/route-acl-registry-guard.mjs
```
Place it alongside the other guard steps.

---

## Step 5 — Commit

Include a clear commit message and `Co-Authored-By: Codex` per this repo's
convention. Scope: only the new `scripts/route-acl-registry-guard.mjs` file
and the CI workflow addition — no application code changes.
