// supabase/functions/_shared/serviceRoleClient.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("SERVICE ROLE NOT CONFIGURED");
}

export const serviceRoleClient = createClient(
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
