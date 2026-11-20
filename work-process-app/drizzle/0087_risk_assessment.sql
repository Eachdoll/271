-- 15.313 생산 › 위험성평가: 작업 위험성평가(KOSHA 「사업장 위험성평가에 관한 지침」) · 공정 FMEA(AIAG-VDA AP) · HAZOP(IEC 61882). 기존 표·데이터는 그대로.
-- risk_assessments: 평가서 한 건(머리 정보 + 워크시트 줄 rows JSON). 작성 → 검토 요청 → 승인 → 개정(rev+1)·폐지.
-- 줄마다 감소대책·담당·기한·완료일·조치 후 재평가, CAPA로 넘긴 줄은 nc_id.
CREATE TABLE risk_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ra_no TEXT NOT NULL,
  method TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'regular',
  scale INTEGER NOT NULL DEFAULT 3,
  process TEXT NOT NULL DEFAULT '',
  item TEXT NOT NULL DEFAULT '',
  equipment_id INTEGER,
  scope TEXT NOT NULL DEFAULT '',
  team TEXT NOT NULL DEFAULT '',
  assess_date TEXT,
  next_review TEXT,
  rows TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  rev INTEGER NOT NULL DEFAULT 0,
  rev_note TEXT NOT NULL DEFAULT '',
  approved_by TEXT NOT NULL DEFAULT '',
  approved_at TEXT,
  history TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  request_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX risk_assessments_no ON risk_assessments(ra_no);
--> statement-breakpoint
CREATE UNIQUE INDEX risk_assessments_request ON risk_assessments(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX risk_assessments_status ON risk_assessments(method, status);
