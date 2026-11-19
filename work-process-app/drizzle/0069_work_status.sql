-- 15.255 작업중 입력: 커팅·세탁·포장을 LOT만 먼저 저장(작업중, 수량 0)하고 수량을 넣으면 작업완료.
ALTER TABLE semi_records ADD COLUMN work_status TEXT NOT NULL DEFAULT 'done';
--> statement-breakpoint
ALTER TABLE production_actuals ADD COLUMN work_status TEXT NOT NULL DEFAULT 'done';
