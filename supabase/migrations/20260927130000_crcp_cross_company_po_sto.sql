-- CRCP (Cross Company) — Phase A. Design locked in
-- docs/PROCUREMENT-DESIGN-DOC.md §3.7 Points 3.2.1/3.2.2/3.2.9, business-owner
-- session 2026-09-27.
--
-- Lets a PO/STO's issuing company allow OTHER companies to raise a Gate Entry
-- against it, for cases where material physically unloads at a sister company
-- (space constraint, shared logistics, etc.) instead of the issuing company's
-- own location. Holder level differs by document shape: PO is one-material-
-- per-document (§87.12A), even when several POs are created together in one
-- po_order_group batch window, so the flag lives per PO row; STO can carry
-- multiple lines in one document, so the flag lives at the STO header.
--
-- The junction tables hold only the ADDITIONAL shared companies -- the
-- document's own company is always implicitly allowed and is never stored
-- here, so the "can't remove your own company" UI rule needs no backend
-- enforcement of its own.
--
-- Deliberately no closing/balance-tracking logic added anywhere in this
-- migration: erp_procurement.purchase_order_line.open_qty (already updated
-- company-agnostically by updatePoLineReceipt/reversePoLineReceipt in
-- grn.handlers.ts) already implements the shared-pool, first-come-first-
-- served balance rule with zero changes needed -- verified 2026-09-27.

BEGIN;

ALTER TABLE erp_procurement.purchase_order
  ADD COLUMN crcp_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN erp_procurement.purchase_order.crcp_enabled IS
'CRCP (Cross Company) — when true, companies in purchase_order_crcp_company may also raise a Gate Entry against this PO, in addition to this PO''s own company. Editable at any status except CANCELLED/CLOSED, by anyone holding PROC_PO_CREATE access — a lightweight action, not routed through the amendment-approval workflow. Never shown on any printed/exported PO copy.';

CREATE TABLE erp_procurement.purchase_order_crcp_company (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  po_id       uuid NOT NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE CASCADE,

  -- Cross-schema - plain uuid, NO FK, matches the rest of erp_procurement's
  -- own company_id columns (e.g. purchase_order.company_id).
  company_id  uuid NOT NULL,

  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (po_id, company_id)
);

COMMENT ON TABLE erp_procurement.purchase_order_crcp_company IS
'CRCP allow-list for a PO — one row per additional company allowed to raise a Gate Entry against this PO. The PO''s own company (purchase_order.company_id) is always implicitly allowed and is never itself a row here.';

CREATE INDEX idx_po_crcp_company_po_id ON erp_procurement.purchase_order_crcp_company (po_id);
CREATE INDEX idx_po_crcp_company_company_id ON erp_procurement.purchase_order_crcp_company (company_id);

ALTER TABLE erp_procurement.stock_transfer_order
  ADD COLUMN crcp_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN erp_procurement.stock_transfer_order.crcp_enabled IS
'CRCP (Cross Company) — when true, companies in stock_transfer_order_crcp_company may also raise a Gate Entry against this STO, in addition to its own receiving_company_id. Header-level (unlike PO) since one STO can carry multiple lines. Same editability/visibility rules as purchase_order.crcp_enabled.';

CREATE TABLE erp_procurement.stock_transfer_order_crcp_company (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  sto_id      uuid NOT NULL
    REFERENCES erp_procurement.stock_transfer_order(id)
    ON DELETE CASCADE,

  company_id  uuid NOT NULL,

  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (sto_id, company_id)
);

COMMENT ON TABLE erp_procurement.stock_transfer_order_crcp_company IS
'CRCP allow-list for an STO — one row per additional company allowed to raise a Gate Entry against this STO. The STO''s own receiving_company_id is always implicitly allowed and is never itself a row here.';

CREATE INDEX idx_sto_crcp_company_sto_id ON erp_procurement.stock_transfer_order_crcp_company (sto_id);
CREATE INDEX idx_sto_crcp_company_company_id ON erp_procurement.stock_transfer_order_crcp_company (company_id);

COMMIT;
