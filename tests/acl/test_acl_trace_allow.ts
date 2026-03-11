import { resolveAcl } from "../../supabase/functions/api/_acl/acl_resolver.ts";

const result = resolveAcl({
  authUserId: "user_1",
  roleCode: "L2_MANAGER",
  companyId: "COMPANY_A",
  resourceCode: "INVOICE",
  action: "VIEW",

  moduleEnabled: true,
  userOverrides: null,

  rolePermissions: [
    {
      resource_code: "INVOICE",
      can_view: true,
      can_write: false,
      can_edit: false,
      can_delete: false,
      can_approve: false,
      can_export: false,
    },
  ],

  capabilityPermissions: [],
});

console.log("=== ALLOW TEST RESULT ===");
console.log(JSON.stringify(result, null, 2));