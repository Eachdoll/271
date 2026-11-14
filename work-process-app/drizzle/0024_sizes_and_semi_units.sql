-- 방진복처럼 사이즈가 정해진 분류: 분류에 사이즈 묶음을 두면 그 아래 품목은 발주·입고·출하에서 사이즈별 수량으로 입력한다.
ALTER TABLE item_category_nodes ADD COLUMN sizes TEXT NOT NULL DEFAULT '';
-- 반제품이 아닌 품목(예: 제품 NX-707)도 '반제품으로도 사용'을 켜면 커팅/융착·세탁에서 고른다.
-- 생산 기록 단위(semi_unit, 예: 매)와 품목 단위(unit, 예: 박스)가 다르면 1 unit = pack_qty semi_unit 으로 환산한다.
ALTER TABLE boms ADD COLUMN semi_unit TEXT NOT NULL DEFAULT '';
ALTER TABLE boms ADD COLUMN pack_qty REAL CHECK(pack_qty IS NULL OR pack_qty > 0);
