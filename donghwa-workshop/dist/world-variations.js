import { getActiveWorld, getCharacterSheet } from "./image-generation/world.js";
import {
  getStylePreset,
  listStylePresets,
  validateStylePreset,
} from "./image-generation/styles.js";
import { ENGINE_IDS, ENGINE_METADATA } from "./image-generation/providers.js";
import {
  TEXT_MODELS,
  getTextModelInfo,
  resolveStoryStageSettings,
} from "./text-generation/models.js";
import { getTextGenerationSettings } from "./text-generation/settings-ui.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const secretField =
  /^(?:key|api[_-]?(?:key|token)|authorization|credentials?|credentialRecord|password|client[_-]?secret|secret|access[_-]?token|refresh[_-]?token|token)$/i;
const urlField = /^(?:endpoint|baseUrl|proxyEndpoint)$/i;
let api,
  configured = false;

/** Copy connection settings, never the request-time credentials of a provider. */
function publicConfig(value, key = "") {
  if (
    secretField.test(key) ||
    ["__proto__", "constructor", "prototype"].includes(key)
  )
    return undefined;
  if (urlField.test(key) && typeof value === "string" && value) {
    try {
      const url = new URL(value);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return undefined;
      return value;
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(value))
    return value
      .map((item) => publicConfig(item))
      .filter((item) => item !== undefined);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .map(([name, item]) => [name, publicConfig(item, name)])
        .filter(([, item]) => item !== undefined),
    );
  return value;
}

function textSettings(value) {
  return getTextGenerationSettings({
    settings: { textGeneration: publicConfig(value || {}) },
  });
}
function sourceWorld(state, id) {
  const world = state.worlds?.find((item) => item.id === id);
  if (!world) throw new Error("복사하거나 선택할 World를 찾을 수 없어요.");
  return world;
}
function textForWorld(state, world) {
  return textSettings(
    world.id === state.activeWorldId
      ? state.settings?.textGeneration || world.textGeneration
      : world.textGeneration,
  );
}
function worldMemo(state, world) {
  return String(
    world.memo ??
      world.worldMemo ??
      (world.id === state.activeWorldId ? state.settings?.worldMemo : "") ??
      "",
  );
}
function checkedText(value, max, label) {
  const text = String(value ?? "").trim();
  if (text.length > max)
    throw new Error(`${label}은 ${max}자 안으로 입력해 주세요.`);
  return text;
}

/** Initial load uses the saved World; subsequent saves record its current text settings. */
export function syncActiveWorldTextSettings(state, { load = false } = {}) {
  const world = getActiveWorld(state);
  state.settings ||= {};
  if (load && world.textGeneration)
    state.settings.textGeneration = textSettings(world.textGeneration);
  else
    world.textGeneration = textSettings(
      state.settings.textGeneration || world.textGeneration,
    );
  state.settings.textGeneration = clone(world.textGeneration);
  return world.textGeneration;
}

/** A variation shares original material IDs but receives its own sheet approvals. */
export function createWorldVariation(state, sourceId, patch = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("새 World 설정을 확인해 주세요.");
  const source = sourceWorld(state, sourceId),
    engine = patch.imageEngine ?? source.imageEngine;
  if (!ENGINE_IDS.includes(engine))
    throw new Error("지원하지 않는 이미지 엔진이에요.");
  const preset = getStylePreset(patch.stylePresetId ?? source.stylePresetId);
  if (patch.stylePresetId !== undefined && preset.id !== patch.stylePresetId)
    throw new Error("지원하지 않는 화풍 프리셋이에요.");
  const validation = validateStylePreset(preset);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  const name = checkedText(
    patch.name ?? `${source.name} · 배리에이션`,
    70,
    "World 이름",
  );
  if (!name) throw new Error("World 이름을 입력해 주세요.");
  const memo = checkedText(
    patch.memo ?? patch.worldMemo ?? worldMemo(state, source),
    2000,
    "세계관 메모",
  );
  const sourceText = textForWorld(state, source),
    nextText = patch.textGeneration;
  if (
    nextText !== undefined &&
    (!nextText || typeof nextText !== "object" || Array.isArray(nextText))
  )
    throw new Error("이야기 글 엔진 설정을 확인해 주세요.");
  if (nextText?.engine && !TEXT_MODELS[nextText.engine])
    throw new Error("지원하는 이야기 글 엔진을 선택해 주세요.");
  const texts = textSettings({
    ...sourceText,
    ...(nextText || {}),
    providers: { ...sourceText.providers, ...(nextText?.providers || {}) },
    hybrid: { ...sourceText.hybrid, ...(nextText?.hybrid || {}) },
  });
  const timestamp = new Date().toISOString(),
    id = `world-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`;
  const characterIds = [
    ...new Set(
      source.characterIds || state.characters?.map((item) => item.id) || [],
    ),
  ];
  const backgroundIds = [
    ...new Set(
      source.backgroundIds ||
        state.backgrounds
          ?.filter((item) => !item.archivedAt)
          .map((item) => item.id) ||
        [],
    ),
  ];
  const sameStyle = preset.id === source.stylePresetId;
  const world = {
    id,
    name,
    parentWorldId: source.id,
    variationOf: source.id,
    revision: 1,
    imageEngine: engine,
    stylePresetId: preset.id,
    stylePresetVersion: preset.version || 1,
    characterIds,
    backgroundIds,
    memo,
    textGeneration: texts,
    providerConfig: publicConfig({
      ...source.providerConfig,
      ...patch.providerConfig,
    }),
    styleSheetImageIds: [
      ...(sameStyle
        ? source.styleSheetImageIds || preset.styleRefImageIds || []
        : preset.styleRefImageIds || []),
    ].slice(0, 2),
    characterSheetsStale: characterIds.some((id) =>
      state.characters?.some((item) => item.id === id && !item.archivedAt),
    ),
    backgroundSheetsStale: backgroundIds.some((id) =>
      state.backgrounds?.some((item) => item.id === id && !item.archivedAt),
    ),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  // Complete validation precedes writes: a rejected variation cannot alter its source.
  if (source.id === state.activeWorldId)
    source.textGeneration = clone(sourceText);
  state.worlds.push(world);
  if (sameStyle && state.stylePresetSelections?.[source.id]) {
    state.stylePresetSelections[id] = publicConfig(
      clone(state.stylePresetSelections[source.id]),
    );
  }
  return world;
}

/** Books already hold frozen generation snapshots and are never touched by switching. */
export function activateWorldVariation(state, id) {
  const next = sourceWorld(state, id),
    previous = getActiveWorld(state);
  state.settings ||= {};
  const nextText = textSettings(
    next.id === previous.id
      ? state.settings.textGeneration || next.textGeneration
      : next.textGeneration || state.settings.textGeneration,
  );
  const previousText = textSettings(
    state.settings.textGeneration || previous.textGeneration,
  );
  previous.textGeneration = previousText;
  state.activeWorldId = next.id;
  next.textGeneration = clone(nextText);
  state.settings.textGeneration = clone(nextText);
  state.settings.style = getStylePreset(next.stylePresetId).name;
  state.settings.stylePresetId = next.stylePresetId;
  state.settings.imageEngine = next.imageEngine;
  state.settings.worldName = next.name;
  state.settings.worldMemo = worldMemo(state, next);
  next.characterSheetsStale = (next.characterIds || []).some(
    (characterId) =>
      state.characters?.some(
        (item) => item.id === characterId && !item.archivedAt,
      ) && !getCharacterSheet(state, characterId, next),
  );
  return next;
}

export function renderWorldVariations(state) {
  const active = getActiveWorld(state);
  return `<section class="panel" id="world-variations" style="margin:24px 0"><h3>World 배리에이션</h3><p class="section-sub">같은 친구와 장소로 새 세계를 저장해 보세요. 세계마다 그림·글 엔진, 화풍, 연결 설정과 메모를 따로 보관합니다.</p><div class="form-grid">${state.worlds
    .map((world) => {
      const settings = textForWorld(state, world),
        missing = (world.characterIds || []).filter(
          (id) =>
            state.characters?.some((c) => c.id === id && !c.archivedAt) &&
            !getCharacterSheet(state, id, world),
        ).length;
      const modelName = (stage) => {
        const { engineId, config } = resolveStoryStageSettings(settings, stage);
        return engineId === "local"
          ? config.model || "로컬"
          : getTextModelInfo(engineId, config.model, config).name;
      };
      const outline = modelName("outline"),
        prose = modelName("prose"),
        pagination = modelName("pagination"),
        stageSummary =
          outline === pagination
            ? `줄거리·쪽 나누기 ${esc(outline)}<br>전문 ${esc(prose)}`
            : `줄거리 ${esc(outline)}<br>전문 ${esc(prose)} · 쪽 나누기 ${esc(pagination)}`;
      return `<article class="panel" style="padding:18px;margin:0"><span class="role-tag">${world.id === active.id ? "현재 World" : "저장된 World"}</span><h4 style="margin:12px 0">${esc(world.name)}</h4><p class="small-label">그림 ${esc(ENGINE_METADATA[world.imageEngine]?.name || world.imageEngine)}<br>화풍 ${esc(getStylePreset(world.stylePresetId).name)}<br>${stageSummary}${settings.hybrid.enabled ? " · 하이브리드" : ""}</p>${world.memo ? `<p class="small-label">${esc(world.memo)}</p>` : ""}${missing ? `<p class="small-label">캐릭터 ${missing}명 · 시트 다시 생성 필요</p>` : ""}<div class="material-add-actions">${world.id !== active.id ? `<button type="button" class="btn btn-outline btn-small" data-world-variation="activate" data-id="${esc(world.id)}">이 World 선택</button>` : ""}<button type="button" class="btn btn-outline btn-small" data-world-variation="create" data-id="${esc(world.id)}">배리에이션 추가</button></div></article>`;
    })
    .join(
      "",
    )}</div><p class="small-label" style="margin-top:18px">새 World의 캐릭터·배경 시트를 생성하고 확정해 주세요. 기존 책은 원래 그림과 설정을 보관합니다. API 비밀 키는 공급자별 암호화 저장소를 공유합니다.</p></section>`;
}

function option(value, label, selected) {
  return `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(label)}</option>`;
}
function variationFields(state, world) {
  const texts = textForWorld(state, world);
  return `<div class="form-grid"><div class="field"><label for="wv-name">새 World 이름</label><input id="wv-name" name="name" maxlength="70" value="${esc(`${world.name} · 배리에이션`.slice(0, 70))}" required></div><div class="field"><label for="wv-engine">이미지 엔진</label><select id="wv-engine" name="imageEngine">${ENGINE_IDS.map((id) => option(id, ENGINE_METADATA[id].name, world.imageEngine)).join("")}</select></div><div class="field"><label for="wv-style">화풍</label><select id="wv-style" name="stylePresetId">${listStylePresets(
    state,
  )
    .map((preset) => option(preset.id, preset.name, world.stylePresetId))
    .join(
      "",
    )}</select></div><div class="field"><label for="wv-text-engine">이야기 글 엔진</label><select id="wv-text-engine" name="textEngine">${Object.keys(
    TEXT_MODELS,
  )
    .map((id) => option(id, TEXT_MODELS[id].name, texts.engine))
    .join(
      "",
    )}</select></div><div class="field"><label><input id="wv-hybrid" name="hybrid" type="checkbox" ${texts.hybrid.enabled ? "checked" : ""}> 로컬 초안 + API 최종 전문</label></div><div class="field"><label for="wv-final-engine">하이브리드 최종 글 엔진</label><select id="wv-final-engine" name="finalEngine">${Object.keys(
    TEXT_MODELS,
  )
    .filter((id) => id !== "local")
    .map((id) => option(id, TEXT_MODELS[id].name, texts.hybrid.finalEngine))
    .join(
      "",
    )}</select></div><div class="field field-wide"><label for="wv-memo">세계관 메모</label><textarea id="wv-memo" name="memo" maxlength="2000">${esc(worldMemo(state, world))}</textarea></div></div>`;
}
function openVariation(sourceId) {
  const state = api.getState(),
    world = sourceWorld(state, sourceId);
  api.showModal(
    `${api.modalHeader("새 World 배리에이션")}<p class="modal-intro">친구와 장소의 설정을 이어받아 엔진·화풍을 바꿔 볼 수 있어요. 새 시트를 확정하면 이 세계에서 이야기를 만들 수 있습니다.</p><form id="world-variation-form"><div class="field"><label for="wv-source">복사할 World</label><select id="wv-source" name="sourceId">${state.worlds.map((item) => option(item.id, item.name, world.id)).join("")}</select></div><div id="world-variation-fields">${variationFields(state, world)}</div><p class="small-label">연결 주소·로컬 모델 설정은 복사됩니다. 생성 후 부모 설정에서 새 World의 연결 설정을 수정할 수 있어요.</p><p id="world-variation-error" class="pin-error" role="status" aria-live="polite"></p><div class="modal-actions"><button type="button" class="btn btn-outline" data-action="close-modal">취소</button><button type="submit" class="btn btn-primary">새 World 저장 · 선택</button></div></form>`,
    "wide",
  );
}
function showError(error) {
  const field = document.querySelector("#world-variation-error");
  if (field) field.textContent = error.message;
  api.toast(error.message);
}
function saveAndSelect(operation) {
  const state = api.getState(),
    before = {
      worlds: clone(state.worlds),
      settings: clone(state.settings),
      activeWorldId: state.activeWorldId,
      stylePresetSelections: state.stylePresetSelections
        ? clone(state.stylePresetSelections)
        : undefined,
    };
  try {
    const previousId = state.activeWorldId,
      world = operation(state);
    if (api.save() === false) {
      Object.assign(state, before);
      throw new Error("World 설정을 저장하지 못했어요.");
    }
    api.onSwitch?.(world, previousId);
    api.closeModal();
    api.render();
    api.toast(
      `${world.name} World를 선택했어요. 이 세계의 시트를 확인해 주세요.`,
    );
  } catch (error) {
    showError(error);
  }
}

export function configureWorldVariations(context) {
  api = context;
  if (configured) return;
  configured = true;
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-world-variation]");
    if (!button) return;
    event.preventDefault();
    api.protectedAction(() => {
      try {
        if (button.dataset.worldVariation === "create")
          openVariation(button.dataset.id);
        else if (button.dataset.worldVariation === "activate")
          saveAndSelect((state) =>
            activateWorldVariation(state, button.dataset.id),
          );
      } catch (error) {
        showError(error);
      }
    });
  });
  document.addEventListener("change", (event) => {
    if (event.target.id !== "wv-source" || !api.isParent()) return;
    try {
      document.querySelector("#world-variation-fields").innerHTML =
        variationFields(
          api.getState(),
          sourceWorld(api.getState(), event.target.value),
        );
    } catch (error) {
      showError(error);
    }
  });
  document.addEventListener("submit", (event) => {
    if (event.target.id !== "world-variation-form") return;
    event.preventDefault();
    api.protectedAction(() => {
      const form = event.target,
        values = new FormData(form);
      saveAndSelect((state) => {
        const world = createWorldVariation(state, values.get("sourceId"), {
          name: values.get("name"),
          imageEngine: values.get("imageEngine"),
          stylePresetId: values.get("stylePresetId"),
          memo: values.get("memo"),
          textGeneration: {
            engine: values.get("textEngine"),
            hybrid: {
              enabled: values.get("hybrid") === "on",
              finalEngine: values.get("finalEngine"),
            },
          },
        });
        return activateWorldVariation(state, world.id);
      });
    });
  });
}
