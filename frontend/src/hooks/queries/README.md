# Shared Query Pattern

PACE ERP frontend data fetching must use TanStack Query through this `frontend/src/hooks/queries/` layer.

## Rules

1. Any new page that fetches shared list or reference data must use an existing shared query hook from this folder when one already exists.
2. If a shared dataset does not have a hook yet, add a new hook here first instead of introducing a page-local `useState` + `useEffect` fetch.
3. Never reintroduce local `useState` + `useEffect` fetching for data that is used by more than one page or module.
4. Page-specific primary data still belongs in `useQuery` on that page (or a nearby page-specific hook) so back-navigation gets cached data immediately.
5. Prefer stable query keys by dataset plus params, and keep independent fetches parallel with separate queries or `Promise.all` inside one query function when data truly belongs to one page.

## Current shared master-data hooks

- `useOmMasterQueries.js`: vendors, materials, customers, storage locations, cost centers, UOMs, parent customers, OM companies
- `useProcurementMasterQueries.js`: procurement companies, payment terms
- `useHrMasterQueries.js`: leave types, all leave types, holidays, week-off config, out-work destinations
- `useAdminMasterQueries.js`: admin companies and admin project lists
