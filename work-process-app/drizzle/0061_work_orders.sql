-- 15.230 완제품 생산실적 작업지시번호: WOR_[실적 날짜 YYYYMMDD]_[그날 순번 3자리]. 기존 실적은 날짜별 입력 순서(id)대로 번호를 채운다(다른 값은 바꾸지 않음).
ALTER TABLE production_actuals ADD COLUMN work_order TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE production_actuals SET work_order = 'WOR_' || replace(production_date, '-', '') || '_' || printf('%03d', (SELECT COUNT(*) FROM production_actuals p2 WHERE p2.production_date = production_actuals.production_date AND p2.id <= production_actuals.id)) WHERE work_order = '';
--> statement-breakpoint
CREATE UNIQUE INDEX production_actuals_work_order ON production_actuals(work_order) WHERE work_order <> '';
