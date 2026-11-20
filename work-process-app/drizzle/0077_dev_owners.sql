-- 15.277 개발 진행건 담당자(개발·영업). 소통 내역은 기존 progress_comments(entity_type='request')를 그대로 씀.
ALTER TABLE dev_plans ADD COLUMN dev_owner_id INTEGER;
--> statement-breakpoint
ALTER TABLE dev_plans ADD COLUMN dev_owner_name TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE dev_plans ADD COLUMN sales_owner_id INTEGER;
--> statement-breakpoint
ALTER TABLE dev_plans ADD COLUMN sales_owner_name TEXT NOT NULL DEFAULT '';
