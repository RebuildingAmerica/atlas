/** Uses portable column types so local signup and hosted admission have identical behavior. */
export const WAITLIST_SCHEMA = `
CREATE TABLE waitlist_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  product TEXT NOT NULL CHECK (product IN ('atlas_pro', 'atlas_team', 'atlas_research_pass')),
  interval TEXT,
  name TEXT NOT NULL,
  organization TEXT NOT NULL,
  intended_use TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('unconfirmed', 'waiting', 'invited', 'withdrawn', 'revoked')),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  invited_at TEXT,
  purchased_at TEXT,
  UNIQUE(email, product)
);
CREATE INDEX idx_waitlist_queue ON waitlist_requests(status, created_at);
CREATE TABLE waitlist_links (
  digest TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES waitlist_requests(id),
  kind TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE waitlist_events (
  row_number INTEGER NOT NULL,
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES waitlist_requests(id),
  action TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_waitlist_events_request ON waitlist_events(request_id, created_at);
CREATE TABLE waitlist_deliveries (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES waitlist_requests(id),
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  encrypted_message TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  provider_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_waitlist_deliveries_request ON waitlist_deliveries(request_id, created_at);
CREATE TABLE waitlist_rate_limits (
  key TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  count INTEGER NOT NULL
);
`;
