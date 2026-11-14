-- Why the defects happened, for the defect-reason breakdown in reports.
ALTER TABLE semi_records ADD COLUMN defect_reason TEXT NOT NULL DEFAULT '';
