/*
 * File-ID: 4.2A
 * Gate: 4
 * Phase: 4
 * Domain: DB
 * Purpose: Deterministic P0001-style ERP user_code generation
 * Authority: Backend
 */

BEGIN;

CREATE SEQUENCE IF NOT EXISTS erp_core.user_code_p_seq
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;

COMMIT;
