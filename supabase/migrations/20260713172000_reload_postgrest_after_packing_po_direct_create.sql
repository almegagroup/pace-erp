/*
 * Reload PostgREST schema cache after Packing PO direct-create columns/routes.
 * The direct-create migration adds columns used immediately by the API insert path.
 */

NOTIFY pgrst, 'reload schema';
