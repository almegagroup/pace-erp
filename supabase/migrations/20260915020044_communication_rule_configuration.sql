/*
 * Communication Automation — Phase 6 rule configuration.
 *
 * The browser has no grants on this schema.  The Render API validates the
 * page/surface manifest, target-company scope and page EDIT permission before
 * it calls the server-only functions below.
 */

BEGIN;

CREATE TABLE erp_communication.automation_rule (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES erp_master.companies(id) ON DELETE RESTRICT,
  surface_enrollment_id uuid NOT NULL REFERENCES erp_communication.surface_enrollment(id) ON DELETE RESTRICT,
  channel               text NOT NULL CHECK (channel IN ('EMAIL')),
  rule_name             text NOT NULL CHECK (btrim(rule_name) <> '' AND char_length(rule_name) <= 160),
  status                text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE')),
  dataset_key           text NULL CHECK (dataset_key IS NULL OR (btrim(dataset_key) <> '' AND char_length(dataset_key) <= 100)),
  subject_template      text NOT NULL DEFAULT '' CHECK (char_length(subject_template) <= 500),
  schedule_kind         text NOT NULL DEFAULT 'MANUAL' CHECK (schedule_kind IN ('MANUAL', 'DAILY', 'WEEKLY', 'MONTHLY')),
  schedule_time         time NULL,
  schedule_timezone     text NOT NULL DEFAULT 'Asia/Kolkata' CHECK (schedule_timezone IN ('Asia/Kolkata')),
  weekly_days           smallint[] NOT NULL DEFAULT ARRAY[]::smallint[],
  monthly_day           smallint NULL CHECK (monthly_day IS NULL OR monthly_day BETWEEN 1 AND 31),
  skip_empty            boolean NOT NULL DEFAULT true,
  version_no            integer NOT NULL DEFAULT 1 CHECK (version_no > 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  last_updated_at       timestamptz NOT NULL DEFAULT now(),
  last_updated_by       uuid NOT NULL,
  CONSTRAINT ck_communication_rule_weekly_days
    CHECK (
      COALESCE(array_length(weekly_days, 1), 0) <= 7
      AND weekly_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
    )
);

CREATE UNIQUE INDEX uq_communication_rule_name_per_company_surface_channel
  ON erp_communication.automation_rule (
    company_id,
    surface_enrollment_id,
    channel,
    lower(rule_name)
  );
CREATE INDEX ix_communication_rule_scope
  ON erp_communication.automation_rule (company_id, surface_enrollment_id, channel, status);
CREATE INDEX ix_communication_rule_surface_enrollment
  ON erp_communication.automation_rule (surface_enrollment_id);

CREATE TABLE erp_communication.automation_recipient (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_rule_id uuid NOT NULL REFERENCES erp_communication.automation_rule(id) ON DELETE CASCADE,
  recipient_type     text NOT NULL CHECK (recipient_type IN ('TO', 'CC', 'BCC')),
  email              text NOT NULL CHECK (btrim(email) <> '' AND char_length(email) <= 320),
  active             boolean NOT NULL DEFAULT true,
  display_order      integer NOT NULL CHECK (display_order > 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL,
  last_updated_at    timestamptz NOT NULL DEFAULT now(),
  last_updated_by    uuid NOT NULL,
  CONSTRAINT uq_communication_recipient_order UNIQUE (automation_rule_id, display_order)
);

CREATE UNIQUE INDEX uq_communication_recipient_type_email
  ON erp_communication.automation_recipient (
    automation_rule_id,
    recipient_type,
    lower(email)
  );
CREATE INDEX ix_communication_recipient_rule_order
  ON erp_communication.automation_recipient (automation_rule_id, display_order);

CREATE TABLE erp_communication.automation_rule_column (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_rule_id uuid NOT NULL REFERENCES erp_communication.automation_rule(id) ON DELETE CASCADE,
  field_key          text NOT NULL CHECK (btrim(field_key) <> '' AND char_length(field_key) <= 100),
  display_order      integer NOT NULL CHECK (display_order > 0),
  CONSTRAINT uq_communication_rule_column_field UNIQUE (automation_rule_id, field_key),
  CONSTRAINT uq_communication_rule_column_order UNIQUE (automation_rule_id, display_order)
);
CREATE INDEX ix_communication_rule_column_rule_order
  ON erp_communication.automation_rule_column (automation_rule_id, display_order);

COMMENT ON TABLE erp_communication.automation_rule IS
  'Phase 6 shared company/page-surface automation configuration. Scheduler, delivery, conditions and match-state remain out of scope.';
COMMENT ON COLUMN erp_communication.automation_rule.surface_enrollment_id IS
  'Stable enrolled surface identity; page identity is inherited through surface_enrollment/page_enrollment.';
COMMENT ON TABLE erp_communication.automation_rule_column IS
  'Stores only code-owned Report Manifest field keys, never database columns.';

ALTER TABLE erp_communication.automation_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_communication.automation_recipient ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_communication.automation_rule_column ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON erp_communication.automation_rule TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON erp_communication.automation_recipient TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON erp_communication.automation_rule_column TO service_role;
REVOKE ALL ON erp_communication.automation_rule FROM anon, authenticated;
REVOKE ALL ON erp_communication.automation_recipient FROM anon, authenticated;
REVOKE ALL ON erp_communication.automation_rule_column FROM anon, authenticated;

CREATE POLICY communication_automation_rule_backend_only
  ON erp_communication.automation_rule
  AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (false) WITH CHECK (false);
CREATE POLICY communication_automation_recipient_backend_only
  ON erp_communication.automation_recipient
  AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (false) WITH CHECK (false);
CREATE POLICY communication_automation_rule_column_backend_only
  ON erp_communication.automation_rule_column
  AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION erp_communication.save_automation_rule(
  p_rule_id uuid,
  p_company_id uuid,
  p_surface_enrollment_id uuid,
  p_channel text,
  p_rule_name text,
  p_status text,
  p_dataset_key text,
  p_subject_template text,
  p_schedule_kind text,
  p_schedule_time time,
  p_schedule_timezone text,
  p_weekly_days smallint[],
  p_monthly_day smallint,
  p_skip_empty boolean,
  p_expected_version_no integer,
  p_recipients jsonb,
  p_columns jsonb,
  p_actor uuid
)
RETURNS TABLE(rule_id uuid, version_no integer, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rule_id uuid;
  v_version_no integer;
  v_recipients jsonb := COALESCE(p_recipients, '[]'::jsonb);
  v_columns jsonb := COALESCE(p_columns, '[]'::jsonb);
BEGIN
  IF p_company_id IS NULL OR p_surface_enrollment_id IS NULL OR p_actor IS NULL
    OR p_channel <> 'EMAIL'
    OR p_rule_name IS NULL OR pg_catalog.btrim(p_rule_name) = '' OR pg_catalog.char_length(p_rule_name) > 160
    OR p_status NOT IN ('DRAFT', 'ACTIVE', 'INACTIVE')
    OR p_schedule_kind NOT IN ('MANUAL', 'DAILY', 'WEEKLY', 'MONTHLY')
    OR p_schedule_timezone <> 'Asia/Kolkata'
    OR p_skip_empty IS NULL
    OR pg_catalog.jsonb_typeof(v_recipients) <> 'array'
    OR pg_catalog.jsonb_typeof(v_columns) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMMUNICATION_RULE_RPC_INVALID_INPUT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(COALESCE(p_weekly_days, ARRAY[]::smallint[])) AS candidate(day_value)
    WHERE candidate.day_value < 1 OR candidate.day_value > 7
  ) OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.unnest(COALESCE(p_weekly_days, ARRAY[]::smallint[])) AS candidate(day_value)
  ) <> (
    SELECT pg_catalog.count(DISTINCT candidate.day_value)
    FROM pg_catalog.unnest(COALESCE(p_weekly_days, ARRAY[]::smallint[])) AS candidate(day_value)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMMUNICATION_RULE_RPC_INVALID_WEEKLY_DAYS';
  END IF;

  IF p_monthly_day IS NOT NULL AND (p_monthly_day < 1 OR p_monthly_day > 31) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMMUNICATION_RULE_RPC_INVALID_MONTHLY_DAY';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_recipients) AS entry(value)
    WHERE pg_catalog.jsonb_typeof(entry.value) <> 'object'
      OR NOT (entry.value ?& ARRAY['recipient_type', 'email', 'active', 'display_order'])
      OR EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_object_keys(entry.value) AS key_name
        WHERE key_name NOT IN ('recipient_type', 'email', 'active', 'display_order')
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_columns) AS entry(value)
    WHERE pg_catalog.jsonb_typeof(entry.value) <> 'object'
      OR NOT (entry.value ?& ARRAY['field_key', 'display_order'])
      OR EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_object_keys(entry.value) AS key_name
        WHERE key_name NOT IN ('field_key', 'display_order')
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMMUNICATION_RULE_RPC_INVALID_CHILD_INPUT';
  END IF;

  IF p_rule_id IS NULL THEN
    IF p_expected_version_no IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMMUNICATION_RULE_RPC_INVALID_VERSION';
    END IF;

    INSERT INTO erp_communication.automation_rule (
      company_id, surface_enrollment_id, channel, rule_name, status, dataset_key,
      subject_template, schedule_kind, schedule_time, schedule_timezone,
      weekly_days, monthly_day, skip_empty, version_no,
      created_at, created_by, last_updated_at, last_updated_by
    ) VALUES (
      p_company_id, p_surface_enrollment_id, p_channel, pg_catalog.btrim(p_rule_name), p_status, NULLIF(pg_catalog.btrim(p_dataset_key), ''),
      COALESCE(p_subject_template, ''), p_schedule_kind, p_schedule_time, p_schedule_timezone,
      COALESCE(p_weekly_days, ARRAY[]::smallint[]), p_monthly_day, p_skip_empty, 1,
      pg_catalog.now(), p_actor, pg_catalog.now(), p_actor
    ) RETURNING id, automation_rule.version_no INTO v_rule_id, v_version_no;
  ELSE
    IF p_expected_version_no IS NULL OR p_expected_version_no < 1 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMMUNICATION_RULE_RPC_INVALID_VERSION';
    END IF;

    SELECT rule.id, rule.version_no INTO v_rule_id, v_version_no
    FROM erp_communication.automation_rule AS rule
    WHERE id = p_rule_id
      AND company_id = p_company_id
      AND surface_enrollment_id = p_surface_enrollment_id
      AND channel = p_channel
    FOR UPDATE;

    IF v_rule_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'COMMUNICATION_RULE_NOT_FOUND';
    END IF;
    IF v_version_no <> p_expected_version_no THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'COMMUNICATION_RULE_VERSION_CONFLICT';
    END IF;

    UPDATE erp_communication.automation_rule
    SET rule_name = pg_catalog.btrim(p_rule_name),
        status = p_status,
        dataset_key = NULLIF(pg_catalog.btrim(p_dataset_key), ''),
        subject_template = COALESCE(p_subject_template, ''),
        schedule_kind = p_schedule_kind,
        schedule_time = p_schedule_time,
        schedule_timezone = p_schedule_timezone,
        weekly_days = COALESCE(p_weekly_days, ARRAY[]::smallint[]),
        monthly_day = p_monthly_day,
        skip_empty = p_skip_empty,
        version_no = automation_rule.version_no + 1,
        last_updated_at = pg_catalog.now(),
        last_updated_by = p_actor
    WHERE id = v_rule_id
    RETURNING automation_rule.version_no INTO v_version_no;

    DELETE FROM erp_communication.automation_recipient WHERE automation_rule_id = v_rule_id;
    DELETE FROM erp_communication.automation_rule_column WHERE automation_rule_id = v_rule_id;
  END IF;

  INSERT INTO erp_communication.automation_recipient (
    automation_rule_id, recipient_type, email, active, display_order,
    created_at, created_by, last_updated_at, last_updated_by
  )
  SELECT
    v_rule_id,
    entry.recipient_type,
    pg_catalog.lower(pg_catalog.btrim(entry.email)),
    entry.active,
    entry.display_order,
    pg_catalog.now(), p_actor, pg_catalog.now(), p_actor
  FROM pg_catalog.jsonb_to_recordset(v_recipients) AS entry(
    recipient_type text, email text, active boolean, display_order integer
  );

  INSERT INTO erp_communication.automation_rule_column (automation_rule_id, field_key, display_order)
  SELECT v_rule_id, pg_catalog.btrim(entry.field_key), entry.display_order
  FROM pg_catalog.jsonb_to_recordset(v_columns) AS entry(field_key text, display_order integer);

  RETURN QUERY SELECT v_rule_id, v_version_no, p_status;
END;
$function$;

CREATE OR REPLACE FUNCTION erp_communication.set_automation_rule_status(
  p_rule_id uuid,
  p_company_id uuid,
  p_surface_enrollment_id uuid,
  p_channel text,
  p_status text,
  p_expected_version_no integer,
  p_actor uuid
)
RETURNS TABLE(rule_id uuid, version_no integer, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rule_id uuid;
  v_version_no integer;
BEGIN
  IF p_rule_id IS NULL OR p_company_id IS NULL OR p_surface_enrollment_id IS NULL
    OR p_actor IS NULL OR p_channel <> 'EMAIL' OR p_status <> 'INACTIVE'
    OR p_expected_version_no IS NULL OR p_expected_version_no < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMMUNICATION_RULE_RPC_INVALID_INPUT';
  END IF;

  SELECT rule.id, rule.version_no INTO v_rule_id, v_version_no
  FROM erp_communication.automation_rule AS rule
  WHERE id = p_rule_id
    AND company_id = p_company_id
    AND surface_enrollment_id = p_surface_enrollment_id
    AND channel = p_channel
  FOR UPDATE;

  IF v_rule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'COMMUNICATION_RULE_NOT_FOUND';
  END IF;
  IF v_version_no <> p_expected_version_no THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'COMMUNICATION_RULE_VERSION_CONFLICT';
  END IF;

  UPDATE erp_communication.automation_rule
  SET status = 'INACTIVE', version_no = automation_rule.version_no + 1,
      last_updated_at = pg_catalog.now(), last_updated_by = p_actor
  WHERE id = v_rule_id
  RETURNING automation_rule.version_no INTO v_version_no;

  RETURN QUERY SELECT v_rule_id, v_version_no, 'INACTIVE'::text;
END;
$function$;

ALTER FUNCTION erp_communication.save_automation_rule(
  uuid, uuid, uuid, text, text, text, text, text, text, time, text, smallint[], smallint,
  boolean, integer, jsonb, jsonb, uuid
) OWNER TO postgres;
ALTER FUNCTION erp_communication.set_automation_rule_status(uuid, uuid, uuid, text, text, integer, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION erp_communication.save_automation_rule(
  uuid, uuid, uuid, text, text, text, text, text, text, time, text, smallint[], smallint,
  boolean, integer, jsonb, jsonb, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION erp_communication.set_automation_rule_status(uuid, uuid, uuid, text, text, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_communication.save_automation_rule(
  uuid, uuid, uuid, text, text, text, text, text, text, time, text, smallint[], smallint,
  boolean, integer, jsonb, jsonb, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION erp_communication.set_automation_rule_status(uuid, uuid, uuid, text, text, integer, uuid)
  TO service_role;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
