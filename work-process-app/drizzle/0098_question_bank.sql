-- 15.341 문제은행(문항을 모아 두고 교육 테스트에 골라 씀) · 자격 시험(테스트 합격 시 자격 부여). 새 표와 칸 추가만.
CREATE TABLE question_bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  q TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  answer TEXT NOT NULL DEFAULT '',
  points INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
--> statement-breakpoint
CREATE INDEX question_bank_category ON question_bank(category);
--> statement-breakpoint
ALTER TABLE training_tests ADD COLUMN qual_kind TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE training_tests ADD COLUMN qual_months INTEGER NOT NULL DEFAULT 0;
