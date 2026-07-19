-- ============================================================================
-- complete_process_po_verify — Process PO Verify-র business write গুলো
-- (feasibility §107.8, CLAUDE.md 8D ধাপ ৪)
--
-- `post_document` movement গুলো বসানোর পর **একই transaction-এর ভিতরে** এটাকে ডাকে।
-- তাই এখানকার সব লেখা ওই এক transaction-এরই অংশ — মাঝপথে মরলে posting সহ সবই
-- rollback হয়। এটাই আজকের ~৩১টা আলাদা commit-এর বদলি।
--
-- ⚠️ কেন business write গুলো এখানে, TypeScript-এ নয়: TS-এ রাখলে ওগুলো
-- transaction-এর **বাইরে** থেকে যেত, আর CI guard সেটা ধরতেও পারত না (নিষিদ্ধ
-- function তো ডাকা হয়নি)। registry-তে ঘোষিত থাকায় ভোলার উপায় নেই।
--
-- ⚠️ ইচ্ছাকৃত নকশা: হিসাবগুলো (sfgCostPerKg, reco row, reservation qty) এখনো
-- TypeScript-এই হয়, আর তৈরি payload হিসেবে p_context-এ আসে। শুধু **লেখাটা**
-- transaction-এ সরানো হয়েছে, **হিসাব নয়** — তাতে আচরণ হুবহু এক থাকে, আর এই
-- migration-এ কোনো costing drift ঢোকার সুযোগ নেই।
-- ============================================================================

CREATE OR REPLACE FUNCTION erp_production.complete_process_po_verify(
  p_process_order_id uuid,
  p_postings         jsonb,   -- post_document-এর ফল: [{line_ref, stock_ledger_id, ...}]
  p_context          jsonb    -- {header, reco_rows, reservations}
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_production, erp_inventory, public
AS $fn$
DECLARE
  v_fg_ledger  uuid;
  v_qi_ledger  uuid;
  v_header     jsonb := COALESCE(p_context->'header', '{}'::jsonb);
BEGIN
  -- এখানেও কোনো EXCEPTION handler নেই, ইচ্ছাকৃতভাবে (post_document-এর মতোই)।

  -- ── 1. প্রতিটা RM/PM line-এ তার নিজের ledger id ─────────────────────────
  -- line_ref = process_order_line.id (TS ওটাই পাঠায়)। FG/QI-র special ref
  -- গুলো uuid নয়, তাই cast-এ বাদ পড়ার বদলে স্পষ্টভাবে ছেঁকে নেওয়া হচ্ছে।
  UPDATE erp_production.process_order_line pol
  SET stock_ledger_id = (p->>'stock_ledger_id')::uuid
  FROM jsonb_array_elements(p_postings) AS p
  WHERE p->>'line_ref' NOT IN ('FG', 'QI_OUT', 'QI_RELEASE')
    AND pol.id = (p->>'line_ref')::uuid;

  -- ── 2. reservation issue ────────────────────────────────────────────────
  -- issued_qty/status TS-এ হিসাব করা (আজকের যুক্তি অপরিবর্তিত), এখানে শুধু বসানো।
  UPDATE erp_production.reservation_document rd
  SET issued_qty      = (r->>'issued_qty')::numeric,
      status          = r->>'status',
      last_updated_at = now(),
      last_updated_by = NULLIF(v_header->>'last_updated_by','')::uuid
  FROM jsonb_array_elements(COALESCE(p_context->'reservations','[]'::jsonb)) AS r
  WHERE rd.id = (r->>'reservation_id')::uuid;

  -- ── 3. Reco (costing) rows ──────────────────────────────────────────────
  -- TS-এর বানানো row গুলোই হুবহু বসছে — column তালিকা এখানে লেখা নেই, তাই
  -- ভবিষ্যতে reco-তে column যোগ হলে এই function বদলাতে হবে না।
  IF jsonb_array_length(COALESCE(p_context->'reco_rows','[]'::jsonb)) > 0 THEN
    INSERT INTO erp_production.process_order_line_reco
    SELECT * FROM jsonb_populate_recordset(
      NULL::erp_production.process_order_line_reco,
      p_context->'reco_rows'
    );
  END IF;

  -- ── 4. Header ───────────────────────────────────────────────────────────
  -- FG ও QI-release-এর ledger id **postings থেকেই** নেওয়া হচ্ছে, context থেকে নয় —
  -- ওগুলো এই transaction-এ এইমাত্র তৈরি, তাই caller-এর পাঠানো মানের উপর নির্ভর
  -- করার কোনো কারণ নেই (আর তাতে অসঙ্গতির সুযোগও থাকে না)।
  SELECT (p->>'stock_ledger_id')::uuid INTO v_fg_ledger
  FROM jsonb_array_elements(p_postings) AS p WHERE p->>'line_ref' = 'FG';

  SELECT (p->>'stock_ledger_id')::uuid INTO v_qi_ledger
  FROM jsonb_array_elements(p_postings) AS p WHERE p->>'line_ref' = 'QI_RELEASE';

  UPDATE erp_production.process_order
  SET status                   = 'VERIFIED',
      actual_qty               = (v_header->>'actual_qty')::numeric,
      fg_stock_ledger_id       = v_fg_ledger,
      qi_release_stock_ledger_id = v_qi_ledger,
      verified_at              = now(),
      verified_by              = NULLIF(v_header->>'verified_by','')::uuid,
      has_unapproved_deviation = COALESCE((v_header->>'has_unapproved_deviation')::boolean, false),
      last_updated_at          = now(),
      last_updated_by          = NULLIF(v_header->>'last_updated_by','')::uuid
  WHERE id = p_process_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROD_PO_VERIFY_HEADER_NOT_FOUND: %', p_process_order_id;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION erp_production.complete_process_po_verify(uuid, jsonb, jsonb) IS
  'post_document একই transaction-এ ডাকে। Process PO Verify-র business write: line ledger ids, reservation issue, reco rows, header VERIFIED। feasibility §107.8।';

REVOKE ALL ON FUNCTION erp_production.complete_process_po_verify(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_production.complete_process_po_verify(uuid, jsonb, jsonb) TO service_role;

-- registry-তে ঘোষণা — এটা না থাকলে post_document business write গুলো
-- চালাবেই না, তাই "মনে রাখতে হবে" বলে কিছু থাকে না।
UPDATE erp_inventory.posting_source_registry
SET completion_schema   = 'erp_production',
    completion_function = 'complete_process_po_verify'
WHERE reference_document_type = 'PROC_PO';
