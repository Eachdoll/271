-- 15.345 구역별 점검 조건 켜기/끄기: 온도 점검(temp_on) · 습도 점검(hum_on). 창고처럼 습도를 관리하지 않는 구역은 습도를 끔. 칸 추가만.
ALTER TABLE env_zones ADD COLUMN temp_on INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE env_zones ADD COLUMN hum_on INTEGER NOT NULL DEFAULT 1;
