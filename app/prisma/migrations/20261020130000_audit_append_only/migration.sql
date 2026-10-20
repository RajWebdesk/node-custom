-- Audit records are append-only (spec Module 9, Task #9.1).
-- Any UPDATE, DELETE, or TRUNCATE on AuditEvent is refused by the database, whatever the application does.

CREATE OR REPLACE FUNCTION audit_event_refuse_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update_or_delete
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_refuse_change();

CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_refuse_change();
