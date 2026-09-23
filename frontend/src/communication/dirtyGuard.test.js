import assert from "node:assert/strict";
import test from "node:test";
import { withDirtyGuard } from "./dirtyGuard.js";

function tracker() {
  const calls = [];
  return { calls, record: (name) => () => calls.push(name) };
}

test("clean (not dirty) transition applies immediately without prompting", async () => {
  const { calls, record } = tracker();
  let confirmCalls = 0;
  const result = await withDirtyGuard({
    isDirty: false,
    confirm: async () => { confirmCalls += 1; return true; },
    onDiscard: record("discard"),
    apply: record("apply"),
  });
  assert.equal(result, true);
  assert.equal(confirmCalls, 0);
  assert.deepEqual(calls, ["apply"]);
});

test("dirty transition + Cancel/Keep Editing never discards or applies", async () => {
  const { calls, record } = tracker();
  const result = await withDirtyGuard({
    isDirty: true,
    confirm: async () => false,
    onDiscard: record("discard"),
    apply: record("apply"),
  });
  assert.equal(result, false);
  assert.deepEqual(calls, []);
});

test("dirty transition + Discard clears state before applying the change", async () => {
  const { calls, record } = tracker();
  const result = await withDirtyGuard({
    isDirty: true,
    confirm: async () => true,
    onDiscard: record("discard"),
    apply: record("apply"),
  });
  assert.equal(result, true);
  assert.deepEqual(calls, ["discard", "apply"]);
});

test("a cancelled company transition never transplants the draft into the new company", async () => {
  let currentCompany = "CMP003";
  let draftCompany = "CMP003";
  const result = await withDirtyGuard({
    isDirty: true,
    confirm: async () => false,
    onDiscard: () => { draftCompany = null; },
    apply: () => { currentCompany = "CMP006"; },
  });
  assert.equal(result, false);
  assert.equal(currentCompany, "CMP003", "company must not change on Cancel");
  assert.equal(draftCompany, "CMP003", "draft must still belong to the original company");
});

test("a confirmed company transition discards the draft and only then changes company", async () => {
  let currentCompany = "CMP003";
  let draftCompany = "CMP003";
  const order = [];
  const result = await withDirtyGuard({
    isDirty: true,
    confirm: async () => true,
    onDiscard: () => { draftCompany = null; order.push("discard"); },
    apply: () => { currentCompany = "CMP006"; order.push("apply"); },
  });
  assert.equal(result, true);
  assert.equal(currentCompany, "CMP006");
  assert.equal(draftCompany, null, "draft is discarded, never carried into the new company");
  assert.deepEqual(order, ["discard", "apply"]);
});

test("a cancelled surface (tab) transition never transplants the draft into the new surface", async () => {
  let currentSurface = "planning_dashboard";
  let draftSurface = "planning_dashboard";
  const result = await withDirtyGuard({
    isDirty: true,
    confirm: async () => false,
    onDiscard: () => { draftSurface = null; },
    apply: () => { currentSurface = "report_view"; },
  });
  assert.equal(result, false);
  assert.equal(currentSurface, "planning_dashboard");
  assert.equal(draftSurface, "planning_dashboard");
});

test("a confirmed surface transition discards the draft and only then changes surface", async () => {
  let currentSurface = "planning_dashboard";
  let draftSurface = "planning_dashboard";
  const result = await withDirtyGuard({
    isDirty: true,
    confirm: async () => true,
    onDiscard: () => { draftSurface = null; },
    apply: () => { currentSurface = "report_view"; },
  });
  assert.equal(result, true);
  assert.equal(currentSurface, "report_view");
  assert.equal(draftSurface, null);
});
