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
import SessionOverlay from "./components/SessionOverlay.jsx";
import LogoutConfirmOverlay from "./components/LogoutConfirmOverlay.jsx";
import ActionConfirmOverlay from "./components/ActionConfirmOverlay.jsx";
import SessionClusterBridge from "./components/SessionClusterBridge.jsx";
import ToastOverlay from "./components/ToastOverlay.jsx";

function App() {
  return (
    <>
      <SessionClusterBridge />
      <AppRouter />
      <SessionOverlay />
      <ToastOverlay />
      <LogoutConfirmOverlay />
      <ActionConfirmOverlay />
    </>
  );
}
export default App;
