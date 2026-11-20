-- 15.299 수주 → 생산의뢰 연결: 생산의뢰서가 어느 수주에서 만들어졌는지(수주 상세에서 「생산의뢰 만들기」). 기존 데이터는 그대로(연결 없음).
ALTER TABLE production_requests ADD COLUMN sales_order_id INTEGER;
--> statement-breakpoint
ALTER TABLE production_requests ADD COLUMN sales_order_no TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX production_requests_sales_order ON production_requests(sales_order_id);
