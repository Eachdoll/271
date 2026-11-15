-- 조직 구성: 관리자가 부서(상·하위)와 직급(서열 순서) 목록을 관리한다. 가입·사용자 설정은 이 목록에서 고른다.
-- 사용자에는 0025의 users.department / users.position 이름이 그대로 저장된다(이름 변경 시 서버가 함께 바꾼다).
-- 기존 데이터는 바꾸지 않는다. 목록은 비어 있는 상태로 시작한다.
CREATE TABLE org_departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  parent_id INTEGER,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE INDEX org_departments_parent ON org_departments(parent_id, sort);
CREATE TABLE org_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
