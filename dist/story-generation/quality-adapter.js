import {
  buildStoryWords,
  englishVocabularyPrompt,
} from "../story-reading-context.js";
/* Bridge the supplied quality package to app engines, frozen worlds and resumable billing. */
import {
  frozenBeatCount,
  hardOutlineViolations,
  StoryValidationError,
} from "./schemas.js";
import { LEVEL_SEED } from "../reading-levels.js";
import { hasEditorPolicy } from "./book-revision.js";
import { craftCanonRules, hasCraftPolicy } from "./craft-rules.js";
import {
  hasArcPolicy,
  arcCanonRules,
  arcSimplifyKeep,
  ARC_EXAMPLE_STYLE,
  ARC_EXAMPLE_MIN_RUBRIC,
  ARC_EXAMPLE_TOKEN_BUDGET,
} from "./arc-rules.js";
import { hasPromptPolicy, bibleSeedOverrides, compactCanonCharacter, compactCanonBackground, outlineLevelLine } from "./prompt-policy.js";
import { plotContractRules } from "./plot-contract.js";
import { applyOverlay } from "../story-quality/dist/expand.js";
import { findWorld, worldCoreLines } from "../story-quality/dist/worlds.js";
import { headNoun } from "../story-quality/dist/banList.js";
import {
  CATCHPHRASE_RULE_EN,
  catchphraseRepeats,
  countCatchphrase,
  isCatchphraseFix,
} from "../story-quality/dist/catchphrase.js";
import { storyCatchphrases } from "./checker.js";
import { forbiddenHit } from "../story-quality/dist/plotCheck.js";
import {
  allowedPlaces,
  mapCast,
  normalizeOutlineResponse,
  parseJsonLenient,
} from "./outline-normalize.js";
import {
  isOpeningsInput,
  layoutCanon,
  layoutRuleLine,
  lengthFitPlan,
  lengthFitRequest,
  applyLengthFit,
  labeledBlocks,
  budgetFor as openingBudgetFor,
  openingTimeout,
  QUALITY_WRAP_TOKENS,
} from "./opening-prose.js";

const clone = (value) =>
  value == null ? value : JSON.parse(JSON.stringify(value));
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value) => {
  let result = 2166136261;
  for (const char of typeof value === "string"
    ? value
    : JSON.stringify(value)) {
    result ^= char.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16);
};
const abort = (signal) => {
  if (signal?.aborted)
    throw new DOMException("이야기 생성을 중단했어요.", "AbortError");
};
const number = (value) => Number.isFinite(value) && value >= 0;
const short = (value, max = 1000) => String(value ?? "").slice(0, max);
const asList = (value) => (Array.isArray(value) ? value : []);
const strict = (properties) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const string = (maxLength = 500) => ({
  type: "string",
  minLength: 1,
  maxLength,
});
const failureReason = {
  anyOf: [
    { type: "string", enum: ["wrong_place", "wrong_method", "interrupted"] },
    { type: "null" },
  ],
};
const candidatesSchema = strict({
  candidates: {
    type: "array",
    minItems: 3,
    maxItems: 3,
    items: strict({
      summary: string(2000),
      newElement: string(300),
      failureReason,
    }),
  },
});
const judgeSchema = strict({
  best: { type: "string", enum: ["A", "B", "C"] },
  scores: strict({
    A: { type: "number" },
    B: { type: "number" },
    C: { type: "number" },
  }),
  why: string(200),
});
let dataPromise;
const distilledLoads = new WeakMap();
async function loadDistilledBooks(fetchImpl) {
  if (!distilledLoads.has(fetchImpl)) {
    const pending = (async () => {
      const response = await fetchImpl(
        new URL(
          "../story-quality/examples/approved-books.json",
          import.meta.url,
        ),
        { cache: "no-cache", credentials: "same-origin" },
      );
      if (!response.ok) throw new Error("Optional examples unavailable");
      const books = await response.json();
      if (
        !Array.isArray(books) ||
        books.length > 5000 ||
        books.some(
          (book) =>
            !book?.approved ||
            !book.bookId ||
            !book.topic ||
            !Array.isArray(book.outline?.beats),
        )
      )
        throw new Error("Optional examples invalid");
      const freeze = (value) => {
        if (value && typeof value === "object" && !Object.isFrozen(value)) {
          Object.values(value).forEach(freeze);
          Object.freeze(value);
        }
        return value;
      };
      return freeze(books);
    })().catch(() => {
      distilledLoads.delete(fetchImpl);
      return [];
    });
    distilledLoads.set(fetchImpl, pending);
  }
  return distilledLoads.get(fetchImpl);
}
/** R9: the phrase that flooded the 2026-10-17 distilled set ("같이 가" core). */
export const DISTILLED_REPEAT_PHRASES = Object.freeze(["같이 가자!"]);
const outlineTexts = (book) => [
  ...asList(book?.outline?.beats).map((beat) => beat?.summary),
  book?.outline?.refrain?.text,
];
/** A distilled outline whose beats + refrain repeat a catchphrase 2+ times is not a usable example. */
export function repeatsCatchphrase(book, catchphrases = []) {
  return (
    catchphraseRepeats(outlineTexts(book), [
      ...DISTILLED_REPEAT_PHRASES,
      ...asList(catchphrases),
    ]).length > 0
  );
}
/**
 * Example books the outline prompt must not show: ones that repeat a catchphrase,
 * and ones that use a phrase this book omits (an example would leak it back).
 */
export function catchphraseExampleExclusions(books, input = {}) {
  const policy = input.catchphrasePolicy || {},
    omitted = asList(policy.omit)
      .map((id) => policy.phrases?.[id])
      .filter(Boolean),
    cast = storyCatchphrases(input);
  return asList(books)
    .filter(
      (book) =>
        book?.bookId &&
        (repeatsCatchphrase(book, cast) ||
          (omitted.length &&
            catchphraseRepeats(outlineTexts(book), omitted, 1).length > 0)),
    )
    .map((book) => book.bookId);
}
/**
 * `catchphraseFilter: false` keeps the pre-R9 candidate list (no distilled
 * catchphrase filter) for a draft frozen without a catchphrase policy, so its
 * outline request, and therefore its cached paid call, stays the same.
 */
export function qualityReferenceBooks(
  data,
  topic,
  enabled = false,
  catchphrases = [],
  { catchphraseFilter = true, levelKo = null } = {},
) {
  const gold = asList(data.goldBooks);
  if (!enabled) return gold;
  // Craft drafts: distilled examples of the draft's own Korean level when enough exist.
  let distilled = asList(data.distilledBooks);
  if (levelKo) {
    const same = distilled.filter((book) => book?.levelKo === levelKo);
    if (same.length >= 10) distilled = same;
  }
  const normalized = (value) =>
    String(value || "")
      .normalize("NFC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
  const target = normalized(topic),
    seen = new Set();
  return [
    ...gold.map((book) => ({ ...book, referenceSource: "gold" })),
    ...distilled.map((book) => ({
      ...book,
      referenceSource: "distilled",
    })),
  ].filter((book) => {
    if ((target && normalized(book.topic) === target) || seen.has(book.bookId))
      return false;
    if (
      catchphraseFilter &&
      book.referenceSource === "distilled" &&
      repeatsCatchphrase(book, catchphrases)
    )
      return false;
    seen.add(book.bookId);
    return true;
  });
}

/** One immutable in-memory copy; a failed load may be retried on the next visit. */
export async function loadStoryQualityData(
  fetchImpl = globalThis.fetch,
  { includeDistilled = false } = {},
) {
  if (!dataPromise)
    dataPromise = Promise.all(
      [
        "data/inventories",
        "data/gesture_dictionary",
        "data/plot_patterns",
        "data/worlds",
        "gold/gold_outlines_part1",
        "gold/gold_outlines_part2",
      ].map(async (name) => {
        const response = await fetchImpl(
          new URL(`../story-quality/${name}.json`, import.meta.url),
          { cache: "no-cache", credentials: "same-origin" },
        );
        if (!response.ok)
          throw new Error(
            "이야기 품질 재료를 읽지 못했어요. 새로고침한 뒤 다시 시도해 주세요.",
          );
        return response.json();
      }),
    )
      .then(
        ([
          inventories,
          gestureDictionary,
          plotPatterns,
          worldLibrary,
          gold1,
          gold2,
        ]) => {
          if (
            !object(inventories) ||
            !object(gestureDictionary) ||
            !Array.isArray(plotPatterns) ||
            !plotPatterns.length ||
            plotPatterns.length > 30
          )
            throw new Error("이야기 품질 재료 형식을 확인해 주세요.");
          for (const name of [
            "plantedObjects",
            "obstacleTypes",
            "twistTypes",
            "creatures",
            "humorBeats",
            "failureReasons",
          ])
            if (
              !Array.isArray(inventories[name]) ||
              !inventories[name].length ||
              inventories[name].length > 500
            )
              throw new Error("이야기 품질 인벤토리 목록을 확인해 주세요.");
          if (
            !Array.isArray(inventories.forbiddenKeywords) ||
            inventories.forbiddenKeywords.some(
              (word) =>
                typeof word !== "string" ||
                word.replace(/\s/gu, "").length < 2 ||
                word.length > 100,
            )
          )
            throw new Error(
              "금지 키워드는 한 글자 단어 없이 두 글자 이상으로 작성해 주세요.",
            );
          if (
            plotPatterns.some(
              (pattern) =>
                !object(pattern) ||
                typeof pattern.id !== "string" ||
                !Array.isArray(pattern.beats) ||
                pattern.beats.length < 6 ||
                pattern.beats.length > 8,
            )
          )
            throw new Error(
              "이야기 패턴 카드의 ID와 비트 목록을 확인해 주세요.",
            );
          const freeze = (value) => {
            if (object(value) || Array.isArray(value)) {
              Object.values(value).forEach(freeze);
              Object.freeze(value);
            }
            return value;
          };
          if (
            !object(worldLibrary) ||
            !Array.isArray(worldLibrary.worlds) ||
            !worldLibrary.worlds.length ||
            worldLibrary.worlds.length > 1000 ||
            !Array.isArray(gold1) ||
            !Array.isArray(gold2)
          )
            throw new Error(
              "이야기 세계 카드와 참조 줄거리 자료를 확인해 주세요.",
            );
          return freeze({
            inventories,
            gestureDictionary,
            plotPatterns,
            worldLibrary,
            goldBooks: [...gold1, ...gold2],
          });
        },
      )
      .catch((error) => {
        dataPromise = undefined;
        throw error;
      });
  const base = await dataPromise;
  if (!includeDistilled) return base;
  return Object.freeze({
    ...base,
    distilledBooks: Object.freeze(await loadDistilledBooks(fetchImpl)),
  });
}

/** A catalogue setting is separate from the image-engine World and its fixed drawer geometry. */
export function resolveStoryWorld(input = {}, data = {}) {
  const quality = input.storyQuality || {},
    id = quality.worldId || "drawer";
  if (id === "drawer") return { world: null, mood: null };
  const library = data.worldLibrary,
    base = library && findWorld(library, id);
  if (!base)
    throw new Error(
      "선택한 모험 무대가 없어요. 기존 배경 또는 다른 세계 카드를 골라 주세요.",
    );
  const date = new Date(input.storyDate || new Date().toISOString());
  if (!Number.isFinite(date.getTime()))
    throw new Error("이야기 제작 날짜를 확인해 주세요.");
  const month = Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Seoul",
      month: "numeric",
    }).format(date),
  );
  const autoSeason =
    month >= 3 && month <= 5
      ? "spring"
      : month >= 6 && month <= 8
        ? "summer"
        : month >= 9 && month <= 11
          ? "autumn"
          : "winter";
  const season =
      quality.season === "none"
        ? null
        : ["spring", "summer", "autumn", "winter"].includes(quality.season)
          ? quality.season
          : autoSeason,
    time = quality.timeOfDay === "night" ? "night" : "day";
  const world = applyOverlay(library, base, season, time),
    seasonOverlay = world.season
      ? library.overlays?.seasons?.[world.season]
      : null,
    timeOverlay = library.overlays?.times?.[world.timeOfDay];
  const mood = {
    version: 1,
    worldId: base.id,
    name: clone(base.name),
    era: base.era,
    season: world.season,
    timeOfDay: world.timeOfDay,
    stateLabel: clone(world.stateLabel),
    weather: clone(world.weather),
    light: clone(world.light),
    palette: clone(world.palette),
    styleLine: [seasonOverlay?.styleHint, timeOverlay?.styleHint]
      .filter(Boolean)
      .join(", "),
    worldCore: worldCoreLines(library, world),
  };
  return { world, mood };
}

function usageOf(response = {}) {
  const source = response.usage || {},
    usage = {
      input: number(source.input) ? source.input : 0,
      output: number(source.output) ? source.output : 0,
    };
  const actual = response.costUsd ?? source.costUsd,
    estimate =
      response.costUsdEstimated ??
      source.costUsdEstimated ??
      response.meta?.costUsdEstimated;
  if (number(actual)) usage.costUsd = actual;
  if (number(estimate)) usage.costUsdEstimated = estimate;
  return usage;
}
function mergeUsage(rows) {
  const usage = { input: 0, output: 0 };
  for (const row of rows) {
    usage.input += row.usage.input;
    usage.output += row.usage.output;
  }
  if (rows.length && rows.every((row) => number(row.usage.costUsd)))
    usage.costUsd = rows.reduce((sum, row) => sum + row.usage.costUsd, 0);
  if (rows.some((row) => number(row.usage.costUsdEstimated)))
    usage.costUsdEstimated = rows.reduce(
      (sum, row) => sum + (row.usage.costUsdEstimated || 0),
      0,
    );
  return usage;
}
const requestCount = (rows) =>
  rows.reduce(
    (sum, row) => sum + Math.max(1, Number(row.meta?.requests) || 1),
    0,
  );
function modelIdentity(options = {}) {
  return {
    engineId: options.engine?.id || options.engineId || null,
    modelId: short(options.config?.model || options.config?.modelId || "", 200),
  };
}
function roleOptions(options, role) {
  const selected =
    options.qualityEngines?.[role] ??
    options.qualityEngineOptions?.[role] ??
    (role === "prose"
      ? options.proseOptions
      : role === "cheap"
        ? options.cheapOptions
        : undefined);
  if (typeof selected === "string")
    return { ...options, engine: undefined, engineId: selected };
  if (selected?.complete)
    return { ...options, engine: selected, engineId: selected.id };
  return selected
    ? {
        ...options,
        ...selected,
        ...(selected.engineId && !selected.engine ? { engine: undefined } : {}),
      }
    : options;
}
function safeResponse(response) {
  const meta = {};
  for (const key of ["model", "modelId", "requests", "costUsdEstimated"])
    if (
      typeof response.meta?.[key] === "string" ||
      number(response.meta?.[key])
    )
      meta[key] = response.meta[key];
  return {
    text:
      typeof response.text === "string"
        ? response.text
        : response.json !== undefined
          ? JSON.stringify(response.json)
          : "",
    ...(response.json !== undefined ? { json: clone(response.json) } : {}),
    usage: usageOf(response),
    ...(number(response.costUsd) ? { costUsd: response.costUsd } : {}),
    meta,
  };
}
const CHECK_RULES = 2;
export function ledger(kind, input, options, extra = {}, checkpointKey = "qualityCheckpoint") {
  const contextFingerprint = hash({
    version: 1,
    kind,
    input,
    extra,
    engines: Object.fromEntries(
      // R30: the beat writer's ledger also keys on the writer model (other kinds unchanged).
      [
        "outline",
        "prose",
        "cheap",
        ...(kind === "beatWriter" ? ["beatWriter"] : []),
      ].map((role) => [
        role,
        modelIdentity(roleOptions(options, role)),
      ]),
    ),
  });
  const prior = options[checkpointKey];
  const checkpoint =
    prior?.version === 1 &&
    prior.kind === kind &&
    prior.contextFingerprint === contextFingerprint
      ? clone(prior)
      : { version: 1, kind, contextFingerprint, completed: {} };
  if (!object(checkpoint.completed)) checkpoint.completed = {};
  // A checkpoint saved before the 2026-10-19 robustness checks keeps the old
  // package checks, so its fix-pass requests (built from those checks) stay
  // byte-identical and its paid responses keep replaying. New ones use rule 2.
  if (
    checkpoint.checkRules === undefined &&
    !Object.keys(checkpoint.completed).length
  )
    checkpoint.checkRules = CHECK_RULES;
  const paid = [],
    engines = new Map();
  let resumed = 0;
  const summary = () => ({
    stage: kind,
    requests: requestCount(paid),
    resumedCalls: resumed,
    [checkpointKey]: clone(checkpoint),
    engineId: paid[0]?.meta?.engineId || null,
    modelId: paid[0]?.meta?.modelId || paid[0]?.meta?.model || null,
    models: paid.map((row) => ({
      engineId: row.meta.engineId,
      modelId: row.meta.modelId || row.meta.model || null,
      requests: Number(row.meta.requests) || 1,
    })),
    demo: false,
  });
  const save = async () => {
    if (options.onCheckpoint)
      await options.onCheckpoint({
        stage: kind,
        [checkpointKey]: clone(checkpoint),
        usage: mergeUsage(paid),
        meta: summary(),
      });
  };
  return {
    checkpoint,
    legacyChecks: checkpoint.checkRules !== CHECK_RULES,
    paid,
    summary,
    save,
    usage: () => mergeUsage(paid),
    get resumed() {
      return resumed;
    },
    async call(role, request, services) {
      abort(options.signal);
      const selected = roleOptions(options, role),
        key = hash({ role, engine: modelIdentity(selected), request });
      const cached = checkpoint.completed[key];
      if (cached?.role === role && object(cached.response)) {
        resumed++;
        return clone(cached.response);
      }
      let engine = engines.get(role);
      if (!engine) {
        engine = Promise.resolve(services.engineFor(selected));
        engines.set(role, engine);
      }
      engine = await engine;
      abort(options.signal);
      options.onProgress?.({
        stage: kind,
        phase: "request",
        message:
          kind === "council"
            ? "기획 회의 · 작가·편집자·그림 감독·독자 봇이 의논하고 있어요."
            : kind === "beatWriter"
              ? "정성 모드 · 비트마다 작가가 한 장면씩 쓰고 있어요."
              : kind === "qualityOutline"
              ? "정해진 재료와 플롯 패턴으로 줄거리를 구성하고 있어요."
              : "장면을 풍부하게 쓴 뒤 선택한 읽기 수준으로 다듬고 있어요.",
        qualityRole: role,
      });
      let response;
      try {
        response = await engine.complete({
          ...request,
          signal: options.signal,
        });
      } catch (error) {
        paid.push({
          usage: usageOf(error),
          meta: {
            ...(error.meta || {}),
            engineId: engine.id || selected.engineId || "unknown",
            failed: true,
            ...(!error.usage ? { usageUnknown: true } : {}),
          },
        });
        throw error;
      }
      const saved = safeResponse(response);
      paid.push({
        usage: saved.usage,
        meta: {
          ...saved.meta,
          engineId: engine.id || selected.engineId || "unknown",
        },
      });
      checkpoint.completed[key] = { role, response: saved };
      await save();
      abort(options.signal);
      return saved;
    },
    fail(error, details = {}) {
      error.usage = mergeUsage(paid);
      error[checkpointKey] = clone(checkpoint);
      error.meta = { ...(error.meta || {}), ...summary(), ...details };
      return error;
    },
  };
}

/**
 * R9 prompt text applies only to drafts frozen with a catchphrase policy
 * (inputFromWizard always sets one). A draft without it keeps the pre-R9
 * requests byte for byte, so resuming it never re-bills a cached paid call.
 */
const r9Catchphrases = (input) => !!input?.catchphrasePolicy;
/** R9: the catchphrase limit and this book's frozen rotation, stated next to APP CANON. */
function catchphraseRules(input, services) {
  if (!r9Catchphrases(input)) return "";
  const omitted = new Set(asList(input.catchphrasePolicy?.omit)),
    names = asList(input.characters)
      .filter((character) => omitted.has(character.id))
      .map((character) => `${character.name} (${character.id})`);
  return `${String(services.baseSystem || "").includes(CATCHPHRASE_RULE_EN) ? "" : `CATCHPHRASES: ${CATCHPHRASE_RULE_EN} Never use a catchphrase as the refrain or repeating frame sentence.\n`}${names.length ? `CATCHPHRASE ROTATION: ${names.join(", ")} used a catchphrase in a recent book, so they use no catchphrase in this book.\n` : ""}`;
}
/**
 * 2026-10-20: the quality path never saw the parent's typed ending (only the
 * ending type in the JSON template), so the outline ended at home. New drafts
 * with endingType "custom" get the ending as a binding canon block.
 */
export function endingCanonBlock(input, stage = "outline") {
  const note = String(input?.endingNote || "").trim().replace(/\s+/gu, " ");
  if (input?.endingType !== "custom" || !note) return "";
  return stage === "prose"
    ? `ENDING (the parent's own ending, binding): "${note}". The final paragraph enacts it as concrete action and words in the place where it happens; no return home, bedtime or sleep unless the ending says so.`
    : `ENDING (the parent's own ending, binding): "${note}". The final beat enacts exactly this as a concrete action wherever it happens, and its settingKey is that place (any supplied background, home or not); do not add a return home, a bedtime or sleep unless the ending says so. The first beat still starts at the home background. endingType is "custom".`;
}
function canonicalWorldRules(input, services, bindTargetLevel = true, stage = "outline") {
  const craft = [endingCanonBlock(input, stage), craftCanonRules(input, stage), arcCanonRules(input, stage)].filter(Boolean).join("\n");
  // R23: the outline stage of a policy draft gets a one-line level summary and
  // a canon without colours, wardrobe or likes; the prose stages keep the JSON.
  const lean = stage === "outline" && bindTargetLevel && hasPromptPolicy(input);
  const levelBlock = lean
    ? outlineLevelLine(input, frozenBeatCount(input))
    : bindTargetLevel ? services.levelRules?.(input) || "" : "RICH DRAFT LEVEL: use the package richLevel ranges in this request. The selected target level applies only during the later simplify/fix pass.";
  return `${craft ? `${craft}\n` : ""}${services.baseSystem || ""}\n${catchphraseRules(input, services)}${levelBlock}\n${plotContractRules(input)}\nCATALOGUE ATMOSPHERE: ${JSON.stringify(input.storyWorldMood || null)}. Catalogue landmarks, portals and props are suggestions for new material planning only. Approved drawer backgrounds, fixed geometry and cast always prevail; never add a tunnel, structure or speaking character solely because a catalogue suggests it.\nAPP CANON: ${JSON.stringify({ characters: lean ? asList(input.characters).map(compactCanonCharacter) : input.characters, backgrounds: lean ? asList(input.backgrounds).map(compactCanonBackground) : input.backgrounds, previousStory: input.previousStory || null, endingType: input.endingType, endingNote: input.endingNote || "", moral: input.moral || "", topic: input.topic, pageCount: input.pageCount, ...(isOpeningsInput(input) ? { layout: layoutCanon(input) } : {}) })}\nUse exact selected character IDs in characters and plotContract, exact selected background IDs in settingKey/settings/state locations. Start and end at a supplied home background and use at least two selected non-home locations between them. Inventory sublocations are optional views inside those fixed places, never permission to create another permanent place or an unselected main character. A seed creature may be a small background observation; do not replace the pinned cast or give it a speaking role unless that character is selected. Preserve previous-story facts. ${bindTargetLevel ? "Frozen app levelSpec rules override conflicting generic package wording." : "For this rich draft use the supplied upper richLevel; preserve events for later simplification without binding the final target sentence/word ranges yet."} English is newly authored at its own E level, never a translation.`;
}
function enrichedOutlineSchema(input, pattern, services) {
  const supplied =
    typeof services.outlineRequestSchema === "function"
      ? services.outlineRequestSchema(input)
      : services.outlineRequestSchema;
  if (!object(supplied)) throw new Error("앱 줄거리 스키마를 연결해 주세요.");
  const schema = clone(supplied),
    beat = schema.properties.beats.items,
    attempts = (frozenBeatCount(input) || 7) - 5;
  schema.properties.plan = strict({
    pattern: { type: "string", enum: [pattern.id] },
    planted: string(300),
    twistReveal: string(1000),
    funnyMoment: string(500),
    failureReasons: {
      type: "array",
      items: {
        type: "string",
        enum: ["wrong_place", "wrong_method", "interrupted"],
      },
      minItems: attempts,
      maxItems: attempts,
    },
  });
  schema.required = [
    ...new Set([
      ...schema.required,
      "plan",
      "twist",
      "settings",
      "emotionArc",
      "plotContract",
    ]),
  ];
  beat.properties.newElement = string(300);
  beat.properties.failureReason = clone(failureReason);
  beat.required = [
    ...new Set([...beat.required, "newElement", "failureReason"]),
  ];
  if (schema.properties.refrain) {
    schema.properties.refrain.properties.variation = string(300);
    schema.properties.refrain.required = [
      ...new Set([...schema.properties.refrain.required, "variation"]),
    ];
  }
  return schema;
}
function adaptPattern(pattern, input) {
  const count = frozenBeatCount(input) || 7,
    attemptSlots = asList(pattern.beats).filter(
      (beat) => beat.type === "attempt",
    );
  const other = (type) =>
    clone(
      asList(pattern.beats).find((beat) => beat.type === type) || {
        type,
        slot: `${type} 역할을 사건의 원인과 결과로 구체화한다.`,
      },
    );
  const attempts = Array.from({ length: count - 5 }, (_, index) => {
    const source = attemptSlots[Math.min(index, attemptSlots.length - 1)] || {
      type: "attempt",
      slot: "앞선 결과를 보고 방법을 바꿔 구체적으로 시도한다.",
    };
    return {
      ...clone(source),
      slot: `${source.slot}${index >= attemptSlots.length ? " 앞선 시도와 다른 원인·방법·결과로 발전시킨다." : ""}`,
    };
  });
  return {
    ...clone(pattern),
    beats: [
      other("setup"),
      other("want"),
      ...attempts,
      other("turn"),
      other("resolution"),
      other("close"),
    ],
  };
}
function assertInventoryAvailable(input, data, world) {
  const quality = input.storyQuality || {},
    window = Math.min(
      50,
      Math.max(1, Math.round(Number(quality.banWindow) || 10)),
    ),
    recent = asList(quality.approvedBooks)
      .filter((book) => book?.approved)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, window);
  const planted = new Set(
      recent
        .map((book) => book.usedElements?.planted)
        .filter(Boolean)
        .map(headNoun),
    ),
    creatures = new Set(
      recent
        .flatMap((book) => asList(book.usedElements?.creatures))
        .filter(Boolean)
        .map(headNoun),
    );
  const exhausted = [];
  const props = [
      ...asList(world?.props),
      ...asList(data.inventories?.plantedObjects),
    ],
    animals = [
      ...asList(world?.creatures),
      ...asList(data.inventories?.creatures),
    ];
  if (props.length && props.every((item) => planted.has(headNoun(item.ko))))
    exhausted.push("심을 물건");
  if (
    animals.length &&
    animals.every((item) => creatures.has(headNoun(item.ko)))
  )
    exhausted.push("배경 생물");
  if (exhausted.length)
    throw new StoryValidationError("outline", [
      `${exhausted.join("·")} 재료가 최근 사용 목록에 모두 들어 있어요. 반복 제한 범위를 줄여 다시 만들어 주세요. API는 호출하지 않았어요.`,
    ]);
}
function choosePatterns(input, data) {
  const quality = input.storyQuality || {},
    edited = quality.patterns || quality.patternCards,
    patterns = asList(edited).length ? edited : data.plotPatterns;
  if (!patterns.length)
    throw new Error("이야기 패턴 카드를 하나 이상 준비해 주세요.");
  const records = asList(quality.approvedBooks)
      .filter((book) => book?.approved)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    recent = new Set(
      records
        .slice(
          0,
          Math.min(
            20,
            Math.max(1, Math.round(Number(quality.patternBanWindow) || 3)),
          ),
        )
        .map((book) => book.patternId || book.usedElements?.patternId),
    );
  const candidates = patterns.filter((pattern) => !recent.has(pattern.id)),
    pool = candidates.length ? candidates : patterns;
  const topic = String(input.topic || ""),
    score = (pattern) =>
      asList(pattern.bestFor).reduce(
        (total, word) => total + (topic.includes(word) ? 2 : 0),
        0,
      );
  const ranked = [...pool].sort(
    (a, b) =>
      score(b) - score(a) ||
      hash(`${input.bookId || topic}:${a.id}`).localeCompare(
        hash(`${input.bookId || topic}:${b.id}`),
      ),
  );
  const primary =
      patterns.find((pattern) => pattern.id === quality.patternId) || ranked[0],
    auxiliary =
      ranked.find((pattern) => pattern.id !== primary.id) ||
      patterns.find((pattern) => pattern.id !== primary.id);
  return [primary, ...(auxiliary ? [auxiliary] : [])].map((pattern) =>
    adaptPattern(pattern, input),
  );
}
function backgroundType(input) {
  const source = [
    input.topic,
    ...asList(input.backgrounds).map((row) =>
      [row.type, row.kind, row.name].filter(Boolean).join(" "),
    ),
  ].join(" ");
  if (/바다|해변|\bsea\b|beach/iu.test(source)) return "sea";
  if (/공룡|dino/iu.test(source)) return "dino_land";
  if (/하늘|우주|\bsky\b|space/iu.test(source)) return "sky";
  if (/유치원|어린이집|kindergarten/iu.test(source)) return "kindergarten";
  return "forest";
}
function compactCharacter(character, omitted = false) {
  return {
    name: short(character.name, 100),
    traits: asList(character.traits)
      .slice(0, 3)
      .map((value) => short(value, 100)),
    ...(omitted ? { catchphraseOmitted: true } : {}),
    ...(!omitted && (character.catchphrase || character.speechHabit)
      ? {
          catchphrase: short(
            character.catchphrase || character.speechHabit,
            150,
          ),
        }
      : {}),
    ...(character.role ? { role: short(character.role, 100) } : {}),
  };
}
function fixedBeatIds(outline, messages) {
  const targets = new Set();
  for (const message of messages) {
    for (const match of message.matchAll(/비트\s*(\d+)/gu))
      targets.add(Number(match[1]));
    if (/비트\s*1~2/u.test(message)) {
      targets.add(1);
      targets.add(2);
    }
    if (/반전 비트/u.test(message))
      asList(outline.beats)
        .filter((beat) => beat.type === "turn")
        .forEach((beat) => targets.add(beat.index));
    if (/attempt|실패 이유/u.test(message))
      asList(outline.beats)
        .filter((beat) => beat.type === "attempt")
        .forEach((beat) => targets.add(beat.index));
    if (/newElement/u.test(message)) {
      const groups = new Map();
      for (const beat of asList(outline.beats)) {
        const element = String(beat.newElement || "").trim();
        if (!element) targets.add(beat.index);
        else groups.set(element, [...(groups.get(element) || []), beat.index]);
      }
      for (const ids of groups.values())
        if (ids.length > 1) ids.forEach((id) => targets.add(id));
    }
    if (/중간 비트의 장소/u.test(message))
      asList(outline.beats)
        .slice(1, -1)
        .forEach((beat) => targets.add(beat.index));
    if (/배경 생물/u.test(message))
      asList(outline.beats)
        .filter((beat) => beat.type === "turn")
        .forEach((beat) => targets.add(beat.index));
    if (/같은 문형/u.test(message)) {
      const head = message.match(/"([^"…]+)\s*…/u)?.[1]?.trim();
      if (head)
        asList(outline.beats)
          .filter((beat) => beat.summary?.includes(head))
          .forEach((beat) => targets.add(beat.index));
    }
    if (/금지/u.test(message)) {
      for (const quoted of message.matchAll(/"([^"]+)"/gu))
        asList(outline.beats)
          .filter((beat) => beat.summary?.includes(quoted[1]))
          .forEach((beat) => targets.add(beat.index));
    }
  }
  return targets;
}
const FIX_REQUEST_PREFIX = "아래 줄거리 JSON에서 지적된 항목만 고쳐";
/** The package's one fix pass: the outline it fixes and its "- " items. */
function fixRequestParts(request) {
  if (!String(request?.user || "").startsWith(FIX_REQUEST_PREFIX)) return null;
  const blocks = request.user.split("\n\n");
  return {
    original: JSON.parse(blocks.at(-1)),
    messages: blocks
      .slice(1, -1)
      .join("\n")
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2)),
  };
}
/**
 * Every part a fix response changed although no check item targeted it, in
 * the order the targeted-fix contract reports them: beats, settings, then the
 * approved want/problem/ending. `restore` puts the original part back.
 */
function untargetedChanges(original, fixed, targets) {
  const changes = [];
  original.beats.forEach((beat, index) => {
    if (
      !targets.has(beat.index) &&
      JSON.stringify(fixed.beats[index]) !== JSON.stringify(beat)
    )
      changes.push({
        kind: "beat",
        id: beat.index,
        before: beat,
        after: fixed.beats[index],
        message: `${beat.index}번 비트는 검사에서 지적하지 않았으므로 수정할 수 없어요.`,
        restore: (outline) => {
          outline.beats[index] = clone(beat);
        },
      });
  });
  for (const setting of asList(original.settings)) {
    const after = asList(fixed.settings).find(
      (row) => row.beatIndex === setting.beatIndex,
    );
    if (
      !targets.has(setting.beatIndex) &&
      JSON.stringify(after) !== JSON.stringify(setting)
    )
      changes.push({
        kind: "setting",
        id: setting.beatIndex,
        before: setting,
        after,
        message: `${setting.beatIndex}번 비트의 배경은 검사에서 지적하지 않았으므로 바꿀 수 없어요.`,
        restore: (outline) => {
          const rows = Array.isArray(outline.settings)
            ? outline.settings
            : (outline.settings = []);
          const at = rows.findIndex(
            (row) => row?.beatIndex === setting.beatIndex,
          );
          if (at >= 0) rows[at] = clone(setting);
          else rows.push(clone(setting));
        },
      });
  }
  for (const field of ["want", "problem", "endingType"])
    if (JSON.stringify(fixed[field]) !== JSON.stringify(original[field]))
      changes.push({
        kind: "field",
        id: field,
        before: original[field],
        after: fixed[field],
        message: "부분 수정에서 승인한 목표·문제·결말을 바꿀 수 없어요.",
        restore: (outline) => {
          outline[field] = clone(original[field]);
        },
      });
  return changes;
}
/** Values a fix response actually filled (no empty strings, nulls or empty lists). */
function filledFields(value) {
  return Object.fromEntries(
    Object.entries(object(value) ? value : {}).filter(
      ([, item]) =>
        item !== undefined &&
        item !== null &&
        !(typeof item === "string" && !item.trim()) &&
        !(Array.isArray(item) && !item.length),
    ),
  );
}
/**
 * The fix pass (a cheap model) returns the whole outline JSON and may drop or
 * blank parts it was never asked about (plan.planted, the plotContract ledger,
 * refrain …). The result is therefore built from the ORIGINAL outline: for a
 * targeted beat only summary/newElement/failureReason are taken (where the
 * response filled them); its settingKey and settings row only when a place
 * item targeted the beat and the value is a selected drawer id; its
 * characters only after mapping to selected cast ids. plan/refrain fields an
 * item names are taken too. Beat index and type, the ledger and every other
 * field stay as the outline model wrote them.
 */
function mergeTargetedFix(original, fixed, messages, context = {}) {
  const targets = fixedBeatIds(original, messages),
    merged = clone(original),
    allowed = context.allowedPlaces || new Set(),
    placeItem = messages.some((message) => /중간 비트의 장소/u.test(message)),
    rowOf = (outline, beatIndex) =>
      asList(outline.settings).find(
        (item) => object(item) && item.beatIndex === beatIndex,
      );
  original.beats.forEach((beat, index) => {
    if (!targets.has(beat.index) || !object(fixed.beats[index])) return;
    const from = fixed.beats[index],
      filled = filledFields({
        summary: from.summary,
        newElement: from.newElement,
        failureReason: from.failureReason,
      }),
      next = { ...clone(beat), ...clone(filled), index: beat.index, type: beat.type };
    if (placeItem) {
      const fromRow = rowOf(fixed, beat.index),
        place = allowed.has(fromRow?.backgroundId)
          ? fromRow.backgroundId
          : allowed.has(from.settingKey)
            ? from.settingKey
            : null;
      if (place) {
        next.settingKey = place;
        const row = rowOf(merged, beat.index);
        if (row) row.backgroundId = place;
      }
    }
    if (Array.isArray(from.characters) && context.input) {
      const { kept } = mapCast(from.characters, context.input);
      if (kept.length) next.characters = kept;
    }
    merged.beats[index] = next;
  });
  const named = (pattern) => messages.some((message) => pattern.test(message));
  const planKeys = [
    ...(named(/plan\.planted|심은 물건/u) ? ["planted"] : []),
    ...(named(/plan\.pattern/u) ? ["pattern"] : []),
  ];
  const plan = filledFields(fixed.plan);
  for (const key of planKeys)
    if (typeof plan[key] === "string")
      merged.plan = { ...(object(merged.plan) ? merged.plan : {}), [key]: plan[key] };
  if (named(/후렴|refrain/u) && object(fixed.refrain))
    merged.refrain = {
      ...(object(merged.refrain) ? clone(merged.refrain) : {}),
      ...clone(filledFields(fixed.refrain)),
    };
  return { merged, targets };
}
const beatNumber = (value) =>
  typeof value === "string" && /^\s*\d{1,3}\s*$/u.test(value)
    ? Number(value)
    : value;
/**
 * Reads a fix response against the original outline. Unwraps a single
 * wrapper ({"outline": {…}}), matches beats by their index (a partial answer
 * with only the flagged beat, or reordered beats), and fills fields the
 * response left out from the original. Returns { fixed } or { reason } when
 * the response cannot be lined up with the original (unreadable, or a changed
 * beat count without usable indexes): the caller then keeps the original.
 */
function readFixedOutline(original, response) {
  let raw =
    response.json !== undefined && response.json !== null
      ? response.json
      : parseJson(response.text);
  if (object(raw) && !Array.isArray(raw.beats)) {
    const inner = Object.values(raw).filter(
      (value) => object(value) && Array.isArray(value.beats),
    );
    if (inner.length === 1) raw = inner[0];
  }
  if (!object(raw) || !Array.isArray(raw.beats))
    return { reason: "품질 수정 응답의 비트 목록을 읽지 못했어요." };
  const ids = original.beats.map((beat) => beat.index),
    beats = raw.beats.map((beat) =>
      object(beat) && beatNumber(beat.index) !== beat.index
        ? { ...beat, index: beatNumber(beat.index) }
        : beat,
    ),
    numbered = beats.map((beat) => (object(beat) ? beat.index : undefined)),
    byIndex =
      numbered.every((index) => ids.includes(index)) &&
      new Set(numbered).size === numbered.length;
  let aligned;
  if (
    beats.length === ids.length &&
    numbered.every((index, at) => index === ids[at])
  )
    aligned = beats;
  else if (byIndex && beats.length)
    aligned = original.beats.map(
      (beat) => beats.find((item) => item.index === beat.index) || clone(beat),
    );
  else if (beats.length === ids.length) aligned = beats;
  else return { reason: "품질 수정은 줄거리 비트 개수를 바꿀 수 없어요." };
  const fixed = { ...raw, beats: aligned };
  for (const key of Object.keys(original))
    if (!Object.hasOwn(raw, key)) fixed[key] = clone(original[key]);
  return { fixed };
}
/** Every string inside a beat/field value (summary, newElement, nested text …). */
function stringsOf(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => stringsOf(item, out));
  else if (object(value))
    Object.values(value).forEach((item) => stringsOf(item, out));
  return out;
}
/** True when a change added, removed or moved a catchphrase use in that part. */
function isCatchphraseEdit(change, catchphrases) {
  const uses = (value, phrase) =>
    stringsOf(value).reduce(
      (sum, text) => sum + countCatchphrase(text, phrase),
      0,
    );
  return (
    !!change.restore &&
    catchphrases.some(
      (phrase) => uses(change.before, phrase) !== uses(change.after, phrase),
    )
  );
}
/** The beam wrap answered without the app fields it must fill. */
function beamWrapMissing(response, input) {
  const json =
    response.json !== undefined && response.json !== null
      ? response.json
      : parseJson(response.text);
  const count = frozenBeatCount(input);
  return (
    !object(json) ||
    !Array.isArray(json.beats) ||
    (count && json.beats.length !== count) ||
    !Array.isArray(json.settings) ||
    !Array.isArray(json.emotionArc) ||
    !object(json.plotContract)
  );
}
const beamWrapRetry = (input) =>
  `The previous answer left out app fields. Return the COMPLETE app outline JSON matching the supplied schema, not only the short template above: titleCandidates (exactly 3), logline, want, problem, twist, plan, exactly ${frozenBeatCount(input) || "6-8"} beats (keep each approved beam beat's index, type, summary, newElement and failureReason; characters = selected character IDs; settingKey = a selected background ID), refrain, newWordsKo, newWordsEn, settings (one row per beat), emotionArc (one per beat), endingType and plotContract.`;
/**
 * A fix pass never costs the paid outline, never throws, and never strands a
 * resume (which replays the same response):
 * - every item in the pass was a catchphrase advisory: keep the original
 *   outline (the recheck reports the items again as advisories);
 * - a response that cannot be lined up with the original (unreadable,
 *   truncated, or a changed beat count without usable indexes): keep the
 *   original outline, recorded as mode "original"; the package recheck turns
 *   the items into notes;
 * - otherwise the outline is rebuilt from the original with only the targeted
 *   parts taken from the response (mergeTargetedFix). Untargeted edits are
 *   dropped and recorded; the package's recheck then judges the result.
 * The decision depends only on the request and the (checkpointed) response,
 * so a resume replays it with no new call.
 */
function enforceTargetedFixKeepingOutline(
  request,
  response,
  catchphrases,
  onFallback,
  context = {},
) {
  const parts = fixRequestParts(request);
  if (!parts) return response;
  const { original, messages } = parts,
    advisory = asList(messages).filter(isCatchphraseFix),
    read = readFixedOutline(original, response);
  if (advisory.length && advisory.length === messages.length) {
    if (
      read.fixed &&
      !untargetedChanges(original, read.fixed, fixedBeatIds(original, messages))
        .length
    ) {
      const { merged } = mergeTargetedFix(original, read.fixed, messages, context);
      return { ...response, json: merged, text: JSON.stringify(merged) };
    }
    onFallback({
      mode: "original",
      reason: read.reason || untargetedReason(original, read.fixed, messages),
    });
    return { ...response, json: original, text: JSON.stringify(original) };
  }
  if (!read.fixed) {
    onFallback({
      mode: "original",
      cause: "untargeted",
      reason: read.reason,
      restored: ["outline"],
    });
    return { ...response, json: original, text: JSON.stringify(original) };
  }
  const fixed = read.fixed,
    { merged, targets } = mergeTargetedFix(original, fixed, messages, context),
    changes = untargetedChanges(original, fixed, targets);
  if (changes.length)
    onFallback({
      mode: "restored",
      cause:
        advisory.length &&
        changes.every((change) => isCatchphraseEdit(change, catchphrases))
          ? "catchphrase"
          : "untargeted",
      reason: changes[0].message,
      restored: changes.map((change) =>
        change.kind === "field" ? change.id : `${change.kind}:${change.id}`,
      ),
    });
  return { ...response, json: merged, text: JSON.stringify(merged) };
}
function untargetedReason(original, fixed, messages) {
  if (!fixed) return "품질 수정 응답의 비트 목록을 읽지 못했어요.";
  return (
    untargetedChanges(original, fixed, fixedBeatIds(original, messages))[0]
      ?.message || ""
  );
}
/** Package check items that must still stop a book: forbidden material, and no topic word at all. */
const isHardPlotItem = (message) =>
  /^금지 소재|^주제 키워드\(/u.test(String(message));
/** JSON with a fence, a leading sentence or trailing commentary around it. */
const parseJson = (text) => parseJsonLenient(text);

export async function generateQualityOutline(
  source,
  options = {},
  services = {},
) {
  const input = services.normalizeStoryInput
      ? services.normalizeStoryInput(source)
      : clone(source),
    quality = input.storyQuality || {},
    journal = ledger("qualityOutline", input, options),
    module = await (services.qualityModule?.() ||
      import("../story-quality/dist/pipeline.js"));
  try {
    const data =
        services.qualityData ||
        (await loadStoryQualityData(globalThis.fetch, {
          // R19: arc drafts always draw on the distilled 9-point examples as spine cards.
          includeDistilled:
            quality.useDistilledExamples === true || hasArcPolicy(input),
        })),
      { world, mood } = resolveStoryWorld(input, data);
    input.storyWorldMood = mood;
    assertInventoryAvailable(input, data, world);
    // R9 text, checks and example filters only for drafts frozen with a policy;
    // a draft without one sends its pre-R9 requests unchanged (no re-billing).
    const r9 = r9Catchphrases(input),
      patterns = choosePatterns(input, data),
      catchphrases = r9 ? storyCatchphrases(input) : [],
      omittedCatchphrases = new Set(asList(input.catchphrasePolicy?.omit)),
      referenceBooks = qualityReferenceBooks(
        data,
        input.topic,
        quality.useDistilledExamples === true || hasArcPolicy(input),
        catchphrases,
        {
          catchphraseFilter: r9,
          levelKo: hasCraftPolicy(input) ? input.specs?.ko?.id || null : null,
        },
      );
    const fixContext = { input, allowedPlaces: allowedPlaces(input) },
      beam = quality.useBeamSearch === true;
    let last;
    for (let attempt = 0; attempt < Math.min(2, patterns.length); attempt++) {
      const pattern = patterns[attempt],
        schema = enrichedOutlineSchema(input, pattern, services),
        // R20: the story bible settled by the writers' room binds every outline request.
        canon = [canonicalWorldRules(input, services), options.storyBibleRules || ""].filter(Boolean).join("\n");
      let fixFallback = null,
        wrapRetried = false;
      const wrap = (role) => ({
        id: `quality-${role}`,
        async complete(request) {
          const candidate = /후보를 3개/u.test(request.system),
            judge = /후보 3개 중/u.test(request.system),
            jsonSchema = candidate
              ? candidatesSchema
              : judge
                ? judgeSchema
                : schema;
          const extra =
            candidate || judge
              ? "Return only the requested candidate/judgment JSON; do not return a complete outline."
              : `Return the COMPLETE app outline matching the supplied schema, including plan, newElement/failureReason, refrain.variation if present, twist, settings, emotionArc and plotContract. plan.pattern=${pattern.id}. Exactly ${frozenBeatCount(input)} beats. ${request.user.includes("APPROVED_BEAM_BEATS_JSON:") ? "Preserve every chosen beam summary, index, type, newElement and failureReason exactly. Fill canonical character/background IDs and coherent full fields." : ""}`;
          const sent = {
            ...request,
            system: `${canon}\n${request.system}\n${extra}`,
            jsonSchema,
            maxTokens: Math.max(
              request.maxTokens || 0,
              candidate ? 1800 : judge ? 1500 : 16000,
            ),
          };
          // Editor round: the fix pass rewrites story content, so a new draft
          // sends it to the outline (author) model instead of the economy one.
          const caller =
            role === "cheap" &&
            hasEditorPolicy(input) &&
            request.user.startsWith("아래 줄거리 JSON에서")
              ? "outline"
              : role;
          let response = await journal.call(caller, sent, services);
          // Beam wrap: a model that follows the package's short wrap template
          // leaves out the app fields (beats with cast/place ids, settings,
          // emotionArc, plotContract). Only on that failure branch, redo just
          // the wrap once with the fields named (journalled, so a resume
          // replays it); never the whole beam.
          if (
            request.user.includes("APPROVED_BEAM_BEATS_JSON:") &&
            beamWrapMissing(response, input)
          ) {
            wrapRetried = true;
            response = await journal.call(
              caller,
              { ...sent, user: `${request.user}\n\n${beamWrapRetry(input)}` },
              services,
            );
          }
          return enforceTargetedFixKeepingOutline(
            request,
            response,
            catchphrases,
            (value) => {
              fixFallback = value;
            },
            fixContext,
          );
        },
      });
      const offset = Math.min(
          999,
          Math.max(0, Math.floor(Number(input.qualitySeedOffset) || 0)),
        ),
        bookId = String(
          input.bookId ||
            `story-${hash({ topic: input.topic, characters: input.characters, pageCount: input.pageCount })}`,
        ),
        result = await module.runOutlineStage({
          engines: {
            outline: wrap("outline"),
            prose: wrap("prose"),
            cheap: wrap("cheap"),
          },
          bookId: offset ? `${bookId}:seed+${offset}` : bookId,
          protagonist: compactCharacter(
            input.characters[0],
            omittedCatchphrases.has(input.characters[0].id),
          ),
          supporting: input.characters
            .slice(1)
            .map((character) =>
              compactCharacter(
                character,
                omittedCatchphrases.has(character.id),
              ),
            ),
          catchphrases,
          // A catchphrase item alone never buys the fix pass (it stays an advisory).
          advisoryCatchphrases: true,
          legacyCatchphrasePrompt: !r9,
          worldCore: [
            ...(mood?.worldCore || []),
            ...String(input.worldNotes || input.worldName || "")
              .split(/\n/u)
              .filter(Boolean),
          ].slice(0, 3),
          topic: input.topic,
          value: input.moral,
          levelKo: input.specs.ko.id || "K1",
          levelEn: input.specs.en.id || "E0",
          pages: input.pageCount,
          pattern,
          backgroundType: backgroundType(input),
          inventories: data.inventories,
          world: world || undefined,
          variantChance: Number.isFinite(quality.variantChance)
            ? quality.variantChance
            : 0.35,
          referenceBooks,
          approvedBooks: asList(quality.approvedBooks),
          endingType: input.endingType,
          ...(hasArcPolicy(input)
            ? {
                exampleStyle: ARC_EXAMPLE_STYLE,
                exampleMinRubric: ARC_EXAMPLE_MIN_RUBRIC,
                exampleTokenBudget: ARC_EXAMPLE_TOKEN_BUDGET,
              }
            : {}),
          legacyChecks: journal.legacyChecks,
          // R23: an empty settings array no longer overrides the package's
          // default rules and ban examples (policy drafts); a coach's own
          // rules still replace them.
          ...(Array.isArray(quality.rules) && !(hasPromptPolicy(input) && !quality.rules.length)
            ? { rules: quality.rules.slice(0, 7) }
            : {}),
          ...(Array.isArray(quality.banExamples) && !(hasPromptPolicy(input) && !quality.banExamples.length)
            ? { banExamples: quality.banExamples.slice(0, 4) }
            : {}),
          // R23: the story bible decides the seed's planted object and turn.
          ...(hasPromptPolicy(input) && bibleSeedOverrides(options.storyBible)
            ? { seedOverrides: bibleSeedOverrides(options.storyBible) }
            : {}),
          useBeamSearch: quality.useBeamSearch === true,
          seriesId: input.seriesId,
          banWindow: Math.min(
            50,
            Math.max(1, Math.round(Number(quality.banWindow) || 10)),
          ),
          patternBanWindow: Math.min(
            20,
            Math.max(1, Math.round(Number(quality.patternBanWindow) || 3)),
          ),
          excludeBookIds: [
            input.bookId,
            input.previousStory?.id,
            ...(r9
              ? catchphraseExampleExclusions(
                  [...asList(quality.approvedBooks), ...referenceBooks],
                  input,
                )
              : []),
          ].filter(Boolean),
        });
      last = result;
      // Book-keeping slips in the paid response (ids written as names, ledger
      // continuity, counts, numbers as strings …) are cleaned up before the
      // checks. Only the response changes, so a resume replays the same calls.
      const shaped = normalizeOutlineResponse(result.outline, input);
      result.outline = shaped.outline;
      if (
        result.seed &&
        result.outline.plan?.planted !== result.seed.planted.ko
      ) {
        result.check.fix.push("심을 물건이 정해진 시드 재료와 달라요.");
        result.check.ok = false;
      }
      const appReport = services.inspectOutlineRules?.(
          result.outline,
          input,
        ) || {
          valid: true,
          violations: [],
        },
        report = result.outline.plotContract
          ? appReport
          : {
              ...appReport,
              valid: false,
              violations: [
                ...asList(appReport.violations),
                {
                  code: "plot_contract_missing",
                  message: "이야기의 사건·상태 장부가 필요해요.",
                },
              ],
            };
      // Package regenerate items rechecked against the app: a forbidden word
      // counts only at a word start outside an everyday context (꿀벌을 is not
      // "벌을 주"), and a topic item is hard only when the app's own topic check
      // (stop words, cast stand-ins) also finds no topic word at all.
      const summaries = asList(result.outline.beats)
          .map((beat) => String(beat?.summary ?? ""))
          .join(" "),
        appKnowsTopic = Array.isArray(appReport.topicKeywords),
        noTopicAtAll = asList(appReport.violations).some(
          (row) => row?.code === "topic_keyword_missing" && row.partial !== true,
        ),
        rechecked = [],
        regenerate = result.check.regenerate.filter((message) => {
          const forbidden = String(message).match(/^금지 소재: (.+)$/u)?.[1];
          if (forbidden !== undefined && !forbiddenHit(summaries, forbidden)) {
            rechecked.push(message);
            return false;
          }
          if (/^주제 키워드\(/u.test(message) && appKnowsTopic && !noTopicAtAll) {
            rechecked.push(message);
            return false;
          }
          return true;
        });
      const qualityMeta = {
        version: 1,
        seedSummary: result.seedSummary,
        seedOffset: offset,
        patternId: pattern.id,
        plan: clone(result.outline.plan),
        check: clone(result.check),
        seed: clone(result.seed),
        worldMood: clone(mood),
        worldSnapshot: clone(world),
        variantChance: Number.isFinite(quality.variantChance)
          ? quality.variantChance
          : 0.35,
        regenerationAttempts: attempt,
        ...(shaped.notes.length ? { normalized: shaped.notes } : {}),
        ...(rechecked.length ? { recheckedPlotItems: rechecked } : {}),
        ...(wrapRetried ? { beamWrapRetried: true } : {}),
      };
      // R9: a catchphrase repeat is an advisory. Alone it buys no fix pass; mixed
      // with other items it rides along in the one pass. Whatever survives is
      // recorded, never a reason to discard a paid outline.
      const blocking = result.check.fix.filter(
        (message) => !isCatchphraseFix(message),
      );
      if (blocking.length !== result.check.fix.length)
        qualityMeta.catchphraseAdvisories = result.check.fix.filter(
          isCatchphraseFix,
        );
      if (fixFallback?.cause === "untargeted")
        qualityMeta.untargetedFixRestored = {
          ...(fixFallback.mode === "original" ? { mode: "original" } : {}),
          reason: fixFallback.reason,
          restored: fixFallback.restored,
        };
      else if (fixFallback) {
        const { cause, ...kept } = fixFallback;
        qualityMeta.catchphraseFixFallback = kept;
      }
      // After the last attempt, quality-only items (topic word, planted payoff,
      // refrain, repeated sentence frames …) no longer stop a paid book: they are
      // kept as notes. Forbidden material, structure, places and the ledger still stop it.
      // A structure/ledger problem the clean-up could not fix on the first
      // attempt buys the existing second-pattern outline (never with beam on,
      // where that would repeat the whole beam).
      const hard = hardOutlineViolations(report),
        passes =
          (result.check.ok || (!regenerate.length && !blocking.length)) &&
          report.valid,
        moreAttempts =
          attempt === 0 &&
          patterns.length > 1 &&
          (regenerate.length > 0 || (!beam && hard.length > 0)),
        softOnly =
          !moreAttempts &&
          ![...regenerate, ...blocking].some(isHardPlotItem) &&
          !hard.length;
      if (!passes && softOnly)
        qualityMeta.softIssues = [
          ...new Set([
            ...regenerate,
            ...blocking,
            ...asList(report.violations).map((row) => row.message),
          ]),
        ];
      if (passes || softOnly) {
        const outline = services.assertValid
          ? services.assertValid("outline", result.outline, input)
          : result.outline;
        if (!outline.plotContract)
          throw new StoryValidationError("outline", [
            "이야기의 사건·상태 장부가 필요해요.",
          ]);
        return {
          data: outline,
          usage: journal.usage(),
          meta: {
            ...journal.summary(),
            stage: "outline",
            quality: qualityMeta,
          },
        };
      }
      if (moreAttempts) {
        options.onProgress?.({
          stage: "qualityOutline",
          phase: "regenerate",
          message:
            "다른 보조 패턴으로 줄거리의 주제·인과관계를 한 번 더 구성하고 있어요.",
        });
        continue;
      }
      // The ledger errors arrive both as structure and as plot_contract rows:
      // each message is listed once.
      const error = new StoryValidationError("outline", [
        ...new Set([
          ...regenerate,
          ...result.check.fix,
          ...asList(report.violations).map((row) => row.message),
        ]),
      ]);
      error.outline = clone(result.outline);
      throw journal.fail(error, { stage: "outline", quality: qualityMeta });
    }
    throw new StoryValidationError(
      "outline",
      last
        ? [...last.check.regenerate, ...last.check.fix]
        : ["이야기 패턴을 준비해 주세요."],
    );
  } catch (error) {
    throw journal.fail(error, { stage: "outline" });
  }
}

function packageLevels(input) {
  const levels = Object.fromEntries(
    [...Object.entries(LEVEL_SEED.ko), ...Object.entries(LEVEL_SEED.en)].map(
      ([id, spec]) => [id, clone(spec)],
    ),
  );
  for (const lang of ["ko", "en"]) {
    const spec = input.specs[lang],
      id = spec.id || (lang === "ko" ? "K1" : "E0"),
      sentences = spec.sentencesPerPageRange,
      words = spec.wordsPerSentence;
    levels[id] = {
      ...(levels[id] || {}),
      ...clone(spec),
      sentencesPerPage: Array.isArray(sentences)
        ? sentences
        : object(sentences)
          ? [sentences.min, sentences.max]
          : Array.isArray(spec.sentencesPerPage)
            ? spec.sentencesPerPage
            : [spec.sentencesPerPage, spec.sentencesPerPage],
      ...(lang === "ko"
        ? {
            eojeolPerSentence: Array.isArray(spec.eojeolPerSentence)
              ? spec.eojeolPerSentence
              : Array.isArray(words)
                ? words
                : [words?.min || 3, words?.max || 7],
          }
        : {
            wordsPerSentence: Array.isArray(words)
              ? words
              : [words?.min || 3, words?.max || 8],
          }),
    };
  }
  // R12 openings: the target row asks for the per-opening range (a beat is an
  // opening) and the rich row comes from the frozen richLevel, never the live
  // seed. Page drafts keep the live-seed rows (same ledger fingerprints).
  if (isOpeningsInput(input))
    for (const lang of ["ko", "en"]) {
      const spec = input.specs[lang],
        opening = [spec.units.opening.min, spec.units.opening.max],
        rich = spec.richLevel;
      if (rich?.id && rich.id !== spec.id) {
        const { id, ...row } = clone(rich);
        levels[id] = { ...row, sentencesPerPage: opening };
      }
      levels[spec.id].sentencesPerPage = opening;
    }
  return levels;
}
/** A code fence around the whole labeled text is wrapping, not content. */
const unfenced = (text) => {
  const match = /^```[^\n]*\n([\s\S]*?)\n?```\s*$/u.exec(text);
  return match ? match[1].trim() : text;
};
/**
 * Labels: '[비트 1 · 유형]' / '[Beat 1 · type]'. Also accepted, without touching
 * the prose: no space before the number ('[비트1]') and bold markers around the
 * label. Missing labels or paragraphs are still rejected, never guessed.
 */
function parseLabeledProse(text, outline, lang) {
  const source = unfenced(String(text || "").trim()),
    pattern =
      /^\s*(?:\*\*)?\[(?:비트|Beat)\s*(\d+)(?:\s*[·:—-][^\]\r\n]*)?\](?:\*\*)?\s*/gimu,
    matches = [...source.matchAll(pattern)],
    expected = outline.beats.map((beat) => beat.index),
    labels = [],
    paragraphs = [];
  if (!matches.length || source.slice(0, matches[0].index).trim())
    throw new StoryValidationError("prose", [
      `${lang === "ko" ? "한글" : "영어"} 전문의 모든 문단에 비트 라벨이 필요해요.`,
    ]);
  matches.forEach((match, index) => {
    const beatIndex = Number(match[1]),
      content = source
        .slice(
          match.index + match[0].length,
          matches[index + 1]?.index ?? source.length,
        )
        .trim(),
      rows = content
        .split(/\n\s*\n/u)
        .map((row) => row.trim())
        .filter(Boolean);
    if (!rows.length || !expected.includes(beatIndex))
      throw new StoryValidationError("prose", [
        "전문 비트 라벨과 문단의 내용을 확인해 주세요.",
      ]);
    for (const row of rows) {
      if (/\[(?:비트|Beat)\s*\d+/iu.test(row))
        throw new StoryValidationError("prose", [
          "비트 라벨은 각 문단 첫 줄에만 사용할 수 있어요.",
        ]);
      labels.push(beatIndex);
      paragraphs.push(row);
    }
  });
  if (
    expected.some((id) => !labels.includes(id)) ||
    labels.some((id, index) => index && id < labels[index - 1])
  )
    throw new StoryValidationError("prose", [
      "모든 승인 비트를 순서대로 포함한 전문이 필요해요.",
    ]);
  return { text: paragraphs.join("\n\n"), labels };
}

export async function generateQualityProse(
  outline,
  source,
  options = {},
  services = {},
) {
  const input = services.normalizeStoryInput
      ? services.normalizeStoryInput(source)
      : clone(source),
    quality = input.storyQuality || {},
    journal = ledger("qualityProse", input, options, {
      outline,
      sceneBriefs: options.sceneBriefs || [],
    }),
    module = await (services.qualityModule?.() ||
      import("../story-quality/dist/pipeline.js"));
  try {
    if (outline.quality?.worldMood)
      input.storyWorldMood = clone(outline.quality.worldMood);
    const data = services.qualityData || (await loadStoryQualityData()),
      levels = packageLevels(input),
      prose = {
        ko: "",
        en: "",
        usedRefrainAt: [...(outline.refrain?.usedAtBeats || [])],
        paragraphBeats: { ko: [], en: [] },
      },
      results = {};
    for (const lang of ["ko", "en"]) {
      const targetLevelId =
          input.specs[lang].id || (lang === "ko" ? "K1" : "E0"),
        targetOnly = quality.twoPass === false;
      const openings = isOpeningsInput(input),
        wrapTokens = openingBudgetFor("qualityWrap", input, QUALITY_WRAP_TOKENS);
      const wrap = (role) => ({
        id: `quality-${role}`,
        async complete(request) {
          const labels = lang === "ko" ? "[비트 n · 유형]" : "[Beat n · type]",
            rules = `OUTPUT FORMAT OVERRIDE: return ${lang === "ko" ? "Korean" : "English"} plain story text only, NOT JSON, with ${labels} at each beat paragraph start. Keep labels through rich, simplify and emotion fixes. The app strips them into metadata before printing. Follow every approved beat, all causal state changes, and its scene brief without introducing new events. EVERY sentence, including dialogue, has an explicit grammatical subject. Attribute dialogue to a selected named speaker. Include at least THREE quoted dialogue turns in this language and one concrete sensory detail per beat. ${lang === "en" && targetLevelId === "E0" ? "Use says, not said. Use present tense for every narration sentence." : ""} English is original writing at its E level, never a Korean translation. The approved plotContract is frozen; stateAfter describes the endpoint, not the start of every paragraph. ${targetOnly ? "This is the only writing pass: write directly at the frozen target level." : "Rich draft may use the package rich level for syntax; simplify/fix must return to the frozen target level without removing causal events."}${openings ? ` ${layoutRuleLine(input)}` : ""}`;
          const richDraft = role === "prose" && !targetOnly;
          // Editor round: simplify, emotion fix and condense write the printed
          // text, so a new draft writes them with the author (prose) model.
          return journal.call(
            role === "cheap" && hasEditorPolicy(input) ? "prose" : role,
            {
              ...request,
              system: `${canonicalWorldRules(input, services, !richDraft, "prose")}\n${request.system}\n${rules}`,
              user: `${request.user}\n\nFROZEN_APPROVED_OUTLINE_JSON: ${JSON.stringify(outline)}\n${richDraft ? "FINAL_TARGET_LEVEL_FOR_LATER_SIMPLIFY_ONLY" : "TARGET_LEVEL_SPEC_JSON"}: ${JSON.stringify(input.specs[lang])}`,
              maxTokens: wrapTokens,
              ...openingTimeout("qualityWrap", input, wrapTokens),
            },
            services,
          );
        },
      });
      const result = await module.runProseStage({
        engines: {
          outline: wrap("outline"),
          prose: wrap("prose"),
          cheap: wrap("cheap"),
        },
        lang,
        outline,
        // R12 openings: no package condense and no '[전체 분량] N쪽' line; the
        // app length-fit pass below works per beat (= per opening) instead.
        pageCount: openings ? undefined : input.pageCount,
        condenseOverBudget:
          input.prosePolicy?.condenseOverBudget?.[lang] === true,
        // R9 rule 9 only for drafts frozen with a catchphrase policy.
        legacyCatchphrasePrompt: !r9Catchphrases(input),
        charactersCompact: input.characters
          .map(
            (character) =>
              `${character.id} / ${character.name}${character.nameEn ? ` / ${character.nameEn}` : ""}: ${asList(character.traits).join("·")}`,
          )
          .join(" / "),
        briefsCompact: JSON.stringify(options.sceneBriefs || []),
        emotions: asList(options.sceneBriefs?.briefs || options.sceneBriefs)
          .map((brief) => brief.emotion || brief.feeling)
          .filter(Boolean),
        gestureDict: data.gestureDictionary,
        levels,
        targetLevelId,
        ...(Array.isArray(quality.styleSamples)
          ? { styleSamples: quality.styleSamples.slice(0, 3) }
          : {}),
        vocabLabel:
          lang === "en"
            ? englishVocabularyPrompt(
                input.specs.en,
                buildStoryWords(input, outline),
              )
            : input.specs[lang].vocabSource ||
              input.specs[lang].vocab ||
              "frozen selected vocabulary",
        ...(hasArcPolicy(input)
          ? { keepLines: arcSimplifyKeep(input, lang) }
          : {}),
        twoPass: !targetOnly,
      });
      let simplified = result.simplified,
        lengthFit = null;
      if (openings && input.prosePolicy?.condenseOverBudget?.[lang] === true) {
        const plan = lengthFitPlan(
          labeledBlocks(simplified),
          input.specs[lang],
          lang,
          input.pageCount / 2,
        );
        if (plan.triggered.length) {
          // One cheap call per language, journal-recorded (a resume re-buys nothing).
          const response = await journal.call(
            hasEditorPolicy(input) ? "prose" : "cheap",
            {
              ...lengthFitRequest(simplified, plan, input.specs[lang], lang),
              maxTokens: wrapTokens,
              ...openingTimeout("qualityWrap", input, wrapTokens),
            },
            services,
          );
          const fitted = applyLengthFit(simplified, response.text, plan);
          lengthFit = {
            triggered: plan.triggered.map((row) => row.beatIndex),
            accepted: !!fitted,
          };
          if (fitted) simplified = fitted;
        }
      }
      const parsed = parseLabeledProse(simplified, outline, lang);
      prose[lang] = parsed.text;
      prose.paragraphBeats[lang] = parsed.labels;
      results[lang] = {
        condenseOverBudget:
          input.prosePolicy?.condenseOverBudget?.[lang] === true,
        condensed: result.condensed === true,
        sentenceCount: result.sentenceCount ?? null,
        tellHitsAfter: result.tellHitsAfter,
        calls: result.calls,
        twoPass: !targetOnly,
        ...(lengthFit ? { lengthFit } : {}),
      };
    }
    const validated = services.assertValid
      ? services.assertValid("prose", prose, input, outline)
      : prose;
    return {
      data: validated,
      usage: journal.usage(),
      meta: {
        ...journal.summary(),
        stage: "prose",
        quality: {
          version: 1,
          twoPass: quality.twoPass !== false,
          languages: results,
          patternId: outline.plan?.pattern || null,
        },
      },
    };
  } catch (error) {
    throw journal.fail(error, { stage: "prose" });
  }
}
