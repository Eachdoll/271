-- Size (seamless gloves: XS–XL) or inch spec (wipers) on semi-finished work records.
ALTER TABLE semi_records ADD COLUMN spec TEXT NOT NULL DEFAULT '';
