import {
  DEPENDENT_DEPOT_LATE_PGI_EXCEPTION_END,
  hasDependentDepotLatePgiException,
} from "./dispatchBackfillPosting.ts";

function equal(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: ${actual}`);
}

Deno.test("Dependent Depot late-PGI exception is limited and expires automatically", () => {
  equal(DEPENDENT_DEPOT_LATE_PGI_EXCEPTION_END, "2026-11-15", "published cutoff");
  equal(hasDependentDepotLatePgiException("DEPENDENT_DEPOT", "2026-11-15"), true, "cutoff day remains available");
  equal(hasDependentDepotLatePgiException(" dependent_depot ", "2026-11-15"), true, "dispatch type is normalized");
  equal(hasDependentDepotLatePgiException("DEPENDENT_DEPOT", "2026-11-16"), false, "rule resumes the next day");
  equal(hasDependentDepotLatePgiException("DEPENDENT_DIRECT", "2026-11-15"), false, "other dispatch types remain blocked");
  equal(hasDependentDepotLatePgiException(null, "2026-11-15"), false, "missing type never receives exception");
});
