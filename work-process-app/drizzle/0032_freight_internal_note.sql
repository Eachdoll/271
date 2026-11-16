-- 운송비·내부 메모(15.69). 칸만 추가하고 기존 데이터는 바꾸지 않는다.
-- vendors.freight_terms: 매입처의 기본 운송비 조건(JSON 배열: when always/gte/lt, amount, fee, per order/line, note).
-- purchase_requests.freight: 의뢰서의 거래처별 운송비(JSON 객체 {거래처: 금액}). 이익 = 판매 - 매입 - 운송비.
-- purchase_orders.internal_note: 구매·물류만 보는 내부 메모(발주서에 나가지 않음). purchase_orders.freight: 이 발주에 붙는 운송비.
ALTER TABLE vendors ADD COLUMN freight_terms TEXT NOT NULL DEFAULT '[]';
ALTER TABLE purchase_requests ADD COLUMN freight TEXT NOT NULL DEFAULT '{}';
ALTER TABLE purchase_orders ADD COLUMN internal_note TEXT NOT NULL DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN freight REAL;
-- purchase_request_items.order_closed: 발주하지 않기로 닫은 의뢰 품목(발주 삭제·「발주 안 함」). 빈 값이면 발주 대기.
ALTER TABLE purchase_request_items ADD COLUMN order_closed TEXT NOT NULL DEFAULT '';
