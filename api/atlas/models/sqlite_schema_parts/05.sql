-- Append-only record of operator decisions that change data. Rows are written
-- by the authorization layer before the change runs and can never be updated
-- or deleted, so the history of who approved, rejected or edited what stays
-- honest even for the operator who wrote it.
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    occurred_at TEXT NOT NULL,
    plane TEXT NOT NULL CHECK (plane IN ('customer', 'staff', 'machine', 'local')),
    actor_id TEXT NOT NULL,
    actor_email TEXT,
    auth_type TEXT NOT NULL,
    action TEXT NOT NULL,
    allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
    status_code INTEGER NOT NULL,
    method TEXT NOT NULL,
    route TEXT NOT NULL,
    target_json TEXT NOT NULL DEFAULT '{}',
    reason TEXT,
    request_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at ON audit_log(occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action_occurred_at ON audit_log(action, occurred_at);

CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only');
END;

-- Scout workers their owner revoked. A Scout sign-in names the enrolled worker
-- it belongs to; once its owner revokes that worker, the API refuses its job
-- claims and lease updates even while an already-issued token is unexpired.
CREATE TABLE IF NOT EXISTS scout_worker_revocations (
    worker_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    revoked_at TEXT NOT NULL,
    PRIMARY KEY (worker_id, user_id)
);
