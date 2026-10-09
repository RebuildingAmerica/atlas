-- Append-only record of operator decisions that change data. Rows are written
-- by the authorization layer before the change runs and can never be updated,
-- deleted or truncated, so the history of who approved, rejected or edited what
-- stays honest even for the operator who wrote it.
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL,
    plane TEXT NOT NULL CHECK (plane IN ('customer', 'staff', 'machine', 'local')),
    actor_id TEXT NOT NULL,
    actor_email TEXT,
    auth_type TEXT NOT NULL,
    action TEXT NOT NULL,
    allowed BOOLEAN NOT NULL,
    status_code INTEGER NOT NULL,
    method TEXT NOT NULL,
    route TEXT NOT NULL,
    target_json TEXT NOT NULL DEFAULT '{}',
    reason TEXT,
    request_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at ON audit_log(occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action_occurred_at ON audit_log(action, occurred_at);

CREATE OR REPLACE FUNCTION audit_log_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

CREATE OR REPLACE TRIGGER audit_log_append_only
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();

CREATE OR REPLACE TRIGGER audit_log_no_truncate
    BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_change();

-- Scout workers their owner revoked. A Scout sign-in names the enrolled worker
-- it belongs to; once its owner revokes that worker, the API refuses its job
-- claims and lease updates even while an already-issued token is unexpired.
CREATE TABLE IF NOT EXISTS scout_worker_revocations (
    worker_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    revoked_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (worker_id, user_id)
);

-- Profiles an editor took down, such as at the person's own request. While a
-- takedown stands, nothing republishes the profile: not an approval, not a
-- registry match, not the next discovery run. Restoring it is its own
-- decision, recorded on the same row.
CREATE TABLE IF NOT EXISTS entry_takedowns (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    entry_name TEXT NOT NULL,
    entry_slug TEXT,
    entry_type TEXT NOT NULL,
    reason TEXT NOT NULL,
    was_active BOOLEAN NOT NULL,
    taken_down_by TEXT NOT NULL,
    taken_down_at TIMESTAMPTZ NOT NULL,
    restored_by TEXT,
    restored_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entry_takedowns_standing
    ON entry_takedowns(entry_id) WHERE restored_at IS NULL;

-- Switches the platform operator flips in the platform admin to stop
-- discovery spend or pause sales without a release. A missing row means the
-- switch was never engaged.
CREATE TABLE IF NOT EXISTS platform_switches (
    name TEXT PRIMARY KEY,
    engaged BOOLEAN NOT NULL,
    reason TEXT NOT NULL,
    changed_by TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL
);

-- The promise holds at the bottom: no code path, present or future, can
-- publish an entry while a takedown stands for it.
CREATE OR REPLACE FUNCTION entries_refuse_taken_down_publish() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.active AND EXISTS (
        SELECT 1 FROM entry_takedowns
        WHERE entry_id = NEW.id AND restored_at IS NULL
    ) THEN
        RAISE EXCEPTION 'entry is taken down';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER entries_stay_down
    BEFORE UPDATE OF active ON entries
    FOR EACH ROW EXECUTE FUNCTION entries_refuse_taken_down_publish();
