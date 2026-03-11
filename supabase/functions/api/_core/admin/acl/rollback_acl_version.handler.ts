/*
 * File-ID: ID-9.11C
 * File-Path: supabase/functions/api/_core/admin/acl/rollback_acl_version.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: Rollback to a previous ACL version safely.
 * Authority: Backend
 */

import { activateAclVersionHandler } from "./activate_acl_version.handler.ts";

export const rollbackAclVersionHandler = activateAclVersionHandler;