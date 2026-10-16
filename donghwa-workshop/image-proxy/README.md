# 기기 내 이미지 프록시

정적 웹 앱을 위한 선택 기능입니다. Sites의 정적 배포에는 Node 서버가 포함되지 않습니다. 브라우저에서 직접 연결할 때 CORS 제한이 있는 엔진은 이 서비스를 별도로 실행하고 부모 설정의 프록시 주소에 `http://127.0.0.1:8787`을 입력합니다. HTTPS 앱에서 로컬 HTTP 연결은 브라우저 정책에 따라 제한될 수 있으므로 필요하면 신뢰할 수 있는 HTTPS 로컬 주소를 사용하세요.

Node 22 이상에서 `node image-proxy/server.mjs`로 실행합니다. 기본 주소는 기기 내 `127.0.0.1:8787`입니다. `IMAGE_PROXY_ALLOWED_ORIGINS` 환경변수에 실제 동화공방 앱의 origin을 입력합니다. 여러 주소는 쉼표로 구분합니다. `IMAGE_PROXY_PORT`로 포트를 바꿀 수 있습니다.

키는 서버 환경변수 `GOOGLE_IMAGE_API_KEY`, `OPENAI_API_KEY`, `BFL_API_KEY`, `FAL_KEY`, 선택적인 `COMFYUI_API_KEY`로만 받습니다. 키를 파일이나 명령행 인자에 쓰지 마세요. ComfyUI는 `COMFYUI_BASE_URL`과 `COMFYUI_WORKFLOW_JSON` 환경변수를 사용합니다. 워크플로에는 기존 앱과 같은 `{{prompt}}`, `{{seed}}`, `{{referenceImage:0}}` 입력을 연결합니다.

`POST /api/image/:engine`은 역할·라벨이 있는 PNG/JPEG/WebP 참조 픽셀과 생성 설정만 받습니다. 브라우저에 저장된 API 키는 프록시에 보내지 않습니다. 프록시는 요청·응답·오류·인증 정보를 기록하지 않으며 오류에는 고정된 설명만 반환합니다. 응답과 인증 헤더를 개발자 도구에서 복사하거나 별도 로그에 저장하지 마세요. 실제 공급사 요청의 인증 헤더는 API 인증에 필요하며 이를 숨긴다고 주장하지 않습니다.

`POST /api/translate/wardrobe/google`은 `{description}`만 받아 옷장 설명을 영어로 번역합니다. 부모가 ‘AI로 영어 번역 · API 사용’을 눌렀을 때만 요청하며, Google 초안 모델에 TEXT 응답을 요청합니다. 사진과 참조 이미지는 보내지 않습니다. 텍스트 토큰 요금은 이미지 생성 비용과 별도이며 `GOOGLE_IMAGE_API_KEY` 환경변수를 사용합니다.

Google 초안은 `gemini-3.1-flash-lite-image`(1K만), 확정은 `gemini-3.1-flash-image`, 선택적인 Pro는 `gemini-3-pro-image`입니다. fal 초안은 `bytedance/seedream/v5/lite`, 확정은 `bytedance/seedream/v5/pro`의 edit 또는 text-to-image 엔드포인트입니다. 모델 ID와 문서 주소는 `dist/image-generation/models.js`에 모았습니다. 2026-10-14에 공식 문서를 확인했습니다. 비용은 참고 단가 기반 추정이며 공급사가 달러 청구액을 반환한 경우만 실제 금액으로 기록합니다.

글 엔진은 `POST /api/text/:engine`이며 OpenAI·Google·Anthropic·로컬을 별도로 선택합니다. 환경변수 키는 `OPENAI_API_KEY`, `GOOGLE_IMAGE_API_KEY`, `ANTHROPIC_API_KEY`이고 로컬 주소·모델은 `LOCAL_TEXT_BASE_URL`, `LOCAL_TEXT_MODEL`입니다. 공급자 기본 주소를 바꾸려면 `OPENAI_TEXT_ENDPOINT`, `GOOGLE_TEXT_ENDPOINT`, `ANTHROPIC_TEXT_ENDPOINT`를 사용합니다. 브라우저 요청에 API 키와 접속 설정을 넣지 않습니다. 자세한 내용은 `TEXT_GENERATION.md`를 참고하세요.

글 요청의 model 선택도 서버 어댑터 설정에 전달하며, 상위 모델의 온도·추론·출력 토큰 규칙은 공통 텍스트 어댑터에서 처리합니다. API 키는 모델 선택과 무관하게 서버 환경변수에서만 읽습니다.
