-- 15.303 품질 › 인증서 관리: ISO 9001·14001·45001·IATF 16949·GRS·RCS·OEKO-TEX·FSC·KC 등 인증의 번호·범위·인증기관·사업장·최초 인증일·발행일·
-- 유효기간·다음 심사(사후·갱신 심사) 일정·상태(준비·신청, 유효, 정지, 만료, 취소·반납)·담당자·메모·심사 이력(JSON).
CREATE TABLE certifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  cert_no TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  site TEXT NOT NULL DEFAULT '',
  first_date TEXT,
  issue_date TEXT,
  expire_date TEXT,
  next_audit TEXT,
  audit_kind TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'valid',
  owner_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  history TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  request_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
--> statement-breakpoint
CREATE INDEX certifications_next_audit ON certifications(next_audit);
--> statement-breakpoint
CREATE INDEX certifications_expire ON certifications(expire_date);
--> statement-breakpoint
CREATE UNIQUE INDEX certifications_request ON certifications(request_id) WHERE request_id IS NOT NULL;
