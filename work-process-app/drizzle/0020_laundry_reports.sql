-- 세탁물 검수·성적서: 세탁 업체가 보낸 리스트를 검수해 세탁일별로 기록하고 확인표(성적서)를 발행한다.
CREATE TABLE laundry_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wash_date TEXT NOT NULL UNIQUE,
  pickup_label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued')),
  inspector TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  prices TEXT NOT NULL DEFAULT '',
  issued_by TEXT NOT NULL DEFAULT '',
  issued_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE laundry_report_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES laundry_reports(id),
  section TEXT NOT NULL CHECK(section IN ('wash','discard')),
  garment TEXT NOT NULL,
  part TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK(qty > 0),
  UNIQUE(report_id, section, garment, part, size)
);
CREATE INDEX laundry_report_lines_report ON laundry_report_lines(report_id);
