-- Semi-finished catalog items say which kind they are (부직포와이퍼 / 천와이퍼 / 스무드 / 타키),
-- and work records point at the catalog item (model) that was made.
ALTER TABLE boms ADD COLUMN semi_type TEXT NOT NULL DEFAULT '';
ALTER TABLE semi_records ADD COLUMN bom_id INTEGER REFERENCES boms(id);
ALTER TABLE semi_records ADD COLUMN item_name TEXT NOT NULL DEFAULT '';
ALTER TABLE semi_records ADD COLUMN product_code TEXT NOT NULL DEFAULT '';
ALTER TABLE semi_records ADD COLUMN bom_snapshot TEXT NOT NULL DEFAULT '{}';
CREATE INDEX boms_semi_type ON boms(semi_type);
