/** Local library edits always create new records; book and sheet history is immutable. */
const clone = (value) =>
  globalThis.structuredClone
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const CHARACTER_FIELDS = new Set([
  "name",
  "nameEn",
  "role",
  "kind",
  "age",
  "color",
  "hairColor",
  "skinColor",
  "description",
  "traits",
  "catchphrase",
  "relationships",
  "speechHabit",
  "appearance",
  "clothes",
  "variant",
  "referenceImages",
  "referencePhotoAssetIds",
]);
const BACKGROUND_FIELDS = new Set([
  "name",
  "type",
  "description",
  "layout",
  "rules",
  "kind",
  "features",
  "mood",
  "color",
  "referenceImages",
  "referencePhotoAssetIds",
]);
export const PARENT_PREFERENCE_DEFAULTS = Object.freeze({
  defaultLanguage: "dual",
  defaultPages: 12,
  defaultLayout: "single",
  dailyLimit: 3,
  rate: 0.85,
  defaultKoreanLevel: "K1",
  defaultEnglishLevel: "E0",
  srLexile: null,
  readingFeedbackHistory: [],
  readingFeedback: [],
});

function record(state, collection, id) {
  const item = state[collection]?.find((item) => item.id === id);
  if (!item)
    throw new Error(
      collection === "characters"
        ? "캐릭터를 찾을 수 없어요."
        : collection === "backgrounds"
          ? "장소를 찾을 수 없어요."
          : "책을 찾을 수 없어요.",
    );
  return item;
}

function materialSnapshot(item) {
  const snapshot = clone(item);
  for (const field of [
    "characterSheets",
    "characterHistory",
    "backgroundHistory",
    "archivedAt",
    "updatedAt",
  ])
    delete snapshot[field];
  return snapshot;
}

/** Freeze appearances for old sample books too, which do not always have engine snapshots. */
function preserveBookMaterial(next, material, kind) {
  const idField = kind === "character" ? "characterIds" : "backgroundIds";
  const snapshotsField =
    kind === "character" ? "characterSnapshots" : "backgroundSnapshots";
  for (const book of next.books || []) {
    if (!(book[idField] || []).includes(material.id)) continue;
    book[snapshotsField] = Array.isArray(book[snapshotsField])
      ? book[snapshotsField]
      : [];
    if (book[snapshotsField].some((item) => item.id === material.id)) continue;
    const frozenSheet =
      kind === "character" &&
      book.generationSnapshot?.characterSheets?.find(
        (sheet) => sheet.characterId === material.id,
      )?.characterSnapshot;
    book[snapshotsField].push(
      materialSnapshot(
        frozenSheet ? { ...frozenSheet, id: material.id } : material,
      ),
    );
  }
}

function normalizePatch(patch, allowed) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("수정할 내용을 확인해 주세요.");
  const result = {};
  for (const [field, value] of Object.entries(patch)) {
    if (!allowed.has(field)) continue;
    if (field === "traits")
      result[field] = (
        Array.isArray(value) ? value : String(value ?? "").split(",")
      )
        .map((value) => String(value).trim())
        .filter(Boolean);
    else if (field === "age") {
      const age = Number(value);
      if (!Number.isInteger(age) || age < 1 || age > 120)
        throw new Error("나이는 1부터 120 사이로 입력해 주세요.");
      result[field] = age;
    } else if (["color", "hairColor", "skinColor"].includes(field)) {
      if (!/^#[0-9a-f]{6}$/i.test(String(value)))
        throw new Error("색상을 확인해 주세요.");
      result[field] = String(value);
    } else if (field === "variant") {
      const variant = Number(value);
      if (!Number.isInteger(variant) || variant < 0 || variant > 3)
        throw new Error("캐릭터 모습을 확인해 주세요.");
      result[field] = variant;
    } else if (["referenceImages", "referencePhotoAssetIds"].includes(field)) {
      if (
        !Array.isArray(value) ||
        value.some((item) => typeof item !== "string")
      )
        throw new Error("참조 사진 목록을 확인해 주세요.");
      result[field] = clone(value);
    } else {
      result[field] = String(value ?? "").trim();
      const limit = field === "name" ? 50 : field === "nameEn" ? 50 : 3000;
      if (result[field].length > limit)
        throw new Error("입력한 내용이 너무 길어요.");
    }
  }
  return result;
}

export function getManagementWorld(state, worldId = state.activeWorldId) {
  return (
    state.worlds?.find((world) => world.id === worldId) ||
    state.worlds?.[0] ||
    null
  );
}

export function activeCharacters(state, worldId = null) {
  const world = worldId ? getManagementWorld(state, worldId) : null;
  return (state.characters || []).filter(
    (item) =>
      !item.archivedAt && (!world || world.characterIds?.includes(item.id)),
  );
}

export function activeBackgrounds(state) {
  return (state.backgrounds || []).filter((item) => !item.archivedAt);
}

export function updateCharacter(state, id, patch) {
  const original = record(state, "characters", id);
  if (original.archivedAt)
    throw new Error("삭제한 캐릭터는 먼저 복원해 주세요.");
  const normalized = normalizePatch(patch, CHARACTER_FIELDS);
  const changed = Object.entries(normalized).some(
    ([field, value]) =>
      JSON.stringify(value) !== JSON.stringify(original[field]),
  );
  if (!changed) return state;
  if (
    ("name" in normalized && !normalized.name) ||
    ("nameEn" in normalized && !normalized.nameEn)
  )
    throw new Error("한글·영어 이름을 입력해 주세요.");
  if (
    "kind" in normalized &&
    !["child", "adult", "dinosaur", "rabbit"].includes(normalized.kind)
  )
    throw new Error("캐릭터 모습을 확인해 주세요.");
  const next = clone(state),
    previous = record(next, "characters", id),
    updatedAt = now();
  preserveBookMaterial(next, previous, "character");
  const updated = {
    ...previous,
    ...normalized,
    version: Math.max(1, Number(previous.version) || 1) + 1,
    characterHistory: [
      ...(previous.characterHistory || []),
      { ...materialSnapshot(previous), supersededAt: updatedAt },
    ],
    sheetStale: true,
    sheetInvalidatedAt: updatedAt,
    updatedAt,
  };
  next.characters = next.characters.map((item) =>
    item.id === id ? updated : item,
  );
  // Only the edited character needs a new approval; unchanged cast keep their sheets.
  for (const world of next.worlds || [])
    if (world.characterIds?.includes(id)) {
      world.characterSheetsStale = true;
      world.updatedAt = updatedAt;
    }
  return next;
}

function archiveMaterial(state, collection, id, kind) {
  const original = record(state, collection, id);
  if (original.archivedAt) return state;
  const next = clone(state),
    material = record(next, collection, id);
  preserveBookMaterial(next, material, kind);
  next[collection] = next[collection].map((item) =>
    item.id === id ? { ...item, archivedAt: now() } : item,
  );
  return next;
}

function restoreMaterial(state, collection, id) {
  const original = record(state, collection, id);
  if (!original.archivedAt) return state;
  const next = clone(state);
  next[collection] = next[collection].map((item) => {
    if (item.id !== id) return item;
    const restored = { ...item, restoredAt: now() };
    delete restored.archivedAt;
    return restored;
  });
  return next;
}

export const archiveCharacter = (state, id) =>
  archiveMaterial(state, "characters", id, "character");
export const deleteCharacter = archiveCharacter;
export const restoreCharacter = (state, id) =>
  restoreMaterial(state, "characters", id);
export const archiveBackground = (state, id) =>
  archiveMaterial(state, "backgrounds", id, "background");
export const deleteBackground = archiveBackground;
export const restoreBackground = (state, id) =>
  restoreMaterial(state, "backgrounds", id);

export function updateBackground(state, id, patch) {
  const original = record(state, "backgrounds", id);
  if (original.archivedAt) throw new Error("삭제한 장소는 먼저 복원해 주세요.");
  const normalized = normalizePatch(patch, BACKGROUND_FIELDS);
  if ("name" in normalized && !normalized.name)
    throw new Error("장소 이름을 입력해 주세요.");
  if (
    "type" in normalized &&
    !["home", "school", "forest", "sea", "space"].includes(normalized.type)
  )
    throw new Error("장소 종류를 확인해 주세요.");
  if (
    !Object.entries(normalized).some(
      ([field, value]) =>
        JSON.stringify(value) !== JSON.stringify(original[field]),
    )
  )
    return state;
  const next = clone(state),
    previous = record(next, "backgrounds", id),
    updatedAt = now();
  preserveBookMaterial(next, previous, "background");
  next.backgrounds = next.backgrounds.map((item) =>
    item.id === id
      ? {
          ...item,
          ...normalized,
          version: Math.max(1, Number(item.version) || 1) + 1,
          backgroundHistory: [
            ...(item.backgroundHistory || []),
            { ...materialSnapshot(previous), supersededAt: updatedAt },
          ],
          updatedAt,
        }
      : item,
  );
  return next;
}

export function resetParentPreferences(state) {
  const next = clone(state);
  next.settings = { ...next.settings, ...PARENT_PREFERENCE_DEFAULTS };
  return next;
}

export function resetWorldProviderConfig(state, engine) {
  if (!/^[a-z][a-z0-9-]*$/i.test(String(engine || "")))
    throw new Error("초기화할 엔진을 골라 주세요.");
  const next = clone(state),
    world = getManagementWorld(next);
  if (!world) throw new Error("World 설정을 찾을 수 없어요.");
  world.providerConfig = {
    ...world.providerConfig,
    [engine]:
      engine === "local"
        ? { endpoint: "http://127.0.0.1:8188", workflow: null }
        : {},
  };
  world.updatedAt = now();
  return next;
}

export function renameWorld(state, worldId, name) {
  if (name === undefined) {
    name = worldId;
    worldId = state.activeWorldId;
  }
  const cleanName = String(name || "").trim();
  if (!cleanName || cleanName.length > 80)
    throw new Error("세계 이름을 1–80자로 입력해 주세요.");
  const next = clone(state),
    world =
      next.worlds?.find((world) => world.id === worldId) ||
      (!worldId ? getManagementWorld(next) : null);
  if (!world) throw new Error("World 설정을 찾을 수 없어요.");
  world.name = cleanName;
  world.updatedAt = now();
  return next;
}

export function deleteBook(state, id) {
  record(state, "books", id);
  const next = clone(state);
  next.books = next.books.filter((book) => book.id !== id);
  if (Array.isArray(next.readingLog))
    next.readingLog = next.readingLog.filter((log) => log.bookId !== id);
  return next;
}

const button = (label, action, extra = "", primary = false) =>
  `<button type="button" class="btn ${primary ? "btn-primary" : "btn-outline"}" data-management-action="${action}" ${extra}>${label}</button>`;
const field = (
  key,
  label,
  value,
  { type = "text", max = 50, required = false, wide = false } = {},
) =>
  `<div class="field ${wide ? "field-wide" : ""}"><label for="management-${key}">${label}</label><input id="management-${key}" name="${key}" type="${type}" value="${escape(value)}" ${type === "text" ? `maxlength="${max}"` : ""} ${required ? "required" : ""} ${type === "number" ? 'min="1" max="120" step="1"' : ""}></div>`;
const select = (key, label, value, choices) => {
  const options =
    value && !choices.some(([id]) => id === value)
      ? [[value, value], ...choices]
      : choices;
  return `<div class="field"><label for="management-${key}">${label}</label><select id="management-${key}" name="${key}">${options.map(([id, label]) => `<option value="${escape(id)}" ${id === value ? "selected" : ""}>${escape(label)}</option>`).join("")}</select></div>`;
};

/** UI has no network work. Parent PIN protection is applied at entry and confirmation. */
export function configureManagementUI(api) {
  if (!api?.getState || !api.protectedAction)
    throw new Error("관리 화면 연결을 확인해 주세요.");
  let pending = null;
  const commit = (nextState, message, afterSave) => {
    const current = api.getState(),
      previous = { ...current };
    // 관리 기능은 자동 작업·이야기 초안을 바꾸지 않으므로, 실행 중인 작업이 참조하는 원본 객체를 복제본으로 바꾸지 않습니다.
    for (const key of ["fullAutoJobs", "storyDrafts"])
      if (key in nextState && current[key] && nextState[key] !== current[key])
        nextState[key] = current[key];
    Object.assign(current, nextState);
    if (api.save() === false) {
      Object.assign(current, previous);
      return false;
    }
    pending = null;
    api.closeModal();
    afterSave?.();
    api.render();
    api.toast(message);
    return true;
  };
  const confirm = (title, description, label, apply, cancel) => {
    api.showModal(
      `${api.modalHeader(escape(title))}<p class="modal-intro">${description}</p><div class="modal-actions">${button("취소", "cancel-management")}${button(label, "confirm-management", "", true)}</div>`,
    );
    pending = { apply, cancel };
  };
  const characterEditor = (id, draftPatch = {}) => {
    const character = {
      ...record(api.getState(), "characters", id),
      ...draftPatch,
    };
    if (character.archivedAt)
      throw new Error("삭제한 캐릭터는 먼저 복원해 주세요.");
    api.showModal(
      `${api.modalHeader(escape(character.name) + " 설정 수정")}<p class="modal-intro">수정하면 새 버전으로 저장하고 캐릭터 시트를 다시 생성해야 합니다. 기존 책은 원래 모습과 시트를 보관합니다.</p><form id="management-character-form" data-id="${escape(id)}"><div class="form-grid">${field("name", "이름 · 한글", character.name, { required: true, max: 30 })}${field("nameEn", "이름 · 영어", character.nameEn, { required: true, max: 40 })}${select(
        "role",
        "역할",
        character.role,
        [
          ["주인공", "주인공"],
          ["조연", "조연"],
          ["가족", "가족"],
          ["친구", "친구"],
          ["동물", "동물"],
          ["상상 친구", "상상 친구"],
        ],
      )}${select("kind", "캐릭터 모습", character.kind, [
        ["child", "아이"],
        ["adult", "어른"],
        ["dinosaur", "공룡"],
        ["rabbit", "토끼"],
      ])}${field("age", "나이", character.age || 4, { type: "number", required: true })}${field("color", "옷 · 몸 색상", character.color || "#efc954", { type: "color" })}${field("hairColor", "머리 색상", character.hairColor || "#3c3027", { type: "color" })}${field("skinColor", "피부 색상", character.skinColor || "#f1cfad", { type: "color" })}<div class="field field-wide"><label for="management-description">외모 · 옷 · 고정 특징</label><textarea id="management-description" name="description" maxlength="3000">${escape(character.description)}</textarea></div>${field("traits", "성격 · 좋아하는 것", Array.isArray(character.traits) ? character.traits.join(", ") : character.traits, { wide: true, max: 1000 })}${field("catchphrase", "말버릇 · 자주 하는 말", character.catchphrase || character.speechHabit, { wide: true, max: 500 })}${field("relationships", "친구·가족과의 관계", typeof character.relationships === "object" ? JSON.stringify(character.relationships) : character.relationships, { wide: true, max: 1000 })}</div><div class="modal-actions">${button("취소", "cancel-management")}<button type="submit" class="btn btn-primary">수정 내용 저장</button></div></form>`,
    );
    pending = null;
  };
  const backgroundEditor = (id) => {
    const background = record(api.getState(), "backgrounds", id);
    if (background.archivedAt)
      throw new Error("삭제한 장소는 먼저 복원해 주세요.");
    api.showModal(
      `${api.modalHeader(escape(background.name) + " 설정 수정")}<p class="modal-intro">장소의 이름과 특징을 바꿉니다. 기존 책은 만들 때의 장소 설정을 보관합니다.</p><form id="management-background-form" data-id="${escape(id)}"><div class="form-grid">${field("name", "장소 이름", background.name, { required: true })}${select(
        "type",
        "장소 종류",
        background.type || "forest",
        [
          ["home", "집"],
          ["school", "유치원"],
          ["forest", "숲 · 놀이터"],
          ["sea", "바다"],
          ["space", "우주 · 상상 세계"],
        ],
      )}<div class="field field-wide"><label for="management-description">특징과 분위기</label><textarea id="management-description" name="description" maxlength="3000">${escape(background.description || background.features)}</textarea></div><div class="field field-wide"><label for="management-layout">고정 배치 · 문·창·가구·소품</label><textarea id="management-layout" name="layout" maxlength="3000">${escape(background.layout)}</textarea></div></div><div class="modal-actions">${button("취소", "cancel-management")}<button type="submit" class="btn btn-primary">장소 설정 저장</button></div></form>`,
    );
    pending = null;
  };
  const runAction = (element) => {
    const action = element.dataset.managementAction,
      id = element.dataset.id,
      state = api.getState();
    if (action === "cancel-management") {
      const cancel = pending?.cancel;
      pending = null;
      if (cancel) cancel();
      else api.closeModal();
      return;
    }
    if (action === "confirm-management") {
      pending?.apply();
      return;
    }
    if (action === "edit-character") {
      characterEditor(id);
      return;
    }
    if (action === "edit-background") {
      backgroundEditor(id);
      return;
    }
    if (action === "delete-character") {
      const character = record(state, "characters", id);
      confirm(
        "캐릭터 삭제",
        `<strong>${escape(character.name)}</strong>을 새 이야기 재료에서 삭제합니다. 기존 책의 캐릭터 모습과 시트는 보관하며, 삭제한 재료 목록에서 복원할 수 있습니다.`,
        "재료에서 삭제",
        () =>
          commit(
            archiveCharacter(api.getState(), id),
            "캐릭터를 이야기 재료에서 삭제했어요.",
          ),
      );
      return;
    }
    if (action === "delete-background") {
      const background = record(state, "backgrounds", id);
      confirm(
        "장소 삭제",
        `<strong>${escape(background.name)}</strong>을 새 이야기 재료에서 삭제합니다. 기존 책의 장소 설정은 보관하며, 삭제한 재료 목록에서 복원할 수 있습니다.`,
        "재료에서 삭제",
        () =>
          commit(
            archiveBackground(api.getState(), id),
            "장소를 이야기 재료에서 삭제했어요.",
          ),
      );
      return;
    }
    if (action === "restore-character") {
      commit(restoreCharacter(state, id), "캐릭터를 이야기 재료로 복원했어요.");
      return;
    }
    if (action === "restore-background") {
      commit(restoreBackground(state, id), "장소를 이야기 재료로 복원했어요.");
      return;
    }
    if (action === "delete-book") {
      const book = record(state, "books", id);
      confirm(
        "책 삭제",
        `<strong>${escape(book.title)}</strong>과 이 책의 읽기 기록을 이 브라우저의 책장에서 삭제합니다. 복원하려면 미리 저장한 라이브러리 백업이 필요합니다. 캐릭터와 장소 재료는 보관합니다.`,
        "이 책 삭제",
        () =>
          commit(
            deleteBook(api.getState(), id),
            "책장에서 이야기를 삭제했어요.",
            () => api.onBookDeleted?.(id),
          ),
      );
      return;
    }
    if (action === "reset-parent-preferences") {
      confirm(
        "이야기 기본값 초기화",
        "기본 언어를 한·영 두 권, 쪽수를 12쪽, 인쇄를 소책자, 하루 읽기를 3권, 읽기 속도를 보통, 한글 K1·영어 E0로 바꾸고 SR 입력·난이도 피드백 보정을 초기화합니다. 부모 PIN, World, API 키와 저장된 책·재료는 보관합니다.",
        "기본값으로 초기화",
        () =>
          commit(
            resetParentPreferences(api.getState()),
            "이야기와 읽기 기본값을 초기화했어요.",
          ),
      );
      return;
    }
    if (action === "reset-provider-config") {
      const engine =
        element.dataset.engine ||
        document.querySelector("#ig-engine")?.value ||
        getManagementWorld(state)?.imageEngine;
      confirm(
        "엔진 연결 설정 초기화",
        engine === "local"
          ? "이 World의 ComfyUI 주소를 http://127.0.0.1:8188로 바꾸고 워크플로 JSON을 지웁니다. 저장된 인증 토큰과 책·캐릭터 시트는 보관합니다."
          : "이 World에서 선택한 엔진의 추가 연결 설정을 초기화합니다. 저장된 API 키와 선택한 엔진·화풍, 책·캐릭터 시트는 보관합니다.",
        "연결 설정 초기화",
        () =>
          commit(
            resetWorldProviderConfig(api.getState(), engine),
            "이 World의 엔진 연결 설정을 초기화했어요.",
          ),
      );
    }
  };
  const onClick = (event) => {
    const element = event.target.closest?.("[data-management-action]");
    if (!element) return;
    event.preventDefault();
    api.protectedAction(() => {
      try {
        runAction(element);
      } catch (error) {
        api.toast(error.message);
      }
    });
  };
  const onSubmit = (event) => {
    const form = event.target;
    if (
      !["management-character-form", "management-background-form"].includes(
        form.id,
      )
    )
      return;
    event.preventDefault();
    api.protectedAction(() => {
      try {
        const patch = Object.fromEntries(new FormData(form)),
          id = form.dataset.id;
        if (form.id === "management-background-form") {
          commit(
            updateBackground(api.getState(), id, patch),
            "장소 설정을 수정했어요.",
          );
          return;
        }
        const original = api
          .getState()
          .characters.find((character) => character.id === id);
        if (patch.description !== original?.description) {
          patch.appearance = patch.description;
          patch.clothes = "설명에 적힌 기본 모습";
        }
        const next = updateCharacter(api.getState(), id, patch);
        if (next === api.getState()) {
          api.closeModal();
          api.toast("수정한 내용이 없어요.");
          return;
        }
        confirm(
          "시트 다시 생성 필요",
          "수정한 내용을 새 버전으로 저장합니다. 이 캐릭터의 시트는 다시 생성하고 확정해야 합니다. 기존 책은 원래 모습과 시트를 보관합니다.",
          "수정하고 시트 다시 생성",
          () =>
            commit(
              updateCharacter(api.getState(), id, patch),
              "캐릭터를 수정했어요. 이 캐릭터의 시트를 다시 생성하고 확정해 주세요.",
            ),
          () => characterEditor(id, patch),
        );
      } catch (error) {
        api.toast(error.message);
      }
    });
  };
  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);
  return () => {
    document.removeEventListener("click", onClick);
    document.removeEventListener("submit", onSubmit);
  };
}
