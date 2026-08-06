# CODEX TASK — JSDoc + `checkJs` Pilot for Payload-Shape Checking (Bug Pattern #13)

## Objective

PACE ERP's frontend is plain JS/JSX with **no TypeScript and no shared
schema** between frontend and backend. A real, live bug class (`CLAUDE.md`
pattern #13, "Frontend payload missing a backend-required field") comes from
this: a frontend call to a backend endpoint can have **fully correct ACL**
and still fail, because the request body is silently missing a field the
handler treats as mandatory — there is zero compile-time or lint-time
signal today, only a runtime error once a user clicks it. The real example:
Plan Feed's inline "+New Party" modal called `createCustomer()` without
`company_id` or `billing_state`, both hard-required by
`createCustomerHandler` — P0062 had fully correct ACL and the create still
failed.

A full TypeScript migration was explicitly evaluated and **rejected** as too
risky for this live, actively-developed production ERP. The chosen
lower-risk alternative: add **JSDoc type annotations** to the relevant API
wrapper functions and their backend handler counterparts, then turn on
`checkJs` (TypeScript's "check plain JS files using JSDoc types, no
compilation, no `.ts` conversion") scoped to a **pilot pair** of files. This
gives real-time, in-editor type-mismatch signals during development, without
converting a single file to `.ts` and without changing any runtime
behavior. This is explicitly meant to run **alongside**, not replace, the
CI guard being built separately (`scripts/frontend-payload-guard.mjs` /
pattern #13's other half, Task #35 — a different engineer's task, out of
scope here).

**Scope for this pilot: exactly two frontend functions** —
`createCustomer` and `updateCustomer` in
`frontend/src/pages/dashboard/om/omApi.js` — matched against their real
backend counterparts, `createCustomerHandler` and `updateCustomerHandler` in
`supabase/functions/api/_core/om/customer.handlers.ts`. Do not expand scope
to other API functions in this task — this is a pilot to validate the
approach before it's rolled out wider.

---

## Read first

- `frontend/src/pages/dashboard/om/omApi.js` lines ~486-536 —
  `createCustomer(payload)` and `updateCustomer(payload)`. Both currently
  take an untyped `payload` object and JSON-stringify it straight into the
  request body — no shape checking of any kind.
- `supabase/functions/api/_core/om/customer.handlers.ts` lines ~159-214 —
  `createCustomerHandler`. Read the actual validation logic, not just field
  names, to get the JSDoc types exactly right:
  - `(customer_name OR vendor_id)` — at least one of the two is required
    (not both mandatory).
  - `delivery_address` — required, non-empty string.
  - `customer_type` — required, must be one of `ALLOWED_CUSTOMER_TYPES`
    (grep the const definition near the top of the file for the exact
    literal set — likely `"DOMESTIC" | "EXPORT"` or similar, use the real
    values, don't guess).
  - `billing_state` — required, non-empty string (mandatory for both
    DOMESTIC and EXPORT per the §113 GST design note in the code comment
    right above the check — DOMESTIC additionally validates against a fixed
    Indian-states set, EXPORT accepts free text).
  - `company_id` — required, non-empty string (UUID).
  - `gst_category` — optional, but if present must be one of
    `ALLOWED_GST_CATEGORIES` (grep for the exact set).
  - `fo_customer_type` — optional, but if present must be one of
    `ALLOWED_FO_CUSTOMER_TYPES` (grep for the exact set).
  - `vendor_id` — optional, but if present must reference a real vendor
    (runtime-checked, not type-checkable — JSDoc can only mark it as an
    optional string).
  - `parent_customer_id` — optional string.
  - `delivery_pincode`/other optional fields — check the file for any
    other fields read from `body` in this handler and include them as
    optional in the JSDoc type; do not invent fields that aren't actually
    read.
- Find `updateCustomerHandler` (same file, search for
  `export async function updateCustomerHandler`) and repeat the same
  read-the-real-validation-logic exercise for it — its required/optional
  field set will differ from create (e.g. likely requires `customer_id`,
  and most other fields become optional/partial-update).

---

## Step 1 — Write a shared JSDoc `@typedef` for the Customer payload shape

In `frontend/src/pages/dashboard/om/omApi.js`, above `createCustomer`, add:

```js
/**
 * @typedef {Object} CreateCustomerPayload
 * @property {string} [customer_name] - Required unless vendor_id is set.
 * @property {string} [vendor_id] - Required unless customer_name is set.
 * @property {string} delivery_address
 * @property {"DOMESTIC"|"EXPORT"} customer_type
 * @property {string} billing_state - Required for both DOMESTIC and EXPORT.
 * @property {string} company_id - Required — see §113.6, unscoped customer
 *   rows are a real bug otherwise.
 * @property {string} [gst_category]
 * @property {string} [fo_customer_type]
 * @property {string} [parent_customer_id]
 * ...(add any other real fields found in Step 0's read of the handler)...
 */
```

Use the **real literal union values** you found in
`ALLOWED_CUSTOMER_TYPES`/`ALLOWED_GST_CATEGORIES`/`ALLOWED_FO_CUSTOMER_TYPES`
— do not leave them as generic `string` if the handler enforces a fixed set,
that's exactly the kind of mismatch this pilot exists to catch (e.g. a
frontend call passing `customer_type: "Domestic"` lowercase-mismatched
against a handler that only accepts uppercase would not be caught by a
plain `string` type, but IS caught by a literal union type).

Then annotate the function itself:
```js
/**
 * @param {CreateCustomerPayload} payload
 */
export async function createCustomer(payload) {
  ...
}
```

Repeat the same pattern for `UpdateCustomerPayload` / `updateCustomer` —
base its required/optional shape on what `updateCustomerHandler` actually
validates (likely `customer_id` required, most business fields optional
since it's a partial update — verify against the real code, don't assume).

---

## Step 2 — Enable `checkJs`, scoped narrowly

Create `frontend/jsconfig.json` (confirmed: does not exist yet in this
repo) with:
```json
{
  "compilerOptions": {
    "checkJs": true,
    "allowJs": true,
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "noEmit": true
  },
  "include": [
    "src/pages/dashboard/om/omApi.js"
  ]
}
```

**Deliberately scope `include` to just this one pilot file for now** — do
NOT set `include` to `["src/**/*"]`. Turning on `checkJs` repo-wide in one
shot would surface an unknown, possibly large number of pre-existing
type-mismatch warnings across a live production codebase with zero
preparation — that's out of scope and risky. This pilot is intentionally
narrow: prove the mechanism works cleanly on one real file pair, leave
wider rollout as an explicit follow-up decision for a human to make later
(do not expand `include` yourself even if the pilot looks clean).

This `jsconfig.json` does **not** run in CI and does **not** block builds —
`vite build`/`eslint` are untouched by this file. Its only effect is
**editor-time** — VS Code (and any TS-language-server-aware editor) will
show red squiggles on real type mismatches in the scoped file as you type,
which is the entire point (dev-time, not CI-time, per the explicit design
choice this pilot follows).

---

## Step 3 — Verify it actually catches something real

Prove the mechanism works before calling this done. Temporarily introduce a
deliberate mismatch (e.g. change a call site to omit `company_id`, or
mistype `customer_type: "domestic"` lowercase) and run:
```
npx tsc --noEmit -p frontend/jsconfig.json
```
Confirm it reports a real error pointing at the mismatch. Then revert the
deliberate mismatch. Paste the before/after `tsc` output in your final
report so the human reviewer can see the mechanism actually fired, not just
that the config file exists.

Also run it clean (no deliberate mismatch) and confirm zero errors against
the current real call sites of `createCustomer`/`updateCustomer` — grep for
every call site (`grep -rn "createCustomer(\|updateCustomer(" frontend/src`)
and manually eyeball that each one's payload shape matches your `@typedef`
before treating a clean `tsc` run as meaningful (a clean run with an
overly-loose typedef proves nothing).

---

## Step 4 — Commit

Include `Co-Authored-By: Codex` per this repo's convention. Scope: only
`frontend/jsconfig.json` (new file) and JSDoc additions to
`frontend/src/pages/dashboard/om/omApi.js` (comments only — do not change
any runtime logic in that file). No backend changes, no CI workflow changes
(this is explicitly not a CI gate, see Step 2).

In your final report, explicitly note this is a **pilot** — call out that
wider rollout (more files, `include: ["src/**/*"]`) is a follow-up decision
for a human, not something to expand automatically in this task.
