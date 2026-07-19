-- ============================================================================
-- post_document — এক transaction-এ পুরো document (feasibility §107.8, CLAUDE.md 8D)
--
-- সমস্যা: আজ প্রতিটা handler TypeScript থেকে movement গুলো **একটা একটা করে** post
-- করে — ৮ লাইনের Process PO = ~৩১টা আলাদা round trip, প্রত্যেকটা **আলাদা commit**।
-- মাঝপথে server মরলে অর্ধেক posting বসে থাকে, আর retry করলে আগেরগুলো দ্বিতীয়বার বসে।
--
-- সমাধান: একটাই call-এ পুরো document। plpgsql function নিজেই একটা transaction —
-- মাঝপথে যেকোনো ব্যর্থতা মানে **সব rollback**, "অর্ধেক" বলে কিছু থাকে না।
-- বোনাস: ~৩১ round trip → ১।
--
-- ⚠️ scale-এ টিকে থাকার চাবি: business write গুলো (stock_ledger_id, issued_qty,
-- status...) handler-ভেদে আলাদা। সেগুলো TypeScript-এ রেখে দিলে আবার transaction-এর
-- বাইরে চলে যেত — আর CI guard সেটা ধরতেও পারত না। তাই প্রতিটা source নিজের
-- **completion function** registry-তে ঘোষণা করে, আর post_document সেটাকে **একই
-- transaction-এর ভিতরে** ডাকে। মনে রাখার কিছু নেই; না দিলে registry অসম্পূর্ণ।
-- ============================================================================

-- ── registry-তে completion function ─────────────────────────────────────────
-- schema আর function আলাদা রাখা হচ্ছে যাতে নিচে %I.%I দিয়ে নিরাপদে quote করা যায়
-- (একটা text field-এ 'schema.fn' রেখে %s দিলে injection-এর দরজা খুলত)।
ALTER TABLE erp_inventory.posting_source_registry
  ADD COLUMN IF NOT EXISTS completion_schema   text,
  ADD COLUMN IF NOT EXISTS completion_function text;

COMMENT ON COLUMN erp_inventory.posting_source_registry.completion_function IS
  'post_document এই function-কে একই transaction-এ ডাকে: fn(reference_document_id uuid, postings jsonb, context jsonb). NULL = এই source এখনো post_document-এ migrate হয়নি।';


CREATE OR REPLACE FUNCTION erp_inventory.post_document(
  p_reference_document_type text,
  p_reference_document_id   uuid,
  p_movements               jsonb,
  p_posted_by               uuid,
  p_context                 jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_inventory, public
AS $fn$
DECLARE
  v_reg        erp_inventory.posting_source_registry%ROWTYPE;
  v_mv         jsonb;
  v_doc_id     uuid;
  v_ledger_id  uuid;
  v_postings   jsonb := '[]'::jsonb;
  v_result     jsonb;
BEGIN
  -- ⚠️ এখানে কোনো EXCEPTION handler নেই, ইচ্ছাকৃতভাবে। যেকোনো ব্যর্থতা উপরে গিয়ে
  -- পুরো transaction rollback করবে — এটাই এই function-এর একমাত্র উদ্দেশ্য।
  -- ভিতরে `EXCEPTION WHEN OTHERS` লিখলে অর্ধেক-posting আবার ফিরে আসবে।

  IF p_movements IS NULL OR jsonb_typeof(p_movements) <> 'array' THEN
    RAISE EXCEPTION 'POST_DOCUMENT_MOVEMENTS_INVALID: expected a JSON array';
  END IF;
  IF jsonb_array_length(p_movements) = 0 THEN
    RAISE EXCEPTION 'POST_DOCUMENT_NO_MOVEMENTS';
  END IF;

  -- Registry gate: অচেনা source এখানেই আটকায়, একটাও posting হওয়ার আগে।
  -- এটাই নতুন module-কে নিজের পরিচয় দিতে বাধ্য করে (8D)।
  SELECT * INTO v_reg
  FROM erp_inventory.posting_source_registry
  WHERE reference_document_type = p_reference_document_type AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST_DOCUMENT_SOURCE_NOT_REGISTERED: %', p_reference_document_type
      USING HINT = 'Add a row to erp_inventory.posting_source_registry first.';
  END IF;

  -- ── movement গুলো array-ক্রমে ────────────────────────────────────────────
  -- ক্রম DEPENDENT (§8B): negative-stock guard আগের posting-এর ফলের উপর নির্ভরশীল,
  -- তাই এগুলো কখনো সমান্তরাল করা যাবে না।
  FOR v_mv IN SELECT value FROM jsonb_array_elements(p_movements)
  LOOP
    SELECT m.stock_document_id, m.stock_ledger_id
      INTO v_doc_id, v_ledger_id
    FROM erp_inventory.post_stock_movement(
      (v_mv->>'document_number'),
      (v_mv->>'document_date')::date,
      (v_mv->>'posting_date')::date,
      (v_mv->>'movement_type_code'),
      (v_mv->>'company_id')::uuid,
      (v_mv->>'storage_location_id')::uuid,
      (v_mv->>'material_id')::uuid,
      (v_mv->>'quantity')::numeric,
      (v_mv->>'base_uom_code'),
      (v_mv->>'unit_value')::numeric,
      (v_mv->>'stock_type_code'),
      (v_mv->>'direction'),
      p_posted_by,
      NULLIF(v_mv->>'reversal_of_id', '')::uuid,
      NULLIF(v_mv->>'batch_number', ''),
      NULLIF(v_mv->>'material_doc_number', ''),
      NULLIF(v_mv->>'material_doc_year', ''),
      NULLIF(v_mv->>'reference_document_number', ''),
      p_reference_document_type,   -- caller-এর দেওয়া মান উপেক্ষা করে document-এরটাই
      p_reference_document_id      -- বসে, যাতে tag কখনো অসঙ্গত না হয়
    ) m;

    v_postings := v_postings || jsonb_build_object(
      'line_ref',          v_mv->>'line_ref',   -- ledger id ↔ business row মেলানোর একমাত্র সূত্র
      'stock_document_id', v_doc_id,
      'stock_ledger_id',   v_ledger_id
    );
  END LOOP;

  -- valuation_rate একবারে যোগ করা (reversal গুলো মূল leg-এর rate-এ ফিরতে হয়, §104-4)
  SELECT jsonb_agg(
           p || jsonb_build_object('valuation_rate', sl.valuation_rate)
           ORDER BY ord
         )
    INTO v_postings
  FROM jsonb_array_elements(v_postings) WITH ORDINALITY AS t(p, ord)
  LEFT JOIN erp_inventory.stock_ledger sl ON sl.id = (t.p->>'stock_ledger_id')::uuid;

  v_result := jsonb_build_object('postings', v_postings);

  -- ── completion: business write গুলো, একই transaction-এর ভিতরে ────────────
  IF v_reg.completion_function IS NOT NULL THEN
    EXECUTE format(
      'SELECT %I.%I($1, $2, $3)',
      COALESCE(v_reg.completion_schema, 'erp_inventory'),
      v_reg.completion_function
    ) USING p_reference_document_id, v_postings, p_context;
  END IF;

  RETURN v_result;
END;
$fn$;

COMMENT ON FUNCTION erp_inventory.post_document(text, uuid, jsonb, uuid, jsonb) IS
  'পুরো document এক transaction-এ post করে (feasibility §107.8)। movement গুলো array-ক্রমে বসে, তারপর registry-তে ঘোষিত completion function একই transaction-এ চলে। যেকোনো ব্যর্থতা = সম্পূর্ণ rollback।';

REVOKE ALL ON FUNCTION erp_inventory.post_document(text, uuid, jsonb, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_inventory.post_document(text, uuid, jsonb, uuid, jsonb) TO service_role;
