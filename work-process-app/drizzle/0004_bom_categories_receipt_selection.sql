ALTER TABLE boms ADD COLUMN item_category TEXT NOT NULL DEFAULT '';
ALTER TABLE other_receipts ADD COLUMN bom_id INTEGER REFERENCES boms(id);
ALTER TABLE other_receipts ADD COLUMN bom_snapshot TEXT NOT NULL DEFAULT '{}';
