/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/transporterMasterRevision.js
 * Purpose: Keep the in-browser Bulk DO preview intact while the user briefly
 *          visits Transporter Master. This is deliberately process-local: it
 *          only coordinates two screens in the same ERP session and never
 *          persists a business fact.
 */

let revision = 0;

export function getTransporterMasterRevision() {
  return revision;
}

export function recordTransporterMasterChange() {
  revision += 1;
  return revision;
}
