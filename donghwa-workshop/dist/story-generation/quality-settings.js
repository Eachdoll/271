import { compactUsageRow } from "../library-compact.js";
import { renderCheckboxSwitch } from "../ui-controls.js";
/* Parent-owned structure settings. Reference cards contain abstract structure only. */
import {
  getTextGenerationSettings,
  normalizeStoryQualitySettings,
} from "../text-generation/settings-ui.js";
import {
  listTextModelOptions,
  resolveQualityStageSettings,
} from "../text-generation/models.js";
import { loadStoryQualityData } from "./quality-adapter.js";
import {
  approvedBookRecord,
  qualityWeeklyCoachDue,
  runQualityWeeklyCoach,
  applyCoachProposals,
  rollbackQualityRules,
} from "./quality-gates.js";
import { buildBanList } from "../story-quality/dist/banList.js";
import { STORY_SHAPE_OPTIONS } from "./story-shapes.js";
import { STAGE_CATEGORIES, stageWorlds } from "./stage-categories.js";

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const clone = (value) => JSON.parse(JSON.stringify(value)),
  list = (value) => (Array.isArray(value) ? value : []);
const ENGINES = {
  openai: "OpenAI",
  google: "Google · Gemini",
  anthropic: "Anthropic · Claude",
  local: "로컬",
};
const TYPES = {
  setup: "시작",
  want: "바람",
  attempt: "시도",
  turn: "반전",
  resolution: "해결",
  close: "마무리",
};
const ERAS = { present: "현재", past: "과거", future: "미래", fantasy: "상상" },
  SEASONS = {
    auto: "자동 · 현재 계절",
    none: "계절 없이",
    spring: "봄",
    summer: "여름",
    autumn: "가을",
    winter: "겨울",
  },
  TIMES = { auto: "자동 · 낮", day: "낮", night: "밤" };
const ROLE_NAMES = {
  outline: "작가 · 상위",
  prose: "전문 · 보급형 중",
  cheap: "독자단·읽기 · 보급형",
  coach: "주간 코치 · 상위",
};
/*
 * R54a (2026-11-03). The parent on the pro quality panel: "too complex —
 * simplify, drop what is useless". Everything the writers' room decides
 * (the legacy quality package and its six switches, the 29 story shapes, the
 * stage/world/season/hour defaults, the prop-variation chance, the six
 * pattern cards, the repeat-material log, the weekly coach) left the screen.
 * Only the two models stay: the author (the room's premises, drafts,
 * rewrite, English edition and polish, and the outline) and the economy
 * model (the panel's listening and reading, the picture reading). Stored
 * values of the hidden controls are kept so old drafts and pins never
 * change; the form reads only what it shows.
 */
const SHOWN_ROLES = ["outline", "cheap"];
const ROLE_HELP = {
  outline: "작가실의 전제·초고 3권·고쳐쓰기·영어판·다듬기와 줄거리를 씁니다.",
  cheap: "독자 여섯이 듣고 읽는 일, 완성된 글에서 그림에 필요한 것을 읽는 일을 맡습니다.",
};
let api,
  configured = false,
  qualityData,
  coachController;
const quality = (state) =>
  normalizeStoryQualitySettings(state.settings?.storyQuality);
function patternsFor(state) {
  const custom = quality(state).patterns;
  return list(custom).length ? custom : list(qualityData?.plotPatterns);
}
export function storyQualityBookRecords(state) {
  const records = new Map(
    list(state.settings?.storyQuality?.approvedBooks)
      .filter((record) => record?.approved && record.outline?.beats)
      .map((record) => [record.bookId, record]),
  );
  for (const book of list(state.books)) {
    const record = approvedBookRecord(book);
    if (record) records.set(record.bookId, record);
  }
  return [...records.values()]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 50);
}
export async function storyWorldTopic(
  worldId,
  { offset = 0, season = "auto", timeOfDay = "auto", data = qualityData } = {},
) {
  const lib = data?.worldLibrary,
    world = list(lib?.worlds).find((item) => item.id === worldId);
  if (!world) throw Error("주제 아이디어를 만들 모험 무대를 골라 주세요.");
  const { generateTopics, applyOverlay } = await import(
    "../story-quality/dist/expand.js"
  );
  const effectiveSeason =
      season === "auto"
        ? [
            "winter",
            "winter",
            "spring",
            "spring",
            "spring",
            "summer",
            "summer",
            "summer",
            "autumn",
            "autumn",
            "autumn",
            "winter",
          ][new Date().getMonth()]
        : season === "none"
          ? null
          : season,
    effectiveTime = timeOfDay === "night" ? "night" : "day";
  const current = applyOverlay(lib, world, effectiveSeason, effectiveTime),
    rows = generateTopics(
      { ...lib, worlds: [current] },
      {
        perWorld: 33,
        seed: 1,
        exclude: list(data.goldBooks)
          .map((book) => book.topic)
          .filter(Boolean),
      },
    );
  if (!rows.length)
    throw Error("이 무대의 주제를 준비하지 못했어요. 직접 주제를 적어 주세요.");
  return clone(
    rows[Math.max(0, Math.floor(Number(offset) || 0)) % rows.length],
  );
}
async function selectWorldTopic(element) {
  const container = element.closest(".quality-world-selectors");
  if (!container) return;
  const state = api.getState(),
    field = (name) =>
      container.querySelector(`[data-quality-world-field="${name}"]`)?.value,
    worldId = field("storyWorldId"),
    status = container.querySelector("[data-quality-topic-status]"),
    offset =
      element.dataset.qualityTopicWorld === worldId
        ? Number(element.dataset.qualityTopicOffset) || 0
        : 0;
  element.disabled = true;
  try {
    const suggestion = await storyWorldTopic(worldId, {
      offset,
      season: field("storySeason"),
      timeOfDay: field("storyTimeOfDay"),
    });
    if (!api.isParent() || api.getState() !== state) return;
    if (!api.setWizardTopic)
      throw Error("이 화면에서는 주제를 직접 적어 주세요.");
    api.setWizardTopic(suggestion.topic, {
      worldId: suggestion.worldId,
      patternId: suggestion.patternId,
    });
    element.dataset.qualityTopicWorld = worldId;
    element.dataset.qualityTopicOffset = String(offset + 1);
    if (status)
      status.textContent =
        "주제 칸에 아이디어를 넣었어요. 자유롭게 고쳐 주세요.";
  } catch (error) {
    if (status) status.textContent = error.message;
    api.toast?.(error.message);
  } finally {
    if (element.isConnected !== false) element.disabled = worldId === "drawer";
  }
}

export function validateQualityPatternCards(cards) {
  const errors = [],
    keys = [
      "id",
      "name",
      "bestFor",
      "emotions",
      "beats",
      "refrain",
      "pageTurn",
      "avoid",
    ],
    text = (value, max) =>
      typeof value === "string" && value.trim() && value.length <= max,
    strings = (value) =>
      Array.isArray(value) &&
      value.length <= 20 &&
      value.every((item) => text(item, 100));
  if (!Array.isArray(cards) || !cards.length || cards.length > 20)
    return { valid: false, errors: ["패턴 카드는 1~20개여야 해요."] };
  const ids = new Set();
  for (const [index, card] of cards.entries()) {
    const label = `${index + 1}번 패턴`;
    if (
      !card ||
      typeof card !== "object" ||
      Array.isArray(card) ||
      Object.keys(card).some((key) => !keys.includes(key))
    ) {
      errors.push(
        `${label}에는 구조 필드만 사용할 수 있어요. 책 제목·인물·본문은 넣지 마세요.`,
      );
      continue;
    }
    if (
      !text(card.id, 100) ||
      !/^[a-z][a-z0-9_-]*$/i.test(card.id) ||
      ids.has(card.id)
    )
      errors.push(`${label}의 ID가 잘못됐거나 중복됐어요.`);
    ids.add(card.id);
    if (
      !text(card.name, 100) ||
      !strings(card.bestFor) ||
      !strings(card.emotions)
    )
      errors.push(`${label}의 이름·주제·감정을 확인해 주세요.`);
    if (
      !Array.isArray(card.beats) ||
      card.beats.length < 6 ||
      card.beats.length > 8 ||
      card.beats.some(
        (beat) =>
          !beat ||
          Object.keys(beat).some((key) => !["type", "slot"].includes(key)) ||
          !Object.hasOwn(TYPES, beat.type) ||
          !text(beat.slot, 1000),
      )
    )
      errors.push(
        `${label}의 비트는 6~8개이며 각 비트에 유형과 구성 설명이 필요해요.`,
      );
    if (
      !card.refrain ||
      Object.keys(card.refrain).some(
        (key) => !["type", "hint"].includes(key),
      ) ||
      !["frame", "count", "question"].includes(card.refrain.type) ||
      !text(card.refrain.hint, 1000) ||
      !text(card.pageTurn, 1000) ||
      !text(card.avoid, 1000)
    )
      errors.push(`${label}의 후렴·쪽 넘김·피할 구성을 확인해 주세요.`);
  }
  return { valid: errors.length === 0, errors };
}
function roleFields(state, role) {
  const q = quality(state),
    resolved = resolveQualityStageSettings(
      getTextGenerationSettings(state),
      role,
      q,
    ),
    explicit = q.engines?.[role] || {},
    selected = explicit.engine || "",
    engine = selected || resolved.engineId;
  return `<fieldset class="quality-role"><legend>${ROLE_NAMES[role]}</legend>${ROLE_HELP[role] ? `<p class="small-label">${ROLE_HELP[role]}</p>` : ""}<label class="field"><span>엔진</span><select data-quality-role-engine="${role}"><option value="" ${!selected ? "selected" : ""}>부모 글 엔진에서 자동</option>${Object.entries(
    ENGINES,
  )
    .map(
      ([id, name]) =>
        `<option value="${id}" ${selected === id ? "selected" : ""}>${name}</option>`,
    )
    .join(
      "",
    )}</select></label><label class="field"><span>모델 · 비우면 단계 기본값</span><input data-quality-role-model="${role}" list="quality-models-${role}" maxlength="200" value="${esc(explicit.model || "")}" placeholder="${esc(resolved.config.model || "로컬 기본 모델")}"><datalist id="quality-models-${role}">${roleModelOptions(
    getTextGenerationSettings(state),
    engine,
  )}</datalist></label></fieldset>`;
}
/** R13: the catalog plus the provider's fetched and typed models (글 엔진 설정). */
function roleModelOptions(settings, engine) {
  return listTextModelOptions(engine, settings.providers?.[engine] || {})
    .map(
      (row) => `<option value="${esc(row.id)}">${esc(row.label)}</option>`,
    )
    .join("");
}
export function renderStoryQualitySettings(state) {
  // R55a-2: the parent could not find the 작가실 switch in ③; it lives here too (the same stored setting).
  // R54c: on by default; only `false` is stored.
  const roomOn = state?.settings?.textGeneration?.writersRoom !== false;
  return `<section class="panel" id="story-quality-settings"><h3>글 모델</h3><p class="section-sub">작가실이 쓰는 모델 둘이에요. 이야기의 모양·길이·끝은 작가실이 정하고, 등급과 언어는 '우리 아이' 설정을 써요.</p><form id="story-quality-form">${renderCheckboxSwitch({ id: "quality-writers-room", label: "작가실로 만들기", description: "작가가 전제 열두 개를 내고 독자 여섯이 듣고 부모님이 셋 중 하나를 골라요. 초고 3권을 통째로 쓰고 고쳐 써요. 글 요금이 늘어요. 켜면 다음 새 이야기부터예요.", checked: roomOn, className: "quality-toggle quality-writers-room" })}<div class="quality-role-grid">${SHOWN_ROLES.map((role) => roleFields(state, role)).join("")}</div><div class="form-actions"><button type="submit" class="btn btn-green">모델 저장</button></div><p id="quality-settings-error" class="pin-error" aria-live="polite"></p></form></section>`;
}
function readSettings(form, state) {
  const q = quality(state),
    settings = getTextGenerationSettings(state);
  for (const element of form.querySelectorAll("[data-quality-flag]"))
    q[element.dataset.qualityFlag] = element.checked;
  // R54a: only the roles the form shows; the others keep their stored engines.
  for (const role of Object.keys(ROLE_NAMES).filter((role) => form.querySelector(`[data-quality-role-engine="${role}"]`))) {
    const engine = form.querySelector(
        `[data-quality-role-engine="${role}"]`,
      )?.value,
      model =
        form
          .querySelector(`[data-quality-role-model="${role}"]`)
          ?.value.trim() || "";
    if (!engine && !model) {
      delete q.engines[role];
      continue;
    }
    const resolved = resolveQualityStageSettings(settings, role, {
        ...q,
        engines: { ...q.engines, [role]: engine ? { engine } : {} },
      }),
      id = engine || resolved.engineId;
    if (
      model &&
      id !== "local" &&
      !listTextModelOptions(id, settings.providers?.[id] || {}).some(
        (row) => row.id === model,
      )
    )
      throw Error(`${ROLE_NAMES[role]}에 사용할 모델을 골라 주세요.`);
    q.engines[role] = { engine: id, ...(model ? { model } : {}) };
  }
  // R54a: a control the form no longer shows keeps its stored value.
  q.patternId = form.querySelector("#quality-default-pattern")?.value || q.patternId || "auto";
  // R33: the default stage (자동 is stored as "auto" and normalizes to no key).
  q.stageCategoryId =
    form.querySelector("#quality-default-stageCategoryId")?.value || q.stageCategoryId || "auto";
  q.worldId =
    form.querySelector("#quality-default-storyWorldId")?.value ||
    q.worldId ||
    "drawer";
  q.season =
    form.querySelector("#quality-default-storySeason")?.value ||
    q.season ||
    "auto";
  q.timeOfDay =
    form.querySelector("#quality-default-storyTimeOfDay")?.value ||
    q.timeOfDay ||
    "auto";
  const variantField = form.querySelector("#quality-variant-chance");
  if (variantField) {
    const raw = variantField.value.trim(),
      percent = Number(raw);
    if (!raw || !Number.isFinite(percent) || percent < 0 || percent > 100)
      throw Error("변형 확률은 0~100%로 적어 주세요.");
    q.variantChance = percent / 100;
  }
  const cards = clone(patternsFor(state));
  for (const element of form.querySelectorAll("[data-quality-pattern-field]")) {
    const card = cards[Number(element.dataset.qualityPatternIndex)],
      path = element.dataset.qualityPatternField.split(".");
    if (!card) continue;
    let target = card;
    for (const key of path.slice(0, -1)) target = target[key];
    target[path.at(-1)] = ["bestFor", "emotions"].includes(path[0])
      ? element.value
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : element.value.trim();
  }
  if (cards.length) {
    const report = validateQualityPatternCards(cards);
    if (!report.valid) throw Error(report.errors.join("\n"));
    q.patterns = cards;
  }
  return normalizeStoryQualitySettings(q);
}
function displayError(error) {
  const element =
    document.querySelector("#quality-settings-error") ||
    document.querySelector("#quality-coach-status");
  if (element) element.textContent = error.message;
  api.toast?.(error.message);
}
/** Boolean quality switches a screen may flip on its own (the simple screen's 승인 예시 button). */
const QUALITY_OPTION_KEYS = new Set([
  "useDistilledExamples",
  "useBeamSearch",
  "enabled",
  "twoPass",
  "childSimulator",
  "weeklyCoach",
]);
/**
 * Set one boolean quality option without submitting the whole quality form:
 * spread-merges into state.settings.storyQuality (approvedBooks, coach data and
 * every other key are kept) and saves. Returns false and restores the previous
 * value when the save fails. New drafts snapshot the value at creation.
 */
export function setStoryQualityOption(state, key, value) {
  if (!QUALITY_OPTION_KEYS.has(key))
    throw Error("이 글 품질 설정은 여기서 바꿀 수 없어요.");
  state.settings ||= {};
  const hadQuality = Object.hasOwn(state.settings, "storyQuality"),
    previous = state.settings.storyQuality;
  state.settings.storyQuality = { ...(previous || {}), [key]: value === true };
  if (api?.save && api.save() === false) {
    if (hadQuality) state.settings.storyQuality = previous;
    else delete state.settings.storyQuality;
    return false;
  }
  return true;
}
export function cleanupStoryQualityUI() {
  coachController?.abort();
  coachController = null;
}
export function configureStoryQualityUI(context) {
  api = context;
  if (context.qualityData) qualityData = context.qualityData;
  else
    loadStoryQualityData()
      .then((data) => {
        qualityData = data;
        if (api.isParent() && document.querySelector("#story-quality-settings"))
          api.render();
      })
      .catch((error) => api.toast?.(error.message));
  if (configured) return;
  configured = true;
  document.addEventListener("submit", (event) => {
    if (event.target.id !== "story-quality-form") return;
    event.preventDefault();
    if (!api.isParent()) return;
    try {
      const state = api.getState(),
        next = readSettings(event.target, state);
      state.settings ||= {};
      // R55a-2: the 작가실 switch on this panel (stored with the text settings, only as true).
      const roomBox = event.target.querySelector("#quality-writers-room");
      if (roomBox) {
        const text = (state.settings.textGeneration ||= {});
        // R54c: on by default — only an off is stored.
        if (roomBox.checked) delete text.writersRoom;
        else text.writersRoom = false;
      }
      state.settings.storyQuality = {
        ...(state.settings.storyQuality || {}),
        ...next,
      };
      // Auto normalizes to an absent key; do not restore the previous stage by merging.
      if (!next.stageCategoryId) delete state.settings.storyQuality.stageCategoryId;
      if (api.save() === false)
        throw Error("글 품질 설정을 저장하지 못했어요.");
      api.render();
      api.toast("새 이야기부터 이 모델을 써요.");
    } catch (error) {
      displayError(error);
    }
  });
  // R55b: the pro ② world selectors (and their change handler) are gone with the pro screens.
  document.addEventListener("click", (event) => {
    const element = event.target.closest("[data-quality-action]");
    if (!element) return;
    event.preventDefault();
    if (!api.isParent()) return;
    const action = element.dataset.qualityAction;
    if (action === "world-topic") {
      void selectWorldTopic(element);
      return;
    }
    try {
      const state = api.getState();
      if (action === "approve-coach") {
        const ruleIndices = [
            ...document.querySelectorAll("[data-quality-coach-rule]:checked"),
          ].map((item) => Number(item.dataset.qualityCoachRule)),
          banIndices = [
            ...document.querySelectorAll("[data-quality-coach-ban]:checked"),
          ].map((item) => Number(item.dataset.qualityCoachBan));
        if (!ruleIndices.length && !banIndices.length)
          throw Error("승인할 제안을 먼저 골라 주세요.");
        applyCoachProposals(state, { ruleIndices, banIndices });
      } else if (action === "rollback")
        rollbackQualityRules(state, {
          version: Number(
            document.querySelector("#quality-rollback-version")?.value,
          ),
        });
      else return;
      if (api.save() === false) throw Error("규칙 변경을 저장하지 못했어요.");
      api.render();
      api.toast(
        action === "rollback"
          ? "이전 규칙으로 되돌렸어요."
          : "선택한 제안만 적용했어요.",
      );
    } catch (error) {
      displayError(error);
    }
  });
}
