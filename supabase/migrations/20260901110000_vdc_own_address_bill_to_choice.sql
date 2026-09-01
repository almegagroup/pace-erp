-- §133.20 (business owner, 2026-09-01) -- VDC (fg_depot_code.dispatch_type=
-- 'DIRECT') gets its own address/state/pin_code, same as DC (DEPOT), so it
-- can act as a real Bill-To identity in its own right (not just inherit the
-- Parent Company's). Both mandatory + state-must-match-parent, mirroring
-- DC's existing rule exactly (business owner confirmed both).
--
-- Also widens sales_order.bill_to_type to allow 'VDC' as a real Bill-To
-- choice alongside the existing PARENT_COMPANY/DEPOT/CUSTOMER values, for
-- the new Dependent(Direct)/Dependent(No Inbound)-Direct/Independent Party
-- (Asian-billed) "Bill-To Party: Parent Company / VDC" choice.

CREATE OR REPLACE FUNCTION erp_master.validate_fg_depot_code_row()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
declare
  parent_state text;
begin
  select state into parent_state
  from erp_master.fg_parent_company
  where id = new.parent_company_id;

  if parent_state is null then
    raise exception 'MM05_PARENT_COMPANY_NOT_FOUND'
      using errcode = '23503';
  end if;

  -- Corrected 2026-09-01 (business owner): VDC (DIRECT) used to be forbidden
  -- from carrying its own address_line/state/pin_code at all (inherited the
  -- Parent Company's identity only). Both DEPOT and DIRECT now require
  -- address_line + state, and both must match the Parent Company's own
  -- state -- same rule, no more type-branching.
  if coalesce(trim(new.address_line), '') = '' or coalesce(trim(new.state), '') = '' then
    raise exception 'MM05_DEPOT_ADDRESS_REQUIRED'
      using errcode = '23514';
  end if;
  if trim(new.state) <> trim(parent_state) then
    raise exception 'MM05_STATE_MISMATCH'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

ALTER TABLE erp_procurement.sales_order DROP CONSTRAINT sales_order_bill_to_type_check;
ALTER TABLE erp_procurement.sales_order ADD CONSTRAINT sales_order_bill_to_type_check
  CHECK (bill_to_type IS NULL OR bill_to_type = ANY (ARRAY['PARENT_COMPANY', 'DEPOT', 'CUSTOMER', 'VDC']));
