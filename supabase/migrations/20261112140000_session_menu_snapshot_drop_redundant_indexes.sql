/*
 * Disk-IO fix (prod "Disk IO Budget" warning, 2026-11-12).
 *
 * erp_cache.session_menu_snapshot carried 8 indexes, so every insert/delete
 * wrote 8 index entries (~5.6 dirtied blocks per call, 27.7k inserts on prod).
 * Four of them add nothing:
 *   - idx_session_menu_snapshot_session_company_universe  0 scans in prod, never used
 *   - idx_session_menu_snapshot_session_universe          (session_id, universe)
 *   - idx_session_menu_snapshot_session_id                (session_id)
 *   - idx_session_menu_snapshot_full_lookup               (session_id, universe, company_id)
 * The last three are leading-column prefixes of uq_session_menu_context
 * (session_id, universe, company_id, work_context_id), which serves the same
 * equality lookups, so every query they answered is still indexed.
 *
 * Kept: session_menu_snapshot_pkey, uq_session_menu_context,
 * idx_session_menu_snapshot_user (auth_user_id), and
 * idx_fk_session_menu_snapshot_work_context_id (FK support).
 *
 * Rollback (indexes are tiny, 16 kB each):
 *   CREATE INDEX idx_session_menu_snapshot_session_company_universe ON erp_cache.session_menu_snapshot (session_id, company_id, universe);
 *   CREATE INDEX idx_session_menu_snapshot_session_universe ON erp_cache.session_menu_snapshot (session_id, universe);
 *   CREATE INDEX idx_session_menu_snapshot_session_id ON erp_cache.session_menu_snapshot (session_id);
 *   CREATE INDEX idx_session_menu_snapshot_full_lookup ON erp_cache.session_menu_snapshot (session_id, universe, company_id);
 */

DROP INDEX IF EXISTS erp_cache.idx_session_menu_snapshot_session_company_universe;
DROP INDEX IF EXISTS erp_cache.idx_session_menu_snapshot_session_universe;
DROP INDEX IF EXISTS erp_cache.idx_session_menu_snapshot_session_id;
DROP INDEX IF EXISTS erp_cache.idx_session_menu_snapshot_full_lookup;
