-- 세금계산서(15.83). 거래처 사업자 정보 열 추가와 새 표 2개. 기존 데이터는 바꾸지 않는다.
ALTER TABLE vendors ADD COLUMN biz_no TEXT NOT NULL DEFAULT '';
ALTER TABLE vendors ADD COLUMN biz_name TEXT NOT NULL DEFAULT '';
ALTER TABLE vendors ADD COLUMN ceo TEXT NOT NULL DEFAULT '';
ALTER TABLE vendors ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE vendors ADD COLUMN biz_type TEXT NOT NULL DEFAULT '';
ALTER TABLE vendors ADD COLUMN biz_item TEXT NOT NULL DEFAULT '';
ALTER TABLE vendors ADD COLUMN tax_email TEXT NOT NULL DEFAULT '';
ALTER TABLE vendors ADD COLUMN tax_email2 TEXT NOT NULL DEFAULT '';
-- tax_invoices: 매출 세금계산서 한 장. kind single(전표 1건) / monthly(거래처·기간 합계).
-- status: draft(담음) → queued(발행 요청) → issued(발행 완료, 승인번호) → sent(국세청 전송) / failed / cancelled.
-- 받는 쪽 사업자 정보는 담을 때 거래처에서 복사(발행 뒤 거래처가 바뀌어도 그대로).
CREATE TABLE tax_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  invoice_no TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('single','monthly')),
  write_date TEXT NOT NULL,
  period_from TEXT NOT NULL DEFAULT '',
  period_to TEXT NOT NULL DEFAULT '',
  charge TEXT NOT NULL DEFAULT 'claim' CHECK(charge IN ('claim','receipt')),
  customer TEXT NOT NULL,
  biz_no TEXT NOT NULL DEFAULT '',
  biz_name TEXT NOT NULL DEFAULT '',
  ceo TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  biz_type TEXT NOT NULL DEFAULT '',
  biz_item TEXT NOT NULL DEFAULT '',
  email1 TEXT NOT NULL DEFAULT '',
  email2 TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL DEFAULT '[]',
  item_summary TEXT NOT NULL DEFAULT '',
  supply_total REAL NOT NULL DEFAULT 0,
  vat_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','queued','issued','sent','failed','cancelled')),
  approval_no TEXT NOT NULL DEFAULT '',
  status_message TEXT NOT NULL DEFAULT '',
  issued_at TEXT,
  request_id TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_by_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT,
  updated_at TEXT,
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancel_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX tax_invoices_date ON tax_invoices(write_date, id);
CREATE INDEX tax_invoices_request ON tax_invoices(request_id);
-- tax_invoice_bills: 계산서에 담긴 매출전표. 한 전표는 유효한 계산서 하나에만.
CREATE TABLE tax_invoice_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  bill_id INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE INDEX tax_invoice_bills_invoice ON tax_invoice_bills(invoice_id);
CREATE UNIQUE INDEX tax_invoice_bills_bill ON tax_invoice_bills(bill_id) WHERE active=1;
