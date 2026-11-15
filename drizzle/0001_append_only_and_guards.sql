-- Custom migration: database-level guards that application code cannot bypass by accident.
--
-- 1. Append-only tables: consent_record, credit_ledger, audit_log.
-- 2. Sessions: a hard expiry ceiling (staff: 12 hours) and an immutable two-factor flag.
-- 3. Published course versions are frozen.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Append-only protection
--
-- UPDATE is never allowed. DELETE and TRUNCATE are allowed only inside a transaction that has
-- declared maintenance with
--     select set_config('app.append_only_maintenance', '<reason>', true);
-- which `withAppendOnlyMaintenance()` in src/server/db/append-only.ts does for the nightly
-- retention job, account deletion and test clean-up. The setting is transaction-local, so it
-- cannot leak to another request.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION forbid_append_only_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE')
     AND coalesce(current_setting('app.append_only_maintenance', true), '') IN ('retention', 'account_deletion', 'test_reset') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'Table "%" is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation',
          HINT = 'Insert a correcting row instead. Retention clean-up must go through withAppendOnlyMaintenance().';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER consent_record_append_only BEFORE UPDATE OR DELETE ON "consent_record"
  FOR EACH ROW EXECUTE FUNCTION forbid_append_only_change();
--> statement-breakpoint
CREATE TRIGGER consent_record_no_truncate BEFORE TRUNCATE ON "consent_record"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_append_only_change();
--> statement-breakpoint
CREATE TRIGGER credit_ledger_append_only BEFORE UPDATE OR DELETE ON "credit_ledger"
  FOR EACH ROW EXECUTE FUNCTION forbid_append_only_change();
--> statement-breakpoint
CREATE TRIGGER credit_ledger_no_truncate BEFORE TRUNCATE ON "credit_ledger"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_append_only_change();
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION forbid_append_only_change();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_append_only_change();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Session guards
--
-- Better Auth extends expires_at whenever a session is used. `absolute_expires_at` is the hard
-- ceiling set at sign-in (12 hours for staff, spec 3.1): expires_at can never pass it, and the
-- ceiling itself can never be raised or removed. `two_factor_verified` is decided when the session
-- is created and can never be switched on afterwards.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION guard_session() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.absolute_expires_at IS NOT NULL
       AND (NEW.absolute_expires_at IS NULL OR NEW.absolute_expires_at > OLD.absolute_expires_at) THEN
      NEW.absolute_expires_at := OLD.absolute_expires_at;
    END IF;
    IF NEW.two_factor_verified AND NOT OLD.two_factor_verified THEN
      NEW.two_factor_verified := false;
    END IF;
  END IF;
  IF NEW.absolute_expires_at IS NOT NULL AND NEW.expires_at > NEW.absolute_expires_at THEN
    NEW.expires_at := NEW.absolute_expires_at;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER session_guard BEFORE INSERT OR UPDATE ON "session"
  FOR EACH ROW EXECUTE FUNCTION guard_session();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Published course versions are immutable
--
-- Once published_at is set, the content and identity of a version are frozen. Status, the
-- materialised/published timestamps and internal notes may still change (retire, take down).
-- Further edits create a new revision.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION forbid_published_version_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.published_at IS NOT NULL AND (
       NEW.snapshot IS DISTINCT FROM OLD.snapshot
    OR NEW.course_id IS DISTINCT FROM OLD.course_id
    OR NEW.revision IS DISTINCT FROM OLD.revision
    OR NEW.semver IS DISTINCT FROM OLD.semver
    OR NEW.origin IS DISTINCT FROM OLD.origin
    OR NEW.published_at IS NULL
  ) THEN
    RAISE EXCEPTION 'course_version % is published and immutable: create a new revision instead', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER course_version_immutable_once_published BEFORE UPDATE ON "course_version"
  FOR EACH ROW EXECUTE FUNCTION forbid_published_version_change();
