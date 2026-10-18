# 이미지 생성 플러그인

`dist/image-generation/`은 이야기 글 생성과 분리되어 있습니다. 기존 공통 계약은 다음과 같습니다. 키는 실행 중 메모리에만 전달합니다.

```js
import {createImageGenerator} from './dist/image-generation/index.js';

const generateImage = createImageGenerator({engine: 'google', config: {apiKey}});
const result = await generateImage({
  prompt,
  stylePreset,
  referenceImages: [
    {imageUrl: characterSheet, role: 'character_front', label: 'original character'},
    ...stylePreset.styleRefImages.map(imageUrl => ({imageUrl, role: 'style_sheet'}))
  ],
  seed: 20261014,
  size: '1536x1024',
  quality: 'draft' // 'final'로 최종 생성
});
// {imageUrl, seed, meta}
```

`createWorldImagePlugin(getState).generateImage(request)`는 현재 World의 엔진·설정과 잠금 해제된 키 보관함을 사용합니다. `createImageEngine({engine, config})`는 같은 어댑터를 감싸는 추가 인터페이스이며, `capabilities()`와 `generate(request)`를 제공합니다. 후자의 결과는 `{imageBlob, seed, engineId, model, costUsd?, metadata}`입니다. Blob 인터페이스의 `seed`는 결과 시드가 없으면 요청 시드로 채워지므로, 실제 결과 시드 지원 여부는 `metadata.seedSupported`를 확인해야 합니다.

| 모듈 | 역할 |
| --- | --- |
| models.js | 모델 ID, 공식 문서 주소, 참고 단가와 이미지·책 비용 추정 |
| providers.js | 공급자 요청·참조 이미지 변환·작업 폴링·취소·공통 결과 |
| story-renderer.js | 화풍·장면·금지 요소와 참조 역할을 요청 프롬프트로 조립 |
| styles.js / style-studio.js | 기본·사용자 화풍, 금칙어, 세 장면 시험과 스타일 시트 고정 |
| world.js | World 버전, 확정 시트·옷장·화풍·배경의 책별 스냅샷 |
| vault.js | 부모 PIN에서 파생한 키로 API 키 암호화·잠금·재암호화 |
| assets.js | 이미지 Blob의 IndexedDB 저장·복원·삭제 |
| pipeline.js | 캐릭터 시트·본문·표지 생성, 동시 최대 2건, 부분 완료·취소 |
| settings-ui.js | 부모 설정, draft/final 시트 승인, 같은 프롬프트 2~3개 엔진 비교 |

## 엔진과 품질

모델 ID와 참고 단가는 `models.js`에 모았으며 공식 문서 확인 기준일은 2026-10-14입니다. `draft`와 `final`은 앱의 요청 단계이며 공급자에 따라 모델·해상도·품질 설정으로 매핑됩니다.

| 엔진 | draft | final |
| --- | --- | --- |
| Google | `gemini-3.1-flash-lite-image`, 1K | `gemini-3.1-flash-image`, 크기에 따라 1K/2K/4K |
| OpenAI | `gpt-image-2`, `low` | `gpt-image-2`, `high` |
| BFL | `flux-2-pro`, 긴 변 최대 1024 | `flux-2-pro`, 요청 크기 |
| fal | `bytedance/seedream/v5/lite` | `bytedance/seedream/v5/pro` |
| local | 부모가 연결한 ComfyUI 워크플로 | 같은 워크플로에 품질 값 전달 |
| sample | 기기 내 SVG/Canvas 템플릿 | 같은 템플릿, 품질 구분 없음 |

Google Pro 옵션은 캐릭터 시트·표지의 final 요청에서 `gemini-3-pro-image`를 선택할 수 있습니다. 본문 장면은 이 옵션을 끄고 Flash 계열을 사용합니다. fal은 참조 이미지가 있으면 `/edit`, 없으면 `/text-to-image`를 붙입니다. 기존 `low`·`medium`·`high` 등 요청의 fal 호환 경로는 `bytedance/seedream/v5/flash`입니다.

캐릭터·사진·조연·옷장 후보는 draft 확인 → 별도 final 생성 → 부모 확정 순서입니다. 무료 sample은 추가 final 호출 없이 확정합니다. 스타일 시험과 엔진 비교는 draft이며, 책 확정 전에 final 본문과 별도 표지의 예상 비용을 표시합니다. `meta.costUsdEstimated`는 출력 이미지 참고 단가 기반 추정입니다. 입력 이미지·토큰·해상도·최신 요금에 따라 실제 청구액은 달라지며, 공급자 응답에 금액이 있을 때만 `meta.costUsd`를 기록합니다.

Google 요청에는 최선 노력의 샘플링 시드를 보내지만 이미지 결과 시드는 확인할 수 없어 결과 `seed: null`을 기록합니다. OpenAI는 요청 시드를 API에 보내지 않고 결과도 `null`입니다. fal도 요청 시드를 보내지 않으며 응답에 정수 시드가 있는 경우만 결과로 저장합니다. BFL은 반환 시드 또는 요청 시드, ComfyUI는 워크플로에 연결한 요청 시드를 저장합니다. 모든 엔진의 `meta.requestedSeed`를 별도로 보존하며 같은 시드의 엔진 간 동일 그림을 보장하지 않습니다.

## 참조와 화풍 일관성

StoryRenderer는 역할이 지정된 참조를 `character_front` → `character_full` 또는 `character_variant` → `style_sheet` → `background` 순서로 보내며 이미지별 역할을 프롬프트에 명시합니다. 얼굴·몸은 캐릭터 시트, 화풍·질감은 스타일 시트, 장소 배치는 배경을 기준으로 삼습니다. 모든 요청에서 글자·로고·워터마크를 금지하고, 별도 negative 입력을 지원하지 않는 공급자에는 `Avoid: …`를 프롬프트에 추가합니다.

참조 한도는 Google 14장, OpenAI 16장, BFL 8장, fal 10장입니다. 한도를 넘는 역할 지정 요청은 뒤쪽 배경 또는 명시적으로 선택 사항인 참조를 제외하고 제외 수를 메타데이터에 남깁니다. 필수 캐릭터·스타일 참조가 한도에 들어가지 않으면 요청 전에 오류를 반환합니다. 역할 없는 기존 배열은 일부를 조용히 제외하지 않고 초과 시 오류를 반환합니다.

기본 화풍은 수채화·크레용·극장 애니메이션풍·3D 애니메이션풍 네 가지입니다. 프리셋은 `{name, stylePrompt, negativePrompt, palette, styleRefImages[]}`와 ID·버전을 가지며, 사용자 화풍은 앱에서 생성한 스타일 이미지 ID도 저장합니다. 재료·선·색·조명·구도로 설명하고 스튜디오·작가·작품 이름을 화풍 지시로 사용하지 않습니다. 기본 금칙어와 부모가 추가한 금칙어를 검사합니다. 그림 요청에서는 앱 고정 지시문을 검사하지 않고, 화풍 글은 모든 일치를, 부모가 적은 재료(캐릭터·장소·옷장 설명, 쪽 그림 지시)는 `frozen`을 앞뒤 화풍 단서("like Frozen", "Frozen style")와 함께 쓸 때를, 모델이 쓴 본문·표지 장면은 뒤 단서만 셉니다. disney·pixar·ghibli처럼 고유한 이름은 붙여 써도("DisneyPixar") 찾고, frozen·elsa·mickey처럼 일반 영어와 겹치는 이름은 낱말 단위로만 찾습니다. 출연진 이름 바로 뒤에 조사만 붙은 경우("토토로" = 토토 + 로)만 예외이며, "미야자키풍"(미야)·"겨울왕국처럼"(겨울)은 막습니다. 스타일 스튜디오는 고정된 세 장면을 시험 생성한 뒤 1~2장을 스타일 시트로 고정합니다.

수채화 v2의 실제 기준은 `/assets/hero.png` 커버입니다. 다른 기본 프리셋에는 자체 제작한 SVG 색·구도 참조가 있습니다. 기존 `local-svg`·`offline-template` 캐릭터 시트는 AI 시트 재생성의 외모 참조에서 제외합니다. 실제 생성 시트는 외모 전용으로 보내 현재 화풍으로 다시 그리도록 지시합니다. 무료 템플릿으로 생성한 스타일 시트도 AI 엔진의 스타일 기준에서 제외합니다.

엔진·화풍·고정 스타일 시트 변경은 World 버전을 올리고 확정된 캐릭터에 ‘시트 다시 생성 필요’를 표시합니다. 이전 책은 원래 스냅샷을 유지합니다. 새 책은 현재 World에 맞는 확정 시트를 필요로 하며 캐릭터·화풍·배경·옷장 선택과 쪽 범위를 책에 동결합니다. 장면은 모든 선택 캐릭터의 기본 얼굴 참조와 기본 전신 또는 승인한 옷장 두 장을 화풍 참조와 함께 전송합니다. 사진 생성도 사진과 현재 World 스타일 참조를 함께 전송하고, 승인한 결과만 저장합니다.

## 연결과 키 보관

부모 PIN에서 PBKDF2-SHA-256, 210,000회로 비추출 AES-GCM-256 키를 파생합니다. salt·IV·검증용 암호문·API 키 암호문만 localStorage에 저장하고 파생 키는 잠금 해제된 세션 메모리에만 둡니다. PIN 변경 시 저장된 API 키를 다시 암호화합니다. 아이 모드·새로고침은 보관함을 잠그며, 이전 버전의 IndexedDB 기기 키로 저장한 자격 증명은 첫 PIN 잠금 해제 때 이전합니다. API 키 평문은 책 설정·백업에 포함하지 않습니다. 기기 내 PIN과 암호화는 서버 인증이나 침해된 사이트 코드에 대한 보호를 대신하지 않습니다.

직접 호출은 공급자 계정의 모델 권한·사용량·CORS 정책을 따릅니다. 선택적인 [Node 이미지 프록시](image-proxy/README.md)는 서버 환경변수의 키만 사용하며 브라우저의 저장된 키를 보내지 않습니다. 정적 Site 자체에서 프록시 서버를 실행하지는 않습니다.

ComfyUI는 API 형식 JSON 워크플로에 `{{prompt}}`, `{{negativePrompt}}`, `{{seed}}`, `{{width}}`, `{{height}}`, `{{quality}}`, `{{referenceImage:0}}` 등을 연결합니다. `{{referenceImages}}`는 이미지 배열을 받는 사용자 노드용입니다. 모든 참조와 프롬프트·시드가 실제 출력 노드에 연결되어야 하며 참조 없는 txt2img로 대체하지 않습니다. HTTPS 앱에서 로컬 HTTP 연결은 브라우저 정책에 의해 제한될 수 있으므로 CORS와 접근 가능한 HTTPS 주소를 설정해야 합니다.

## 무료 선택지와 검증 범위

`sample`은 네트워크·API 키 없이 저장된 캐릭터 설정을 SVG/Canvas로 그리는 고정 템플릿입니다. `meta.generationMode="offline-template"`, `referenceImagesUsed=false`를 기록하며 사진 변환·참조 픽셀 해석·자유로운 화풍 설명의 AI 해석을 수행하지 않습니다. 커버 수준의 수채화 생성 엔진으로 표시하지 않습니다. ComfyUI에는 공급자 API 요금이 없지만 장비·전력·서버 비용은 별도입니다.

무료 Gemini 웹 앱의 소비자 한도는 이 앱의 Nano Banana 이미지 API에 사용할 수 없습니다. 웹 앱에서 직접 만든 완성 그림을 내려받아 무료로 가져올 수 있습니다. Google 이미지 API의 비용은 [공식 요금표](https://ai.google.dev/gemini-api/docs/pricing)를 따릅니다.

공급자 계약과 브라우저 생성·승인·저장 흐름은 모의 API 응답으로 검증합니다. 실제 사용자 키를 사용하는 유료 호출은 검증에 사용하지 않으며, 이 검증은 공급자의 실제 화질·시드 재현성·CORS 성공을 보증하지 않습니다.

OpenAI 키 입력: 관리 화면의 `key_` 추적 ID는 인증 비밀 키가 아닙니다. `sk-` 비밀 키 전체는 생성할 때 복사하며, 가려진 표시만 남아 있다면 새 비밀 키를 생성합니다. 추적 ID·마스킹된 키는 저장과 직접 생성 전에 차단하고 값 자체는 오류에 표시하지 않습니다. 이미 저장된 잘못된 값은 부모 PIN 잠금 해제와 변경을 막지 않으며, 새 비밀 키로 교체할 수 있습니다.

사진 기반 배경은 장소 사진 1~3장을 별도 background 참조로 전송하고 스타일 참조와 구분합니다. 같은 장소의 넓은 모습·보이는 소품을 시트로 만들며 보이지 않는 방·가구를 추측하지 않도록 지시합니다. 고정 배치 입력, draft→final→부모 승인 뒤 World별 backgroundSheets에 등록하고 원본 사진은 보관하지 않습니다. Google Pro 모델 변경은 World revision을 올려 시트 재생성을 안내하며 기존 책은 모델 설정을 보존합니다.

장면 디테일을 사용하는 책은 시간·날씨·조명·소품·작은 배경 생물과 페이지 구도를 그림 요청에 함께 전달합니다. 프리셋 stylePrompt 원문은 요청의 맨 앞에 그대로 두고, 구도·빛·인물 행동·소품·고정 장소·금지 요소 순서로 조립합니다. 문과 창의 형태·개수·상대 위치 같은 고정 구조와 승인한 본문의 행동이 다양성보다 우선합니다. 시드는 book ID의 해시 + pageNo를 저장하고 다른 구도로 만들면 1000씩 더합니다. 표지는 주인공 한 명의 중간 구도입니다.

그림 다양성 검사는 기본 ON이며, 읽을 수 있는 이미지의 9×8 Canvas dHash를 비교합니다. 이웃 그림의 해밍 거리가 10 미만이면 다음 구도로 한 번만 추가 요청하고 원본은 이력에 보존합니다. 여전히 비슷하거나 브라우저가 픽셀 접근을 허용하지 않으면 수동 확인으로 남깁니다. 첫 쪽과 마지막 쪽의 밝기·색이 비슷한 경우는 시간 흐름 확인만 안내합니다. 이 휴리스틱은 실제 인물·구조물의 동일성을 판정하거나 보장하지 않습니다. ‘이 쪽 다른 구도로’는 본문을 바꾸지 않고 해당 그림만 생성합니다.
