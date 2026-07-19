-- ============================================================================
-- Posting Source Registry + Stock Health Check  (CLAUDE.md 8D, step 2)
--
-- সমস্যা: stock posting গুলো এক transaction-এ নয় — মাঝপথে server crash/deploy
-- হলে অর্ধেক posting বসে থাকতে পারে, আর সেটা নিঃশব্দে বসে থাকে।
--
-- কেন registry: হাতে লেখা "১২টা table"-এর তালিকা বাসি হয়ে যায় — নতুন module
-- (Dispatch/Return/L5...) এলে তালিকা চুপচাপ সেটা বাদ দিত আর আমরা ভুল করে নিরাপদ
-- ভাবতাম। এখানে উল্টো: check নিজে registry পড়ে, আর **registry-তে নেই এমন
-- posting দেখলে FAIL করে**। অর্থাৎ নতুন module হয় registry-তে ঢোকে, নয়তো
-- check চিৎকার করে — নীরবে বাদ পড়ার পথ নেই।
-- (frontend-এর screenRegistry + validateScreenRegistry ঠিক এই idiom।)
--
-- নতুন posting module যোগ করলে: এখানে এক লাইন INSERT করো, ব্যস। check নিজে
-- থেকেই ওটা ঢেকে ফেলবে; script কখনো hand-edit করতে হবে না।
-- ============================================================================

CREATE TABLE IF NOT EXISTS erp_inventory.posting_source_registry (
  reference_document_type text PRIMARY KEY,
  label                   text NOT NULL,
  source_schema           text NOT NULL,
  source_table            text NOT NULL,
  status_column           text NOT NULL DEFAULT 'status',

  -- যে status গুলোতে posting থাকা **অস্বাভাবিক** — অর্থাৎ handler ওই status-এ
  -- posting শুরু করে, শেষ করে অন্য status-এ। তাই "এই status + posting আছে"
  -- মানে কাজটা মাঝপথে থেমে গেছে।
  --
  -- ⚠️ terminal status নয়। REVERSED/CANCELLED-ও terminal নয় কিন্তু সম্পূর্ণ
  -- বৈধ (CORS reversal-এর পর posting থাকবেই, counter-posting সহ) — তাই সেগুলো
  -- suspect তালিকায় রাখা যাবে না, নাহলে মিথ্যা FAIL আসবে।
  suspect_statuses        text[] NOT NULL,

  is_active               boolean NOT NULL DEFAULT true,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_inventory.posting_source_registry IS
  'stock_document.reference_document_type -> কোন business table, আর কোন status-এ posting থাকা অস্বাভাবিক। CLAUDE.md 8D।';

-- ── Seed: go-live-এ রোজ চলবে এমন ৫টা (CLAUDE.md 8D ধাপ ৩-এর একই তালিকা) ──
-- status মানগুলো live CHECK constraint থেকে নেওয়া, অনুমান নয়।
INSERT INTO erp_inventory.posting_source_registry
  (reference_document_type, label, source_schema, source_table, status_column, suspect_statuses, notes)
VALUES
  ('PROC_PO', 'Process PO (Verify)',   'erp_production',  'process_order',          'status', ARRAY['FINAL'],
   'Verify FINAL-এ ঢোকে, VERIFIED-এ বেরোয়। Final নিজে কিছু post করে না (83.4), তাই FINAL + posting = Verify মাঝপথে থেমেছে।'),
  ('PACK_PO', 'Packing PO (Final)',    'erp_production',  'packing_order',          'status', ARRAY['STANDARD'],
   'Final STANDARD-এ ঢোকে, FINAL-এ বেরোয়। Create কিছু post করে না।'),
  ('GRN',     'Goods Receipt',         'erp_procurement', 'goods_receipt',          'status', ARRAY['DRAFT'],
   'DRAFT -> POSTED।'),
  ('OS',      'Opening Stock',         'erp_procurement', 'opening_stock_document', 'status', ARRAY['APPROVED'],
   'APPROVED -> POSTED। go-live-এর দিনে সবচেয়ে জরুরি।'),
  ('QA',      'Inward QA Decision',    'erp_procurement', 'inward_qa_document',     'status', ARRAY['PENDING','IN_PROGRESS'],
   'DECIDED-এ শেষ হয়। DECIDED না হয়েও posting থাকলে decision মাঝপথে থেমেছে।')
ON CONFLICT (reference_document_type) DO NOTHING;


-- ============================================================================
-- erp_inventory.stock_health_check()
--
-- চালাও:  SELECT * FROM erp_inventory.stock_health_check();
-- severity = 'FAIL' এলে থামো — কারণ না বোঝা পর্যন্ত আর posting কোরো না।
--
-- p_tagging_enforced_from: এই তারিখের আগের posting গুলোতে reference tag নেই
-- (tagging এসেছে 106 Phase 2-তে, 2026-07-17)। পুরনো data চিরকাল FAIL দেখাবে
-- না — সেগুলো আলাদা INFO লাইনে গোনা হয়।
-- ============================================================================

CREATE OR REPLACE FUNCTION erp_inventory.stock_health_check(
  p_tagging_enforced_from date DEFAULT DATE '2026-07-16'
)
RETURNS TABLE (check_name text, severity text, bad_count bigint, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_inventory, public
AS $$
DECLARE
  r        record;
  v_count  bigint;
BEGIN
  -- ────────── Tier 1: সর্বজনীন invariant (কোনো table-এর নাম লাগে না) ──────────
  -- এগুলো শুধু stock_ledger/stock_snapshot/stock_document দেখে, যেখান দিয়ে
  -- প্রতিটা posting যেতে বাধ্য (সবাই post_stock_movement() ডাকে)।

  RETURN QUERY
  WITH led AS (
    SELECT company_id, storage_location_id, material_id, stock_type_code,
           SUM(CASE WHEN direction='IN' THEN quantity ELSE -quantity END) AS q
    FROM erp_inventory.stock_ledger GROUP BY 1,2,3,4
  ), snp AS (
    -- post_stock_movement() snapshot-এ batch_id সবসময় NULL রাখে, তাই batch-blind মেলানো
    SELECT company_id, storage_location_id, material_id, stock_type_code, quantity AS q
    FROM erp_inventory.stock_snapshot WHERE batch_id IS NULL
  )
  SELECT 'snapshot_vs_ledger',
         CASE WHEN count(*)=0 THEN 'OK' ELSE 'FAIL' END,
         count(*),
         'snapshot disagrees with the ledger sum'
  FROM led FULL JOIN snp USING (company_id, storage_location_id, material_id, stock_type_code)
  WHERE COALESCE(led.q,0) <> COALESCE(snp.q,0);

  RETURN QUERY
  SELECT 'negative_stock',
         CASE WHEN count(*)=0 THEN 'OK' ELSE 'FAIL' END,
         count(*),
         'negative balance in stock_snapshot'
  FROM erp_inventory.stock_snapshot WHERE quantity < 0;

  RETURN QUERY
  SELECT 'orphan_ledger_rows',
         CASE WHEN count(*)=0 THEN 'OK' ELSE 'FAIL' END,
         count(*),
         'ledger row with no stock_document'
  FROM erp_inventory.stock_ledger sl
  LEFT JOIN erp_inventory.stock_document sd ON sd.id = sl.stock_document_id
  WHERE sd.id IS NULL;

  RETURN QUERY
  SELECT 'documents_without_ledger',
         CASE WHEN count(*)=0 THEN 'OK' ELSE 'FAIL' END,
         count(*),
         'stock_document exists but posted no ledger row'
  FROM erp_inventory.stock_document sd
  LEFT JOIN erp_inventory.stock_ledger sl ON sl.stock_document_id = sd.id
  WHERE sl.id IS NULL;

  -- ────────── Tier 2: registry-চালিত (এটাই future-proofing) ──────────

  -- 2a. registry-তে নেই এমন type — নতুন module register না করলে এখানে ধরা পড়বে।
  RETURN QUERY
  SELECT 'unregistered_posting_source',
         CASE WHEN count(*)=0 THEN 'OK' ELSE 'FAIL' END,
         count(*),
         'stock_document rows whose reference_document_type is not in posting_source_registry'
  FROM erp_inventory.stock_document sd
  WHERE sd.reference_document_type IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM erp_inventory.posting_source_registry reg
      WHERE reg.reference_document_type = sd.reference_document_type);

  -- 2b. tag-ই নেই — handler reference পাঠাতে ভুলে গেলে এখানে ধরা পড়বে।
  RETURN QUERY
  SELECT 'untagged_posting',
         CASE WHEN count(*)=0 THEN 'OK' ELSE 'FAIL' END,
         count(*),
         'postings on/after the tagging cutoff with no reference_document_type'
  FROM erp_inventory.stock_document
  WHERE reference_document_type IS NULL
    AND created_at >= p_tagging_enforced_from;

  RETURN QUERY
  SELECT 'legacy_untagged_posting',
         'INFO',
         count(*),
         'pre-cutoff postings with no reference tag (expected, not an error)'
  FROM erp_inventory.stock_document
  WHERE reference_document_type IS NULL
    AND created_at < p_tagging_enforced_from;

  -- 2c. আসল partial-posting check: registry-র প্রতিটা source ধরে ধরে দেখা —
  --     posting হয়ে গেছে অথচ business document এখনো ওই status-এ পড়ে আছে
  --     যেখান থেকে handler posting *শুরু* করে।
  FOR r IN
    SELECT * FROM erp_inventory.posting_source_registry
    WHERE is_active ORDER BY reference_document_type
  LOOP
    EXECUTE format(
      'SELECT count(DISTINCT sd.reference_document_id)
         FROM erp_inventory.stock_document sd
         JOIN %I.%I src ON src.id = sd.reference_document_id
        WHERE sd.reference_document_type = %L
          AND src.%I = ANY (%L::text[])',
      r.source_schema, r.source_table, r.reference_document_type,
      r.status_column, r.suspect_statuses
    ) INTO v_count;

    RETURN QUERY SELECT
      'partial_posting__' || r.reference_document_type,
      CASE WHEN v_count = 0 THEN 'OK' ELSE 'FAIL' END,
      v_count,
      r.label || ': posted but still at ' || array_to_string(r.suspect_statuses, '/');
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION erp_inventory.stock_health_check(date) IS
  'Stock consistency + partial-posting health check. registry-চালিত, তাই নতুন posting module নিজে থেকেই ঢাকা পড়ে। CLAUDE.md 8D।';
