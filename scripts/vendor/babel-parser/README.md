# Vendored @babel/parser

`index.js` in this directory is the bundled, dependency-free
`@babel/parser` v7.29.0 (`lib/index.js` from the npm package), MIT
licensed (https://github.com/babel/babel/blob/main/LICENSE). It parses
JS/JSX into an AST with zero further `require()` calls of its own —
confirmed via `grep -c "require(" index.js` = 0 before vendoring.

**Why vendored instead of imported from `frontend/node_modules`:**
`scripts/dependency-provisioning-check.mjs` needs a real AST (not a
regex scan) to correctly parse the screen-registry files and
`AppRouter.jsx`'s nested `<Routes>/<Route>` tree — a regex rewrite,
unlike this repo's other guard scripts, risks silently mis-parsing
route nesting. But every guard script in `ci-basic.yml` must run
without any `npm install` step (CI never installs `frontend`'s
`node_modules` — see CLAUDE.md's note on `jsx-no-undef-guard.mjs` for
the same constraint). Vendoring this one self-contained file satisfies
both: real AST parsing, zero install step, matching every other guard's
"just runs" requirement.

**Real incident, 2026-08-21:** the script originally required
`@babel/parser` straight from `frontend/node_modules/@babel/parser/lib/
index.js` — this worked when run locally (node_modules already
installed) but failed CI on the very first PR that carried the newly-
promoted mandatory guard (`MODULE_NOT_FOUND`, since CI never runs
`npm install`). Caught only because the PR's CI check failed — should
have been caught by testing this guard in a clean-node_modules
environment before wiring it into `ci-basic.yml` as mandatory.

**To update:** copy a newer `@babel/parser`'s `lib/index.js` over this
file when a real need arises (e.g. a newer JSX syntax feature). Not
expected to need frequent updates — this only parses plain JS objects
and standard JSX, both stable targets.
