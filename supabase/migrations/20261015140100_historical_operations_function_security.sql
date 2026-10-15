-- Keep the historical-import correction trigger independent from a caller's
-- search_path. The private erp_history schema remains service-role only.
ALTER FUNCTION erp_history.preserve_actual_import_origin()
  SET search_path = erp_history, pg_temp;

NOTIFY pgrst, 'reload schema';
