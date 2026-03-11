- Frontend must not include any backend SDK (e.g., @supabase/supabase-js).
- Any attempt to add backend SDKs to frontend is a SSOT violation.
- Frontend must not hardcode API URLs or domains.
- All frontend network targets must come from VITE_API_BASE.
## Frontend Environment Contract

- Frontend uses environment variables only.
- Allowed keys:
  - VITE_API_BASE
- Same keys must exist in Local, Preview, and Production.
- Values may differ per environment.
- No hardcoded domains or URLs in frontend code.
- Frontend must remain deploy-neutral:
  - No browser-only hacks (location, cookie authority).
  - No localhost or environment-specific branching in code.
  - Same bundle must work for Web, Electron, and PWA.
- Frontend is domain-bound but not domain-authoritative.
- Frontend must not set or read auth cookies.
- Cookie Domain, SameSite, Secure decisions are backend-only.
- Frontend must not infer auth state from window.location or cookies.
## Supabase Region Lock
- Project region is fixed to South Asia (Mumbai).
- Region will not be changed under any circumstance.
## Single Backend Entry
- All backend APIs must pass through a single Edge Function entry named `api`.
- No other Edge Functions may expose business APIs.
- Internal routing will be handled inside the `api` function.
