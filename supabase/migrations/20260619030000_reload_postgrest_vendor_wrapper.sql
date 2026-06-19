-- Reload PostgREST so public.generate_vendor_code() is accessible via RPC.
-- Required after 20260619000000_vendor_master_redesign.sql created the wrapper.
NOTIFY pgrst, 'reload schema';
