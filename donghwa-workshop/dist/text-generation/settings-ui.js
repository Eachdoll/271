import { getActiveWorld } from "../image-generation/world.js";
import {
  listTextModels,
  getTextModelInfo,
  resolveTextModel,
  estimateTextCost,
  getStoryStageModels,
  estimateStoryTextCost,
  STORY_STAGE_MODELS,
  listTextModelOptions,
  textModelShortName,
  normalizeModelRegistry,
  validateModelId,
  isModelId,
  MAX_CUSTOM_MODELS,
  freezeReviewTier,
} from "./models.js";
import { fetchProviderModels } from "./model-list.js";
import {
  saveCredential,
  removeCredential,
  hasCredential,
  getCredential,
} from "../image-generation/vault.js";
const ENGINES = ["openai", "anthropic", "google", "local"],
  NAMES = {
    openai: "OpenAI",
    anthropic: "Anthropic · Claude",
    google: "Google · Gemini",
    local: "로컬 · LM Studio / Ollama",
  },
  clone = (x) => JSON.parse(JSON.stringify(x));
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let api,
  configured = false,
  editingSettings = null;
export function normalizeStoryQualitySettings(value = {}) {
  const source =
      value && typeof value === "object" && !Array.isArray(value) ? value : {},
    text = (value, max) =>
      typeof value === "string" ? value.slice(0, max) : "",
    list = (value, maxItems, maxLength) =>
      Array.isArray(value)
        ? value
            .filter((item) => typeof item === "string")
            .slice(0, maxItems)
            .map((item) => text(item, maxLength))
        : [];
  const engines = {};
  for (const role of ["outline", "prose", "cheap", "coach"]) {
    const entry = source.engines?.[role],
      engine = entry?.engine ?? entry?.engineId;
    if (ENGINES.includes(engine))
      engines[role] = {
        engine,
        ...(typeof entry.model === "string"
          ? { model: text(entry.model, 200) }
          : {}),
      };
  }
  const worldId =
      typeof source.worldId === "string" &&
      /^[a-zA-Z0-9_-]{1,100}$/.test(source.worldId)
        ? source.worldId
        : "drawer",
    season = ["auto", "none", "spring", "summer", "autumn", "winter"].includes(
      source.season,
    )
      ? source.season
      : "auto",
    timeOfDay = ["auto", "day", "night"].includes(source.timeOfDay)
      ? source.timeOfDay
      : "auto",
    variantChance =
      typeof source.variantChance === "number" &&
      Number.isFinite(source.variantChance) &&
      source.variantChance >= 0 &&
      source.variantChance <= 1
        ? source.variantChance
        : 0.35;
  const result = {
    enabled: source.enabled !== false,
    useBeamSearch: source.useBeamSearch === true,
    useDistilledExamples: source.useDistilledExamples === true,
    twoPass: source.twoPass !== false,
    childSimulator: source.childSimulator !== false,
    weeklyCoach: source.weeklyCoach !== false,
    engines,
    worldId,
    season,
    timeOfDay,
    variantChance,
    patternId: text(source.patternId, 100) || "auto",
    rules: list(source.rules, 7, 1000),
    banExamples: list(source.banExamples, 4, 1000),
    banWindow: Math.min(
      50,
      Math.max(1, Math.round(Number(source.banWindow) || 10)),
    ),
    patternBanWindow: Math.min(
      20,
      Math.max(1, Math.round(Number(source.patternBanWindow) || 3)),
    ),
  };
  if (Array.isArray(source.styleSamples))
    result.styleSamples = list(source.styleSamples, 3, 4000);
  if (Array.isArray(source.patterns))
    result.patterns = source.patterns
      .slice(0, 20)
      .filter((row) => row && typeof row === "object" && !Array.isArray(row))
      .map((row) => ({
        id: text(row.id, 100),
        name: text(row.name, 100),
        bestFor: list(row.bestFor, 20, 100),
        emotions: list(row.emotions, 20, 100),
        beats: (Array.isArray(row.beats) ? row.beats : [])
          .slice(0, 8)
          .filter((beat) => beat && typeof beat === "object")
          .map((beat) => ({
            type: text(beat.type, 30),
            slot: text(beat.slot, 1000),
          })),
        refrain: {
          type: text(row.refrain?.type, 30),
          hint: text(row.refrain?.hint, 1000),
        },
        pageTurn: text(row.pageTurn, 1000),
        avoid: text(row.avoid, 1000),
      }));
  return result;
}
export function getTextGenerationSettings(state) {
  const source = state.settings?.textGeneration || {},
    engine = ENGINES.includes(source.engine) ? source.engine : "openai",
    providers = {};
  for (const id of ENGINES) {
    const p = source.providers?.[id] || {},
      // R13: fetched and typed model IDs travel with the provider (and into
      // every frozen draft/job copy); settings saved before R13 have none.
      registry = normalizeModelRegistry(p),
      known = { ...p, ...registry };
    providers[id] = {
      model: resolveTextModel(id, p.model, known),
      ...(id !== "local"
        ? { stageModels: getStoryStageModels(id, known) }
        : { baseUrl: p.baseUrl || "http://127.0.0.1:1234/v1" }),
      ...(p.proxyEndpoint
        ? { proxyEndpoint: p.proxyEndpoint, transport: "proxy" }
        : {}),
      ...registry,
    };
  }
  return {
    engine,
    providers,
    storyEnrichment: source.storyEnrichment !== false,
    imageDiversity: source.imageDiversity !== false,
    // R26: only an explicit '검사는 최고 모델로' is stored; nothing otherwise
    // (settings saved before R26 gain no field).
    ...(source.reviewTier === "upper" ? { reviewTier: "upper" } : {}),
    // R29 정성 모드: on unless turned off (only `false` is stored), and the
    // beat writer on the upper model only when chosen (medium otherwise).
    ...(source.orchestration === false ? { orchestration: false } : {}),
    ...(source.writerTier === "upper" ? { writerTier: "upper" } : {}),
    hybrid: {
      enabled: source.hybrid?.enabled === true,
      finalEngine: ENGINES.slice(0, 3).includes(source.hybrid?.finalEngine)
        ? source.hybrid.finalEngine
        : "openai",
    },
    storyQuality: normalizeStoryQualitySettings(
      state.settings?.storyQuality ?? source.storyQuality,
    ),
  };
}
function options(selected, local = true) {
  return ENGINES.filter((id) => local || id !== "local")
    .map(
      (id) =>
        `<option value="${id}" ${id === selected ? "selected" : ""}>${esc(NAMES[id])}</option>`,
    )
    .join("");
}
const CUSTOM_OPTION = '<option value="__custom">직접 입력…</option>';
/** <optgroup>s: the curated catalog, the fetched list, then typed IDs (R13). */
function groupedModelOptions(engine, config, selected) {
  const options = listTextModelOptions(engine, config),
    fetched = normalizeModelRegistry(config).fetchedModels;
  const group = (name, label) => {
    const rows = options.filter((row) => row.group === name);
    return rows.length
      ? `<optgroup label="${esc(label)}">${rows.map((row) => `<option value="${esc(row.id)}" ${row.id === selected ? "selected" : ""}>${esc(row.label)}</option>`).join("")}</optgroup>`
      : "";
  };
  return `${group("catalog", "추천 목록 · 요금 확인 2026-10-15")}${group("fetched", `불러온 목록${fetched?.fetchedAt ? ` · ${fetched.fetchedAt.slice(0, 10)}` : ""}`)}${group("custom", "직접 입력한 모델")}`;
}
function modelOptions(engine, selected, config = {}) {
  return `${groupedModelOptions(engine, config, selected)}${CUSTOM_OPTION}`;
}
function modelDetails(engine, model, config = {}) {
  const row = getTextModelInfo(engine, model, config);
  if (row.custom)
    return `<p class="small-label">목록에 없는 모델 · 요금 정보 없음 · 요금은 공급자에서 확인해 주세요. 온도·추론 설정 없이 단계별 출력 한도만 보내요.</p>`;
  const input = estimateTextCost({ engine, model, input: 1000000 }).costUsd,
    output = estimateTextCost({ engine, model, output: 1000000 }).costUsd;
  return `<p class="small-label">입력 $${input} / 출력 $${output} · 각각 100만 토큰당 참고 단가${row.pricingChange ? `<br>요금 변경 예정: ${esc(row.pricingChange.effectiveAt)}부터 입력 $${row.pricingChange.input} / 출력 $${row.pricingChange.output}.` : ""} · <a href="${esc(row.docs)}" target="_blank" rel="noopener noreferrer">공식 모델 안내 ↗</a></p>`;
}
const shortName = (engine, id, config) =>
  textModelShortName(engine, id, config);
/**
 * The simple choice (R13): one model for the main writing stages. '' means the
 * stage defaults, '__stages' a pro-mode medium/upper pair it leaves untouched.
 */
export function simpleTextModelValue(engine, provider = {}) {
  if (engine === "local") return String(provider.model || "").trim();
  const models = getStoryStageModels(engine, provider),
    defaults = STORY_STAGE_MODELS[engine];
  if (models.medium === defaults.medium && models.upper === defaults.upper)
    return "";
  return models.medium === models.upper ? models.medium : "__stages";
}
/** <option>s for the simple 모델 select (③ and the simple settings). */
export function simpleTextModelOptions(engine, provider = {}) {
  const value = simpleTextModelValue(engine, provider);
  if (engine === "local") {
    const options = listTextModelOptions("local", provider);
    if (value && !options.some((row) => row.id === value))
      options.push({ id: value, label: `${value} · 로컬`, group: "custom" });
    return `<option value="" ${value ? "" : "selected"}>자동 · 로컬 서버의 첫 모델</option>${options.map((row) => `<option value="${esc(row.id)}" ${row.id === value ? "selected" : ""}>${esc(row.label)}</option>`).join("")}${CUSTOM_OPTION}`;
  }
  const defaults = STORY_STAGE_MODELS[engine],
    models = getStoryStageModels(engine, provider);
  return `<option value="" ${value === "" ? "selected" : ""}>기본 추천 · ${esc(shortName(engine, defaults.medium))} + ${esc(shortName(engine, defaults.upper))} (단계별 자동)</option>${value === "__stages" ? `<option value="__stages" selected>프로 모드 단계별 설정 · ${esc(shortName(engine, models.medium, provider))} + ${esc(shortName(engine, models.upper, provider))}</option>` : ""}${groupedModelOptions(engine, provider, value)}${CUSTOM_OPTION}`;
}
/** One Korean line under the simple select: which calls the choice drives. */
export const SIMPLE_TEXT_MODEL_NOTE =
  "고른 모델로 줄거리·글·글 다듬기·쪽 나누기·검사·책 전체 퇴고를 써요. 심사 같은 보조 호출은 기본 경제형 모델 그대로예요.";
/**
 * Apply the simple choice to a provider's saved settings (mutates `source`,
 * a textGeneration object). The main writing stages ('medium' and 'upper')
 * use the model; economy helpers keep their defaults. Returns true on change.
 */
export function applySimpleTextModel(source, engine, value) {
  if (!ENGINES.includes(engine))
    throw new Error("지원하는 글 엔진을 선택해 주세요.");
  if (value === "__stages") return false;
  source.providers ||= {};
  const p = (source.providers[engine] ||= {});
  if (engine === "local") {
    const id = value ? validateModelId(value) : "";
    if (id) rememberTypedModel(p, engine, id);
    p.model = id;
    return true;
  }
  if (!value) {
    p.stageModels = { ...STORY_STAGE_MODELS[engine] };
    return true;
  }
  const id = validateModelId(value);
  rememberTypedModel(p, engine, id);
  p.stageModels = { medium: id, upper: id };
  return true;
}
/** A typed ID outside the catalog and the fetched list joins customModels. */
function rememberTypedModel(p, engine, id) {
  const registry = normalizeModelRegistry(p);
  if (
    (engine === "local" ||
      !listTextModels(engine).some((row) => row.id === id)) &&
    !registry.fetchedModels?.models.some((row) => row.id === id)
  )
    p.customModels = [
      ...(registry.customModels || []).filter((item) => item !== id),
      id,
    ].slice(-MAX_CUSTOM_MODELS);
}
function modelStatus(engine, p) {
  const fetched = normalizeModelRegistry(p).fetchedModels;
  return fetched
    ? `불러온 목록 ${fetched.models.length}개 · ${esc(fetched.fetchedAt.slice(0, 10))}`
    : "목록 불러오기는 무료예요 · 이 키로 쓸 수 있는 글 모델만 보여 줘요.";
}
/** The '직접 입력' field, shown only while a select has '직접 입력…' chosen. */
function customModelField(prefix) {
  return `<input id="${prefix}-custom-model" data-text-field="customModel" type="text" maxlength="120" spellcheck="false" autocomplete="off" hidden placeholder="모델 ID (영문·숫자와 . _ : / -)" aria-label="글 모델 ID 직접 입력">`;
}
/**
 * Pro panels get a '모델 목록 불러오기' button. Simple screens keep their
 * 12-button cap, so there the same free list call is the select's own
 * '모델 목록 불러오기 · 무료…' option (SIMPLE_FETCH_OPTION).
 */
function modelListRow(engine, p, simple = false) {
  return `${simple ? "" : '<div class="material-add-actions"><button type="button" class="btn btn-outline" data-text-setting="fetch-models">모델 목록 불러오기</button></div>'}<small data-text-model-status role="status" aria-live="polite">${modelStatus(engine, p)}</small>`;
}
export const SIMPLE_FETCH_OPTION =
  '<option value="__fetch">모델 목록 불러오기 · 무료…</option>';
function providerFields(
  settings,
  engine,
  prefix = "tg",
  { simple = false } = {},
) {
  const p = settings.providers[engine];
  if (engine === "local")
    return simple
      ? `<div class="form-grid"><div class="field"><label for="${prefix}-base-url">OpenAI 호환 로컬 주소</label><input id="${prefix}-base-url" data-text-field="baseUrl" type="url" value="${esc(p.baseUrl)}" placeholder="http://127.0.0.1:1234/v1"><small>LM Studio·Ollama에서 모델과 서버를 실행하고 /v1까지 입력하세요.</small></div><div class="field"><label for="${prefix}-model">모델</label><select id="${prefix}-model" data-text-field="model" data-current="${esc(simpleTextModelValue("local", p))}">${simpleTextModelOptions("local", p)}${SIMPLE_FETCH_OPTION}</select>${customModelField(prefix)}<small>로컬 모델은 API 요금이 없어요. 컴퓨터 비용은 별도예요.</small>${modelListRow(engine, p, true)}</div></div>`
      : `<div class="form-grid"><div class="field"><label for="${prefix}-base-url">OpenAI 호환 로컬 주소</label><input id="${prefix}-base-url" data-text-field="baseUrl" type="url" value="${esc(p.baseUrl)}" placeholder="http://127.0.0.1:1234/v1"><small>LM Studio·Ollama에서 모델과 서버를 실행하고 /v1까지 입력하세요.</small></div><div class="field"><label for="${prefix}-local-model">로컬 모델 이름 · 선택</label><input id="${prefix}-local-model" data-text-field="localModel" maxlength="200" value="${esc(p.model)}" placeholder="비우면 /v1/models의 첫 실행 모델" list="${prefix}-local-models"><datalist id="${prefix}-local-models">${listTextModelOptions(
          "local",
          p,
        )
          .map(
            (row) =>
              `<option value="${esc(row.id)}">${esc(row.label)}</option>`,
          )
          .join(
            "",
          )}</datalist><small>로컬의 줄거리·초안은 이 모델을 함께 사용해요. API 요금은 없으며 컴퓨터 비용은 별도예요.</small></div></div>`;
  const models = getStoryStageModels(engine, p);
  const modelFields = simple
    ? `<div class="field"><label for="${prefix}-model">모델</label><select id="${prefix}-model" data-text-field="model" data-current="${esc(simpleTextModelValue(engine, p))}">${simpleTextModelOptions(engine, p)}${SIMPLE_FETCH_OPTION}</select>${customModelField(prefix)}<small>${SIMPLE_TEXT_MODEL_NOTE}</small>${modelListRow(engine, p, true)}</div>`
    : `<div class="form-grid"><div class="field"><label for="${prefix}-model-medium">중간 등급 기본 모델 · 장면·쪽 나누기</label><select id="${prefix}-model-medium" data-text-field="medium">${modelOptions(engine, models.medium, p)}</select><small>글 품질 설정의 기본 전문 역할과 기존 생성의 줄거리에도 사용해요.</small><div data-text-price="medium">${modelDetails(engine, models.medium, p)}</div></div><div class="field"><label for="${prefix}-model-upper">상위 등급 기본 모델 · 전체 일관성 검사</label><select id="${prefix}-model-upper" data-text-field="upper">${modelOptions(engine, models.upper, p)}</select><small>글 품질 설정의 기본 줄거리·코치 역할과 기존 생성의 전문에도 사용해요.</small><div data-text-price="upper">${modelDetails(engine, models.upper, p)}</div></div></div>${customModelField(prefix)}${modelListRow(engine, p)}`;
  return `${modelFields}<div class="field"><label for="${prefix}-api-key">${esc(NAMES[engine])} API 비밀 키</label><input id="${prefix}-api-key" data-text-field="apiKey" data-text-credential-engine="${engine}" type="password" autocomplete="off" maxlength="16384" placeholder="비밀 키 전체를 입력하세요"><small>${engine === "openai" ? "key_ 추적 ID나 sk-… 가려진 값 대신 생성할 때 복사한 sk- 비밀 키 전체를 입력하세요. " : ""}키는 PIN으로 기기에 암호화하며 클라우드·백업에 넣지 않아요.</small></div><div class="material-add-actions"><button type="button" class="btn btn-outline" data-text-setting="save-key">키 암호화 저장</button><button type="button" class="btn btn-outline" data-text-setting="delete-key">저장된 키 삭제</button></div><div class="field" style="margin-top:15px"><label for="${prefix}-proxy">글 프록시 주소 · 선택</label><input id="${prefix}-proxy" data-text-field="proxyEndpoint" type="url" value="${esc(p.proxyEndpoint || "")}" placeholder="https://my-proxy.example"><small>프록시는 서버 환경변수 키를 사용하며 브라우저의 키를 보내지 않아요.</small></div>`;
}
function refreshCredentialLabels() {
  if (typeof document === "undefined") return;
  for (const field of document.querySelectorAll(
    "#text-engine-form [data-text-credential-engine]",
  ))
    hasCredential(field.dataset.textCredentialEngine)
      .then((saved) => {
        if (field.isConnected)
          field.placeholder = saved
            ? "이미지·글 엔진이 같은 저장된 키를 공유해요 · 교체 시 입력"
            : "비밀 키 전체를 입력하세요";
      })
      .catch(() => {});
}
function providerPanel(settings, engine, prefix, simple = false) {
  if (typeof document !== "undefined") queueMicrotask(refreshCredentialLabels);
  return `<div data-text-provider="${engine}" data-text-prefix="${prefix}"${simple ? ' data-text-simple="1"' : ""}>${providerFields(settings, engine, prefix, { simple })}</div>`;
}
/** The simple settings page draws its main provider with one 모델 select (R13). */
const isQuickForm = () =>
  typeof document !== "undefined" &&
  !!document.querySelector("#text-engine-form.quick-engine-form");
function finalProviderFields(settings) {
  return settings.hybrid.finalEngine === settings.engine
    ? '<p class="small-label">위에서 고른 공급자의 전문·쪽 나누기 모델과 키를 함께 사용해요.</p>'
    : providerPanel(settings, settings.hybrid.finalEngine, "tg-final");
}
function hybridLocalFields(settings) {
  return settings.engine === "local"
    ? ""
    : `<h4>하이브리드 로컬 줄거리·초안</h4>${providerPanel(settings, "local", "tg-hybrid")}`;
}
/**
 * R30: what a new 12-page story's text costs on these settings — the writers'
 * room, the editor round and (while 정성 모드 is on) the beat writer on the
 * chosen model, as a new draft freezes them.
 */
export function newStoryTextEstimate(settings) {
  return estimateStoryTextCost({
    settings,
    pageCount: 12,
    editor: true,
    council: true,
    ...(settings.orchestration !== false
      ? {
          orchestration: true,
          writerTier: settings.writerTier === "upper" ? "upper" : "medium",
        }
      : {}),
  });
}
function priceSummary(settings) {
  const estimate = newStoryTextEstimate(settings),
    enrichment = estimate.stages.find((stage) => stage.stage === "enrichment"),
    writer = estimate.stages
      .filter((stage) => stage.qualityRole === "beatWriter")
      .reduce((n, stage) => n + stage.requestCount, 0);
  const prose = estimate.orchestration
    ? ` + 정성 모드(성장 설계·줄거리 후보 3개, 비트별 작가 약 ${writer}회·${settings.writerTier === "upper" ? "최고" : "중간"} 모델) + 기획 회의·편집자 통독`
    : estimate.quality
    ? estimate.twoPass
      ? " + 한글·영어 풍부화·단순화 4회"
      : " + 한글·영어 목표 수준 전문 2회"
    : enrichment
      ? ` + 한글·영어 문단 풍부화 ${enrichment.requestCount}회 포함`
      : " · 문단 풍부화 꺼짐";
  return `<strong>12쪽 이야기 글 예상: 약 $${estimate.costUsd.toFixed(3)}${estimate.pricingUnknown ? " · 일부 요금 미확인" : ""}</strong><br><small>${estimate.pricingUnknown ? "목록에 없는 모델을 쓰는 단계는 요금 정보 없음이라 합계에서 빠졌어요. 요금은 공급자에서 확인해 주세요. " : ""}약 ${estimate.requestCount}회 요청 · 인과·상태표 + 장면 브리프 1회 + 전체 일관성 검사 2회${prose}${estimate.childSimulator ? " + 아이 시뮬레이터 2회" : ""}${estimate.beam ? ` · 비트 탐색은 후보·심사 ${estimate.beatCount * 2}회와 마무리 1회` : ""} (${estimate.beatCount}개 비트 가정). 줄거리 수정·보조 패턴 재생성, 직설어·시뮬레이터 지적 내용 수정, 수기 편집 후 재검사, 검사 단계별 최대 2회 재작성과 후속 검사, 주간 코치는 추가 요금이 들어요. 문단 수·긴 이전 원문·추론 토큰·실제 사용량에 따라 달라져요. ${settings.imageDiversity !== false ? "유사 그림은 책당 확인 후 선택한 쪽만 다시 생성하며 이미지 요금이 별도로 들어요. " : ""}ChatGPT 등 웹 구독과 별도인 API 요금이며 실제 청구액은 공급자에서 확인하세요.</small>`;
}
export function renderTextSettings(state) {
  const settings = getTextGenerationSettings(state);
  editingSettings = clone(settings);
  return `<section class="panel" id="text-engine-settings" style="margin:24px 0"><h3>이야기 글 엔진 · 이미지 엔진과 별도</h3><p class="section-sub">글 품질 설정에서 줄거리·전문·심사 엔진을 각각 고를 수 있어요. 여기서는 공급자별 기본 모델과 키, 장면·쪽 나누기 설정을 관리합니다.</p><form id="text-engine-form"><div class="field"><label for="tg-engine">이야기 생성 엔진</label><select id="tg-engine">${options(settings.engine)}</select></div><div id="tg-provider-fields">${providerPanel(settings, settings.engine, "tg")}</div><div class="field" style="margin-top:18px"><label><input id="tg-hybrid" type="checkbox" ${settings.hybrid.enabled ? "checked" : ""}> 하이브리드 · 로컬 줄거리 + API 전문</label><small>기본은 꺼짐이에요. 품질 모드는 로컬 줄거리와 최종 API의 전문·심사 역할을 사용해요. 기존 생성은 로컬 초안을 API로 다듬어요.</small></div><div id="tg-hybrid-fields" ${settings.hybrid.enabled ? "" : "hidden"}><div id="tg-hybrid-local-fields">${hybridLocalFields(settings)}</div><div class="field"><label for="tg-final-engine">하이브리드 최종 API 엔진</label><select id="tg-final-engine">${options(settings.hybrid.finalEngine, false)}</select></div><div id="tg-final-provider-fields">${finalProviderFields(settings)}</div></div><div class="field" style="margin-top:18px"><label><input id="tg-story-enrichment" type="checkbox" ${settings.storyEnrichment ? "checked" : ""}> 기존 생성 · 문단별 풍부화</label><small>장면 디테일을 참고해 감각·행동·대화를 더해요. 품질 모드에서는 역할별 전문 단계를 사용하며, 이 문단별 추가 요청은 실행하지 않아요.</small></div><div class="field"><label><input id="tg-image-diversity" type="checkbox" ${settings.imageDiversity ? "checked" : ""}> 그림 다양성 검사</label><small>이웃한 그림을 비교해 알려드려요. 유료 엔진은 책당 확인 후 선택한 쪽만 다시 그려요.</small></div><div class="field"><label><input id="tg-review-upper" type="checkbox" ${settings.reviewTier === "upper" ? "checked" : ""}> 검사는 최고 모델로</label><small>끄면(기본) 사건 연결 판정은 한 단계 낮은 모델로 해 요금을 줄여요. 글을 쓰고 고치는 모델과 책 전체 통독은 그대로예요. 새 이야기부터 적용돼요.</small></div><div class="field"><label><input id="tg-orchestration" type="checkbox" ${settings.orchestration !== false ? "checked" : ""}> 정성 모드(기본 켜짐)</label><small>성장 설계와 서로 다른 각도의 줄거리 후보 3개를 겨루게 해 고르고, 비트마다 나누어 써요. 글 요금과 시간이 늘어요. 새 이야기부터 적용돼요.</small></div><div class="field"><label><input id="tg-writer-upper" type="checkbox" ${settings.writerTier === "upper" ? "checked" : ""}> 정성 모드 작가는 최고 모델로</label><small>끄면(기본) 비트별 작가는 중간 모델이에요. 켜면 문장이 더 좋아질 수 있지만 요금이 늘어요.</small></div><div class="story-cost" id="tg-price-summary">${priceSummary(freezeReviewTier(settings))}</div><p class="small-label">새 초안부터 적용해요. 이야기의 ‘변경’ 링크로 왔다면 저장 후 이야기로 돌아가 진행 중인 초안에도 적용하세요.</p><p id="tg-error" class="pin-error" role="status" aria-live="polite"></p><div class="modal-actions"><button class="btn btn-green" type="submit">글 엔진 설정 저장</button></div></form></section>`;
}
/**
 * Minimal text-engine form for the simple settings page: one engine select and
 * that provider's key fields. It keeps every id the existing change, click and
 * submit handlers read (#tg-hybrid, #tg-final-engine, … stay present but hidden),
 * so saving uses the same handler and keeps the stored hybrid/model choices.
 */
export function renderTextEngineQuick(state) {
  const settings = getTextGenerationSettings(state);
  editingSettings = clone(settings);
  return `<form id="text-engine-form" class="quick-engine-form"><div class="field"><label for="tg-engine">글 엔진 · 공급자</label><select id="tg-engine">${options(settings.engine)}</select></div><div id="tg-provider-fields">${providerPanel(settings, settings.engine, "tg", true)}</div><div hidden><input id="tg-hybrid" type="checkbox" ${settings.hybrid.enabled ? "checked" : ""}><div id="tg-hybrid-fields" hidden><div id="tg-hybrid-local-fields">${hybridLocalFields(settings)}</div><select id="tg-final-engine">${options(settings.hybrid.finalEngine, false)}</select><div id="tg-final-provider-fields">${finalProviderFields(settings)}</div></div><input id="tg-story-enrichment" type="checkbox" ${settings.storyEnrichment ? "checked" : ""}><input id="tg-image-diversity" type="checkbox" ${settings.imageDiversity ? "checked" : ""}></div>${settings.hybrid.enabled ? '<p class="small-label">하이브리드 설정이 켜져 있어요. 프로 모드의 단계별 모델 설정이 우선 적용돼요.</p>' : ""}<p id="tg-error" class="pin-error" role="status" aria-live="polite"></p></form>`;
}
function checkedUrl(raw) {
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("주소에는 HTTP(S) 주소만 입력해 주세요.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("주소에는 HTTP(S) 주소만 입력해 주세요.");
  return url.href.replace(/\/+$/, "");
}
function showError(error) {
  const el = document.querySelector("#tg-error");
  if (el) el.textContent = error.message;
  api.toast(error.message);
}
function readProvider(container, { validate = false } = {}) {
  if (!container) return;
  const engine = container.dataset.textProvider,
    p = editingSettings.providers[engine],
    field = (name) => container.querySelector(`[data-text-field="${name}"]`);
  // R13 '직접 입력…': the typed ID is checked when saving; while editing an
  // unfinished ID leaves the previous choice in place.
  const pick = (value, fallback) => {
    if (value !== "__custom") return value;
    const raw = field("customModel")?.value ?? "";
    if (!validate && !isModelId(raw)) return fallback;
    const id = validateModelId(raw);
    rememberTypedModel(p, engine, id);
    return id;
  };
  if (engine === "local") {
    const value = field("baseUrl").value.trim();
    p.baseUrl = validate ? checkedUrl(value) : value;
    if (validate && !p.baseUrl)
      throw new Error("로컬 엔드포인트 주소를 입력해 주세요.");
    if (field("model"))
      applySimpleTextModel(
        editingSettings,
        "local",
        pick(field("model").value, p.model || ""),
      );
    else p.model = field("localModel").value.trim();
  } else {
    if (field("model"))
      applySimpleTextModel(
        editingSettings,
        engine,
        pick(field("model").value, "__stages"),
      );
    else {
      const current = getStoryStageModels(engine, p),
        medium = pick(field("medium").value, current.medium),
        upper = pick(field("upper").value, current.upper);
      p.stageModels = {
        medium: resolveTextModel(engine, medium, p),
        upper: resolveTextModel(engine, upper, p),
      };
    }
    const value = field("proxyEndpoint").value.trim(),
      proxy = validate ? checkedUrl(value) : value;
    if (proxy) {
      p.proxyEndpoint = proxy;
      p.transport = "proxy";
    } else {
      delete p.proxyEndpoint;
      delete p.transport;
    }
  }
}
/**
 * Keep a fetched list in the saved settings and the active World's copy
 * (IDs, names and fetchedAt only). Restores both and throws when `save` fails.
 */
export function storeFetchedTextModels(state, engine, list, save) {
  const world = getActiveWorld(state),
    before = clone(state.settings.textGeneration ?? null),
    worldBefore = clone(world.textGeneration ?? null);
  for (const target of [
    (state.settings.textGeneration ||= {}),
    world.textGeneration,
  ].filter(Boolean)) {
    target.providers ||= {};
    target.providers[engine] = {
      ...target.providers[engine],
      fetchedModels: clone(list),
    };
  }
  if (save() === false) {
    if (before === null) delete state.settings.textGeneration;
    else state.settings.textGeneration = before;
    if (worldBefore === null) delete world.textGeneration;
    else world.textGeneration = worldBefore;
    throw new Error("불러온 모델 목록을 저장하지 못했어요.");
  }
}
/**
 * Fetch one provider's text models with the saved settings (③ and others
 * outside the settings form). The saved key or the saved proxy is used.
 */
export async function fetchAndStoreTextModels(state, engine, save) {
  const config = getTextGenerationSettings(state).providers[engine] || {},
    proxy = config.proxyEndpoint || config.transport === "proxy",
    apiKey = engine === "local" || proxy ? null : await getCredential(engine);
  if (engine !== "local" && !proxy && !apiKey)
    throw new Error(
      `먼저 ${NAMES[engine]} API 비밀 키를 저장해 주세요. 목록 불러오기는 저장된 키로만 해요.`,
    );
  const list = await fetchProviderModels({
    kind: "text",
    engine,
    config: { ...config, apiKey },
  });
  storeFetchedTextModels(state, engine, list, save);
  return list;
}
/**
 * R13 '모델 목록 불러오기': a free list call (no tokens) with the saved key or
 * the provider's proxy. Only IDs, names and fetchedAt are stored, never the
 * key; the selection does not change. On an error nothing changes.
 */
async function fetchTextModels(container, engine, button) {
  if (!editingSettings)
    editingSettings = getTextGenerationSettings(api.getState());
  readProviders();
  const config = editingSettings.providers[engine] || {},
    proxy = config.proxyEndpoint || config.transport === "proxy",
    status = container.querySelector("[data-text-model-status]");
  button.disabled = true;
  if (status) status.textContent = "모델 목록을 불러오는 중이에요…";
  try {
    const apiKey =
      engine === "local" || proxy ? null : await getCredential(engine);
    if (engine !== "local" && !proxy && !apiKey)
      throw new Error(
        `먼저 ${NAMES[engine]} API 비밀 키를 저장해 주세요. 목록 불러오기는 저장된 키로만 해요.`,
      );
    const list = await fetchProviderModels({
      kind: "text",
      engine,
      config: { ...config, apiKey },
    });
    storeFetchedTextModels(api.getState(), engine, list, () => api.save());
    editingSettings.providers[engine].fetchedModels = clone(list);
    // Redraw this provider's selects with the new list; keep a typed key.
    const key = container.querySelector('[data-text-field="apiKey"]')?.value;
    container.innerHTML = providerFields(
      editingSettings,
      engine,
      container.dataset.textPrefix,
      { simple: container.dataset.textSimple === "1" },
    );
    const keyField = container.querySelector('[data-text-field="apiKey"]');
    if (keyField && key) keyField.value = key;
    refreshCredentialLabels();
    api.toast(
      `${NAMES[engine]}에서 글 모델 ${list.models.length}개를 불러왔어요. 목록 불러오기는 요금이 들지 않아요.`,
    );
  } catch (error) {
    if (status?.isConnected) status.textContent = error.message;
    throw error;
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}
function readProviders(validate = false) {
  for (const container of document.querySelectorAll(
    "#text-engine-form [data-text-provider]",
  ))
    readProvider(container, {
      validate: validate && !container.closest("#tg-hybrid-fields[hidden]"),
    });
}
function updatePriceSummary() {
  const el = document.querySelector("#tg-price-summary");
  if (el) el.innerHTML = priceSummary(editingSettings);
}
function redrawFinal() {
  document.querySelector("#tg-final-provider-fields").innerHTML =
    finalProviderFields(editingSettings);
  document.querySelector("#tg-hybrid-local-fields").innerHTML =
    hybridLocalFields(editingSettings);
}
export function configureTextSettingsUI(context) {
  api = context;
  if (configured) return;
  configured = true;
  document.addEventListener("change", (event) => {
    if (!api.isParent() || !event.target.closest("#text-engine-form")) return;
    // R13 simple select: '모델 목록 불러오기 · 무료…' runs the free list call
    // and puts the select back on the model it showed.
    if (
      event.target.matches('[data-text-field="model"]') &&
      event.target.value === "__fetch"
    ) {
      const select = event.target,
        container = select.closest("[data-text-provider]");
      select.value = select.dataset.current ?? "";
      api.protectedAction(async () => {
        try {
          await fetchTextModels(
            container,
            container.dataset.textProvider,
            select,
          );
        } catch (error) {
          showError(error);
        }
      });
      return;
    }
    if (
      event.target.matches('[data-text-field="model"]') &&
      event.target.value !== "__custom"
    )
      event.target.dataset.current = event.target.value;
    try {
      if (!editingSettings)
        editingSettings = getTextGenerationSettings(api.getState());
      readProviders();
      if (event.target.id === "tg-engine") {
        editingSettings.engine = event.target.value;
        document.querySelector("#tg-provider-fields").innerHTML = providerPanel(
          editingSettings,
          editingSettings.engine,
          "tg",
          isQuickForm(),
        );
        redrawFinal();
      } else if (event.target.id === "tg-final-engine") {
        editingSettings.hybrid.finalEngine = event.target.value;
        redrawFinal();
      } else if (event.target.id === "tg-hybrid") {
        editingSettings.hybrid.enabled = event.target.checked;
        document.querySelector("#tg-hybrid-fields").hidden =
          !event.target.checked;
      } else if (event.target.id === "tg-story-enrichment") {
        editingSettings.storyEnrichment = event.target.checked;
      } else if (event.target.id === "tg-image-diversity") {
        editingSettings.imageDiversity = event.target.checked;
      } else if (event.target.id === "tg-review-upper") {
        if (event.target.checked) editingSettings.reviewTier = "upper";
        else delete editingSettings.reviewTier;
      } else if (event.target.id === "tg-orchestration") {
        if (event.target.checked) delete editingSettings.orchestration;
        else editingSettings.orchestration = false;
      } else if (event.target.id === "tg-writer-upper") {
        if (event.target.checked) editingSettings.writerTier = "upper";
        else delete editingSettings.writerTier;
      } else if (
        event.target.matches(
          '[data-text-field="medium"],[data-text-field="upper"],[data-text-field="model"]',
        )
      ) {
        const container = event.target.closest("[data-text-provider]"),
          engine = container.dataset.textProvider,
          level = event.target.dataset.textField,
          custom = container.querySelector('[data-text-field="customModel"]'),
          price = container.querySelector(`[data-text-price="${level}"]`);
        // R13: '직접 입력…' shows the ID field under the selects.
        if (custom) {
          custom.hidden = ![
            ...container.querySelectorAll("select[data-text-field]"),
          ].some((select) => select.value === "__custom");
          if (event.target.value === "__custom") custom.focus?.();
        }
        if (price)
          price.innerHTML =
            event.target.value === "__custom"
              ? '<p class="small-label">아래 칸에 모델 ID를 입력하면 저장할 때 목록에 더해요. 목록에 없는 모델은 요금 정보 없음으로 표시해요.</p>'
              : modelDetails(
                  engine,
                  event.target.value,
                  editingSettings.providers[engine],
                );
      }
      updatePriceSummary();
    } catch (error) {
      showError(error);
    }
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-text-setting]");
    if (!button) return;
    event.preventDefault();
    api.protectedAction(async () => {
      try {
        const container = button.closest("[data-text-provider]"),
          engine = container.dataset.textProvider,
          field = container.querySelector('[data-text-field="apiKey"]');
        if (button.dataset.textSetting === "fetch-models") {
          await fetchTextModels(container, engine, button);
          return;
        }
        if (button.dataset.textSetting === "save-key") {
          await saveCredential(engine, field.value);
          if (field.isConnected) field.value = "";
          api.toast("글·이미지에서 공유할 키를 암호화해 저장했어요.");
        } else {
          await removeCredential(engine);
          if (field) field.value = "";
          api.toast("이 공급자의 공유 키를 삭제했어요.");
        }
        refreshCredentialLabels();
        const error = document.querySelector("#tg-error");
        if (error) error.textContent = "";
      } catch (error) {
        showError(error);
      }
    });
  });
  document.addEventListener("submit", (event) => {
    if (event.target.id !== "text-engine-form") return;
    event.preventDefault();
    api.protectedAction(() => {
      try {
        if (!editingSettings)
          editingSettings = getTextGenerationSettings(api.getState());
        readProviders(true);
        const state = api.getState(),
          settings = clone(editingSettings);
        settings.engine = document.querySelector("#tg-engine").value;
        settings.storyEnrichment = document.querySelector(
          "#tg-story-enrichment",
        ).checked;
        settings.imageDiversity = document.querySelector(
          "#tg-image-diversity",
        ).checked;
        // R26: the quick form has no such box; it keeps the stored choice.
        const reviewUpper = document.querySelector("#tg-review-upper");
        if (reviewUpper) {
          if (reviewUpper.checked) settings.reviewTier = "upper";
          else delete settings.reviewTier;
        }
        // R29: 정성 모드 and the beat writer's model (kept when the form has no box).
        const orchestrationBox = document.querySelector("#tg-orchestration"),
          writerUpper = document.querySelector("#tg-writer-upper");
        if (orchestrationBox) {
          if (orchestrationBox.checked) delete settings.orchestration;
          else settings.orchestration = false;
        }
        if (writerUpper) {
          if (writerUpper.checked) settings.writerTier = "upper";
          else delete settings.writerTier;
        }
        settings.hybrid = {
          enabled: document.querySelector("#tg-hybrid").checked,
          finalEngine: document.querySelector("#tg-final-engine").value,
        };
        delete settings.storyQuality;
        state.settings.textGeneration = clone(settings);
        getActiveWorld(state).textGeneration = clone(settings);
        if (api.save()) {
          api.render();
          api.toast("이 World의 단계별 글 모델을 저장했어요.");
        }
      } catch (error) {
        showError(error);
      }
    });
  });
}
