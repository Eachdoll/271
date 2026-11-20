-- 15.276 개발 스케줄 관리(로드맵): 개발 의뢰(requests type=development)마다 구분(단기·중장기·장기)·시작일·완료예정일·진행률·현재 진행현황·다음 진행예정과 공정표(단계별 기간·상태).
CREATE TABLE dev_plans (
  request_id INTEGER PRIMARY KEY,
  term TEXT NOT NULL DEFAULT '' CHECK(term IN ('','short','mid','long')),
  start_date TEXT NOT NULL DEFAULT '',
  target_date TEXT NOT NULL DEFAULT '',
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  current_stage TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  next_date TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
--> statement-breakpoint
CREATE TABLE dev_plan_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')),
  note TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX dev_plan_steps_request ON dev_plan_steps(request_id, sort);
