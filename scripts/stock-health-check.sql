-- ============================================================================
-- PACE ERP — Stock Health Check
--
-- কী: stock layer-এর consistency invariant গুলো এক নজরে যাচাই করে।
-- কেন: stock posting গুলো এক transaction-এ নয় (CLAUDE.md 8D) — মাঝপথে server
--      crash/deploy হলে অর্ধেক posting বসে থাকতে পারে। সেটা নিঃশব্দে বসে থাকলে
--      মাস পরে PID-তে ধরা পড়বে, ততদিনে কারণ খুঁজে পাওয়া যাবে না।
--
-- কখন চালাবে: go-live-এর দিন থেকে প্রতিদিন কাজ শেষে (dev ও prod আলাদা করে)।
-- কীভাবে: পুরো file টা Supabase SQL Editor-এ paste করে চালাও।
--         severity কলামে 'FAIL' এলে থামো — কেউ না বোঝা পর্যন্ত আর posting কোরো না।
--
-- ⚠️ নকশার নীতি — কেন এখানে কোনো business table-এর তালিকা নেই:
--    হাতে লেখা তালিকা বাসি হয়ে যায়। নতুন module (Dispatch/Return/L5...) এলে
--    তালিকা চুপচাপ সেটা বাদ দেবে, আর আমরা ভুল করে নিরাপদ ভাববো — যা check না
--    থাকার চেয়েও খারাপ। তাই Tier 1-এর সব check শুধু `stock_ledger`,
--    `stock_snapshot`, `stock_document` দেখে — যেখান দিয়ে প্রতিটা posting যেতে
--    *বাধ্য*, কারণ সবাই `post_stock_movement()` ডাকে। নতুন handler লিখলেও এই
--    check নিজে থেকেই তাকে ঢেকে ফেলে; কখনো update করতে হয় না।
--
--    Business row থেকে posting খোঁজা এখানে ইচ্ছে করেই বাদ — সেই link-এর কোনো
--    সর্বজনীন নিয়ম নেই (৪ রকম column নাম, আর STO-তে কিছুই নেই)। বিস্তারিত 8D।
-- ============================================================================

WITH ledger_bucket AS (
  SELECT company_id, storage_location_id, material_id, stock_type_code,
         SUM(CASE WHEN direction = 'IN' THEN quantity ELSE -quantity END) AS ledger_qty
  FROM erp_inventory.stock_ledger
  GROUP BY 1, 2, 3, 4
),
snapshot_bucket AS (
  -- post_stock_movement() snapshot-এ batch_id সবসময় NULL রাখে (8D/83.15), তাই
  -- এখানেও batch-blind ভাবেই মেলাতে হবে — নাহলে মিথ্যা mismatch দেখাবে।
  SELECT company_id, storage_location_id, material_id, stock_type_code, quantity AS snap_qty
  FROM erp_inventory.stock_snapshot
  WHERE batch_id IS NULL
),
result AS (

  -- 1. snapshot হলো ledger-এর cached running total. দুটো আলাদা হওয়া মানে হয়
  --    posting মাঝপথে থেমেছে, নয়তো কেউ ledger/snapshot সরাসরি ছুঁয়েছে।
  SELECT 1 AS ord, 'snapshot_vs_ledger' AS check_name,
         count(*) AS bad_count,
         'snapshot disagrees with the ledger sum' AS meaning
  FROM ledger_bucket
  FULL JOIN snapshot_bucket USING (company_id, storage_location_id, material_id, stock_type_code)
  WHERE COALESCE(ledger_qty, 0) <> COALESCE(snap_qty, 0)

  UNION ALL

  -- 2. negative stock কখনো বৈধ নয় — issue হয়েছে কিন্তু receipt বসেনি।
  SELECT 2, 'negative_stock_ledger', count(*),
         'negative balance in ledger'
  FROM ledger_bucket WHERE ledger_qty < 0

  UNION ALL

  SELECT 3, 'negative_stock_snapshot', count(*),
         'negative balance in snapshot'
  FROM erp_inventory.stock_snapshot WHERE quantity < 0

  UNION ALL

  -- 3. প্রতিটা ledger row একটা stock_document-এর অধীন থাকার কথা (8C).
  SELECT 4, 'orphan_ledger_rows', count(*),
         'ledger row with no stock_document'
  FROM erp_inventory.stock_ledger sl
  LEFT JOIN erp_inventory.stock_document sd ON sd.id = sl.stock_document_id
  WHERE sd.id IS NULL

  UNION ALL

  -- 4. document তৈরি হয়েছে কিন্তু একটাও ledger row বসেনি = posting শুরু হয়ে
  --    ঠিক মাঝপথে থেমে গেছে। partial posting-এর সবচেয়ে সরাসরি চিহ্ন।
  SELECT 5, 'documents_without_ledger', count(*),
         'stock_document with no ledger row'
  FROM erp_inventory.stock_document sd
  LEFT JOIN erp_inventory.stock_ledger sl ON sl.stock_document_id = sd.id
  WHERE sl.id IS NULL
)

SELECT check_name,
       CASE WHEN bad_count = 0 THEN 'OK' ELSE 'FAIL' END AS severity,
       bad_count,
       meaning
FROM result

UNION ALL

-- 5. Coverage watch (informational, FAIL নয়).
--    ledger-link column বহন করা business table-এর সংখ্যা। 2026-07-19-এ = 22.
--    সংখ্যা বাড়া মানে নতুন posting module এসেছে — তখন 8D-র ধাপ ৩
--    (idempotency guard) নতুন module-এও লাগবে কিনা ভেবে দেখো।
--    ⚠️ এটা Tier 1 check-এর coverage নয় — সেগুলো এমনিতেই সব ঢাকে। এটা শুধু
--    "নতুন কিছু যুক্ত হয়েছে" জানান দেওয়ার ঘণ্টা।
SELECT 'coverage_watch',
       'INFO',
       count(*),
       'business tables carrying a ledger link (baseline 22)'
FROM information_schema.columns
WHERE column_name ~ '(^|_)stock_(ledger|document)_id$'
  AND table_schema LIKE 'erp_%'
  AND table_name <> 'stock_ledger'

ORDER BY severity DESC, check_name;
