/*
 * File-ID: 8.1A-MAIN
 * File-Path: frontend/src/main.jsx
 * Gate: 8
 * Phase: 8
 * Domain: FRONT
 * Purpose: Application bootstrap with screen registry validation
 * Authority: Frontend
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

// 🔒 Gate-8 / G1 — Screen Registry Validation
import { validateScreenRegistry } from "./navigation/screenRules.js";
import { enableBackGuard } from "./navigation/backGuardEngine.js";
import { enableKeyboardIntentEngine } from "./navigation/keyboardIntentEngine.js";
import { initNavigation } from "./navigation/screenStackEngine.js";
import { restoreNavigationStack } from "./navigation/navigationPersistence.js";

const API_BASE = import.meta.env.VITE_API_BASE;

// Enforce screen metadata invariants at boot
validateScreenRegistry();
enableBackGuard();
enableKeyboardIntentEngine();
initNavigation("DASHBOARD_HOME");
restoreNavigationStack();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
