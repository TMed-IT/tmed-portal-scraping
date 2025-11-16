CREATE TABLE IF NOT EXISTS notice_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notice_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  public_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (notice_id, r2_key)
);

CREATE INDEX IF NOT EXISTS idx_notice_attachments_notice_id ON notice_attachments (notice_id);
CREATE INDEX IF NOT EXISTS idx_notice_attachments_created_at ON notice_attachments (created_at);
