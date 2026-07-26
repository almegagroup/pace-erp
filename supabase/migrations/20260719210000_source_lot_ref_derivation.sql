-- ============================================================================
-- source_lot_ref স্বয়ংক্রিয়ভাবে বসানো (feasibility §83.15 সম্প্রসারণ)
--
-- নিয়ম দুটোই, আর দুটোই **derived** — কোনো handler কখনো এটা পাঠায় না:
--
--   ১. Reversal / correction  → মূল posting-এর লট **নকল** করো
--   ২. FG receipt (নতুন লট)   → Packing PO নম্বরই লট
--
-- ⚠️ কেন trigger, কেন post_stock_movement বদলালাম না:
--   (ক) ওটা সবচেয়ে সংবেদনশীল function (৬,২৭০ অক্ষর) — পুরোটা হাতে জোড়া দিয়ে
--       replace করা মানে অকারণ transcription ঝুঁকি।
--   (খ) trigger **যেকোনো path** ঢাকে — post_stock_movement, post_document, বা
--       ভবিষ্যতের যা-ই আসুক। caller-এর মনে রাখার কিছু নেই, ভুল করারও উপায় নেই।
--   (গ) এটা বিশুদ্ধ derived value, trigger-এর ধ্রুপদী ব্যবহার।
--
-- FG receipt চেনার signature: reference PACK_PO + P101 + IN।
-- Packing PO Final তিনটে posting করে — SFG issue (P261 OUT), PM issue (P261 OUT),
-- FG receipt (P101 IN)। তাই এই তিনটে শর্ত একসাথে **শুধু FG receipt-এই** মেলে;
-- খরচের leg গুলো লট তৈরি করে না, তাই ওরা বাদ পড়ে — যা সঠিক।
-- ============================================================================

CREATE OR REPLACE FUNCTION erp_inventory.derive_source_lot_ref()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_doc erp_inventory.stock_document%ROWTYPE;
BEGIN
  -- caller যা-ই পাঠাক, উপেক্ষা করা হয় — মান সবসময় derive হয়
  SELECT * INTO v_doc FROM erp_inventory.stock_document WHERE id = NEW.stock_document_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- ১. Reversal/correction: মূল posting যে লটের, এটাও সেই লটের।
  --    এতেই PR19 / COR6 / Packing PO reverse আপনাআপনি ঠিক থাকে — ওরা সবাই
  --    reversal_document_id পাঠায়, তাই আলাদা কোনো কাজ লাগে না।
  IF v_doc.reversal_document_id IS NOT NULL THEN
    SELECT d.source_lot_ref INTO NEW.source_lot_ref
    FROM erp_inventory.stock_document d WHERE d.id = v_doc.reversal_document_id;

  -- ২. নতুন FG লট তৈরি
  ELSIF v_doc.reference_document_type = 'PACK_PO'
    AND v_doc.movement_type_code = 'P101'
    AND NEW.direction = 'IN' THEN
    NEW.source_lot_ref := v_doc.reference_document_number;
  END IF;

  -- document row-এও একই মান রাখা হচ্ছে, যাতে report দুই দিক থেকেই পড়তে পারে
  IF NEW.source_lot_ref IS NOT NULL THEN
    UPDATE erp_inventory.stock_document
    SET source_lot_ref = NEW.source_lot_ref
    WHERE id = NEW.stock_document_id AND source_lot_ref IS DISTINCT FROM NEW.source_lot_ref;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_stock_ledger_source_lot ON erp_inventory.stock_ledger;
CREATE TRIGGER trg_stock_ledger_source_lot
  BEFORE INSERT ON erp_inventory.stock_ledger
  FOR EACH ROW EXECUTE FUNCTION erp_inventory.derive_source_lot_ref();

COMMENT ON FUNCTION erp_inventory.derive_source_lot_ref() IS
  'stock_ledger.source_lot_ref স্বয়ংক্রিয়ভাবে বসায়: reversal-এ মূল posting থেকে নকল, FG receipt-এ Packing PO নম্বর। caller-এর পাঠানো মান সবসময় উপেক্ষিত। feasibility §83.15।';
