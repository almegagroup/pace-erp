/*
 * File-ID: 3.10
 * File-Path: supabase/migrations/20260410116000_gate3_10_session_cluster_foundation.sql
 * Gate: 3
 * Phase: 3
 * Domain: SESSION
 * Purpose: Add backend-authoritative session-cluster and governed window-slot storage foundation for the protected multi-window phase.
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- 1) Parent session-cluster truth
-- ============================================================

CREATE TABLE IF NOT EXISTS erp_core.session_clusters (
  cluster_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  auth_user_id UUID NOT NULL
    REFERENCES erp_core.users(auth_user_id)
    ON DELETE CASCADE,

  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'REPLACED', 'REVOKED', 'EXPIRED', 'CLOSED')),

  root_session_id UUID NULL,
  max_window_count SMALLINT NOT NULL DEFAULT 3
    CHECK (max_window_count = 3),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,

  replaced_at TIMESTAMPTZ NULL,
  replaced_by_cluster_id UUID NULL,

  revoked_at TIMESTAMPTZ NULL,
  revoked_reason TEXT NULL,
  closed_at TIMESTAMPTZ NULL
);

COMMENT ON TABLE erp_core.session_clusters IS
'Backend-authoritative parent session cluster per login. Governs cluster legitimacy, replacement, expiry boundary, and fixed max-3 admitted windows.';

COMMENT ON COLUMN erp_core.session_clusters.root_session_id IS
'Initial ERP session row created by the login that started this cluster. Later admitted windows must still remain inside this cluster authority.';

COMMENT ON COLUMN erp_core.session_clusters.max_window_count IS
'Locked session-cluster maximum. The current authority contract allows exactly 3 governed Home windows and no more.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_session_clusters_root_session'
  ) THEN
    ALTER TABLE erp_core.session_clusters
      ADD CONSTRAINT fk_session_clusters_root_session
      FOREIGN KEY (root_session_id)
      REFERENCES erp_core.sessions(session_id)
      ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_session_clusters_replaced_by_cluster'
  ) THEN
    ALTER TABLE erp_core.session_clusters
      ADD CONSTRAINT fk_session_clusters_replaced_by_cluster
      FOREIGN KEY (replaced_by_cluster_id)
      REFERENCES erp_core.session_clusters(cluster_id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_session_cluster_per_user
ON erp_core.session_clusters(auth_user_id)
WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_session_clusters_owner_status
ON erp_core.session_clusters(auth_user_id, status);

ALTER TABLE erp_core.session_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_core.session_clusters FORCE ROW LEVEL SECURITY;

-- ============================================================
-- 2) Session -> cluster linkage
-- ============================================================

ALTER TABLE erp_core.sessions
  ADD COLUMN IF NOT EXISTS cluster_id UUID NULL;

COMMENT ON COLUMN erp_core.sessions.cluster_id IS
'Optional parent session cluster identity. NULL is allowed for legacy single-session rows created before the cluster phase is fully wired.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_sessions_cluster_id'
  ) THEN
    ALTER TABLE erp_core.sessions
      ADD CONSTRAINT fk_sessions_cluster_id
      FOREIGN KEY (cluster_id)
      REFERENCES erp_core.session_clusters(cluster_id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_sessions_cluster_id
ON erp_core.sessions(cluster_id);

-- ============================================================
-- 3) Governed window-slot truth
-- ============================================================

CREATE TABLE IF NOT EXISTS erp_core.session_cluster_windows (
  cluster_window_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  cluster_id UUID NOT NULL
    REFERENCES erp_core.session_clusters(cluster_id)
    ON DELETE CASCADE,

  session_id UUID NULL
    REFERENCES erp_core.sessions(session_id)
    ON DELETE SET NULL,

  window_instance_id TEXT NOT NULL,
  window_token UUID NOT NULL DEFAULT gen_random_uuid(),
  window_slot SMALLINT NOT NULL
    CHECK (window_slot BETWEEN 1 AND 3),

  status TEXT NOT NULL
    CHECK (status IN ('ADMITTED', 'CLOSED', 'REVOKED', 'EXPIRED')),

  admitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  closed_at TIMESTAMPTZ NULL,
  close_reason TEXT NULL,
  revoked_at TIMESTAMPTZ NULL,
  revoked_reason TEXT NULL
);

COMMENT ON TABLE erp_core.session_cluster_windows IS
'Governed admitted browser-window membership under one backend session cluster. Each row represents one deliberate cluster slot, not an arbitrary tab clone.';

COMMENT ON COLUMN erp_core.session_cluster_windows.session_id IS
'Optional ERP session row linked to this admitted window membership. Multiple admitted windows may still share one backend session authority.';

COMMENT ON COLUMN erp_core.session_cluster_windows.window_instance_id IS
'Frontend-stable per-window identity stored in sessionStorage. Used to re-admit the same browser window across refresh without trusting arbitrary duplicate tabs.';

COMMENT ON COLUMN erp_core.session_cluster_windows.window_token IS
'Opaque backend-issued membership token for future protected-shell slot validation and stale-window detection.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_session_cluster_window_instance
ON erp_core.session_cluster_windows(cluster_id, window_instance_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_session_cluster_window_slot
ON erp_core.session_cluster_windows(cluster_id, window_slot)
WHERE status = 'ADMITTED';

CREATE UNIQUE INDEX IF NOT EXISTS uq_session_cluster_window_token
ON erp_core.session_cluster_windows(window_token);

CREATE INDEX IF NOT EXISTS idx_session_cluster_windows_cluster_status
ON erp_core.session_cluster_windows(cluster_id, status);

CREATE INDEX IF NOT EXISTS idx_session_cluster_windows_session_id
ON erp_core.session_cluster_windows(session_id);

ALTER TABLE erp_core.session_cluster_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_core.session_cluster_windows FORCE ROW LEVEL SECURITY;

-- ============================================================
-- 4) Controlled join-ticket truth
-- ============================================================

CREATE TABLE IF NOT EXISTS erp_core.session_cluster_join_tickets (
  join_token UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  cluster_id UUID NOT NULL
    REFERENCES erp_core.session_clusters(cluster_id)
    ON DELETE CASCADE,

  issued_by_window_id UUID NULL
    REFERENCES erp_core.session_cluster_windows(cluster_window_id)
    ON DELETE SET NULL,

  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,

  consumed_at TIMESTAMPTZ NULL,
  consumed_by_window_id UUID NULL
    REFERENCES erp_core.session_cluster_windows(cluster_window_id)
    ON DELETE SET NULL
);

COMMENT ON TABLE erp_core.session_cluster_join_tickets IS
'One-time backend-issued admission tickets for opening governed cluster window 2 or 3. Prevents arbitrary duplicate-tab expansion from becoming authority.';

CREATE INDEX IF NOT EXISTS idx_session_cluster_join_tickets_cluster_lookup
ON erp_core.session_cluster_join_tickets(cluster_id, expires_at, consumed_at);

ALTER TABLE erp_core.session_cluster_join_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_core.session_cluster_join_tickets FORCE ROW LEVEL SECURITY;

-- ============================================================
-- 5) Admission integrity
-- ============================================================

CREATE OR REPLACE FUNCTION erp_core.enforce_session_cluster_window_admission()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_cluster_status TEXT;
  v_admitted_count INTEGER;
  v_session_cluster_id UUID;
BEGIN
  SELECT status
  INTO v_cluster_status
  FROM erp_core.session_clusters
  WHERE cluster_id = NEW.cluster_id;

  IF v_cluster_status IS NULL THEN
    RAISE EXCEPTION 'SESSION_CLUSTER_NOT_FOUND';
  END IF;

  IF NEW.status = 'ADMITTED' AND v_cluster_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'SESSION_CLUSTER_NOT_ACTIVE';
  END IF;

  IF NEW.session_id IS NOT NULL THEN
    SELECT cluster_id
    INTO v_session_cluster_id
    FROM erp_core.sessions
    WHERE session_id = NEW.session_id;

    IF v_session_cluster_id IS NOT NULL
       AND v_session_cluster_id <> NEW.cluster_id THEN
      RAISE EXCEPTION 'SESSION_CLUSTER_SESSION_MISMATCH';
    END IF;
  END IF;

  IF NEW.status = 'ADMITTED' THEN
    SELECT COUNT(*)
    INTO v_admitted_count
    FROM erp_core.session_cluster_windows
    WHERE cluster_id = NEW.cluster_id
      AND status = 'ADMITTED'
      AND cluster_window_id <> COALESCE(NEW.cluster_window_id, gen_random_uuid());

    v_admitted_count := v_admitted_count + 1;

    IF v_admitted_count > 3 THEN
      RAISE EXCEPTION 'SESSION_CLUSTER_MAX_WINDOWS_EXCEEDED';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_session_cluster_window_admission
ON erp_core.session_cluster_windows;

CREATE TRIGGER trg_enforce_session_cluster_window_admission
BEFORE INSERT OR UPDATE
ON erp_core.session_cluster_windows
FOR EACH ROW
EXECUTE FUNCTION erp_core.enforce_session_cluster_window_admission();

COMMIT;
