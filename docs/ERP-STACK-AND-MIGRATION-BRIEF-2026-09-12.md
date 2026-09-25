# PACE ERP: architecture and migration evaluation brief

Prepared 12 September 2026 from the local repository. Intended to be shared with ChatGPT or a technical consultant. No credentials or customer data included.

## Evidence and scope

- Owner-confirmed hosting: Supabase database; Render backend; Cloudflare development frontend; Vercel production frontend.
- Code and configuration below were inspected locally. Provider dashboards, invoices, live database catalogs, deployed commits, load metrics and infrastructure settings were not inspected. Repository configuration is not proof of the exact deployed state.
- This is an architecture inventory and decision framework, not a provider pricing comparison or a recommendation to migrate.
- Repository scale: 550 SQL migration files, 251 backend TypeScript files under the API directory and 368 frontend source-directory files. Migration history contains 121 distinct function names introduced with CREATE FUNCTION / CREATE OR REPLACE FUNCTION. These are historical names, not a count of current live functions. Static scanning found 42 distinct literal RPC names in backend code; dynamically selected RPCs may not be included.

## Current architecture

```text
Browser
  -> React/Vite static frontend (Cloudflare dev / Vercel prod)
  -> HTTP API on Render (Node.js + Fastify + tsx)
  -> shared TypeScript request pipeline and business handlers
  -> Supabase JavaScript client / PostgREST Data API
  -> PostgreSQL schemas, tables, views, functions, triggers and policies

Authentication:
  Browser -> Supabase Auth for signup, verification and password recovery
  Backend -> Supabase Auth for password verification
  Backend -> ERP database sessions + HttpOnly erp_session cookie

Other dependencies:
  Cloudflare Turnstile -> human verification
  Applyflow -> GST profile lookup
  PostgreSQL pg_cron -> scheduled database work
  GitHub Actions -> code guards and production DB migration workflow
```

The API lives under `supabase/functions/api`, but `src/server.ts` imports that handler into Fastify. The start command is `tsx src/server.ts`. Do not infer that this API currently runs as Supabase Edge Functions merely from its directory. Node/Deno-compatible environment helpers and a Deno import map exist; another runtime would still need a tested serving adapter.

## Languages, frameworks and build

Versions below are declared package.json ranges, not independently verified deployed versions.

| Layer | Technology |
|---|---|
| Frontend | JavaScript/JSX, React ^19.2.0, React DOM ^19.2.0 |
| Routing/build | React Router DOM ^7.13.0, Vite ^7.2.4, React Vite plugin |
| Styling | CSS, Tailwind CSS ^4.2.1, PostCSS, Autoprefixer |
| Client data/UI | TanStack React Query ^5.101.1, React Virtual ^3.14.9 |
| Export/utility libraries | ExcelJS ^4.4.0, QRCode ^1.5.4 |
| Frontend Supabase SDK | @supabase/supabase-js ^2.99.1 |
| Backend | TypeScript, Node.js, Fastify ^5.8.2, tsx ^4.21.0 |
| Backend Supabase SDK | @supabase/supabase-js ^2.99.0 |
| Database code | PostgreSQL SQL and PL/pgSQL |
| Development tooling | npm lockfiles, ESLint, dependency-cruiser, Node scripts, PowerShell scripts |

Frontend builds with `npm run build` inside `frontend`, producing `frontend/dist`. It is a client-rendered SPA; no Next.js/SSR dependency was found in the inspected application entry/build configuration. Vercel rewrites routes to index.html. Cloudflare-style `_redirects` and `_headers` files also exist. These SPA fallback and cache rules must survive any frontend move.

PWA tooling is installed, but VitePWA has `disable: true` in the inspected configuration. Do not assume working offline ERP support. The Vite development proxy contains a Render development URL; deployment-neutral configuration is not completely free of provider-specific references.

## ERP functionality represented in code

- Administration and governance: users, signup approvals, companies, groups, projects, departments, work contexts, roles, capabilities, versioned ACL, menu snapshots, sessions and audit records.
- HR: leave and leave types, out-work, calendars, attendance reports, attendance correction and approvals. Do not assume all planned HR/payroll/geofencing features are implemented.
- Master data: materials, UOM, vendors, vendor/material information, customers, addresses, machines, cost centers and locations.
- Procurement: purchase orders, CSN, gate entry, GRN, inward QA, return to vendor, invoice verification, landed costs and procurement planning.
- Inventory and sales: opening stock, stock ledger/status, physical inventory, transfers/STO, reservations, sales orders, delivery orders/challans, dispatch, invoice grouping and document flow.
- Production: process orders, packing orders, BOM/configuration, batch numbering, SFG QA, consumption, reversals, costing, monthly rates and variance reports.
- Cross-cutting: approval routing, multi-company access checks, document number generation, transactional posting, reporting and exports.

This lists code areas, not a certification that every screen or business workflow is production-complete.

## Database coupling: the most consequential migration area

Migration history defines these application schemas: `acl`, `erp_acl`, `erp_audit`, `erp_cache`, `erp_core`, `erp_hr`, `erp_inventory`, `erp_map`, `erp_master`, `erp_menu`, `erp_meta`, `erp_procurement`, `erp_production`. Live catalog verification is required to confirm the current schema inventory.

The backend uses Supabase query builders (`schema`, `from`, filters, embedded relationships) and RPC, rather than a demonstrated Prisma/Drizzle/direct SQL data layer. Moving to a plain PostgreSQL provider alone would not preserve this API. Options to evaluate include retaining an equivalent PostgREST/Auth layer or rewriting the data-access and authentication integration.

Important RPC examples:

- Posting/correctness: `post_document`, `post_stock_movement`, `post_sales_invoice_groups_atomic`, `reverse_sales_invoice_groups_atomic`.
- Transfers and sales: `create_sto_atomic`, `transition_sto_atomic`, `cancel_sto_atomic`, `save_delivery_order_unified_atomic`, `release_so_map_group_atomic`.
- Production/costing: `reserve_process_order_materials`, `recompute_fg_cost`, `recompute_sfg_cost`, `recalculate_valuation_at_row`, `close_ac06_month`.
- Workflow/governance: `approve_signup_atomic`, `reject_signup_atomic`, `process_workflow_decision_atomic`, `generate_acl_snapshot`, `rebuild_acl_menu_snapshot`.
- Number series: `generate_company_doc_number`, `generate_material_doc_number`, `generate_batch_series_number` and other code generators.

Migration must preserve transaction boundaries, row locking, numeric precision, unique constraints, foreign keys, number-series concurrency and reversal behavior. A successful row export/import is insufficient.

Supabase-specific dependencies include Auth users and foreign keys to `auth.users`, `auth.uid()` references, backend service-role credentials, PostgREST request-header context, exposed schemas and grants. The code injects company/work-context headers; existing migrations use `current_setting('request.headers', true)`. A direct SQL replacement must deliberately preserve equivalent context and authorization behavior.

RLS and application ACL both appear in the system. Service-role clients are privileged: do not assume that header injection alone makes RLS enforce tenant isolation. Migration validation must test the actual database role plus application access checks and company scoping.

Explicit extension creation found: `pg_trgm` and `pg_cron`. Other installed extensions, PostgreSQL version, database size, index sizes and live function/trigger/policy counts remain unknown.

## Auth, domains and integrations

- Supabase Auth handles credentials; ERP session state is stored separately in the database. Frontend code directly uses Supabase Auth for signup, callbacks, verification and password reset. Replacing Auth affects both frontend and backend, user IDs, reset links, email configuration and existing sessions.
- Requests use credentialed cookies and a backend CORS allowlist. Cookie code contains a fixed parent domain `almegagroup.in` with non-local Secure/SameSite attributes. The Node adapter constructs localhost request URLs, so effective cookie behavior must be verified through the real proxy/domain path before migration.
- Preserve frontend API base URL, allowed origins, HTTPS, DNS, callback URLs, cookie behavior and window/session-cluster coordination.
- Cloudflare Turnstile is used for human verification; it is an integration separate from frontend hosting.
- Applyflow is called by the backend for GST profile lookup, with GST cache-related database code. Vendor quota, pricing and outage behavior should enter the cost/reliability model.
- No active Supabase Storage upload or Realtime subscription usage was found in the inspected application searches. No dedicated Redis/message-queue service was identified. Treat these as unconfirmed absence: verify dashboards and external services before excluding them.

Configuration names to inventory securely include `PORT`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGINS`, `TURNSTILE_SECRET_KEY`, `APPLYFLOW_BASE_URL`, `APPLYFLOW_API_KEY`, `PIPELINE_CONTEXT_CACHE_TTL_MS`, `MENU_SNAPSHOT_CACHE_TTL_SECONDS`, `VITE_API_BASE`, `VITE_APP_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`. This is a starting list, not a complete secret-manager export. Never put backend secret values into frontend VITE variables or a shared prompt.

## Scheduling, scaling and operations

- A migration schedules procurement-plan auto-close using pg_cron, documented as daily at 00:05 IST. Other migration text references AC06 automatic closing via pg_cron; verify the live `cron.job` catalog and run history to establish every active job. Preserve timezone, retries, idempotency and single execution when switching.
- Login rate limiting uses process-local Maps. Context caching also uses a process-local Map with TTL. Multiple instances would have independent buckets/caches; distributed rate limiting and cache freshness need a deliberate design.
- Database-backed sessions help portability, but each session/ACL/context operation and browser polling can generate database traffic. Measure query count per request and session-touch load rather than estimating from user count alone.
- Logs include request IDs and pipeline timing; the API emits Server-Timing. External monitoring, retention, alerting and tracing configuration were not verified.
- GitHub Actions runs static/business-rule guards on dev pushes and main PRs. A main-push workflow links Supabase and pushes migrations, pinning Supabase CLI 2.75.0. Provider deployment hooks and branch/environment mappings require dashboard verification.
- Root `npm test` is a placeholder that fails. CI has targeted guards, but a comprehensive migration rehearsal/load-test suite is not established by the inspected workflows.

## Relative switching effort: architecture-based assessment

| Change | Likely relative effort | Main conditions |
|---|---|---|
| Frontend static host | Lower | SPA rewrites, build-time env, cache headers, domain/auth callbacks |
| Render to another compatible Node host | Lower to medium | Node version, start command, health check, proxies/cookies, secrets, resource limits |
| Backend to edge/serverless runtime | Medium to higher | Serving adapter, runtime compatibility, request/time limits, cold starts, process-local state |
| Supabase to another Supabase-compatible setup | Medium to higher | DB/Auth migration, settings, extensions, cron, backups and operational ownership |
| Supabase to plain managed PostgreSQL | Higher | Retain/replace PostgREST and Auth; preserve grants, context, RPC and identities |
| PostgreSQL to a different database engine | Very high | Rewrite SQL/functions, transaction and locking behavior, queries and migrations |

These are relative engineering judgments, not estimates in days or proof of savings. Lower hosting price can be outweighed by engineering and ongoing operations.

## Information needed before selecting alternatives

1. Current monthly bill per service, plan, paid add-ons and separate dev/prod costs; include bandwidth/egress, database compute/storage, backups, email, GST lookup and monitoring.
2. Current users, peak simultaneous users, active companies, working hours, requests/day, peak requests/second and 12/24-month growth targets.
3. Database size, growth/month, largest tables/indexes, connection usage, slow queries, report sizes and read/write mix.
4. Backend region and DB region, CPU/RAM utilization, p50/p95/p99 latency and error rate, cold-start behavior and load-test results.
5. Business limits: acceptable downtime, acceptable data loss (RPO), restore-time target (RTO), backup retention, point-in-time recovery and data-location requirements.
6. Actual Auth user count/providers, email provider, Storage buckets, Realtime usage, scheduled jobs, external integrations and production settings.
7. Team capacity for patching, backups, restore drills, incidents and on-call work; engineering budget for migration and recurring maintenance.
8. Production schema dump/catalog, Auth export feasibility, data reconciliation rules, deploy settings and tested rollback mechanism. Do not assume historical migration files reconstruct every live setting or manual change.

Compare total monthly cost plus migration engineering cost and operational labor. First establish whether the bottleneck is frontend delivery, backend compute, API/database round trips, query design or database capacity. Hosting changes do not automatically fix query or correctness problems.

## Copy-paste request for ChatGPT

I want to evaluate whether PACE ERP can move to a better, cheaper and more scalable infrastructure. Use the architecture inventory above as the baseline. Distinguish repository evidence, owner-confirmed hosting and facts that still require live verification.

Compare keeping the current stack and optimizing it, switching only the frontend, switching only the Node backend, retaining Supabase with a different deployment arrangement, and replacing Supabase with managed PostgreSQL plus the necessary Auth/API components. Include self-hosting only with realistic operational labor, backup and incident costs.

Before recommending a provider, request missing cost/workload metrics. Verify current official pricing and limits and date the comparison. Compare low/current, expected and peak-growth workloads with explicit assumptions. Include region latency, egress, availability, Auth, PostgREST, RPC/PLpgSQL, pg_cron, pg_trgm, company isolation, transactions, observability, dev/prod separation, engineering effort and rollback.

Return a decision matrix, estimated recurring total cost and one-time migration cost, compatibility gaps, changes required, staged migration/rehearsal plan, correctness tests and a clear stay-versus-switch recommendation with confidence level. Preserve users, company permissions, stock and costing balances, audit history and document numbering. Do not recommend a database purely because its advertised monthly price is lower.

## Repository evidence pointers

- `package.json`, `frontend/package.json`, associated lockfiles
- `src/server.ts`, `supabase/functions/api/index.ts`
- `frontend/vite.config.js`, `frontend/vercel.json`, `frontend/public/_headers`, `frontend/public/_redirects`
- `frontend/src/lib/supabaseClient.js`, `frontend/src/pages/public/`
- `supabase/functions/api/_core/auth/authDelegate.ts`, `_core/session/session.cookie.ts`
- `supabase/functions/api/_pipeline/runner.ts`, `context.ts`, `rate_limit.ts`, `cors.ts`
- `supabase/functions/api/_shared/serviceRoleClient.ts`, `env.ts`, `applyflow_client.ts`
- `supabase/functions/api/_security/human_verification.ts`
- `supabase/functions/api/_routes/`, `_core/`, `supabase/migrations/`
- `.github/workflows/ci-basic.yml`, `.github/workflows/deploy-prod.yml`
