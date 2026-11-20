-- 15.302 연구소 지식재산권 관리: 구분(특허·실용신안·디자인·상표·저작권·반도체 배치설계·영업비밀·기타)·국가·등록/출원번호·명칭·권리자·출원일·등록일·
-- 유효기간(만료일)·다음 기한(연차료 납부·존속기간 갱신)·상태(출원 준비·출원중·심사중·등록완료·거절(불허)·포기·취하·소멸)·담당자·관련 제품·메모·갱신 이력(JSON).
CREATE TABLE ip_rights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'KR',
  title TEXT NOT NULL,
  reg_no TEXT NOT NULL DEFAULT '',
  app_no TEXT NOT NULL DEFAULT '',
  app_date TEXT,
  reg_date TEXT,
  expire_date TEXT,
  next_due TEXT,
  due_kind TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'filed',
  holder TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  product TEXT NOT NULL DEFAULT '',
  agent TEXT NOT NULL DEFAULT '',
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
CREATE INDEX ip_rights_next_due ON ip_rights(next_due);
--> statement-breakpoint
CREATE INDEX ip_rights_status ON ip_rights(status);
--> statement-breakpoint
CREATE UNIQUE INDEX ip_rights_request ON ip_rights(request_id) WHERE request_id IS NOT NULL;
