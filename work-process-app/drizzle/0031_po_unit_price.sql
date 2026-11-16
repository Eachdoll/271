-- 발주 단가(발주서 출력용). 기존 발주는 빈 값(NULL)으로 두고 추정해 채우지 않는다. 칸만 추가한다.
ALTER TABLE purchase_orders ADD COLUMN unit_price REAL;
