-- Break time on semi-finished work records and an optional yield target per line / washer.
ALTER TABLE semi_records ADD COLUMN break_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE production_units ADD COLUMN yield_target REAL;
