import { buildScenePrompt, sceneBriefText } from "./scene-prompt.js";
import { seedForPage } from "../story-generation/staging.js";
import { pagePlace, previousSceneReferences } from "./scene-continuity.js";
import { characterSVG } from "../engine.js";
import { getStylePreset, validateStylePreset } from "./styles.js";
import { getImageURL } from "./assets.js";
import { layoutOf, unitImageSize } from "../book-layout.js";

const ENGINES = new Set(["google", "openai", "bfl", "fal", "local", "sample"]);
const clone = (value) => JSON.parse(JSON.stringify(value));
const uid = (prefix) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
const now = () => new Date().toISOString();
const svgURL = (svg) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const engineId = (value) => (ENGINES.has(value) ? value : "sample");
const characterById = (state, input) =>
  typeof input === "object"
    ? input
    : state.characters.find((character) => character.id === input);

function newSeed() {
  if (globalThis.crypto?.getRandomValues)
    return (
      globalThis.crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff
    );
  return Math.floor(Math.random() * 0x7fffffff);
}

function seedValue(value) {
  if (value === undefined || value === null || value === "") return newSeed();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 0x7fffffff)
    throw new Error("시드는 0부터 2147483647 사이 정수여야 해요.");
  return number;
}

function isCurrentSheet(sheet, world) {
  return (
    sheet?.confirmedAt &&
    sheet.imageUrl &&
    sheet.worldId === world.id &&
    sheet.worldRevision === world.revision &&
    sheet.imageEngine === world.imageEngine &&
    sheet.stylePresetId === world.stylePresetId
  );
}

function referenceURL(sheet) {
  const assetId =
    sheet.imageAssetId ||
    (sheet.imageUrl?.startsWith("asset:") ? sheet.imageUrl.slice(6) : null);
  if (!assetId) return sheet.imageUrl;
  const url = getImageURL(assetId);
  if (!url)
    throw new Error(
      "참조 시트 이미지를 불러오는 중이에요. 잠시 후 다시 시도해 주세요.",
    );
  return url;
}

/** Store durable IDs in snapshots; resolve object URLs only at provider-call time. */
export function getWorldStyleReferenceRecords(
  state,
  world = getActiveWorld(state),
  preset = getStylePreset(world.stylePresetId),
) {
  const ids = (
    world.styleSheetImageIds?.length
      ? world.styleSheetImageIds
      : preset.styleRefImageIds || []
  )
    .filter(
      (id) =>
        world.imageEngine === "sample" ||
        state.styleSheetImages?.find(
          (record) => record.imageAssetId === id || record.id === id,
        )?.meta?.generationMode !== "offline-template",
    )
    .slice(0, 2);
  if (ids.length)
    return ids.map((id) => {
      const record = state.styleSheetImages?.find(
        (item) => item.id === id || item.imageAssetId === id,
      );
      const assetId = record?.imageAssetId || id;
      return {
        ...clone(record || {}),
        imageAssetId: assetId,
        imageUrl: `asset:${assetId}`,
      };
    });
  return (preset.styleRefImages || []).map((imageUrl) => ({ imageUrl }));
}

export function getWorldStyleReferences(
  state,
  world = getActiveWorld(state),
  preset = getStylePreset(world.stylePresetId),
) {
  return getWorldStyleReferenceRecords(state, world, preset).map(
    (record, index) => ({
      imageUrl: referenceURL(record),
      role: "style_sheet",
      label: `authoritative style ${index + 1}`,
    }),
  );
}

/** Request text, flattened for the forbidden-name check. */
const suppliedText = (...values) =>
  values
    .flat(Infinity)
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) =>
      typeof value === "string" ? value : JSON.stringify(value),
    );
/**
 * The one scope mapping every image request uses (sheet, wardrobe, scene,
 * cover, place sheet): `strict` is text a parent typed, `lenient` is
 * model-written story text, `names` are cast names. Anything else in the
 * prompt is app scaffolding and is never checked. The provider and the
 * wardrobe pre-check both read it with checkForbiddenWordCheck.
 */
export const imageWordCheck = ({ strict = [], lenient = [], names = [] } = {}) => ({
  text: suppliedText(strict),
  generated: suppliedText(lenient),
  names: suppliedText(names),
});
/**
 * A friend or place FULL AUTO wrote is model text until a parent edits it
 * (management stamps parentEditedAt): its fields go to the lenient parts, so
 * a planned "Frozen Lake" on a winter topic is drawn. Anything else is strict.
 */
export const modelWrittenMaterial = (item) =>
  item?.source === "full-auto" && !item.parentEditedAt;
export const materialWordScope = (item, parts) =>
  modelWrittenMaterial(item)
    ? { strict: [], lenient: parts }
    : { strict: parts, lenient: [] };
/**
 * Names of every character in the drawer. Parent-typed text gets no name
 * exemption, so for a sheet or a wardrobe they only shape the advice
 * ("토토로부터" → "토토에게서").
 */
export const castNames = (state) =>
  suppliedText(
    (state?.characters || []).map((character) => [
      character?.name,
      character?.nameEn,
    ]),
  );
/**
 * The book's own cast, from its frozen sheets and its character list: the
 * names that exempt "토토로 달려가요" (토토 + particle) in the book's story
 * text, the same for every page and the cover.
 */
export function bookCastNames(state, book, snapshot = book?.generationSnapshot) {
  const sheets = Array.isArray(snapshot?.characterSheets)
    ? snapshot.characterSheets
    : [];
  return [
    ...new Set(
      suppliedText(
        sheets.map((sheet) => [
          sheet?.characterSnapshot?.name,
          sheet?.characterSnapshot?.nameEn,
        ]),
        (Array.isArray(book?.characterIds) ? book.characterIds : []).map(
          (id) => {
            const frozen = sheets.find((sheet) => sheet?.characterId === id)
              ?.characterSnapshot;
            const character =
              frozen || (state?.characters || []).find((c) => c?.id === id);
            return [character?.name, character?.nameEn];
          },
        ),
      ),
    ),
  ];
}
/**
 * The cover action is parent text once the parent changed it from the
 * planned one (`pagination.coverSceneActionGenerated`, recorded at the first
 * edit). Without that record it counts as generated.
 */
export function coverActionEditedByParent(book) {
  const pagination = book?.pagination,
    current = pagination?.cover?.sceneAction,
    original = pagination?.coverSceneActionGenerated;
  return (
    typeof current === "string" &&
    typeof original === "string" &&
    current.trim() !== original.trim()
  );
}

function variantForPage(snapshot, characterId, pageNumber) {
  const range = (snapshot.variantPageRanges?.[characterId] || []).find(
    (row) => pageNumber >= row.from && pageNumber <= row.to,
  );
  const id = range
    ? range.variantId
    : snapshot.characterVariants?.[characterId];
  return id
    ? snapshot.variants?.find(
        (variant) => variant.id === id && variant.characterId === characterId,
      ) || null
    : null;
}

function freezeBookVariants(state, book, world, sheets) {
  const characterVariants = {},
    variantPageRanges = {},
    variants = [];
  const count = Number(book.pageCount || book.pages?.length || 12);
  for (const sheet of sheets) {
    const id = sheet.characterId,
      character = state.characters.find((c) => c.id === id);
    const selected = book.characterVariants?.[id] || null;
    const rows = (book.variantPageRanges?.[id] || []).map((row) => ({
      from: Number(row.from),
      to: Number(row.to),
      variantId: row.variantId || null,
    }));
    const sorted = [...rows].sort((a, b) => a.from - b.from);
    if (
      rows.some(
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
        "옷장 쪽 범위를 확인해 주세요. 범위는 책 안에 있어야 하고 같은 등장인물의 범위끼리 겹칠 수 없어요.",
      );
    characterVariants[id] = selected;
    variantPageRanges[id] = rows;
    for (const variantId of new Set(
      [selected, ...rows.map((row) => row.variantId)].filter(Boolean),
    )) {
      const variant = character?.wardrobe?.find(
        (item) =>
          item.id === variantId && item.characterId === id && !item.archivedAt,
      );
      if (
        !variant ||
        variant.refImageIds?.length !== 2 ||
        variant.refImageIds.some((ref) => !ref) ||
        (variant.worldId && variant.worldId !== world.id) ||
        (variant.worldRevision && variant.worldRevision !== world.revision) ||
        (variant.sourceSheetId && variant.sourceSheetId !== sheet.id)
      )
        throw new Error(
          "옷장 모습이 현재 기본 시트와 맞지 않아요. 기본 모습을 고르거나 옷장 모습을 다시 생성해 주세요.",
        );
      variants.push(clone(variant));
    }
  }
  return { characterVariants, variantPageRanges, variants };
}

/** Front identity is always retained. Variants replace only the full-body slot. */
export function sceneReferenceRecords(snapshot, pageIndex) {
  const sheets = snapshot.characterSheets || [],
    fronts = [],
    bodies = [];
  for (const sheet of sheets) {
    const label =
      sheet.characterSnapshot?.nameEn ||
      sheet.characterSnapshot?.name ||
      sheet.characterId;
    fronts.push({
      imageAssetId: sheet.frontImageAssetId || sheet.imageAssetId || null,
      imageUrl: sheet.frontImageUrl || sheet.imageUrl,
      role: "character_front",
      label: `${label} original face and identity`,
    });
    const variant = variantForPage(snapshot, sheet.characterId, pageIndex + 1);
    if (variant)
      variant.refImageIds.forEach((id, index) =>
        bodies.push({
          imageAssetId: id,
          imageUrl: `asset:${id}`,
          role: "character_variant",
          label: `${label}: ${variant.name}, ${index ? "full body" : "front"}, ${variant.description}`,
          variantId: variant.id,
        }),
      );
    else
      bodies.push({
        imageAssetId: sheet.fullImageAssetId || sheet.imageAssetId || null,
        imageUrl: sheet.fullImageUrl || sheet.imageUrl,
        role: "character_full",
        label: `${label} original full body and clothes`,
      });
  }
  const style = (
    snapshot.styleReferences ||
    (snapshot.stylePreset?.styleRefImages || []).map((imageUrl) => ({
      imageUrl,
    }))
  ).map((record, index) => ({
    ...clone(record),
    role: "style_sheet",
    label: `authoritative rendering style ${index + 1}`,
  }));
  const pagePlaces = snapshot.backgroundReferenceByPage?.[pageIndex];
  const backgrounds = (snapshot.backgrounds || [])
    .filter(
      (background) =>
        (!Array.isArray(pagePlaces) || pagePlaces.includes(background.id)) &&
        (background.imageAssetId || background.imageUrl),
    )
    .map((background) => ({
      ...clone(background),
      role: "background",
      label: `background layout: ${background.nameEn || background.name || "original place"}`,
    }));
  return [...fronts, ...bodies, ...style, ...backgrounds];
}

export function getCharacterSheet(
  state,
  characterId,
  world = getActiveWorld(state),
) {
  const character = characterById(state, characterId);
  if (character?.sheetStale) return null;
  const matches = (sheet) =>
    isCurrentSheet(sheet, world) &&
    (Number(sheet.characterSnapshot?.version) || 1) ===
      (Number(character?.version) || 1);
  return (
    character?.characterSheets?.findLast?.(matches) ||
    [...(character?.characterSheets || [])].reverse().find(matches) ||
    null
  );
}

function updateStaleStatus(state, world) {
  world.characterSheetsStale = world.characterIds.some(
    (id) =>
      !state.characters.find((c) => c.id === id)?.archivedAt &&
      !getCharacterSheet(state, id, world),
  );
  if (!world.characterSheetsStale) delete world.styleUpgradeNotice;
  return world.characterSheetsStale;
}

/** Upgrade an existing local library without losing its approved sample art. */
export function migrateWorldState(state) {
  state.settings ||= {};
  state.characters ||= [];
  state.books ||= [];
  const legacy = !Array.isArray(state.worlds) || !state.worlds.length;
  if (legacy)
    state.worlds = [
      {
        id: "world-home",
        name: state.settings.worldName || "우리 집 작은 세계",
        imageEngine: engineId(state.settings.imageEngine),
        stylePresetId: getStylePreset(
          state.settings.stylePresetId || state.settings.style,
        ).id,
        stylePresetVersion:
          getStylePreset(state.settings.stylePresetId || state.settings.style)
            .version || 1,
        characterIds: state.characters.map((character) => character.id),
        revision: 1,
        characterSheetsStale: false,
        createdAt: now(),
      },
    ];
  for (const world of state.worlds) {
    world.id ||= uid("world");
    world.name ||= "우리 집 작은 세계";
    world.imageEngine = engineId(world.imageEngine);
    world.imageModelVariant ||=
      world.imageEngine === "google" &&
      (world.providerConfig?.google?.googlePro ||
        world.providerConfig?.google?.modelVariant === "pro")
        ? "pro"
        : "default";
    world.stylePresetId = getStylePreset(world.stylePresetId).id;
    world.characterIds = Array.isArray(world.characterIds)
      ? [...new Set(world.characterIds)]
      : state.characters.map((character) => character.id);
    world.revision = Math.max(1, Math.floor(Number(world.revision) || 1));
    const currentStyleVersion =
      getStylePreset(world.stylePresetId).version || 1;
    if (!legacy && (world.stylePresetVersion || 1) < currentStyleVersion) {
      world.revision += 1;
      world.styleUpgradeNotice =
        world.stylePresetId === "watercolor"
          ? "수채화 기준을 커버의 실제 이미지로 업데이트했어요. 기존 플랫 시트를 새 화풍으로 다시 생성해 주세요."
          : getStylePreset(world.stylePresetId).name +
            " 화풍 기준을 업데이트했어요. 캐릭터 시트를 다시 생성해 주세요.";
      world.characterSheetsStale = true;
    }
    world.stylePresetVersion = currentStyleVersion;
    world.createdAt ||= now();
    world.characterSheetsStale = !!world.characterSheetsStale;
  }
  if (!state.worlds.some((world) => world.id === state.activeWorldId))
    state.activeWorldId = state.worlds[0].id;
  for (const character of state.characters) {
    character.characterSheets = Array.isArray(character.characterSheets)
      ? character.characterSheets
      : [];
    if (
      legacy &&
      character.approved !== false &&
      !character.characterSheets.length
    ) {
      const world = state.worlds[0];
      const requestedSeed = seedValue(character.sheetSeed);
      character.characterSheets.push({
        id: uid("sheet"),
        characterId: character.id,
        worldId: world.id,
        worldRevision: world.revision,
        imageEngine: world.imageEngine,
        stylePresetId: world.stylePresetId,
        imageUrl: svgURL(characterSVG(character, character.variant || 0)),
        seed: null,
        requestedSeed,
        meta: {
          source: "local-svg",
          legacySample: true,
          originalDrawing: true,
          requestedSeed,
          returnedSeed: null,
          seedSupported: false,
        },
        characterSnapshot: clone({ ...character, characterSheets: undefined }),
        confirmedAt: now(),
      });
      character.sheetSeed = requestedSeed;
    }
  }
  // Existing books retain the generation settings and cast appearance they had
  // when imported. Later World changes cannot rewrite their reference images.
  if (legacy)
    for (const book of state.books) {
      book.worldId ||= state.activeWorldId;
      try {
        captureBookGenerationSnapshot(state, book);
      } catch {
        /* incomplete drafts stay unbound */
      }
    }
  for (const world of state.worlds) updateStaleStatus(state, world);
  state.version = Math.max(Number(state.version) || 1, 2);
  return state;
}

export function getActiveWorld(state) {
  if (!state.worlds?.length) migrateWorldState(state);
  return (
    state.worlds.find((world) => world.id === state.activeWorldId) ||
    state.worlds[0]
  );
}

/** A shared place has a separately approved rendering in each World. */
export function getWorldBackgroundSnapshot(
  state,
  background,
  world = getActiveWorld(state),
) {
  const result = clone(background);
  delete result.backgroundHistory;
  delete result.backgroundSheets;
  const facts = JSON.stringify({
    name: background.name,
    type: background.type,
    description: background.description || background.features || "",
    layout: background.layout || "",
  });
  const matching = (sheet) =>
    sheet.confirmedAt &&
    sheet.meta?.worldId === world.id &&
    sheet.meta?.worldRevision === world.revision &&
    sheet.meta?.imageEngine === world.imageEngine &&
    sheet.meta?.stylePresetId === world.stylePresetId &&
    sheet.settings === facts;
  const sheet = [...(background.backgroundSheets || [])]
    .reverse()
    .find(matching);
  if (sheet)
    return {
      ...result,
      imageAssetId: sheet.imageAssetId,
      imageUrl: sheet.imageUrl,
      backgroundSheetMeta: clone(sheet.meta),
      backgroundSheetSeed: sheet.seed,
      backgroundSheetConfirmedAt: sheet.confirmedAt,
      backgroundSheetStale: false,
    };
  const importedMeta = background.imageMeta;
  const importedChanged =
    importedMeta?.worldId &&
    (importedMeta.worldId !== world.id ||
      importedMeta.worldRevision !== world.revision ||
      importedMeta.engine !== world.imageEngine ||
      importedMeta.stylePresetId !== world.stylePresetId ||
      Number(background.version || 1) > 1);
  if (background.backgroundSheetMeta || importedChanged) {
    delete result.imageAssetId;
    delete result.imageUrl;
    result.backgroundSheetStale = true;
  }
  return result;
}

/** Settings are World-scoped; confirmed sheets remain as immutable history. */
export function updateWorldGenerationSettings(
  state,
  { imageEngine, stylePresetId, modelVariant },
) {
  const world = getActiveWorld(state);
  const nextEngine =
    imageEngine === undefined ? world.imageEngine : imageEngine;
  if (!ENGINES.has(nextEngine))
    throw new Error("지원하지 않는 이미지 엔진이에요.");
  const preset =
    stylePresetId === undefined
      ? getStylePreset(world.stylePresetId)
      : getStylePreset(stylePresetId);
  if (stylePresetId !== undefined && preset.id !== stylePresetId)
    throw new Error("지원하지 않는 화풍 프리셋이에요.");
  const validation = validateStylePreset(preset);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  const nextVariant =
    nextEngine === "google" &&
    (modelVariant === "pro" ||
      (modelVariant === undefined &&
        (world.providerConfig?.google?.googlePro ||
          world.providerConfig?.google?.modelVariant === "pro")))
      ? "pro"
      : "default";
  const priorVariant =
    world.imageModelVariant ||
    (world.imageEngine === "google" && world.providerConfig?.google?.googlePro
      ? "pro"
      : "default");
  const changed =
    world.imageEngine !== nextEngine ||
    world.stylePresetId !== preset.id ||
    priorVariant !== nextVariant;
  const hadConfirmedSheets = world.characterIds.some((id) =>
    state.characters
      .find((character) => character.id === id)
      ?.characterSheets?.some(
        (sheet) => sheet.worldId === world.id && sheet.confirmedAt,
      ),
  );
  if (changed) {
    if (world.stylePresetId !== preset.id)
      world.styleSheetImageIds = [
        ...(state.stylePresetSelections?.[world.id]?.[preset.id] ||
          preset.styleRefImageIds ||
          []),
      ].slice(0, 2);
    world.imageEngine = nextEngine;
    world.imageModelVariant = nextVariant;
    world.stylePresetId = preset.id;
    world.stylePresetVersion = preset.version || 1;
    world.revision += 1;
    world.updatedAt = now();
    world.characterSheetsStale = hadConfirmedSheets;
  }
  return {
    changed,
    requiresRegeneration: changed && hadConfirmedSheets,
    world,
  };
}

/** Call only after the parent approves a generated sheet. Never overwrite one. */
export function markCharacterSheetConfirmed(state, characterId, sheetResult) {
  const world = getActiveWorld(state);
  const character = characterById(state, characterId);
  if (!character?.id) throw new Error("캐릭터를 먼저 저장해 주세요.");
  if (!sheetResult?.imageUrl || typeof sheetResult.imageUrl !== "string")
    throw new Error("확정할 캐릭터 시트 이미지가 필요해요.");
  const metadata = clone(sheetResult.meta || {});
  if (
    (metadata.worldRevision !== undefined &&
      metadata.worldRevision !== world.revision) ||
    (metadata.worldId && metadata.worldId !== world.id) ||
    (metadata.engine && metadata.engine !== world.imageEngine) ||
    (metadata.stylePresetId && metadata.stylePresetId !== world.stylePresetId)
  )
    throw new Error(
      "생성 중 세계 설정이 바뀌었어요. 현재 설정으로 시트를 다시 만들어 주세요.",
    );
  const characterSnapshot = metadata.characterSnapshot || {
    ...character,
    characterSheets: undefined,
  };
  if (
    metadata.characterSnapshot &&
    [
      "name",
      "nameEn",
      "kind",
      "description",
      "appearance",
      "clothes",
      "color",
      "hairColor",
      "skinColor",
    ].some((field) => metadata.characterSnapshot[field] !== character[field])
  )
    throw new Error(
      "생성 중 캐릭터 모습이 바뀌었어요. 현재 모습으로 시트를 다시 만들어 주세요.",
    );
  const effectiveSeed =
    sheetResult.seed === undefined || sheetResult.seed === null
      ? null
      : seedValue(sheetResult.seed);
  const requestedSeed = seedValue(
    metadata.requestedSeed ?? effectiveSeed ?? character.sheetSeed,
  );
  metadata.requestedSeed = requestedSeed;
  metadata.returnedSeed = effectiveSeed;
  metadata.seed = effectiveSeed;
  const sheet = {
    id: uid("sheet"),
    characterId: character.id,
    worldId: world.id,
    worldRevision: world.revision,
    imageEngine: world.imageEngine,
    stylePresetId: world.stylePresetId,
    imageAssetId: sheetResult.imageAssetId || null,
    imageUrl: sheetResult.imageAssetId
      ? `asset:${sheetResult.imageAssetId}`
      : sheetResult.imageUrl,
    seed: effectiveSeed,
    requestedSeed,
    meta: metadata,
    characterSnapshot: clone(characterSnapshot),
    confirmedAt: now(),
  };
  character.characterSheets ||= [];
  character.characterSheets.push(sheet);
  character.sheetSeed = requestedSeed;
  character.sheetImageUrl = sheet.imageUrl;
  character.sheetConfirmedAt = sheet.confirmedAt;
  character.sheetStale = false;
  if (!world.characterIds.includes(character.id))
    world.characterIds.push(character.id);
  updateStaleStatus(state, world);
  return sheet;
}

/** One book locks one World revision, all cast sheets and the exact style row. */
export function captureBookGenerationSnapshot(state, book) {
  if (book.generationSnapshot) return book.generationSnapshot;
  const world =
    book.worldSettingsSnapshot ||
    state.worlds?.find((item) => item.id === book.worldId) ||
    getActiveWorld(state);
  const ids = [...new Set(book.characterIds || [])];
  if (!ids.length)
    throw new Error("이야기에 등장할 캐릭터를 먼저 골라 주세요.");
  const sheets = ids.map((id) => {
    const sheet = getCharacterSheet(state, id, world);
    if (!sheet)
      throw new Error(
        "시트 다시 생성 필요: 선택한 캐릭터의 현재 엔진·화풍 시트를 생성하고 확정해 주세요.",
      );
    return clone(sheet);
  });
  const preset = getStylePreset(world.stylePresetId);
  const validation = validateStylePreset(preset);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  book.worldId = world.id;
  book.imageEngine = world.imageEngine;
  book.stylePresetId = world.stylePresetId;
  book.generationSnapshot = {
    worldId: world.id,
    worldRevision: world.revision,
    imageEngine: world.imageEngine,
    stylePresetId: world.stylePresetId,
    stylePreset: clone(preset),
    characterSheets: sheets,
    imageModelConfig: {
      googlePro:
        world.imageModelVariant === "pro" ||
        (!world.imageModelVariant &&
          world.providerConfig?.google?.googlePro === true),
      modelVariant: world.imageModelVariant === "pro" ? "pro" : "default",
    },
    styleReferences: getWorldStyleReferenceRecords(state, world, preset).map(
      clone,
    ),
    ...freezeBookVariants(state, book, world, sheets),
    backgrounds: (book.backgroundIds || [])
      .map((id) => state.backgrounds?.find((b) => b.id === id))
      .filter(Boolean)
      .map((background) =>
        getWorldBackgroundSnapshot(state, background, world),
      ),
    capturedAt: now(),
  };
  return book.generationSnapshot;
}

export function createCharacterSheetRequest(state, characterId, options = {}) {
  const world = getActiveWorld(state);
  const character = characterById(state, characterId);
  if (!character) throw new Error("캐릭터를 찾을 수 없어요.");
  const preset = getStylePreset(world.stylePresetId);
  const previousSheet = [...(character.characterSheets || [])]
    .reverse()
    .find(
      (sheet) =>
        sheet.confirmedAt &&
        sheet.imageUrl &&
        sheet.meta?.source !== "local-svg" &&
        sheet.meta?.generationMode !== "offline-template",
    );
  const identity = [
    character.name,
    character.nameEn,
    character.kind,
    character.description,
    character.appearance,
    character.clothes,
    `body/clothing color ${character.color || ""}`,
    `hair color ${character.hairColor || ""}`,
    `skin color ${character.skinColor || ""}`,
  ]
    .filter(Boolean)
    .join("; ");
  const styleReferences = getWorldStyleReferences(state, world, preset);
  return {
    // Character fields are parent text: strict, each on its own, no name exemption
    // ("토토로부터" is refused here and in every scene that would draw it). A friend
    // FULL AUTO wrote and no parent edited is story text (lenient).
    forbiddenWordCheck: imageWordCheck({
      ...materialWordScope(character, [
        character.name,
        character.nameEn,
        character.kind,
        character.description,
        character.appearance,
        character.clothes,
      ]),
      names: castNames(state),
    }),
    prompt: `Create a coherent character reference sheet for this original storybook character: ${identity}. Show a front full-body view, side full-body view, back full-body view, four face expressions (joy, surprise, sadness, upset), and two action poses (walking and waving) on one clean neutral background. Keep the exact face, proportions, hairstyle, requested clothing and colors consistent in every view. ${previousSheet ? "The FIRST attached image is identity-only: preserve recognizable facial and clothing features, but do NOT copy its drawing medium, flat geometric simplification, texture, outlines or shading. All later images are authoritative STYLE references." : "All attached images are authoritative STYLE references, not a request to copy their characters, clothes or scene."} Repaint every view from scratch in the selected visual style. Style reference rendering takes priority over the old sheet rendering. No labels, text, English view names, captions or diagrams.`,
    stylePreset: clone(preset),
    referenceImages: [
      ...(previousSheet
        ? [
            {
              imageUrl: referenceURL(previousSheet),
              role: "character_front",
              label: `${character.nameEn || character.name} identity, repaint in current style`,
            },
          ]
        : []),
      ...styleReferences,
    ],
    seed: seedValue(options.seed ?? character.sheetSeed),
    size: options.size || "1536x1024",
    quality: options.quality || "high",
    ...(world.imageEngine === "sample"
      ? {
          sampleContext: {
            kind: "sheet",
            character: clone({
              ...character,
              characterSheets: undefined,
              characterHistory: undefined,
            }),
          },
        }
      : {}),
  };
}

/** Every scene sends all selected character sheets AND original style images. */
/** R12 openings: the spread or page sentence of the non-scene prompt. */
function openingFallbackSentence(page) {
  return page?.kind === "spread"
    ? "Wide double-page spread in one continuous scene. The book's fold runs down the vertical centre line: keep every face, hand and the key action out of the middle tenth and balance the scene across both halves. Draw ONLY the single moment in the scene; the narrative on this spread may include lead-in and follow-up sentences, which are context, not extra moments."
    : `This is the ${page?.side === "right" ? "right" : "left"} page of a two-page opening; keep faces and hands a tenth of the width away from the ${page?.side === "right" ? "left" : "right"} (binding) edge. Draw ONLY the single moment in the scene; the narrative on this page may include lead-in and follow-up sentences, which are context, not extra moments.`;
}
export function sceneGenerationRequest(state, book, pageIndex, options = {}) {
  const page = book.pages?.[pageIndex];
  if (!page) throw new Error("이야기 쪽을 찾을 수 없어요.");
  const snapshot = captureBookGenerationSnapshot(state, book);
  const preset = clone(
    snapshot.stylePreset || getStylePreset(snapshot.stylePresetId),
  );
  const validation = validateStylePreset(preset);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  const sheets = options.cover
    ? snapshot.characterSheets?.filter(
        (sheet) =>
          sheet.characterId ===
          (book.characterIds?.[0] ||
            snapshot.characterSheets?.[0]?.characterId),
      )
    : snapshot.characterSheets;
  if (
    !Array.isArray(sheets) ||
    !sheets.length ||
    sheets.some((sheet) => !sheet.confirmedAt || !sheet.imageUrl)
  )
    throw new Error("확정된 캐릭터 시트가 모두 필요해요.");
  const cast = sheets
    .map(
      (sheet, index) =>
        `${index + 1}: ${sheet.characterSnapshot?.name || sheet.characterSnapshot?.nameEn || sheet.characterId} (${sheet.characterSnapshot?.description || sheet.characterSnapshot?.kind || "original storybook character"})`,
    )
    .join("; ");
  const scene =
    page.imagePrompt ||
    page.scene?.action ||
    page.scene?.prompt ||
    page.ko ||
    page.en ||
    book.topic ||
    "";
  const requestSeed = seedValue(
    options.seed ??
      (options.cover
        ? seedForPage(book.id, 0)
        : (page.staging?.seed ?? page.imageSeed)),
  );
  const place = pagePlace(book, snapshot, pageIndex);
  const references = [
    ...sceneReferenceRecords(
      {
        ...snapshot,
        characterSheets: sheets,
        backgroundReferenceByPage: {
          ...snapshot.backgroundReferenceByPage,
          [pageIndex]: place.background ? [place.background.id] : [],
        },
      },
      pageIndex,
    ).map((ref) => ({
      ...ref,
      ...(ref.role === "background" ? { required: true } : {}),
    })),
    ...(options.cover
      ? []
      : previousSceneReferences(book, snapshot, pageIndex)),
  ];
  const roleDescriptions = references
    .map(
      (reference, index) =>
        `Image ${index + 1}: ${reference.role}, ${reference.label}`,
    )
    .join("; ");
  const placeFacts = place.background
    ? [
        {
          name: place.background.name,
          description:
            place.background.description || place.background.features,
          layout: place.background.layout,
          rules: place.background.rules,
        },
      ]
    : [];
  // R12 openings: scenes of every earlier entry but the text of the previous
  // entry only, so prompts (and the stored request) do not grow as O(n²).
  const openings = layoutOf(book) === "openings";
  const earlierPages = (book.pages || [])
    .slice(0, pageIndex)
    .map((prior, index) =>
      openings && index !== pageIndex - 1
        ? {
            pageNo: index + 1,
            samePlace: pagePlace(book, snapshot, index).key === place.key,
            scene: prior.scene,
          }
        : {
            pageNo: index + 1,
            samePlace: pagePlace(book, snapshot, index).key === place.key,
            textKo: prior.ko ?? prior.textKo ?? "",
            textEn: prior.en ?? prior.textEn ?? "",
            scene: prior.scene,
          },
    );
  const selectedVariants = sheets
    .map((sheet) => variantForPage(snapshot, sheet.characterId, pageIndex + 1))
    .filter(Boolean);
  const background = place.background || {};
  // Forbidden names are checked in these parts only, never in the fixed instructions or the plot ledger.
  // Strict (parent text): character, wardrobe and place descriptions, a page's own image prompt,
  // a cover action the parent edited. Lenient (story text): page text, the planned scene action,
  // a planned cover action, the scene brief, earlier pages' text and scenes, and a friend or
  // place FULL AUTO wrote that no parent edited. The book's cast names, the same for pages and the cover, exempt "토토로 달려가요"
  // (토토 + particle) in the lenient parts only.
  const pageImagePrompt = options.cover ? null : page.imagePrompt || null;
  const coverAction = book.pagination?.cover?.sceneAction,
    coverByParent =
      !!options.cover &&
      typeof coverAction === "string" &&
      !!coverAction.trim() &&
      coverActionEditedByParent(book);
  const usesScenePrompt = !!(
    options.cover ||
    page.staging ||
    book.sceneBriefs?.length
  );
  const materials = [
    ...sheets.map((sheet) =>
      materialWordScope(sheet.characterSnapshot, [
        sheet.characterSnapshot?.name,
        sheet.characterSnapshot?.nameEn,
        sheet.characterSnapshot?.description,
      ]),
    ),
    materialWordScope(background, [
      background.name,
      background.nameEn,
      background.description,
      background.descriptionEn,
      background.features,
      background.featuresEn,
      background.layout,
      background.layoutEn,
      background.rules,
    ]),
  ];
  const forbiddenWordCheck = imageWordCheck({
    strict: [
      materials.map((part) => part.strict),
      selectedVariants.map((variant) => [variant.name, variant.description]),
      pageImagePrompt,
      coverByParent ? coverAction : null,
    ],
    lenient: [
      materials.map((part) => part.lenient),
      // Earlier pages' text and scenes ride along as continuity in every later prompt.
      earlierPages.map((prior) => [prior.textKo, prior.textEn, prior.scene]),
      options.cover
        ? coverByParent
          ? null
          : coverAction || book.topic || book.title
        : [
            pageImagePrompt ? null : scene,
            page.ko ?? page.textKo,
            page.en ?? page.textEn,
          ],
      usesScenePrompt ? sceneBriefText(book, page) : null,
    ],
    names: bookCastNames(state, book, snapshot),
  });
  return {
    forbiddenWordCheck,
    prompt:
      usesScenePrompt
        ? buildScenePrompt({
            book,
            page,
            pageIndex,
            snapshot: { ...snapshot, characterSheets: sheets },
            place,
            variants: selectedVariants,
            earlierPages,
            cover: !!options.cover,
          })
        : `Illustrate page ${pageIndex + 1} of an original children's picture book. Scene: ${scene}. Scene context: ${JSON.stringify(page.scene || {})}. Selected original cast: ${cast}. Reference roles in transmission order: ${roleDescriptions}. Keep the exact face, age and body proportions from each character_front reference. Use character_variant clothes, accessories or hair for this page when present, replacing that character's original full-body clothing; otherwise retain original clothes. ${selectedVariants.length ? `This page's requested variants: ${selectedVariants.map((v) => `${v.characterId}: ${v.description}`).join("; ")}.` : ""} Style references define rendering only; background references define place layout only. Established place facts: ${JSON.stringify(placeFacts)}. ARCHITECTURE LOCK: the approved place sheet is authoritative; the CANONICAL first scene establishes previously unspecified visible geometry. Preserve the exact doorway silhouette (arch/rectangle), door count, frame color, handle, windows, wall materials, roof, paths and relative structural positions across every view. Camera angle may change; the physical building must not. Recent scenes are secondary continuity references and cannot override the canonical layout. Never invent an extra entrance, bridge, tower, staircase or decorative structure to fill the composition. Draw only architecture and props established by the place references or current story. A new permanent structure requires explicit story content. Do not transfer buildings from a different place. Current page narrative: ${JSON.stringify({ ko: page.ko ?? page.textKo ?? "", en: page.en ?? page.textEn ?? "" })}. Earlier page continuity: ${JSON.stringify(earlierPages)}. Preserve the consequences of prior actions, while depicting only this page event. Prior scene characters, poses and movable objects are not instructions to duplicate them. Reference-sheet panels are not part of the story illustration: render one continuous scene, never reproduce grids, borders, or multiple-view panels. Show only the selected cast required by the scene, each visible character once. Character images define appearance, not an instruction to copy an old flat drawing medium. One readable composition with space for separately typeset story text. No words, captions, watermark or logos.${openings && !options.cover ? ` ${openingFallbackSentence(page)}` : ""}`,
    stylePreset: preset,
    referenceImages: references.map((reference) => ({
      imageUrl: referenceURL(reference),
      ...(reference.imageAssetId
        ? { imageAssetId: reference.imageAssetId }
        : {}),
      role: reference.role,
      label: reference.label,
      ...(reference.required !== undefined
        ? { required: reference.required }
        : {}),
      ...(reference.sourcePageIndex !== undefined
        ? { sourcePageIndex: reference.sourcePageIndex }
        : {}),
      ...(reference.placeKey ? { placeKey: reference.placeKey } : {}),
    })),
    placeKey: place.key,
    seed: requestSeed,
    // R12 openings: a spread is 2048x880 (21:9), a page and the cover 1536x1024.
    size:
      options.size ||
      page.imageSize ||
      (options.cover ? "1536x1024" : unitImageSize(book, page)),
    quality: options.quality || page.imageQuality || "high",
    ...(snapshot.imageEngine === "sample"
      ? {
          sampleContext: {
            kind: "scene",
            scene: clone(page.scene || {}),
            characters: sheets.map((sheet) => {
              const variant = variantForPage(
                snapshot,
                sheet.characterId,
                pageIndex + 1,
              );
              return clone({
                ...sheet.characterSnapshot,
                ...(variant
                  ? {
                      clothes: variant.description,
                      color: variant.color || sheet.characterSnapshot?.color,
                    }
                  : {}),
              });
            }),
          },
        }
      : {}),
  };
}

/** Persist the returned seed as well as the requested seed and exact references. */
export function commitSceneResult(state, book, pageIndex, result) {
  const page = book.pages?.[pageIndex];
  if (!page || !result?.imageUrl)
    throw new Error("저장할 장면 이미지가 필요해요.");
  const snapshot = captureBookGenerationSnapshot(state, book);
  const requestedSeed = seedValue(
    result.meta?.requestedSeed ?? page.imageSeed ?? result.seed,
  );
  const effectiveSeed =
    result.seed === undefined || result.seed === null
      ? null
      : seedValue(result.seed);
  const references = sceneReferenceRecords(snapshot, pageIndex);
  page.imageAssetId = result.imageAssetId || null;
  page.imageUrl = result.imageAssetId
    ? `asset:${result.imageAssetId}`
    : result.imageUrl;
  page.imageSeed = requestedSeed;
  page.effectiveImageSeed = effectiveSeed;
  page.imageMeta = {
    ...clone(result.meta || {}),
    engine: snapshot.imageEngine,
    worldId: snapshot.worldId,
    worldRevision: snapshot.worldRevision,
    stylePresetId: snapshot.stylePresetId,
    characterSheetIds: snapshot.characterSheets.map((sheet) => sheet.id),
    characterSheetAssetIds: snapshot.characterSheets
      .map((sheet) => sheet.imageAssetId)
      .filter(Boolean),
    characterVariantIds: [
      ...new Set(references.map((ref) => ref.variantId).filter(Boolean)),
    ],
    characterVariantAssetIds: references
      .filter((ref) => ref.role === "character_variant")
      .map((ref) => ref.imageAssetId),
    referenceImages:
      result.meta?.referenceImages ||
      references.map((ref) => ({
        imageUrl: ref.imageAssetId ? `asset:${ref.imageAssetId}` : ref.imageUrl,
        role: ref.role,
        label: ref.label,
      })),
    requestedSeed,
    returnedSeed: effectiveSeed,
    seed: effectiveSeed,
    generatedAt: now(),
  };
  book.localSample =
    snapshot.imageEngine === "sample" ||
    result.meta?.generationMode === "offline-template";
  return page;
}
