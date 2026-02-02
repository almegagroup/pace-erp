# Gate-6 — G0: ACL Authority Lock (ID-6)
Status: LIVE (Gate-6 execution)

## Declaration
All authorization decisions are backend-only and must be computed by the ACL engine.
Frontend has zero authority. Database is enforcement layer only.

## Pipeline Position (Locked)
Session → Context → ACL → Handler

## Failure Semantics
If ACL decision cannot be computed deterministically, the system MUST DENY with a deterministic reason code.
No UI hint or client input can override this.
