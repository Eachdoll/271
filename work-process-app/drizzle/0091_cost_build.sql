-- 15.320 원가 산출 관리 › 제품 사양(포장 구조·포장당/외포장당/박스당 sh·시트·원단 폭·자재 매입가)으로 원가 줄 자동 계산.
-- 사양은 품목마다 cost_items.build(JSON)에 둔다. 기존 표·데이터는 그대로(칸 추가만, 기본값 '{}').
ALTER TABLE cost_items ADD COLUMN build TEXT NOT NULL DEFAULT '{}';
