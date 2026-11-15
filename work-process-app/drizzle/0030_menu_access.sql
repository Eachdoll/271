-- 메뉴 열람 권한(화면에서 숨기고 막기). 기존 표·데이터는 바꾸지 않고 칸만 추가한다.
-- org_departments.menus: ''면 제한 없음(상위 부서 설정을 따르고, 상위도 없으면 전체). 제한하면 'home,sales,…'처럼 업무 묶음 목록.
-- users.menu_mode: department(부서 기본 따름, 기본값) · all(전체) · custom(직접 지정, users.menus 사용).
-- 처음에는 어느 부서에도 제한이 없으므로 기존 사용자 모두 지금처럼 전체 메뉴를 본다.
ALTER TABLE org_departments ADD COLUMN menus TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN menu_mode TEXT NOT NULL DEFAULT 'department' CHECK(menu_mode IN ('department','all','custom'));
ALTER TABLE users ADD COLUMN menus TEXT NOT NULL DEFAULT '';
