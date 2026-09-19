import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAutomationSettingsContextKey,
  isAutomationSettingsDrawerOpenForContext,
} from "./automationDrawerContext.js";

test("context key binds company and surface together", () => {
  const key = buildAutomationSettingsContextKey({ companyId: "CMP003", surfaceKey: "planning_dashboard" });
  assert.equal(key, "companyCMP003planning_dashboard");
});

test("a global (non company-scoped) manifest uses a distinct key shape", () => {
  const key = buildAutomationSettingsContextKey({ companyId: "CMP003", surfaceKey: "planning_dashboard", companyScoped: false });
  assert.equal(key, "globalplanning_dashboard");
});

test("company-scoped context requires a company id", () => {
  assert.equal(buildAutomationSettingsContextKey({ companyId: "", surfaceKey: "planning_dashboard" }), null);
  assert.equal(buildAutomationSettingsContextKey({ surfaceKey: "planning_dashboard" }), null);
});

test("drawer is closed when no context has been opened", () => {
  assert.equal(isAutomationSettingsDrawerOpenForContext({ openedContextKey: null, currentContextKey: "companyCMP003planning_dashboard" }), false);
});

test("drawer stays closed for a fresh visibility response until explicitly opened for this exact context", () => {
  // A new automationVisibility query result never carries an "opened" key by
  // itself -- the drawer only shows once the user's own click sets
  // openedContextKey to the CURRENT context. This is what stops the drawer
  // from auto-reopening after a context resolves.
  const currentContextKey = buildAutomationSettingsContextKey({ companyId: "CMP006", surfaceKey: "report_view" });
  assert.equal(isAutomationSettingsDrawerOpenForContext({ openedContextKey: null, currentContextKey }), false);
});

test("drawer is visible only when the opened context exactly matches the current context", () => {
  const key = buildAutomationSettingsContextKey({ companyId: "CMP003", surfaceKey: "planning_dashboard" });
  assert.equal(isAutomationSettingsDrawerOpenForContext({ openedContextKey: key, currentContextKey: key }), true);
});

test("drawer hides the instant company changes, even though the drawer was never explicitly closed", () => {
  const openedContextKey = buildAutomationSettingsContextKey({ companyId: "CMP003", surfaceKey: "planning_dashboard" });
  const currentContextKey = buildAutomationSettingsContextKey({ companyId: "CMP006", surfaceKey: "planning_dashboard" });
  assert.equal(isAutomationSettingsDrawerOpenForContext({ openedContextKey, currentContextKey }), false);
});

test("drawer hides the instant the surface changes, even though the drawer was never explicitly closed", () => {
  const openedContextKey = buildAutomationSettingsContextKey({ companyId: "CMP003", surfaceKey: "planning_dashboard" });
  const currentContextKey = buildAutomationSettingsContextKey({ companyId: "CMP003", surfaceKey: "report_view" });
  assert.equal(isAutomationSettingsDrawerOpenForContext({ openedContextKey, currentContextKey }), false);
});
