/* Full Auto is a resumable client-side job. No credentials or engine responses are stored in job inputs. */
import {
  generateMaterialPlan,
  generateOutline,
  generateSceneBriefs,
  generateProse,
  enrichProse,
  paginateStory,
  repairPagination,
  reviewStoryCoherence,
  summarizeStory,
  inspectStory,
  preflightOutlineLocations,
  isHomeBackground,
} from "./story-generation/pipeline.js";
import {
  inspectAutoMaterialPlan,
  materializeAutoPlan,
  materialSignature,
} from "./story-generation/auto-materials.js";
import {
  getActiveWorld,
  getCharacterSheet,
  getWorldBackgroundSnapshot,
  markCharacterSheetConfirmed,
  captureBookGenerationSnapshot,
} from "./image-generation/world.js";
import {
  generateCharacterSheet,
  generateScene,
  generateCover,
} from "./image-generation/pipeline.js";
import {
  backgroundSheetRequest,
  backgroundSettingsKey,
} from "./background-sheets.js";
import { generateImage } from "./image-generation/providers.js";
import { saveImage } from "./image-generation/assets.js";
import { getCredential } from "./image-generation/vault.js";
import { getTextGenerationSettings } from "./text-generation/settings-ui.js";
import {
  resolveStoryStageSettings,
  resolveQualityStageSettings,
  estimateStoryTextCost,
  estimateTextCost,
} from "./text-generation/models.js";
import { estimateImageCost } from "./image-generation/models.js";
import { getStylePreset } from "./image-generation/styles.js";
import { inputFromWizard } from "./story-generation/ui.js";
import { layoutFor, textEstimateArgs } from "./book-layout.js";
import { freezeReadingLevels } from "./reading-levels.js";
import {
  applySeriesContinuity,
  bindSeriesBackgrounds,
} from "./story-generation/continuity.js";
import { safeTopic } from "./engine.js";
const clone = (value) => structuredClone(value),
  now = () => new Date().toISOString(),
  active = (list) => (list || []).filter((item) => !item.archivedAt);
const abort = (signal) => {
  if (signal?.aborted)
    throw new DOMException("FULL AUTO를 중지했어요.", "AbortError");
};
/** Where a run holds: 'text' before any sheet or image, 'pages' before page images, null runs to the end. */
export const FULL_AUTO_STOPS = Object.freeze(["text", "pages", null]);
const PLAN_MODES = ["auto", "selection"];
function checkStopBefore(value) {
  if (value === undefined || value === null) return null;
  if (!FULL_AUTO_STOPS.includes(value))
    throw Error(
      "자동 작업을 멈출 단계는 글(text)·그림 준비(pages) 중에서 골라 주세요.",
    );
  return value;
}
export function autoJobs(state) {
  return (state.fullAutoJobs ||= {});
}
/** The FULL AUTO job that built this book, if it still exists. Read-only lookup. */
export function fullAutoJobForBook(state, book) {
  const id = book?.fullAutoRunId;
  return (id && state?.fullAutoJobs?.[id]) || null;
}
/**
 * Free, deterministic material plan from the parent's own picks (no LLM call).
 * Keeps every picked character and place; fills a missing home or a second
 * non-home place from the drawer in drawer order. Throws a Korean error when
 * the drawer cannot satisfy inspectAutoMaterialPlan.
 */
export function selectionMaterialPlan(state, wizard = {}) {
  const characters = active(state.characters),
    backgrounds = active(state.backgrounds),
    pinned = [...new Set(wizard.characterIds || [])],
    chosen = [...new Set(wizard.backgroundIds || [])]
      .map((id) => backgrounds.find((b) => b.id === id))
      .filter(Boolean),
    filled = [],
    places = () => chosen.filter((b) => !isHomeBackground(b)).length;
  if (!chosen.some(isHomeBackground)) {
    const home = backgrounds.find(isHomeBackground);
    if (home) {
      chosen.push(home);
      filled.push(home);
    }
  }
  for (const background of backgrounds) {
    if (places() >= 2) break;
    if (!isHomeBackground(background) && !chosen.includes(background)) {
      chosen.push(background);
      filled.push(background);
    }
  }
  const errors = [];
  if (!chosen.some(isHomeBackground))
    errors.push(
      "시작과 마무리에 사용할 집·방 배경을 배경 서랍에 추가해 주세요.",
    );
  if (places() < 2)
    errors.push(
      "집·방 외에 이야기 중간에 사용할 서로 다른 배경 2곳이 필요해요. 배경 서랍에 장소를 추가해 주세요.",
    );
  if (chosen.length > 5)
    errors.push("장소는 집·방을 포함해 최대 5곳까지 골라 주세요.");
  if (errors.length) throw Error(errors.join("\n"));
  const plan = {
      reuseCharacterIds: [],
      newCharacters: [],
      reuseBackgroundIds: chosen.map((b) => b.id),
      newBackgrounds: [],
      reason:
        "고른 등장인물과 장소를 그대로 사용해요." +
        (filled.length
          ? ` 부족한 장소는 서랍에서 채웠어요: ${filled.map((b) => b.name).join(", ")}.`
          : ""),
    },
    checked = inspectAutoMaterialPlan(plan, {
      characters,
      backgrounds,
      pinnedCharacterIds: pinned,
      allowNew: false,
    });
  if (!checked.valid) throw Error(checked.errors.join("\n"));
  return { plan, filledBackgroundIds: filled.map((b) => b.id) };
}
export function createFullAutoJob(
  state,
  wizard,
  { allowNew = true, stopBefore = null, demo = false, planMode = "auto" } = {},
) {
  const hold = checkStopBefore(stopBefore);
  if (!PLAN_MODES.includes(planMode))
    throw Error("재료 계획 방식은 auto 또는 selection이어야 해요.");
  const check = safeTopic(wizard.topic);
  if (!check.ok) throw Error(check.message || "주제를 적어 주세요.");
  const selected = [...new Set(wizard.characterIds || [])];
  if (
    !selected.length ||
    selected.length > 5 ||
    selected.some((id) => !active(state.characters).some((c) => c.id === id))
  )
    throw Error("주인공을 포함해 1~5명을 골라 주세요.");
  if (
    (wizard.value === "custom" && !wizard.valueCustom?.trim()) ||
    (wizard.ending === "custom" && !wizard.endingCustom?.trim())
  )
    throw Error("직접 선택한 가치와 결말을 채워 주세요.");
  // Demo never asks a model to plan; the parent's picks become the plan.
  const isDemo = demo === true,
    mode = isDemo ? "selection" : planMode;
  if (mode === "selection")
    selectionMaterialPlan(state, { ...wizard, characterIds: selected });
  // R12: the layout is decided once, here, and frozen in job.input.
  const prepared = inputFromWizard(
      state,
      {
        ...wizard,
        characterIds: selected,
      },
      { layout: layoutFor(wizard) },
    ),
    world = getActiveWorld(state),
    previous = state.books.find(
      (b) => b.id === wizard.previousBookId,
    )?.generationSnapshot;
  if (
    previous &&
    (previous.worldId !== world.id || previous.worldRevision !== world.revision)
  )
    throw Error(
      "이전 편을 만든 World와 현재 설정이 달라요. 같은 World 설정으로 돌아오거나 단계별 만들기를 사용해 주세요.",
    );
  const job = {
    id: "auto-" + crypto.randomUUID(),
    bookId: "book-" + crypto.randomUUID(),
    storyDraftId: "story-" + crypto.randomUUID(),
    status: "ready",
    phase: "준비",
    wizard: clone({ ...wizard, characterIds: selected }),
    input: clone(prepared.input),
    readingLevels: clone(prepared.readingLevels),
    worldId: world.id,
    worldRevision: world.revision,
    imageEngine: world.imageEngine,
    stylePresetId: world.stylePresetId,
    worldSnapshot: clone(world),
    initialSignatures: Object.fromEntries(
      selected.map((id) => {
        const c = state.characters.find((c) => c.id === id);
        return [id, materialSignature(c)];
      }),
    ),
    textSettings: clone(getTextGenerationSettings(state)),
    allowNew,
    stopBefore: hold,
    demo: isDemo,
    planMode: mode,
    completed: {},
    usage: { calls: [] },
    imageUsage: {},
    notes: [],
    createdAt: now(),
    updatedAt: now(),
  };
  job.input.bookId = job.bookId;
  job.input.storyDate = job.createdAt;
  autoJobs(state)[job.id] = job;
  return job;
}
/**
 * Reference estimate. Extra fields for the simple flow: textUsd (all text,
 * including the paid material plan unless planMode is 'selection' or demo),
 * imageUnitUsd (one final page image), imagesUsd (every page + cover) and
 * sheetsUpperUsd (at most 10 new sheets). Called with two arguments the
 * original fields are unchanged.
 */
export function estimateFullAutoCost(
  state,
  wizard,
  { planMode = "auto", demo = false, imageEngine } = {},
) {
  const world = getActiveWorld(state),
    settings = getTextGenerationSettings(state),
    text = estimateStoryTextCost({
      settings,
      pageCount: wizard.pageCount || 12,
      // R12: an openings wizard is sized from its v4 specs ({} for page books).
      ...textEstimateArgs(wizard, freezeReadingLevels),
    }),
    plan = resolveStoryStageSettings(settings, "outline"),
    planning = estimateTextCost({
      ...plan,
      input: 11000,
      output: 5000,
      model: plan.config.model,
    }),
    engine = imageEngine || world.imageEngine,
    config = world.providerConfig?.[engine] || {},
    unit = estimateImageCost({
      engine,
      quality: "final",
      size: "1536x1024",
      config,
    }).costUsd,
    pages = Number(wizard.pageCount) || 12,
    freePlan = demo === true || planMode === "selection",
    textUsd =
      demo === true ? 0 : text.costUsd + (freePlan ? 0 : planning.costUsd);
  return {
    baseUsd: textUsd + (pages + 1) * unit,
    withMaterialsAndRetryUsd: textUsd + (pages * 2 + 11) * unit,
    imageEngine: engine,
    pageCount: pages,
    requests: demo === true ? 0 : text.requestCount + (freePlan ? 0 : 1),
    note: "참고 단가 추정 · 새 시트 최대 10장과 유사 그림 1회 재생성 포함 상단 · 글 자동 수정·입력 참조 요금 별도",
    textUsd,
    imageUnitUsd: unit,
    imagesUsd: (pages + 1) * unit,
    sheetsUpperUsd: 10 * unit,
  };
}
export async function preflightFullAuto(state, job) {
  if (!job.allowNew) {
    const places = preflightOutlineLocations({
      backgrounds: active(state.backgrounds),
    });
    if (!places.valid) throw Error(places.errors.join("\n"));
  }
  const engines = new Map();
  // Demo text needs no key; it is chosen explicitly and never replaces a failed engine.
  for (const stage of job.demo
    ? []
    : [
        "outline",
        "sceneBriefs",
        "proseDraft",
        "prose",
        "enrichment",
        "pagination",
      ]) {
    if (stage === "proseDraft" && !job.textSettings.hybrid?.enabled) continue;
    const selected = resolveStoryStageSettings(job.textSettings, stage);
    engines.set(selected.engineId, selected.config);
  }
  if (job.input.storyQuality?.enabled && !job.demo)
    for (const role of ["outline", "prose", "cheap"]) {
      const selected = resolveQualityStageSettings(
        job.textSettings,
        role,
        job.input.storyQuality,
      );
      engines.set(selected.engineId, selected.config);
    }
  for (const [engine, config] of engines) {
    if (
      engine === "local" ||
      config.proxyEndpoint ||
      config.transport === "proxy"
    )
      continue;
    if (!(await getCredential(engine)))
      throw Error(`${engine} 글 엔진의 API 키를 부모 설정에 저장해 주세요.`);
  }
  // A text-only hold buys no sheet or image, so it needs no image key yet.
  if (job.stopBefore === "text") return;
  const world = getActiveWorld(state),
    config = world.providerConfig?.[job.imageEngine] || {};
  if (
    !["local", "sample"].includes(job.imageEngine) &&
    !config.proxyEndpoint &&
    config.transport !== "proxy" &&
    !(await getCredential(job.imageEngine))
  )
    throw Error("이미지 엔진의 API 키를 부모 설정에 저장해 주세요.");
  if (job.imageEngine === "local" && (!config.endpoint || !config.workflow))
    throw Error(
      "ComfyUI 엔드포인트와 참조 이미지를 사용하는 워크플로를 부모 설정에 저장해 주세요.",
    );
}
async function generateAutoBackground(state, background, { signal } = {}) {
  const world = getActiveWorld(state),
    config = {
      ...(state.settings.imageProviderConfig?.[world.imageEngine] || {}),
      ...(world.providerConfig?.[world.imageEngine] || {}),
    };
  delete config.apiKey;
  delete config.key;
  if (!config.proxyEndpoint && config.transport !== "proxy")
    config.apiKey = await getCredential(world.imageEngine);
  const request = backgroundSheetRequest(state, background, {
      quality: "final",
    }),
    result = await generateImage(request, {
      engine: world.imageEngine,
      config: { ...config, signal },
    }),
    asset = await saveImage(result.imageUrl, { signal });
  return {
    imageAssetId: asset.assetId,
    imageUrl: "asset:" + asset.assetId,
    seed: result.seed ?? null,
    meta: {
      ...result.meta,
      requestedSeed: request.seed,
      quality: "final",
      source: "app-background-sheet",
      autoGenerated: true,
      worldId: world.id,
      worldRevision: world.revision,
      imageEngine: world.imageEngine,
      stylePresetId: world.stylePresetId,
    },
  };
}
const DEFAULT_OPS = {
  plan: generateMaterialPlan,
  outline: generateOutline,
  briefs: generateSceneBriefs,
  prose: generateProse,
  enrichment: enrichProse,
  pagination: paginateStory,
  repairPagination,
  coherence: reviewStoryCoherence,
  characterSheet: generateCharacterSheet,
  backgroundSheet: generateAutoBackground,
  scene: generateScene,
  cover: generateCover,
  preflight: preflightFullAuto,
  prepare: inputFromWizard,
};
export function fullAutoPayload(job) {
  const prose = job.input.storyQuality?.enabled
    ? resolveQualityStageSettings(
        job.textSettings,
        "prose",
        job.input.storyQuality,
      )
    : resolveStoryStageSettings(job.textSettings, "prose");
  return {
    id: job.storyDraftId,
    bookId: job.bookId,
    wizard: clone(job.wizard),
    input: clone(job.input),
    outline: clone(job.outline),
    sceneBriefs: clone(job.sceneBriefs || []),
    prose: clone(job.prose),
    proseCoherence: clone(job.proseCoherence || null),
    pageCoherence: clone(job.pageCoherence || null),
    childGate: clone(job.childGate || null),
    pagination: clone(job.pagination),
    richnessCheck: clone(job.richnessCheck || null),
    textSettings: clone(job.textSettings),
    textEngineId: job.demo ? "demo" : prose.engineId,
    textModelId: job.demo ? "demo" : prose.config.model,
    summaryForNext: summarizeStory(job.outline, {
      ...job.input,
      prose: job.prose,
      pagination: job.pagination,
    }),
    readingLevels: clone(job.readingLevels),
    usage: clone(job.usage),
    storyCheck: clone(job.storyCheck || {}),
    demo: job.demo === true,
    worldId: job.worldId,
    worldSnapshot: clone(job.worldSnapshot),
  };
}
function recordUsage(job, result, callId) {
  if (!result?.usage || result.meta?.requests === 0) return;
  const row = {
      ...clone(result.usage),
      ...clone(result.meta || {}),
      callId,
      at: now(),
    },
    index = job.usage.calls.findIndex((c) => c.callId === callId);
  if (index < 0) job.usage.calls.push(row);
  else job.usage.calls[index] = row;
}
function recordImage(job, result) {
  if (!result) return;
  const add = (id, meta) => {
    if (id && meta)
      job.imageUsage[id] = {
        imageAssetId: id,
        engine: meta.engine || meta.imageEngine || job.imageEngine,
        costUsd: meta.costUsd ?? null,
        costUsdEstimated: meta.costUsdEstimated ?? null,
        quality: meta.quality,
        generatedAt: meta.generatedAt || now(),
      };
  };
  add(result.imageAssetId, result.meta || result.imageMeta);
  for (const old of result.imageHistory || [])
    add(old.imageAssetId, old.imageMeta);
}
/** Upsert one usage row into the job by callId (rows without a callId are appended). */
function upsertJobUsage(job, row) {
  const calls = ((job.usage ||= { calls: [] }).calls ||= []),
    index = row.callId ? calls.findIndex((c) => c.callId === row.callId) : -1;
  if (index < 0) calls.push(clone(row));
  else calls[index] = clone(row);
}
/** Keep a usage row for paid text work done on a FULL AUTO book outside runFullAuto (upsert by callId). */
export function recordFullAutoBookUsage(state, book, row) {
  const job = fullAutoJobForBook(state, book);
  if (!job || !row) return false;
  upsertJobUsage(job, row);
  job.updatedAt = now();
  return true;
}
/**
 * Drawing a page or the cover first buys a coherence review when the text
 * changed; generateScene records it on book.textUsage. Copy the rows added
 * since `from` into the job, as generateBookPageImage does.
 */
function copyNewBookTextUsage(job, from) {
  for (const row of (job.book?.textUsage?.calls || []).slice(from))
    upsertJobUsage(job, row);
}
const bookTextCalls = (job) => job.book?.textUsage?.calls?.length || 0;
/** Draw a page or the cover and keep any review it bought on the job, exactly once. */
async function withBookTextUsage(job, draw) {
  const from = bookTextCalls(job);
  try {
    return await draw();
  } catch (error) {
    // A failed paid review is already on book.textUsage and copied below; the step must not add it again.
    if (error && typeof error === "object" && bookTextCalls(job) > from)
      try {
        error.usageRecorded = true;
      } catch {
        /* A read-only error object keeps its own usage. */
      }
    throw error;
  } finally {
    copyNewBookTextUsage(job, from);
  }
}
/** Drop a text-edit stale mark together with the image it was bound to. */
export function clearPageImageStale(page) {
  if (!page) return;
  delete page.imageStale;
  delete page.imageStaleAt;
  delete page.imageStaleAssetId;
}
/**
 * True only while the page still shows the image its text was edited under
 * (page.imageStaleAssetId). A redraw by any path (pro editor, all pages, a
 * page tool) replaces that image, so a leftover mark is dropped here instead
 * of buying the page again.
 */
export function isPageImageStale(page) {
  if (
    !page ||
    (page.imageStale === undefined &&
      page.imageStaleAt === undefined &&
      page.imageStaleAssetId === undefined)
  )
    return false;
  const current = page.imageAssetId || page.imageUrl || null;
  if (
    page.imageStale === true &&
    current !== null &&
    current === page.imageStaleAssetId
  )
    return true;
  clearPageImageStale(page);
  return false;
}
/** Keep an image generated on a FULL AUTO book outside runFullAuto in the job's image usage. */
export function recordFullAutoBookImage(state, book, result) {
  const job = fullAutoJobForBook(state, book);
  if (!job || !result) return false;
  job.imageUsage ||= {};
  recordImage(job, result);
  job.updatedAt = now();
  return true;
}
/** Text step keys a job will run, in order; used for the progress fraction. */
function textStepKeys(job) {
  const quality = !!job.input?.storyQuality?.enabled;
  return [
    "plan",
    "input",
    "outline",
    "briefs",
    ...(job.textSettings?.hybrid?.enabled && !quality ? ["proseDraft"] : []),
    "prose",
    ...(job.textSettings?.storyEnrichment !== false && !quality
      ? ["enrichment"]
      : []),
    ...(job.outline && !job.outline.plotContract ? [] : ["proseCoherence"]),
    "pagination",
  ];
}
const finalImage = (page) =>
  !!page?.imageAssetId &&
  page.imageMeta?.quality === "final" &&
  !isPageImageStale(page);
/**
 * {done, total, fraction} for the part of the run the current hold covers:
 * completed text step keys, then one step for sheets + the frozen snapshot,
 * then every page image and the cover.
 */
export function fullAutoProgress(job) {
  const keys = textStepKeys(job);
  let done = keys.filter((key) => job.completed?.[key]).length,
    total = keys.length;
  if (job.stopBefore !== "text") {
    total += 1;
    if (job.book?.generationSnapshot) done += 1;
  }
  if (!job.stopBefore) {
    const pages = job.book?.pages || [];
    total += (pages.length || Number(job.input?.pageCount) || 12) + 1;
    done +=
      pages.filter(finalImage).length + (job.book?.cover?.imageAssetId ? 1 : 0);
  }
  return { done, total, fraction: total ? Math.min(1, done / total) : 0 };
}
function assertJobWorld(state, job) {
  const world = getActiveWorld(state);
  if (
    world.id !== job.worldId ||
    world.revision !== job.worldRevision ||
    world.imageEngine !== job.imageEngine ||
    world.stylePresetId !== job.stylePresetId
  )
    throw Error(
      "World 설정이 바뀌었어요. 원래 World 설정으로 돌아온 뒤 이어 만들거나 새 FULL AUTO를 시작해 주세요.",
    );
  for (const [id, signature] of Object.entries({
    ...job.initialSignatures,
    ...job.plan?.existingSignatures,
    ...job.plan?.materialSignatures,
  })) {
    const item = [...state.characters, ...state.backgrounds].find(
      (x) => x.id === id,
    );
    if (!item || materialSignature(item) !== signature)
      throw Error(
        "사용 중인 기존 재료가 수정·삭제되었어요. 완성한 부분을 검토하거나 새 FULL AUTO를 시작해 주세요.",
      );
  }
}
/**
 * A text hold builds the book before any sheet exists. Series continuity needs
 * the cast's confirmed sheets, so the book is built with the same series name
 * and the continuity snapshot is applied when the hold is released.
 */
function textHoldPayload(state, job, payload) {
  const previous = state.books.find(
    (b) => b.id === payload.wizard?.previousBookId,
  );
  if (!previous) return payload;
  job.seriesContinuityDeferred = true;
  return {
    ...payload,
    wizard: {
      ...payload.wizard,
      previousBookId: null,
      series: payload.wizard.series || previous.series,
    },
  };
}
/**
 * A held series book is built without the previous book (no sheets yet), so
 * name the link on the book itself: the series and previousBookId stay
 * visible to every later screen while the continuity snapshot waits for the
 * release to 'pages' (ensureJobSnapshot).
 */
function linkDeferredSeries(state, job) {
  if (!job.seriesContinuityDeferred || !job.book) return;
  const previous = state.books.find((b) => b.id === job.wizard.previousBookId);
  if (!previous) return;
  job.book.previousBookId = previous.id;
  job.book.series ||= job.wizard.series || previous.series;
}
/** Freeze the book's generation snapshot once, after the sheets it references exist. */
function ensureJobSnapshot(state, job) {
  const book = job.book;
  if (book.generationSnapshot) return book.generationSnapshot;
  const previous = job.seriesContinuityDeferred
    ? state.books.find((b) => b.id === job.wizard.previousBookId)
    : null;
  if (previous)
    applySeriesContinuity(state, book, previous, {
      ...job.wizard,
      pageCount: book.pages.length,
      koreanLevel: job.readingLevels?.koreanLevel,
      englishLevel: job.readingLevels?.englishLevel,
      characterVariants: book.characterVariants,
      variantPageRanges: book.variantPageRanges,
    });
  else {
    if (job.seriesContinuityDeferred)
      job.notes.push(
        "이전 편을 찾지 못해 현재 World 설정으로 그림을 준비했어요.",
      );
    captureBookGenerationSnapshot(state, book);
    book.generationSnapshot.backgroundReferenceByPage = bindSeriesBackgrounds(
      book,
      book.generationSnapshot.backgrounds || [],
    );
  }
  delete job.seriesContinuityDeferred;
  return book.generationSnapshot;
}
export async function runFullAuto(
  state,
  job,
  {
    signal,
    save = () => true,
    onProgress = () => {},
    buildBook,
    operations = {},
  } = {},
) {
  const ops = { ...DEFAULT_OPS, ...operations };
  if (job.status === "running")
    throw Error("이 자동 작업이 이미 실행 중이에요.");
  // An unknown hold must never fall through to buying images.
  const hold = checkStopBefore(job.stopBefore);
  const persist = async () => {
    job.updatedAt = now();
    if ((await save()) === false)
      throw Error("자동 작업을 저장하지 못했어요. 저장 공간을 확인해 주세요.");
  };
  const report = (message) =>
    onProgress({ job, message, phase: job.phase, ...fullAutoProgress(job) });
  // A stop that lands during the preflight or a save is honoured here too, not
  // only at the next step: the job ends 'paused', never in a hold a page tool may buy from.
  const holdAt = async (status, message) => {
    abort(signal);
    job.status = status;
    job.phase = message;
    job.currentStep = null;
    job.error = null;
    await persist();
    abort(signal);
    report(message);
    return job.book;
  };
  const demoEngine = () => ({ engineId: "demo", config: {} });
  const step = async (key, label, operation, apply) => {
    if (job.completed[key]) return;
    abort(signal);
    assertJobWorld(state, job);
    job.phase = label;
    job.currentStep = key;
    job.operationSequence = (job.operationSequence || 0) + 1;
    const callId = job.id + ":" + job.operationSequence;
    await persist();
    report(label);
    const textOptions = (stage) => ({
      ...(job.demo
        ? demoEngine()
        : resolveStoryStageSettings(job.textSettings, stage)),
      signal,
      qualityEngines: Object.fromEntries(
        ["outline", "prose", "cheap"].map((role) => [
          role,
          job.demo
            ? demoEngine()
            : resolveQualityStageSettings(
                job.textSettings,
                role,
                job.input.storyQuality || {},
              ),
        ]),
      ),
      qualityCheckpoint: job.qualityCheckpoint,
      childGateCheckpoint: job.childGateCheckpoint,
      proseCoherence: job.proseCoherence,
      pageCoherence: job.pageCoherence,
      coherenceOptions: job.demo
        ? demoEngine()
        : resolveStoryStageSettings(job.textSettings, "coherence"),
      sceneBriefs: job.sceneBriefs,
      bookId: job.bookId,
      stylePreset: getStylePreset(job.stylePresetId),
      storyEnrichment: job.textSettings.storyEnrichment !== false,
      richness: job.textSettings.storyEnrichment !== false,
      enrichmentCheckpoint: job.enrichmentCheckpoint,
      onProgress: (p) => report(p.message || label),
      onCheckpoint: async (cp) => {
        if (cp.qualityCheckpoint)
          job.qualityCheckpoint = clone(cp.qualityCheckpoint);
        if (cp.childGateCheckpoint)
          job.childGateCheckpoint = clone(cp.childGateCheckpoint);
        if (cp.coherence) {
          if (cp.coherence.stage === "pages")
            job.pageCoherence = clone(cp.coherence);
          else job.proseCoherence = clone(cp.coherence);
        }
        if (cp.sceneBriefs) job.sceneBriefs = clone(cp.sceneBriefs);
        if (cp.prose) job.prose = clone(cp.prose);
        if (cp.enrichmentCheckpoint)
          job.enrichmentCheckpoint = clone(cp.enrichmentCheckpoint);
        if (cp.pagination) job.pagination = clone(cp.pagination);
        if (cp.checks) job.storyCheck = clone(cp.checks);
        if (cp.richnessChecks) job.richnessCheck = clone(cp.richnessChecks);
        recordUsage(job, cp, callId);
        await persist();
        abort(signal);
      },
    });
    try {
      const result = await operation(textOptions);
      recordUsage(job, result, callId);
      if (apply) await apply(result);
      job.completed[key] = now();
      await persist();
      abort(signal);
    } catch (error) {
      if (error.coherence) {
        if (error.coherence.stage === "pages")
          job.pageCoherence = clone(error.coherence);
        else job.proseCoherence = clone(error.coherence);
      }
      if (error.qualityCheckpoint)
        job.qualityCheckpoint = clone(error.qualityCheckpoint);
      if (error.childGateCheckpoint)
        job.childGateCheckpoint = clone(error.childGateCheckpoint);
      if (error.prose) job.prose = clone(error.prose);
      if (error.pagination) job.pagination = clone(error.pagination);
      if (error.usage && !error.usageRecorded)
        recordUsage(
          job,
          { usage: error.usage, meta: { ...error.meta, failed: true } },
          callId,
        );
      throw error;
    }
  };
  try {
    assertJobWorld(state, job);
    abort(signal);
    await ops.preflight(state, job);
    // A stop pressed during the preflight's key reads ends the run here, 'paused'.
    abort(signal);
    job.status = "running";
    job.error = null;
    await persist();
    const selectionPlan = job.planMode === "selection" || job.demo;
    await step(
      "plan",
      selectionPlan
        ? "고른 등장인물·배경 확인"
        : "주제에 맞는 등장인물·배경 고르기",
      (opts) =>
        selectionPlan
          ? {
              data: selectionMaterialPlan(state, job.wizard).plan,
              usage: { input: 0, output: 0, costUsd: 0, costUsdEstimated: 0 },
              meta: { stage: "materials", requests: 0, selection: true },
            }
          : ops.plan(
              job.input,
              {
                characters: active(state.characters),
                backgrounds: active(state.backgrounds),
                allowNew: job.allowNew,
              },
              opts("outline"),
            ),
      (result) => {
        const catalog = {
            characters: active(state.characters),
            backgrounds: active(state.backgrounds),
            pinnedCharacterIds: job.wizard.characterIds,
            allowNew: job.allowNew,
          },
          checked = inspectAutoMaterialPlan(result.data, catalog);
        if (!checked.valid) throw Error(checked.errors.join("\n"));
        job.plan = materializeAutoPlan(result.data, job, catalog);
      },
    );
    assertJobWorld(state, job);
    for (const character of job.plan.newCharacters) {
      if (!state.characters.some((c) => c.id === character.id))
        state.characters.push(clone(character));
    }
    for (const bg of job.plan.newBackgrounds) {
      if (!state.backgrounds.some((b) => b.id === bg.id))
        state.backgrounds.push(clone(bg));
    }
    await persist();
    // A text hold buys no sheet; releasing it buys only the sheets still missing.
    const buySheets = hold !== "text";
    for (const id of buySheets ? job.plan.characterIds : []) {
      const character = state.characters.find((c) => c.id === id);
      if (!character || character.archivedAt)
        throw Error("선택한 캐릭터가 없어 작업을 중지했어요.");
      if (getCharacterSheet(state, id)) continue;
      await step(
        "character:" + id,
        character.name + " 캐릭터 시트 만들기",
        () =>
          ops.characterSheet(state, character, { quality: "final", signal }),
        (result) => {
          markCharacterSheetConfirmed(state, id, {
            ...result,
            meta: { ...result.meta, autoGenerated: true, autoRunId: job.id },
          });
          character.autoReviewPending = true;
          recordImage(job, result);
        },
      );
    }
    for (const id of buySheets ? job.plan.backgroundIds : []) {
      const background = state.backgrounds.find((b) => b.id === id);
      if (!background || background.archivedAt)
        throw Error("선택한 배경이 없어 작업을 중지했어요.");
      const selected = getWorldBackgroundSnapshot(state, background);
      if (selected.imageAssetId || selected.imageUrl) continue;
      if (job.imageEngine === "sample") {
        if (
          !job.notes.includes(
            "무료 샘플은 배경 시트를 생성하지 않으며 본문도 고정 그림 템플릿이에요.",
          )
        )
          job.notes.push(
            "무료 샘플은 배경 시트를 생성하지 않으며 본문도 고정 그림 템플릿이에요.",
          );
        continue;
      }
      await step(
        "background:" + id,
        background.name + " 고정 배경 시트 만들기",
        () => ops.backgroundSheet(state, background, { signal }),
        (result) => {
          const world = getActiveWorld(state),
            meta = {
              ...result.meta,
              autoGenerated: true,
              autoRunId: job.id,
              worldId: world.id,
              worldRevision: world.revision,
              imageEngine: world.imageEngine,
              stylePresetId: world.stylePresetId,
              quality: "final",
            },
            sheet = {
              ...clone(result),
              id: result.imageAssetId,
              meta,
              settings: backgroundSettingsKey(background),
              confirmedAt: now(),
            };
          (background.backgroundSheets ||= []).push(sheet);
          Object.assign(background, {
            imageAssetId: sheet.imageAssetId,
            imageUrl: sheet.imageUrl,
            backgroundSheetMeta: meta,
            backgroundSheetSettingsKey: sheet.settings,
            backgroundSheetConfirmedAt: sheet.confirmedAt,
            autoReviewPending: true,
          });
          recordImage(job, sheet);
        },
      );
    }
    if (!job.completed.input) {
      job.wizard.characterIds = clone(job.plan.characterIds);
      job.wizard.backgroundIds = clone(job.plan.backgroundIds);
      // The layout comes from the job's frozen input, never from the wizard or the
      // current flag: a pre-R12 job stays a page book with its own page count.
      const frozenLayout =
          job.input?.layoutPolicy?.kind === "openings"
            ? job.input.layoutPolicy
            : null,
        prepared = ops.prepare(state, job.wizard, {
          layout: frozenLayout ? "openings" : "pages",
        });
      job.input = {
        ...prepared.input,
        ...(frozenLayout ? { layoutPolicy: clone(frozenLayout) } : {}),
        backgrounds: prepared.input.backgrounds.filter((b) =>
          job.plan.backgroundIds.includes(b.id),
        ),
        preferredBackgroundIds: clone(job.plan.backgroundIds),
        specs: clone(job.readingLevels.specs),
        bookId: job.bookId,
        storyDate: job.input.storyDate || job.createdAt,
      };
      job.plan.materialSignatures = Object.fromEntries(
        [
          ...job.plan.characterIds.map((id) =>
            state.characters.find((c) => c.id === id),
          ),
          ...job.plan.backgroundIds.map((id) =>
            state.backgrounds.find((b) => b.id === id),
          ),
        ].map((item) => [item.id, materialSignature(item)]),
      );
      job.completed.input = now();
      await persist();
    }
    await step(
      "outline",
      "줄거리 만들기",
      (opts) => ops.outline(job.input, opts("outline")),
      (r) => {
        job.outline = r.data;
        job.input.title = r.data.titleCandidates[0];
      },
    );
    await step(
      "briefs",
      "장면 디테일 만들기",
      (opts) => ops.briefs(job.outline, job.input, opts("sceneBriefs")),
      (r) => (job.sceneBriefs = r.data),
    );
    if (job.textSettings.hybrid?.enabled && !job.input.storyQuality?.enabled)
      await step(
        "proseDraft",
        "로컬 전문 초안 쓰기",
        (opts) => ops.prose(job.outline, job.input, opts("proseDraft")),
        (r) => (job.localDraftProse = r.data),
      );
    await step(
      "prose",
      "한글·영어 전문 쓰기",
      (opts) =>
        ops.prose(
          job.outline,
          {
            ...job.input,
            ...(job.localDraftProse ? { draftProse: job.localDraftProse } : {}),
          },
          opts("prose"),
        ),
      (r) => (job.prose = r.data),
    );
    if (
      job.textSettings.storyEnrichment !== false &&
      !job.input.storyQuality?.enabled
    )
      await step(
        "enrichment",
        "문단별 글 풍부화",
        (opts) =>
          ops.enrichment(job.prose, job.outline, job.input, opts("enrichment")),
        (r) => {
          job.prose = r.data;
          job.enrichmentCheckpoint =
            r.meta?.enrichmentCheckpoint || job.enrichmentCheckpoint;
        },
      );
    if (job.outline.plotContract)
      await step(
        "proseCoherence",
        "전문 인과관계·상태 검사",
        (opts) =>
          ops.coherence(
            job.outline,
            job.prose,
            null,
            job.input,
            opts("coherence"),
          ),
        (r) => {
          job.prose = r.data.prose;
          job.proseCoherence = r.meta.coherence;
        },
      );
    await step(
      "pagination",
      "쪽 나누기와 본문 검사",
      (opts) =>
        job.pagination
          ? ops.repairPagination(
              job.outline,
              job.prose,
              job.pagination,
              job.input,
              opts("pagination"),
            )
          : ops.pagination(
              job.outline,
              job.prose,
              job.input,
              opts("pagination"),
            ),
      (r) => {
        job.pagination = r.data;
        job.storyCheck =
          r.meta?.checks || inspectStory(job.outline, r.data, job.input);
        job.richnessCheck = r.meta?.richnessChecks || null;
        job.pageCoherence = r.meta?.coherence || null;
        job.childGate = r.meta?.childGate || null;
        if (r.meta?.approvedProse) job.prose = r.meta.approvedProse;
        if (r.meta?.proseCoherence) job.proseCoherence = r.meta.proseCoherence;
      },
    );
    if (job.pagination.pages.length !== job.input.pageCount)
      throw Error(
        `목표 ${job.input.pageCount}쪽과 생성한 ${job.pagination.pages.length}쪽이 달라요. 완료된 글을 검토해 주세요.`,
      );
    if (!job.book) {
      if (typeof buildBook !== "function")
        throw Error("책 편집 연결을 확인해 주세요.");
      const payload = fullAutoPayload(job);
      state.storyDrafts ||= {};
      state.storyDrafts[job.storyDraftId] = {
        ...clone(payload),
        stage: "paged",
        reviewMode: "pages",
        selectedTitle: payload.pagination.cover?.title,
        createdAt: job.createdAt,
        fullAutoRunId: job.id,
      };
      job.book = await buildBook(
        hold === "text" ? textHoldPayload(state, job, payload) : payload,
      );
      job.book.fullAutoRunId = job.id;
      job.book.autoReviewPending = true;
      if (hold === "text") {
        // The snapshot must name sheets bought after the parent approves the text.
        delete job.book.generationSnapshot;
        delete job.book.sheetSetupNotice;
      } else if (!signal?.aborted) ensureJobSnapshot(state, job);
      // Stopped meanwhile: the book is kept and saved without a snapshot; the check below ends the run.
      state.storyDrafts[job.storyDraftId].pictureBook = job.book;
      await persist();
    }
    linkDeferredSeries(state, job);
    if (hold === "text")
      return await holdAt("text-review", "글 완성 · 쪽 검수");
    if (!job.book.generationSnapshot) {
      // No snapshot is frozen after a stop: page tools treat a snapshot as "ready to draw".
      abort(signal);
      ensureJobSnapshot(state, job);
      if (state.storyDrafts?.[job.storyDraftId])
        state.storyDrafts[job.storyDraftId].pictureBook = job.book;
      await persist();
    }
    if (hold === "pages") return await holdAt("pages-ready", "그림 준비 완료");
    for (let index = 0; index < job.book.pages.length; index++) {
      const page = job.book.pages[index],
        edited = page?.imageStale === true;
      // A final image drawn since the edit (any path) is current: finalImage drops the old mark.
      if (finalImage(page)) continue;
      // Text changed after this page was drawn: the old purchase no longer covers it.
      if (edited) delete job.completed["page:" + index];
      await step(
        "page:" + index,
        `${index + 1} / ${job.book.pages.length}쪽 그림 만들기`,
        () =>
          withBookTextUsage(job, async () => {
            const before = job.book.pages[index]?.imageAssetId;
            try {
              return await ops.scene(state, job.book, index, {
                quality: "final",
                signal,
                onProgress: (p) =>
                  report(p.message || `${index + 1}쪽 그림 · ${p.status}`),
              });
            } finally {
              // A paid image saved before an abort is current; never redraw it on resume.
              const current = job.book.pages[index];
              if (current?.imageAssetId && current.imageAssetId !== before)
                clearPageImageStale(current);
            }
          }),
        (r) => {
          clearPageImageStale(job.book.pages[index]);
          recordImage(job, r);
        },
      );
    }
    if (!job.book.cover?.imageAssetId)
      await step(
        "cover",
        "표지 그림 만들기",
        () =>
          withBookTextUsage(job, () =>
            ops.cover(state, job.book, { quality: "final", signal }),
          ),
        (r) => recordImage(job, r),
      );
    job.book.stage = "illustrated";
    job.book.approved = false;
    job.book.autoGenerationComplete = true;
    job.status = "review";
    job.phase = "완성 초안 · 부모 검토";
    job.currentStep = null;
    // The parent may have deleted the auto-created draft from the draft list.
    if (state.storyDrafts?.[job.storyDraftId])
      state.storyDrafts[job.storyDraftId].stage = "illustrated";
    await persist();
    report("본문과 그림·표지 생성을 마쳤어요. 전체 내용을 확인해 주세요.");
    return job.book;
  } catch (error) {
    if (job.book) {
      for (const page of job.book.pages || []) recordImage(job, page);
      recordImage(job, job.book.cover);
    }
    job.status =
      error.name === "AbortError" || signal?.aborted ? "paused" : "failed";
    job.error =
      error.name === "AbortError" ? null : String(error.message || error);
    job.phase =
      job.status === "paused" ? "중단 · 이어 만들 수 있어요" : job.phase;
    try {
      await persist();
    } catch (saveError) {
      error.message = saveError.message;
    }
    report(job.error || "완료된 결과를 보관했어요.");
    throw error;
  }
}
