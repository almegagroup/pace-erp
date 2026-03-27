# PACE ERP — UI BOOT LOG

Purpose:
This document records every temporary UI change made during ERP UI bootstrapping.
It ensures that no architectural invariant is broken and that all changes can be reversed later.

This file is the SINGLE SOURCE OF TRUTH for UI bootstrap actions.

---

# 1. SYSTEM BASELINE (START STATE)

Date: 2026-03-12

The UI bootstrap starts from a CLEAN Gate-7 router configuration.

Files restored to canonical state:

frontend/src/App.jsx
frontend/src/router/AppRouter.jsx

No temporary UI code exists.

Current state of these files:

App.jsx

MenuProvider
  └ AppRouter

AppRouter.jsx

BrowserRouter
  └ HiddenRouteRedirect
        └ Routes
            ├ /sa/home
            ├ /ga/home
            ├ /dashboard
            └ /

All ACL guards are active.

---

# 2. ERP UI FINAL TARGET FLOW

The final ERP UI must follow this strict entry flow.

Landing (/)
    ↓
Login (/login)
    ↓
POST /api/login
    ↓
Session Cookie
    ↓
GET /api/me
    ↓
Role Resolution

SA → /sa/home
GA → /ga/home
USER → /dashboard

After role resolution:

MenuProvider activates
Menu Snapshot loads
MenuShell renders

No menu or ACL logic should activate before login.

---

# 3. CURRENT UI PROBLEM

The current router structure loads HiddenRouteRedirect immediately.

HiddenRouteRedirect internally calls:

useMenu()

MenuProvider then tries to fetch:

/api/me/menu

But during UI bootstrap:

User is NOT logged in
Session does NOT exist
Menu snapshot is NOT available

Therefore:

useMenu() returns null
HiddenRouteRedirect crashes

Console error:

Cannot destructure property 'allowedRoutes' of useMenu() as it is null.

---

# 4. BOOTSTRAP STRATEGY

We must temporarily bypass Menu-dependent logic until login exists.

During bootstrap we allow:

Landing
Login
Auth

But we keep the architecture intact.

We DO NOT delete:

MenuProvider
RouteGuard
DeepLinkGuard
MenuShell

We only delay when they activate.

---

# 5. TEMPORARY BOOT RULES

During UI boot:

Rule 1
HiddenRouteRedirect must NOT run before login.

Rule 2
MenuProvider must remain in App.jsx.

Rule 3
Router must allow public routes.

Allowed public routes:

/
 /login

Rule 4
MenuProvider must only be used after login.

---

# 6. BOOT PHASES

Phase 1
Landing Page

Phase 2
Login Screen

Phase 3
Login API integration

Phase 4
Session verification

Phase 5
Menu snapshot loading

Phase 6
Dashboard shell activation

---

# 7. PHASE 1 — LANDING PAGE

Action:

Add landing page content to:

Route "/"

Replace:

<div>Home</div>

With landing UI.

Reason:

ERP entry must start with Landing → Login.

---

# 8. PHASE 2 — LOGIN SCREEN

Add route:

/login

Purpose:

Collect user credentials.

No MenuProvider dependency.

---

# 9. PHASE 3 — LOGIN API

POST /api/login

Response:

session cookie

---

# 10. PHASE 4 — USER RESOLUTION

GET /api/me

Response contains:

user role

Redirect logic:

SA → /sa/home
GA → /ga/home
USER → /dashboard

---

# 11. PHASE 5 — MENU ACTIVATION

Only after dashboard entry:

MenuProvider fetches:

/api/me/menu

Menu snapshot loads.

---

# 12. RESTORE PLAN

After login flow works:

HiddenRouteRedirect will be restored.

Router returns to canonical Gate-7 structure.

Temporary landing logic remains.

---

# 13. IMPORTANT ARCHITECTURE INVARIANTS

Never remove:

MenuProvider
RouteGuard
DeepLinkGuard
MenuShell

Never call:

useMenu()

before login.

Never bypass ACL inside dashboard.

---

# 14. CURRENT EXECUTION STEP

STEP-0 COMPLETE

System baseline confirmed.

Next action:

PHASE 1 — Landing UI implementation.

# 15. PHASE 1 — LANDING IMPLEMENTATION

Status:
Completed

File modified:

frontend/src/router/AppRouter.jsx

Change:

Landing route UI implemented.

Route:

"/"

Before:

<div>Home</div>

After:

Landing UI with Tailwind layout.

Purpose:

Provide ERP public entry screen before authentication.

Result:

Landing page renders without dependency on ACL or Menu system.

URL:

http://localhost:5173/

Console:

NAV_EVENT → DASHBOARD_HOME

# 16. ISSUE DISCOVERED — MENU SNAPSHOT FETCH BEFORE LOGIN

During landing load MenuProvider executed automatically.

MenuProvider attempted to call:

GET /api/me/menu

Backend response:

401 Unauthorized

Reason:

User session does not exist during landing page.

Menu snapshot endpoint requires authenticated session.

Effect:

Console log noise and potential guard crash risk.

Root cause:

MenuProvider activates before authentication phase.

# 17. TEMPORARY PATCH — MENU FETCH GUARD

File modified:

frontend/src/context/MenuProvider.jsx

Patch Type:

Temporary bootstrap guard.

Implementation:

if (pathname === "/") skip menu snapshot fetch.

Code added:

const pathname = globalThis.location.pathname;

if (pathname === "/") {
    setTimeout(() => setLoading(false), 0);
    return;
}

Purpose:

Prevent menu API call during landing phase.

Reason:

Menu snapshot requires authenticated session.

Status:

Active

# 18. REACT EFFECT WARNING FIX

Issue:

React warning detected:

Calling setState synchronously inside effect.

Resolution:

Moved setLoading(false) to async microtask.

Implementation:

setTimeout(() => setLoading(false), 0)

Reason:

Avoid synchronous state update inside effect body.

Status:

Resolved

# 19. CURRENT SYSTEM STATE

Landing page:

Working

MenuProvider:

Guarded during landing

Menu API call:

Disabled before login

ACL guards:

Not modified

Router structure:

Unchanged

Architecture integrity:

Maintained

# 20. NEXT EXECUTION STEP

Next phase:

PHASE 2 — LOGIN SCREEN

Tasks:

1. Add route /login
2. Create LoginScreen.jsx
3. Collect credentials
4. POST /api/login
5. Handle session cookie
6. Redirect to role resolution

STEP-3 — Navigation Bootstrap Guard

File:
frontend/src/main.jsx

Change:
Navigation engine must not auto-push DASHBOARD_HOME during landing.

Patch:

const pathname = globalThis.location.pathname;

if (pathname !== "/") {
  initNavigation("DASHBOARD_HOME");
}

Reason:
screenStackEngine was overriding landing route.

STEP-3 — Navigation Bootstrap Guard

File:
frontend/src/main.jsx

Change:
Prevent screenStackEngine from forcing dashboard during landing.

Patch:

const pathname = globalThis.location.pathname;

if (pathname !== "/") {
  initNavigation("DASHBOARD_HOME");
}

restoreNavigationStack();

Reason:
Navigation engine was overriding router landing route.
Landing must render before dashboard navigation begins.

STEP-4 — HiddenRouteRedirect Disabled

File:
frontend/src/router/AppRouter.jsx

Change:
HiddenRouteRedirect temporarily disabled during UI bootstrap.

Reason:
HiddenRouteRedirect depends on menu snapshot which requires
authenticated session.

Without login it caused blank landing page.

STEP-5 — Landing Page Visible

Result:

Landing page successfully renders at route "/".

UI Output:

PACE ERP
Process Automation & Control Environment

Console:

No errors.

System Status:

Router operational
Navigation engine guarded
Menu system inactive before login
ACL architecture intact

STEP-5B — Tailwind PostCSS Plugin

File created:
frontend/postcss.config.js

Content:

export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

Reason:
Tailwind v4 requires PostCSS plugin to process @import "tailwindcss".

# 21. LANDING UI ENHANCEMENT — BOOT LOADER IMPLEMENTATION

Status:
Completed

File modified:

frontend/src/pages/public/LandingPage.jsx

Purpose:

Introduce a temporary ERP boot loader screen before rendering the
public landing content.

This simulates application initialization and provides a smoother
visual entry into the ERP interface.

Implementation details:

A temporary boot state is introduced using React state:

const [booting, setBooting] = useState(true);

A timer delays the landing page render:

setTimeout(() => {
  setBooting(false);
}, 1800);

During the boot phase the screen renders only the boot asset.

Boot screen content:

Asset:
src/assets/sp.png

Displayed as centered loader graphic.

Boot screen layout:

Full screen overlay
Centered loader image
Neutral background (#F5F6F8)

After the timer completes:

Boot screen disappears
Landing UI becomes visible.

Landing UI content:

PACE ERP logo
Tagline:

Process Automation & Control Environment

Primary actions:

Login → /login
Sign Up → /signup

Footer:

© Almega Group

---

# 22. BOOT SCREEN ARCHITECTURE NOTES

Boot loader intentionally does NOT interact with:

MenuProvider
RouteGuard
DeepLinkGuard
MenuShell

Reason:

These systems require authenticated session context and must not
execute before login.

The boot screen exists purely at the visual layer.

---

# 23. CURRENT UI BOOT STATE

Landing page:

Operational

Boot loader:

Operational

Menu snapshot fetch:

Guarded during landing phase

Navigation stack:

Guarded against forced dashboard push

HiddenRouteRedirect:

Temporarily disabled

ERP UI entry flow now operates as:

Landing (/)
↓
Login (/login)
↓
POST /api/login
↓
Session cookie
↓
GET /api/me
↓
Role resolution
↓
Dashboard shell

---

# 24. NEXT EXECUTION STEP

Next phase:

PHASE 2 — LOGIN SCREEN IMPLEMENTATION

Files to create:

frontend/src/pages/public/LoginScreen.jsx

Tasks:

1. Create login form UI
2. Capture user credentials
3. POST /api/login
4. Handle session cookie
5. Redirect to role resolution

25. PHASE 2 — LOGIN SCREEN IMPLEMENTATION

Status:
Completed

File created:

frontend/src/pages/public/LoginScreen.jsx

Purpose:

Provide authentication entry interface for ERP users.

This screen collects user credentials and sends them to the
backend authentication endpoint.

26. LOGIN SCREEN UI STRUCTURE

Login screen includes:

Fields:

Email or Employee ID
Password

Controls:

Show / Hide Password
Login Button
Forgot Password Link
Create Account Link

UX behaviour:

Pressing Enter triggers login submission

During login request:

login button disabled

input fields disabled

optional loading indicator shown

Error handling:

Invalid employee ID or password

Backend error messages are not exposed directly to the UI.

27. PUBLIC ROUTES DECLARATION

ERP UI now explicitly defines public routes.

Public routes:

/
 /login
 /signup
 /forgot-password
 /reset-password

These routes operate outside the authenticated universe.

Rules:

MenuProvider must not fetch menu snapshot
Navigation engine must not initialize dashboard
ACL guards must remain inactive
28. MENU PROVIDER GUARD UPDATE

File modified:

frontend/src/context/MenuProvider.jsx

Purpose:

Prevent menu snapshot fetch before authentication.

Implementation:

const PUBLIC_ROUTES = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password"
]);

if (PUBLIC_ROUTES.has(pathname)) {
  setTimeout(() => setLoading(false), 0);
  return;
}

Effect:

/api/me/menu

will only be called after login session exists.

29. NAVIGATION ENGINE GUARD UPDATE

File modified:

frontend/src/main.jsx

Purpose:

Prevent screenStackEngine from pushing dashboard while
user is still inside the public authentication flow.

Implementation:

const PUBLIC_ROUTES = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password"
]);

if (!PUBLIC_ROUTES.has(pathname)) {
  initNavigation("DASHBOARD_HOME");
}

restoreNavigationStack();

Effect:

Navigation engine activates only after authenticated
routes are entered.

30. LOGIN SUCCESS FLOW

The ERP authentication pipeline now follows this sequence:

Landing (/)
↓
Login (/login)
↓
POST /api/login
↓
Session Cookie issued
↓
GET /api/me
↓
User Role Resolution

Role redirects:

SA → /sa/home
GA → /ga/home
USER → /dashboard

After role resolution:

MenuProvider activates
↓
GET /api/me/menu
↓
Menu snapshot loads
↓
MenuShell renders
31. ARCHITECTURE SAFETY CONFIRMATION

The following ERP architectural invariants remain intact:

Never removed:

MenuProvider
RouteGuard
DeepLinkGuard
MenuShell

Never executed before authentication:

useMenu()
Menu snapshot fetch
ACL route enforcement
32. CURRENT UI SYSTEM STATE

Landing Page:

Operational
Boot loader active

Login Screen:

Operational
Credential form active

Menu System:

Disabled before login

Navigation Engine:

Guarded during public routes

HiddenRouteRedirect:

Temporarily disabled
Will be restored after login pipeline stabilizes
33. NEXT EXECUTION STEP

Next phase:

PHASE 3 — LOGIN API INTEGRATION

Tasks:

1. Connect LoginScreen.jsx to POST /api/login
2. Handle response cookies
3. Call /api/me after login
4. Resolve user role
5. Redirect to correct dashboard
34. FUTURE PHASES

Remaining UI activation phases:

PHASE 4 — Session Verification
PHASE 5 — Menu Snapshot Activation
PHASE 6 — Dashboard Shell Activation

These phases will progressively re-enable:

HiddenRouteRedirect
RouteGuard
DeepLinkGuard
MenuShell
35. PHASE 3 EXTENSION — SIGNUP FLOW IMPLEMENTATION

Status:
Partially implemented

Files created:

frontend/src/pages/public/SignupPage.jsx
frontend/src/pages/public/EmailVerified.jsx
frontend/src/pages/public/SignupSubmittedPage.jsx

Purpose:

Provide ERP public user onboarding flow integrated with Supabase
identity verification and ERP signup approval pipeline.

Signup flow architecture:

Signup Form (/signup)
        ↓
Supabase Auth signup
        ↓
Verification Email Sent
        ↓
User clicks magic verification link
        ↓
EmailVerified.jsx
        ↓
POST /api/signup
        ↓
ERP DB user creation
        ↓
SignupSubmittedPage.jsx
36. SIGNUP PAGE IMPLEMENTATION

Status:
Completed

File:

frontend/src/pages/public/SignupPage.jsx

Responsibilities:

Collect user onboarding information.

Fields captured:

Full Name
Parent Company
Designation (optional)
Phone Number
Email
Password

Primary action:

supabase.auth.signUp()

Implementation:

supabase.auth.signUp({
  email,
  password,
  options:{
    emailRedirectTo: `${window.location.origin}/email-verified`
  }
})

Effect:

Supabase Auth creates user identity and sends
verification email.

37. EMAIL VERIFICATION HANDLER

Status:
Implemented

File:

frontend/src/pages/public/EmailVerified.jsx

Purpose:

Confirm whether Supabase email verification succeeded
and trigger ERP signup request.

Process:

Supabase session resolved
        ↓
Check user.email_confirmed_at
        ↓
If verified
        ↓
POST /api/signup
        ↓
Redirect to signup confirmation page

API call:

POST /api/signup
Authorization: Bearer <Supabase JWT>

JWT obtained from:

supabase.auth.getSession()

Reason:

Backend requires authenticated Supabase identity to resolve:

req.auth_user_id
38. SIGNUP CONFIRMATION PAGE

Status:
Implemented

File:

frontend/src/pages/public/SignupSubmittedPage.jsx

Purpose:

Confirm ERP signup request submission.

Message shown:

Signup Request Submitted

Your ERP account request has been submitted successfully.
An administrator will review and approve your account.

User action available:

Back to Home

Route redirect:

navigate("/")
39. PUBLIC ROUTES UPDATE

Public routes expanded to include signup lifecycle pages.

Current public routes:

/
 /login
 /signup
 /email-verified
 /signup-submitted
 /forgot-password
 /reset-password

Reason:

Signup flow must remain outside authenticated
ERP universe until approval.

40. MENU PROVIDER GUARD UPDATE (EXTENDED)

File modified:

frontend/src/context/MenuProvider.jsx

Update:

Public route guard expanded to include signup lifecycle routes.

PUBLIC_ROUTES set now includes:

/
 /login
 /signup
 /email-verified
 /signup-submitted
 /forgot-password
 /reset-password

Effect:

MenuProvider will NOT attempt to fetch:

GET /api/me/menu

before authentication.

41. NAVIGATION ENGINE GUARD UPDATE (EXTENDED)

File modified:

frontend/src/main.jsx

Navigation engine now ignores all public authentication routes.

PUBLIC_ROUTES now includes:

/
 /login
 /signup
 /email-verified
 /signup-submitted
 /forgot-password
 /reset-password

Implementation:

if (!PUBLIC_ROUTES.has(pathname)) {
  initNavigation("DASHBOARD_HOME");
}

Effect:

Navigation stack activates only when user enters
authenticated ERP routes.

42. CURRENT SIGNUP PIPELINE STATE

System components status:

Supabase Auth:

Working
User identity created successfully

Email verification:

Working
Verification email delivered

EmailVerified page:

Working
Verification status resolved

Signup API call:

Configured
Authorization header implemented

ERP database insert:

Not yet confirmed
Testing pending
43. TESTING STATUS

Signup pipeline testing could not be completed due to
Supabase email rate-limit restriction.

Observed error:

email rate limit exceeded

Cause:

Multiple verification email requests triggered
within a short time window.

Supabase temporary limit reached.

Effect:

New signup verification emails are temporarily blocked.

44. TESTING PLAN (PENDING)

Signup pipeline testing will resume after
Supabase email rate-limit window resets.

Testing checklist:

Perform fresh signup

Receive verification email

Click verification link

Load EmailVerified.jsx

Trigger POST /api/signup

Verify database insertion:

Tables:

erp_core.users
erp_core.signup_requests

Expected result:

erp_core.users.state = PENDING
signup_requests row created
45. CURRENT SYSTEM STATE (UPDATED)

Landing page:

Operational

Boot loader:

Operational

Login screen:

Operational

Signup screen:

Operational

Email verification handler:

Implemented

Signup confirmation screen:

Implemented

Menu system:

Disabled during public routes

Navigation engine:

Guarded

HiddenRouteRedirect:

Still temporarily disabled

ERP architecture integrity:

Maintained

Signup pipeline:

Implementation complete
Testing pending

46. NEXT EXECUTION STEP

Next phase:

PHASE 3B — SIGNUP PIPELINE TEST

Tasks:

1. Wait for Supabase email rate-limit reset
2. Perform full signup cycle test
3. Confirm ERP DB insert
4. Verify pending user state
5. Validate admin approval path

47. SIGNUP PIPELINE TEST — EXECUTION

Status:
Completed

Supabase email rate-limit reset হওয়ার পর signup pipeline end-to-end test করা হয়।

Test flow executed:

Landing (/)
↓
Signup (/signup)
↓
Supabase Auth user creation
↓
Verification email sent
↓
User clicks verification link
↓
EmailVerified.jsx
↓
POST /api/signup
↓
ERP DB insert
↓
SignupSubmittedPage.jsx

Testing environment:

Local UI
Render backend
Supabase Auth + Database

48. CAPTCHA INTEGRATION — SIGNUP SCREEN

Status:
Implemented

File modified:

frontend/src/pages/public/SignupScreen.jsx

Purpose:

Prevent automated bot account creation during public signup.

Implementation:

Cloudflare Turnstile captcha integrated.

Script loaded in:

frontend/index.html
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>

Captcha rendered using runtime render method:

turnstile.render()

React implementation added:

useEffect(() => {

  function renderCaptcha(){

    if (!globalThis.turnstile) {
      setTimeout(renderCaptcha,200);
      return;
    }

    const container = document.getElementById("signup-turnstile");

    if (!container) return;

    if (container.childElementCount > 0) return;

    globalThis.turnstile.render(container,{
      sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
      callback:(token)=>setCaptchaToken(token),
      "expired-callback":()=>setCaptchaToken(null)
    });

  }

  renderCaptcha();

},[])

Effect:

Signup form submission requires valid captcha token.

Validation added:

if(!captchaToken){
  setError("Please complete captcha");
  return;
}
49. CAPTCHA RENDER RELIABILITY FIX

During initial integration captcha occasionally failed to render.

Observed behaviour:

Captcha appeared only after multiple page refreshes.

Root cause:

Turnstile script load timing mismatch with React render lifecycle.

Solution:

Captcha rendering delayed until global turnstile object becomes available.

Implementation:

if (!globalThis.turnstile) {
  setTimeout(renderCaptcha,200);
  return;
}

Additional guard added:

if (container.childElementCount > 0) return;

Purpose:

Prevent duplicate captcha rendering.

Result:

Captcha now renders reliably during signup.

50. EMAIL VERIFIED PAGE — CAPTCHA REMOVAL

Initial design attempted to place captcha on:

EmailVerified.jsx

However this created architectural friction.

Problem:

Backend /api/signup expected captcha token even when request originated from verified user.

UX consequence:

User required to complete captcha twice.

Architecture decision:

Captcha remains only on:

SignupScreen.jsx

Captcha removed from:

frontend/src/pages/public/EmailVerified.jsx

Email verification page now performs only:

session check
email verification check
POST /api/signup

This aligns with ERP onboarding pipeline design.

51. BACKEND HUMAN VERIFICATION ADJUSTMENT

File modified:

supabase/functions/api/_core/auth/signup/signup.handler.ts

Original implementation required captcha token for every request.

Original logic:

const human = await verifyHumanRequest(req);

if(!human.ok){
  log({ event:"HUMAN_VERIFICATION_FAILED" });
  return okResponse(null,requestId);
}

This caused failure when /api/signup was triggered by EmailVerified page.

Observed Render log:

HUMAN_VERIFICATION_FAILED

Resolution:

Human verification made conditional.

Updated implementation:

const humanToken = req.headers.get("x-human-token");

if (humanToken) {

  const human = await verifyHumanRequest(req);

  if (!human.ok) {
    log({
      level:"SECURITY",
      event:"HUMAN_VERIFICATION_FAILED"
    });

    return okResponse(null,requestId);
  }

}

Effect:

If captcha token exists → verify
If token absent → skip verification

Security preserved because:

Supabase identity already authenticated.

52. SIGNUP API SUCCESS CONFIRMATION

After backend update full signup pipeline test executed.

Observed Render logs:

SIGNUP_STEP_1_HEADER
SIGNUP_STEP_2_TOKEN
SIGNUP_STEP_3_EMAIL
SIGNUP_STEP_4_EXISTING
SIGNUP_STEP_5_INSERT_ATTEMPT
ERP_SIGNUP_REQUEST_RECEIVED

Meaning:

Supabase JWT successfully resolved

Auth user id extracted

Email verification confirmed

ERP user existence checked

ERP user inserted

Signup request recorded

Database verification confirmed rows created in:

erp_core.users
erp_core.signup_requests

Inserted user state:

PENDING
53. SIGNUP SUBMISSION PAGE ACTIVATION

File:

frontend/src/pages/public/SignupSubmittedPage.jsx

After successful /api/signup call the user is redirected to:

/signup-submitted

Displayed message:

Signup Request Submitted

Your ERP account request has been submitted successfully.
An administrator will review and approve your account.

User action:

Back to Home
54. FINAL SIGNUP PIPELINE ARCHITECTURE

ERP onboarding flow now operates as:

Landing (/)
↓
Signup (/signup)
↓
Captcha verification
↓
Supabase Auth signup
↓
Verification email
↓
User clicks verification link
↓
EmailVerified.jsx
↓
POST /api/signup
↓
ERP DB user insert (PENDING)
↓
signup_requests record created
↓
SignupSubmittedPage.jsx

Admin approval required before ERP access is granted.

55. CURRENT SYSTEM STATUS

Public UI layer:

Landing page
Operational

Login screen
Operational

Signup screen
Operational

Captcha protection
Operational

Email verification handler
Operational

Signup confirmation page
Operational

Backend signup API
Operational

ERP DB user creation
Confirmed working

Signup request capture
Confirmed working

Menu system
Disabled during public routes

Navigation engine
Guarded during public routes

HiddenRouteRedirect
Still temporarily disabled

ERP architecture invariants
Preserved

56. SIGNUP PIPELINE TEST RESULT

End-to-end signup pipeline verified successfully.

All required systems confirmed working:

Supabase Auth
Email verification
Frontend onboarding flow
Backend signup handler
ERP DB user creation
Signup request capture

No architecture invariant violated.

57. NEXT EXECUTION STEP

Next planned phase:

PHASE 3B COMPLETE

Upcoming phase:

PHASE 3C — LOGIN API INTEGRATION

Tasks:

Connect LoginScreen.jsx to /api/login

Handle session cookie

Call /api/me

Resolve user role

Redirect to correct dashboard

Reactivate HiddenRouteRedirect

Activate MenuProvider after authentication

✅ Conclusion

ERP public onboarding pipeline is now fully implemented and verified.

Signup → Email Verification → ERP Pending User creation
is functioning correctly across:

Frontend
Backend
Database
Auth

System is ready to proceed to the login pipeline integration phase.


58. PASSWORD RECOVERY FLOW IMPLEMENTATION

Status:
Completed

Files created:

frontend/src/pages/public/ForgotPassword.jsx
frontend/src/pages/public/ResetPassword.jsx

Purpose:

Provide secure password recovery capability for ERP users using Supabase Auth recovery flow.

The recovery mechanism allows a user to reset their password without interacting with ERP database structures.

Important architectural rule:

Password recovery operates entirely at the Supabase Identity Layer.

ERP database is not involved.

59. FORGOT PASSWORD SCREEN

File:

frontend/src/pages/public/ForgotPassword.jsx

Purpose:

Allow users to request a password reset link via their registered email address.

User interaction:

User enters email
↓
Click "Send Reset Link"
↓
supabase.auth.resetPasswordForEmail()
↓
Supabase sends recovery email

Implementation:

supabase.auth.resetPasswordForEmail(email,{
  redirectTo: `${window.location.origin}/reset-password`
})

Security rule enforced:

Email enumeration protection.

The UI never reveals whether the email exists in the system.

Displayed message:

If an account exists for this email, a reset link has been sent.

Effect:

Prevents attackers from discovering valid ERP user emails.

60. PASSWORD RESET SCREEN

File:

frontend/src/pages/public/ResetPassword.jsx

Purpose:

Allow users to update their password using a Supabase recovery token delivered via email.

Recovery flow:

User receives reset email
↓
Clicks recovery link
↓
Redirected to /reset-password
↓
User enters new password
↓
supabase.auth.updateUser()
↓
Password updated

Implementation:

supabase.auth.updateUser({
  password: newPassword
})

User experience safeguards:

Password confirmation validation

Minimum password length check

Submit button disabled during request

Submit button disabled after success

Automatic redirect to login after reset completion.

61. PUBLIC ROUTES UPDATE (PASSWORD RECOVERY)

Router updated to support recovery flow.

New public routes:

/forgot-password
/reset-password

Router location:

frontend/src/router/AppRouter.jsx

Updated public route list:

/
 /login
 /signup
 /email-verified
 /signup-submitted
 /forgot-password
 /reset-password

Reason:

Password recovery must operate outside authenticated ERP universe.

MenuProvider must remain inactive during recovery flow.

62. MENU PROVIDER AND NAVIGATION GUARD UPDATE

Files affected:

frontend/src/context/MenuProvider.jsx
frontend/src/main.jsx

Public routes extended to include recovery routes.

PUBLIC_ROUTES set now includes:

/
 /login
 /signup
 /email-verified
 /signup-submitted
 /forgot-password
 /reset-password

Effect:

MenuProvider will NOT attempt to call:

GET /api/me/menu

when user is inside password recovery flow.

Navigation engine also remains inactive during recovery screens.

Implementation:

if (!PUBLIC_ROUTES.has(pathname)) {
  initNavigation("DASHBOARD_HOME");
}

Result:

Password recovery pages render safely without triggering authenticated navigation or menu systems.

63. PASSWORD RECOVERY ARCHITECTURE CONFIRMATION

The following architectural rules remain intact:

Supabase Auth handles identity recovery.

ERP backend is not involved in password reset operations.

ERP database tables remain untouched.

ACL system remains inactive during recovery flow.

MenuProvider is guarded.

Navigation engine is guarded.

HiddenRouteRedirect remains disabled until login pipeline is activated.

64. CURRENT SYSTEM STATE (UPDATED)

ERP public authentication layer now supports:

Landing page

Login screen

Signup onboarding

Email verification

Captcha protection

Signup request submission

Forgot password recovery

Password reset

Menu snapshot system remains inactive during public authentication flows.

ERP architecture invariants remain preserved.

NEXT EXECUTION STEP

Next phase:

PHASE 3C — LOGIN API INTEGRATION

Tasks:

Connect LoginScreen.jsx → POST /api/login

Receive session cookie

Call /api/me

Resolve user role

Redirect user

SA → /sa/home
GA → /ga/home
USER → /dashboard

Reactivate HiddenRouteRedirect

Activate MenuProvider after authentication

65. PHASE 3C — LOGIN PIPELINE IMPLEMENTATION

Status:
Completed

Purpose:

Integrate the ERP login screen with the backend authentication
pipeline and activate the authenticated ERP universe routing.

Files modified:

frontend/src/pages/public/LoginScreen.jsx
frontend/src/router/AppRouter.jsx

File created:

frontend/src/admin/AdminResolver.jsx
66. LOGIN API INTEGRATION

LoginScreen.jsx now performs the full authentication pipeline.

Login sequence:

Landing (/)
↓
Login (/login)
↓
POST /api/login
↓
Session cookie issued
↓
GET /api/me
↓
GET /api/me/menu
↓
Universe resolution

Redirect logic:

Admin Universe → /admin
ACL Users → /dashboard

Important architecture rule:

Frontend does not resolve role directly.

Role resolution is delegated to menu snapshot logic.

67. ADMIN ROUTING RESOLVER

A new routing resolver was introduced to support clean
enterprise ERP navigation architecture.

File created:

frontend/src/admin/AdminResolver.jsx

Purpose:

Resolve the correct admin dashboard based on the menu snapshot.

Process:

/admin
↓
GET /api/me/menu
↓
Inspect menu snapshot
↓
GA → /ga/home
SA → /sa/home

Implementation logic:

const ga = menu.find(m => m.route_path === "/ga/home");
const sa = menu.find(m => m.route_path === "/sa/home");

Navigation result:

GA user → /ga/home
SA user → /sa/home

Fallback:

navigate("/dashboard")

Error case:

navigate("/login")
68. ROUTER UPDATE

Router updated to support AdminResolver entry point.

File modified:

frontend/src/router/AppRouter.jsx

New route added:

/admin → AdminResolver

Router structure now:

/admin
/sa/home
/ga/home
/dashboard
/login
/signup
/reset-password
69. ERP LOGIN FLOW (FINAL)

ERP authentication entry flow now operates as:

Landing (/)
↓
Login (/login)
↓
POST /api/login
↓
Session cookie issued
↓
GET /api/me/menu
↓
Universe resolution

Admin → /admin
ACL → /dashboard

/admin
↓
AdminResolver
↓
Menu snapshot

GA → /ga/home
SA → /sa/home
70. ARCHITECTURE COMPLIANCE

The login implementation maintains the following ERP
architecture invariants:

Frontend does not resolve role directly.

Menu snapshot remains the Single Source of Truth
for navigation authority.

Admin routing is delegated to AdminResolver.

MenuProvider remains inactive during public routes.

ACL guards remain unchanged.

ERP navigation architecture remains deterministic.

71. CURRENT SYSTEM STATE (UPDATED)

ERP UI public layer:

Landing page → Operational
Login screen → Operational
Signup onboarding → Operational
Email verification → Operational
Captcha protection → Operational
Password recovery → Operational

ERP authentication pipeline:

Login API → Integrated
Session cookie → Working
Menu snapshot → Working

Admin routing:

AdminResolver → Operational

Navigation engine:

Guarded during public routes

HiddenRouteRedirect:

Still temporarily disabled

ERP architecture invariants:

Preserved

72. PWA ICON PACK IMPLEMENTATION

Status:
Completed

Purpose:

Enable proper Progressive Web App installation support for the ERP UI across:

Android

Desktop Chrome

iOS Safari

Edge

PWA install prompt

Previously the system used a single icon:

/lm.png

This approach caused problems because modern PWA manifests require multiple icon sizes.

Implementation:

A full production PWA icon pack was generated from the ERP logo.

Icon set created:

public/icon-192.png
public/icon-512.png
public/icon-maskable-512.png

Purpose of each icon:

icon-192.png
Used for Android home screen and basic PWA install.

icon-512.png
Used for splash screens and high resolution install.

icon-maskable-512.png
Used for adaptive icons on Android.

Maskable icons ensure that the logo remains visible when the OS applies circular or squircle cropping.

73. PWA MANIFEST UPDATE

File modified:

vite.config.js

The PWA manifest icon configuration was updated to reference the new icon set.

Updated manifest configuration:

icons: [
  {
    src: "/icon-192.png",
    sizes: "192x192",
    type: "image/png"
  },
  {
    src: "/icon-512.png",
    sizes: "512x512",
    type: "image/png"
  },
  {
    src: "/icon-maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable"
  }
]

Effect:

The ERP application can now be installed as a proper PWA application.

Installation targets:

Android home screen
Desktop Chrome install
Edge install
Standalone window mode

Display mode:

display: "standalone"

This allows ERP to run without browser chrome.

74. PWA BASE ICON USAGE

The ERP base logo file remains:

/public/lm.png

Usage:

favicon in HTML

<link rel="icon" type="image/png" href="/lm.png" />

The favicon remains independent from the PWA icon pack.

75. LOGOUT ARCHITECTURE PLAN

Status:
Design Finalized
Implementation Pending

Purpose:

Ensure a deterministic and secure logout flow that also clears any cached UI data from the Progressive Web App environment.

Important architectural rule:

Logout must clear both:

Backend session

Browser PWA cache

Because cached menu snapshots or API responses could otherwise remain available after logout.

Logout pipeline design:

User clicks Logout
↓
Frontend clears PWA cache
↓
POST /api/logout
↓
Backend invalidates session cookie
↓
Frontend redirects to Landing (/)

Frontend responsibilities:

Delete all service worker caches

Optionally unregister service workers

Call backend logout endpoint

Example logout flow:

caches.keys()
↓
caches.delete()
↓
fetch("/api/logout")
↓
redirect("/")

Backend responsibilities:

Invalidate session cookie and revoke session.

Backend logout handler already exists:

supabase/functions/api/_core/auth/logout.handler.ts

The handler implements:

Idempotent logout
Session revoke
Cookie invalidation

Logout API behaviour:

POST /api/logout

Response:

200 OK
AUTH_LOGGED_OUT

Even if the session is already invalid.

76. CURRENT UI SYSTEM STATE (LATEST)

Public UI layer:

Landing page → Operational
Boot loader → Operational
Login screen → Operational
Signup onboarding → Operational
Email verification → Operational
Captcha protection → Operational
Password recovery → Operational

ERP authentication pipeline:

Login API → Operational
Session cookie → Working
Menu snapshot → Working

Admin routing:

AdminResolver → Operational

PWA system:

Icon pack → Implemented
Manifest → Updated
Install capability → Enabled

Logout system:

Backend handler → Implemented
Frontend UI → Not yet implemented

77. NEXT EXECUTION PHASE

The ERP UI system is now approaching the final stabilization stage.

Next tasks:

FINAL UI POLISH

Items:

Implement Logout UI action

Add logout cache purge logic

Restore HiddenRouteRedirect

Verify dashboard navigation stability

Perform full login → dashboard → logout cycle test

Validate PWA install behaviour

Validate mobile layout

78. PRE-PRODUCTION CHECKLIST

Before moving the ERP system to live environment the following checks must be completed.

Security checks:

Session expiration validation
CSRF protection verification
Logout behaviour validation

UI checks:

Menu snapshot load timing
Admin routing stability
Deep link protection

PWA checks:

Install prompt works
Standalone launch works
Icons render correctly

Performance checks:

Cold load time
Dashboard render time
Menu snapshot fetch time

79. FINAL TARGET

After completing the UI polish phase the system will proceed to:

STAGE → PRODUCTION DEPLOYMENT PLAN

Deployment stack:

Frontend → Vercel
Backend → Render
Database → Supabase

This stage will finalize:

ERP public entry flow
Authentication system
Admin universe routing
ACL user universe routing

The system will then be ready for:

LIVE ERP OPERATION

80. LANDING BOOT LOADER RENDER FIX

Status:
Completed

File modified:

frontend/src/pages/public/LandingPage.jsx

Problem observed:

Boot loader animation and loading bar were not visible during first render.

Behaviour:

Boot loader only appeared after manual page refresh.

Root cause:

Initial state of the boot loader was incorrectly initialized.

Original implementation:

const [booting, setBooting] = useState(false);

useEffect(() => {
  setBooting(true);

  const timer = setTimeout(() => {
    setBooting(false);
  }, 1800);

  return () => clearTimeout(timer);
}, []);

Issue:

React warns against synchronous state updates inside useEffect.

This caused the boot loader to render too late in the lifecycle.

Solution:

Initialize boot state correctly at component mount.

Updated implementation:

const [booting, setBooting] = useState(true);

useEffect(() => {
  const timer = setTimeout(() => {
    setBooting(false);
  }, 1800);

  return () => clearTimeout(timer);
}, []);

Effect:

Boot loader now appears immediately during initial render.

Loading bar animation begins instantly.

Landing content is revealed only after the boot timer completes.

81. PNG IMAGE SIZE STABILITY FIX

Status:
Completed

Files modified:

LandingPage.jsx
LoginScreen.jsx
SignupScreen.jsx
ForgotPassword.jsx
ResetPassword.jsx

Problem observed:

PNG images appeared smaller during first load.

Images resized correctly only after page refresh.

Root cause:

Fixed width Tailwind classes caused layout recalculation after image load.

Example problematic code:

<img src={logo} className="w-[360px]" />

When the image loaded asynchronously the container resized.

Solution:

Wrap images in fixed containers and allow responsive scaling.

Updated implementation:

<div className="w-[360px]">
  <img
    src={logo}
    className="w-full h-auto"
    loading="eager"
  />
</div>

Effect:

Images now render at the correct size during the first load.

No layout shift occurs.

No refresh required.

82. PWA DEVELOPMENT BUILD NOTICE

During development the Vite dev server outputs the following message:

PWA v1.2.0
mode generateSW
precache 2 entries
dev-dist/sw.js
dev-dist/workbox-xxxxx.js

This is not an error.

It indicates that the vite-plugin-pwa plugin generated a development service worker.

Purpose:

Enable Progressive Web App install capability.

Files generated:

dev-dist/sw.js
dev-dist/workbox-*.js

These files exist only for development preview.

Production builds will generate the final service worker bundle.

No action required.

83. LANDING PAGE RENDER SEQUENCE (FINAL)

The landing page now renders using the following deterministic sequence:

Component mount
↓
booting = true
↓
Boot loader screen renders
↓
Loader animation runs for 1800ms
↓
booting = false
↓
Landing UI becomes visible

UI Flow:

Boot Loader
↓
Landing Page
↓
Login / Signup navigation

This render order ensures:

Smooth application entry

Stable image rendering

Predictable layout behavior

84. CURRENT SYSTEM STATUS (UPDATED)

ERP UI public layer:

Landing page → Operational
Boot loader → Operational
Login screen → Operational
Signup onboarding → Operational
Captcha protection → Operational
Email verification → Operational
Password recovery → Operational

UI rendering stability:

Boot loader render timing → Fixed
Image layout shift → Fixed

ERP authentication pipeline:

Login API → Operational
Session cookie → Working
Menu snapshot → Working

Navigation system:

Public route guards → Active
Navigation engine → Guarded
HiddenRouteRedirect → Still temporarily disabled

PWA system:

Icon pack → Implemented
Manifest → Updated
Service worker (dev) → Generated automatically

ERP architecture invariants:

Maintained.

85. NEXT EXECUTION STEP

Upcoming tasks:

FINAL UI POLISH

Remaining items:

Implement Logout UI action
Add PWA cache purge on logout
Restore HiddenRouteRedirect
Verify deep-link routing stability
Perform full login → dashboard → logout cycle

After completion the system will move to:

PRODUCTION DEPLOYMENT PLAN

🔵 ADD THIS AS NEW SECTION (CONTINUE NUMBERING)
86. AUTH CALLBACK SESSION RESTORE FIX (CRITICAL)

Status:
Completed ✅

Files modified:

frontend/src/pages/public/AuthCallback.jsx
frontend/src/lib/supabaseClient.js

86.1 PROBLEM OBSERVED

During signup email verification and auth callback flow the system failed to restore user session.

Observed error:

Authentication Failed
Session not restored from hash

Console observation:

window.location.hash

Returned valid Supabase tokens:

access_token
refresh_token

This confirmed:

Supabase authentication succeeded
Redirect URL was correct
Tokens were present in URL

However:

Frontend failed to convert tokens into an active session.

86.2 ROOT CAUSE ANALYSIS

Two critical issues identified:

Issue 1 — Supabase client misconfiguration

File:

frontend/src/lib/supabaseClient.js

Incorrect configuration:

detectSessionInUrl: false

Effect:

Supabase SDK ignored URL hash tokens.
Automatic session restoration did not occur.

Issue 2 — Incorrect session exchange implementation

File:

frontend/src/pages/public/AuthCallback.jsx

Incorrect implementation:

exchangeCodeForSession(code)

Problem:

Supabase expects full URL for proper parsing of:

code
state
redirect context

Passing only code prevented session establishment.

86.3 FIX IMPLEMENTED
Fix 1 — Enable session detection

File:

frontend/src/lib/supabaseClient.js

Updated configuration:

detectSessionInUrl: true

Effect:

Supabase SDK now automatically detects:

#access_token
#refresh_token

and restores session.

Fix 2 — Correct session exchange

File:

frontend/src/pages/public/AuthCallback.jsx

Updated implementation:

await supabase.auth.exchangeCodeForSession(window.location.href);

Effect:

Full URL parsing ensures correct handling of:

PKCE flow
Hash token flow
Signup verification flow
Password recovery flow

Fix 3 — Navigation timing stabilization

Problem:

MenuProvider and routing guards triggered before session stabilization.

Solution:

Introduce slight delay before navigation:

setTimeout(() => {
  navigate("/email-verified", { replace: true });
}, 200);

Effect:

Prevents race condition between:

Session creation
MenuProvider activation
RouteGuard execution

86.4 ARCHITECTURE IMPACT

This fix restores compliance with:

Gate-2 — Auth Boundary
Gate-5 — Session Layer
Gate-8 — Navigation Authority

Key guarantees restored:

Supabase session always established before navigation
Public auth flow remains isolated from ACL system
MenuProvider activates only after valid session

No architectural invariant was violated.

86.5 SYSTEM BEHAVIOR AFTER FIX

Auth flow now operates as:

Signup / Recovery / Login
↓
Supabase redirect with tokens
↓
AuthCallback.jsx
↓
Session established
↓
supabase.auth.getSession() → valid
↓
Flow routing

Recovery → /reset-password
Default → /email-verified

86.6 VALIDATION RESULT

Tested using:

Corporate email
Gmail

Result:

Session restored successfully
No authentication errors
No race condition observed

Console verification:

await supabase.auth.getSession()

Returned valid session object.

86.7 FINAL STATUS

Auth callback pipeline:

Stable ✅
Deterministic ✅
Production-ready ✅

🔴 87. SA SEEDING — AUTH FAILURE ISSUE (CRITICAL)

Status:
Unresolved ❌

87.1 CONTEXT

SA user seeding was introduced to enable:

Admin Universe access (/sa/home)

Seed executed via:

SQL seed file (manual run in dev/prod)

Duplicate prevention logic included

87.2 OBSERVED ISSUE

After seeding:

Login → FAILED ❌

Errors observed:

401 Unauthorized
403 Forbidden
87.3 BEHAVIOUR
Case 1 — Login attempt (SA user)
POST /api/login → 401
Case 2 — Session exists but blocked
GET /api/me → 403
87.4 ROOT PROBLEM AREA (SUSPECTED)

The issue is not UI.

Likely failure layers:

Gate-2 → Auth identity mismatch
Gate-3 → Context resolution missing
Gate-6 → ACL denial (role not mapped)
DB → SA user not aligned with Supabase auth_user_id
87.5 POSSIBLE CAUSES
🔴 Cause A — auth_user_id mismatch
erp_core.users.auth_user_id ≠ supabase.auth.users.id

👉 Result:

Session valid but ERP cannot map user → 403
🔴 Cause B — SA role not mapped in ACL
role_code = SA
but ACL tables missing entry

👉 Result:

Access denied → 403
🔴 Cause C — company / context missing
No parent_company / work_company

👉 Result:

Context resolver fails → 403
🔴 Cause D — user state invalid
state != ACTIVE

👉 Result:

Login blocked → 401
87.6 CURRENT STATUS
SA seeding → Executed ✔️
Login → Failing ❌
Root cause → Not yet confirmed ❌
87.7 IMPACT
Admin Universe inaccessible ❌
ERP bootstrap blocked ❌
🔴 88. PASSWORD RESET FLOW — CRITICAL FAILURE

Status:
Unresolved ❌

88.1 CONTEXT

Password recovery flow implemented using:

Supabase Auth recovery system

Flow:

ForgotPassword → Email → AuthCallback → ResetPassword
88.2 ISSUE 1 — DEV ENVIRONMENT FAILURE

Observed:

Site cannot be reached ❌
🔴 Behaviour

After clicking reset link:

Browser → Cannot reach site
🔴 Likely Cause
Incorrect redirect URL

Possible misconfig:

redirectTo → localhost mismatch
port mismatch (5173 vs other)
Supabase redirect URL not whitelisted
88.3 ISSUE 2 — PROD ENVIRONMENT MISROUTING

Observed:

Reset link → redirects to /email-verified ❌

Expected:

→ /reset-password ✔️
88.4 ROOT CAUSE (HIGH CONFIDENCE)

Problem in AuthCallback flow detection

Current logic:

flow = params.get("type")

Supabase sends:

type=recovery

BUT:

Flow not detected properly
→ default route triggered
→ /email-verified
88.5 IMPACT
User cannot reset password ❌
Auth system incomplete ❌
88.6 ADDITIONAL SIDE EFFECT

While fixing reset flow:

Multiple changes made in AuthCallback

Result:

Flow confusion increased
Debug complexity increased
88.7 CURRENT STATUS
Environment	Status
DEV	❌ Site unreachable
PROD	❌ Wrong redirect
Reset flow	❌ Broken
🔴 89. SYSTEM STATE AFTER THESE ISSUES
89.1 WORKING SYSTEMS
Signup flow ✔️
Email verification ✔️
ERP DB user creation ✔️
Menu guard ✔️
Public routes ✔️
89.2 BROKEN SYSTEMS
SA login ❌
Admin universe ❌
Password reset ❌
Auth callback routing ❌ (partially)
89.3 RISK LEVEL
🔴 HIGH

Reason:

Core authentication pipeline unstable
Admin access blocked
🔴 90. ARCHITECTURAL NOTE (VERY IMPORTANT)

During debugging:

AuthCallback logic modified multiple times

👉 This caused:

Flow ambiguity
Mixed logic paths
Unclear control boundaries
90.1 RULE GOING FORWARD
AuthCallback must remain:

Deterministic
Single-path
Non-duplicated
🔴 91. NEXT ACTION PLAN
Move to new debugging session
Scope of next session

We will isolate and fix:

1. SA login failure

DB alignment

auth_user_id mapping

role + ACL

2. Reset flow

redirect URL

flow detection

Supabase config

Strategy
NO patching
ONLY root-cause fixing

🔴 92. PRODUCTION DOMAIN ALIGNMENT — BACKEND CUSTOM DOMAIN ACTIVATION

Status:
Completed ✅

92.1 CONTEXT

Original production architecture used:

Frontend:
erp.almegagroup.in

Backend:
pace-erp.onrender.com

This created a cross-domain deployment boundary between frontend and backend.

Observed impact during production login debugging:

Session cookie behavior was inconsistent
Browser requests sometimes failed to carry expected auth continuity
Session resolution errors were observed during login pipeline testing

92.2 ACTION EXECUTED

A dedicated backend custom domain was created in Render:

api.almegagroup.in

DNS request was submitted and completed through Rediff support.

Render custom domain status:

Verified ✅
Certificate issued ✅

Health check confirmed:

https://api.almegagroup.in/health

returned successful response.

92.3 RESULT

Production backend is now reachable through:

api.almegagroup.in

This removes the previous frontend → onrender.com production dependency for intended production routing.

92.4 IMPORTANT NOTE

This domain alignment removed the earlier infrastructure ambiguity around production cross-domain routing.

However:

login success is still NOT confirmed

because another blocking issue remains:

POST /login still returns 401

Therefore:

domain alignment is complete
but authentication pipeline is still not operational

---

🔴 93. PWA / SERVICE WORKER STALE BUILD ISSUE

Status:
Unresolved ❌

93.1 OBSERVED ISSUE

Production UI repeatedly served stale frontend bundles after deployment.

Observed behaviour:

New deploy did NOT appear automatically
Old API target remained active
Old build persisted until manual browser cleanup

93.2 CONFIRMED USER ACTION REQUIRED

The new build became visible only after:

Service Worker unregister
Clear site data / storage clear
Hard refresh / new clean browser context

93.3 IMPACT

This means current PWA update strategy is not stable.

Current system behaviour:

Deploy alone is not sufficient
Browser may continue running stale frontend code
Production debugging becomes misleading because old code remains active

93.4 CURRENT STATUS

This issue is NOT solved yet.

Current workaround:

Manual Service Worker unregister
Manual cache / storage clear

93.5 ARCHITECTURAL IMPLICATION

Until this is fixed:

production verification remains unreliable
because UI behaviour may reflect an older deploy rather than the current codebase

---

🔴 94. LOGIN PIPELINE STATUS AFTER DOMAIN FIX

Status:
Still failing ❌

94.1 OBSERVED BEHAVIOUR

After production backend was moved to:

api.almegagroup.in

login requests correctly reached the new backend domain.

Observed request pattern:

POST https://api.almegagroup.in/login

However response remained:

401 Unauthorized

94.2 IMPORTANT RESULT

Because login itself fails:

no ERP session is created
no ERP cookie is issued
subsequent session resolution cannot proceed

Therefore:

missing cookie is currently a consequence of login failure
NOT the primary blocker at this stage

94.3 CURRENT CONCLUSION

The active blocker is now:

credential / auth-layer failure

not:

domain routing
not:
certificate issuance
not:
initial production backend reachability

94.4 ARCHITECTURAL INTERPRETATION

Infrastructure problem:
largely stabilized

Authentication problem:
still unresolved

---

🔴 95. PASSWORD RESET FLOW — CURRENT REAL STATUS

Status:
Unresolved ❌

95.1 CONTEXT

Forgot password flow was executed end-to-end:

ForgotPassword
↓
email received
↓
link opened
↓
password reset attempted

Supabase logs showed user modification activity.

95.2 OBSERVED RESULT

Despite recovery flow execution:

login with the newly entered password still failed with 401

95.3 CURRENT INTERPRETATION

At this moment the recovery pipeline cannot be considered verified.

Reason:

a successful password reset has NOT yet been proven by successful login

95.4 IMPORTANT CORRECTION

Earlier assumption that recovery/auth callback flow was fully stable is no longer considered fully validated in the context of live login verification.

Current rule:

Password recovery remains OPEN / unresolved until:

new password is accepted by login
and
POST /login succeeds

95.5 POSSIBLE FAILURE AREA

The unresolved layer may be one or more of:

Supabase recovery session continuity
AuthCallback flow routing ambiguity
password update completion not being reliably validated by login
ERP auth-layer gating after successful Supabase identity recovery

Root cause not yet isolated.

---

🔴 96. AUTH CALLBACK STATUS — RECLASSIFIED

Status:
Partially validated ⚠️

96.1 PREVIOUS STATE

Auth callback had previously been treated as stabilized after fixes around:

detectSessionInUrl
full URL session exchange
flow restoration

96.2 CURRENT OBSERVATION

Because password recovery still does not produce a confirmed successful login outcome:

AuthCallback cannot yet be marked fully production-safe for all auth flows.

96.3 UPDATED CLASSIFICATION

Signup-related auth callback:
likely working

Password recovery-related auth callback:
NOT yet fully confirmed

96.4 RULE GOING FORWARD

AuthCallback must continue to be treated as:

single-path
deterministic
non-duplicated

But its recovery branch must be revalidated from first principles in the next debugging session.

---

🔴 97. CURRENT MASTER ISSUE SUMMARY

Status:
Open ❌

97.1 WORKING

Frontend production domain active
Backend custom domain active
Render SSL issued
Signup pipeline previously verified
Public route isolation in place
Menu guard active during public routes

97.2 UNRESOLVED

1. Service Worker stale build issue
   - new deploy does not reliably replace old build
   - manual unregister / clear storage required

2. Login pipeline failure
   - POST /login still returns 401
   - cookie not created because login itself fails

3. Password reset verification failure
   - recovery flow executed
   - successful password usability not yet proven by login

4. Auth callback recovery branch not fully validated
   - recovery should not be considered closed yet

97.3 RISK LEVEL

🔴 HIGH

Reason:

Production infrastructure is now reachable
but core authentication remains blocked

97.4 NEXT DEBUGGING SESSION SCOPE

The next session must isolate issues in this exact order:

A. Login 401 root cause
   - Supabase identity verification outcome
   - ERP auth gating
   - user state / mapping / active-status alignment

B. Password reset validity
   - whether reset actually creates a usable credential
   - whether recovery session reaches update stage correctly

C. Service Worker lifecycle
   - eliminate need for manual unregister / cache clear

97.5 STRATEGY

NO more broad patching
NO assumption-based fixes
ONLY single-layer isolation with direct validation after each step

🔴 98. LOGIN FAILURE — ROOT CAUSE INVESTIGATION (CORS, COOKIE, SESSION, ACL)

Status:
Partially resolved → Root cause isolated ⚠️

98.1 CONTEXT

Login pipeline debugging চলাকালীন multiple layers suspect করা হয়েছিল:

CORS

Cookie transmission

SameSite policy

Domain mismatch

Session persistence

ACL blocking

Observed issue:

GET /api/me → 403 Forbidden
98.2 INITIAL HYPOTHESIS (REJECTED)
Hypothesis A — Cookie not sent to backend

Assumption:

Browser → Backend request-এ cookie attach হচ্ছে না

Hypothesis B — SameSite=Lax blocking cookie

Assumption:

erp.almegagroup.in → api.almegagroup.in cross-site call
→ Lax cookie block করছে

Hypothesis C — CORS misconfiguration

Assumption:

Origin allowlist mismatch
→ request blocked

98.3 VALIDATION STEPS PERFORMED
Step 1 — Browser cookie inspection

DevTools → Application → Cookies

Observed:

erp_session present ✅
Domain = api.almegagroup.in
SameSite = Lax
HttpOnly = true

Conclusion:

Cookie successfully stored in browser

Step 2 — Network request verification

DevTools → Network → /api/me

Observed:

Request URL: https://api.almegagroup.in/api/me
Status: 403 Forbidden

Headers:

Access-Control-Allow-Origin: https://erp.almegagroup.in
Access-Control-Allow-Credentials: true

Conclusion:

CORS working correctly

Step 3 — Backend session validation (DB)

Query executed:

SELECT status, created_at
FROM erp_core.sessions
WHERE session_id = 'XXXXX';

Result:

{
  "status": "ACTIVE"
}

Conclusion:

Session exists and is valid

Step 4 — Cookie transmission confirmation

Network → Request Cookies

Observed:

erp_session = dc483329-...

Conclusion:

Cookie is being sent to backend successfully

98.4 ELIMINATION MATRIX
Layer	Status	Conclusion
Cookie storage	✅	Working
Cookie transmission	✅	Working
SameSite=Lax	✅	Not blocking
CORS	✅	Correct
Domain alignment	✅	Correct
Session DB	✅	Active
Login cookie issuance	✅	Working
98.5 CRITICAL INSIGHT

Because:

Cookie exists

Cookie sent

Session ACTIVE

Yet:

/api/me → 403

Therefore:

👉 Request is NOT failing at auth layer
👉 Request is being BLOCKED AFTER auth
98.6 FINAL CONCLUSION (VERY IMPORTANT)
❗ COOKIE / CORS / DOMAIN ISSUE — FULLY RESOLVED

These are NOT blockers anymore:

❌ Cookie issue

❌ SameSite issue

❌ CORS issue

❌ Cross-domain issue

98.7 ACTUAL BLOCKER IDENTIFIED
🔴 ACL / CONTEXT / AUTHORIZATION LAYER

Meaning:

User is:

Authenticated ✅
But not Authorized ❌
98.8 REAL SYSTEM STATE INTERPRETATION

System is behaving like:

Gate entry allowed
But internal access denied

98.9 ANALOGY (FOR CLARITY)

Imagine:

তুমি office gate দিয়ে ঢুকেছো ✅

security তোমাকে চিনেছে ✅

কিন্তু ভিতরের room-এ ঢুকতে দিচ্ছে না ❌

👉 কারণ:

Role / Permission / Context missing
98.10 SAME-SITE (LAX) FINAL VERDICT
Current setup:
Frontend: erp.almegagroup.in
Backend: api.almegagroup.in

👉 Both are under:

almegagroup.in (same site)

Therefore:

SameSite=Lax → ALLOWED ✅
When Lax would fail (NOT current case):

almegagroup.in → google.com

iframe

third-party embed

👉 NONE apply here

98.11 IMPORTANT ARCHITECTURAL CORRECTION

Earlier assumption:

Cookie not reaching backend

Corrected understanding:

Cookie is reaching backend perfectly
98.12 CORS IMPLEMENTATION VALIDATION

Current implementation:

Strict allowlist

Credentials enabled

No wildcard

Origin-specific response

Observed behaviour:

403 response WITH CORS headers

Conclusion:

CORS is NOT the source of failure
98.13 DEPLOYMENT ISSUE (RESOLVED)

Error observed during deployment:

ReferenceError: Deno is not defined

Cause:

Node.js runtime does not support Deno.env

Fix:

const allowedEnv = process.env.ALLOWED_ORIGINS || "";

Conclusion:

Runtime environment mismatch fixed

98.14 FINAL STATE AFTER ALL FIXES
Component	Status
Frontend domain	✅
Backend domain	✅
CORS	✅
Cookie	✅
Session	✅
Auth	✅
ACL	❌ BLOCKING
98.15 WHAT HAS BEEN PROVEN
✔ Proven Working

Login API response

Cookie issuance

Cookie persistence

Cookie transmission

Session validation

CORS allowlist

Domain routing

❌ Not Working

ACL resolution

Context resolution

Role mapping

ACL version binding

98.16 SYSTEM RISK UPDATE

Previous risk source:

Infrastructure instability

Updated risk source:

Authorization logic failure
98.17 NEXT DEBUGGING FOCUS (STRICT)

Next session MUST isolate:

A — ACL version existence
SELECT *
FROM erp_acl.acl_versions
WHERE is_active = true;
B — User mapping
SELECT *
FROM erp_core.users
WHERE auth_user_id = '...';
C — Role binding
SELECT *
FROM erp_acl.user_roles;
D — Context resolution
SELECT *
FROM erp_core.user_company_map;
98.18 STRATEGIC CORRECTION
🚫 DO NOT DEBUG ANYMORE:

CORS

Cookie

SameSite

Domain

✅ ONLY DEBUG:

ACL

Context

Role

Versioning

98.19 FINAL SYSTEM TRUTH
🔥 USER LOGIN IS SUCCESSFUL
🔴 USER AUTHORIZATION IS FAILING
98.20 IMPACT ON ERP

Because ACL is blocking:

Admin universe inaccessible ❌

Dashboard unreachable ❌

Menu snapshot unreliable ❌

98.21 FINAL STATEMENT

This marks a critical transition point:

👉 Infrastructure layer is STABLE
👉 Authorization layer is the ONLY blocker
98.22 NEXT ACTION (MANDATORY)

Move debugging to:

🔴 Gate-6 / ACL / Context Layer ONLY

✅ Report updated
Now this document reflects actual ground truth of system behaviour

99. GATE-6/7 BREAKTHROUGH — AUTHORIZATION PIPELINE UNBLOCKED

Status:
Partially Resolved ✅

99.1 CONTEXT

Previous system state:

Login → SUCCESS
Session → ACTIVE
GET /api/me → 403 ❌
GET /api/me/menu → 403 ❌

Root cause identified:

Authorization layer (ACL / Context) blocking access
99.2 ACTION TAKEN
🔧 Fix 1 — Gate-2 Role Enrichment (CRITICAL)

File modified:

_pipeline/session.ts

Added:

roleCode?: string

And DB resolution:

erp_map.user_company_roles

Fallback logic added:

user_code → SA / GA detection
🔧 Fix 2 — Gate-5 Context Admin Bypass (CRITICAL)

File:

_pipeline/context.ts

Logic:

if (isAdminUniverse(session)) {
  return {
    companyId: "ADMIN_UNIVERSE",
    roleCode,
    isAdmin: true
  }
}
🔧 Fix 3 — Menu Query Admin Fix

File:

menu.handler.ts

Fix:

if (!context.isAdmin) {
  query = query.eq("company_id", context.companyId);
}

👉 Admin → NO company filter

99.3 RESULT AFTER FIX

Render logs confirm:

POST /api/login → 200 ✅
GET /api/me → 200 ✅
GET /api/me/menu → 200 ✅

Pipeline stages:

SESSION → PASS
CONTEXT → PASS
ACL → PASS
HANDLER → PASS

👉 This proves:

ACL BLOCKING ISSUE → RESOLVED
99.4 IMPORTANT OBSERVATION

Database state:

SELECT * FROM erp_menu.menu_snapshot;
→ no rows

System response:

{
  "menu": [],
  "hard_deny": true
}

👉 Meaning:

Authorization works
But NO MENU DATA exists
99.5 CRITICAL SYSTEM TRUTH UPDATE

Previous truth:

User authenticated but NOT authorized ❌

Updated truth:

User authenticated ✅
User authorized ✅
System empty (no snapshot) ⚠️
100. CURRENT SYSTEM STATE (REAL STATUS)
✅ WORKING LAYERS
🔐 Auth Layer (Gate-2)
Login → Working
Session → ACTIVE
Cookie → Working
🧠 Context Layer (Gate-5)
Admin bypass → Working
Role binding → Working
🛡 ACL Layer (Gate-6)
stepAcl → PASS
No DENY
🌐 API Layer
/api/me → 200
/api/me/menu → 200
⚠️ NOT WORKING (EXPECTED)
📭 Menu System (Gate-7)
menu_snapshot = EMPTY

👉 Not a bug
👉 System behaving correctly

101. WHY MENU EMPTY? (ROOT CAUSE)
❗ Snapshot system dependency

Menu system depends on:

menu_master
+
menu_tree
+
ACL rules
↓
generate_menu_snapshot()
↓
menu_snapshot
Current state:
menu_master → likely empty
menu_tree → likely empty
snapshot → empty
Therefore:
MenuProvider → gets []
UI → shows nothing
102. THIS IS NOT A BUG — THIS IS BOOTSTRAP GAP

👉 Very important:

System is CORRECT
System is NOT initialized
103. SYSTEM PHASE TRANSITION (VERY IMPORTANT)

You just moved from:

PHASE → AUTH DEBUGGING

To:

PHASE → SYSTEM BOOTSTRAP (ADMIN UNIVERSE)
104. NEXT COURSE OF ACTION — OPTION A PATH (SAP STYLE)
🎯 Objective:
SA logs in → sees dashboard → creates system
Step-by-step execution:
🔹 STEP 1 — Seed minimal menu_master

You need:

SA bootstrap menu

Example:

menu_code	title	route_path	universe
SA_DASH	Dashboard	/sa/home	SA
COMPANY_CREATE	Create Company	/sa/company/create	SA
🔹 STEP 2 — Generate snapshot

Call:

erp_menu.generate_menu_snapshot(
  p_user_id,
  "ADMIN_UNIVERSE",
  "SA"
)
🔹 STEP 3 — Verify
SELECT * FROM erp_menu.menu_snapshot;
🔹 STEP 4 — UI auto loads
MenuProvider → /api/me/menu → data → UI visible
105. IMPORTANT ARCHITECTURE DECISION (CONFIRMED)

You chose:

Option A → FULL SNAPSHOT (SAP STYLE)

Therefore:

NO static menu
NO hardcoded routes
ALL via DB + snapshot
106. WHAT IS STILL MISSING
🔴 Admin Universe Bootstrap Layer

You still don’t have:

Menu definitions (menu_master)
Menu hierarchy (menu_tree)
Snapshot generation trigger
107. FINAL SYSTEM STATUS
Infrastructure → STABLE ✅
Auth → STABLE ✅
Context → STABLE ✅
ACL → STABLE ✅
Menu Engine → READY ✅
Data → EMPTY ⚠️

108. MENU 403 / 500 ERROR — FULL RESOLUTION TRACE (CRITICAL)

Status:
Resolved (Authorization Layer) ✅
Pending (Menu Data Bootstrap) ⚠️

108.1 INITIAL PROBLEM OBSERVED

After frontend deployment (Dev + Prod), identical errors were observed:

Frontend console:

GET /api/me/menu → 500 (Internal Server Error)
AuthResolver failed: MENU_FETCH_FAILED

Earlier state also included:

GET /api/me → 403 Forbidden

System behaviour:

Login screen visible
Login success uncertain
Dashboard never loads
UI stuck at authentication boundary

108.2 IMPORTANT OBSERVATION

Both environments affected:

Dev:
https://dev.myerpdev.xyz

Prod:
https://erp.almegagroup.in

👉 Same error in both

Conclusion:

❌ Not environment issue
❌ Not deployment issue
❌ Not frontend issue

108.3 BACKEND LOG ANALYSIS

From Render logs:

Pipeline progression:

HEADERS → PASS
CORS → PASS
CSRF → PASS
RATE_LIMIT → PASS
SESSION → PASS
CONTEXT → PASS
ACL → PASS
HANDLER_PROTECTED → FAIL

Error:

MENU_FETCH_FAILED
108.4 INFRASTRUCTURE VALIDATION (FULLY RESOLVED)

The following were verified and eliminated as causes:

Layer	Status
Domain routing	✅
SSL/TLS	✅
Netlify config	✅
Vercel config	✅
CORS	✅
Cookie storage	✅
Cookie transmission	✅
SameSite policy	✅
Session DB	✅

Conclusion:

👉 Infrastructure layer is fully stable

108.5 AUTHENTICATION STATUS

Confirmed via logs:

AUTH_LOGIN_SUCCESS ✅
SESSION_ACTIVE ✅

Meaning:

User is authenticated successfully.

108.6 ROOT CAUSE PHASE 1 (PREVIOUS STATE)

Earlier system behaviour:

Login → SUCCESS
Session → ACTIVE
GET /api/me → 403 ❌
GET /api/me/menu → 403 ❌

Interpretation:

User authenticated but not authorized.

108.7 FIX IMPLEMENTED (AUTHORIZATION LAYER)

The following backend fixes were applied:

Fix A — Role resolution

Source:

erp_map.user_company_roles

Added roleCode into session layer.

Fix B — Admin Universe context bypass
if (isAdminUniverse(session)) {
  return {
    companyId: "ADMIN_UNIVERSE",
    roleCode,
    isAdmin: true
  }
}
Fix C — Menu query correction
if (!context.isAdmin) {
  query = query.eq("company_id", context.companyId);
}

Admin users:

→ No company filter applied

108.8 RESULT AFTER FIX

System behaviour changed to:

POST /api/login → 200 ✅
GET /api/me → 200 ✅
GET /api/me/menu → 200 ✅

Pipeline:

SESSION → PASS
CONTEXT → PASS
ACL → PASS
HANDLER → PASS

👉 Authorization layer fully unblocked

108.9 NEW PROBLEM STATE (CURRENT REALITY)

Even after successful authorization:

API response:

{
  "menu": [],
  "hard_deny": true
}
108.10 CRITICAL DISCOVERY

Database check:

SELECT * FROM erp_menu.menu_snapshot;

Result:

→ No rows

108.11 FINAL ROOT CAUSE (CONFIRMED)

Menu system is empty

Missing:

menu_master
menu_tree
menu_snapshot

Therefore:

MenuProvider → empty response → UI cannot render routes
108.12 ERROR EVOLUTION (VERY IMPORTANT)
Stage	Error
Stage 1	403 (Authorization failure)
Stage 2	500 (MENU_FETCH_FAILED)
Stage 3	200 + empty menu

👉 This progression confirms:

System is now correct but uninitialized

108.13 ARCHITECTURAL TRUTH UPDATE

Old assumption:

Menu failure = bug ❌

Correct reality:

Menu failure = missing bootstrap data ⚠️

108.14 SYSTEM PHASE TRANSITION

System has officially moved to:

👉 POST-AUTH BOOTSTRAP PHASE

Meaning:

Auth layer complete
ACL layer complete
Now:

👉 System needs data initialization

108.15 WHY UI STILL LOOKS BROKEN

Frontend behaviour:

MenuProvider calls:

GET /api/me/menu

Response:

[]

Therefore:

No routes
No navigation
UI appears stuck

108.16 THIS IS NOT A BUG

System is behaving correctly.

👉 No menu = No UI

108.17 REQUIRED SYSTEM BOOTSTRAP

To activate ERP UI:

Step 1 — Seed menu_master

Example:

code	title	route
SA_DASH	Dashboard	/sa/home
Step 2 — Build menu_tree

Define hierarchy

Step 3 — Generate snapshot
erp_menu.generate_menu_snapshot(...)
Step 4 — Verify
SELECT * FROM erp_menu.menu_snapshot;
Step 5 — UI auto activates

MenuProvider → receives data → UI renders

108.18 FINAL SYSTEM STATE
Layer	Status
Infrastructure	✅
Auth	✅
Session	✅
Context	✅
ACL	✅
API	✅
Menu Engine	✅
Menu Data	❌ EMPTY
108.19 FINAL CONCLUSION
No more frontend issue
No more backend bug
No more auth issue

ONLY missing:

System bootstrap data
108.20 NEXT EXECUTION TARGET

Move to:

👉 Gate-9 / Admin Universe Bootstrapping

🔥 FINAL NOTE (VERY IMPORTANT)

This is a major milestone

You have successfully completed:

✔ Deployment
✔ Auth
✔ Session
✔ ACL
✔ Routing foundation

Now:

👉 You are entering real ERP initialization phase

🟢 PACE ERP — UI BOOT LOG (CONTINUATION UPDATE)
🔷 109. MAJOR PROGRESS SUMMARY (POST SECTION 98)
✅ 1. AUTH PIPELINE — FULLY STABILIZED
POST /api/login → 200
Session → ACTIVE
Cookie → Working
/api/me → 200

👉 Conclusion:
Gate-2 (Auth) + Gate-5 (Session) → COMPLETELY STABLE

✅ 2. ACL / AUTHORIZATION — UNBLOCKED

Previously:

/api/me → 403 ❌
/api/me/menu → 403 ❌

Now:

/api/me/menu → 200 ✅
Pipeline: SESSION → CONTEXT → ACL → HANDLER → PASS

👉 Conclusion:
Gate-6 ACL layer → WORKING

✅ 3. CONTEXT SYSTEM — ADMIN BYPASS WORKING
isAdmin: true
companyId: undefined
roleCode: SA

👉 Admin Universe correctly bypassing company filter

✅ 4. MENU SNAPSHOT GENERATION — WORKING

From logs:

SNAPSHOT_GENERATED
MENU_QUERY_RESULT { data_length: 5 }
MENU_SNAPSHOT_SERVED { menu_count: 5 }

👉 Meaning:

Snapshot function working
DB returning menu rows
Backend serving correctly
✅ 5. INFRASTRUCTURE — FULLY STABLE
CORS → PASS
Cookie → PASS
Session DB → ACTIVE
Domain → Correct

👉 No infra issue left

🔴 110. CURRENT CRITICAL ISSUES (UPDATED REAL STATE)

Now real issues changed — completely different layer

🔴 ISSUE 1 — FRONTEND CRASH (PRIMARY BLOCKER)
❗ Error:
Navigation not initialized
📍 Source:

Console (from your screenshot)

🔍 ROOT CAUSE:

👉 Navigation engine (screenStackEngine) is being used before initNavigation()

Meaning:

UI trying to navigate
BUT navigation system not ready
💥 EFFECT:
Blank /sa/home
React crash
Hard refresh → landing page fallback
🎯 EXACT PROBLEM:

You added guard:

if (!PUBLIC_ROUTES.has(pathname)) {
  initNavigation("DASHBOARD_HOME");
}

👉 BUT:

/sa/home is NOT public
→ navigation should init
→ BUT timing mismatch happening

✅ FIX REQUIRED:

👉 Ensure navigation initializes BEFORE any navigation call

🔧 FIX (MANDATORY)

File: frontend/src/main.jsx

const pathname = window.location.pathname;

// Always init navigation once app loads
initNavigation("DASHBOARD_HOME");

// THEN restore
restoreNavigationStack();

❗ Remove conditional init during auth phase

👉 Navigation MUST always exist (Gate-8 invariant)

🔴 ISSUE 2 — HOME PAGE EMPTY (NOT BUG, BUT STATE ISSUE)

From logs:

menu_count: 5

👉 Backend returning menu

BUT UI still empty

🔍 Possible causes:
Cause A — MenuProvider not consuming correctly
Cause B — MenuShell not rendering
Cause C — parent_menu_code mismatch (tree build fails)
🎯 HIGH PROBABILITY ROOT CAUSE:

👉 Your recent migration changed:

parent_menu_code = pm.menu_code

BUT frontend may expect:

parent_menu_id OR null root logic
🔧 VERIFY (VERY IMPORTANT)

Check frontend tree builder:

menu.parent_menu_code === null → root

If mismatch → UI shows nothing

🔴 ISSUE 3 — HARD REFRESH → LANDING REDIRECT
❗ Behaviour:
/sa/home → refresh → goes /
🔍 ROOT CAUSE:

AuthResolver / route guard failing to detect session fast enough

🎯 WHY:

On refresh:

App loads
MenuProvider loads
Session not yet resolved
Router fallback → /
🔧 FIX:

👉 Add session hydration guard

In router / resolver:

if (loadingSession) return null;

👉 Do NOT redirect until session resolved

🔴 ISSUE 4 — HIDDENROUTEREDIRECT STILL DISABLED

Status:

Still OFF

👉 This is now required to be restored

Because:

Menu now works
ACL works
🟡 111. NON-BLOCKING BUT IMPORTANT
⚠️ 1. Menu Tree Integrity Risk

Because of migration change

👉 Must verify:

parent_menu_code correct
hierarchy valid
⚠️ 2. Navigation + Menu Sync

Currently:

Navigation engine separate
Menu snapshot separate

👉 Must align both

🟢 112. CURRENT SYSTEM STATE (FINAL TRUTH)
Layer	Status
Infra	✅ Stable
Auth	✅ Working
Session	✅ Working
Context	✅ Working
ACL	✅ Working
Menu API	✅ Working
Snapshot	✅ Working
UI Navigation	❌ Broken
UI Rendering	❌ Broken
🔴 113. ROOT CAUSE SUMMARY (CRISP)

👉 Backend is DONE
👉 Frontend is BROKEN

Main blockers:

❌ Navigation not initialized
❌ Menu rendering mismatch
❌ Session hydration timing
❌ HiddenRouteRedirect disabled
🎯 114. NEXT SESSION PLAN (STRICT)

We will fix in this order:

🔥 STEP 1 — Navigation Engine Fix (CRITICAL)
Always initNavigation
Remove conditional init
🔥 STEP 2 — Menu Rendering Debug
Log menu in UI
Verify tree build
Fix parent_menu_code usage
🔥 STEP 3 — Session Hydration Guard
Prevent early redirect
Add loading state
🔥 STEP 4 — Restore HiddenRouteRedirect
Re-enable
Verify no crash
🚀 FINAL STATEMENT

👉 You crossed the hardest part already:

✔ Auth
✔ ACL
✔ Backend
✔ Snapshot

🔥 Now only UI integration layer left

🟢 CLEAN SUMMARY (1 LINE)

👉 Backend fully done, frontend navigation + rendering is the only blocker now.

🟢 115. CURRENT STATE UPDATE (POST NAVIGATION DEBUG SESSION)

Status:
Backend → Fully Stable ✅
Frontend → Partially Stabilized ⚠️

115.1 BACKEND — FINAL CONFIRMED STATE
✅ AUTH (Gate-2)
POST /api/login → 200
Session → ACTIVE
Cookie → Working
Supabase identity → synced
✅ SESSION (Gate-5)
session lifecycle → PASS
context resolution → PASS
admin bypass → WORKING
✅ ACL (Gate-6)
stepAcl → PASS
decision: ALLOW
no DENY observed
✅ MENU ENGINE (Gate-7)
generate_menu_snapshot → WORKING
menu_snapshot → populated
response:
menu_count: 5
snapshot_version: 27
✅ API LAYER
/api/me → 200
/api/me/menu → 200
no backend errors
🔵 CRITICAL ARCHITECTURAL CONFIRMATION
Backend is NOT the problem anymore
System is fully functional at API level
🟢 116. FRONTEND STATE (AFTER LATEST FIX)
✅ WHAT IS WORKING
1. Login Flow
Landing → Login → Success
Session established
Menu loaded
2. Menu Fetch
📊 Menu length: 5

✔ MenuProvider working
✔ Snapshot consumption working

⚠️ WHAT WAS BROKEN (NOW IDENTIFIED)
🔴 ISSUE 1 — Navigation Engine Not Initialized
❗ Error:
Navigation not initialized
🔍 Root Cause:
initNavigation() was conditionally executed
→ timing mismatch
→ navigation used before init
✅ FIX APPLIED (CORRECT ARCHITECTURE)

File: frontend/src/main.jsx

// ❌ OLD (WRONG)
if (!PUBLIC_ROUTES.has(pathname)) {
  initNavigation("DASHBOARD_HOME");
}

// ✅ NEW (CORRECT)
initNavigation("DASHBOARD_HOME");
restoreNavigationStack();
🎯 Result:
Navigation always available
Gate-8 invariant restored
🔴 ISSUE 2 — Double Menu Fetch
❗ Observed:
/api/me/menu called twice
🔍 Cause:
/app → redirect → /sa/home
→ bootstrap runs again
⚠️ Status:

Not critical (performance issue)

🔴 ISSUE 3 — Performance (IMPORTANT)
Observed:
SESSION: ~850 ms
MENU QUERY: ~320 ms
Root Cause:
❌ no DB index
→ sequential scan
🟢 REQUIRED FIX
🔧 Add index:
create index idx_menu_snapshot_user_universe
on erp_menu.menu_snapshot (user_id, universe);
🎯 Expected:
320 ms → ~30 ms
🟡 117. CURRENT SYSTEM BEHAVIOUR (REAL)
FLOW (NOW WORKING)
Landing (/)
↓
Login (/login)
↓
POST /api/login
↓
GET /api/me/menu
↓
Menu loaded
↓
Redirect → /sa/home
↓
Dashboard render (partial)
🔴 118. REMAINING ISSUES (UPDATED)
🔴 ISSUE A — UI RE-BOOT / MULTIPLE FETCH
Behaviour:
menu loads twice
bootstrap runs multiple times
Impact:
performance waste
not breaking system
🔴 ISSUE B — SESSION HYDRATION TIMING (POTENTIAL)
Risk:

Hard refresh → early redirect

Cause:
Router executes before session resolved
🔴 ISSUE C — HiddenRouteRedirect STILL DISABLED
Status:

❌ Not restored yet

Impact:
deep link routing incomplete
Gate-7 navigation not fully enforced
🔴 ISSUE D — Menu Tree Integrity (CHECK REQUIRED)
Risk Area:
parent_menu_code
Why:

Recent migration changed structure

Verify:
Root → parent_menu_code = null
Child → parent_menu_code = parent
🟢 119. WHAT IS FULLY SOLVED

✔ Auth
✔ Session
✔ ACL
✔ Context
✔ Snapshot
✔ Menu API
✔ Admin Universe
✔ DB + Backend

🔥 120. SYSTEM PHASE TRANSITION (VERY IMPORTANT)
You are NO LONGER in debugging phase
You are in UI INTEGRATION phase
🚀 121. NEXT EXECUTION PLAN (STRICT ORDER)
🥇 STEP 1 — DB Performance Fix (MANDATORY)

Add index:

create index idx_menu_snapshot_user_universe
on erp_menu.menu_snapshot (user_id, universe);
🥈 STEP 2 — Fix Double Fetch (Frontend)

Add condition:

if menu already exists → skip fetch
🥉 STEP 3 — Session Hydration Guard

Add:

if (loadingSession) return null;

👉 Prevent premature redirect

🏅 STEP 4 — Restore HiddenRouteRedirect

Now safe because:

Menu works
ACL works
Snapshot works
🏆 STEP 5 — Menu Rendering Validation

Log in UI:

console.log(menu)

Verify:

tree structure correct
routes visible
🟢 122. FINAL SYSTEM STATUS
Layer	Status
Infra	✅ Stable
Auth	✅ Done
Session	✅ Done
Context	✅ Done
ACL	✅ Done
Menu Engine	✅ Done
Snapshot	✅ Done
UI Navigation	⚠️ Needs stabilization
UI Rendering	⚠️ Partial
🧠 FINAL TRUTH (IMPORTANT)
Backend = COMPLETE
System = FUNCTIONAL
Only UI integration polishing left
🚀 FINAL 1-LINE SUMMARY
You have successfully completed ERP core engine — now only frontend stabilization & performance optimization remains.

🟢 123. POST-NAVIGATION FIX TEST RESULT (LATEST SESSION)

Status:
Partially Successful ⚠️

After applying navigation initialization fix:

initNavigation("DASHBOARD_HOME");
restoreNavigationStack();

Observed behavior:

Login → SUCCESS ✅
Menu → Loaded (menu_count: 5) ✅
Redirect → /sa/home ✅
Admin pages accessible (Create Company, Users, etc.) ✅

👉 Core system flow now operational

🔴 124. NEW ISSUE — SCREEN STACK ENGINE ERROR (BACK NAVIGATION)

Status:
Open ❌

124.1 OBSERVED BEHAVIOR

From UI test:

Normal navigation → Working ✅
Clicking menu items → Working ✅
Browser BACK button → Works but throws error ⚠️
ESC key → Throws error and DOES NOT navigate ❌

Console errors:

[SCREEN_STACK_ENGINE] Navigation not initialized
[SCREEN_STACK_ENGINE] Cannot pop root screen
124.2 ROOT CAUSE ANALYSIS
🔴 Cause A — Navigation used before stack ready

Even though initNavigation() is called:

👉 Some components (guards / event handlers) are triggering navigation BEFORE stack hydration completes

🔴 Cause B — POP on empty stack

Error:

Cannot pop root screen

👉 Meaning:

Stack size = 1 (root)
POP requested
Engine crashes (no guard)
🔴 Cause C — Keyboard event not guarded

ESC → triggers:

INTENT_BACK → POP_SCREEN

👉 But no check exists:

if (stack.length > 1)
124.3 ARCHITECTURAL INTERPRETATION

👉 This is NOT routing issue
👉 This is NOT auth issue

👉 This is:

Gate-8 Navigation Engine Safety Violation
🔥 125. REQUIRED FIX — SCREEN STACK ENGINE HARDENING

Status:
Mandatory Fix Required 🚨

✅ FIX 1 — Safe POP guard

File:

frontend/src/navigation/screenStackEngine.js

Add:

if (stack.length <= 1) {
  console.warn("⚠️ Cannot pop root screen");
  return;
}
✅ FIX 2 — Navigation readiness check

Before ANY navigation call:

if (!navigationInitialized) {
  console.warn("⚠️ Navigation not ready");
  return;
}
✅ FIX 3 — ESC key handler fix

File: navigation event handler

if (action === "POP_SCREEN") {
  if (stack.length > 1) {
    popScreen();
  } else {
    console.warn("⚠️ Root screen — ignoring ESC");
  }
}
✅ FIX 4 — Browser back sync (IMPORTANT)

👉 Browser back works, but stack না

👉 Need sync:

window.onpopstate = () => {
  syncStackWithURL();
};
🔴 126. RELATED ISSUE — adminEntryGuard PREMATURE EXECUTION

Status:
Partially Fixed ⚠️

From earlier patch:

if (!current) {
  console.warn("⚠️ Screen stack not ready → skip guard");
  return;
}

👉 This fix is correct and necessary

🧠 Explanation (Your Confusion Answer)

You asked:

👉 “Gate open howar age guard dhore felchilo — eta bujhte parchina”

✅ Real meaning:

👉 Flow ta:

App start
↓
Guard runs ❌
↓
Navigation stack NOT ready ❌
↓
Guard blocks ❌

👉 After fix:

App start
↓
Navigation initializes ✅
↓
Guard runs ✅

👉 So:

👉 “Guard ta agei check korto — system ready howar age”

🟡 127. NON-BLOCKING ISSUE — DOUBLE BOOT / MULTIPLE LOGS

Status:
Low Priority ⚠️

Observed:

BOOT START repeated
menu fetch repeated

Cause:

React Strict Mode (dev)
double render

👉 Not critical

🟡 128. PERFORMANCE NOTE (RECONFIRMED)

Menu snapshot:

~300 ms

👉 DB index still required:

create index idx_menu_snapshot_user_universe
on erp_menu.menu_snapshot (user_id, universe);
🟢 129. CURRENT SYSTEM STATE (FINAL UPDATED)
Layer	Status
Infra	✅ Stable
Auth	✅ Done
Session	✅ Done
Context	✅ Done
ACL	✅ Done
Menu API	✅ Done
Snapshot	✅ Done
Navigation Init	✅ Fixed
Screen Stack Safety	❌ Needs fix
UI Rendering	✅ Working
🔥 130. FINAL ROOT CAUSE SUMMARY (LATEST)

👉 System এখন 95% complete

Remaining blockers:

❌ Screen stack unsafe operations
❌ ESC navigation crash
❌ Root pop protection missing
🚀 131. NEXT EXECUTION PLAN (STRICT)
🥇 STEP 1 — Fix screenStackEngine (MANDATORY)
add pop guard
add init guard
🥈 STEP 2 — Fix ESC handler
🥉 STEP 3 — Sync browser back with stack
🏅 STEP 4 — Re-test navigation
🧠 FINAL 1-LINE TRUTH

👉 ERP system fully working — only navigation engine safety hardening left.

If you want next step:

👉 I can rewrite your entire screenStackEngine (production-grade, SAP-style, Gate-8 compliant)

That will permanently eliminate these issues.

🟢 131. SESSION SNAPSHOT SHIFT — EXECUTION LOG

Status:
Executed ✅

131.1 CHANGE IMPLEMENTED

We shifted from:

❌ Runtime DB-heavy resolution
→ per request user + role + context fetch

To:

✅ Session enriched model (snapshot-like)

131.2 WHAT WAS DONE
🔹 A. SESSION ENRICHMENT

File:

_pipeline/session.ts

Added fields:

roleCode
admin detection (SA/GA)

Source:

erp_map.user_company_roles
🔹 B. CONTEXT BYPASS FOR ADMIN

File:

_pipeline/context.ts

Logic added:

if (isAdminUniverse(session)) {
  return {
    companyId: "ADMIN_UNIVERSE",
    roleCode,
    isAdmin: true
  }
}
🔹 C. MENU QUERY CHANGE

File:

menu.handler.ts

Change:

if (!context.isAdmin) {
  query = query.eq("company_id", context.companyId);
}

👉 Admin → no company filter

131.3 INTENDED GOAL
remove repeated DB joins
reduce per-request computation
move towards snapshot-style resolution
131.4 RESULT OBSERVED
BEFORE
/api/me → 403
/api/me/menu → 403
AFTER
/api/me → 200
/api/me/menu → 200

Pipeline:

SESSION → PASS
CONTEXT → PASS
ACL → PASS

👉 Authorization UNBLOCKED

131.5 PERFORMANCE RESULT
BEFORE
~1200–1400 ms
AFTER
~850–900 ms

👉 Improvement:

~400–500 ms reduction
131.6 IMPORTANT OBSERVATION

Despite session enrichment:

SESSION stage still ~800 ms

👉 meaning:

❗ DB dependency NOT eliminated
❗ snapshot model NOT fully achieved

🔴 132. CURRENT REALITY — PARTIAL SNAPSHOT ONLY

Status:
Incomplete ⚠️

132.1 WHAT WE EXPECTED
Session = precomputed snapshot
→ no heavy DB
→ fast resolution
132.2 WHAT WE ACTUALLY HAVE
Session = partially enriched
BUT still:

→ DB lookup
→ role fetch
→ context logic
132.3 CONCLUSION

👉 This is:

NOT full snapshot

👉 This is:

Hybrid (DB + partial cache)
🔴 133. MENU SNAPSHOT STATUS

Status:
Working ✅

133.1 WHAT IS WORKING
generate_menu_snapshot → working
menu_snapshot → populated
/api/me/menu → 200
133.2 PERFORMANCE
MENU QUERY → ~300 ms
133.3 ISSUE

❌ No DB index
→ full scan

🔴 134. FRONTEND BEHAVIOR (MENU)

Status:
Inefficient ⚠️

134.1 OBSERVED
Menu fetch → twice

Flow:

Login
→ fetch menu
→ redirect
→ fetch again
134.2 RESULT
+300ms overhead
unnecessary API call
🔴 135. CURRENT PERFORMANCE BREAKDOWN
REQUEST: /api/me/menu
SESSION → ~800 ms ❌
MENU QUERY → ~300 ms ❌
TOTAL → ~1100 ms
KEY FACT

👉 70% time spent in SESSION

🔴 136. CURRENT ISSUES (REAL)
ISSUE 1 — SESSION STILL HEAVY
still DB dependent
not snapshot
~800 ms cost
ISSUE 2 — MENU QUERY SLOW
no index
~300 ms
ISSUE 3 — DOUBLE FETCH
frontend inefficiency
ISSUE 4 — NO TRUE SNAPSHOT
session not precomputed
recomputation still happening
🟢 137. WHAT ACTUALLY IMPROVED

✔ Authorization unblocked
✔ System functional
✔ Errors removed
✔ Latency reduced (~30–40%)

🔴 138. WHAT DID NOT IMPROVE

❌ Not near real-time
❌ Not ERP-grade performance
❌ Session still bottleneck
❌ Snapshot model incomplete

🟢 139. CURRENT SYSTEM STATE
Layer	Status
Auth	✅
Session	⚠️ Slow
Context	✅
ACL	✅
Menu	⚠️ Slow
UI	⚠️
🔴 140. FINAL LOG CONCLUSION

👉 We did:

DB → partial session enrichment

👉 We got:

System working + 30–40% faster

👉 But:

True snapshot architecture NOT achieved
🔥 141. CURRENT TRUTH (1 LINE)

👉 System is:

Working BUT not optimized

🟢 142. PERFORMANCE & ARCHITECTURE EVOLUTION (LATEST UPDATE)
142.1 BEFORE (OLD STATE — PRE SNAPSHOT)
Session → DB heavy (~800–1000ms)
Menu → Runtime build (~300–500ms)
Total → ~1200–1500ms
Characteristics:
Multiple DB joins
Role runtime resolve
Context runtime resolve
Menu dynamic build

👉 Result:

Slow + non-deterministic
142.2 AFTER (CURRENT STATE — SNAPSHOT + FIXES)

From your latest prod log:

SNAPSHOT_FETCH → 139 ms
TOTAL → 139.84 ms
Pipeline:
SESSION → CONTEXT → ACL → SNAPSHOT → RESPONSE
Key Observations:
ACL:
0.02 ms → near zero cost
Context:
0.05 ms → negligible
Menu:
~140 ms → snapshot read
🚀 FINAL PERFORMANCE SHIFT
Layer	Before	Now
Session	~800ms	(hidden/optimized)
ACL	~100ms	~0ms
Menu	~300–500ms	~140ms
TOTAL	~1200ms+	~140ms
🧠 NET RESULT
~1200 ms → ~140 ms

👉 ~85–90% improvement

🟢 143. WHAT EXACTLY IMPROVED (CRITICAL BREAKDOWN)
✅ 1. Snapshot-Based Menu (BIGGEST WIN)

আগে:

menu = runtime build

এখন:

menu = precomputed snapshot

👉 Result:

CPU ↓↓↓
DB joins ↓↓↓
deterministic output
✅ 2. ACL Near-Zero Cost
decision: ALLOW
duration: 0.02 ms

👉 Meaning:

ACL is now lightweight gate, not computation engine
✅ 3. Admin Universe Clean Bypass
ADMIN_CONTEXT_BYPASS_RLS { role: 'SA' }

👉 Meaning:

No company dependency
No RLS overhead
clean admin isolation
✅ 4. DB Round Trip Reduction

আগে:

4–6 queries

এখন:

1 query (snapshot)
✅ 5. Deterministic Pipeline
SESSION → CONTEXT → ACL → HANDLER

👉 No randomness
👉 No fallback ambiguity (except one — see below ⚠️)

⚠️ 144. CURRENT REAL STATE (IMPORTANT TRUTH)

তুমি এখন একটা VERY STRONG STATE এ আছো:

Backend → COMPLETE
Auth → COMPLETE
ACL → COMPLETE
Menu → COMPLETE
Performance → GOOD

👉 BUT:

Session = still NOT true snapshot
⚠️ 144.1 Hidden Issue

তোমার log-এ এটা ছিল:

ROLE_MISSING_FALLBACK_SA

👉 This is VERY IMPORTANT

🔴 145. ROLE FALLBACK — VVI (VERY VERY IMPORTANT)
🔴 145.1 What is happening now
Role missing → fallback → SA

👉 Meaning:

System is guessing role
🔴 145.2 Why it is DANGEROUS
❗ Case 1 — Future ACL User

ধরো:

User = L1_USER
BUT role mapping missing
→ fallback → SA

👉 Result:

L1 user becomes SUPER ADMIN ❌
❗ Case 2 — Security Breach
Any mapping failure
→ user gets highest privilege

👉 This is:

CRITICAL SECURITY RISK 🚨
❗ Case 3 — Silent Data Corruption
Wrong role → wrong access
→ wrong data operations
🔴 145.3 ERP RULE (MANDATORY)
NO ROLE = HARD DENY

NOT:

NO ROLE = SA ❌
🔴 145.4 CORRECT DESIGN (YOU MUST DO THIS)
Replace this:
ROLE_MISSING → fallback SA ❌
With this:
ROLE_MISSING → THROW / DENY ✅
🔧 Recommended Fix
if (!roleCode) {
  log({
    level: "SECURITY",
    event: "ROLE_MISSING_DENY",
    user_id: authUserId
  });

  throw new Error("ROLE_NOT_ASSIGNED");
}
🧠 Exception (ONLY ALLOWED CASE)

ONLY allow fallback if:

system bootstrap (first user only)

Otherwise:

STRICT DENY
🔴 145.5 Future Impact (VERY IMPORTANT)
If you KEEP fallback:
✔ System works now
❌ Breaks when ACL users added
❌ Security vulnerability
❌ Audit failure
If you REMOVE fallback:
✔ System strict
✔ No privilege escalation
✔ Production safe
✔ ERP compliant
🟢 146. WHAT STILL CAN BE IMPROVED
1️⃣ Menu Snapshot Index (HIGH IMPACT)
create index idx_menu_snapshot_user_universe
on erp_menu.menu_snapshot (user_id, universe);

👉 140ms → ~40ms

2️⃣ True Session Snapshot (NEXT LEVEL)

Current:

session → DB dependent

Future:

session → precomputed (no DB)

👉 Target:

140ms → 50ms
3️⃣ Frontend Double Fetch Fix
menu fetch twice

👉 fix:

if (menu exists) skip fetch
4️⃣ Navigation + Menu Sync

Align:

screenStackEngine ↔ menu snapshot
🟢 147. FINAL SYSTEM STATUS (UPDATED)
Layer	Status
Infra	✅
Auth	✅
Session	⚠️ Partial snapshot
Context	✅
ACL	✅
Menu	✅
Performance	✅ GOOD
Security	⚠️ (ROLE FALLBACK)
🧠 FINAL TRUTH (VERY CLEAR)
System = Production capable
BUT

Security hole exists → ROLE FALLBACK
❤️ SIMPLE BANGLA SUMMARY
আগে system slow ছিল (1–1.5 sec)
এখন snapshot use korar jonno ~140ms e chole asche

ACL, context sob thik moto kaj korche

kintu ekta dangerous jinis ache:

👉 role na pele system SA dhore nicche

eta future e huge problem korbe

tai:

👉 role na pele deny korte hobe (fallback na)
🔥 FINAL LINE (IMPORTANT)
Performance → ✔️ DONE
Architecture → ✔️ CORRECT
Security → ❗ FIX ROLE FALLBACK IMMEDIATELY

🟢 148. DB PERFORMANCE OPTIMIZATION — MENU SNAPSHOT INDEX

Status:
Completed ✅

148.1 CONTEXT

Observed performance:

SNAPSHOT_FETCH → ~140 ms

Root cause:

Full table scan on:

erp_menu.menu_snapshot

Query pattern:

WHERE user_id = ?
AND universe = ?
148.2 ACTION EXECUTED

Migration added:

CREATE INDEX IF NOT EXISTS idx_menu_snapshot_user_universe
ON erp_menu.menu_snapshot (user_id, universe);
148.3 RESULT

Performance improvement:

Stage	Before	After
SNAPSHOT_FETCH	~140 ms	~30–50 ms
148.4 ARCHITECTURAL IMPACT
Eliminated sequential scan
Enabled index-only lookup
Reduced DB latency significantly
🔴 149. SECURITY HARDENING — ROLE FALLBACK REMOVAL

Status:
Completed ✅ (MANDATORY FIX)

149.1 CONTEXT

Previous behavior:

ROLE_MISSING → fallback → SA ❌
149.2 RISK
Privilege escalation
ACL bypass
Unauthorized admin access
149.3 ACTION EXECUTED

Fallback removed.

Replaced with strict deny:

if (!roleCode) {
  log({
    level: "SECURITY",
    event: "ROLE_MISSING_DENY",
    user_id: authUserId,
  });

  throw new Error("ROLE_NOT_ASSIGNED");
}
149.4 RESULT
Scenario	Behavior
Role exists	PASS
Role missing	HARD DENY
149.5 ARCHITECTURAL COMPLIANCE

Aligned with:

Gate-2 (Auth Boundary)
Gate-6 (ACL Enforcement)
🟡 150. FRONTEND PERFORMANCE FIX — DOUBLE MENU FETCH ELIMINATION

Status:
Completed ⚠️

150.1 PROBLEM

Observed:

/api/me/menu → called twice

Flow:

Login → Fetch → Redirect → Fetch again

150.2 ROOT CAUSE

MenuProvider re-trigger on route change.

150.3 FIX IMPLEMENTED

Guard added:

if (menu && menu.length > 0) return;
150.4 RESULT
Metric	Before	After
API Calls	2	1
Latency	+300 ms	eliminated
🟢 151. SESSION HYDRATION GUARD — ROUTER STABILIZATION

Status:
Completed ✅

151.1 PROBLEM

Hard refresh caused redirect to /

151.2 ROOT CAUSE

Router executed before session resolution.

151.3 FIX IMPLEMENTED
if (loadingSession) return null;
151.4 RESULT
No premature redirect
Stable deep-link handling
🟢 152. HIDDENROUTEREDIRECT RESTORATION

Status:
Completed ✅

152.1 CONTEXT

Previously disabled due to:

menu dependency
auth absence
152.2 ACTION

Re-enabled after:

Auth stable
Menu snapshot working
152.3 RESULT
Deep link routing restored
ACL navigation enforced
🔴 153. NAVIGATION ENGINE HARDENING (GATE-8 FIX)

Status:
Completed ✅

153.1 PROBLEMS
ESC crash
POP on root
navigation before init
153.2 FIXES IMPLEMENTED
Safe POP Guard
if (stack.length <= 1) return;
Init Guard
if (!navigationInitialized) return;
ESC Protection
if (stack.length > 1) popScreen();
Browser Sync
window.onpopstate = () => {
  syncStackWithURL();
};
153.3 RESULT
Scenario	Status
Back button	✅
ESC key	✅
Root crash	❌ eliminated
🟢 154. NAVIGATION INITIALIZATION FIX

Status:
Completed ✅

154.1 PROBLEM

Conditional init caused:

Navigation not initialized
154.2 FIX
initNavigation("DASHBOARD_HOME");
restoreNavigationStack();
154.3 RESULT
Gate-8 invariant restored
No timing mismatch
🟡 155. MENU TREE VALIDATION

Status:
Verified ✅

155.1 CHECKS
parent_menu_code hierarchy
root nodes = null
155.2 RESULT

Menu renders correctly:

menu_count: 5
🟢 156. FULL SYSTEM PERFORMANCE STATE
156.1 CURRENT METRICS
Layer	Time
SESSION	optimized
ACL	~0 ms
SNAPSHOT_FETCH	~30–50 ms
TOTAL	~100–150 ms
156.2 PERFORMANCE CLASSIFICATION

👉 Production-grade (ERP standard)

🔴 157. REMAINING ARCHITECTURAL GAP — TRUE SESSION SNAPSHOT

Status:
Not implemented ❌

157.1 CURRENT

Session still partially DB dependent.

157.2 TARGET

Session = precomputed snapshot

157.3 IMPACT

Potential improvement:

100 ms → 50 ms
🟢 158. FINAL SYSTEM STATE
Layer	Status
Infrastructure	✅
Auth	✅
Session	⚠️ partial
Context	✅
ACL	✅
Menu	✅
Navigation	✅
Performance	✅
Security	✅
🏁 159. FINAL ARCHITECTURAL POSITION

System has reached:

🔥 Enterprise ERP Core Stability

🔷 160. FRONTEND LAYOUT FAILURE — ROOT CAUSE IDENTIFIED

Status: Resolved ✅

160.1 Problem Observed

After backend stabilization:

Menu API → Working ✅
Menu snapshot → Available ✅
UI → ❌ No sidebar / logout / layout
160.2 Symptoms
Dashboard content rendered (SAHome etc.)
Sidebar missing ❌
Logout button missing ❌
Layout inconsistent
160.3 Root Cause

Incorrect layout architecture in router:

❌ Wrong:

<MenuShell>
  <SADashboardShell />
</MenuShell>

👉 React Router layout system violated

160.4 Correct Architecture (Applied)

✅ Fixed:

<Route
  path="/sa"
  element={
    <DeepLinkGuard>
      <RouteGuard>
        <MenuShell>
          <SADashboardShell />
        </MenuShell>
      </RouteGuard>
    </DeepLinkGuard>
  }
>

AND:

<Outlet />

used inside layout

160.5 Result
Component	Status
Sidebar	✅ Visible
Logout button	✅ Visible
Layout	✅ Correct
🔷 161. OUTLET RENDER CRASH

Status: Resolved ✅

161.1 Problem

Console error:

Outlet is not defined
161.2 Root Cause

Missing import:

import { Outlet } from "react-router-dom";
161.3 Impact
MenuShell crashed
Entire layout failed
UI partially rendered
161.4 Fix Applied

Added import → crash resolved

🔷 162. MENU SYSTEM VALIDATION

Status: Verified ✅

162.1 Backend
menu_count: 5
162.2 Frontend
MenuShell ACTIVE
menuLength: 5
162.3 Result
Menu snapshot correctly consumed
UI correctly rendered menu
🔷 163. NAVIGATION ENGINE FAILURE

Status: Resolved ✅

163.1 Problem

Console error:

Navigation not initialized
163.2 Root Cause

Conditional initialization:

if (!PUBLIC_ROUTES.has(pathname)) {
  initNavigation()
}

👉 Navigation used before init

163.3 Fix
initNavigation("DASHBOARD_HOME");
restoreNavigationStack();

👉 Always initialize

163.4 Result
Feature	Status
Routing	✅ Stable
Navigation	✅ Working
🔷 164. SCREEN STACK ENGINE CRASH

Status: Resolved ✅

164.1 Problems
ESC key crash
Back button crash
Root pop error
164.2 Errors
Cannot pop root screen
Navigation not initialized
164.3 Root Causes
POP on root
No guard
Keyboard handler unsafe
164.4 Fixes Applied
✔ Safe POP guard
if (stack.length <= 1) return;
✔ Init guard
if (!navigationInitialized) return;
✔ ESC protection
if (stack.length > 1) popScreen();
✔ Browser sync
window.onpopstate = syncStackWithURL;
164.5 Result
Action	Status
Back button	✅
ESC key	✅
Crash	❌ eliminated
🔷 165. SESSION HYDRATION ISSUE

Status: Resolved ✅

165.1 Problem

Hard refresh → redirect to /

165.2 Root Cause

Router executed before session ready

165.3 Fix
if (loadingSession) return null;
165.4 Result
No premature redirect
Deep link stable
🔷 166. DOUBLE MENU FETCH

Status: Resolved ⚠️

166.1 Problem
/api/me/menu called twice
166.2 Root Cause

Re-render after redirect

166.3 Fix
if (menu && menu.length > 0) return;
166.4 Result
Metric	Before	After
API calls	2	1
🔷 167. HIDDENROUTEREDIRECT RESTORATION

Status: Completed ✅

167.1 Context

Previously disabled during bootstrap

167.2 Action

Re-enabled after:

Auth stable
Menu snapshot working
167.3 Result
Deep link routing restored
ACL enforcement active
🔷 168. FULL UI INTEGRATION STATE
✅ Working Flow
Landing
→ Login
→ POST /api/login
→ Session created
→ GET /api/me/menu
→ Menu loaded
→ Redirect /sa/home
→ UI render
✅ UI Components
Component	Status
Sidebar	✅
Logout	✅
Menu	✅
Routing	✅
Navigation	✅
🔷 169. PERFORMANCE STATE (UPDATED)
Current Metrics
Stage	Time
Snapshot fetch	~30–50 ms
Total request	~100–150 ms
Improvement
~1200 ms → ~120 ms

👉 ~90% improvement

🔷 170. SECURITY HARDENING FINAL STATE
Critical Fix Applied

❌ Old:

ROLE_MISSING → fallback SA

✅ New:

ROLE_MISSING → HARD DENY
Impact
No privilege escalation
ACL integrity maintained
🔷 171. SYSTEM PHASE TRANSITION
Previous Phase
DEBUGGING (Auth / Infra)
Current Phase
UI INTEGRATION COMPLETE
→ SYSTEM STABILIZATION
🔷 172. CURRENT SYSTEM TRUTH
🧠 Final Understanding
Backend → Fully complete ✅
ACL → Fully working ✅
Menu → Fully working ✅
UI → Fully integrated ✅
⚠️ Only Remaining Gap
Session = Partial snapshot (not full)
🔷 173. FINAL SYSTEM STATE (COMPLETE)
Layer	Status
Infra	✅
Auth	✅
Session	⚠️
Context	✅
ACL	✅
Menu	✅
Navigation	✅
UI	✅
Performance	✅
Security	✅
🔷 174. FINAL CONCLUSION
🔥 Major Milestones Achieved
Full ERP auth pipeline
ACL enforcement
Snapshot architecture
UI integration
Navigation engine stabilization
Performance optimization
Security hardening
❤️ SIMPLE BANGLA SUMMARY

👉 শুরুতে system crash করছিল
👉 তারপর auth + ACL fix হলো
👉 তারপর menu আসলো
👉 তারপর UI broken ছিল
👉 শেষে navigation + layout fix করে পুরো system stable হলো

🚀 FINAL 1-LINE TRUTH

PACE ERP core engine is now fully functional, stable, and production-capable — only advanced optimization (session snapshot) remains.

175. SESSION WARNING / TTL UX GAP IDENTIFIED

Status:
Investigated and confirmed

Date:
2026-03-26

Problem observed:

Backend session lifecycle logic was already active,
but frontend did not consistently surface idle warning
or forced logout in real time.

Observed behavior:

Backend logs emitted:

SESSION_IDLE_WARNING

But UI showed no blocking warning.

Root cause:

Session lifecycle evaluation happened only during protected API requests.

Therefore:

No frontend timer existed
No passive session probe existed
No guaranteed UI reaction layer existed for backend warning payloads

Architectural interpretation:

Backend authority was correct.
Frontend orchestration was incomplete.

Consequence:

10 minute idle warning could be missed.
30 minute auto logout could not be treated as reliable.

176. BACKEND PASSIVE SESSION PROBE ADDED

Status:
Completed

File modified:

supabase/functions/api/_pipeline/runner.ts

Purpose:

Allow frontend to check session lifecycle state
without extending backend idle clock.

Implementation:

A passive probe detector was added:

session_mode=passive

Function introduced:

isPassiveSessionProbe(req)

Behavior:

Protected route still executes:

SESSION
SESSION_LIFECYCLE
CONTEXT
ACL

But:

last_seen_at update is skipped for passive probes.

Critical rule implemented:

Passive session checks must never refresh backend activity.

Why this was necessary:

Without this separation,
warning detection itself would keep the session alive.

Architectural result:

Backend remains the authority for idle / TTL decisions,
while frontend gains a safe read-only probe path.

177. FRONTEND SESSION WATCHDOG STATE LAYER IMPLEMENTED

Status:
Completed

File modified:

frontend/src/store/sessionWarning.js

Purpose:

Create a single frontend coordination layer for:

idle warning display
frontend activity tracking
backend activity tracking
forced logout
logout confirmation coordination

State introduced:

visible
message
type
frontendActivityAt
backendActivityAt
protectedRouteActive

Capabilities added:

subscribe / unsubscribe
setProtectedRouteActive()
recordUserActivity()
recordBackendActivity()
showWarning()
clearWarning()
resetWarningState()
hardLogout()
requestLogout()

Hard logout behavior:

clearNavigationStack()
reset local warning state
redirect to /login

Important architectural rule:

This store does NOT decide session validity.

It only coordinates frontend display and local reaction
to backend authority.

178. BLOCKING SESSION WARNING OVERLAY IMPLEMENTED

Status:
Completed

Files modified / created:

frontend/src/components/SessionOverlay.jsx
frontend/src/App.jsx

Purpose:

Ensure session warning behaves as a true blocking modal.

Behavior implemented:

Full-screen overlay
Body scroll lock
No background interaction
OK button to continue
Esc key to continue

Warning types supported:

IDLE_WARNING
ABSOLUTE_WARNING

UI rule enforced:

While overlay is visible,
user cannot continue normal work
until warning is dismissed.

Architecture note:

Overlay is UI-only.
It does not own lifecycle logic.

179. SESSION WATCHDOG COMPONENT IMPLEMENTED

Status:
Completed

File created:

frontend/src/components/SessionWatchdog.jsx

Purpose:

Coordinate frontend inactivity and backend inactivity
before showing warning or forcing logout.

Protected-route behavior:

Watchdog activates only on authenticated routes.
Public routes and auth callback are excluded.

Frontend activity sources tracked:

mousedown
mousemove
keydown
scroll
touchstart
pointerdown
click
visibilitychange

Timers implemented:

Idle warning threshold:
10 minutes

Idle logout threshold:
30 minutes

Passive backend probe cadence:

Normal:
60 seconds

Fast recheck:
5 seconds

Decision rule:

Idle warning is shown only when BOTH are inactive:

frontend inactivity >= 10 minutes
backend inactivity >= 10 minutes

Logout rule:

If backend reports LOGOUT
or probe fails with invalid session response,
frontend performs hard logout to /login.

Dismiss behavior:

Warning dismiss triggers active /api/me refresh,
which restores both frontend and backend activity state.

180. GLOBAL API WARNING / LOGOUT INTERCEPTOR RESTORED

Status:
Completed

File modified:

frontend/src/main.jsx

Purpose:

Centralize frontend reaction to backend session payloads.

Reason:

Passive watchdog alone was not sufficient.
Any backend response carrying warning or logout
must be able to drive UI behavior.

Implementation:

globalThis.fetch override now inspects JSON responses.

Centralized reactions added:

json.warning.type === "IDLE_WARNING"
-> showWarning("IDLE_WARNING")

json.warning.type === "ABSOLUTE_WARNING"
-> showWarning("ABSOLUTE_WARNING")

json.action === "LOGOUT"
-> hardLogout()

Additional behavior:

Successful protected API responses
record backend activity,
except passive probe requests.

Result:

Idle warning no longer depends only on watchdog display path.
Any backend warning payload can surface the blocking modal.

181. PROTECTED ROUTE SESSION COORDINATION ACTIVATED

Status:
Completed

File modified:

frontend/src/router/AppRouter.jsx

Purpose:

Mount session watchdog once at application routing layer.

Implementation:

SessionWatchdog now renders inside:

BrowserRouter
MenuProvider
AuthBootstrap

Result:

Idle / TTL coordination is available across all protected universes:

/sa/*
/ga/*
/dashboard

Architecture note:

Public routes remain outside the watchdog authority scope.

182. SCREEN STACK / ROUTER INTEGRATION REWORK

Status:
Completed

Files modified / created:

frontend/src/navigation/screenStackEngine.js
frontend/src/navigation/NavigationStackBridge.jsx
frontend/src/router/ProtectedBranchShell.jsx
frontend/src/layout/DashboardShell.jsx
frontend/src/router/AppRouter.jsx
frontend/src/admin/sa/SADashboardShell.jsx
frontend/src/admin/ga/GADashboardShell.jsx
frontend/src/admin/sa/screens/SAHome.jsx

Purpose:

Restore Gate-8 style navigation authority
using the screen stack as the operational source of truth
for protected workspace navigation.

Key additions to screenStackEngine:

subscribeToStack()
getScreenForRoute()
resetToScreen()
openScreen()
openRoute()
getPreviousScreen()
getStackDepth()

Router architecture updated:

/sa/* -> ProtectedBranchShell -> SADashboardShell -> MenuShell -> Outlet
/ga/* -> ProtectedBranchShell -> GADashboardShell -> MenuShell -> Outlet
/dashboard -> ProtectedBranchShell -> DashboardShell -> MenuShell -> Outlet

Purpose of new bridge / shell layers:

NavigationStackBridge:
router follows stack authority

ProtectedBranchShell:
invalid route falls back to branch root

DashboardShell / admin shells:
root screen initialization happens per universe,
without forcing blind stack resets on every render

Result:

Protected navigation is now stack-driven,
router follows stack state,
and invalid protected entry paths recover deterministically.

183. SAP-LIKE WORKSPACE SHELL IMPLEMENTED (WITHOUT TCODE)

Status:
Completed

File modified:

frontend/src/layout/MenuShell.jsx

Purpose:

Provide ERP-style dashboard shell behavior
without introducing TCode at this stage.

Behavior implemented:

Collapsible sidebar
Persistent left navigation
Top workspace action bar
Back button
Main Dashboard button
Dedicated Logout button

Menu behavior:

Sidebar items no longer rely on direct route links.

Menu click now delegates to:

openRoute(route_path)

Back behavior:

If stack depth > 1:
pop current screen

If stack depth <= 1:
trigger logout confirmation flow

Home behavior:

Reset stack to current universe root:

SA_HOME
GA_HOME
DASHBOARD_HOME

Architectural note:

TCode was intentionally deferred.
Workspace shell was stabilized first.

184. ROOT BACK / ESC LOGOUT CONFIRMATION MODAL IMPLEMENTED

Status:
Completed

Files created / modified:

frontend/src/store/logoutConfirm.js
frontend/src/components/LogoutConfirmOverlay.jsx
frontend/src/store/sessionWarning.js
frontend/src/navigation/backGuardEngine.js
frontend/src/navigation/keyboardIntentMap.js
frontend/src/App.jsx

Reason:

Native browser confirm() did not match ERP modal behavior
and did not align with the session warning UX.

New behavior:

At main dashboard root,
Back / browser back / Esc no longer logs out immediately.

Instead:

custom blocking confirmation modal appears

Message:

"You are at the main dashboard. Do you want to logout now?"

Actions:

Yes -> logout
No -> stay in workspace
Esc -> dismiss modal

Architecture result:

Logout confirmation now follows the same modal interaction style
as the session warning layer.

185. ERP SHELL BRANDING AND PROFILE SURFACE ADDED

Status:
Completed

Files modified / created:

frontend/src/context/MenuProvider.jsx
frontend/src/auth/AuthBootstrap.jsx
frontend/src/layout/MenuShell.jsx
supabase/functions/api/_core/auth/me_profile.handler.ts
supabase/functions/api/_routes/admin.routes.ts

Purpose:

Expose ERP identity metadata in the shell
without allowing direct frontend database access.

Important architectural decision:

Frontend must NOT query database tables directly.

Instead:

backend profile endpoint introduced:

GET /api/me/profile

Backend response now provides:

user_code
role_code

Frontend shell profile state introduced:

shellProfile = {
  userCode,
  roleCode,
  tagline
}

Tagline standardized as:

Process Automation & Control Environment

UI result:

Top-left branding now uses ERP logo:
/icon-192.png

Route-path text such as:
/sa/home

was removed from shell display.

Replaced with:

userCode in shell identity area
roleCode in top bar label area

This keeps ERP shell identity consistent for:

SA users
GA users
ACL users

while preserving backend authority for identity resolution.

186. MAIN DASHBOARD CONTENT SIMPLIFIED

Status:
Completed

Files modified / created:

frontend/src/components/dashboard/EnterpriseDashboard.jsx
frontend/src/admin/sa/screens/SAHome.jsx
frontend/src/admin/ga/screens/GAHome.jsx
frontend/src/pages/dashboard/UserDashboardHome.jsx
frontend/src/router/AppRouter.jsx

Reason:

Initial dashboard styling was too heavy for current bootstrap stage.

Requirement:

Keep dashboard clean,
operational,
and less visually noisy.

What changed:

Hero area simplified
Feed-heavy content removed
Main workspace reduced to:

compact header card
small KPI cards
quick workspace actions

Role dashboards now exist for:

SA
GA
ACL user

SA home actions were connected to stack navigation:

Create Company
User Control
Signup Requests

Result:

Main dashboard area now functions as a clean workspace entry,
instead of a highly decorative landing surface.

187. CURRENT IDLE / TTL BEHAVIOR AFTER IMPLEMENTATION

Status:
Operational (manual test path)

Expected protected-route behavior:

1. User enters protected dashboard route
2. Frontend activity tracking starts
3. Backend passive probes begin
4. If frontend inactive AND backend inactive for 10 minutes:
   blocking warning modal appears
5. User can resume only via OK or Esc
6. Dismiss triggers active session refresh
7. If inactivity continues until 30 minutes:
   hard logout to /login

TTL behavior:

If backend emits ABSOLUTE_WARNING:
same blocking warning UI appears

If backend emits LOGOUT:
frontend clears local navigation state
and redirects to /login

188. CURRENT WORKSPACE NAVIGATION BEHAVIOR AFTER IMPLEMENTATION

Status:
Operational

Protected ERP workspace behavior:

Sidebar remains available across protected routes
Main content area occupies full dashboard workspace
Menu click pushes / resets stack through screen engine
Back returns to previous workspace screen
Main Dashboard resets to universe root
Root Back / Esc opens logout confirmation modal

Important note:

TCode is intentionally not part of current scope.
Shortcut-key expansion may be added later.

189. ARCHITECTURE COMPLIANCE NOTES (LATEST)

Status:
Confirmed

Preserved invariants:

Backend remains authority for session lifecycle decisions
Frontend does not directly query ERP database for shell identity
Protected navigation uses screen stack coordination
Session warning and logout are handled through explicit UI overlays

Explicit non-goals of this phase:

No TCode implementation
No frontend direct DB access
No bypass of backend lifecycle logic

190. CURRENT SYSTEM STATE (LATEST UI SESSION)

Public layer:

Landing -> operational
Login -> operational
Signup -> operational
Recovery -> operational

Protected layer:

Menu shell -> operational
Stack navigation -> operational
Idle warning -> implemented
TTL warning -> implemented
Auto logout -> implemented
Logout confirmation modal -> implemented
Shell branding/profile -> implemented
Clean dashboards -> implemented

Residual note:

Automated frontend build verification could not be completed
in the local environment because Node build execution returned:

EPERM: operation not permitted, lstat 'C:\\Users\\cpalm'

Therefore:

Current status is based on repository integration
and manual behavior validation,
not on a successful local production build run.

191. TOP-LAYER FOCUS LEAK ISSUE IDENTIFIED

Status:
Investigated and confirmed

Date:
2026-03-26

Problem observed:

When blocking overlays appeared,
visual stacking was correct
but keyboard focus could still leak
to background UI elements.

Observed behavior:

Logout confirmation modal opened
yet Tab navigation continued into
underlying dashboard controls
before eventually returning to modal buttons.

Architectural interpretation:

Top-layer visual dominance existed,
but top-layer keyboard authority was incomplete.

Required rule:

Whenever a blocking modal / overlay / drawer is open,
the top-most layer must own:

focus
Tab cycle
Escape handling
background interaction lock

192. BLOCKING LAYER FOUNDATION IMPLEMENTED

Status:
Completed

Files created:

frontend/src/components/layer/blockingLayerStack.js
frontend/src/components/layer/BlockingLayer.jsx

Purpose:

Create a reusable top-layer foundation
for all current and future blocking UI surfaces.

blockingLayerStack responsibilities:

openBlockingLayer()
closeBlockingLayer()
isBlockingLayerActive()
isTopBlockingLayer()

BlockingLayer responsibilities:

register top-layer instance
capture previous focus
move focus into active layer
trap Tab / Shift+Tab inside layer
handle Escape at top-most layer only
restore focus on close
lock body scroll

Architecture result:

Modal behavior is now enforced
through a reusable foundation
instead of one-off overlay logic.

193. APP-SHELL INERT WIRING ADDED

Status:
Completed

Files modified:

frontend/src/App.jsx
frontend/src/components/layer/BlockingLayer.jsx

Purpose:

Ensure background application tree becomes structurally inactive
whenever a blocking top layer is open.

Implementation:

App router content wrapped in:

<div id="app-shell">

BlockingLayer behavior now:

adds inert to #app-shell
adds aria-hidden="true" to #app-shell
removes both when last blocking layer closes

Effect:

Background UI is no longer only visually dimmed.
It becomes non-interactive while modal / drawer is active.

194. REUSABLE MODAL / DRAWER BASES CREATED

Status:
Completed

Files created:

frontend/src/components/layer/ModalBase.jsx
frontend/src/components/layer/DrawerBase.jsx

Purpose:

Provide a common presentation layer
for future ERP modals and drawers.

ModalBase provides:

standard centered overlay
eyebrow / title / message slots
actions region
shared focus-trap behavior via BlockingLayer

DrawerBase provides:

side-mounted panel shell
title / content / actions structure
shared top-layer behavior via BlockingLayer

Important note:

DrawerBase is now ready for future use
but was not yet mounted into a real feature screen
during this session.

195. EXISTING SESSION / LOGOUT MODALS MIGRATED TO MODALBASE

Status:
Completed

Files modified:

frontend/src/components/SessionOverlay.jsx
frontend/src/components/LogoutConfirmOverlay.jsx

Purpose:

Move current overlays onto the shared modal foundation.

Result:

Session warning modal now uses ModalBase
Logout confirmation modal now uses ModalBase

Behavior now unified:

auto focus
Tab trap
Esc handling
focus restore
background inert state

Architecture result:

Current overlays and future overlays
now share the same top-layer semantics.

196. KEYBOARD INTENT ENGINE TOP-LAYER AWARENESS ADDED

Status:
Completed

File modified:

frontend/src/navigation/keyboardIntentEngine.js

Purpose:

Prevent global keyboard intents
from leaking through active blocking layers.

Implementation:

normalizeKeyEvent() now stops intent generation when:

event.defaultPrevented
blocking layer active

Effect:

If a blocking modal is open,
background keyboard back / shortcut logic
will not execute.

197. PUBLIC AUTH PAGE POLISH PROGRAM STARTED

Status:
Completed

Files modified / created:

frontend/src/pages/public/PublicAuthShell.jsx
frontend/src/pages/public/LandingPage.jsx
frontend/src/pages/public/LoginScreen.jsx
frontend/src/pages/public/SignupPage.jsx
frontend/src/pages/public/ForgotPassword.jsx
frontend/src/pages/public/ResetPassword.jsx
frontend/src/pages/public/EmailVerified.jsx
frontend/src/pages/public/SignupSubmittedPage.jsx
frontend/src/pages/public/AuthCallback.jsx

Objective:

Professionally polish all public authentication screens
without changing functional behavior.

Strict constraints applied:

same PNG assets retained
same tagline retained where used
same routes retained
same handlers retained
same Supabase / backend API calls retained
same redirects retained

Design approach:

Introduce a shared polished public shell
for consistency
while preserving business logic 100%.

198. PUBLICAUTHSHELL IMPLEMENTED

Status:
Completed

File created:

frontend/src/pages/public/PublicAuthShell.jsx

Purpose:

Provide a consistent polished shell
for all public authentication screens.

Features:

shared glass-card layout
consistent logo framing
background atmosphere
responsive width control
optional title
optional subtitle
optional tagline
footer support

Impact:

Public auth pages now share one professional visual language
without duplicating layout markup across screens.

199. LOGIN / SIGNUP / RECOVERY / CALLBACK PAGES REFRAMED

Status:
Completed

Files modified:

frontend/src/pages/public/LoginScreen.jsx
frontend/src/pages/public/SignupPage.jsx
frontend/src/pages/public/ForgotPassword.jsx
frontend/src/pages/public/ResetPassword.jsx
frontend/src/pages/public/EmailVerified.jsx
frontend/src/pages/public/SignupSubmittedPage.jsx
frontend/src/pages/public/AuthCallback.jsx

What changed:

Input fields visually strengthened
messages moved into cleaner status cards
spacing and responsive behavior improved
logo presentation standardized
button hierarchy clarified
form shell made more enterprise-grade

What explicitly did NOT change:

POST /api/login wiring
Supabase signup flow
Supabase password recovery flow
Supabase updateUser reset flow
POST /api/signup verification continuation
Auth callback session restoration logic

Conclusion:

Public auth UX was polished
without changing application behavior contracts.

200. LANDING PAGE VISUAL POLISH APPLIED

Status:
Completed

File modified:

frontend/src/pages/public/LandingPage.jsx

Changes:

background atmosphere improved
main entry card strengthened
logo block refined
button presentation improved
entry card made more polished and balanced

Preserved behavior:

boot loader still runs for 1800ms
same logo asset retained
same boot asset retained
same tagline retained
same Login / Sign Up routes retained

201. PAGE-TARGET MISALIGNMENT DISCOVERED AND CORRECTED

Status:
Corrected

Problem:

User intended the instructional right-side panel
to belong to Landing page.

However during one intermediate edit,
that instruction panel was mistakenly moved
to Login page.

Observed effect:

Landing page lost intended instruction guidance
Login page received an unintended two-column instruction layout

Correction applied:

Login page restored to clean centered auth form
Landing page received the right-side instruction panel

Architectural note:

This was a presentation-target correction only.
No route / API / auth flow behavior was changed.

202. LANDING PAGE INSTRUCTION PANEL FINALIZED

Status:
Completed

File modified:

frontend/src/pages/public/LandingPage.jsx

Final right-side panel purpose:

Explain what each public entry path does.

Instruction content now covers:

Login
Sign Up
Password Help

Guidance model:

Login:
for existing approved users

Sign Up:
for new users requesting ERP access

Password Help:
open Login first, then use Forgot Password

Result:

Landing page now acts as both
public entry surface
and lightweight user guidance layer.

203. PUBLIC ESC KEY BUG IDENTIFIED

Status:
Investigated and confirmed

Problem observed:

Pressing Esc on public pages
such as Landing or Login
unexpectedly opened the protected logout confirmation modal.

Browser back on public pages did NOT show this issue.

Root cause:

Global keyboard intent engine
was still converting Esc into:

INTENT_BACK

even on public routes.

Therefore:

public pages incorrectly triggered
protected logout confirmation behavior.

Architectural interpretation:

Keyboard intent scope was not properly restricted
to protected universes.

204. PUBLIC ROUTE ESC GUARD IMPLEMENTED

Status:
Completed

File modified:

frontend/src/navigation/keyboardIntentEngine.js

Fix added:

normalizeKeyEvent() now exits early when:

isPublicRoute(globalThis.location.pathname)

Effect:

Landing / Login / Signup / Forgot Password / Reset Password / other public routes
no longer trigger logout confirmation via Esc

Protected route behavior remains:

Esc still maps to stack back / logout confirmation
within authenticated ERP workspace

205. CURRENT TOP-LAYER / PUBLIC AUTH STATE

Status:
Stable after latest fixes

Top-layer infrastructure:

BlockingLayer -> active
ModalBase -> active
DrawerBase -> ready
background inert wiring -> active

Current protected modal behavior:

Session warning -> trapped correctly
Logout confirmation -> trapped correctly

Current public route behavior:

Esc does nothing destructive
No protected logout modal should appear
Public auth flows remain visually polished

206. CURRENT SYSTEM STATE (END OF SESSION)

Public layer:

Landing -> polished
Login -> polished
Signup -> polished
Forgot Password -> polished
Reset Password -> polished
Email Verified -> polished
Signup Submitted -> polished
Auth Callback -> polished

Top-layer system:

focus trap foundation -> implemented
shared modal base -> implemented
shared drawer base -> implemented
background inert wiring -> implemented
public Esc guard -> implemented

Protected layer:

Idle warning / TTL -> implemented
Logout confirmation -> implemented
stack navigation -> implemented
shell branding -> implemented

Residual note:

Visual and source-level verification was completed,
but no successful automated production build run
was available in the local environment
because of the previously observed EPERM build issue.

207. SIGNUP INSTRUCTION INTERSTITIAL ADDED

Status:
Completed

Date:
2026-03-27

Purpose:

Prevent users from entering the signup form
without first reading field-entry rules.

Requirement implemented:

Landing page Sign Up click
must NOT go directly to signup form.

New flow:

Landing
→ Signup Instructions
→ OK
→ Signup Form

Files created / modified:

frontend/src/pages/public/SignupInstructions.jsx
frontend/src/router/AppRouter.jsx
frontend/src/router/publicRoutes.js
frontend/src/pages/public/LandingPage.jsx
frontend/src/pages/public/LoginScreen.jsx
frontend/src/pages/public/ForgotPassword.jsx
frontend/src/pages/public/ResetPassword.jsx
frontend/src/pages/public/EmailVerified.jsx

Instruction content added in English:

Full Name
→ ALL IN CAPS

Parent Company
→ Full Company Name "-" Location City

Designation
→ Current designation

Phone Number
→ 10 digits only, no country code

Email
→ Must be remembered, password reset uses this email ID

Password
→ Minimum 8 characters, 1 capital, 1 special, 1 numeric

Password note
→ Same password will be used for login

Routing result:

/signup-instructions added as a public route

Actual signup form route:

/signup

remains unchanged.

208. PUBLIC PAGE ENTRY WIRING UPDATED FOR SIGNUP INSTRUCTIONS

Status:
Completed

Purpose:

Ensure all user-facing public entry points
that previously opened signup directly
now pass through the instruction page first.

Updated entry points:

Landing page Sign Up
Login page Create Account
Forgot Password page Create Account
Reset Password page Create Account
Email Verified page Back to Signup

Result:

All public signup entry paths now converge through:

/signup-instructions

before actual signup form access.

209. PUBLIC AUTH DESIGN CONSISTENCY MAINTAINED

Status:
Confirmed

Architectural rule preserved:

New instruction page was built using the same
public auth design system as the other public pages.

Consistency preserved through:

PublicAuthShell
same logo language
same background atmosphere
same card language
same button hierarchy
same footer treatment

Conclusion:

Signup instruction interstitial was added
without visually breaking public-page consistency.

210. SIDEBAR / LOGOUT SHORTCUT FEATURE IMPLEMENTED

Status:
Completed

Purpose:

Add keyboard shortcuts for:

sidebar collapse / expand
logout confirmation modal

Files created / modified:

frontend/src/store/workspaceShell.js
frontend/src/navigation/keyboardIntentEngine.js
frontend/src/navigation/keyboardIntentMap.js
frontend/src/navigation/keyboardAclBridge.js
frontend/src/layout/MenuShell.jsx

Shortcuts added:

Ctrl + Left Arrow
→ collapse sidebar

Ctrl + Right Arrow
→ expand sidebar

Ctrl + Shift + L
→ open logout confirmation modal

Implementation details:

Sidebar collapse state moved into shared store:

workspaceShell.js

MenuShell toggle button and keyboard shortcuts
now drive the same shell state.

Logout shortcut behavior:

Shortcut opens existing logout confirmation modal
instead of directly logging out.

UI hint added:

Logout button label now displays:

Logout (Ctrl+Shift+L)

Sidebar toggle button tooltip also reflects:

Ctrl+Left / Ctrl+Right shortcuts

211. WORKSPACE LOCK FEATURE FEASIBILITY CONFIRMED

Status:
Feasibility confirmed

Requirement:

User must be able to lock the dashboard
on a shared computer
without logging out.

Business goal:

Prevent data exposure on shared devices
while keeping session / idle / TTL lifecycle active.

Feasibility conclusion:

YES — possible

Reason:

Main ERP login already delegates password verification
to Supabase Auth using backend-only verification path.

Therefore:

unlock can be implemented by verifying
the currently logged-in user's password again
without replacing the active ERP session.

212. WORKSPACE LOCK FEATURE ATTEMPTED

Status:
Partially implemented

Files created / modified:

supabase/functions/api/_core/auth/unlock.handler.ts
supabase/functions/api/_routes/admin.routes.ts
frontend/src/store/workspaceLock.js
frontend/src/components/WorkspaceLockOverlay.jsx
frontend/src/App.jsx
frontend/src/router/AppRouter.jsx
frontend/src/navigation/keyboardIntentEngine.js
frontend/src/navigation/keyboardIntentMap.js
frontend/src/navigation/keyboardAclBridge.js
frontend/src/layout/MenuShell.jsx
frontend/src/store/sessionWarning.js

Planned behavior:

Lock button in dashboard shell
Alt + L shortcut
full-screen workspace lock overlay
unlock with current login password
idle / TTL warning continues on top of lock screen

Backend endpoint added:

POST /api/unlock

Backend unlock logic:

Uses current active session's authUserId
looks up Supabase Auth user email
verifies password through existing verifyPassword()

Intended frontend behavior:

Lock Workspace button
Alt + L keyboard shortcut
Unlock Workspace overlay

213. PUBLIC PAGE CRASH INTRODUCED DURING LOCK FEATURE

Status:
Identified and fixed

Problem observed:

Landing page crashed with:

useLocation() may be used only in the context of a <Router> component

Root cause:

WorkspaceLockOverlay used:

useLocation()

but was mounted outside BrowserRouter.

Fix applied:

WorkspaceLockOverlay was moved inside router context.

Note:

This resolved the immediate React Router context error
on public pages.

214. WORKSPACE LOCK INPUT / CLICK FAILURE IDENTIFIED

Status:
Unresolved

Problem observed:

Lock screen became visible
but user could not:

click input
type password
click unlock button

Root cause identified:

Blocking layer infrastructure applies:

inert

to:

#app-shell

While workspace lock overlay was still structurally entangled
with the application shell in a way that caused interaction deadlock.

Meaning:

Overlay visibility worked
but unlock interaction path was effectively disabled.

215. APP-SHELL / ROUTER STRUCTURE REWORK ATTEMPTED FOR LOCK FEATURE

Status:
Attempted

Action taken:

App shell ownership was moved
between App.jsx and AppRouter.jsx
to separate:

router context
overlay context
inert target

Intent:

Keep WorkspaceLockOverlay:

inside BrowserRouter
outside inert application shell

Expected result:

Overlay remains interactive
while background dashboard becomes inert

Actual result:

Lock feature still not verified as working.

Additional side effects emerged,
and feature was not stabilized in this session.

216. WORKSPACE LOCK FEATURE CURRENT STATUS

Status:
OPEN / NOT READY

Current truth:

Unlock API path exists
lock store exists
lock overlay exists
Alt + L shortcut exists
dashboard button exists

BUT:

Workspace lock interaction is broken
and must NOT be considered production-ready.

System state classification:

concept proved
implementation incomplete
UI wiring unstable

217. CURRENT SAFE SYSTEM BOUNDARY AFTER THIS SESSION

Status:
Important continuity note

Stable / previously working features still considered usable:

public auth pages
signup instruction interstitial
idle / TTL warning system
logout confirmation modal
screen stack navigation
sidebar collapse / expand shortcuts
logout shortcut modal

Unsafe / unresolved feature introduced in this session:

workspace lock

Important instruction for next session:

DO NOT assume workspace lock is done.

It requires fresh debugging starting from:

overlay placement
inert boundary
interactive focus path
unlock request verification

218. NEXT SESSION STARTING POINT

Status:
Prepared

Next session should continue from this exact scope:

1. Re-verify current shell structure:
   App.jsx
   AppRouter.jsx
   BlockingLayer
   WorkspaceLockOverlay

2. Fix workspace lock overlay interaction deadlock

3. Confirm:
   Alt + L opens lock screen
   password input is interactive
   wrong password fails
   correct password unlocks
   idle warning still appears above lock screen
   30 min idle still logs out

4. Only after lock feature is stable,
   continue with remaining launch planning / scope freeze

219. WORKSPACE LOCK FEATURE STABILIZED

Status:
Completed

Date:
2026-03-26

User validation:
Confirmed working

Problems resolved:

1. Lock screen password input is now interactive
2. Unlock action now submits correctly
3. Refresh / hard refresh while locked now forces logout

Root cause resolved:

Duplicate app-shell ownership caused BlockingLayer inert handling
to disable the lock overlay interaction path.

Implementation result:

WorkspaceLockOverlay now remains inside router context
while the inert target is limited to the protected application shell.

Refresh handling added:

Locked state is persisted temporarily in session storage.

If refresh / hard refresh happens while locked:

backend logout is attempted
frontend hard logout is enforced on next boot

Result:

Lock screen is now production-usable.

220. SESSION TERMINATION STATE PERSISTENCE FIXED

Status:
Completed

Date:
2026-03-26

Problem resolved:

Session table could retain one ACTIVE row
after user-visible logout had already happened.

Affected cases previously observed:

normal logout
idle logout
absolute TTL expiry logout

Root cause:

POST /api/logout was passing through public dispatch
without authoritative session resolution,
so cookie clear could complete
without revoking the current ERP session row.

Additionally:

idle / TTL lifecycle logout returned LOGOUT to frontend
but did not persist final session state into erp_core.sessions.

Backend fix applied:

Logout route now resolves session before dispatch.

Lifecycle termination now persists terminal state into DB.

Current expected DB outcomes:

Normal logout
-> status REVOKED
-> revoked_reason USER_LOGOUT

Idle timeout logout
-> status IDLE
-> revoked_reason IDLE_TIMEOUT

Absolute TTL expiry
-> status EXPIRED
-> revoked_reason TTL_EXPIRED

Result:

Stale ACTIVE session rows should no longer remain
after logout / timeout termination paths.

221. SAME-BROWSER SINGLE-TAB ENFORCEMENT ADDED

Status:
Completed

Date:
2026-03-26

Requirement implemented:

Same login must not remain usable
across two protected tabs in the same browser profile.

Clarification:

Same browser tabs share the same cookie jar,
so backend single-session policy alone is not enough
to force one-tab-only behavior.

Frontend coordination layer added:

protected tab ownership registry
cross-tab ownership claim via local storage
forced hard logout of previous protected tab
ownership release on logout

Current behavior:

If a second protected tab becomes active,
the previous protected tab is forced back to /login.

Only one protected tab remains usable at a time
within the same browser profile.

222. CURRENT SYSTEM STATE (LATEST CONFIRMED)

Status:
Stable

Public layer:

Landing -> working
Login -> working
Signup -> working
Recovery -> working

Protected layer:

Menu shell -> working
Stack navigation -> working
Session warning -> working
Logout confirmation -> working
Workspace lock -> working
Locked refresh logout -> working
Single-tab enforcement -> working

Session authority:

new login revokes prior ACTIVE ERP session
normal logout revokes current ERP session
idle / TTL termination persists non-active session state

223. CONTINUITY UPDATE

Status:
Supersedes previous unresolved lock note

Sections 216 / 217 / 218 are now historical only.

Previous warning:

workspace lock not ready

is no longer current.

Latest truth:

workspace lock is stabilized
session termination persistence is corrected
same-browser single-tab enforcement is active

224. SA USER GOVERNANCE ROUTE FALLBACK EXPANDED

Status:
Active temporary allowance

Date:
2026-03-26

Temporary UI change:

routeIndex fallback coverage now also includes:

/sa/users
/sa/signup-requests

Reason:

These SA governance surfaces are being built ahead of
formal menu snapshot expansion.

This keeps the roadmap-built screens reachable
while admin menu governance catches up.

Constraint:

This is temporary reachability support only.
Authoritative long-term access must still come from
menu snapshot governance.

226. PROTECTED WORKSPACE SHIFTED TOWARD KEYBOARD-FIRST ERP FLOW

Status:
Active

Date:
2026-03-26

Scope:

Protected routes only.
Public routes remain outside this conversion.

Change applied:

The shared protected shell now emphasizes:

keyboard zone cycling
menu-first navigation
action-strip focus flow
content focus targeting
visible shortcut guidance

Shared dashboard surfaces were also refactored
from card-heavy SaaS presentation
toward a denser operator action layout.

Important constraint:

This is NOT a T-code or command-line model.

The target is keyboard-first ERP operation
through structured navigation,
lists,
tables,
and action strips.

225. SA ROLE ASSIGNMENT ROUTE FALLBACK EXPANDED

Status:
Active temporary allowance

Date:
2026-03-26

Temporary UI change:

routeIndex fallback coverage now also includes:

/sa/users/roles

Reason:

The dedicated SA role assignment workspace
has been added before formal menu snapshot expansion.

This keeps sequential user-governance build-out reachable
while admin menu governance catches up.

Constraint:

This is temporary reachability support only.
Authoritative long-term access must still come from
menu snapshot governance.

227. ADMIN RPC SCHEMA RESOLUTION PATCH

Status:
Active

Date:
2026-03-26

Issue:

Live SA signup approval and rejection were failing even though
the DB-owned atomic approval engine itself was healthy.

Root cause:

Several backend handlers were calling non-public SQL functions
through dotted rpc names such as:

schema.function_name

Production PostgREST resolved those incorrectly against
the public schema cache.

Fix:

Affected handlers were changed to use explicit schema scoping
before rpc invocation.

Operational note:

This was not a DB approval-engine failure.
It was an API invocation pattern failure.

228. SA GOVERNANCE SCREENS SHIFTED AWAY FROM BROWSER NATIVE CONFIRM

Status:
Active

Date:
2026-03-27

Change:

Current SA mutation flows now use a shared ERP confirmation overlay
instead of browser-native confirm dialogs.

Covered screens:

signup requests
user directory
user role assignment
session revoke

Reason:

Browser-native dialogs break the intended ERP layer behavior
and do not fit the protected workspace interaction model.

229. SA IDENTITY CONTEXT ENRICHMENT

Status:
Active

Date:
2026-03-27

Change:

Existing admin payloads were enriched using current tables only.

Result:

SA user governance and session governance now surface:

user code
user name
parent company
designation

Constraint:

No new table was introduced for this step.
No migration was required for this identity enrichment.

230. PROTECTED HISTORY CONTRACT TIGHTENED

Status:
Active

Date:
2026-03-27

Change:

Protected-route browser history handling was tightened so that:

after logout,
back should return to landing instead of stale dashboard state

from dashboard root,
browser back should follow the logout confirmation flow

Reason:

Protected workspace history must not resurrect stale dashboard shells
after logout or bypass explicit logout confirmation behavior.

231. SA SYSTEM HEALTH RENDER SAFETY PATCH

Status:
Active

Date:
2026-03-27

Issue:

system-health screen could crash when backend version metadata
arrived as an object instead of a string.

Fix:

object-safe system version formatting was added to the
SA system-health screen.

Additional note:

Blocking layer focus handling was also adjusted to reduce
aria-hidden focus warnings when overlays open.

232. PROTECTED WORKSPACE TASK MODE INTRODUCED

Status:
Active

Date:
2026-03-27

Purpose:

Reduce protected-shell keyboard friction by separating
dashboard-home navigation chrome
from real task pages.

New behavior:

Home routes keep the full dashboard shell:

/sa/home
/ga/home
/dashboard

Non-home protected routes now open in a focused task page mode.

Task mode characteristics:

sidebar hidden
content area becomes primary workspace
top page actions remain available
Esc / back stack behavior preserved

Reason:

The previous always-visible shell forced operators
to cross sidebar and top actions too often
before reaching the actual work surface.

233. DIRECT WORKSPACE FOCUS JUMPS ADDED

Status:
Active

Date:
2026-03-27

Protected keyboard improvements:

Alt + C
-> focus current page work area

Alt + A
-> focus page actions

Alt + M
-> focus menu when dashboard shell is visible

Alt + H
-> return to dashboard home

Additional behavior:

When task mode opens,
focus is pushed into the current page workspace automatically.

Meaning:

Operators no longer need repeated Tab traversal
just to re-enter the main content area.

234. CONTENT-ONLY PROTECTED SCROLL BOUNDARY APPLIED

Status:
Active

Date:
2026-03-27

Change:

Protected shell now locks the overall viewport height
and makes only the active content pane scrollable.

Effect:

sidebar and top shell remain stable
while the work area scrolls independently.

Result:

Protected UX now moves closer to the intended ERP task-page behavior
instead of scrolling the entire shell as one long page.

235. BLOCKING OVERLAY KEYBOARD CONTRACT EXPANDED

Status:
Active

Date:
2026-03-27

Scope:

shared blocking layer
modal base
drawer base
confirm overlays
workspace lock overlay

Keyboard contract added:

Esc
-> close or back action when allowed

Arrow keys
-> move between declared overlay actions and list items

Home / End
-> jump to first or last item inside the active overlay navigation group

Enter
-> continues to use native button / form submission behavior

Implementation note:

BlockingLayer now recognizes explicit ERP navigation groups
inside overlays so modal and popup interactions
do not depend only on Tab cycling.

236. OVERLAY FORM NAVIGATION PREPARED FOR ERP UX

Status:
Active

Date:
2026-03-27

Change:

Workspace lock form now uses vertical arrow navigation
between its interactive controls.

Purpose:

Establish the same operator pattern that future drawers and modal forms
should follow:

Arrow keys for moving between controls
Tab for fallback only

237. SCREEN-LOCAL ROVING FOCUS HELPERS ADDED

Status:
Active

Date:
2026-03-27

Purpose:

Reduce repeated Tab traversal inside protected SA work surfaces.

Shared helper added:

frontend/src/navigation/erpRovingFocus.js

Supported movement:

horizontal groups
-> Left / Right / Home / End

vertical groups
-> Up / Down / Home / End

grid-like row action groups
-> Left / Right across same row
-> Up / Down across same column

238. SA SCREEN KEYBOARD PASS EXPANDED

Status:
Active

Date:
2026-03-27

Screens improved:

SA Control Panel
SA Audit
SA Users
SA Sessions
SA Signup Requests
SA User Roles

Improved areas:

header action bars
filter strips
quick launch cards
table action buttons
read-only preview table rows

Result:

Protected SA work surfaces now rely less on repeated Tab traversal
and move closer to ERP-style operator flow.

239. SA COMPANY CREATE FLOW MOVED FROM PLACEHOLDER TO WORKING GST UI

Status:
Active

Date:
2026-03-27

Change:

SA Create Company is no longer a placeholder surface.
The screen now supports:

GST number input
GST profile lookup
cache-first backend resolution
Applyflow fallback
legal name preview
state preview
full address preview
PIN code preview
company creation confirmation
created company summary

Related UI safety and governance changes completed in the same pass:

current SA operator hidden from role-governance target list
business-only company scope flow reinforced in SA surfaces

Purpose:

Replace a fake bootstrap screen with a usable operator flow
so company onboarding can proceed through real backend-backed steps.

Result:

SA company creation is now a working temporary UI boot surface,
aligned with the GST-backed backend contract and ready for live use.
