-- Deployment migration only. Request handlers never execute DDL.
-- Large library JSON and media live in R2; D1 holds atomic revisions and pointers.
CREATE TABLE IF NOT EXISTS cloud_libraries (
  owner_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  state_json TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cloud_assets (
  owner_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'audio')),
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 41943040),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  object_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, asset_id)
);

CREATE TABLE IF NOT EXISTS auto_job_controls (
 owner_id TEXT NOT NULL, job_id TEXT NOT NULL, stop_nonce TEXT NOT NULL, requested_at TEXT NOT NULL, PRIMARY KEY (owner_id, job_id)
);
