-- Fix: stroke_change_request_line.stroke_line_id had a NOT NULL FK to stroke_line(id)
-- with no ON DELETE action. This silently blocked updateStrokeMasterHandler's
-- "DELETE all lines, then re-insert" replace-on-save logic whenever a stroke had ever
-- had a Change Request (PR03/PR04) filed against it — the DELETE failed atomically
-- (FK violation), the error was discarded (unchecked in the handler), and the
-- subsequent INSERT still ran, appending a duplicate full copy of the lines on every
-- Save/Approve. Repeated saves compounded this (100% -> 200% -> 300% dosage totals).
--
-- stroke_change_request_line already denormalizes old/new material_id, has_alternate,
-- and group_id as plain audit columns, so nulling the now-dangling stroke_line_id
-- pointer on delete loses no audit history. ON DELETE SET NULL (not CASCADE) is the
-- correct behavior here — deleting a stroke_line must never delete the change-request
-- audit trail itself.

ALTER TABLE erp_production.stroke_change_request_line
  ALTER COLUMN stroke_line_id DROP NOT NULL;

ALTER TABLE erp_production.stroke_change_request_line
  DROP CONSTRAINT stroke_change_request_line_stroke_line_id_fkey;

ALTER TABLE erp_production.stroke_change_request_line
  ADD CONSTRAINT stroke_change_request_line_stroke_line_id_fkey
  FOREIGN KEY (stroke_line_id) REFERENCES erp_production.stroke_line(id) ON DELETE SET NULL;
