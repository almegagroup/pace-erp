# Feature Plan — "Show but Disable" menu items (sidebar + command palette)

> Goal (business owner, 2026-07-27): every page stays visible in its menu
> group for everyone, but a user without VIEW permission sees it **greyed
> out / inactive** — mouse click does nothing, keyboard Enter does nothing,
> and typing its tx_code in the Command Palette lists it but won't open it.
> Build in Dev first, verify together, then port to Prod (same drill as
> today's ACL work — SQL is data/logic, applied via MCP in both places).

**Status: research complete, plan drafted, NOT yet implemented anywhere.**

---

## 1. What already exists (verified by reading the live code, 2026-07-27)

| Piece | File | Status |
|---|---|---|
| Backend blocks unauthorized actions on **every** API call, independent of what the sidebar shows | `supabase/functions/api/_pipeline/acl.ts` (`stepAcl`) | ✅ Already live. Checks `acl.precomputed_acl_view` per request; **fails DENY by default** if no explicit ALLOW row exists (`ACL_DEFAULT_DENY_NO_MATCH`). This is what already stops a "command bar" / direct-API bypass — nothing new needed here. |
| Command Palette already supports a `disabled` command state that blocks **both click and Enter** | `frontend/src/components/ErpCommandPalette.jsx` (`executeCommand`, line ~136) | ✅ Already live and already wired to Enter at two levels (search box Enter, per-item Enter). No palette-internal change needed. |
| Command Palette **already lists every page you currently have access to**, searchable by title/route/**tx_code** | `frontend/src/layout/MenuShell.jsx` (`menuCommands`, line ~1420) | ✅ Already live — typing "MM01" already works today, for pages you already have. Just needs one new field (see §3). |
| `erp_menu.menu_snapshot` table already has an `is_visible` boolean column | DB schema | ⚠️ Exists but **unused** — every write hardcodes `TRUE`. This is the exact hook we need. |

**Conclusion: the palette/UI plumbing for "disabled but visible" already exists and works today (proven, in production, for shell commands). The only real gap is that the menu-building SQL currently never emits a denied page at all — it's binary hide/show, not hide-vs-grey.**

---

## 2. What has to change (the real work)

### 2a. SQL — `erp_menu.generate_menu_snapshot()` (the core change)

Today (ACL branch): builds `allowed_acl_menus` by filtering `acl.precomputed_acl_view WHERE decision='ALLOW' AND action_code='VIEW'`, then walks up the parent chain (`ancestor_chain`) so only groups that lead to an allowed page get inserted. **Denied pages are never inserted at all.**

Needed: insert **every active ACL-universe page**, with `is_visible` computed per row instead of hardcoded `TRUE`:
- PAGE row → `is_visible = TRUE` if `precomputed_acl_view` has an ALLOW+VIEW row for that `resource_code`, else `FALSE`.
- GROUP row → `is_visible = TRUE` if **any** descendant PAGE is visible, else `FALSE` (so a group with zero accessible pages still disappears entirely — keeps the sidebar from filling up with dead section headers; only *individual pages inside an otherwise-relevant group* show greyed out).

This is a single function rewrite (`erp_menu.generate_menu_snapshot`), same function already being called via the `public.rebuild_acl_menu_snapshot` wrapper everywhere.

### 2b. SQL/Backend — hard-deny signal needs to move

Today, `meMenuHandler` treats **zero snapshot rows** as the "this account has no working ACL context" hard-stop (`SNAPSHOT_ABSENT`). Once we always emit the full page list, row-count will never be zero even for a badly-misconfigured user — that signal would silently break.

**Fix:** compute the hard-deny check from `precomputed_acl_view` directly (does this user have **any** ALLOW row at all for this company+work-context?), not from snapshot row count. Small, precise change, but must not be skipped — otherwise a broken account starts looking like "a very restricted but working" account instead of "not set up," which would hide real onboarding bugs.

### 2c. Backend caching — `rebuildAclSessionMenuSnapshot()` column list

`supabase/functions/api/_shared/acl_runtime.ts` (~line 210) selects an explicit column list from `menu_snapshot` when building the cached `menu_json` — **`is_visible` is missing from that list today**. One-line addition, otherwise the flag gets computed correctly in SQL but silently dropped before it ever reaches the frontend.

### 2d. Frontend — sidebar drawer rendering

`frontend/src/layout/MenuShell.jsx`, the numbered drawer list (~line 1680-1720):
- Add a greyed-out visual style when `node.item.is_visible === false`.
- Make `handleDrawerSelection` a no-op for those items (don't call `handleMenuRoute`).
- Decide keyboard behaviour (see open question below).

### 2e. Frontend — Command Palette entries

`frontend/src/layout/MenuShell.jsx`, `menuCommands` builder (~line 1420-1430): add one field —
`disabled: item.is_visible === false`. That's the entire change here; the palette already does the rest (grey styling, blocked click, blocked Enter — all proven working today for shell commands).

### 2f. Rollout

1. Build entirely in **Dev**, apply the SQL + backend + frontend changes there.
2. Verify live with a real low-privilege Dev test user: sidebar shows the page greyed out, mouse click does nothing, keyboard Enter does nothing, Command Palette lists it by tx_code but won't open it, and a direct API hit still gets a clean 403 (unchanged, already proven).
3. Business owner reviews it live in Dev.
4. Only then port to **Prod**: same SQL function replacement + regenerate every prod user's menu snapshot (same mechanism used today) + frontend deploy.

---

## 3. Decisions — LOCKED (business owner, 2026-07-27)

1. **Keyboard focus SKIPS disabled items entirely — pages AND fully-grey groups both.** Up/Down arrow navigation never lands on a disabled page, and never lands on a group that is itself fully grey (zero accessible descendants) — both removed from the keyboard cycle, not just inert-on-Enter. (Stricter than the Command Palette's existing "focusable but inert" pattern — the palette itself is unaffected, this only applies to the sidebar drawer.)
2. **Visual marker = a red dot next to the tx_code**, plus the whole row rendered grey. Not a text tooltip/hint — a small red dot positioned right where the tx_code is shown.
3. **Fully-inaccessible groups are NOT hidden — they render grey too**, exactly like an individual page. This is actually simpler to implement than the original "hide the group" idea: since the SQL now inserts *every* active menu row unconditionally (§2a), a group with zero accessible children just naturally gets `is_visible = FALSE` like any other row — no special-casing needed, same rendering rule applies uniformly to groups and pages.

**One implementation-level detail I'll default on (not re-asking, will confirm during Dev review instead):** a disabled *group* — can it still be mouse-clicked to expand/peek at its (all-grey) children, or is it fully inert (no expand at all)? Defaulting to "fully inert, no expand" for consistency with "focus skips it entirely" — will show this in the Dev demo for confirmation rather than blocking the plan on it now.

---

## 4. Explicitly NOT part of this feature

- This does **not** change who can do what — that's still the ACL access-matrix work (Group 1 Operation Masters etc.) already in progress in `PROD-ACL-Access-Decisions.md`. This feature only changes **how a "no access" page is communicated** in the UI (hidden vs greyed-out); the underlying View/Create/Edit/Approve decisions are the same work either way and are not blocked on this.
- Does not touch backend authorization at all — that layer (`_pipeline/acl.ts`) is already correct and untouched by this plan.
