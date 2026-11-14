-- Start / end clock times on semi-finished work records; work_hours is derived from them.
ALTER TABLE semi_records ADD COLUMN start_time TEXT;
ALTER TABLE semi_records ADD COLUMN end_time TEXT;
