# Gate-6 — G1: Role System Core (ID-6.1, ID-6.1A)
Status: LIVE (Gate-6 execution)

## Final Role Ladder (Locked)
SA=999, GA=888, DIRECTOR=100, L4_MANAGER=95, L3_MANAGER=90, L2_AUDITOR=80, L1_AUDITOR=70,
L2_MANAGER=60, L1_MANAGER=50, L4_USER=40, L3_USER=30, L2_USER=20, L1_USER=10

## Determinism Rules
- Role normalization must be deterministic (same input → same canonical role).
- Unknown role codes MUST yield null and must default-deny at decision time.

## Location
supabase/functions/api/_shared/role_ladder.ts
