-- 15.127 매입 세금계산서: 매입처에게 받은 세금계산서를 매입전표와 묶어 기록(국세청 승인번호·작성일자). 새 표 2개만 추가.
-- status: received(받음) / cancelled(취소, 지우지 않음). 한 매입전표는 유효한 매입 계산서 하나에만.
CREATE TABLE purchase_tax_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL UNIQUE,
  approval_no TEXT NOT NULL DEFAULT '',
  write_date TEXT NOT NULL,
  vendor TEXT NOT NULL,
  biz_no TEXT NOT NULL DEFAULT '',
  supply_total REAL NOT NULL DEFAULT 0,
  vat_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','cancelled')),
  request_id TEXT UNIQUE,
  created_by TEXT NOT NULL,
  created_by_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancel_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX purchase_tax_invoices_date ON purchase_tax_invoices(write_date, id);
CREATE TABLE purchase_tax_invoice_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  bill_id INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE INDEX purchase_tax_invoice_bills_invoice ON purchase_tax_invoice_bills(invoice_id);
CREATE UNIQUE INDEX purchase_tax_invoice_bills_one ON purchase_tax_invoice_bills(bill_id) WHERE active=1;
