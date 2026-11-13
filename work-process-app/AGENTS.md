# AGENTS.md (Codex / AI 에이전트용 안내)

## 구조
- `worker.mjs` — 운영 Worker의 REST API, 인증, 부서별 업무 규칙. 요청마다 D1/R2 바인딩을 사용합니다.
- `storage.mjs` — 비동기 D1 쿼리 어댑터. 쿼리 결과를 사용하기 전에 반드시 await 하세요.
- `drizzle/` — 순서대로 적용하는 D1 스키마 마이그레이션. 적용한 SQL/저널은 수정하지 마세요.
- `.openai/hosting.json` — 기존 Sites ID와 D1/R2 선언. ID와 공유 범위를 유지하세요.
- `server.js`, `local.mjs` — 로컬 Node.js HTTP 서버 및 SQLite/사진 어댑터. 운영 번들에는 포함하지 않습니다.
- `scripts/build.mjs` — `dist/server/index.js`에 Worker 및 public 파일을 묶는 의존성 없는 빌드.
- `public/index.html` — 단일 페이지.
- `public/forms.js` — 분석/개발/샘플 의뢰 양식 정의. `core: true`만 서버 컬럼이고 나머지는 requests.data JSON입니다.
- `public/app.js` — 해시 라우트, 업무 화면, 관리자 백업.
- `public/style.css` — CSS 변수 기반, 다크모드 지원.
- `test/api.test.js`, `test/worker.test.mjs` — 기존 업무 및 Worker/스토리지 통합 검증.

## 규칙
- 외부 패키지를 추가하지 마세요. Workers에서는 fs, node:sqlite, Node HTTP 서버를 사용할 수 없습니다.
- 의뢰 상태: pending → waiting → progress → done, 반려는 rejected.
- 승인/반려/상태변경 권한: analysis=quality, development=dev, sample=production.
- 발주 입고 상태 recv_status: 빈 값(미입고), ok(초록), mismatch(빨강, recv_qty 필수), checking(노랑).
- 생산일정 period: day/week(월요일로 정규화)/month(1일로 정규화).
- 사용자 입력은 화면에 넣기 전에 반드시 esc()로 이스케이프하세요.
- D1 prepare마다 한 문장만 사용하고 다중 쿼리는 batch를 사용하세요. 요청 처리 중 DDL을 실행하지 마세요.
- 운영 시간은 Asia/Seoul입니다. 클라우드 호스트의 UTC 기본값에 의존하지 마세요.
- 사진은 R2 비공개 객체로 저장하며 다운로드에도 앱 인증이 필요합니다.
- 초대코드 등 비밀 값은 Sites 환경변수로 설정하며 소스/번들/manifest에는 넣지 마세요.
- 기존 SQLite 데이터 이관은 별도 작업입니다. 기존 파일을 삭제하거나 계정을 자동 덮어쓰지 마세요.

## 확인
```bash
npm test
npm run build
INVITE_CODE=local-test-code npm start
```

후속 배포는 DEPLOY.md를 따르세요. GitHub 푸시와 Sites 배포는 별개입니다.
