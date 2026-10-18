import {
  buildStoryWords,
  englishVocabularyPrompt,
} from "../story-reading-context.js";
/* Bridge the supplied quality package to app engines, frozen worlds and resumable billing. */
import { frozenBeatCount, StoryValidationError } from "./schemas.js";
import { LEVEL_SEED } from "../reading-levels.js";
import { plotContractRules } from "./plot-contract.js";
import { applyOverlay } from "../story-quality/dist/expand.js";
import { findWorld, worldCoreLines } from "../story-quality/dist/worlds.js";
import { headNoun } from "../story-quality/dist/banList.js";
import {
  CATCHPHRASE_RULE_EN,
  catchphraseRepeats,
  isCatchphraseFix,
} from "../story-quality/dist/catchphrase.js";
import { storyCatchphrases } from "./checker.js";

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
export function qualityReferenceBooks(
  data,
  topic,
  enabled = false,
  catchphrases = [],
) {
  const gold = asList(data.goldBooks);
  if (!enabled) return gold;
  const normalized = (value) =>
    String(value || "")
      .normalize("NFC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
  const target = normalized(topic),
    seen = new Set();
  return [
    ...gold.map((book) => ({ ...book, referenceSource: "gold" })),
    ...asList(data.distilledBooks).map((book) => ({
      ...book,
      referenceSource: "distilled",
    })),
  ].filter((book) => {
    if ((target && normalized(book.topic) === target) || seen.has(book.bookId))
      return false;
    if (
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
function ledger(kind, input, options, extra = {}) {
  const contextFingerprint = hash({
    version: 1,
    kind,
    input,
    extra,
    engines: Object.fromEntries(
      ["outline", "prose", "cheap"].map((role) => [
        role,
        modelIdentity(roleOptions(options, role)),
      ]),
    ),
  });
  const prior = options.qualityCheckpoint;
  const checkpoint =
    prior?.version === 1 &&
    prior.kind === kind &&
    prior.contextFingerprint === contextFingerprint
      ? clone(prior)
      : { version: 1, kind, contextFingerprint, completed: {} };
  if (!object(checkpoint.completed)) checkpoint.completed = {};
  const paid = [],
    engines = new Map();
  let resumed = 0;
  const summary = () => ({
    stage: kind,
    requests: requestCount(paid),
    resumedCalls: resumed,
    qualityCheckpoint: clone(checkpoint),
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
        qualityCheckpoint: clone(checkpoint),
        usage: mergeUsage(paid),
        meta: summary(),
      });
  };
  return {
    checkpoint,
    paid,
    summary,
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
          kind === "qualityOutline"
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
      error.qualityCheckpoint = clone(checkpoint);
      error.meta = { ...(error.meta || {}), ...summary(), ...details };
      return error;
    },
  };
}

/** R9: the catchphrase limit and this book's frozen rotation, stated next to APP CANON. */
function catchphraseRules(input, services) {
  const omitted = new Set(asList(input.catchphrasePolicy?.omit)),
    names = asList(input.characters)
      .filter((character) => omitted.has(character.id))
      .map((character) => `${character.name} (${character.id})`);
  return `${String(services.baseSystem || "").includes(CATCHPHRASE_RULE_EN) ? "" : `CATCHPHRASES: ${CATCHPHRASE_RULE_EN} Never use a catchphrase as the refrain or repeating frame sentence.\n`}${names.length ? `CATCHPHRASE ROTATION: ${names.join(", ")} used a catchphrase in a recent book, so they use no catchphrase in this book.\n` : ""}`;
}
function canonicalWorldRules(input, services, bindTargetLevel = true) {
  return `${services.baseSystem || ""}\n${catchphraseRules(input, services)}${bindTargetLevel ? services.levelRules?.(input) || "" : "RICH DRAFT LEVEL: use the package richLevel ranges in this request. The selected target level applies only during the later simplify/fix pass."}\n${plotContractRules(input)}\nCATALOGUE ATMOSPHERE: ${JSON.stringify(input.storyWorldMood || null)}. Catalogue landmarks, portals and props are suggestions for new material planning only. Approved drawer backgrounds, fixed geometry and cast always prevail; never add a tunnel, structure or speaking character solely because a catalogue suggests it.\nAPP CANON: ${JSON.stringify({ characters: input.characters, backgrounds: input.backgrounds, previousStory: input.previousStory || null, endingType: input.endingType, endingNote: input.endingNote || "", moral: input.moral || "", topic: input.topic, pageCount: input.pageCount })}\nUse exact selected character IDs in characters and plotContract, exact selected background IDs in settingKey/settings/state locations. Start and end at a supplied home background and use at least two selected non-home locations between them. Inventory sublocations are optional views inside those fixed places, never permission to create another permanent place or an unselected main character. A seed creature may be a small background observation; do not replace the pinned cast or give it a speaking role unless that character is selected. Preserve previous-story facts. ${bindTargetLevel ? "Frozen app levelSpec rules override conflicting generic package wording." : "For this rich draft use the supplied upper richLevel; preserve events for later simplification without binding the final target sentence/word ranges yet."} English is newly authored at its own E level, never a translation.`;
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
function enforceTargetedFix(request, response) {
  if (!request.user.startsWith("아래 줄거리 JSON에서 지적된 항목만 고쳐"))
    return response;
  const blocks = request.user.split("\n\n"),
    original = JSON.parse(blocks.at(-1)),
    messages = blocks
      .slice(1, -1)
      .join("\n")
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2));
  const fixed = response.json || parseJson(response.text),
    targets = fixedBeatIds(original, messages);
  if (!object(fixed) || !Array.isArray(fixed.beats))
    throw new StoryValidationError("outline", [
      "품질 수정 응답의 비트 목록을 읽지 못했어요.",
    ]);
  if (fixed.beats.length !== original.beats.length)
    throw new StoryValidationError("outline", [
      "품질 수정은 줄거리 비트 개수를 바꿀 수 없어요.",
    ]);
  for (let index = 0; index < original.beats.length; index++)
    if (
      !targets.has(original.beats[index].index) &&
      JSON.stringify(fixed.beats[index]) !==
        JSON.stringify(original.beats[index])
    )
      throw new StoryValidationError("outline", [
        `${original.beats[index].index}번 비트는 검사에서 지적하지 않았으므로 수정할 수 없어요.`,
      ]);
  for (const setting of asList(original.settings))
    if (
      !targets.has(setting.beatIndex) &&
      JSON.stringify(
        asList(fixed.settings).find(
          (row) => row.beatIndex === setting.beatIndex,
        ),
      ) !== JSON.stringify(setting)
    )
      throw new StoryValidationError("outline", [
        `${setting.beatIndex}번 비트의 배경은 검사에서 지적하지 않았으므로 바꿀 수 없어요.`,
      ]);
  for (const field of ["want", "problem", "endingType"])
    if (JSON.stringify(fixed[field]) !== JSON.stringify(original[field]))
      throw new StoryValidationError("outline", [
        "부분 수정에서 승인한 목표·문제·결말을 바꿀 수 없어요.",
      ]);
  return { ...response, json: fixed, text: JSON.stringify(fixed) };
}
function parseJson(text) {
  try {
    return JSON.parse(
      String(text || "")
        .trim()
        .replace(/^```(?:json)?\s*/iu, "")
        .replace(/\s*```$/u, ""),
    );
  } catch {
    return null;
  }
}

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
          includeDistilled: quality.useDistilledExamples === true,
        })),
      { world, mood } = resolveStoryWorld(input, data);
    input.storyWorldMood = mood;
    assertInventoryAvailable(input, data, world);
    const patterns = choosePatterns(input, data),
      catchphrases = storyCatchphrases(input),
      omittedCatchphrases = new Set(asList(input.catchphrasePolicy?.omit)),
      referenceBooks = qualityReferenceBooks(
        data,
        input.topic,
        quality.useDistilledExamples === true,
        catchphrases,
      );
    let last;
    for (let attempt = 0; attempt < Math.min(2, patterns.length); attempt++) {
      const pattern = patterns[attempt],
        schema = enrichedOutlineSchema(input, pattern, services),
        canon = canonicalWorldRules(input, services);
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
          const response = await journal.call(
            role,
            {
              ...request,
              system: `${canon}\n${request.system}\n${extra}`,
              jsonSchema,
              maxTokens: Math.max(
                request.maxTokens || 0,
                candidate ? 1800 : judge ? 1500 : 16000,
              ),
            },
            services,
          );
          return enforceTargetedFix(request, response);
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
          ...(Array.isArray(quality.rules)
            ? { rules: quality.rules.slice(0, 7) }
            : {}),
          ...(Array.isArray(quality.banExamples)
            ? { banExamples: quality.banExamples.slice(0, 4) }
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
            ...catchphraseExampleExclusions(
              [...asList(quality.approvedBooks), ...referenceBooks],
              input,
            ),
          ].filter(Boolean),
        });
      last = result;
      if (
        result.seed &&
        result.outline.plan?.planted !== result.seed.planted.ko
      ) {
        result.check.fix.push("심을 물건이 정해진 시드 재료와 달라요.");
        result.check.ok = false;
      }
      const report = services.inspectOutlineRules?.(result.outline, input) || {
        valid: true,
        violations: [],
      };
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
      };
      // R9: a catchphrase repeat drives the one targeted fix pass. If it survives
      // that pass it stays an advisory, never a reason to discard a paid outline.
      const blocking = result.check.fix.filter(
        (message) => !isCatchphraseFix(message),
      );
      if (blocking.length !== result.check.fix.length)
        qualityMeta.catchphraseAdvisories = result.check.fix.filter(
          isCatchphraseFix,
        );
      if (
        (result.check.ok ||
          (!result.check.regenerate.length && !blocking.length)) &&
        report.valid
      ) {
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
      if (
        result.check.regenerate.length &&
        attempt === 0 &&
        patterns.length > 1
      ) {
        options.onProgress?.({
          stage: "qualityOutline",
          phase: "regenerate",
          message:
            "다른 보조 패턴으로 줄거리의 주제·인과관계를 한 번 더 구성하고 있어요.",
        });
        continue;
      }
      const error = new StoryValidationError("outline", [
        ...result.check.regenerate,
        ...result.check.fix,
        ...asList(report.violations).map((row) => row.message),
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
  return levels;
}
function parseLabeledProse(text, outline, lang) {
  const source = String(text || "").trim(),
    pattern = /^\s*\[(?:비트|Beat)\s+(\d+)(?:\s*[·:—-][^\]\r\n]*)?\]\s*/gimu,
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
      if (/\[(?:비트|Beat)\s+\d+/iu.test(row))
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
      const wrap = (role) => ({
        id: `quality-${role}`,
        async complete(request) {
          const labels = lang === "ko" ? "[비트 n · 유형]" : "[Beat n · type]",
            rules = `OUTPUT FORMAT OVERRIDE: return ${lang === "ko" ? "Korean" : "English"} plain story text only, NOT JSON, with ${labels} at each beat paragraph start. Keep labels through rich, simplify and emotion fixes. The app strips them into metadata before printing. Follow every approved beat, all causal state changes, and its scene brief without introducing new events. EVERY sentence, including dialogue, has an explicit grammatical subject. Attribute dialogue to a selected named speaker. Include at least THREE quoted dialogue turns in this language and one concrete sensory detail per beat. ${lang === "en" && targetLevelId === "E0" ? "Use says, not said. Use present tense for every narration sentence." : ""} English is original writing at its E level, never a Korean translation. The approved plotContract is frozen; stateAfter describes the endpoint, not the start of every paragraph. ${targetOnly ? "This is the only writing pass: write directly at the frozen target level." : "Rich draft may use the package rich level for syntax; simplify/fix must return to the frozen target level without removing causal events."}`;
          const richDraft = role === "prose" && !targetOnly;
          return journal.call(
            role,
            {
              ...request,
              system: `${canonicalWorldRules(input, services, !richDraft)}\n${request.system}\n${rules}`,
              user: `${request.user}\n\nFROZEN_APPROVED_OUTLINE_JSON: ${JSON.stringify(outline)}\n${richDraft ? "FINAL_TARGET_LEVEL_FOR_LATER_SIMPLIFY_ONLY" : "TARGET_LEVEL_SPEC_JSON"}: ${JSON.stringify(input.specs[lang])}`,
              maxTokens: 12000,
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
        pageCount: input.pageCount,
        condenseOverBudget:
          input.prosePolicy?.condenseOverBudget?.[lang] === true,
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
        twoPass: !targetOnly,
      });
      const parsed = parseLabeledProse(result.simplified, outline, lang);
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
