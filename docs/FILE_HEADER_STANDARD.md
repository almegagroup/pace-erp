# PACE-ERP — File Header Standard (ID 0.8)

Every source file MUST begin with the following header.

Missing or malformed header = invalid file.

## Mandatory Header Format

/*
 * File-ID: <ID>
 * File-Path: <full path>
 * Gate: <number>
 * Phase: <number>
 * Domain: <SECURITY | AUTH | SESSION | ACL | CONTEXT | FRONT | DB | DOCS | STANDARDS>
 * Purpose: <single sentence>
 * Authority: Backend | Frontend
 */

## Enforcement
- Applies to all backend, frontend, and migration files
- No exception allowed
