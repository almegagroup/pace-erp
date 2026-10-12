# PACE AI Core — gated Haiku smoke test

**Status:** Draft / not deployed / no API connection verified.

## Context and operational contract

- This is an ERP-wide backend foundation, not a separate application or a Planning-specific LLM.
- The endpoint is `POST /api/ai/smoke-test`.
- It passes through the existing PACE session/context/CSRF/rate-limit pipeline.
- Only sessions with backend `context.isAdmin === true` are admitted.
- Additionally `AI_CORE_ENABLED=true` is required. Unset/default means **off**.
- Anthropic credentials come only from `ANTHROPIC_API_KEY` in backend environment.
- The payload is hardcoded; no ERP business data, user prompt, or database rows are transmitted.
- The endpoint does **not** change a production order, purchase order, stock movement, ACL, planning scenario or any ERP data.
- Model: `claude-haiku-5-5`. The response returns token counts. For actual charges use Anthropic billing.
- API failures are masked: no upstream response body or API key is returned.

## Deployment protocol

1. Review this branch and run repository guards and TypeScript checks locally/CI.
2. Keep `AI_CORE_ENABLED` unset or `false` in DEV and PROD until endpoint has passed review.
3. Merge into `dev` only after CI. On DEV, temporarily set `AI_CORE_ENABLED=true` and test with an authenticated SA/GA administrator session and valid CSRF context.
4. Confirm a non-admin logged-in user receives HTTP 403; unauthenticated requests fail the existing session pipeline.
5. Confirm a successful test shows `CONNECTED` and token usage, without spilling any secrets into logs.
6. Disable the flag again. Follow the normal DEV → PR → MAIN → PROD release process, without enabling PROD until approved.

## Not implemented by this first foundation

- A standalone ERP-wide AI conversation page (not yet built). An SA-only test button is available in the existing ERP System Health diagnostics screen.
- Provider-neutral tools, per-user cost ledger, persisted usage audit, idempotency, module quotas, rate budget
- Planning data access, natural language queries, forecasting, or operational writes

These are explicitly subsequent phases, not implicit in a successful smoke test.
