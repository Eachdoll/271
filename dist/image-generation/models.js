/** Official model IDs verified 2026-10-14. Prices are estimates, never invoices. */
export const MODEL_VERIFIED_AT = "2026-10-14";
export const ENGINE_MODELS = Object.freeze({
  google: Object.freeze({
    final: "gemini-3.1-flash-image",
    draft: "gemini-3.1-flash-lite-image",
    pro: "gemini-3-pro-image",
    docs: "https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-image",
    pricingDocs: "https://ai.google.dev/gemini-api/docs/pricing",
  }),
  openai: Object.freeze({
    final: "gpt-image-2",
    draft: "gpt-image-2",
    docs: "https://developers.openai.com/api/docs/models/gpt-image-2",
    pricingDocs: "https://developers.openai.com/api/docs/pricing",
  }),
  bfl: Object.freeze({
    final: "flux-2-pro",
    draft: "flux-2-pro",
    docs: "https://docs.bfl.ai/flux_2/flux2_image_editing",
    pricingDocs: "https://docs.bfl.ai/quick_start/pricing",
  }),
  fal: Object.freeze({
    final: "bytedance/seedream/v5/pro",
    draft: "bytedance/seedream/v5/lite",
    legacy: "bytedance/seedream/v5/flash",
    docs: "https://fal.ai/models/bytedance/seedream/v5/pro/edit/api",
    pricingDocs: "https://fal.ai/models/bytedance/seedream/v5/pro/edit",
  }),
  local: Object.freeze({
    final: "ComfyUI workflow",
    draft: "ComfyUI workflow",
    docs: "https://docs.comfy.org/development/comfyui-server/comms_routes",
    pricingDocs: null,
  }),
  sample: Object.freeze({
    final: "original-svg-template-v1",
    draft: "original-svg-template-v1",
    docs: null,
    pricingDocs: null,
  }),
});

export function getEngineModel(engine, quality = "final", config = {}) {
  const entry = ENGINE_MODELS[engine];
  if (!entry) throw new Error("지원하지 않는 이미지 엔진이에요.");
  if (
    engine === "google" &&
    quality !== "draft" &&
    (config.googlePro === true || config.modelVariant === "pro")
  )
    return entry.pro;
  if (engine === "fal" && !["draft", "final"].includes(quality))
    return entry.legacy;
  return quality === "draft" ? entry.draft : entry.final;
}

export const IMAGE_PRICE_REFERENCE = Object.freeze({
  checkedAt: MODEL_VERIFIED_AT,
  google: 0.067,
  googlePro: 0.134,
  googleDraft: 0.0336,
  openaiDraft: 0.015,
  openaiFinal: 0.17,
  bfl: 0.045,
  falFinal: 0.045,
  falDraft: 0.035,
  local: 0,
  sample: 0,
  note: "출력 이미지 참고 단가로 계산한 추정입니다. 입력 이미지·토큰, 해상도, 재시도 및 모델 제공사의 최신 요금에 따라 달라집니다. 로컬 장비·전기 요금은 별도입니다.",
});

export function estimateImageCost({
  engine,
  quality = "final",
  size = { width: 1024, height: 1024 },
  config = {},
} = {}) {
  const model = getEngineModel(engine, quality, config);
  const match = typeof size === "string" && size.match(/^(\d+)[x×](\d+)$/);
  const width = Number(match ? match[1] : size?.width) || 1024;
  const height = Number(match ? match[2] : size?.height) || 1024;
  const dimension = Math.max(width, height);
  let costUsd;
  if (engine === "google")
    costUsd =
      model === ENGINE_MODELS.google.draft
        ? 0.0336
        : model === ENGINE_MODELS.google.pro
          ? dimension > 2048
            ? 0.24
            : 0.134
          : dimension > 2048
            ? 0.151
            : dimension > 1024
              ? 0.101
              : 0.067;
  else if (engine === "openai")
    costUsd = quality === "draft" || quality === "low" ? 0.015 : 0.17;
  else if (engine === "bfl")
    costUsd = 0.045 * Math.max(1, (width * height) / 1000000);
  else if (engine === "fal") costUsd = quality === "draft" ? 0.035 : 0.045;
  else costUsd = 0;
  return {
    costUsd: Number(costUsd.toFixed(4)),
    model,
    estimated: true,
    checkedAt: MODEL_VERIFIED_AT,
    source: ENGINE_MODELS[engine].pricingDocs,
    note: IMAGE_PRICE_REFERENCE.note,
  };
}

export function estimateBookCost({
  pageCount = 12,
  includeCover = true,
  ...options
} = {}) {
  const estimate = estimateImageCost(options);
  const imageCount =
    Math.max(0, Math.floor(Number(pageCount) || 0)) + Number(includeCover);
  return {
    ...estimate,
    imageCount,
    costUsd: Number((estimate.costUsd * imageCount).toFixed(4)),
  };
}
