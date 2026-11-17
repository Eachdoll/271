-- 15.132 출고지시서(묶음): 출하지시 여러 줄을 한 장(DO-…)으로 묶어 피킹·출고. 새 표 1개 + 출하지시에 batch_id 열 추가만.
-- status: open(진행) / cancelled(묶음 풀기, 지우지 않음). 출고 완료 여부는 지시 상태로 계산한다.
CREATE TABLE ship_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_no TEXT NOT NULL UNIQUE,
  plan_date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','cancelled')),
  request_id TEXT UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  cancelled_by TEXT,
  cancelled_at TEXT
);
ALTER TABLE ship_instructions ADD COLUMN batch_id INTEGER;
CREATE INDEX ship_instructions_batch ON ship_instructions(batch_id);
