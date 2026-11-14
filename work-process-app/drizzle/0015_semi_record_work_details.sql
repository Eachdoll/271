-- Work time, headcount and defects on semi-finished work records (for yield and defect-rate reporting).
ALTER TABLE semi_records ADD COLUMN work_hours REAL;
ALTER TABLE semi_records ADD COLUMN workers REAL;
ALTER TABLE semi_records ADD COLUMN defect_qty REAL NOT NULL DEFAULT 0;
