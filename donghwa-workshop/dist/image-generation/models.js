import {
  isModelId,
  normalizeModelRegistry,
} from "../text-generation/models.js";
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

/**
 * R13: the picture models a parent can pick per provider, with the reference
 * price shown next to each. ComfyUI and the free sample have one fixed model.
 */
export const IMAGE_MODEL_CATALOG = Object.freeze({
  google: Object.freeze([
    Object.freeze({
      id: ENGINE_MODELS.google.final,
      name: "Nano Banana 2 · Gemini 3.1 Flash Image",
      tier: "기본",
      price: "1K $0.067 · 2K $0.101 · 4K $0.151",
    }),
    Object.freeze({
      id: ENGINE_MODELS.google.pro,
      name: "Gemini 3 Pro Image",
      tier: "상위",
      price: "2K까지 $0.134 · 4K $0.24",
    }),
    Object.freeze({
      id: ENGINE_MODELS.google.draft,
      name: "Gemini 3.1 Flash Lite Image",
      tier: "저가",
      price: "$0.0336",
    }),
  ]),
  openai: Object.freeze([
    Object.freeze({
      id: ENGINE_MODELS.openai.final,
      name: "GPT Image 2",
      tier: "기본",
      price: "미리보기 $0.015 · 최종 $0.17",
    }),
  ]),
  bfl: Object.freeze([
    Object.freeze({
      id: ENGINE_MODELS.bfl.final,
      name: "FLUX.2 Pro",
      tier: "기본",
      price: "100만 화소당 $0.045",
    }),
  ]),
  fal: Object.freeze([
    Object.freeze({
      id: ENGINE_MODELS.fal.final,
      name: "Seedream 5 Pro",
      tier: "기본",
      price: "$0.045",
    }),
    Object.freeze({
      id: ENGINE_MODELS.fal.draft,
      name: "Seedream 5 Lite",
      tier: "저가",
      price: "$0.035",
    }),
  ]),
  local: Object.freeze([
    Object.freeze({
      id: ENGINE_MODELS.local.final,
      name: "ComfyUI 워크플로",
      tier: "로컬",
      price: "API 요금 없음",
      fixed: true,
    }),
  ]),
  sample: Object.freeze([
    Object.freeze({
      id: ENGINE_MODELS.sample.final,
      name: "기기 내 그림 템플릿",
      tier: "무료",
      price: "무료",
      fixed: true,
    }),
  ]),
});
/** Providers whose final-picture model a parent can choose (R13). */
export const IMAGE_MODEL_ENGINES = Object.freeze([
  "google",
  "openai",
  "bfl",
  "fal",
]);
/** The parent's chosen final-picture model, or null for the provider default. */
export function chosenImageModel(engine, config = {}) {
  if (!IMAGE_MODEL_ENGINES.includes(engine)) return null;
  const id = typeof config?.model === "string" ? config.model.trim() : "";
  return isModelId(id) ? id : null;
}
export function isCatalogImageModel(engine, id) {
  return (
    !!IMAGE_MODEL_CATALOG[engine]?.some((row) => row.id === id) ||
    (engine === "fal" && id === ENGINE_MODELS.fal.legacy)
  );
}
/** The model a provider's final pictures use with this config. */
export function effectiveImageModel(engine, config = {}) {
  return getEngineModel(engine, "final", config);
}
/** 'Seedream 5 Pro · 기본 · $0.045' for a catalog model; fetched or typed IDs say the price is unknown. */
export function imageModelOptionLabel(engine, id) {
  const row = IMAGE_MODEL_CATALOG[engine]?.find((item) => item.id === id);
  return row
    ? `${row.name} · ${row.tier} · ${row.price}`
    : `${id} · 목록에 없는 모델 · 요금은 공급자에서 확인`;
}
export function imageModelShortName(engine, id) {
  return (
    IMAGE_MODEL_CATALOG[engine]?.find((item) => item.id === id)?.name || id
  );
}
/** Catalog first, then the fetched list, then typed IDs (each ID once). */
export function listImageModelOptions(engine, config = {}) {
  const catalog = IMAGE_MODEL_CATALOG[engine] || [],
    seen = new Set(catalog.map((row) => row.id)),
    options = catalog.map((row) => ({
      id: row.id,
      label: imageModelOptionLabel(engine, row.id),
      group: "catalog",
    }));
  if (!IMAGE_MODEL_ENGINES.includes(engine)) return options;
  const registry = normalizeModelRegistry(config);
  for (const row of registry.fetchedModels?.models || []) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    options.push({
      id: row.id,
      label: imageModelOptionLabel(engine, row.id),
      group: "fetched",
    });
  }
  for (const id of registry.customModels || []) {
    if (seen.has(id)) continue;
    seen.add(id);
    options.push({
      id,
      label: `${id} · 직접 입력 · 목록에 없는 모델 · 요금은 공급자에서 확인`,
      group: "custom",
    });
  }
  return options;
}
/**
 * The provider config a book draws with: the World's connection settings plus
 * the book's frozen model choice. A snapshot without a frozen `model` drew with
 * the provider default, so a model chosen later for the World never leaks in.
 */
export function frozenImageConfig(config = {}, snapshot) {
  const merged = { ...config, ...snapshot?.imageModelConfig };
  if (snapshot && !Object.hasOwn(snapshot.imageModelConfig || {}, "model"))
    delete merged.model;
  return merged;
}
/** The model fields a book or job freezes: legacy Google variant plus R13 `model`. */
export function imageModelSnapshot(world) {
  const chosen = chosenImageModel(
    world?.imageEngine,
    world?.providerConfig?.[world?.imageEngine],
  );
  return {
    googlePro:
      world?.imageModelVariant === "pro" ||
      (!world?.imageModelVariant &&
        world?.providerConfig?.google?.googlePro === true),
    modelVariant: world?.imageModelVariant === "pro" ? "pro" : "default",
    ...(chosen ? { model: chosen } : {}),
  };
}

export function getEngineModel(engine, quality = "final", config = {}) {
  const entry = ENGINE_MODELS[engine];
  if (!entry) throw new Error("지원하지 않는 이미지 엔진이에요.");
  // R13: the parent's choice draws final pictures. Drafts keep the provider's
  // draft model unless the provider has only one model.
  const chosen = chosenImageModel(engine, config);
  if (chosen && (quality !== "draft" || entry.draft === entry.final))
    return chosen;
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
  if (!isCatalogImageModel(engine, model))
    return {
      costUsd: 0,
      model,
      estimated: true,
      checkedAt: MODEL_VERIFIED_AT,
      source: ENGINE_MODELS[engine].pricingDocs,
      note: "목록에 없는 모델 · 요금 정보 없음 · 요금은 공급자에서 확인해 주세요.",
      pricingUnknown: true,
    };
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
  else if (engine === "fal")
    costUsd =
      quality === "draft" || model === ENGINE_MODELS.fal.draft ? 0.035 : 0.045;
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
