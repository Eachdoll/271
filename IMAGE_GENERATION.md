# 이미지 생성 플러그인

`dist/image-generation/`은 이야기 생성 모듈과 분리되어 있습니다. 각 플러그인은 다음 공통 계약을 사용합니다.

```js
import {createImageGenerator} from './dist/image-generation/index.js';

const generateImage = createImageGenerator({engine: 'google', config: {apiKey}});
const result = await generateImage({
  prompt,
  stylePreset,
  referenceImages: [characterSheet, ...stylePreset.styleRefImages],
  seed: 20261014,
  size: '1536x1024',
  quality: 'high'
});
// {imageUrl, seed, meta}
```

`createWorldImagePlugin(getState).generateImage(request)`는 현재 World의 엔진과 암호화된 키를 사용합니다. 책의 실제 장면 생성은 `pipeline.js`를 통해 생성 당시 World·캐릭터 시트·화풍의 스냅샷을 사용합니다.

| 모듈 | 역할 |
| --- | --- |
| providers.js | Google, OpenAI, BFL, fal, ComfyUI 요청·참조 변환·폴링·오류·취소 |
| styles.js | name, stylePrompt, negativePrompt, palette, styleRefImages 테이블 및 검증 |
| world.js | World별 엔진·화풍, 불변 시트·책 스냅샷, 시드·참조 기록 |
| vault.js | AES-GCM 키 암호화, 로컬 암호문과 IndexedDB의 비추출 암호화 키 |
| assets.js | 생성 이미지 Blob의 IndexedDB 저장·복원·표시 |
| pipeline.js | 쪽별·전체·캐릭터 시트 생성, 동시 2건, 부분 완료·취소 |
| settings-ui.js | 부모 설정, 시트 검수, 엔진 3개 비교 |

어댑터의 표시 모델은 Google `gemini-3.1-flash-image`, OpenAI `gpt-image-2`, BFL `flux-2-pro`, fal `seedream-5`입니다. fal은 공급자의 `bytedance/seedream/v5/flash/edit` 및 `text-to-image` 경로에 연결합니다. ComfyUI는 사용자가 저장한 API 형식 워크플로를 실행합니다.

ComfyUI JSON은 `{{prompt}}`, `{{negativePrompt}}`, `{{seed}}`, `{{width}}`, `{{height}}`, `{{referenceImage:0}}` 등의 자리표시자를 사용합니다. 모든 캐릭터·화풍 참조가 실제 출력 노드의 입력 경로에 연결되어야 합니다. `{{referenceImages}}`는 이미지 배열을 받는 사용자 노드용입니다. 기본 txt2img 워크플로로 참조를 누락해 대체하지 않습니다. 원격 HTTPS 앱에서 로컬 HTTP 서버는 브라우저의 혼합 콘텐츠·CORS 정책에 의해 차단될 수 있으며, 브라우저에서 접근 가능한 HTTPS 엔드포인트가 필요합니다.

Google의 요청 시드는 샘플링 힌트로 전송하며 이미지 결과 시드는 확인할 수 없습니다. Google·OpenAI·fal은 결과 `seed: null`과 요청 시드를 함께 기록합니다. BFL·ComfyUI는 지원하는 실제/샘플러 시드를 기록합니다. 공급자마다 품질과 크기 매핑이 다르므로 `meta`에 전달값과 지원 여부를 남깁니다. 같은 시드를 넣어도 엔진 사이에서 같은 그림이 보장되지는 않습니다.

캐릭터 시트와 화풍 참조는 모두 전송합니다. 참조 한도는 Google 14, OpenAI 16, BFL 8, fal 10장이고 초과 시 요청 전에 오류를 반환합니다. 스타일 프리셋은 재료·선·색·구도에 대한 원래 설명과 자체 제작한 SVG 레퍼런스로 구성하며 작가·스튜디오 이름을 허용하지 않습니다.

부모가 엔진이나 화풍을 변경하면 World의 버전이 올라가고 '시트 다시 생성 필요' 경고가 표시됩니다. 이전 책은 원래 스냅샷을 유지하고, 새 책은 선택한 캐릭터의 현재 World 시트가 모두 확정되어야 이미지를 생성합니다. 생성된 시트는 부모가 이미지 미리보기를 본 뒤 별도로 확정합니다.

API 키는 네트워크 요청 때만 메모리에서 복호화되며 평문으로 저장·백업하지 않습니다. 로컬 암호화는 사이트 코드가 침해되거나 기기가 잠금 해제된 상태를 보호하는 서버 인증을 대신하지 않습니다. API는 브라우저에서 직접 호출하므로 해당 계정의 모델 권한과 공급자 CORS 정책이 실제 사용 가능 여부를 결정합니다. API 호출에는 공급자 비용이 발생할 수 있습니다.

검증은 프로토콜 모의 응답과 브라우저의 암호화·생성·저장 흐름으로 진행했습니다. 실제 사용자 키를 사용하는 유료 API 호출은 실행하지 않았습니다.
