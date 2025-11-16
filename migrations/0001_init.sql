CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  to_json TEXT NOT NULL,
  from_text TEXT NOT NULL,
  posted_iso TEXT NOT NULL,
  updated_iso TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_notices_updated_iso ON notices (updated_iso);
