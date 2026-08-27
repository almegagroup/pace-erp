#!/usr/bin/env node
/*
 * Company-Scope Write ACL Guard — new pattern, found live 2026-08-11
 * (PO11 Editor/Viewer bug, feasibility-doc-worthy: not yet numbered among the
 * 13 patterns, same family as #2 "Company-scope gap").
 *
 * কী করে: `_core/**​/*.handlers.ts` file-এ যেসব write handler (create/update/
 * delete/upsert/close/... -- read-only get-/list-prefixed handler বাদ) caller-supplied
 * company_id (body বা query, `ctx.context.companyId` না) দিয়ে resolve করে
 * MUTATE করে, তাদের প্রত্যেকের নিজের ভিতরেই একটা independent EDIT-level ACL
 * check থাকতে হবে -- শুধু company MEMBERSHIP check (assertCompanyScope) যথেষ্ট
 * না।
 *
 * কেন দরকার: route-registry-এর `stepAcl()` gate সবসময় `ctx.context.companyId`
 * দিয়ে ACL check করে -- session-এর active company (বা x-company-id header,
 * যেটা আজ শুধু hrApi.js পাঠায়, বাকি কোনো module পাঠায় না)। কিন্তু handler নিজে
 * body/query থেকে ভিন্ন company_id নিয়ে সেই company-তেই লিখে ফেলে, শুধু
 * membership validate করে (assertCompanyScope -- shape #1/#3, company-scope-
 * guard.mjs ইতিমধ্যে এটা enforce করে)। ফলে: একজন user তার session-company-তে
 * EDIT grant থাকলে, শুধু MEMBERSHIP থাকা অন্য যেকোনো company-তেও লিখতে পারে,
 * সেখানে তার EDIT grant না থাকলেও -- কারণ route-level gate ভুল company দিয়ে
 * check করেছিল। PO11 Planning-এ এটাই ছিল (canMaintainPlanning() যোগ করার পরেই
 * ধরা পড়ে -- ৮টা write handler, প্রতিটাতেই fix করা হয়েছে, দেখো
 * planning.handlers.ts-এর requirePlanningEditAccess())।
 *
 * Detection (heuristic, house style -- দেখো company-scope-guard.mjs-এর নিজস্ব
 * সীমাবদ্ধতা-স্বীকৃতি, একই spirit):
 *   1. প্রতিটা exported handler function বের করা হয় (brace-matching)।
 *   2. `get*Handler`/`list*Handler` নাম হলে READ ধরে নেওয়া হয়, স্কিপ (227 টা
 *      handler এই convention মেনে চলে, spot-checked repo-wide)।
 *   3. বাকিদের মধ্যে যাদের body-তে caller-supplied company_id resolve হয় --
 *      `getCompanyScope(ctx,` অথবা কোনো local `\w*CompanyScope(ctx, <body/
 *      query/record-field>` call -- causing MUTATION (insert/update/delete/
 *      upsert দেখা যায় body-তে) -- তাদের body-তে অবশ্যই একটা secondary
 *      EDIT-level check থাকতে হবে: `readAclSnapshotDecisionAny(` অথবা কোনো
 *      local `canMaintain*(`/`require*Access(`/`assert*Edit*(`/
 *      `assert*Maintain*(` call।
 *   4. না থাকলে flag।
 *
 * ⚠️ সীমাবদ্ধতা (ইচ্ছাকৃত, false-positive এড়াতে): এটা function-level regex
 * heuristic, route-registry-এর সাথে cross-reference করে না (VIEW-only action
 * হিসেবে গোপনে wired কোনো "update" নামের handler থাকলে miss হতে পারে) --
 * আর "mutation দেখা যায়" ধরার জন্য শুধু `.insert(`/`.update(`/`.delete(`/
 * `.upsert(` uses গোনে, RPC-only write (`serviceRoleClient.rpc(`) আলাদা করে
 * ধরে না। Silent miss থাকা মানে "spot-check, don't blindly trust" -- code
 * review-এ এই pattern active গ্রেপ করে ধরতে হবে, শুধু script-এর উপর ভরসা কোরো
 * না।
 *
 * BASELINE = আজকের (2026-08-11) known gap, প্রতিটার reason সহ -- অন্য guard
 * গুলোর মতোই একটা ceiling, নতুন gap বসলে FAIL করবে।
 *
 * চালাও:  node scripts/company-scope-write-acl-guard.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCAN_DIR = join(ROOT, "supabase", "functions", "api", "_core");

const READ_ONLY_NAME_RE = /^(get|list)\w*Handler$/;
const SCOPE_RESOLVER_CALL_RE =
  /\b\w*CompanyScope\s*\(\s*ctx\s*,\s*(?!ctx\.context\.companyId\s*[,)])[^)]+\)/;
const MUTATION_CALL_RE = /\.(insert|update|delete|upsert)\s*\(/;
const SECONDARY_ACL_CHECK_RE =
  /readAclSnapshotDecisionAny\s*\(|\bcanMaintain\w*\(|\brequire\w*Access\s*\(|\bassert\w*(Edit|Maintain)\w*\s*\(/;

/*
 * BASELINE -- প্রতিটা entry "file::functionName" শেপে। planning.handlers.ts-এর
 * ৮টা write handler এই session-এই fix হয়ে গেছে (দেখো requirePlanningEditAccess),
 * তাই ওগুলো এখানে নেই। বাকি ১২৬টা 2026-08-11-এ প্রথম scan-এ পাওয়া, এখনো
 * individually review/fix হয়নি -- নিচের header comment দেখো।
 */
const BASELINE = new Set([
  // Known as of 2026-08-11, the day this guard was built (found via a full-repo
  // scan, not individually reviewed yet) -- every one of these resolves a
  // caller-supplied company_id (not ctx.context.companyId) and mutates, with
  // no secondary EDIT-level ACL check for that specific company. Whether each
  // is exploitable depends on how many MULTI-company users actually have a
  // session pinned to a DIFFERENT company than the one they are editing --
  // real today (see PO11/Alim), likely real elsewhere. Tracked as a dedicated
  // remediation sweep, module by module -- do NOT silently shrink this list by
  // deleting entries; only remove one once its handler has an actual EDIT-level
  // check added (same shape as planning.handlers.ts's requirePlanningEditAccess()).
  "supabase/functions/api/_core/om/cost_center.handlers.ts::createCostCenterHandler",
  "supabase/functions/api/_core/om/customer.handlers.ts::createCustomerHandler",
  "supabase/functions/api/_core/om/customer.handlers.ts::mapCustomerToCompanyHandler",
  // Genuinely exempt (2026-08-21), not an unfixed gap: both call the local
  // assertCustomerCompanyScope(ctx, id, resourceCode, actionCode) helper,
  // which internally calls canMaintainCompanyResource() for each of the
  // customer's mapped companies the caller also belongs to -- the real
  // EDIT-level check this guard wants, just one call-frame away from the
  // handler body, which this function-local regex heuristic can't see
  // through. Flagged only because the helper's own name ends in
  // "CompanyScope" (matches SCOPE_RESOLVER_CALL_RE) while its EDIT check
  // lives inside the helper, not inline in the handler.
  "supabase/functions/api/_core/om/customer.handlers.ts::updateCustomerHandler",
  "supabase/functions/api/_core/om/customer.handlers.ts::changeCustomerStatusHandler",
  // §132.5 point 4 (2026-08-27) -- retroactive Vendor-link, same shape as
  // updateCustomerHandler/changeCustomerStatusHandler directly above: calls
  // assertCustomerCompanyScope(ctx, customerId, resourceCode, actionCode),
  // the real canMaintainCompanyResource() check one call-frame away.
  "supabase/functions/api/_core/om/customer.handlers.ts::linkCustomerToVendorHandler",
  // §132.5 point 6 (2026-08-27) -- fg_dispatch_customer.handlers.ts was split:
  // MM05's dead Dispatch-Customer code was deleted, but these 4 live
  // Parent-Company/VDC handlers (still used by MM04's own
  // VdcParentCompanyMasterPage.jsx) moved to fg_parent_company.handlers.ts
  // unchanged -- same exemption reasoning as before (assertParentCompanyScope
  // one call-frame away), just a renamed file.
  "supabase/functions/api/_core/om/fg_parent_company.handlers.ts::createParentCompanyHandler",
  "supabase/functions/api/_core/om/fg_parent_company.handlers.ts::createOrGetDepotCodeHandler",
  // Genuinely exempt (2026-08-22, feasibility doc §129) -- same shape as the
  // customer.handlers.ts exemption above: createCustomerAddressHandler/
  // updateCustomerAddressHandler both call the local
  // assertCustomerCompanyScope(ctx, customerId, resourceCode, actionCode)
  // helper (imported from customer.handlers.ts), which does the real
  // canMaintainCompanyResource() check one call-frame away. updateParentCompanyHandler/
  // updateDepotCodeHandler both call the newly-strengthened local
  // assertParentCompanyScope(ctx, parentCompanyId, resourceCode, actionCode)
  // (upgraded 2026-08-22 from a membership-only check to the same real
  // canMaintainCompanyResource() pattern, precisely to close this class of
  // gap -- see the function's own header comment) -- same one-call-frame-away
  // shape this regex heuristic can't see through.
  "supabase/functions/api/_core/om/customer_address.handlers.ts::createCustomerAddressHandler",
  "supabase/functions/api/_core/om/customer_address.handlers.ts::updateCustomerAddressHandler",
  // Same shape, added 2026-08-22 (dedicated bulk Address<->VDC mapping page):
  // bulkMapCustomerAddressesHandler resolves customerIds[0] from a bulk row
  // lookup (not a single existing.customer_id like its siblings above), then
  // calls the same assertCustomerCompanyScope(ctx, customerIds[0], ...)
  // helper -- the real EDIT-level check is one call-frame away, this regex
  // heuristic only recognizes the single-lookup shape, not the array one.
  "supabase/functions/api/_core/om/customer_address.handlers.ts::bulkMapCustomerAddressesHandler",
  // (see the fg_parent_company.handlers.ts note above -- same split, same file)
  "supabase/functions/api/_core/om/fg_parent_company.handlers.ts::updateParentCompanyHandler",
  "supabase/functions/api/_core/om/fg_parent_company.handlers.ts::updateDepotCodeHandler",
  "supabase/functions/api/_core/om/location.handlers.ts::unmapStorageLocationFromPlantHandler",
  "supabase/functions/api/_core/om/location.handlers.ts::mapStorageLocationToPlantHandler",
  "supabase/functions/api/_core/om/machine.handlers.ts::createMachineHandler",
  "supabase/functions/api/_core/om/material.handlers.ts::extendMaterialToCompanyHandler",
  "supabase/functions/api/_core/om/material.handlers.ts::extendMaterialToPlantHandler",
  "supabase/functions/api/_core/om/material.handlers.ts::createMaterialCategoryGroupHandler",
  "supabase/functions/api/_core/om/number_series.handlers.ts::createNumberSeriesHandler",
  "supabase/functions/api/_core/om/vendor.handlers.ts::mapVendorToCompanyHandler",
  "supabase/functions/api/_core/procurement/csn.handlers.ts::updateCSNHandler",
  "supabase/functions/api/_core/procurement/csn.handlers.ts::createSubCSNHandler",
  "supabase/functions/api/_core/procurement/csn.handlers.ts::confirmDispatchQtyAdjustmentHandler",
  "supabase/functions/api/_core/procurement/csn.handlers.ts::inlineUpdateCSNHandler",
  "supabase/functions/api/_core/procurement/delivery_order.handlers.ts::createDeliveryOrderHandler",
  "supabase/functions/api/_core/procurement/delivery_order.handlers.ts::cancelDeliveryOrderHandler",
  "supabase/functions/api/_core/procurement/gate_entry.handlers.ts::createGateEntryHandler",
  "supabase/functions/api/_core/procurement/grn.handlers.ts::createAndPostGRNFromLineHandler",
  "supabase/functions/api/_core/procurement/grn.handlers.ts::reverseGRNHandler",
  "supabase/functions/api/_core/procurement/invoice_verification.handlers.ts::createIVDraftHandler",
  "supabase/functions/api/_core/procurement/inward_qa.handlers.ts::addTestLineHandler",
  "supabase/functions/api/_core/procurement/inward_qa.handlers.ts::updateTestLineHandler",
  "supabase/functions/api/_core/procurement/inward_qa.handlers.ts::deleteTestLineHandler",
  "supabase/functions/api/_core/procurement/inward_qa.handlers.ts::submitUsageDecisionHandler",
  "supabase/functions/api/_core/procurement/l2_masters.handlers.ts::upsertTransitTimeHandler",
  "supabase/functions/api/_core/procurement/l2_masters.handlers.ts::deleteTransitTimeHandler",
  "supabase/functions/api/_core/procurement/l2_masters.handlers.ts::deleteDomesticLeadTimeHandler",
  "supabase/functions/api/_core/procurement/l2_masters.handlers.ts::updateDomesticLeadTimeHandler",
  "supabase/functions/api/_core/procurement/l2_masters.handlers.ts::upsertDomesticLeadTimeHandler",
  "supabase/functions/api/_core/procurement/l2_masters.handlers.ts::mapTransporterToCompanyHandler",
  "supabase/functions/api/_core/procurement/l2_masters.handlers.ts::mapChaToCompanyHandler",
  "supabase/functions/api/_core/procurement/landed_cost.handlers.ts::createLandedCostHandler",
  "supabase/functions/api/_core/procurement/number_series.handlers.ts::createCompanySeriesHandler",
  "supabase/functions/api/_core/procurement/opening_stock.handlers.ts::createOpeningStockDocumentHandler",
  "supabase/functions/api/_core/procurement/opening_stock.handlers.ts::addOpeningStockLineHandler",
  "supabase/functions/api/_core/procurement/opening_stock.handlers.ts::updateOpeningStockLineHandler",
  "supabase/functions/api/_core/procurement/opening_stock.handlers.ts::removeOpeningStockLineHandler",
  "supabase/functions/api/_core/procurement/opening_stock.handlers.ts::batchUpdateOpeningStockLinesHandler",
  "supabase/functions/api/_core/procurement/opening_stock.handlers.ts::submitOpeningStockDocumentHandler",
  "supabase/functions/api/_core/procurement/opening_stock.handlers.ts::approveOpeningStockDocumentHandler",
  "supabase/functions/api/_core/procurement/opening_stock.handlers.ts::postOpeningStockDocumentHandler",
  "supabase/functions/api/_core/procurement/opening_stock.handlers.ts::recalculateValuationHandler",
  "supabase/functions/api/_core/procurement/po.handlers.ts::createPOHandler",
  "supabase/functions/api/_core/procurement/po.handlers.ts::updatePOHandler",
  "supabase/functions/api/_core/procurement/po.handlers.ts::deletePOHandler",
  "supabase/functions/api/_core/procurement/po.handlers.ts::confirmPOHandler",
  "supabase/functions/api/_core/procurement/po.handlers.ts::approvePOHandler",
  "supabase/functions/api/_core/procurement/po.handlers.ts::rejectPOHandler",
  "supabase/functions/api/_core/procurement/po.handlers.ts::amendPOHandler",
  "supabase/functions/api/_core/procurement/po.handlers.ts::approveAmendmentHandler",
  "supabase/functions/api/_core/procurement/po.handlers.ts::cancelPOHandler",
  "supabase/functions/api/_core/procurement/po.handlers.ts::knockOffPOLineHandler",
  "supabase/functions/api/_core/procurement/po.handlers.ts::knockOffPOHandler",
  "supabase/functions/api/_core/procurement/po.handlers.ts::confirmPOOrderGroupHandler",
  "supabase/functions/api/_core/procurement/po.handlers.ts::approvePOOrderGroupHandler",
  "supabase/functions/api/_core/procurement/po.handlers.ts::rejectPOOrderGroupHandler",
  "supabase/functions/api/_core/procurement/qa_test_method.handlers.ts::createTestMethodHandler",
  "supabase/functions/api/_core/procurement/qa_test_method.handlers.ts::createCategoryTestConfigHandler",
  "supabase/functions/api/_core/procurement/rtv.handlers.ts::createRTVHandler",
  "supabase/functions/api/_core/procurement/sales_order.handlers.ts::createSOHandler",
  "supabase/functions/api/_core/procurement/sales_order.handlers.ts::createSalesInvoiceHandler",
  "supabase/functions/api/_core/procurement/sto.handlers.ts::createSTOHandler",
  "supabase/functions/api/_core/procurement/sto.handlers.ts::updateGateExitOutboundWeightHandler",
  "supabase/functions/api/_core/production/batch_series.handlers.ts::releaseBatchNumberHandler",
  "supabase/functions/api/_core/production/conversion_cost.handlers.ts::createConversionRateHandler",
  "supabase/functions/api/_core/production/costing_group.handlers.ts::createSlocGroupHandler",
  "supabase/functions/api/_core/production/costing_group.handlers.ts::addSlocGroupMemberHandler",
  "supabase/functions/api/_core/production/costing_group.handlers.ts::removeSlocGroupMemberHandler",
  "supabase/functions/api/_core/production/costing_group.handlers.ts::createCostingGroupHandler",
  "supabase/functions/api/_core/production/costing_group.handlers.ts::addCostingGroupMemberHandler",
  "supabase/functions/api/_core/production/costing_group.handlers.ts::removeCostingGroupMemberHandler",
  "supabase/functions/api/_core/production/costing_group.handlers.ts::saveCostingRateDraftHandler",
  "supabase/functions/api/_core/production/costing_group.handlers.ts::approveCostingRateHandler",
  "supabase/functions/api/_core/production/mts_sku_rate.handlers.ts::saveMtsSkuRateDraftHandler",
  "supabase/functions/api/_core/production/mts_sku_rate.handlers.ts::approveMtsSkuRateHandler",
  "supabase/functions/api/_core/production/opening_genealogy.handlers.ts::createOldProcessPoHandler",
  "supabase/functions/api/_core/production/opening_genealogy.handlers.ts::createOldPackingPoHandler",
  // packing_order.handlers.ts's 7 write handlers fixed 2026-08-12 (canMaintainCompanyResource
  // added after assertPackingCompanyScope in each) -- removed from baseline.
  "supabase/functions/api/_core/production/pack_bom.handlers.ts::createPackBomHandler",
  "supabase/functions/api/_core/production/pack_bom.handlers.ts::approvePackBomHandler",
  "supabase/functions/api/_core/production/pack_bom.handlers.ts::rejectPackBomHandler",
  "supabase/functions/api/_core/production/pack_bom.handlers.ts::createPackBomChangeRequestHandler",
  "supabase/functions/api/_core/production/pack_bom.handlers.ts::approvePackBomChangeRequestHandler",
  "supabase/functions/api/_core/production/pack_bom.handlers.ts::rejectPackBomChangeRequestHandler",
  "supabase/functions/api/_core/production/partial_reversal.handlers.ts::createPartialBatchReversalHandler",
  "supabase/functions/api/_core/production/plan_feed.handlers.ts::createPlanFeedHandler",
  "supabase/functions/api/_core/production/plan_feed.handlers.ts::updatePlanFeedHandler",
  "supabase/functions/api/_core/production/plan_feed.handlers.ts::cancelPlanFeedHandler",
  "supabase/functions/api/_core/production/plan_feed.handlers.ts::reactivatePlanFeedHandler",
  "supabase/functions/api/_core/production/plan_feed.handlers.ts::upsertFoAllocationHandler",
  // process_order.handlers.ts's 10 write handlers + correctProcessOrderHandler fixed
  // 2026-08-12 (canMaintainCompanyResource added after assertCompanyScope in each) --
  // removed from baseline. completeIntProcessOrderHandler was already dead (merged
  // into finalizeProcessOrderHandler by the earlier INT/MTEST lifecycle redesign),
  // removed as stale rather than "fixed".
  "supabase/functions/api/_core/production/segment_location.handlers.ts::upsertSegmentLocationHandler",
  "supabase/functions/api/_core/production/sfg_qa.handlers.ts::addSfgQaTestLineHandler",
  "supabase/functions/api/_core/production/sfg_qa.handlers.ts::updateSfgQaTestLineHandler",
  "supabase/functions/api/_core/production/sfg_qa.handlers.ts::submitSfgQaDecisionHandler",
  "supabase/functions/api/_core/production/stroke_change_request.handlers.ts::createStrokeChangeRequestHandler",
  "supabase/functions/api/_core/production/stroke_change_request.handlers.ts::approveStrokeChangeRequestHandler",
  "supabase/functions/api/_core/production/stroke_change_request.handlers.ts::rejectStrokeChangeRequestHandler",
  "supabase/functions/api/_core/production/stroke_master.handlers.ts::createStrokeMasterHandler",
  "supabase/functions/api/_core/production/stroke_master.handlers.ts::updateStrokeMasterHandler",
  "supabase/functions/api/_core/production/stroke_master.handlers.ts::approveStrokeMasterHandler",
  "supabase/functions/api/_core/production/stroke_master.handlers.ts::rejectStrokeMasterHandler",
  "supabase/functions/api/_core/production/stroke_master.handlers.ts::deactivateStrokeMasterHandler",
  "supabase/functions/api/_core/production/stroke_master.handlers.ts::reactivateStrokeMasterHandler",
  "supabase/functions/api/_core/production/stroke_master.handlers.ts::revertStrokeMasterHandler",
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".handlers.ts") || entry.endsWith(".handler.ts")) out.push(full);
  }
  return out;
}

function relPath(file) {
  return relative(ROOT, file).split(sep).join("/");
}

function findMatchingBraceEnd(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractHandlerFunctions(src) {
  const fns = [];
  const fnRe = /export\s+async\s+function\s+(\w+)\s*\(/g;
  let m;
  while ((m = fnRe.exec(src))) {
    const name = m[1];
    const parenStart = m.index + m[0].length - 1;
    let depth = 0;
    let i = parenStart;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    const braceStart = src.indexOf("{", i);
    if (braceStart === -1) continue;
    const braceEnd = findMatchingBraceEnd(src, braceStart);
    if (braceEnd === -1) continue;
    fns.push({ name, body: src.slice(braceStart, braceEnd + 1) });
  }
  return fns;
}

const violations = [];
let candidateCount = 0;

for (const file of walk(SCAN_DIR)) {
  const src = readFileSync(file, "utf8");
  const rel = relPath(file);
  for (const { name, body } of extractHandlerFunctions(src)) {
    if (READ_ONLY_NAME_RE.test(name)) continue;
    if (!SCOPE_RESOLVER_CALL_RE.test(body)) continue;
    if (!MUTATION_CALL_RE.test(body)) continue;
    candidateCount += 1;
    if (SECONDARY_ACL_CHECK_RE.test(body)) continue;
    const key = `${rel}::${name}`;
    if (BASELINE.has(key)) continue;
    violations.push(key);
  }
}

console.log(
  `Company-scope write ACL guard — ${candidateCount} write handler(s) resolve a caller-supplied company_id and mutate, ${violations.length} without a secondary EDIT-level ACL check`,
);

if (violations.length > 0) {
  console.error("\nFAIL — these write handlers resolve company_id from the caller (not ctx.context.companyId) and mutate, but call no secondary EDIT-level ACL check:");
  for (const key of violations) {
    console.error(`  ${key}`);
  }
  console.error(`
The route-registry's stepAcl() gate checks ctx.context.companyId (the
session's active company, or the x-company-id header -- which today only
hrApi.js sends). A handler that resolves a DIFFERENT company_id from the
request body/query (via getCompanyScope() or a similar local helper) and then
mutates using that company_id is validated by stepAcl against the WRONG
company. assertCompanyScope() inside getCompanyScope() only proves company
MEMBERSHIP, not that the caller's ACL grant at that specific company is
EDIT -- so a user with EDIT at their session's company but only membership
(or a lesser grant) at the body's target company can still write there.

Found live 2026-08-11: PO11 Planning's 8 write handlers had exactly this gap
(planning.handlers.ts, fixed via requirePlanningEditAccess() -- use that as
the template). Fix: after resolving companyId, call
readAclSnapshotDecisionAny() (or a local canMaintain*/require*Access helper
that wraps it) for that SPECIFIC companyId and 403 if it doesn't return
ALLOW for the resource:action this write actually performs.

If a flagged handler is genuinely exempt (e.g. company_id here is not
security-relevant, or ACL enforcement happens at a shared RPC/DB function
instead), add "file::functionName" to BASELINE in this script with a
one-line reason -- do not leave it unguarded silently.`);
  process.exit(1);
}

console.log("OK — every write handler with a caller-supplied company_id verifies EDIT-level ACL at that specific company.");
