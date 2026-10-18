/* A wardrobe changes clothes and hair while the approved identity sheet stays fixed. */
import {
  generateImage,
  ENGINE_METADATA,
} from "./image-generation/providers.js";
import { getCredential } from "./image-generation/vault.js";
import {
  getActiveWorld,
  getCharacterSheet,
  getWorldStyleReferences,
  castNames,
  imageWordCheck,
} from "./image-generation/world.js";
import {
  getStylePreset,
  checkForbiddenWordCheck,
} from "./image-generation/styles.js";
import {
  getImageURL,
  saveImage,
  deleteImageAsset,
} from "./image-generation/assets.js";
import { translateWardrobeWithGoogle } from "./wardrobe-translation.js";

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const clone = (value) => JSON.parse(JSON.stringify(value));
const uid = (prefix) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
let api,
  flow,
  configured = false;
export const WARDROBE_RECOMMENDATIONS = Object.freeze([
  {
    id: "pajamas",
    name: "잠옷",
    description: "soft comfortable pajamas",
    type: "outfit",
    keywords: /잠|밤|침대|sleep|night|bed/i,
  },
  {
    id: "hanbok",
    name: "한복",
    description: "a comfortable traditional Korean hanbok",
    type: "outfit",
    keywords: /명절|설날|추석|holiday|festival/i,
  },
  {
    id: "swimsuit",
    name: "수영복",
    description: "a comfortable age-appropriate swimsuit",
    type: "outfit",
    keywords: /수영|바다|해변|pool|sea|ocean|beach/i,
  },
  {
    id: "spacesuit",
    name: "우주복",
    description: "a friendly soft spacesuit with a clear helmet",
    type: "outfit",
    keywords: /우주|달|로켓|space|moon|rocket/i,
  },
  {
    id: "raincoat",
    name: "우비·장화",
    description: "a yellow raincoat and matching rain boots",
    type: "outfit",
    color: "#E5BD52",
    keywords: /비(?:가|는| 오는|온)|빗|장마|rain/i,
  },
  {
    id: "winter",
    name: "패딩·목도리",
    description: "a warm padded winter coat and a soft scarf",
    type: "outfit",
    keywords: /겨울|눈|추위|winter|snow/i,
  },
  {
    id: "hat",
    name: "모자",
    description: "a soft comfortable hat",
    type: "accessory",
  },
  {
    id: "glasses",
    name: "안경",
    description: "rounded lightweight glasses",
    type: "accessory",
  },
  {
    id: "haircolor",
    name: "염색",
    description: "soft chestnut brown hair, keeping the same hairstyle",
    type: "hair",
  },
  {
    id: "headband",
    name: "머리띠",
    description: "a soft simple headband",
    type: "accessory",
  },
  {
    id: "tiedhair",
    name: "묶은 머리",
    description: "hair tied into a simple ponytail, keeping the same face",
    type: "hair",
  },
]);
const colors = {
  노란: "yellow",
  노랑: "yellow",
  노란색: "yellow",
  빨간: "red",
  빨강: "red",
  빨간색: "red",
  파란: "blue",
  파랑: "blue",
  파란색: "blue",
  초록: "green",
  초록색: "green",
  분홍: "pink",
  분홍색: "pink",
  보라: "purple",
  보라색: "purple",
  하얀: "white",
  흰: "white",
  흰색: "white",
  검은: "black",
  검정: "black",
  검은색: "black",
  갈색: "brown",
  주황: "orange",
  주황색: "orange",
};
const garments = {
  잠옷: "pajamas",
  한복: "a traditional Korean hanbok",
  수영복: "a comfortable age-appropriate swimsuit",
  우주복: "a soft spacesuit",
  우비: "a raincoat",
  장화: "rain boots",
  모자: "a hat",
  안경: "glasses",
  머리띠: "a headband",
  "묶은 머리": "hair tied in a ponytail",
  목도리: "a scarf",
  패딩: "a padded coat",
  티셔츠: "a T-shirt",
  반바지: "shorts",
  긴바지: "trousers",
  원피스: "a dress",
  운동화: "sneakers",
  염색: "dyed hair",
};

/** Deliberately bounded local translation; unknown Korean is never mislabeled as English. */
export function translateWardrobeDescription(text, englishOverride = "") {
  const value = String(text || "")
    .trim()
    .slice(0, 500);
  const override = String(englishOverride || "")
    .trim()
    .slice(0, 1000);
  if (override) {
    if (/[가-힣]/.test(override))
      throw new Error("영어 설명에는 영어로 적어 주세요.");
    return override;
  }
  if (!value) throw new Error("새 모습의 설명을 적어 주세요.");
  if (!/[가-힣]/.test(value)) return value;
  const exact = WARDROBE_RECOMMENDATIONS.find(
    (item) => item.name === value || item.name.replace("·", " ") === value,
  );
  if (exact) return exact.description;
  let remaining = value,
    found = [];
  for (const [word, english] of Object.entries(garments).sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    if (remaining.includes(word)) {
      found.push(english);
      remaining = remaining.replaceAll(word, " ");
    }
  }
  let tone = "";
  for (const [word, english] of Object.entries(colors).sort(
    (a, b) => b[0].length - a[0].length,
  ))
    if (remaining.includes(word)) {
      tone = english;
      remaining = remaining.replaceAll(word, " ");
      break;
    }
  remaining = remaining.replace(
    /(?:입은|입기|착용|쓰고|쓴|신은|차림|모습|으로|색의|색|와|과|및|그리고|하고|에|의|[\s·,+/])/g,
    "",
  );
  if (!found.length || remaining)
    throw new Error(
      "이 한글 설명은 기기 내 번역 사전의 범위를 벗어나요. AI로 영어 번역 버튼을 누르거나 아래에 영어 설명을 직접 적어 주세요.",
    );
  return found
    .map((item) =>
      tone
        ? /^an? /.test(item)
          ? item.replace(/^(an? )/, `$1${tone} `)
          : `${tone} ${item}`
        : item,
    )
    .join(" and ");
}

export function recommendWardrobe(topic = "") {
  return WARDROBE_RECOMMENDATIONS.filter((item) =>
    item.keywords?.test(String(topic)),
  );
}

export function availableCharacterVariants(state, character) {
  if (!character || character.archivedAt) return [];
  const world = getActiveWorld(state),
    sheet = getCharacterSheet(state, character.id, world);
  if (!sheet) return [];
  return (character.wardrobe || []).filter(
    (variant) =>
      !variant.archivedAt &&
      variant.characterId === character.id &&
      Array.isArray(variant.refImageIds) &&
      variant.refImageIds.length === 2 &&
      variant.refImageIds.every(Boolean) &&
      (!variant.worldId || variant.worldId === world.id) &&
      (!variant.worldRevision || variant.worldRevision === world.revision) &&
      (!variant.sourceSheetId || variant.sourceSheetId === sheet.id),
  );
}

export function validateWardrobeSelections(state, wizard) {
  const selections = {},
    ranges = {},
    count = Number(wizard.pageCount || wizard.pages?.length || 12);
  for (const id of wizard.characterIds || []) {
    const character = state.characters.find((c) => c.id === id),
      allowed = new Set(
        availableCharacterVariants(state, character).map((v) => v.id),
      );
    const selected = wizard.characterVariants?.[id] || null;
    if (selected && !allowed.has(selected))
      throw new Error(
        "선택한 옷장 모습이 현재 캐릭터 시트와 맞지 않아요. 기본 모습을 고르거나 다시 생성해 주세요.",
      );
    selections[id] = selected;
    const rows = (wizard.variantPageRanges?.[id] || []).map((row) => ({
      from: Number(row.from),
      to: Number(row.to),
      variantId: row.variantId || null,
    }));
    for (const row of rows) {
      if (
        !Number.isInteger(row.from) ||
        !Number.isInteger(row.to) ||
        row.from < 1 ||
        row.to < row.from ||
        row.to > count
      )
        throw new Error(
          `쪽 범위는 1~${count}쪽 사이에서 시작 쪽보다 끝 쪽이 작지 않게 적어 주세요.`,
        );
      if (row.variantId && !allowed.has(row.variantId))
        throw new Error("쪽 범위의 옷장 모습이 현재 시트와 맞지 않아요.");
    }
    const sorted = [...rows].sort((a, b) => a.from - b.from);
    if (sorted.some((row, i) => i && row.from <= sorted[i - 1].to))
      throw new Error(
        "한 등장인물의 옷장 쪽 범위가 겹쳐요. 범위를 나누어 주세요.",
      );
    ranges[id] = rows;
  }
  return { characterVariants: selections, variantPageRanges: ranges };
}

export function copyWardrobeSelections(wizard, book, state) {
  const choices = state
    ? validateWardrobeSelections(state, wizard)
    : {
        characterVariants: clone(wizard.characterVariants || {}),
        variantPageRanges: clone(wizard.variantPageRanges || {}),
      };
  book.characterVariants = clone(choices.characterVariants);
  book.variantPageRanges = clone(choices.variantPageRanges);
  return book;
}

function options(state, character, selected) {
  return `<option value="">기본 모습</option>${availableCharacterVariants(
    state,
    character,
  )
    .map(
      (v) =>
        `<option value="${esc(v.id)}" ${selected === v.id ? "selected" : ""}>${esc(v.name)}</option>`,
    )
    .join("")}`;
}

export function renderWardrobeCardActions(character) {
  const count = (character.wardrobe || []).filter(
    (v) => !v.archivedAt && v.refImageIds?.length,
  ).length;
  return `<span class="small-label">기본 모습 · 옷장 ${count}벌</span><button type="button" class="btn btn-outline btn-small" data-wardrobe-action="open" data-character-id="${esc(character.id)}">옷장</button>`;
}

export function renderBookVariantSelectors(state, wizard) {
  return `<div class="form-grid" data-wardrobe-book-selectors>${(
    wizard.characterIds || []
  )
    .map((id) => state.characters.find((c) => c.id === id))
    .filter(Boolean)
    .map(
      (c) =>
        `<div class="field"><label for="wardrobe-book-${esc(c.id)}">${esc(c.name)} · 이번 책의 모습</label><select id="wardrobe-book-${esc(c.id)}" data-wardrobe-book-character="${esc(c.id)}">${options(state, c, wizard.characterVariants?.[c.id])}</select>${availableCharacterVariants(state, c).length ? "" : "<small>옷장에서 새 모습을 만들면 선택할 수 있어요.</small>"}</div>`,
    )
    .join("")}</div>`;
}

export function renderPageVariantRanges(state, wizard) {
  const count = Number(wizard.pageCount || 12);
  return `<details class="panel" data-wardrobe-page-ranges><summary>쪽마다 옷장 모습 바꾸기</summary><p class="small-label">지정하지 않은 쪽은 이번 책의 기본 선택을 사용해요. 범위가 겹치지 않게 지정해 주세요.</p>${(
    wizard.characterIds || []
  )
    .map((id) => state.characters.find((c) => c.id === id))
    .filter(Boolean)
    .map(
      (c) =>
        `<fieldset style="border:0;padding:12px 0"><legend>${esc(c.name)}</legend>${(wizard.variantPageRanges?.[c.id] || []).map((row, index) => `<div class="form-grid" data-wardrobe-range="${esc(c.id)}" data-range-index="${index}"><div class="field"><label>시작 쪽</label><input type="number" min="1" max="${count}" data-range-from value="${Number(row.from) || 1}"></div><div class="field"><label>끝 쪽</label><input type="number" min="1" max="${count}" data-range-to value="${Number(row.to) || count}"></div><div class="field"><label>이 범위의 모습</label><select data-range-variant>${options(state, c, row.variantId)}</select></div><button type="button" class="btn btn-outline btn-small" data-wardrobe-action="remove-range" data-character-id="${esc(c.id)}" data-range-index="${index}">범위 삭제</button></div>`).join("")}<button type="button" class="btn btn-outline btn-small" data-wardrobe-action="add-range" data-character-id="${esc(c.id)}">쪽 범위 추가</button></fieldset>`,
    )
    .join("")}</details>`;
}

export function syncWardrobeSelections(wizard) {
  if (!wizard || !globalThis.document) return wizard;
  wizard.characterVariants ||= {};
  wizard.variantPageRanges ||= {};
  document
    .querySelectorAll("[data-wardrobe-book-character]")
    .forEach((select) => {
      wizard.characterVariants[select.dataset.wardrobeBookCharacter] =
        select.value || null;
    });
  if (document.querySelector("[data-wardrobe-page-ranges]")) {
    for (const id of wizard.characterIds || [])
      wizard.variantPageRanges[id] = [];
    document.querySelectorAll("[data-wardrobe-range]").forEach((row) => {
      (wizard.variantPageRanges[row.dataset.wardrobeRange] ||= []).push({
        from: Number(row.querySelector("[data-range-from]").value),
        to: Number(row.querySelector("[data-range-to]").value),
        variantId: row.querySelector("[data-range-variant]").value || null,
      });
    });
  }
  return wizard;
}

function sheetURL(sheet) {
  const id =
    sheet.imageAssetId ||
    (sheet.imageUrl?.startsWith("asset:") ? sheet.imageUrl.slice(6) : null);
  const url = id ? getImageURL(id) : sheet.imageUrl;
  if (!url)
    throw new Error(
      "기본 시트 이미지를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
  return url;
}

export function createVariantGenerationRequest(
  state,
  characterId,
  variant,
  view,
  seed,
) {
  const world = getActiveWorld(state),
    character = state.characters.find((c) => c.id === characterId),
    sheet = getCharacterSheet(state, characterId, world);
  if (!character || !sheet)
    throw new Error(
      "옷장을 만들기 전에 현재 엔진·화풍의 기본 캐릭터 시트를 확정해 주세요.",
    );
  if (!["front", "full"].includes(view))
    throw new Error("정면 또는 전신 참조를 생성해 주세요.");
  // Wardrobe text is parent text: strict, no name exemption. The pre-check runs the
  // provider's own check on the very parts this request declares (plus the parent's
  // extra words), so a text it accepts is accepted again when this request, or a
  // scene wearing the outfit, is drawn.
  const wardrobeText = [variant.name, variant.description].filter(
      (part) => typeof part === "string" && part.trim(),
    ),
    forbiddenWordCheck = imageWordCheck({
      strict: wardrobeText,
      names: castNames(state),
    }),
    words = checkForbiddenWordCheck(forbiddenWordCheck, {
      extras: state.settings?.forbiddenStyleWords || [],
    });
  if (!words.ok)
    throw new Error(
      `옷장 설명에는 스튜디오·작가·작품·캐릭터 이름 대신 색, 소재, 모양을 적어 주세요. ${words.advice}`,
    );
  const preset = getStylePreset(world.stylePresetId);
  return {
    forbiddenWordCheck,
    prompt: `Create one ${view === "front" ? "front-facing head-and-shoulders portrait" : "front-facing full-body view"} of the same original character as the FIRST reference image. Identical face, age, body proportions and recognizable identity. Change only ${variant.type === "hair" ? "the requested hair styling" : variant.type === "accessory" ? "the requested accessory" : "the requested clothing"}: ${variant.description}. Do not copy another character from the style images. Keep all unrequested facial, hair and clothing details unchanged. The FIRST reference is identity; all remaining images define style. A clean neutral background, one character only, no labels, no text, no logos.`,
    stylePreset: clone(preset),
    referenceImages: [
      {
        imageUrl: sheetURL(sheet),
        role: "character_front",
        label: `${character.nameEn || character.name} original identity`,
      },
      ...getWorldStyleReferences(state, world, preset),
    ],
    seed,
    size: view === "front" ? "1024x1024" : "1024x1536",
    quality: "draft",
    ...(world.imageEngine === "sample"
      ? {
          sampleContext: {
            kind: "sheet",
            character: clone({
              ...character,
              color: variant.color || character.color,
              clothes: variant.description,
              characterSheets: undefined,
              wardrobe: undefined,
            }),
          },
        }
      : {}),
  };
}

function current(session) {
  const world = getActiveWorld(session.state);
  return (
    flow === session &&
    !session.controller.signal.aborted &&
    api.isParent() &&
    api.getState() === session.state &&
    world.id === session.worldId &&
    world.revision === session.worldRevision &&
    getCharacterSheet(session.state, session.characterId, world)?.id ===
      session.sourceSheetId &&
    !!document.querySelector(`[data-wardrobe-flow="${session.id}"]`)
  );
}
function assertCurrent(session) {
  if (!current(session))
    throw new DOMException(
      "옷장 만들기가 닫혔거나 기본 시트가 바뀌었어요.",
      "AbortError",
    );
}
function discardImages(results) {
  for (const image of results || [])
    if (image.imageAssetId)
      void deleteImageAsset(image.imageAssetId).catch(() => {});
}
export function cleanupWardrobeFlow() {
  const session = flow;
  if (!session) return;
  flow = null;
  session.controller.abort();
  if (!session.committed)
    discardImages([
      ...(session.results || []),
      ...(session.pendingResults || []),
    ]);
  session.results = [];
}
function show(session, content) {
  api.showModal(
    `<div data-wardrobe-flow="${session.id}">${content}</div>`,
    "wide wardrobe-modal",
  );
}
function button(label, action, extra = "", kind = "outline") {
  return `<button type="button" class="btn btn-${kind}" data-wardrobe-action="${action}" ${extra}>${label}</button>`;
}
function error(message) {
  const element = document.querySelector("#wardrobe-error");
  if (element) element.textContent = message;
  else api.toast(message);
}

async function translateVariantDescription(session) {
  if (session.busy || !current(session)) return;
  const sourceField = document.querySelector("#wardrobe-description"),
    englishField = document.querySelector("#wardrobe-english");
  if (!sourceField || !englishField) return;
  const source = sourceField.value.trim(),
    previousEnglish = englishField.value;
  try {
    // Known recommendations and direct English still use no network or API key.
    let local;
    try {
      local = translateWardrobeDescription(source);
    } catch {
      /* Explicit AI click handles descriptions outside the dictionary. */
    }
    if (local) {
      englishField.value = local;
      session.autoEnglish = { source, description: local };
      error(
        "기기 내 사전으로 영어 설명을 채웠어요. 번역 API 요금은 발생하지 않았어요.",
      );
      return;
    }
    session.busy = true;
    const translateButton = document.querySelector(
        '[data-wardrobe-action="translate"]',
      ),
      generateButton = document.querySelector("#wardrobe-generate");
    if (translateButton) translateButton.disabled = true;
    if (generateButton) generateButton.disabled = true;
    error("Google로 옷·소품·머리 설명을 영어로 번역하고 있어요…");
    const world = getActiveWorld(session.state),
      config = {
        ...(world.providerConfig?.google ||
          session.state.settings?.imageProviderConfig?.google ||
          {}),
      };
    delete config.apiKey;
    delete config.key;
    delete config.token;
    const result = await translateWardrobeWithGoogle(source, {
      config,
      signal: session.controller.signal,
      approved: true,
    });
    assertCurrent(session);
    if (
      sourceField.value.trim() !== source ||
      englishField.value !== previousEnglish
    ) {
      error(
        "번역 중 설명을 수정하셨어요. 현재 설명을 확인하고 다시 번역해 주세요.",
      );
      return;
    }
    englishField.value = result.englishDescription;
    session.autoEnglish = { source, description: result.englishDescription };
    error(
      "영어 번역을 채웠어요. 색·소재·모양이 맞는지 확인하고 정면·전신 생성 버튼을 눌러 주세요. 번역 토큰 요금은 이미지 생성 요금과 별도입니다.",
    );
  } catch (err) {
    if (err.name !== "AbortError" && current(session)) error(err.message);
  } finally {
    session.busy = false;
    if (current(session)) {
      const translateButton = document.querySelector(
          '[data-wardrobe-action="translate"]',
        ),
        generateButton = document.querySelector("#wardrobe-generate");
      if (translateButton) translateButton.disabled = false;
      if (generateButton) generateButton.disabled = !session.sourceSheetId;
    }
  }
}

function openWardrobe(characterId) {
  cleanupWardrobeFlow();
  const state = api.getState(),
    character = state.characters.find((c) => c.id === characterId),
    world = getActiveWorld(state),
    sheet = getCharacterSheet(state, characterId, world);
  if (!character || character.archivedAt) return;
  const variants = availableCharacterVariants(state, character),
    topic = api.getWizard?.()?.topic || api.getStoryContext?.()?.topic || "";
  const session = (flow = {
    id: uid("wardrobe-flow"),
    state,
    characterId,
    worldId: world.id,
    worldRevision: world.revision,
    sourceSheetId: sheet?.id,
    controller: new AbortController(),
    results: [],
    committed: false,
    busy: false,
  });
  const suggested = recommendWardrobe(topic);
  show(
    session,
    `${api.modalHeader(`${esc(character.name)}의 옷장`)}<p class="modal-intro">기본 얼굴과 몸은 그대로 두고 옷·소품·머리만 바꿔요. 기본 시트를 덮어쓰지 않습니다.</p>${!sheet ? '<p class="notice">현재 엔진·화풍의 기본 캐릭터 시트를 먼저 생성하고 확정해 주세요.</p>' : ""}${variants.length ? `<div class="form-grid">${variants.map((v) => `<article class="panel"><img src="${esc(getImageURL(v.refImageIds[1]) || "")}" alt="${esc(v.name)}" style="width:100%;max-height:180px;object-fit:contain"><strong>${esc(v.name)}</strong><p class="small-label">${esc(v.description)}</p>${button("옷장에서 삭제", "archive", `data-variant-id="${esc(v.id)}"`)}</article>`).join("")}</div>` : '<p class="small-label">아직 저장한 옷장 모습이 없어요.</p>'}<hr><form id="wardrobe-form"><h3>새 모습 추가</h3>${suggested.length ? `<p class="small-label">이야기 주제에 어울리는 추천: ${suggested.map((v) => esc(v.name)).join(" · ")} · 생성과 저장은 부모 확인 뒤에만 진행돼요.</p>` : ""}<div style="display:flex;flex-wrap:wrap;gap:8px;margin:12px 0">${WARDROBE_RECOMMENDATIONS.map((v) => button(v.name, "recommendation", `data-recommendation="${v.id}"`)).join("")}</div><div class="form-grid"><div class="field"><label for="wardrobe-name">옷장 이름</label><input id="wardrobe-name" maxlength="50" required placeholder="노란 우비"></div><div class="field"><label for="wardrobe-type">바꿀 부분</label><select id="wardrobe-type"><option value="outfit">옷</option><option value="accessory">소품</option><option value="hair">머리</option></select></div><div class="field field-wide"><label for="wardrobe-description">새 모습 설명</label><textarea id="wardrobe-description" maxlength="500" required placeholder="노란 우비와 장화"></textarea><small>추천과 기본 의류·색상은 무료로 영어로 바꿉니다. 복잡한 한글은 영어를 직접 적거나 아래 AI 번역 버튼을 눌러 주세요.</small></div><div class="field field-wide"><label for="wardrobe-english">영어 설명 (선택)</label><input id="wardrobe-english" maxlength="1000" placeholder="a yellow raincoat and matching rain boots"><small>AI 번역은 Google API에 설명 텍스트를 보내며 추가 토큰 요금이 적용돼요. 부모 설정에 Google 키 또는 프록시가 필요합니다. 직접 영어 입력·추천 사전은 무료입니다.</small><div style="margin-top:8px">${button("AI로 영어 번역 · API 사용", "translate")}</div></div></div><p class="notice">${esc(ENGINE_METADATA[world.imageEngine]?.name)} · ${esc(getStylePreset(world.stylePresetId).name)}<br>${world.imageEngine === "sample" ? "무료 샘플은 고정 그림 템플릿이므로 색상 중심으로 미리 봅니다. 실제 의류·소품과 커버 화풍은 AI 엔진으로 생성해 주세요." : "정면·전신 2장을 생성합니다. 선택한 엔진의 이용 요금이 적용됩니다."}</p><p id="wardrobe-error" class="pin-error" aria-live="polite"></p><div class="modal-actions">${button("닫기", "cancel")}<button type="submit" class="btn btn-primary" id="wardrobe-generate" ${!sheet ? "disabled" : ""}>정면·전신 2장 생성</button></div></form>`,
  );
}

async function generateVariant(session, quality = "draft") {
  if (session.busy || !current(session)) return;
  try {
    const name =
        session.variant?.name ||
        document.querySelector("#wardrobe-name").value.trim(),
      type =
        session.variant?.type || document.querySelector("#wardrobe-type").value;
    if (!name) throw new Error("옷장 이름을 적어 주세요.");
    const description =
      session.variant?.description ||
      translateWardrobeDescription(
        document.querySelector("#wardrobe-description").value,
        document.querySelector("#wardrobe-english").value,
      );
    if (!["outfit", "accessory", "hair"].includes(type))
      throw new Error("옷·소품·머리 중에서 골라 주세요.");
    const recommendation = WARDROBE_RECOMMENDATIONS.find(
      (v) => v.description === description,
    );
    session.variant = {
      id: uid("variant"),
      characterId: session.characterId,
      name,
      description,
      type,
      ...(recommendation?.color ? { color: recommendation.color } : {}),
    };
    session.busy = true;
    const generateButton = document.querySelector("#wardrobe-generate");
    if (generateButton) generateButton.disabled = true;
    error("정면·전신 참조를 만들고 있어요…");
    const world = getActiveWorld(session.state),
      engine = world.imageEngine;
    const config = {
      ...(session.state.settings?.imageProviderConfig?.[engine] || {}),
      ...(world.providerConfig?.[engine] || {}),
    };
    delete config.apiKey;
    delete config.key;
    delete config.token;
    const proxy = config.proxyEndpoint || config.transport === "proxy";
    const apiKey =
      engine === "sample" || proxy ? null : await getCredential(engine);
    assertCurrent(session);
    if (ENGINE_METADATA[engine]?.requiresKey && !apiKey && !proxy)
      throw new Error("부모 설정에서 이 엔진의 API 키를 먼저 등록해 주세요.");
    const previousResults = session.results,
      newResults = [];
    session.pendingResults = newResults;
    for (const view of ["front", "full"]) {
      const seed = globalThis.crypto?.getRandomValues
        ? crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff
        : Math.floor(Math.random() * 2147483647);
      const request = createVariantGenerationRequest(
        session.state,
        session.characterId,
        session.variant,
        view,
        session.results.find((image) => image.view === view)?.requestedSeed ??
          seed,
      );
      request.quality = quality;
      const result = await generateImage(request, {
        engine,
        config: {
          ...config,
          apiKey: apiKey || undefined,
          signal: session.controller.signal,
        },
      });
      assertCurrent(session);
      const asset = await saveImage(result.imageBlob || result.imageUrl, {
        signal: session.controller.signal,
      });
      const saved = {
        imageAssetId: asset.assetId,
        imageUrl: asset.imageUrl,
        seed: result.seed ?? null,
        requestedSeed: seed,
        view,
        meta: clone(result.meta || {}),
      };
      newResults.push(saved);
      assertCurrent(session);
    }
    session.results = newResults;
    session.pendingResults = [];
    session.quality = quality;
    discardImages(previousResults);
    session.busy = false;
    show(
      session,
      `${api.modalHeader(`${esc(session.variant.name)} 모습을 확인해 주세요`)}<div class="form-grid">${session.results.map((result) => `<figure style="margin:0"><img src="${esc(result.imageUrl)}" alt="${result.view === "front" ? "정면" : "전신"} 후보" style="width:100%;max-height:360px;object-fit:contain"><figcaption>${result.view === "front" ? "정면" : "전신"} · 요청 시드 ${result.requestedSeed} · 결과 시드 ${result.seed ?? "미지원"}</figcaption></figure>`).join("")}</div><p class="modal-intro">기본 얼굴·몸 비율은 같고 요청한 부분만 바뀌었는지 확인해 주세요. 확정 전에는 옷장에 저장하지 않습니다.${world.imageEngine === "sample" ? "<br>무료 샘플 · 고정 템플릿 미리보기 · 실제 의류 변환 아님" : ""}</p><p id="wardrobe-error" class="pin-error" aria-live="polite"></p><div class="modal-actions">${button("확정하지 않고 닫기", "cancel")}${button(quality === "draft" && engine !== "sample" ? "최종 정면·전신 생성 · 추가 요청 요금 적용" : "이 모습으로 옷장에 저장", "confirm", "", "primary")}</div>`,
    );
  } catch (e) {
    discardImages(session.pendingResults || []);
    session.pendingResults = [];
    session.busy = false;
    if (current(session)) {
      error(e.message);
      const button = document.querySelector("#wardrobe-generate");
      if (button) button.disabled = false;
    }
  }
}

async function confirmVariant(session) {
  if (session.busy || !current(session) || session.results.length !== 2) return;
  if (
    session.quality === "draft" &&
    getActiveWorld(session.state).imageEngine !== "sample"
  ) {
    await generateVariant(session, "final");
    return;
  }
  const character = session.state.characters.find(
      (c) => c.id === session.characterId,
    ),
    world = getActiveWorld(session.state);
  const variant = {
    ...clone(session.variant),
    refImageIds: session.results.map((r) => r.imageAssetId),
    createdAt: new Date().toISOString(),
    worldId: world.id,
    worldRevision: world.revision,
    imageEngine: world.imageEngine,
    stylePresetId: world.stylePresetId,
    sourceSheetId: session.sourceSheetId,
    sourceCharacterVersion: character.version || 1,
    images: session.results.map((r) => ({
      imageAssetId: r.imageAssetId,
      imageUrl: `asset:${r.imageAssetId}`,
      view: r.view,
      seed: r.seed,
      requestedSeed: r.requestedSeed,
      meta: clone(r.meta),
    })),
  };
  character.wardrobe ||= [];
  character.wardrobe.push(variant);
  if (api.save() === false) {
    character.wardrobe.pop();
    error("옷장을 저장하지 못했어요. 기기의 저장 공간을 확인해 주세요.");
    return;
  }
  session.committed = true;
  cleanupWardrobeFlow();
  api.closeModal();
  api.render();
  api.toast(`${variant.name} 모습을 옷장에 추가했어요.`);
}

export function configureWardrobeUI(context) {
  api = context;
  if (configured) return;
  configured = true;
  document.addEventListener("click", (event) => {
    const element = event.target.closest?.("[data-wardrobe-action]");
    if (!element) return;
    event.preventDefault();
    const action = element.dataset.wardrobeAction;
    if (action === "open") {
      api.protectedAction(() => {
        openWardrobe(element.dataset.characterId);
        if (element.dataset.recommendation)
          document
            .querySelector(
              `[data-wardrobe-action="recommendation"][data-recommendation="${element.dataset.recommendation}"]`,
            )
            ?.click();
      });
      return;
    }
    if (action === "cancel") {
      cleanupWardrobeFlow();
      api.closeModal();
      return;
    }
    if (["add-range", "remove-range"].includes(action)) {
      api.protectedAction(() => {
        const wizard = api.getWizard?.() || api.getStoryContext?.();
        if (!wizard) return;
        syncWardrobeSelections(wizard);
        const id = element.dataset.characterId;
        if (!(wizard.characterIds || []).includes(id)) return;
        wizard.variantPageRanges ||= {};
        wizard.variantPageRanges[id] ||= [];
        if (action === "add-range")
          wizard.variantPageRanges[id].push({
            from: 1,
            to: Number(wizard.pageCount || 12),
            variantId: wizard.characterVariants?.[id] || null,
          });
        else
          wizard.variantPageRanges[id].splice(
            Number(element.dataset.rangeIndex),
            1,
          );
        api.render();
      });
      return;
    }
    const session = flow;
    if (!session || !current(session)) return;
    if (action === "recommendation" && !session.busy) {
      const item = WARDROBE_RECOMMENDATIONS.find(
        (v) => v.id === element.dataset.recommendation,
      );
      if (!item) return;
      document.querySelector("#wardrobe-name").value = item.name;
      document.querySelector("#wardrobe-description").value = item.name;
      document.querySelector("#wardrobe-english").value = item.description;
      document.querySelector("#wardrobe-type").value = item.type;
      session.autoEnglish = {
        source: item.name,
        description: item.description,
      };
    }
    if (action === "translate") void translateVariantDescription(session);
    if (action === "confirm") confirmVariant(session);
    if (action === "archive" && !session.busy) {
      const character = session.state.characters.find(
          (c) => c.id === session.characterId,
        ),
        variant = character.wardrobe.find(
          (v) => v.id === element.dataset.variantId,
        );
      if (!variant) return;
      variant.archivedAt = new Date().toISOString();
      if (api.save() === false) {
        delete variant.archivedAt;
        error("옷장을 저장하지 못했어요.");
        return;
      }
      openWardrobe(character.id);
      api.toast("옷장에서 지웠어요. 이미 만든 책의 모습은 그대로 보관됩니다.");
    }
  });
  document.addEventListener("submit", (event) => {
    if (event.target.id === "wardrobe-form") {
      event.preventDefault();
      if (flow) void generateVariant(flow);
    }
  });
  document.addEventListener("input", (event) => {
    const session = flow;
    if (!session || !current(session) || !session.autoEnglish) return;
    if (event.target.id === "wardrobe-english") {
      session.autoEnglish = null;
      return;
    }
    if (
      event.target.id === "wardrobe-description" &&
      event.target.value.trim() !== session.autoEnglish.source
    ) {
      const english = document.querySelector("#wardrobe-english");
      if (english?.value === session.autoEnglish.description)
        english.value = "";
      session.autoEnglish = null;
    }
  });
  document.addEventListener("change", (event) => {
    if (
      event.target.matches(
        "[data-wardrobe-book-character], [data-range-from], [data-range-to], [data-range-variant]",
      )
    ) {
      const wizard = api.getWizard?.() || api.getStoryContext?.();
      if (wizard && api.isParent()) syncWardrobeSelections(wizard);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") cleanupWardrobeFlow();
  });
  new MutationObserver(() => {
    if (flow && !document.querySelector(`[data-wardrobe-flow="${flow.id}"]`))
      cleanupWardrobeFlow();
  }).observe(document.querySelector("#modal-root") || document.body, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("pagehide", cleanupWardrobeFlow);
}
