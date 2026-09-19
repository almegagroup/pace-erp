/* Phase 6 corrective migration: qualify locked rule version fields in shared RPCs. */

BEGIN;

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

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
