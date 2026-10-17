# 동화공방 — Claude Code 시작 안내

프런트엔드, 클라우드 보관 API, 이미지/글 어댑터, 읽기 검사, 품질 패키지, 자동화 도구와 테스트를 모두 포함한 개발 소스입니다. 배포된 동화공방: https://donghwa-workshop.seoulsemitec-3654.chatgpt.site

이 코드는 r3 검토 통과 이후 실평가 수정 커밋을 통합한 Codex r4입니다. [평가 통합 보고](EVAL_INTEGRATION_2026-10-17.md)를 먼저 읽으세요. 먼저 [r3 완료 보고](CODEX_R3_COMPLETION_2026-10-17.md)를 읽으세요. A-18 포매팅과 A/B 지시서 작업은 반영되어 있으며, [완료 보고](CODEX_COMPLETION_2026-10-17.md)에 변경 파일·검증·남은 실기기 확인 범위를 정리했습니다. 후속 작업은 이 상태를 기준으로 진행하세요.

## 가장 빠른 시작

압축을 풀고 프로젝트 폴더를 Claude Code로 여세요. `CLAUDE.md`가 작업 안내입니다. Node.js 22.13 이상, Python 3은 간단한 미리보기와 선택적 브라우저 검증에 사용합니다.

```bash
# 루트에서: 컴파일된 JS가 포함되어 있으므로 설치 없이 테스트 가능
npm test
npm run test:quality

# 프런트엔드 미리보기
python3 -m http.server 4174 --bind 127.0.0.1 --directory dist
```

브라우저에서 http://127.0.0.1:4174 를 엽니다. 로컬 PIN은 처음에 직접 정합니다. 클라우드 로그인/동기화는 정적 미리보기에서 제공되지 않습니다. 프런트엔드·재료·인쇄·샘플·품질 도구 개발에는 이 경로로 시작할 수 있습니다. 실제 생성은 해당 공급자의 API 키 또는 로컬 모델이 필요합니다.

## 전체 Worker 빌드와 로컬 보관 API

```bash
npm --prefix cloud-runtime ci
npm run build
```

`npm run build`는 품질 TypeScript를 컴파일한 다음 프런트엔드를 `cloud-runtime/public/`에 복사하고 `cloud-runtime/dist/`에 Worker와 자산을 생성합니다. 루트 `dist/`는 소스이므로 지우면 안 됩니다. 락파일은 `cloud-runtime/package-lock.json`입니다.

새 로컬 DB에 아래 마이그레이션을 순서대로 한 번씩 적용합니다. 이미 적용한 로컬 DB에 재실행하지 마세요.

```bash
cd cloud-runtime
npm exec -- wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_steep_zodiak.sql
npm exec -- wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_white_reptil.sql
npm start -- --ip 127.0.0.1 --port 4173 --local --persist-to .wrangler/state --inspector-port 0
```

인증은 운영 Sites의 검증된 헤더 주입과 연결됩니다. 로컬·다른 호스팅에서 실사용자 로그인까지 구현하려면 별도 인증 연결이 필요합니다. 테스트용 사용자 헤더를 그대로 공개 인증으로 사용하지 마세요. D1/R2에는 기존 운영 사용자 자료가 들어 있으므로 이 ZIP에서 DB를 복제하거나 초기화하지 않습니다.

## 코드 지도

| 위치 | 역할 |
| --- | --- |
| `dist/app.js`, `dist/style.css` | 화면·책 편집·설정·인쇄 연결 |
| `dist/full-auto.js`, `dist/full-auto-ui.js` | 저장 가능한 자동 제작·진행 카드·중지/재개 |
| `dist/image-generation/` | 이미지 공급자·시트·장소 참조·화풍·시드·생성 전 검수 |
| `dist/story-generation/` | 앱 줄거리/전문/쪽 파이프라인·상태 장부·품질 연결·검토 UI |
| `dist/text-generation/` | 글 공급자·역할별 모델·비용·설정 |
| `dist/cloud-sync.js`, `server/cloud-api.js` | 기기 캐시와 계정별 클라우드 동기화 |
| `story-quality/src/`, `data/`, `gold/` | 품질 패키지 TypeScript·확장 재료·100세계·골드24편 |
| `story-quality/src/cli/` | 주제 생성·증류·평가·LoRA 데이터 변환 |
| `cloud-runtime/` | Vinext/Cloudflare 런타임·DB 스키마·마이그레이션 |
| `image-proxy/` | 선택적인 Node 이미지/글 프록시 |
| `tests/`, `story-quality/test/` | 실제 API를 대신하는 모의 응답과 회귀 검증 |

## 2026-10-17 패키지 사용

기본 물건323종·생물260종과 변형, 세계100종·계절/시간 오버레이, 조사 처리, 활동 틀33개와 자동 주제1,200개를 포함합니다. 실패 이유3종·패턴6종은 유지합니다. 이야기의 **모험 무대**와 이미지 엔진/화풍 **World**는 별개입니다. 기본은 기존 배경 서랍이며, 선택한 세계 카드는 새 재료 계획과 분위기에 사용합니다. 그림에는 계절·빛 분위기를 더하되 기존 배경에 새 건물·터널을 강제로 추가하지 않습니다.

```bash
cd story-quality
# 컴파일된 CLI로, 키 없이 실행 가능
npm run topics:gen
npm run distill:estimate -- --gen anthropic:claude-sonnet-5-5 --limit 200
```

`--limit 200`은 주제200개 × 기본 언어 수준쌍2개 = 400셀입니다. 포함된 단가표 기준 추정이며 실제 청구액은 아닙니다. 미등록 단가를 무료로 표시하지 않습니다. `topics:gen`은 주제 파일을 다시 쓰므로 Git 변경을 확인하세요. 실제 유료 생성·평가·학습은 수행하지 않았습니다. 별도 문서는 `story-quality/README.md`와 `story-quality/finetune/README.md`입니다.

품질 패키지만 따로 수정/컴파일할 수도 있습니다.

```bash
cd story-quality
npm install
npm run build
npm test
```

앱에 반영할 때는 루트의 `npm run build`를 다시 실행해 공개 JS/데이터 사본을 동기화하세요. Node 전용 증류·평가 도구는 패키지의 `./node` 진입점에 분리되어 있습니다.

## 현재 범위와 인수 정보

- FULL AUTO와 주간 코치는 브라우저에서 모델을 호출합니다. 브라우저를 완전히 닫은 동안 계속 만드는 상시 작업 서버는 없습니다.
- 클라우드는 책·재료·World·미디어와 중지 요청을 보관합니다. 사용자 데이터와 API 키는 소스 ZIP에 포함하지 않았습니다. 앱 자료를 옮기려면 앱의 별도 내보내기 기능을 사용하세요.
- 최신 통합 설명: `STORY_QUALITY_INTEGRATION.md`. 이미지 규칙: `IMAGE_GENERATION.md`. 글 생성: `TEXT_GENERATION.md`.
- ZIP 안의 `SOURCE_COMMIT.txt`와 `SOURCE_MANIFEST.sha256`으로 기준 소스와 파일 무결성을 확인할 수 있습니다. `.git`·배포 토큰·의존성 설치 폴더·개발 DB·임시 로그는 포함하지 않습니다.

Claude Code에서 처음 전달할 작업 예: “CLAUDE.md와 시작 안내를 읽고 테스트부터 실행한 뒤, 기존 사건/시트/배경 참조와 체크포인트를 보존하며 요청한 기능을 수정해 줘.”
