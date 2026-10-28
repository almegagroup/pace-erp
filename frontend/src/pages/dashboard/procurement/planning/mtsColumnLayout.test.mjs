import assert from "node:assert/strict";
import test from "node:test";
import { applyHidden, hiddenFromSaved, pickableColumns, toggleHidden, visibleKeys } from "./mtsColumnLayout.js";

const columns = [
  { key: "material", label: "Material", group: "identity" },
  { key: "sources", label: "", group: "identity" },
  { key: "stock", label: "Stock", group: "stock" },
  { key: "intransit", label: "In transit", group: "stock" },
  { key: "target", label: "Target", group: "policy" },
];

test("identity columns are always shown and never offered in the picker", () => {
  assert.deepEqual(pickableColumns(columns).map((c) => c.key), ["stock", "intransit", "target"]);
  const hidden = new Set(["stock", "material"]);
  assert.deepEqual(applyHidden(columns, hidden).map((c) => c.key), ["material", "sources", "intransit", "target"], "material cannot be hidden");
});

test("unchecking a column hides it live and the list of visible keys follows", () => {
  let hidden = new Set();
  hidden = toggleHidden(hidden, "intransit");
  assert.deepEqual(visibleKeys(columns, hidden), ["stock", "target"]);
  assert.deepEqual(applyHidden(columns, hidden).map((c) => c.key), ["material", "sources", "stock", "target"]);
  hidden = toggleHidden(hidden, "intransit");
  assert.equal(hidden.size, 0);
});

test("a saved layout hides what it left out, but shows a column that was added after it was saved", () => {
  const hidden = hiddenFromSaved(["stock"], columns, ["stock", "intransit"]);
  assert.deepEqual([...hidden], ["intransit"], "target did not exist when the layout was saved: shown");
  assert.deepEqual(hiddenFromSaved(null, columns).size, 0, "no layout: nothing hidden");
});
