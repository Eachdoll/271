# 운영 v36 소스의 GitHub 전달

운영 버전 36의 수채화 봇·모노톤·슬라이드 스위치·회의 카드 통합·계속 버튼 고정·쉬운 용어 변경을 GitHub에서 병합할 수 있도록 옮겼습니다.

## 병합할 브랜치

- 저장소: https://github.com/Eachdoll/271
- 병합용: `codex/ui-v36`
- 기준: `claude/cross-owner-repo-constraint-j20lhz`의 `fc0a05a51a9c67a645f2f984487e2591b5f5b046`
- 앱 경로: 기존과 같은 `donghwa-workshop/`
- Claude의 최신 `UX_PIPELINE_REVIEW_2026-10-20.md`와 기존 다른 프로젝트는 보존했습니다.

기존 작업 브랜치에서 검토 후 병합합니다. 공유 브랜치를 강제 갱신하지 않았습니다.

```bash
git fetch origin codex/ui-v36
git merge origin/codex/ui-v36
cd donghwa-workshop
npm test
npm run test:quality
```

## 원본 커밋과 경로를 맞춘 커밋

운영용 Sites 저장소는 앱이 루트에 있지만 GitHub는 하위 폴더에 있으므로, 동일한 변경을 `donghwa-workshop/` 아래에 적용한 커밋은 SHA가 달라집니다. README 충돌은 GitHub의 기존 안내를 유지하고 새 UI 보고서 링크를 추가해 해결했습니다.

| 운영 원본 | GitHub 병합용 | 내용 |
| --- | --- | --- |
| `08f09d49a25caeba22412efadc323a24cda853b0` | `f211173f69c3b8c1ccb7789424da0d56d29a00c3` | 수채화 봇과 UX 점검 보고 |
| `54d92ad3122728f0660609a545b9d4b309538083` | `de61c41584d63ce56d04feec36a818f015f0862a` | 스위치·모노톤·회의 선택 화면 정리 |
| `0bc9e4e94b3832ca7f838d15b0208b85bd0881de` | `465aae221cc4a660d5d92d3654297936c5cef8ae` | 프로 화면의 모노톤 마무리·캐시 v61 |

원래 SHA와 이력은 별도 `codex/production-v36-source` 브랜치에 그대로 보존했습니다. 그 브랜치는 앱이 루트에 있으므로 **일반 병합에는 위 `codex/ui-v36` 브랜치를 사용**합니다.

## 검증과 핀

- 운영 `0bc9e4e`와 전달본의 앱·테스트·품질 패키지·서버·런타임·스크립트 등 **482개 파일의 Git blob SHA가 모두 같습니다**. 비교 기록: `QA/v36-github-sync.json`.
- 앱 테스트 **928개**, 품질 테스트 **84개**, 합계 **1,012개**입니다. 1,007개는 스위치 관련 새 테스트 5개가 들어가기 전 수채화 적용 단계의 합계입니다.
- 기존 R12 지문 중 화면 문구가 포함된 `review`만 갱신했습니다. 이전 값과 변경 후 값은 `QA/monochrome-ux-validation.json`에 있습니다. 생성 요청·입력·읽기 규격·데모·재개·그림·인쇄·검사·요금 지문은 동일합니다.
- 새 `review`: `564133dec96545749ad00abe83d42b7079dc624d302c11cffcf6be9664d3a1b9`.
- 서비스 워커: `donghwa-shell-v61`.
- 자세한 변경: `UI_UX_IMPLEMENTATION_2026-10-20.md`.

여기서는 유료 생성·평가를 실행하지 않았습니다. 운영 사이트에서 확인한 UI와 모바일 오프라인 검사의 제한은 원래 배포 검증 보고서에 구분해 두었습니다.
