# AGENTS.md (Codex / AI 에이전트용 안내)

## 구조
- `server.js` — HTTP 서버 + REST API + SQLite 스키마(파일 상단 `CREATE TABLE`). 외부 패키지를 추가하지 마세요(내장 모듈만 사용).
- `public/index.html` — 단일 페이지.
- `public/forms.js` — 분석/개발/샘플 **의뢰 양식 정의**. 의뢰 항목 추가·변경은 여기만 고치면 됩니다
  (`core: true` 항목만 서버 컬럼, 나머지는 `requests.data` JSON).
- `public/app.js` — 화면. `PAGES`(해시 라우트 → 페이지 함수), `NAV`(사이드 메뉴). 페이지 함수는 `main` 요소에 HTML을 그리고 이벤트를 붙입니다.
- `public/style.css` — CSS 변수(`:root`) 기반, 다크모드 지원.
- `test/api.test.js` — API 통합 테스트(`node:test`).

## 규칙
- 의뢰 상태: `pending`(접수대기) → `waiting`(대기) → `progress`(진행) → `done`(완료), 반려는 `rejected`.
  승인/반려/상태변경 권한: analysis=`quality`, development=`dev`, sample=`production` (`REQUEST_TYPES`).
- 발주 입고 상태 `recv_status`: `''`(미입고), `ok`(초록), `mismatch`(빨강, `recv_qty` 필수), `checking`(노랑).
- 생산일정 `period`: `day`/`week`(월요일로 정규화)/`month`(1일로 정규화).
- 사용자 입력은 화면에 넣기 전에 반드시 `esc()`로 이스케이프.
- DB 스키마를 바꿀 때 기존 `data/app.db`가 있으므로 `ALTER TABLE`을 조건부로 추가하세요(`CREATE TABLE IF NOT EXISTS`는 기존 표를 바꾸지 않음).

## 확인
```bash
npm test
npm start   # http://localhost:3000
```
