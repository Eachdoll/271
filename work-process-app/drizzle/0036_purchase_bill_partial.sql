-- 매입전표 수량 나눠 잡기(15.82). 명세서 수량이 입고 수량과 다르면 고쳐 잡고, 덜 잡은 수량은 다음 전표에서 잡는다.
-- 그래서 「입고 줄 하나 = 유효한 전표 줄 하나」 UNIQUE 인덱스를 일반 인덱스로 바꾼다(겹쳐 잡기는 서버가 저장 순간 합계로 막음).
-- source_qty: 전표를 잡을 때의 입고 수량(차이 표시용). 기존 줄은 NULL. 기존 데이터는 바꾸지 않는다.
DROP INDEX IF EXISTS purchase_bill_lines_source;
CREATE INDEX purchase_bill_lines_src ON purchase_bill_lines(source_type, source_id, active);
ALTER TABLE purchase_bill_lines ADD COLUMN source_qty REAL;
