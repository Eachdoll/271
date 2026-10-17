/* A sequel keeps the approved visual and story facts of its own series. */
import {
  getActiveWorld,
  getCharacterSheet,
  getWorldStyleReferenceRecords,
  getWorldBackgroundSnapshot,
} from "../image-generation/world.js";
import { getStylePreset } from "../image-generation/styles.js";

const clone = (value) =>
  value == null ? value : JSON.parse(JSON.stringify(value));
const unique = (values) => [...new Set(values.filter(Boolean))];
const own = (value, key) =>
  Object.prototype.hasOwnProperty.call(value || {}, key);
const text = (value) => String(value ?? "").trim();
const normalized = (value) =>
  text(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
const MEDIA_OR_SECRET =
  /(?:image|photo|asset|blob|dataUrl|endpoint|baseUrl|proxyUrl)|^(?:apiKey|api_key|authorization|credentials?|secret|password|pin|pinHash|ciphertext|salt|iv|accessToken|refreshToken|token|config)$/i;
const CHARACTER_FIELDS = [
  "id",
  "name",
  "nameEn",
  "role",
  "kind",
  "age",
  "gender",
  "description",
  "appearance",
  "clothes",
  "color",
  "hairColor",
  "skinColor",
  "traits",
  "personality",
  "relationships",
  "catchphrase",
  "speechHabit",
  "likes",
  "dislikes",
  "storyNotes",
];
const BACKGROUND_FIELDS = [
  "id",
  "name",
  "nameEn",
  "kind",
  "type",
  "description",
  "features",
  "layout",
  "rules",
  "mood",
  "color",
  "storyNotes",
  "aliases",
];

function safeTextData(value, depth = 0) {
  if (depth > 12 || value == null) return value == null ? value : null;
  if (typeof value === "string")
    return /^(?:data:(?:image|audio)\/|blob:|asset:)/i.test(value.trim())
      ? ""
      : value.slice(0, 60000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value))
    return value.slice(0, 200).map((item) => safeTextData(item, depth + 1));
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !MEDIA_OR_SECRET.test(key))
        .map(([key, item]) => [key, safeTextData(item, depth + 1)]),
    );
  return null;
}

function pick(value, fields) {
  return safeTextData(
    Object.fromEntries(
      fields
        .filter((key) => value?.[key] !== undefined)
        .map((key) => [key, value[key]]),
    ),
  );
}

/** Stable content identity, not a cryptographic integrity or security check. */
export function previousStoryHash(reference) {
  const content = JSON.stringify(reference || {});
  let hash = 2166136261;
  for (let index = 0; index < content.length; index++)
    hash = Math.imul(hash ^ content.charCodeAt(index), 16777619);
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function previousCharacters(previous, state) {
  const records = new Map();
  for (const sheet of previous?.generationSnapshot?.characterSheets || []) {
    const character = sheet.characterSnapshot;
    if (character)
      records.set(sheet.characterId || character.id, {
        ...clone(character),
        id: sheet.characterId || character.id,
      });
  }
  for (const character of previous?.characterSnapshots || [])
    if (!records.has(character.id)) records.set(character.id, clone(character));
  for (const id of previous?.characterIds || [])
    if (!records.has(id)) {
      const character = state?.characters?.find((item) => item.id === id);
      if (character) records.set(id, clone(character));
    }
  return records;
}

function previousBackgrounds(previous, state) {
  const records = new Map();
  for (const background of [
    ...(previous?.generationSnapshot?.backgrounds || []),
    ...(previous?.backgroundSnapshots || []),
  ]) {
    if (background?.id && !records.has(background.id))
      records.set(background.id, clone(background));
  }
  for (const id of previous?.backgroundIds || [])
    if (!records.has(id)) {
      const background = state?.backgrounds?.find((item) => item.id === id);
      if (background) records.set(id, clone(background));
    }
  return records;
}

function locationValues(page) {
  return unique(
    [
      page?.backgroundId,
      page?.scene?.backgroundId,
      page?.scene?.where,
      page?.scene?.setting,
    ]
      .filter((value) => typeof value === "string")
      .map(text),
  );
}

function placeMatch(value, backgrounds) {
  if (!value) return null;
  const exact = backgrounds.find((background) => background.id === value);
  if (exact) return exact;
  const target = normalized(value);
  if (!target) return null;
  const matches = backgrounds
    .flatMap((background) =>
      unique([
        background.name,
        background.nameEn,
        ...(background.aliases || []),
      ]).map((alias) => ({ background, alias: normalized(alias) })),
    )
    .filter(
      (candidate) =>
        candidate.alias &&
        (target === candidate.alias ||
          (candidate.alias.length >= 3 && target.includes(candidate.alias))),
    )
    .sort((a, b) => b.alias.length - a.alias.length);
  return matches[0]?.background || null;
}

function outlineBackground(previous, page, backgrounds) {
  const setting = previous?.outline?.settings?.find(
    (item) =>
      Number(item.beatIndex) ===
      Number(page?.beatIndex ?? page?.scene?.beatIndex),
  );
  return setting?.backgroundId
    ? backgrounds.find(
        (background) => background.id === setting.backgroundId,
      ) || null
    : null;
}

function hasImage(record) {
  return !!(
    record?.imageAssetId ||
    (typeof record?.imageUrl === "string" && record.imageUrl)
  );
}

function durableImage(record) {
  const assetId =
    record.imageAssetId ||
    (record.imageUrl?.startsWith("asset:") ? record.imageUrl.slice(6) : null);
  return {
    imageAssetId: assetId,
    imageUrl: assetId ? `asset:${assetId}` : record.imageUrl,
  };
}

function pageImageMayBeReference(previous, page) {
  return (
    previous?.approved !== false &&
    hasImage(page) &&
    !["draft", "low", "medium"].includes(
      page.imageMeta?.quality || page.imageQuality,
    )
  );
}

/** Places introduced by a prior approved scene become durable layout references. */
function collectPreviousPlaces(previous, state) {
  const records = previousBackgrounds(previous, state);
  const priorPageBindings = {};
  for (const [index, page] of (previous?.pages || []).entries()) {
    let background =
      locationValues(page)
        .map((value) => placeMatch(value, [...records.values()]))
        .find(Boolean) ||
      outlineBackground(previous, page, [...records.values()]);
    const location = text(page.scene?.where || page.scene?.setting || "");
    if (!background && location) {
      const id = `series-place-${previousStoryHash({ location: normalized(location) }).slice(6)}`;
      background = records.get(id) || {
        id,
        name: location,
        description: location,
        aliases: [location],
        introducedInBookId: previous.id,
      };
      records.set(id, background);
    }
    if (!background) continue;
    if (location)
      background.aliases = unique([...(background.aliases || []), location]);
    if (!hasImage(background) && pageImageMayBeReference(previous, page)) {
      Object.assign(background, durableImage(page), {
        referenceSource: "approved-story-page",
        referenceBookId: previous.id,
        referencePageIndex: index,
        referencePageId: page.id || null,
      });
    }
    priorPageBindings[index] = [background.id];
  }
  return { backgrounds: [...records.values()], priorPageBindings };
}

/** Only textual story data goes to a text engine; media stays in image snapshots. */
export function buildPreviousStoryReference(previousBook, state = {}) {
  if (!previousBook) return null;
  const places = collectPreviousPlaces(previousBook, state);
  const reference = {
    id: previousBook.id,
    title: previousBook.title,
    titleEn: previousBook.titleEn,
    series: previousBook.series,
    episode: previousBook.episode,
    outline: safeTextData(previousBook.outline || null),
    sceneBriefs: safeTextData(previousBook.sceneBriefs || []),
    prose: {
      ko:
        previousBook.prose?.ko ||
        previousBook.pages
          ?.map((page) => page.textKo ?? page.ko ?? "")
          .join("\n\n") ||
        "",
      en:
        previousBook.prose?.en ||
        previousBook.pages
          ?.map((page) => page.textEn ?? page.en ?? "")
          .join("\n\n") ||
        "",
    },
    pages: (previousBook.pages || []).map((page, index) => ({
      pageNo: index + 1,
      textKo: page.ko ?? page.textKo ?? "",
      textEn: page.en ?? page.textEn ?? "",
      scene: safeTextData(page.scene || {}),
      beatIndex: page.beatIndex ?? page.scene?.beatIndex,
    })),
    ending: previousBook.outline?.endingType || previousBook.ending,
    summaryForNext: previousBook.summaryForNext || previousBook.summary || "",
    characters: [...previousCharacters(previousBook, state).values()].map(
      (character) => pick(character, CHARACTER_FIELDS),
    ),
    backgrounds: places.backgrounds.map((background) =>
      pick(background, BACKGROUND_FIELDS),
    ),
    worldMemo: previousBook.worldMemo || "",
    factsPolicy:
      "Approved previous-book character identity, relationships, place names, descriptions and layouts remain established facts. The final pages take precedence if they differ from the earlier full prose draft. Original prose is reference material; continue its consequences without repeating its sentences.",
  };
  const cleaned = safeTextData(reference);
  cleaned.contentHash = previousStoryHash(cleaned);
  return cleaned;
}

/** Current material edits must not silently rename a returning series character. */
export function buildSeriesStorySelections(
  state,
  wizard = {},
  previousBook = null,
) {
  const priorCharacters = previousCharacters(previousBook, state),
    places = collectPreviousPlaces(previousBook, state).backgrounds;
  const characters = unique(wizard.characterIds || [])
    .map(
      (id) =>
        priorCharacters.get(id) ||
        state.characters?.find((character) => character.id === id),
    )
    .filter(Boolean)
    .map((character) => pick(character, CHARACTER_FIELDS));
  const selectedBackgroundIds =
    wizard.backgroundIds || previousBook?.backgroundIds || [];
  const backgrounds = unique(selectedBackgroundIds)
    .map(
      (id) =>
        places.find((background) => background.id === id) ||
        state.backgrounds?.find((background) => background.id === id),
    )
    .filter(Boolean)
    .map((background) => pick(background, BACKGROUND_FIELDS));
  // Include established places from prior scenes even if they were not manual material selections.
  for (const background of places)
    if (!backgrounds.some((item) => item.id === background.id))
      backgrounds.push(pick(background, BACKGROUND_FIELDS));
  const world =
    state.worlds?.find(
      (item) =>
        item.id === previousBook?.generationSnapshot?.worldId ||
        item.id === previousBook?.worldId,
    ) || getActiveWorld(state);
  const worldNotes = unique([
    previousBook?.worldMemo,
    wizard.worldMemo,
    world.memo ||
      world.notes ||
      world.description ||
      state.settings?.worldNotes ||
      "",
  ]).join("\n");
  return {
    characters,
    backgrounds,
    worldNotes,
    previousStory: buildPreviousStoryReference(previousBook, state),
  };
}

function freezeExplicitVariants(
  state,
  book,
  wizard,
  characterSheets,
  previousSnapshot,
  world,
) {
  const characterVariants = {},
    variantPageRanges = {},
    variants = [],
    count = Number(book.pages?.length || book.pageCount || 12);
  const requested = own(wizard, "characterVariants")
    ? wizard.characterVariants
    : book.characterVariants || {};
  const requestedRanges = own(wizard, "variantPageRanges")
    ? wizard.variantPageRanges
    : book.variantPageRanges || {};
  for (const sheet of characterSheets) {
    const id = sheet.characterId;
    characterVariants[id] = requested?.[id] || null;
    const ranges = (requestedRanges?.[id] || []).map((row) => ({
      from: Number(row.from),
      to: Number(row.to),
      variantId: row.variantId || null,
    }));
    const sorted = [...ranges].sort((a, b) => a.from - b.from);
    if (
      ranges.some(
        (row) =>
          !Number.isInteger(row.from) ||
          !Number.isInteger(row.to) ||
          row.from < 1 ||
          row.to < row.from ||
          row.to > count,
      ) ||
      sorted.some((row, index) => index && row.from <= sorted[index - 1].to)
    )
      throw new Error(
        "다음 편의 옷장 쪽 범위가 겹치거나 책 범위를 벗어났어요.",
      );
    variantPageRanges[id] = ranges;
    for (const variantId of unique([
      characterVariants[id],
      ...ranges.map((row) => row.variantId),
    ])) {
      const previousVariant = previousSnapshot?.variants?.find(
        (variant) =>
          variant.id === variantId &&
          variant.characterId === id &&
          (!variant.sourceSheetId || variant.sourceSheetId === sheet.id),
      );
      const currentVariant = state.characters
        ?.find((character) => character.id === id)
        ?.wardrobe?.find(
          (variant) =>
            variant.id === variantId &&
            variant.characterId === id &&
            !variant.archivedAt &&
            (!variant.sourceSheetId || variant.sourceSheetId === sheet.id) &&
            (!variant.worldId || variant.worldId === world.id),
        );
      const variant = previousVariant || currentVariant;
      if (
        !variant ||
        variant.refImageIds?.length !== 2 ||
        variant.refImageIds.some((ref) => !ref)
      )
        throw new Error(
          "다음 편에 고른 옷장 모습이 이전 확정 캐릭터와 맞지 않아요. 기본 모습을 고르거나 같은 캐릭터 시트로 다시 만들어 주세요.",
        );
      if (
        !variants.some(
          (item) => item.id === variant.id && item.characterId === id,
        )
      )
        variants.push(clone(variant));
    }
  }
  return { characterVariants, variantPageRanges, variants };
}

/** Map each new page to its own known place, never send every location to every page. */
export function bindSeriesBackgrounds(book, backgrounds) {
  const bindings = {};
  for (const [index, page] of (book.pages || []).entries()) {
    const direct = locationValues(page)
      .map((value) => placeMatch(value, backgrounds))
      .find(Boolean);
    const background = direct || outlineBackground(book, page, backgrounds);
    bindings[index] = background ? [background.id] : [];
  }
  return bindings;
}

/** Mutates only the new book. No old book, material, seed, or image result is copied. */
export function applySeriesContinuity(state, book, previousBook, wizard = {}) {
  if (!previousBook) return book;
  if (previousBook === book || (previousBook.id && previousBook.id === book.id))
    throw new Error("이전 편과 다른 새 책에 이어쓰기 설정을 적용해 주세요.");
  if (previousBook.approved === false)
    throw new Error("부모가 확정한 이전 동화를 골라 주세요.");
  const previousSnapshot = previousBook.generationSnapshot || {};
  const currentWorld =
    state.worlds?.find(
      (world) => world.id === book.worldId || world.id === wizard.worldId,
    ) || getActiveWorld(state);
  const useCurrentStyle =
    wizard.seriesVisualMode === "current" ||
    wizard.useCurrentSeriesStyle === true ||
    wizard.continuityMode === "new-style";
  const priorWorld =
    state.worlds?.find(
      (world) =>
        world.id === previousSnapshot.worldId ||
        world.id === previousBook.worldId,
    ) || currentWorld;
  const previousSheetMap = new Map(
    (previousSnapshot.characterSheets || []).map((sheet) => [
      sheet.characterId,
      sheet,
    ]),
  );
  const characters = previousCharacters(previousBook, state);
  const selectedIds = unique(
    book.characterIds || wizard.characterIds || previousBook.characterIds || [],
  );
  if (!selectedIds.length)
    throw new Error("다음 편에 등장할 친구를 골라 주세요.");
  const sheets = selectedIds.map((id) => {
    const inherited = !useCurrentStyle && previousSheetMap.get(id);
    if (inherited?.confirmedAt && hasImage(inherited)) return clone(inherited);
    const current = getCharacterSheet(state, id, currentWorld);
    if (!current?.confirmedAt || !hasImage(current))
      throw new Error(
        `${characters.get(id)?.name || state.characters?.find((character) => character.id === id)?.name || id}: 다음 편에 사용할 확정 캐릭터 시트가 필요해요.`,
      );
    return clone(current);
  });
  const oldPlaces = collectPreviousPlaces(previousBook, state).backgrounds;
  const selectedBackgroundIds = unique(
    book.backgroundIds ||
      wizard.backgroundIds ||
      previousBook.backgroundIds ||
      [],
  );
  const backgrounds = oldPlaces.map(clone);
  for (const id of selectedBackgroundIds)
    if (!backgrounds.some((background) => background.id === id)) {
      const background = state.backgrounds?.find((item) => item.id === id);
      if (background)
        backgrounds.push(
          getWorldBackgroundSnapshot(
            state,
            background,
            useCurrentStyle ? currentWorld : priorWorld,
          ),
        );
    }
  const imageEngine = !useCurrentStyle
    ? previousSnapshot.imageEngine ||
      previousBook.imageEngine ||
      priorWorld.imageEngine
    : currentWorld.imageEngine;
  const stylePresetId = !useCurrentStyle
    ? previousSnapshot.stylePresetId ||
      previousBook.stylePresetId ||
      priorWorld.stylePresetId
    : currentWorld.stylePresetId;
  const stylePreset =
    !useCurrentStyle && previousSnapshot.stylePreset
      ? clone(previousSnapshot.stylePreset)
      : clone(getStylePreset(stylePresetId));
  const styleReferences =
    !useCurrentStyle && previousSnapshot.styleReferences
      ? clone(previousSnapshot.styleReferences)
      : getWorldStyleReferenceRecords(
          state,
          useCurrentStyle ? currentWorld : priorWorld,
          stylePreset,
        ).map(clone);
  const world = {
    id: previousSnapshot.worldId || previousBook.worldId || priorWorld.id,
    revision: previousSnapshot.worldRevision || priorWorld.revision,
  };
  const variants = freezeExplicitVariants(
    state,
    book,
    wizard,
    sheets,
    previousSnapshot,
    world,
  );
  const changed =
    currentWorld.imageEngine !== imageEngine ||
    currentWorld.stylePresetId !== stylePresetId ||
    Number(currentWorld.revision) !== Number(world.revision);
  const reference = buildPreviousStoryReference(previousBook, state);
  const continuity = {
    previousBookId: previousBook.id,
    previousStoryHash: reference.contentHash,
    usedOriginalPreviousStory: !!(reference.prose.ko || reference.prose.en),
    visualMode: useCurrentStyle ? "parent-selected-current" : "preserve-series",
    inheritedCharacterIds: sheets
      .filter(
        (sheet) => previousSheetMap.get(sheet.characterId)?.id === sheet.id,
      )
      .map((sheet) => sheet.characterId),
    newCharacterIds: sheets
      .filter((sheet) => !previousSheetMap.has(sheet.characterId))
      .map((sheet) => sheet.characterId),
    inheritedBackgroundIds: oldPlaces.map((background) => background.id),
    imageEngine,
    stylePresetId,
    worldSettingsChanged: changed,
    reason:
      !useCurrentStyle && changed
        ? "부모 설정의 엔진·화풍이 바뀌었지만 이 시리즈는 이전 편의 확정 캐릭터·장소·화풍을 이어 사용해요."
        : useCurrentStyle
          ? "부모가 이번 편부터 현재 엔진·화풍을 사용하도록 선택했어요."
          : "이전 편의 확정 캐릭터·장소·화풍을 이어 사용해요.",
  };
  const imageModelConfig = !useCurrentStyle
    ? clone(
        previousSnapshot.imageModelConfig || {
          googlePro:
            previousSnapshot.characterSheets?.some(
              (sheet) => sheet.meta?.model === "gemini-3-pro-image",
            ) || false,
          modelVariant: previousSnapshot.characterSheets?.some(
            (sheet) => sheet.meta?.model === "gemini-3-pro-image",
          )
            ? "pro"
            : "default",
        },
      )
    : { googlePro: currentWorld.imageModelVariant === "pro" };
  const snapshot = {
    imageModelConfig,
    ...world,
    worldId: world.id,
    worldRevision: world.revision,
    imageEngine,
    stylePresetId,
    stylePreset,
    styleReferences,
    characterSheets: sheets,
    backgrounds,
    ...variants,
    backgroundReferenceByPage: bindSeriesBackgrounds(book, backgrounds),
    capturedAt: new Date().toISOString(),
    continuity: clone(continuity),
  };
  // Do not inherit generation seeds or prior rendered page images into a new page.
  book.worldId = snapshot.worldId;
  book.imageEngine = imageEngine;
  book.stylePresetId = stylePresetId;
  book.generationSnapshot = snapshot;
  book.previousBookId = previousBook.id;
  book.continuity = continuity;
  book.characterSnapshots = sheets.map((sheet) =>
    clone(
      sheet.characterSnapshot ||
        characters.get(sheet.characterId) || { id: sheet.characterId },
    ),
  );
  book.backgroundSnapshots = backgrounds.map(clone);
  book.characterVariants = clone(variants.characterVariants);
  book.variantPageRanges = clone(variants.variantPageRanges);
  return book;
}
