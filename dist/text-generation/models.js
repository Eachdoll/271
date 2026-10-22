/** Official model IDs and standard token rates checked 2026-10-15 (USD / million). */
const CHECKED_AT = "2026-10-15";
const reasoning = (profile = "none", effort = null, supportedEfforts = []) =>
  Object.freeze({
    profile,
    effort,
    supportedEfforts: Object.freeze(supportedEfforts),
  });
const row = (value) =>
  Object.freeze({
    label: value.name,
    supportsTemperature: true,
    reasoning: reasoning(),
    maxOutputTokens: 128000,
    requestOutputTokens: 0,
    timeoutMs: 180000,
    ...value,
  });
/** Existing installations keep these defaults until a parent selects another model. */
export const TEXT_MODELS = Object.freeze({
  openai: row({
    id: "gpt-4.1-mini",
    name: "OpenAI · GPT-4.1 mini",
    tier: "economy",
    input: 0.4,
    output: 1.6,
    maxOutputTokens: 32768,
    docs: "https://developers.openai.com/api/docs/models/gpt-4.1-mini",
  }),
  google: row({
    id: "gemini-2.5-flash",
    name: "Google · Gemini 2.5 Flash",
    tier: "economy",
    input: 0.3,
    output: 2.5,
    maxOutputTokens: 65536,
    docs: "https://ai.google.dev/gemini-api/docs/pricing",
  }),
  anthropic: row({
    id: "claude-haiku-4-5-20251001",
    name: "Anthropic · Claude Haiku 4.5",
    tier: "economy",
    input: 1,
    output: 5,
    maxOutputTokens: 64000,
    docs: "https://platform.claude.com/docs/en/models/haiku-4-5/overview",
  }),
  local: row({
    id: null,
    name: "로컬 · LM Studio / Ollama",
    tier: "local",
    input: 0,
    output: 0,
    docs: "https://lmstudio.ai/docs/developer/openai-compat",
  }),
});
const premium = {
  supportsTemperature: false,
  requestOutputTokens: 32768,
  timeoutMs: 600000,
};
const OPENAI_REASONING = reasoning("openai", "low", [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const CLAUDE_REASONING = reasoning("anthropic-adaptive", "medium", [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const CATALOG = Object.freeze({
  openai: Object.freeze([
    TEXT_MODELS.openai,
    row({
      ...premium,
      id: "gpt-6.1-sol",
      name: "OpenAI · GPT-6.1 Sol · 고급",
      tier: "advanced",
      input: 2,
      output: 10,
      reasoning: OPENAI_REASONING,
      docs: "https://developers.openai.com/api/docs/models/gpt-6.1-sol",
    }),
    row({
      ...premium,
      id: "gpt-6-astra",
      name: "OpenAI · GPT-6 Astra · 최고급",
      tier: "flagship",
      input: 10,
      output: 50,
      reasoning: OPENAI_REASONING,
      docs: "https://developers.openai.com/api/docs/models/gpt-6-astra",
    }),
  ]),
  google: Object.freeze([
    TEXT_MODELS.google,
    row({
      ...premium,
      id: "gemini-4-argon",
      name: "Google · Gemini 4 Argon · 최고급",
      tier: "flagship",
      input: 2,
      output: 10,
      maxOutputTokens: 32768,
      timeoutMs: 1200000,
      reasoning: reasoning("google-thinking-level", "low", [
        "low",
        "medium",
        "high",
      ]),
      pricingChange: Object.freeze({
        effectiveAt: "2026-12-01",
        input: 4,
        output: 20,
      }),
      docs: "https://ai.google.dev/gemini-api/docs/pricing",
    }),
  ]),
  anthropic: Object.freeze([
    TEXT_MODELS.anthropic,
    row({
      id: "claude-haiku-5-5",
      name: "Anthropic · Claude Haiku 5.5 · 판정용 선택",
      tier: "economy",
      input: 0.1,
      output: 0.5,
      supportsTemperature: false,
      reasoning: reasoning("anthropic-disabled"),
      maxOutputTokens: 64000,
      docs: "https://platform.claude.com/docs/en/models/haiku-5-5/overview",
    }),
    row({
      ...premium,
      id: "claude-sonnet-5-5",
      name: "Anthropic · Claude Sonnet 5.5 · 고급",
      tier: "advanced",
      input: 2,
      output: 10,
      reasoning: reasoning("anthropic-between-tools", "medium", [
        "low",
        "medium",
        "high",
      ]),
      docs: "https://platform.claude.com/docs/en/models/sonnet-5-5/overview",
    }),
    row({
      ...premium,
      id: "claude-opus-5-5",
      name: "Anthropic · Claude Opus 5.5 · 상위",
      tier: "premium",
      input: 4,
      output: 20,
      reasoning: CLAUDE_REASONING,
      docs: "https://platform.claude.com/docs/en/models/opus-5-5/overview",
    }),
    row({
      ...premium,
      id: "claude-fable-5-1",
      name: "Anthropic · Claude Fable 5.1 · 최고급",
      tier: "flagship",
      input: 10,
      output: 50,
      reasoning: CLAUDE_REASONING,
      docs: "https://platform.claude.com/docs/en/models/fable-5-1/overview",
    }),
  ]),
  local: Object.freeze([TEXT_MODELS.local]),
});
export function listTextModels(engine) {
  if (!Object.hasOwn(CATALOG, engine))
    throw new Error("지원하는 글 엔진을 선택해 주세요.");
  return CATALOG[engine];
}
/** R13: model IDs a parent may fetch or type. Never a URL with a scheme or spaces. */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9._:\/-]{1,120}$/;
// '__custom', '__fetch' and '__stages' are the pickers' own option values.
// An ID becomes part of a provider URL path (Gemini, fal, BFL), so empty, '.'
// and '..' path segments are refused too: an ID never walks out of its path.
export const isModelId = (value) =>
  typeof value === "string" &&
  MODEL_ID_PATTERN.test(value.trim()) &&
  !value.trim().startsWith("__") &&
  !value
    .trim()
    .split("/")
    .some((part) => part === "" || part === "." || part === "..");
export function validateModelId(value) {
  const id = String(value ?? "").trim();
  if (!isModelId(id))
    throw new Error(
      "모델 ID는 영문·숫자와 . _ : / - 만 써서 1~120자로 입력해 주세요.",
    );
  return id;
}
export const MAX_CUSTOM_MODELS = 20;
export const MAX_FETCHED_MODELS = 200;
/**
 * The provider's own model registry (R13): IDs fetched from its list call
 * (`fetchedModels.models`) or typed by the parent (`customModels`). Settings
 * saved before R13 have neither, so they resolve exactly as before.
 */
export function registeredModelIds(config = {}) {
  const ids = [];
  for (const id of Array.isArray(config?.customModels)
    ? config.customModels
    : [])
    if (isModelId(id)) ids.push(id.trim());
  for (const row of Array.isArray(config?.fetchedModels?.models)
    ? config.fetchedModels.models
    : [])
    if (isModelId(row?.id)) ids.push(row.id.trim());
  return [...new Set(ids)];
}
/** Copy only a provider's valid registry fields; {} when it has none (legacy). */
export function normalizeModelRegistry(config = {}) {
  const result = {};
  if (Array.isArray(config?.customModels))
    result.customModels = [
      ...new Set(config.customModels.filter(isModelId).map((id) => id.trim())),
    ].slice(-MAX_CUSTOM_MODELS);
  const fetched = config?.fetchedModels;
  if (fetched && typeof fetched === "object" && Array.isArray(fetched.models)) {
    const seen = new Set(),
      models = [];
    for (const row of fetched.models) {
      const id = typeof row === "string" ? row : row?.id;
      if (!isModelId(id) || seen.has(id.trim())) continue;
      seen.add(id.trim());
      const label =
        typeof row?.label === "string" ? row.label.trim().slice(0, 120) : "";
      models.push({ id: id.trim(), ...(label ? { label } : {}) });
      if (models.length >= MAX_FETCHED_MODELS) break;
    }
    result.fetchedModels = {
      fetchedAt:
        typeof fetched.fetchedAt === "string"
          ? fetched.fetchedAt.slice(0, 40)
          : "",
      models,
    };
  }
  return result;
}
const isRegisteredModel = (config, id) =>
  !!id && registeredModelIds(config).includes(id);
/**
 * A fetched or typed model outside the curated catalog. Requests stay
 * conservative (no temperature, reasoning, effort or thinking fields, the
 * stage budget as the output limit) and its price is unknown, never guessed.
 */
function customTextModel(id) {
  return Object.freeze({
    id,
    name: `${id} · 목록에 없는 모델`,
    label: `${id} · 목록에 없는 모델 · 요금은 공급자에서 확인`,
    tier: "custom",
    input: null,
    output: null,
    supportsTemperature: false,
    reasoning: reasoning(),
    maxOutputTokens: 128000,
    requestOutputTokens: 0,
    timeoutMs: 600000,
    docs: null,
    custom: true,
    pricingUnknown: true,
  });
}
/** `config` carries the provider registry; without it only catalog IDs resolve. */
export function getTextModelInfo(engine, modelString, config = {}) {
  const models = listTextModels(engine),
    id = String(modelString || "").trim();
  return (
    models.find((item) => item.id === id) ||
    (engine !== "local" && isRegisteredModel(config, id)
      ? customTextModel(id)
      : TEXT_MODELS[engine])
  );
}
export function resolveTextModel(engine, modelString, config = {}) {
  listTextModels(engine);
  return engine === "local"
    ? String(modelString || "").trim()
    : getTextModelInfo(engine, modelString, config).id;
}
export function getTextModel(engine, config = {}) {
  return resolveTextModel(engine, config.model, config);
}
const TIER_LABELS = Object.freeze({
  economy: "경제형",
  advanced: "고급",
  premium: "상위",
  flagship: "최고급",
  local: "로컬",
});
/** 'GPT-6.1 Sol · 고급 · 입력 $2 / 출력 $10 per 1M' for a catalog row. */
export function textModelOptionLabel(row) {
  if (row.custom) return row.label;
  if (row.tier === "local") return "로컬 · API 요금 없음";
  const short = String(row.name || row.id).split(" · ")[1] || row.id;
  return `${short} · ${TIER_LABELS[row.tier] || row.tier} · 입력 $${row.input} / 출력 $${row.output} per 1M`;
}
/** A short display name: 'GPT-6.1 Sol', or the ID of a model outside the catalog. */
export function textModelShortName(engine, id, config = {}) {
  if (engine === "local") return String(id || "").trim() || "로컬 모델";
  const row = getTextModelInfo(engine, id, config);
  return row.custom ? row.id : String(row.name).split(" · ")[1] || row.id;
}
/**
 * Every model a parent can pick for one provider: the curated catalog, then
 * the fetched list, then typed IDs (each ID once, catalog first).
 */
export function listTextModelOptions(engine, config = {}) {
  const catalog = engine === "local" ? [] : listTextModels(engine),
    seen = new Set(catalog.map((row) => row.id)),
    options = catalog.map((row) => ({
      id: row.id,
      label: textModelOptionLabel(row),
      group: "catalog",
    }));
  const outside = (name) =>
    engine === "local"
      ? `${name} · 로컬`
      : `${name} · 목록에 없는 모델 · 요금은 공급자에서 확인`;
  for (const row of Array.isArray(config?.fetchedModels?.models)
    ? config.fetchedModels.models
    : []) {
    const id = typeof row === "string" ? row : row?.id;
    if (!isModelId(id) || seen.has(id.trim())) continue;
    seen.add(id.trim());
    const name =
      typeof row?.label === "string" && row.label.trim() && row.label !== id
        ? `${row.label.trim().slice(0, 60)} (${id.trim()})`
        : id.trim();
    options.push({ id: id.trim(), label: outside(name), group: "fetched" });
  }
  for (const id of Array.isArray(config?.customModels)
    ? config.customModels
    : []) {
    if (!isModelId(id) || seen.has(id.trim())) continue;
    seen.add(id.trim());
    options.push({
      id: id.trim(),
      label: outside(`${id.trim()} · 직접 입력`),
      group: "custom",
    });
  }
  return options;
}
/** Story defaults are separate from legacy single-model provider preferences. */
export const STORY_STAGE_MODELS = Object.freeze({
  openai: Object.freeze({ medium: "gpt-6.1-sol", upper: "gpt-6-astra" }),
  anthropic: Object.freeze({
    medium: "claude-sonnet-5-5",
    upper: "claude-opus-5-5",
  }),
  google: Object.freeze({
    medium: "gemini-2.5-flash",
    upper: "gemini-4-argon",
  }),
  local: Object.freeze({ medium: "", upper: "" }),
});
export function getStoryStageModels(engine, config = {}) {
  listTextModels(engine);
  if (engine === "local") {
    const model = resolveTextModel(engine, config.model);
    return { medium: model, upper: model };
  }
  const selected = config.stageModels || {},
    defaults = STORY_STAGE_MODELS[engine],
    models = listTextModels(engine);
  const resolve = (level) => {
    const id = String(selected[level] || "").trim();
    return (
      models.find((row) => row.id === id)?.id ||
      (isRegisteredModel(config, id) ? id : defaults[level])
    );
  };
  return { medium: resolve("medium"), upper: resolve("upper") };
}
/**
 * R26 검사 모델: where the coherence review's judgement runs. A new job or
 * draft freezes textSettings.reviewTier: "medium" by default, "upper" when
 * the parent turned on '검사는 최고 모델로' (settings.textGeneration.reviewTier).
 * A snapshot without the key (every job and draft before R26) reviews with the
 * upper model as before, so its requests and estimates are unchanged.
 */
export const REVIEW_TIER_MEDIUM = "medium";
export const REVIEW_TIER_UPPER = "upper";
export function freezeReviewTier(settings = {}) {
  return {
    ...settings,
    reviewTier: settings.reviewTier === REVIEW_TIER_UPPER ? REVIEW_TIER_UPPER : REVIEW_TIER_MEDIUM,
  };
}
/** The review tier a frozen snapshot uses ("upper" when it has none). */
export const reviewTierOf = (settings) =>
  settings?.reviewTier === REVIEW_TIER_MEDIUM ? REVIEW_TIER_MEDIUM : REVIEW_TIER_UPPER;
/** Resolve each request from an immutable draft settings snapshot, without mutating it. */
export function resolveStoryStageSettings(settings = {}, stage) {
  if (
    ![
      "outline",
      "plotContract",
      "sceneBriefs",
      "proseDraft",
      "prose",
      "enrichment",
      "pagination",
      "coherence",
      "coherenceRepair",
      // R26: the coherence reviewer's judgement (not its repairs).
      "coherenceReview",
    ].includes(stage)
  )
    throw new Error("지원하는 이야기 생성 단계를 선택해 주세요.");
  const selected = Object.hasOwn(CATALOG, settings.engine)
      ? settings.engine
      : "openai",
    hybrid = settings.hybrid?.enabled === true;
  const finalEngine = ["openai", "anthropic", "google"].includes(
    settings.hybrid?.finalEngine,
  )
    ? settings.hybrid.finalEngine
    : "openai";
  const engineId = hybrid
    ? ["outline", "plotContract", "proseDraft"].includes(stage)
      ? "local"
      : finalEngine
    : selected;
  const provider = settings.providers?.[engineId] || {},
    models = getStoryStageModels(engineId, provider),
    level =
      ["outline", "plotContract", "sceneBriefs", "pagination"].includes(stage) ||
      // R26: a frozen reviewTier "medium" sends the review's judgement to the
      // medium model; repairs, the read-through and writing stay upper.
      (stage === "coherenceReview" && settings.reviewTier === REVIEW_TIER_MEDIUM)
        ? "medium"
        : "upper";
  return {
    engineId,
    config: {
      ...provider,
      ...(provider.stageModels
        ? { stageModels: { ...provider.stageModels } }
        : {}),
      model: models[level],
    },
  };
}
/** Quality passes can use separate providers without losing their saved endpoints.
 * Explicit role selections win; otherwise the existing hybrid routing is retained. */
export function resolveQualityStageSettings(
  settings = {},
  role,
  qualitySettings = {},
) {
  if (!["outline", "prose", "cheap", "coach"].includes(role))
    throw new Error("지원하는 글 품질 엔진 역할을 선택해 주세요.");
  const selected = Object.hasOwn(CATALOG, settings.engine)
      ? settings.engine
      : "openai",
    hybrid = settings.hybrid?.enabled === true;
  const finalEngine = ["openai", "anthropic", "google"].includes(
    settings.hybrid?.finalEngine,
  )
    ? settings.hybrid.finalEngine
    : "openai";
  const source = qualitySettings?.engines?.[role],
    override = source && typeof source === "object" ? source : {};
  const chosen = override.engine ?? override.engineId;
  const engineId = Object.hasOwn(CATALOG, chosen)
    ? chosen
    : hybrid
      ? role === "outline"
        ? "local"
        : finalEngine
      : selected;
  const provider = settings.providers?.[engineId] || {},
    models = getStoryStageModels(engineId, provider);
  const fallback =
    role === "cheap"
      ? engineId === "local"
        ? models.medium
        : TEXT_MODELS[engineId].id
      : models[
          role === "prose" || (role === "outline" && engineId === "anthropic")
            ? "medium"
            : "upper"
        ];
  const requested = String(override.model || "").trim(),
    model =
      engineId === "local"
        ? requested || fallback
        : listTextModels(engineId).find((row) => row.id === requested)?.id ||
          (isRegisteredModel(provider, requested) ? requested : fallback);
  return {
    engineId,
    config: {
      ...provider,
      ...(provider.stageModels
        ? { stageModels: { ...provider.stageModels } }
        : {}),
      model,
    },
  };
}
/**
 * R30 정성 모드 비트별 작가: the medium model (the quality 'prose' role)
 * unless the draft froze writerTier "upper" — then that engine's upper model.
 */
export function resolveBeatWriterSettings(
  settings = {},
  qualitySettings = {},
  writerTier = "medium",
) {
  const base = resolveQualityStageSettings(settings, "prose", qualitySettings);
  if (writerTier !== "upper" || base.engineId === "local") return base;
  const models = getStoryStageModels(
    base.engineId,
    settings.providers?.[base.engineId] || {},
  );
  return { ...base, config: { ...base.config, model: models.upper } };
}
export function estimateTextCost({
  engine,
  engineId = engine,
  input = 0,
  output = 0,
  model,
  config = {},
  at = new Date(),
} = {}) {
  const info = getTextModelInfo(engineId, model ?? config.model, config);
  if (info.pricingUnknown)
    return {
      costUsd: 0,
      estimated: true,
      model: info.id,
      inputRate: null,
      outputRate: null,
      checkedAt: CHECKED_AT,
      note: "목록에 없는 모델 · 요금 정보 없음 · 요금은 공급자에서 확인",
      pricingUnknown: true,
    };
  const date = new Date(at),
    rates =
      info.pricingChange &&
      Number.isFinite(date.getTime()) &&
      date >= new Date(info.pricingChange.effectiveAt + "T00:00:00Z")
        ? info.pricingChange
        : info;
  return {
    costUsd:
      (Math.max(0, Number(input) || 0) * rates.input +
        Math.max(0, Number(output) || 0) * rates.output) /
      1e6,
    estimated: true,
    model: resolveTextModel(engineId, model ?? config.model, config),
    inputRate: rates.input,
    outputRate: rates.output,
    checkedAt: CHECKED_AT,
    note: "토큰 단가 기반 추정 · 실제 청구액 아님",
  };
}
/**
 * R12 openings: typical output tokens of a whole openings book from its frozen
 * specs (target sentences per opening × middle eojeol × 4.8 for Korean; target
 * sentences × middle words, within the words range, × 2.4 for English).
 */
function openingTextTokens(specs, openings) {
  const middle = (range, fallback) =>
    range && Number.isFinite(range.min) && Number.isFinite(range.max)
      ? (range.min + range.max) / 2
      : fallback;
  const ko = specs.ko.units.opening,
    en = specs.en.units.opening,
    koTokens = ko.target * middle(specs.ko.wordsPerSentence, 6) * 4.8,
    enWords = en.target * middle(specs.en.wordsPerSentence, 7),
    enTokens =
      (en.words ? Math.min(Math.max(enWords, en.words.min), en.words.max) : enWords) * 2.4;
  return Math.ceil(openings * (koTokens + enTokens));
}
/**
 * R22 회의 결과 보고 진행: what one more writers' room costs on a job's or
 * draft's frozen text settings (the five economy calls), for the
 * 방향 고쳐 다시 회의 confirm. Takes {textSettings, wizard, input, demo}.
 */
export function estimateCouncilCost(job) {
  if (!job || job.demo) return { costUsd: 0, pricingUnknown: false };
  const orchestration = job.input?.orchestrationPolicy?.version === 1;
  const text = estimateStoryTextCost({
    settings: job.textSettings || {},
    pageCount: job.wizard?.pageCount || job.input?.pageCount || 12,
    council: true,
    ...(orchestration ? { orchestration: true } : {}),
  });
  // R29: a 정성 모드 meeting also buys the growth design and three candidates again.
  const rows = (text.stages || []).filter((stage) => stage.stage === "council" || stage.stage === "plotCandidates");
  return {
    costUsd: rows.reduce((sum, row) => sum + (Number(row.costUsd) || 0), 0),
    pricingUnknown: rows.some((row) => row.pricingUnknown === true),
  };
}
export function estimateStoryTextCost({
  engine = "openai",
  engineId = engine,
  pageCount = 12,
  beatCount,
  paragraphCount,
  settings = {},
  previousTextLength = 0,
  at = new Date(),
  layout,
  specs,
  // Editor round (input.editorPolicy): the whole-book read-through, and the
  // quality path's simplify passes written by the author model.
  editor = false,
  // R20 writers' room (input.councilPolicy): five economy-model calls before the outline.
  council = false,
  // R29 정성 모드 (input.orchestrationPolicy): the growth design and three
  // candidates on the author (prose role) model; the critics and the bible
  // stay on the economy model.
  orchestration = false,
  // R30: the beat writer's model ("medium" | "upper", frozen on the draft).
  writerTier = "medium",
  // R31a: a K1 book (input.k1Policy): the app outline, the whole book in one
  // writer call (+ one expected fix call), its pages taken as written.
  k1Book = false,
  // R31b: a diet draft's outline and prose go through the app path (the stage
  // models), never the package's quality roles. R31f: its rows are sized from
  // the measured R31e runs (per-request tokens, with headroom), never from the
  // pre-diet request shapes; a draft without the policy keeps the old rows.
  diet = false,
  // R31e: a diet outline has no event ledger, so the two ledger-based coherence
  // reviews are not bought (a diet job made before R31e keeps its ledger's rows).
  ledger = !diet,
} = {}) {
  const snapshot = { ...settings, engine: settings.engine || engineId },
    hybrid = settings.hybrid?.enabled === true;
  const qualitySettings = settings.storyQuality || {},
    quality = qualitySettings.enabled === true,
    twoPass = quality && qualitySettings.twoPass !== false,
    beam = quality && qualitySettings.useBeamSearch === true,
    childSimulator = quality && qualitySettings.childSimulator !== false;
  const pages = Math.max(1, Math.round(Number(pageCount) || 12)),
    // R12 openings: one beat per opening and output sized from the frozen specs.
    openings =
      layout === "openings" && specs?.ko?.units && specs?.en?.units
        ? Math.max(1, Math.round(pages / 2))
        : 0,
    beats = Math.min(
      24,
      Math.max(
        1,
        Math.round(
          Number(beatCount) ||
            openings ||
            Math.min(8, Math.max(6, Math.ceil(pages / 2) + 1)),
        ),
      ),
    ),
    enrichment =
      settings.storyEnrichment !== false && !quality && !orchestration && !diet;
  const input =
      6000 + Math.ceil(Math.max(0, Number(previousTextLength) || 0) / 2),
    baseOutput = openings
      ? Math.max(2500 + pages * 150, 2500 + openingTextTokens(specs, openings))
      : 2500 + pages * 150;
  // New outlines include a causal contract and before/after state ledger. Rebuilding an
  // edited outline is conditional, while reviewing prose and final pages is mandatory.
  const outlineOutput = Math.max(baseOutput, beats * 1100),
    reviewInput = input + outlineOutput + baseOutput;
  const count = (value) =>
    Math.min(
      100,
      Math.max(
        0,
        Math.round(Number.isFinite(Number(value)) ? Number(value) : beats),
      ),
    );
  const paragraphs =
    paragraphCount && typeof paragraphCount === "object"
      ? { ko: count(paragraphCount.ko), en: count(paragraphCount.en) }
      : {
          ko: count(paragraphCount ?? beats),
          en: count(paragraphCount ?? beats),
        };
  const stageEstimate = (
    stage,
    inputPerRequest,
    outputPerRequest,
    requestCount = 1,
    qualityRole,
  ) => {
    const { engineId, config } =
        qualityRole === "beatWriter"
          ? resolveBeatWriterSettings(snapshot, qualitySettings, writerTier)
          : qualityRole
            ? resolveQualityStageSettings(snapshot, qualityRole, qualitySettings)
            : resolveStoryStageSettings(snapshot, stage),
      reasoningFactor =
        getTextModelInfo(engineId, config.model, config).reasoning.profile ===
        "none"
          ? 1
          : 2,
      output = Math.ceil(outputPerRequest * reasoningFactor);
    const price = estimateTextCost({
      engineId,
      config,
      input: inputPerRequest,
      output,
      at,
    });
    return {
      stage,
      ...(qualityRole ? { qualityRole } : {}),
      engineId,
      ...price,
      costUsd: price.costUsd * requestCount,
      requestCount,
      inputTokensEstimated: inputPerRequest * requestCount,
      outputTokensEstimated: output * requestCount,
    };
  };
  const stages = [];
  if (k1Book);
  else if (council && orchestration)
    stages.push(
      diet
        ? stageEstimate("plotCandidates", 3500, 450, 4, "prose")
        : stageEstimate("plotCandidates", 4500, 1400, 4, "prose"),
      diet
        ? stageEstimate("council", 3000, 250, 4, "cheap")
        : stageEstimate("council", 4000, 1200, 4, "cheap"),
    );
  else if (council)
    stages.push(
      diet
        ? stageEstimate("council", 3000, 250, 5, "cheap")
        : stageEstimate("council", 4000, 1200, 5, "cheap"),
    );
  // (a K1 book has no writers' room.)
  if (beam) {
    stages.push(
      stageEstimate("beatCandidates", 3500, 900, beats, "outline"),
      stageEstimate("beatJudge", 2000, 250, beats, "cheap"),
    );
  }
  stages.push(
    // R31f: the diet rows are sized to the recorded stage costs of the R31e
    // K2 and R31c K1 runs plus about a third of headroom (a lean outline has
    // no ledger; one repair is inside the row).
    stageEstimate(
      "outline",
      diet ? 5000 : input + (beam ? beats * 300 : 0),
      diet ? beats * 350 : outlineOutput,
      1,
      quality && !k1Book && !diet ? (beam ? "cheap" : "outline") : undefined,
    ),
    diet
      ? stageEstimate("sceneBriefs", 3500, beats * 300)
      : stageEstimate("sceneBriefs", input, beats * 500),
  );
  if (k1Book) {
    // The whole book in one call, and one call for the pages the checks flag.
    const bookOutput = pages * 220 + 400;
    stages.push(
      // R31f: on the diet the K1 writer writes the whole book in one short
      // call and fixes it in one more (sized to the recorded R31c run).
      diet
        ? stageEstimate("prose", 3000, 1200, 1, "beatWriter")
        : stageEstimate("prose", 7000, bookOutput, 1, "beatWriter"),
      diet
        ? stageEstimate("k1Fix", 3500, 800, 1, "beatWriter")
        : stageEstimate("k1Fix", 7500, Math.ceil(bookOutput / 2), 1, "beatWriter"),
    );
  } else if (orchestration) {
    // R30 비트별 작가: one call per beat per language (+ beat 1's second
    // draft per language), about one retry in four, and the voice card and
    // two anchor sniffs on the economy model.
    const beatOutput = Math.ceil(baseOutput / 2 / beats) + 150;
    stages.push(
      // R31f: a diet beat call is one beat with a short brief; the rows are
      // sized to the recorded writer-stage cost of the R31e run (17 calls).
      diet
        ? stageEstimate("prose", 5000, 380, beats * 2 + 2, "beatWriter")
        : stageEstimate("prose", 5000, beatOutput, beats * 2 + 2, "beatWriter"),
      diet
        ? stageEstimate("beatRetries", 5500, 380, Math.ceil((beats * 2) / 4), "beatWriter")
        : stageEstimate(
            "beatRetries",
            5500,
            beatOutput,
            Math.ceil((beats * 2) / 4),
            "beatWriter",
          ),
      stageEstimate("beatVoice", 1500, 150, 3, "cheap"),
    );
  } else if (quality && !diet) {
    stages.push(
      stageEstimate(
        "prose",
        input + outlineOutput,
        Math.ceil(baseOutput / 2),
        2,
        "prose",
      ),
    );
    if (twoPass)
      stages.push(
        stageEstimate(
          "simplification",
          input + outlineOutput + Math.ceil(baseOutput / 2),
          Math.ceil(baseOutput / 2),
          2,
          editor ? "prose" : "cheap",
        ),
      );
  } else {
    if (hybrid) stages.push(stageEstimate("proseDraft", input, baseOutput));
    stages.push(stageEstimate("prose", input, baseOutput));
  }
  if (enrichment && paragraphs.ko + paragraphs.en && !k1Book)
    stages.push(
      stageEstimate("enrichment", 3000, 800, paragraphs.ko + paragraphs.en),
    );
  // A K1 book's pages were written as pages (no pagination request).
  // R31f: the diet pagination request shows the lean outline and the prose
  // (measured about 5.5k in, 2k out); the pre-diet row stays for other drafts.
  if (!k1Book)
    stages.push(
      diet
        ? stageEstimate("pagination", 5500, 600 + pages * 45)
        : stageEstimate("pagination", input, baseOutput),
    );
  // R31c: about two page fixes after the checks on the diet (measured 11–24
  // before the loop was put on a diet); a diet K1 book skips the editor.
  // R31f: a fix shows one lean page (K1 pages are shorter still).
  if (diet)
    stages.push({
      ...(k1Book ? stageEstimate("pagination", 2500, 200, 2) : stageEstimate("pagination", 5000, 350, 2)),
      stage: "pageFix",
    });
  if (editor && !(k1Book && diet))
    stages.push({
      // R31f: the diet read-through shows lean views and returns only the
      // entries it changed (sized to the recorded R31e pagination stage).
      ...(diet
        ? stageEstimate("coherence", 5000 + pages * 125, 800)
        : stageEstimate("coherence", reviewInput, Math.ceil(baseOutput / 2))),
      stage: "revision",
    });
  // R26: the review rows are priced on the review model (the same row as before
  // for a snapshot without reviewTier).
  if (ledger)
    stages.push({ ...stageEstimate("coherenceReview", reviewInput, 1600, 2), stage: "coherence" });
  if (childSimulator)
    stages.push(
      diet
        ? stageEstimate("childSimulator", 6000, 400, 2, "cheap")
        : stageEstimate("childSimulator", reviewInput, 1000, 2, "cheap"),
    );
  const final = stages.find((row) => row.stage === "prose"),
    unknown = stages.filter((row) => row.pricingUnknown);
  return {
    ...final,
    // R13: a model outside the catalog has no price. Its stages add nothing
    // here and the total says '일부 요금 미확인' instead of a made-up number.
    ...(unknown.length
      ? {
          pricingUnknown: true,
          unknownPricingStages: unknown.map((row) => row.stage),
        }
      : {}),
    costUsd: stages.reduce((sum, row) => sum + row.costUsd, 0),
    inputTokensEstimated: stages.reduce(
      (sum, row) => sum + row.inputTokensEstimated,
      0,
    ),
    outputTokensEstimated: stages.reduce(
      (sum, row) => sum + row.outputTokensEstimated,
      0,
    ),
    requestCount: stages.reduce((sum, row) => sum + row.requestCount, 0),
    hybrid,
    quality,
    twoPass,
    beam,
    childSimulator,
    enrichment,
    ...(editor ? { editor: true } : {}),
    ...(council ? { council: true } : {}),
    ...(orchestration && !k1Book ? { orchestration: true } : {}),
    ...((orchestration || k1Book) && writerTier === "upper" ? { writerTier } : {}),
    ...(k1Book ? { k1Book: true } : {}),
    ...(diet ? { diet: true } : {}),
    beatCount: beats,
    paragraphCount: paragraphs,
    stages,
    note: `${council && orchestration ? "정성 모드 기획 회의(성장 설계·플롯 후보 3개·편집자·그림 감독·독자·바이블), " : council ? "기획 회의 5회(작가 피치·편집자·그림 감독·독자·바이블), " : ""}인과·상태표가 포함된 줄거리${beam ? `(비트 후보 생성·심사 ${beats * 2}회 + 마무리 1회)` : ""}, 장면 브리프 1회${diet && !k1Book && !orchestration ? ", 한글·영어 전문 1회" : k1Book ? `, K1 그림책 작가(책 전체 한 번 + 걸린 쪽 고치기 한 번, 쪽 나누기 요청 없음)${writerTier === "upper" ? "·최고 모델" : "·중간 모델"}` : orchestration ? `, 정성 모드 비트별 작가(한글·영어 비트마다 1회 ${beats * 2}회, 첫 비트 두 안·되풀이 말 카드, 예상 재작성 ${Math.ceil((beats * 2) / 4)}회 — 비트마다 최대 3번)${writerTier === "upper" ? "·최고 모델" : "·중간 모델"}` : twoPass ? ", 한글·영어 풍부화·단순화 각 2회" : quality ? ", 한글·영어 목표 수준 전문 각 1회" : enrichment ? "와 한글·영어 문단별 풍부화" : ""}${ledger ? ", 전문·최종 쪽의 일관성 검사 총 2회" : ""}${childSimulator ? ", 아이 시뮬레이터 2회" : ""}${editor ? ", 책 전체 편집자 통독 1회" : ""}를 포함한 단계별 모델 단가 추정${snapshot.reviewTier === REVIEW_TIER_MEDIUM ? "(사건 연결 판정은 한 단계 낮은 모델, 수정·통독은 상위 모델)" : ""} · 줄거리 지적 비트 수정·보조 패턴 재생성, 감정 직설어 수정, 아이 시뮬레이터 지적 쪽 수정, 수기로 수정한 줄거리의 인과·상태표 재생성, 검사 단계별 최대 2회 재작성 및 재검사, 주간 코치, 실제 문단 수·추론 토큰·이전 원문 길이에 따른 추가 요금은 별도예요`,
  };
}

// R24: which FULL AUTO step pays for each estimate row (the review row is
// split between the prose check and the final page check).
const BUDGET_STEP = {
  plotCandidates: "outline",
  council: "outline",
  beatCandidates: "outline",
  beatJudge: "outline",
  outline: "outline",
  sceneBriefs: "briefs",
  proseDraft: "proseDraft",
  prose: "prose",
  beatRetries: "prose",
  k1Fix: "prose",
  pageFix: "pagination",
  beatVoice: "prose",
  simplification: "prose",
  enrichment: "enrichment",
  pagination: "pagination",
  revision: "pagination",
  childSimulator: "pagination",
};
/**
 * R24: the one text budget the screens show for a job — what its saved calls
 * cost so far and what the steps it has not finished are expected to cost.
 * `parked` is a writers' room waiting for the parent: four meeting answers
 * are saved and only the bible call remains. Read-only; never touches the job.
 */
export function jobTextBudget(job = {}, { parked = job?.status === "council-review" } = {}) {
  if (job.demo) return { usedUsd: 0, usedUnknown: false, remainingUsd: 0, remainingUnknown: false, meetingUsd: 0, meetingUnknown: false, stages: [] };
  let usedUsd = 0, usedUnknown = false;
  for (const row of job.usage?.calls || []) {
    if (row.requests === 0) continue;
    const raw = row.costUsdEstimated ?? row.costUsd;
    if (raw == null || !Number.isFinite(Number(raw)) || row.pricingUnknown) usedUnknown = true;
    else usedUsd += Math.max(0, Number(raw));
  }
  const input = job.input || {},
    done = job.completed || {},
    settings = job.textSettings || {},
    estimate = estimateStoryTextCost({ settings, pageCount: input.pageCount || job.wizard?.pageCount || 12, layout: input.specs?.ko?.units ? "openings" : undefined, specs: input.specs, editor: input.editorPolicy?.version === 1, council: parked || input.councilPolicy?.version === 1, ...(input.orchestrationPolicy?.version === 1 ? { orchestration: true, writerTier: input.orchestrationPolicy.writerTier } : {}), ...(input.k1Policy?.version === 1 ? { k1Book: true } : {}), ...(input.promptDiet?.version === 1 ? { diet: true } : {}), ledger: job.outline ? !!job.outline.plotContract : input.promptDiet?.version !== 1 }),
    council = estimate.stages.find((row) => row.stage === "council"),
    rows = [];
  for (const row of estimate.stages) {
    let share = 1;
    if (row.stage === "coherence") share = (done.proseCoherence ? 0 : 0.5) + (done.pagination ? 0 : 0.5);
    else if (done[BUDGET_STEP[row.stage]]) share = 0;
    else if (row.stage === "council" && parked) share = 1 / Math.max(1, row.requestCount);
    else if (row.stage === "plotCandidates" && parked) share = 0;
    if (share > 0) rows.push({ stage: row.stage, costUsd: row.costUsd * share, pricingUnknown: row.pricingUnknown === true });
  }
  // The paid material plan runs before the outline (never for a picked cast).
  if (job.planMode === "auto" && !done.plan && !done.outline && !parked) {
    const plan = resolveStoryStageSettings(settings, "outline"),
      price = estimateTextCost({ ...plan, input: 11000, output: 5000, model: plan.config.model });
    rows.unshift({ stage: "plan", costUsd: price.costUsd, pricingUnknown: price.pricingUnknown === true });
  }
  return {
    usedUsd,
    usedUnknown,
    remainingUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
    remainingUnknown: rows.some((row) => row.pricingUnknown),
    meetingUsd: council?.costUsd || 0,
    meetingUnknown: council?.pricingUnknown === true,
    stages: rows,
  };
}

/** UI estimate for continuing a parked council; it never changes engine settings. */
export function councilDecisionCosts(job = {}) {
  if (job.demo) return { usedUsd: 0, usedUnknown: false, continueUsd: 0, continueUnknown: false, meetingUsd: 0, meetingUnknown: false };
  const b = jobTextBudget(job, { parked: true });
  return { usedUsd: b.usedUsd, usedUnknown: b.usedUnknown, continueUsd: b.remainingUsd, continueUnknown: b.remainingUnknown, meetingUsd: b.meetingUsd, meetingUnknown: b.meetingUnknown };
}
