ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending','approved','rejected'));
ALTER TABLE users ADD COLUMN approval_note TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN reviewed_by TEXT;
ALTER TABLE users ADD COLUMN reviewed_at TEXT;
