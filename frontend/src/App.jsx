/*
 * File-ID: 7.6D
 * File-Path: frontend/src/App.jsx
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Inject menu authority provider and router
 * Authority: Frontend
 */

import AppRouter from "./router/AppRouter.jsx";
import WorkspaceLockOverlay from "./components/WorkspaceLockOverlay.jsx";
import SessionOverlay from "./components/SessionOverlay.jsx";
import LogoutConfirmOverlay from "./components/LogoutConfirmOverlay.jsx";

function App() {
  return (
    <>
      <div id="app-shell">
        <AppRouter />
      </div>
      <WorkspaceLockOverlay />
      <SessionOverlay />
      <LogoutConfirmOverlay />
    </>
  );
}
export default App;
