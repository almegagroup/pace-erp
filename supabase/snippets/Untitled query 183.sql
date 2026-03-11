CREATE TABLE erp_core.sessions (
  session_id uuid PRIMARY KEY,
  auth_user_id uuid,
  status text,
  created_at timestamptz,
  last_seen_at timestamptz,
  expires_at timestamptz
);