-- 15.284 수주 → 구매의뢰 연결: 구매의뢰서가 어느 수주에서 만들어졌는지(수주 상세에서 「구매의뢰 만들기」).
ALTER TABLE purchase_requests ADD COLUMN sales_order_id INTEGER;
--> statement-breakpoint
ALTER TABLE purchase_requests ADD COLUMN sales_order_no TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX purchase_requests_sales_order ON purchase_requests(sales_order_id);
