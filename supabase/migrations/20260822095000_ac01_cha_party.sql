-- AC01 GRN Landed Cost Hub — two real gaps found live 2026-08-22:
--
-- 1. CHA (Clearing & Forwarding Agent) as a 4th trackable party. Cost types
--    "Clearing charges (C&F)"/"CHA charges" already existed, and
--    landed_cost_line.cha_id already existed (schema-level, from before this
--    session), but there was no frontend selector to actually set cha_id,
--    and CHA was never one of the three party_type options -- any CHA
--    charge silently fell into the Vendor's payable bucket, which is wrong
--    for Import GRNs (CHA is paid separately from the material vendor).
--
-- 2. A 'NONE' party for costs PACE pays directly to a third party that
--    isn't Vendor/Transporter/CHA/Last-Mile at all -- Duty is the concrete
--    example (business owner: "Duty amra di, seta amader hoye CHA dayna" --
--    we pay Duty ourselves, the CHA doesn't pay it on our behalf). These
--    lines must still add to Landed Cost (the cost genuinely happened) but
--    must NOT flow into any of the four parties' Suggested Payable, since
--    nothing is actually owed to any of them for it.

-- Found live 2026-08-22 while testing the CHA scenario: AC01Page.jsx's cost
-- type dropdown already offered "Clearing charges (C&F)"
-- (CLEARING_CHARGES_CHA) alongside "CHA charges" (CHA_CHARGES), but
-- landed_cost_line's cost_type CHECK only ever allowed CHA_CHARGES -- any
-- real save of a Clearing-charges line would have 500'd on this constraint.
-- Pre-existing frontend/backend mismatch, unrelated to today's CHA-party
-- work otherwise -- caught only because the CHA verification transaction
-- happened to pick that exact value.
ALTER TABLE erp_procurement.landed_cost_line
  DROP CONSTRAINT landed_cost_line_cost_type_check,
  ADD CONSTRAINT landed_cost_line_cost_type_check
    CHECK (cost_type IN (
      'FREIGHT', 'INSURANCE', 'CUSTOMS_DUTY', 'CHA_CHARGES', 'CLEARING_CHARGES_CHA',
      'LOADING', 'UNLOADING', 'PORT_CHARGES', 'OTHER', 'IMPORT_DUTY', 'EXCISE_DUTY',
      'CST', 'CUSTOMS_EDN_CESS', 'ADDITIONAL_DUTY_IGST', 'DUTY_SETOFF', 'ENTRY_TAX',
      'LC_CHARGES', 'BANK_CHARGES', 'LAST_MILE_TRANSPORT', 'TRANSPORTER_CHARGE_OTHER_THAN_BASIC'
    ));

ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN cha_payable_override numeric;

ALTER TABLE erp_procurement.landed_cost_line
  DROP CONSTRAINT landed_cost_line_party_type_check,
  ADD CONSTRAINT landed_cost_line_party_type_check
    CHECK (party_type IN ('VENDOR', 'TRANSPORTER', 'LAST_MILE_TRANSPORTER', 'CHA', 'NONE'));

ALTER TABLE erp_procurement.landed_cost_deduction_line
  DROP CONSTRAINT landed_cost_deduction_line_party_type_check,
  ADD CONSTRAINT landed_cost_deduction_line_party_type_check
    CHECK (party_type IN ('VENDOR', 'TRANSPORTER', 'LAST_MILE_TRANSPORTER', 'CHA', 'NONE'));
