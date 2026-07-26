-- Gate-19.3: Opening Stock needs to carry a manually-entered batch number for
-- SFG/FG (MTO/HPS) lines through to post_stock_movement()'s p_batch_number
-- (added in Gate-27.19, migration 20260712013000). RM/PM/INT lines leave this
-- NULL — no batch. MTS FG/SFG batch integration remains deferred per §83.7.

ALTER TABLE erp_procurement.opening_stock_line
  ADD COLUMN IF NOT EXISTS batch_number TEXT NULL;
