ALTER TABLE requests ADD COLUMN source_type TEXT;
ALTER TABLE requests ADD COLUMN source_id INTEGER;
CREATE UNIQUE INDEX requests_source_unique ON requests(source_type, source_id);
