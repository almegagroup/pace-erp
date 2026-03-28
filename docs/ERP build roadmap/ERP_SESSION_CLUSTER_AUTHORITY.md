# ERP Session Cluster Authority

Purpose:
This document locks the session-cluster authority contract
for the protected ERP multi-window phase.

Scope:
- SC-1 authority lock
- SC-2 backend storage foundation

Boundary:
This document does not authorize UI-first experimentation.
Protected-shell rewiring,
browser coordination,
and controlled window opening
belong to later steps.

---

# 1. Current State vs Target

Current repo state:
- login creates one ERP session row
- fresh login revokes existing ACTIVE sessions
- protected shell enforces same-browser single-tab ownership
- workspace lock and warning UX are still frontend-local

Target state:
- one login creates one backend-authoritative session cluster
- one cluster may admit maximum 3 governed Home windows
- all admitted windows share one backend session authority
- fresh login anywhere replaces the old cluster fully
- warning,
  lock,
  unlock,
  logout,
  revoke,
  expiry,
  and replacement
  must synchronize across all admitted windows

Important meaning:
The repo is not yet cluster-operational.
This phase only locks the authority contract
and creates backend storage truth.

---

# 2. Locked Authority Rules

The following rules are now locked for implementation:

1. Backend is the only authority for cluster legitimacy.
2. Frontend may coordinate UX,
   but may never become authority for:
   active cluster count,
   max-window admission,
   replacement truth,
   revoke truth,
   or expiry truth.
3. One auth login creates one ACTIVE session cluster.
4. Maximum admitted cluster size is exactly 3 Home windows.
5. Fresh login for the same identity replaces the previous cluster.
6. Old cluster members must become invalid together,
   not one by one.
7. Window membership must be deliberate and governable,
   not based on arbitrary duplicated tabs.

---

# 3. Backend Storage Contract

The backend storage model must preserve three truths:

## 3.1 Cluster Parent Truth

One row represents one login-born session cluster.

Parent cluster row must capture:
- owner auth user
- ACTIVE vs replaced or revoked lifecycle
- cluster-wide expiry boundary
- replacement linkage
- root session linkage
- fixed maximum window count

## 3.2 Window Slot Truth

Each governed browser window must be an admitted cluster member.

Window slot row must capture:
- parent cluster
- admitted slot number
- membership token
- optional linked ERP session row
- admitted vs closed or revoked lifecycle
- last-seen timestamp for later coordination logic

## 3.3 Session Link Truth

The existing ERP session row remains authoritative for request access.
Session cluster does not replace ERP session validation.

Meaning:
- `erp_core.sessions` remains the request-time session authority
- cluster rows add multi-window governance truth above that session
- future protected-shell work must validate both:
  session legitimacy and cluster-slot legitimacy

---

# 4. Explicit Non-Goals For This Session

This session does not yet implement:
- cluster-aware protected shell
- browser BroadcastChannel or storage coordination
- controlled "Open New Home Window" flow
- window-close lifecycle finalization
- cluster-wide warning acknowledgement
- cluster-wide lock or unlock UX

Reason:
The realignment requires SC-1 and SC-2 first.
Frontend coordination without backend truth would violate the Constitution.

---

# 5. Immediate Next Step After This Foundation

After this authority and schema foundation,
the next implementation step must be:

- SC-3 define lifecycle and synchronization events

Only after that:
- protected-shell membership enforcement
- frontend coordination
- governed multi-window expansion

---

# 6. Working Interpretation

Until later steps are wired,
current single-session and single-tab runtime behavior
remains the live execution behavior.

The new cluster foundation added in this phase
is preparatory backend truth,
not yet the final operator-facing behavior.
