# R61 추가 검증 자료

검증 대상은 Eachdoll/271의 `32c854d`, 새 초안 weave 6입니다. 전체 결과는 앱 루트의 `CODEX_R61_VERIFICATION_2026-11-11.md`를 보세요.

제품 소스는 고치지 않았습니다. 기존 테스트 1203+85개와 브라우저 검사는 통과했지만 추가 승인 조건 5개는 실패했습니다. 운영 v66/v129는 유지했습니다.

## 무료 재현

앱 루트에서 Node 24로 실행합니다. 모델은 가짜 응답이며 fetch는 차단됩니다. 키가 필요 없고, 이미 산 R60 원고의 글은 `QA/r60-text/manuscript.json`에서 읽습니다.

```bash
DONGHWA_APP_ROOT="$PWD" DONGHWA_AUDIT_OUT=/tmp/r61-recheck node QA/r61-verification/tools/recheck.mjs
```

선택적으로 `DONGHWA_R60_ROOT`에 R60 앱 체크아웃을 지정하면 기존 요청의 바이트 비교도 수행합니다.

`recheck.json`의 `acceptance` 다섯 값과 `blockingFindings`를 확인하세요. 현재는 모두 false, 5건입니다. 이 재현기는 결과를 모으므로 종료 코드 0이 모든 조건의 통과를 뜻하지 않습니다. `networkCalls`는 0이어야 합니다.

- A: 실제 글 수정 → 그림 요청에서 옛 영어·인물·장소가 남는지.
- D: 실제 초고 단계에서 수정본 쪽 수를 1 늘렸을 때 보호 쪽의 사건 변경을 받아들이는지. 그림 메모·문장 추가 예외도 함께 측정.
- H: 실제 초고 → 쪽 나누기 → 레거시 표시 변환에서 누락 영어가 한글로 채워지는지.
- B: 실제 FULL AUTO로 만든 한 쪽 인물을 서랍에서 수정·삭제하면 기존 책의 요청이 바뀌는지.
- F: 최종 렌더러가 허용한 글자를 수채화·크레용의 positive style이 다시 금지하는지.

`edited-page-request.txt`의 참조 URL은 qa.invalid의 가짜 주소입니다. 실제 그림, 원본 복구 백업, API 키·PIN은 포함하지 않습니다.
