-- ============================================================================
-- source_lot_ref — কোন লট থেকে মাল এল / গেল (feasibility §83.15 সম্প্রসারণ)
--
-- সমস্যা: একই Process PO batch থেকে একাধিক Packing PO বেরোয়, আর **প্রতিটার
-- ব্যারেল সাইজ আলাদা হতে পারে** (940003 = ২০০ কেজি/ব্যারেল, 940005 = ২৩০)।
-- তাই batch একা যথেষ্ট নয় — কয়টা ব্যারেল আছে সেটা গুনতে **লট** লাগে।
--
-- FG-র batch_number অপরিবর্তিত থাকে (= parent Process PO-র batch), কারণ §83.15-এ
-- lock করা: "required for AP/QA recognizability, can never be swapped for a
-- Packing PO number"। তাই batch-এর পাশে আলাদা লট field.
--
-- ⚠️ কেন এটা এখন, Dispatch-এর আগে: মাল বেরোনোর সময় কোন লট থেকে গেল সেটা না
-- লিখলে লট-স্তরের হিসাব চিরতরে ভুল হয়ে যায় — পরে পিছিয়ে হিসাব করা অসম্ভব,
-- কারণ তথ্যটাই কোথাও থাকে না। Dispatch তৈরির *আগে* field টা থাকলে সেই শর্তটা
-- গোড়া থেকেই ঢোকে।
-- ============================================================================

ALTER TABLE erp_inventory.stock_ledger
  ADD COLUMN IF NOT EXISTS source_lot_ref text;

ALTER TABLE erp_inventory.stock_document
  ADD COLUMN IF NOT EXISTS source_lot_ref text;

COMMENT ON COLUMN erp_inventory.stock_ledger.source_lot_ref IS
  'যে লট এই movement-এ জড়িত (FG-তে = Packing PO number)। batch_number-এর বদলি নয়, পরিপূরক। post_stock_movement() reversal-এ মূল posting থেকে নিজেই নকল করে — caller পাঠালেও উপেক্ষা করা হয়।';

CREATE INDEX IF NOT EXISTS ix_stock_ledger_source_lot
  ON erp_inventory.stock_ledger (material_id, batch_number, source_lot_ref)
  WHERE source_lot_ref IS NOT NULL;
