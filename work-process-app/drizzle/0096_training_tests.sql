-- 15.334 교육 후 테스트: 교육마다 테스트 1개(문항·합격 점수·응시 횟수) + 응시 기록. 새 표만(기존 교육·대상자 자료는 그대로).
CREATE TABLE training_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  training_id INTEGER NOT NULL,
  questions TEXT NOT NULL DEFAULT '[]',
  pass_score INTEGER NOT NULL DEFAULT 70,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  time_limit_min INTEGER NOT NULL DEFAULT 0,
  open INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX training_tests_one ON training_tests(training_id);
--> statement-breakpoint
CREATE TABLE training_test_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL,
  training_id INTEGER NOT NULL,
  user_id INTEGER,
  user_name TEXT NOT NULL,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  answers TEXT NOT NULL DEFAULT '[]',
  detail TEXT NOT NULL DEFAULT '[]',
  score REAL NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  request_id TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX training_test_attempts_no ON training_test_attempts(test_id, user_name, attempt_no);
--> statement-breakpoint
CREATE UNIQUE INDEX training_test_attempts_request ON training_test_attempts(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX training_test_attempts_user ON training_test_attempts(user_name, training_id);
