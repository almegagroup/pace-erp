-- ============================================================================
-- Document Number Series — 10-digit widening + PROC_PO/PACK_PO global ranges
--
-- কেন এই migration:
--   এই দুটো data change এতদিন **শুধু MCP দিয়ে dev-এ** করা হয়েছিল, migration-এ ছিল না।
--   ফলে prod deploy করলে পুরনো migration (20260707170858) ৬-অঙ্কের সংকীর্ণ range-ই
--   বসাতো (200001, 900001...), আর PROC_PO/PACK_PO row-ই থাকত না।
--
--   CLAUDE.md 8A-র নিয়মেই লেখা আছে — **document number range = migration-এর কাজ**,
--   MCP-র নয়। তাই manual prod-checklist না রেখে এখানে বসানো হলো; এখন prod-এ
--   নিজে নিজেই যাবে।
--
-- দুটো জিনিস:
--   1. সব doc type ৬-অঙ্ক -> ১০-অঙ্ক (প্রতিটায় ~১০ কোটি capacity)
--      leading digit ইচ্ছে করে অপরিবর্তিত — `93xxxxxxxx` এখনো Process PO, তাই
--      "range দেখে type চেনা" convention অক্ষত।
--   2. PROC_PO / PACK_PO এখন global range নেয় (আগে company-scoped, FY-prefixed
--      `ASCPROC2627-0001` ধাঁচে) — পুরনো company_doc_number_series row গুলো নিষ্ক্রিয়।
--
-- ⚠️ idempotent: dev-এ MCP দিয়ে এগুলো আগেই বসানো, তাই সব UPDATE-এ guard আছে —
--    আবার চালালে কিছু বদলাবে না।
-- ============================================================================

-- ── 1. Range widening ────────────────────────────────────────────────────────
-- `starting_number < <new>` guard: ইতিমধ্যে চওড়া হয়ে থাকলে ছোঁবে না।
UPDATE erp_procurement.document_number_series SET starting_number = 1000000001, pad_width = 10 WHERE doc_type = 'GE'            AND starting_number < 1000000001;
UPDATE erp_procurement.document_number_series SET starting_number = 1500000001, pad_width = 10 WHERE doc_type = 'GEX'           AND starting_number < 1500000001;
UPDATE erp_procurement.document_number_series SET starting_number = 1600000001, pad_width = 10 WHERE doc_type = 'GXO'           AND starting_number < 1600000001;
UPDATE erp_procurement.document_number_series SET starting_number = 2000000001, pad_width = 10 WHERE doc_type = 'GRN'           AND starting_number < 2000000001;
UPDATE erp_procurement.document_number_series SET starting_number = 3000000001, pad_width = 10 WHERE doc_type = 'CSN'           AND starting_number < 3000000001;
UPDATE erp_procurement.document_number_series SET starting_number = 4000000001, pad_width = 10 WHERE doc_type = 'IV'            AND starting_number < 4000000001;
UPDATE erp_procurement.document_number_series SET starting_number = 4500000001, pad_width = 10 WHERE doc_type = 'LC'            AND starting_number < 4500000001;
UPDATE erp_procurement.document_number_series SET starting_number = 5000000001, pad_width = 10 WHERE doc_type = 'QA'            AND starting_number < 5000000001;
UPDATE erp_procurement.document_number_series SET starting_number = 6000000001, pad_width = 10 WHERE doc_type = 'OS'            AND starting_number < 6000000001;
UPDATE erp_procurement.document_number_series SET starting_number = 6500000001, pad_width = 10 WHERE doc_type = 'PI'            AND starting_number < 6500000001;
UPDATE erp_procurement.document_number_series SET starting_number = 7000000001, pad_width = 10 WHERE doc_type = 'PT'            AND starting_number < 7000000001;
UPDATE erp_procurement.document_number_series SET starting_number = 8000000001, pad_width = 10 WHERE doc_type = 'RTV'           AND starting_number < 8000000001;
UPDATE erp_procurement.document_number_series SET starting_number = 8100000001, pad_width = 10 WHERE doc_type = 'DN'            AND starting_number < 8100000001;
UPDATE erp_procurement.document_number_series SET starting_number = 8200000001, pad_width = 10 WHERE doc_type = 'EXR'           AND starting_number < 8200000001;
UPDATE erp_procurement.document_number_series SET starting_number = 9000000001, pad_width = 10 WHERE doc_type = 'SO'            AND starting_number < 9000000001;
UPDATE erp_procurement.document_number_series SET starting_number = 9100000001, pad_width = 10 WHERE doc_type = 'DC'            AND starting_number < 9100000001;
UPDATE erp_procurement.document_number_series SET starting_number = 9200000001, pad_width = 10 WHERE doc_type = 'SALES_INVOICE' AND starting_number < 9200000001;
UPDATE erp_procurement.document_number_series SET starting_number = 9500000001, pad_width = 10 WHERE doc_type = 'SFG_QA'        AND starting_number < 9500000001;
UPDATE erp_procurement.document_number_series SET starting_number = 9600000001, pad_width = 10 WHERE doc_type = 'PARTIAL_REV'   AND starting_number < 9600000001;

-- ── 2. PROC_PO / PACK_PO — global range row (আগে company-scoped ছিল) ─────────
INSERT INTO erp_procurement.document_number_series (doc_type, starting_number, last_number, pad_width)
VALUES ('PROC_PO', 9300000001, 0, 10),
       ('PACK_PO', 9400000001, 0, 10)
ON CONFLICT (doc_type) DO UPDATE
  SET starting_number = EXCLUDED.starting_number,
      pad_width       = EXCLUDED.pad_width
  WHERE erp_procurement.document_number_series.starting_number < EXCLUDED.starting_number;

-- পুরনো company-scoped series (৪ company × ২ type) নিষ্ক্রিয় — নাহলে কোথাও
-- `ASCPROC2627-0001` ধাঁচে ফিরে যাওয়ার সুযোগ থাকে।
-- ⚠️ PO ও STO ইচ্ছে করে বাদ — ওরা এখনো company-scoped ব্যবস্থাতেই চলে।
UPDATE erp_procurement.company_doc_number_series
SET active = false
WHERE document_type IN ('PROC_PO', 'PACK_PO') AND active;

-- ── 3. last_number reset ────────────────────────────────────────────────────
-- generate_doc_number() **শুধু last_number = 0 হলেই** starting_number-এ লাফ দেয়;
-- নাহলে পুরনো last_number + 1 করেই যায়, অর্থাৎ widening চুপচাপ নিষ্ফল হয়।
--
-- ⚠️ `last_number < starting_number` guard অপরিহার্য: যদি কোনো environment-এ
--    ইতিমধ্যে নতুন range-এর ভিতরে নম্বর ইস্যু হয়ে থাকে, reset করলে **নম্বর
--    পুনরায় ব্যবহার** হয়ে যেত। তখন এই UPDATE কিছুই করে না, যা সঠিক।
UPDATE erp_procurement.document_number_series
SET last_number = 0
WHERE last_number > 0 AND last_number < starting_number;
