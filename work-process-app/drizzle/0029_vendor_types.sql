-- 거래처 구분: 매입처(is_purchase)·매출처(is_sales). 둘 다 체크할 수 있고, 둘 다 0이면 「구분 없음」으로 어느 목록에나 나온다.
-- 기존 표·데이터는 지우거나 바꾸지 않고 칸만 추가한다. 아래 UPDATE는 지금까지의 기록으로 구분을 채운다(이름 비교는 공백 제거·소문자).
ALTER TABLE vendors ADD COLUMN is_purchase INTEGER NOT NULL DEFAULT 0 CHECK(is_purchase IN (0,1));
ALTER TABLE vendors ADD COLUMN is_sales INTEGER NOT NULL DEFAULT 0 CHECK(is_sales IN (0,1));
UPDATE vendors SET is_purchase=1 WHERE name_key IN (SELECT LOWER(REPLACE(vendor,' ','')) FROM purchase_orders UNION SELECT LOWER(REPLACE(vendor,' ','')) FROM other_receipts);
UPDATE vendors SET is_sales=1 WHERE name_key IN (SELECT LOWER(REPLACE(customer,' ','')) FROM shipments UNION SELECT LOWER(REPLACE(customer,' ','')) FROM production_requests);
