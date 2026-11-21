-- 15.321 연구소 개발원가 = 개발 아이템이 양산되면 원가가 얼마인지 미리 계산(구매 원가 산출 관리와 같은 계산·백데이터·공통 기준).
-- cost_items.stage: mass(구매 양산 원가, 기존 품목 모두) / dev(연구소 예상 원가). dev_request_id: 개발리스트의 개발 건. 칸 추가만.
ALTER TABLE cost_items ADD COLUMN stage TEXT NOT NULL DEFAULT 'mass';
--> statement-breakpoint
ALTER TABLE cost_items ADD COLUMN dev_request_id INTEGER;
--> statement-breakpoint
CREATE INDEX cost_items_stage ON cost_items(stage, dev_request_id);
