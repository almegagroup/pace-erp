import { resolveAcl } from "../../supabase/functions/api/_acl/acl_resolver.ts";

const result = resolveAcl({
  authUserId: "admin_1",
  roleCode: "SA",
  companyId: "COMPANY_A",
  resourceCode: "ANY_RESOURCE",
  action: "DELETE",

  moduleEnabled: false,
  userOverrides: null,

  rolePermissions: [],
  capabilityPermissions: [],
});

console.log("=== ADMIN BYPASS TEST RESULT ===");
console.log(JSON.stringify(result, null, 2));