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
