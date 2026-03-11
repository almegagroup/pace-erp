import { resolveAcl } from "../../supabase/functions/api/_acl/acl_resolver.ts";

const result = resolveAcl({
  authUserId: "user_2",
  roleCode: "L2_MANAGER",
  companyId: "COMPANY_A",
  resourceCode: "INVOICE",
  action: "DELETE",

  moduleEnabled: true,
  userOverrides: null,

  rolePermissions: [],
  capabilityPermissions: [],
});

console.log("=== DENY TEST RESULT ===");
console.log(JSON.stringify(result, null, 2));