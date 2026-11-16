-- 15.117 전표 줄 분류(원자재·부자재·반제품·제품·상품·임가공)를 저장 시점 값으로 고정한다.
-- 이 칸이 빈 예전 줄은 화면에서 제품코드로 품목 분류를 읽어 보여 준다(기존 데이터는 바꾸지 않음).
ALTER TABLE sales_bill_lines ADD COLUMN item_category TEXT NOT NULL DEFAULT '';
ALTER TABLE purchase_bill_lines ADD COLUMN item_category TEXT NOT NULL DEFAULT '';
