# Geofenced Mobile Punch-In/Out — Design Discovery

**Classification:** Design Discovery (discussion notes, not yet formally locked into
`CLAUDE.md` or a numbered feasibility-doc section)
**Status:** 🔶 DESIGN IN PROGRESS — several decisions locked, some still open.
**Implementation:** ❌ Explicitly deferred — business owner decision 2026-09-10
("implementation pore" — design first, build later).
**Created:** 2026-09-10
**Relates to:** `HR_ATTENDANCE_FULL_DESIGN.md` / `HR_ATTENDANCE_IMPLEMENTATION_PLAN.md`
(same folder) — this is a new capability layered on top of the existing Leave/Out-Work/
Attendance module, not a replacement.
**Sequencing note:** This work is **outside** the currently locked CLAUDE.md §6 module
sequence (Dispatch → Costing/AP-Reco → Accounts → WAR). It is a separate, parallel HR-side
initiative. Business owner has not yet decided whether this jumps the queue or waits — see
"Open Items" below.

---

## 1. Origin / Why

Business owner asked whether PACE can support geofencing. The concrete goal that emerged:
build a **small standalone mobile app** for PACE that reuses the existing PACE login
(same authentication as the web ERP), and lets employees punch in/out only from within a
configured radius of their assigned work location — with graceful, approval-based handling
when they can't.

This is an HR/Attendance capability, not a new module — it plugs into the existing
Leave / Out-Work / Attendance request infrastructure already documented in
`HR_ATTENDANCE_FULL_DESIGN.md`.

---

## 2. Locked Decisions

| # | Topic | Decision | Locked on |
|---|---|---|---|
| 1 | Authentication | Mobile app is just another client against the existing PACE auth (same Supabase Auth/JWT). No parallel auth system. | 2026-09-10 |
| 2 | Geofence granularity | Per work-location lat/long + radius (**50 meters**). Resolved automatically from the user's assigned Work Company/Work Context — same canonical-company auto-resolution rule as the rest of PACE (CLAUDE.md §3 "Canonical company rule": single-company = auto, multi-company = picker). | 2026-09-10 |
| 3 | Punch-in outside radius | **Not a hard block.** Punch attempt is recorded as PENDING and auto-generates an approval request into the existing Leave/Out-Work approval infrastructure. Manager/HR approves or rejects; effective punch-in time is the original attempt time once approved. | 2026-09-10 |
| 4 | Punch-out outside radius — mechanism choice | **Approval-only (chosen over continuous background tracking).** No all-day background GPS polling to reconstruct "last known inside-radius time." Punch-out outside radius behaves exactly like punch-in outside radius: goes to the same approval queue, manager manually sets the effective punch-out time using other evidence. | 2026-09-10 |
| 5 | Offline capture | Punch (lat/long + device timestamp) is captured **locally on the device** at the moment of the punch, with no network dependency (GPS itself doesn't need internet/data — only satellite signal). Radius check is computed **on-device** against a geofence config cached locally at last sync/login. Punch is queued locally and synced to the server when connectivity returns. | 2026-09-10 |
| 6 | Offline trust / anti-fraud | Device clock can be manipulated while offline (classic offline-punch fraud vector) — cannot be fully prevented, only made auditable. Server stores **both** `device_reported_time` and `server_received_time` per synced punch. If the gap between them exceeds a threshold, punch is **not hard-rejected** — it's flagged into the manager/HR review queue (same shape as the geofence-violation approval queue). | 2026-09-10 |
| 7 | Mobile tech stack | **Native app** (over PWA) — chosen for better background/offline storage robustness and GPS accuracy. **React Native recommended** (not yet explicitly confirmed over Flutter) because the existing PACE frontend is React/JSX — more ecosystem/knowledge overlap for whoever builds and maintains it than Dart/Flutter would offer. | 2026-09-10 |
| 8 | Where approval-workflow creation happens | **Always server-side, at sync time** — never on-device, whether online or offline. The device's only job is to capture raw facts (lat/long, device timestamp, on-device-computed `within_radius` flag) and queue/sync them. The server inspects the synced record and decides whether to spin up an approval request. This collapses the online/offline cases into one code path — see §5.1. | 2026-09-10 |
| 9 | Buddy-punching guard | **Device binding + phone-native OS biometric confirmation** (Face ID/fingerprint) required before each punch — no selfie-capture layer. One active bound device per user; switching devices requires manager/HR approval (device-change request). PACE itself never stores biometric data — delegated entirely to the phone's OS. Explicitly accepted as not 100% fraud-proof (a shared, unlocked phone can still be misused) but the standard practical layer for this class of app. | 2026-09-10 |
| 10 | Pending device-change window behavior | **Provisional allow + flag** — punches from a new, not-yet-approved device are accepted and captured normally, tagged "Pending Device Confirmation," and sit in the same approval queue as the device-change request itself. Employee is never blocked from punching (and therefore never at risk of Absent/pay loss) just because a manager hasn't acted yet. If later approved, the provisional punches simply become confirmed — nothing needs to be redone. If rejected, those punches are **not** silently deleted or marked absent — they go to HR investigation for a human decision. Chosen over hard-blocking specifically to avoid re-creating the same "manager delay costs the employee pay" risk raised in §5.3. | 2026-09-10 |
| 11 | Biometric temporarily unavailable, same bound device | **Never a hard block.** Fallback chain: biometric retry → OS-native PIN/passcode (built into the platform biometric API, no custom code needed) → PACE app password re-entry as a last resort if the device has no passcode/biometric configured at all. Biometric is a secondary check layered on an already-trusted bound device, not the sole gate, so its temporary failure never stops the punch. | 2026-09-10 |
| 12 | Repeated biometric fallback usage on one device | **Flag to manager**, don't ignore. If the same bound device falls back to PIN/password instead of biometric repeatedly (e.g. 3+ times within a rolling window such as a week), raise it into the Attendance Exception Queue as visibility-only (never blocks the punch) — could mean a genuinely failing sensor or a suspicious pattern; either way a human should see it. | 2026-09-10 |
| 13 | Location Service off / permission denied | **Hard block** — the one deliberate exception to this document's "never block" rule. Punch button is disabled with guidance to enable location (deep-link to device settings) until location is actually available. Justified because, unlike every other case in this doc, this is instantly and fully within the employee's own control (a 10-second toggle) — not an external dependency (manager delay, sensor glitch, device loss) that would make blocking unfair. Also structurally necessary: allowing a location-free punch would let anyone bypass the entire geofencing feature by simply turning it off. | 2026-09-10 |
| 14 | Location enabled + permitted, but no GPS fix obtainable | **Provisional allow + flag** (back to the normal pattern) — treated as a 7th Attendance Exception type, "Location Unavailable." Distinguished from decision #13 precisely because this scenario is *not* within the employee's immediate control (weak signal, rare hardware fault) even after on-device retry/timeout. | 2026-09-10 |
| 15 | Mock/fake-GPS detection | **In scope now, not deferred.** On Android, check `Location.isFromMockProvider()` (or equivalent) on every punch's location reading; a mock-sourced reading is rejected/flagged immediately, not silently trusted. No equivalent OS-level API exists on iOS — documented as a known platform limitation, not something to try to work around with a weaker heuristic. | 2026-09-10 |

---

## 3. Rejected / Superseded Approach

**Continuous background location tracking for punch-out fallback** (reconstructing "last
known inside-radius" timestamp) was considered and explicitly rejected in favor of decision
#4 above. Reasons discussed:
- Significant battery drain, likely to generate real employee complaints.
- iOS and Android both gate background location behind separate, more intrusive OS
  permission prompts — worse install/consent experience.
- Privacy/legal exposure: this would mean tracking an employee's location all day, every
  few minutes, not just at the two punch moments — an HR-policy/consent question well beyond
  the geofencing feature itself.
- The simpler approval-routing approach (identical to the punch-in case) achieves the same
  practical goal — a human decides the correct time — without any of the above cost.

---

## 4. New Design Problem Found During Discussion — Stale Open Shift ("Double Duty")

**Raised by business owner, 2026-09-10.** Independent of geofencing, but surfaced while
designing the punch flow fresh: if an employee punches IN and never punches OUT the same
day (forgets, leaves), then the next day punches OUT (intending to close yesterday's shift)
and then punches IN again for the new day — a naive implementation would:
1. Close yesterday's OPEN shift using today's punch-out timestamp → an absurd ~20+ hour
   shift gets counted.
2. Then also count the fresh punch-in/punch-out pair for today.
3. Net effect: the employee is credited for **two shifts' worth of duty** off one missed
   punch-out — "double duty."

### Proposed fix — "Open Shift Auto-Detection + Correction Lock" (proposed, not yet formally
locked — see Open Items)

1. On every punch-IN, check whether the user has an existing **OPEN shift** (has a
   punch-in, no punch-out) that is either (a) not from today, or (b) has been open longer
   than a configurable max-shift-duration threshold.
2. If such a stale open shift exists, it can **no longer be closed by a normal punch
   action**. It is automatically flagged as a "Missing Punch-Out" exception and routed to
   the manager/HR correction queue — same UI pattern as existing Leave/Out-Work approval
   pages. Manager/HR manually enters the correct punch-out time (or applies a policy
   default) to close it.
3. The employee is **not blocked** from continuing to use the app normally — they can still
   punch in/out for the current day; only the stale shift's resolution is deferred to a
   human.
4. Duty-hour calculation must **never auto-complete** a stale open shift via a live punch
   action — only via the explicit manager/HR correction. This is what actually prevents the
   double-duty outcome, not just flagging it after the fact.

This mirrors the correction/maker-checker discipline already established elsewhere in PACE
(e.g., COR6-style corrections in Production, PID's approval-gated corrections) — a human
closes an anomalous record, the system never silently guesses.

---

## 5. Additional Edge Cases (Round 2, same session)

Three more real gaps raised by the business owner right after §4, all variations on the
same theme: what happens when the "normal" path (live network, honest single user, present-
but-forgetful employee) doesn't hold.

### 5.1 — Offline + outside-radius punch-in: the approval form can't be created without a network

**Problem:** decision #3 (punch-in outside radius auto-creates an approval request) assumes
a live server call. If the device has no internet at punch time, nothing can be "created"
anywhere yet.

**Resolution (see also decision #8):** the device was never supposed to create the approval
request in the first place — that responsibility moves entirely to the server, evaluated
**at sync time**, not at capture time. Concretely:
- On-device, at punch time: compute `within_radius` locally (geofence config is already
  cached from the last successful sync/login), save the punch record locally with that flag,
  regardless of connectivity. Show the employee a simple local confirmation ("Saved — will
  sync; may need manager approval since you're outside your assigned location").
- At sync time (whenever connectivity returns, seconds or days later): the server receives
  the queued punch record. If `within_radius = false`, **this is the moment** the
  Leave/Out-Work approval request actually gets created.
- Net effect: online and offline are literally the same code path on the server. The only
  difference is how long the record sat in the device's local queue before that path ran.
  The device never needs to know anything about the approval/workflow engine at all.

### 5.2 — Someone else punching in from another phone (buddy punching / account sharing)

**Problem:** without any device/identity binding, an employee could hand their login
credentials to a colleague, or use a colleague's already-logged-in phone, to punch on their
behalf — geofencing alone doesn't stop this, it only checks *where*, not *who*.

**Resolution — decision #9 above:**
- **Device binding:** a user's account is bound to exactly one active device at a time,
  established at first login. A login attempt from a different, unbound device is treated
  as a **device-change request**, gated behind manager/HR approval (same approval-queue
  pattern as everything else here) — not a silent re-bind.
- **OS-native biometric confirmation per punch:** before each punch is accepted on-device,
  the app requires the phone's own Face ID/fingerprint check. PACE never touches or stores
  biometric data itself — it only asks the OS "is this the phone's enrolled owner?" and
  trusts the OS's answer.
- **Explicitly not claimed as 100% fraud-proof** — an employee who deliberately hands over
  their already-unlocked, bound phone can still be punched-for by someone else. This is
  accepted as the practical industry-standard layer for a non-biometric-hardware ERP; a
  stronger control (mandatory selfie per punch, for manager spot-check) was discussed and
  explicitly declined for now due to storage/privacy overhead and employee intrusiveness —
  can be revisited later if buddy-punching turns out to be a real problem in practice.

**Follow-up question raised — what happens during the gap while a device-change request is
still pending (manager hasn't acted yet)?** Resolved as decision #10: **provisional allow +
flag**, not hard-block. Punches from the new, not-yet-approved device are accepted and
captured normally (tagged "Pending Device Confirmation"), sitting in the same approval queue
as the device-change request. The employee is never blocked from punching, and therefore
never at risk of Absent/pay-loss, purely because a manager is slow to act — the same concern
already raised in §5.3. Two outcomes once the manager finally acts:
- **Approved (even much later):** nothing needs to be redone — the provisional punches
  already happened and were captured; only their "pending" flag clears to confirmed.
- **Rejected:** those provisional punches are **not** silently deleted or auto-marked
  Absent — they route to HR investigation for a human decision, consistent with this
  document's general principle (§4, §5.3) that the system never silently guesses on an
  anomaly, a human closes it.

### 5.3 — Employee forgets to punch entirely → shows Absent → but they still need to get paid

**Problem:** distinct from §4's "stale open shift" (which is a *half*-missing punch — one
side recorded, the other forgotten). This is a *fully* missing day — no punch-in, no
punch-out at all — which the attendance engine will naturally read as ABSENT, with direct
payroll consequences unless a manager acts.

**Resolution (proposed, not yet formally locked — see Open Items):**
- Give the employee a **self-service "Missed Punch Correction Request"**: "I was present on
  [date], I forgot to punch — please mark me present," with a reason field, submitted after
  the fact.
- Routes into the same manager/HR approval queue as every other exception here (Leave/
  Out-Work/geofence-violation/stale-open-shift). Manager approves → that day is marked
  Present (and, if relevant, given inferred punch-in/out times or a flat full-day credit,
  policy TBD); rejects → stays Absent.
- Should reuse the HR module's existing **3-day backdate protection** convention
  (`HR_ATTENDANCE_FULL_DESIGN.md`) rather than inventing a new backdating rule — same
  window, same rationale.
- Because this directly affects pay, it needs to be **highly visible** in the manager's
  approval inbox (the ERP already has an approval-inbox mechanism on the dashboard home —
  this should just be another item type feeding that same inbox, not a separate screen to
  remember to check).
- **Not yet decided:** whether unactioned corrections need any escalation/reminder ahead of
  a payroll cutoff (e.g., auto-escalate to the next rank if the manager hasn't acted within
  N days of period-close) — flagged as worth considering, not locked.

### 5.4 — Broken phone / temporary biometric failure (same session, follow-up)

Two distinct sub-cases, deliberately not conflated:

**Phone completely broken or lost:** this is just a new-device situation — it flows straight
into the already-designed device-change request + provisional-allow-and-flag mechanism
(§5.2/decision #10). Nothing new needed here, just a cross-reference: a broken/lost phone
is not a special case, it's the same "unbound device" case already covered.

**Same (already-bound, already-approved) phone, biometric momentarily not working**
(wet/dirty sensor, cold fingers, face covered, etc.) — resolved as decisions #11 and #12:
- Fallback chain, entirely delegated to the OS, no custom PACE code needed for the first two
  steps: biometric retry → device's own PIN/passcode (the platform's biometric API already
  offers this automatically on both iOS and Android) → PACE app password re-entry only if
  the device has no passcode/biometric set up at all.
- The punch is **never blocked** by a biometric hiccup — the bound device itself is the
  primary trust anchor; biometric is a secondary layer on top of it, not the sole gate.
- However, **repeated** fallback-to-PIN/password on the same device (e.g. 3+ times in a
  rolling week) is **not treated as normal and ignored** — it gets raised into the
  Attendance Exception Queue (§5.5) as a visibility-only flag for the manager, since it
  could mean either a genuinely failing sensor (a legitimate hardware issue worth knowing
  about) or a suspicious pattern worth a closer look. Either way, a human sees it; the punch
  itself is still never held up waiting for that review.

### 5.5 — Location Service off, GPS fix unavailable, and mock/fake-GPS spoofing

Three related but distinct scenarios, deliberately given different treatment (see decisions
#13-#15):

**Location Service switched off, or permission denied:** the one deliberate exception to
this document's own "never block" rule (§5.6 lists all the others). The punch button is
disabled outright, with clear guidance and a deep-link to the phone's location settings,
until location actually becomes available. The reasoning for treating this differently from
every other case: everywhere else in this document, blocking would be *unfair* because the
missing piece is outside the employee's control (a slow manager, a flaky sensor, a lost
phone). Here it is not — turning location back on is a 10-second action fully within the
employee's own hands. Blocking is also structurally required, not just fair: allowing a
punch with no location data at all would hand anyone a trivial way to defeat the entire
geofencing feature.

**Location on and permitted, but the device genuinely can't get a GPS fix** (weak signal,
rare hardware fault) even after an on-device retry/timeout: this is different — now it
*is* outside the employee's immediate control, so it falls back to the normal pattern:
provisional allow + flag, as a 7th Attendance Exception type ("Location Unavailable").

**Fake-GPS apps reporting a false but "enabled" location:** a more sophisticated bypass
attempt that a simple on/off check can't catch — the app sees location as available, just
lying. Mitigation locked as decision #15: Android exposes `Location.isFromMockProvider()`
(or the modern equivalent) so a punch's location reading can be checked for a mock source
and rejected/flagged immediately rather than trusted. iOS has no equivalent OS-level
signal — documented here as an accepted platform gap, not something to paper over with a
weaker heuristic.

### 5.6 — Emerging unified pattern: one "Attendance Exception Queue," not seven separate mechanisms

By this point in the discussion, the same shape has repeated seven times (everything
*except* decision #13's deliberate hard-block, which stays a documented exception):

1. Punch-in outside geofence radius (decision #3)
2. Punch-out outside geofence radius (decision #4)
3. Stale open shift / missing punch-out (§4)
4. Fully missed punch / Absent-but-was-present (§5.3)
5. Punch from a pending, not-yet-approved device (§5.2/decision #10)
6. Repeated biometric-fallback usage on one device (§5.4/decision #12)
7. Location enabled but no GPS fix obtainable (§5.5/decision #14)

Every one of these seven follows the identical rule: **never hard-block, never silently
guess — capture/allow provisionally, tag with a reason, route to manager/HR approval, let a
human close it.** Decision #13 (Location Service off) is the sole, deliberate exception,
and decision #15 (mock-GPS) is a straight reject/flag rather than a routed approval since
there's nothing for a manager to adjudicate — it's a binary technical signal. At
implementation-brief time, the seven approval-routed cases should very likely be built as
**one generic "Attendance Exception" record type** (with a `reason_code` distinguishing
each) feeding **one approval queue and one dashboard-inbox surface**, rather than seven
parallel bespoke tables/screens — same spirit as this codebase's existing habit of
recognizing a repeated shape and building one reusable mechanism instead of N one-offs (see
`CLAUDE.md`'s Bug-Pattern Guard Playbook for the same philosophy applied to code review).
This is a technical/architectural call for implementation-brief time, not something needing
further business sign-off — noted here so it isn't lost.

---

## 6. Open Items (need a decision before this can be locked)

- **Max-shift-duration threshold** — how many hours before an open shift is considered
  "stale" and routed to correction instead of allowed to close normally? Discussed range:
  12–18 hours. **Not yet decided.**
- **React Native vs Flutter** — React Native proposed on ecosystem-overlap grounds, not
  explicitly confirmed by business owner yet.
- **Geofence location master schema** — new dedicated table (e.g. `hr_geofence_location`)
  vs. extending the existing company/plant address record with lat/long. This is a technical
  call, not a business decision — to be made by Claude at implementation-brief time, per the
  project's established practice of not asking the business owner to bless schema design.
- **Offline auth token caching mechanism** — how the mobile app authenticates a punch capture
  made with zero connectivity (cached session token strategy, expiry handling). Technical
  call, same as above — deferred to implementation-brief time.
- **Mismatch threshold for offline device-clock flagging** (decision #6 above) — exact
  minutes/hours tolerance before a synced punch gets flagged. Technical/tunable default,
  can be proposed at implementation-brief time and adjusted by business owner.
- **Sequencing** — does this jump ahead of the currently locked CLAUDE.md §6 module order
  (Dispatch → Costing/AP-Reco → Accounts → WAR), or does it wait until that chain closes?
  Not yet decided — business owner said implementation is deferred, but didn't specify
  relative to the existing queue.
- **Whether/when to write this into `CLAUDE.md` and a numbered feasibility-doc section** —
  per the project's doc-first-workflow convention, this should get folded into the
  master feasibility doc (with a real section number) once implementation is actually about
  to start, not left permanently as a standalone file.
- **Missed Punch Correction — pay treatment on approval** (§5.3) — does an approved
  correction give a flat full-day present credit, or does the manager also have to enter
  inferred punch-in/out times for accurate duty-hour calc? Not yet decided.
- **Missed Punch Correction — escalation before payroll cutoff** (§5.3) — should an
  unactioned correction auto-escalate to the next rank as period-close approaches? Discussed
  as worth considering, not locked either way.
- **Device-change request approval authority** (§5.2/decision #9) — who approves a device
  switch (direct manager, HR, or SA/GA only)? Not yet decided.

---

## 7. Next Step

When the business owner is ready to move this from "design discovery" to "implementation-
ready," the remaining open items above should be resolved, then this content folded into a
numbered section of the master feasibility doc + a `CLAUDE.md` summary entry, and a task
brief written — same discipline used for every other module in this codebase.
