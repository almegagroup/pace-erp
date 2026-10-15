# Q-B13 — AI Budget Control

Status: BUSINESS CONFIRMED by owner on 2026-10-13; implementation not started.

- Planning AI monthly hard cap: **USD 5**.
- Model: Claude Haiku 5.5 (existing configured provider; verify before implementation).
- Scope: Planning AI usage, with a shared enforcement scope to be determined in technical contract so the cap cannot be evaded across users.
- Hard enforcement server-side with concurrency-safe pre-call budget reservation and post-call actual usage reconciliation. No new AI call if it could breach available budget. Provider-level spend limits where possible for defense in depth.
- Store tokens, cost estimate/actual, user, module, timestamp, month and failures; enforce ACL on any budget setting changes.
- When cap reached, AI calls are disabled, but deterministic planning, stock/ETA/coverage calculations and UI continue normally.
- AI recommendations are advisory only; no autonomous mutation of PO, CSN, stock or coverage policy.
- Owner authorised the amount of USD 5; exact privilege for changing limit, timezone for reset, alert thresholds, and provider pricing verification require technical contract/owner confirmation where applicable.

Coordination: review alongside Claude Step 1B (PR #654) and merge into master Decision Register after reconciliation. No PROD change.