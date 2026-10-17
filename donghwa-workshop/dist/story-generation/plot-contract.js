/* An original causal plan and deterministic state ledger, independent of prose style. */
const textSchema = (maxLength = 500) => ({
  type: "string",
  minLength: 1,
  maxLength,
});
const idSchema = () => textSchema(100);
const idList = (maxItems = 12) => ({
  type: "array",
  items: idSchema(),
  maxItems,
  uniqueItems: true,
});
const strict = (properties) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const characterStateSchema = strict({
  characterId: idSchema(),
  locationId: textSchema(300),
  knows: {
    type: "array",
    items: textSchema(250),
    maxItems: 12,
    uniqueItems: true,
  },
});
const propStateSchema = strict({
  id: idSchema(),
  name: textSchema(100),
  ownerId: { anyOf: [idSchema(), { type: "null" }] },
  locationId: textSchema(300),
  condition: textSchema(250),
});
const stateSchema = strict({
  characters: {
    type: "array",
    items: characterStateSchema,
    minItems: 1,
    maxItems: 5,
  },
  props: { type: "array", items: propStateSchema, maxItems: 16 },
  openPromises: idList(12),
});
export const PLOT_CONTRACT_SCHEMA = strict({
  version: { type: "integer", enum: [1] },
  protagonistId: idSchema(),
  goal: textSchema(500),
  resolutionCriterion: textSchema(500),
  beats: {
    type: "array",
    minItems: 6,
    maxItems: 8,
    items: strict({
      beatIndex: { type: "integer", minimum: 1, maximum: 8 },
      becauseOfBeatIndex: {
        anyOf: [{ type: "integer", minimum: 1, maximum: 8 }, { type: "null" }],
      },
      trigger: textSchema(500),
      attempt: textSchema(500),
      obstacle: textSchema(500),
      result: textSchema(500),
      nextDecision: textSchema(500),
      stateBefore: stateSchema,
      stateAfter: stateSchema,
      setupIds: idList(8),
      payoffIds: idList(8),
    }),
  },
});

const preset = (id, name, description, principles) =>
  Object.freeze({
    id,
    name,
    description,
    principles: Object.freeze(principles),
  });
export const STORY_STRUCTURE_PRESETS = Object.freeze([
  preset(
    "auto",
    "주제에 맞게 자동 선택",
    "주제의 질문과 관계를 보고 이야기 구조를 골라요.",
    [
      "주인공의 한 가지 목표와 관찰 가능한 해결 조건을 먼저 정한다.",
      "모든 사건을 앞선 결과 때문에 내리는 다음 선택으로 연결한다.",
      "기존 작품의 문장·인물·고유 사건 대신 일반적인 구성 원리만 사용한다.",
    ],
  ),
  preset(
    "attempt_chain",
    "시도와 성장",
    "서로 다른 시도의 결과를 쌓아 주인공이 해결해요.",
    [
      "첫 시도가 잘되지 않은 구체적인 원인을 보여 준다.",
      "다음 시도는 앞선 실패에서 배운 점을 바탕으로 방법을 바꾼다.",
      "앞에서 준비한 단서나 경험을 활용해 주인공이 마지막 해결 행동을 선택한다.",
    ],
  ),
  preset(
    "discovery",
    "탐색과 발견",
    "질문을 따라 단서를 모으고 관찰한 사실로 답을 찾아요.",
    [
      "관찰 가능한 현상에서 하나의 분명한 질문을 만든다.",
      "각 탐색은 새로운 단서를 주거나 앞선 생각을 구체적인 이유로 수정한다.",
      "반전과 답은 이미 등장한 단서를 새롭게 이해한 결과여야 한다.",
    ],
  ),
  preset(
    "relationship",
    "마음과 협력",
    "서로 다른 바람을 이해하고 행동으로 관계를 바꿔요.",
    [
      "각 인물의 바람과 갈등이 생긴 구체적인 상황을 보여 준다.",
      "상대의 반응 때문에 주인공이 말을 바꾸거나 협력 방법을 시도한다.",
      "말로 교훈을 설명하기보다 앞서 선택한 배려 행동의 결과로 관계를 해결한다.",
    ],
  ),
]);

export function resolveStructurePreset(id, topic = "") {
  const selected = STORY_STRUCTURE_PRESETS.find((row) => row.id === id);
  if (selected && selected.id !== "auto") return selected;
  const source = String(topic || "");
  const chosen =
    /(?:친구|함께|나눔|나누|협력|양보|배려|화해|약속|마음|갈등|우정|friend|shar(?:e|ing)|kind|team|help|wait|sorry)/iu.test(
      source,
    )
      ? "relationship"
      : /(?:찾|발견|궁금|탐험|탐색|비밀|관찰|왜|어떻게|find|discover|search|mystery|wonder|explor)/iu.test(
            source,
          )
        ? "discovery"
        : "attempt_chain";
  return STORY_STRUCTURE_PRESETS.find((row) => row.id === chosen);
}

export function plotContractRules(input = {}) {
  const selected = resolveStructurePreset(
    input.storyStructurePresetId ||
      input.storyStructurePreset ||
      input.structurePreset,
    input.topic,
  );
  return `CAUSAL PLOT CONTRACT (version 1). Produce plotContract alongside the outline; it is an event contract, not printable prose. The selected original structure preset is ${selected.id}: ${selected.name}. Its principles are: ${selected.principles.join(" ")}
Choose ONE selected protagonistId and a concrete goal. resolutionCriterion must make the original goal's completion observable. Every contract beat matches one approved outline beat by beatIndex, in the same order. Record trigger -> protagonist's attempt -> specific obstacle -> observable result -> nextDecision. The first becauseOfBeatIndex is null; every later value is the immediately preceding beatIndex. The previous result and nextDecision must cause the next trigger and attempt. Different attempts must change method for a stated reason. The turn uses a previously established clue; resolution is achieved by the protagonist's decision, not an unexplained new helper, power, tool or structure. The close verifies the original resolutionCriterion.
For 12 pages, plan the four acts as: pages 1-2 establish home, a concrete desire and the departure trigger; pages 3-7 develop distinct attempts, their consequences and a usable clue; pages 8-10 reinterpret that earlier clue and show the protagonist choosing and performing the solution; pages 11-12 verify the goal and return home with a calm ending. Other page counts scale these proportions. These are page ranges, NOT a request for 12 beats. Preserve the required 6-8 beat count and chosen ending. Reading level changes wording, never removes causes or consequences.
stateBefore and stateAfter contain EVERY selected characterId, including offscene characters, each with a known locationId and an array of established knowledge facts (knows). Only use selected drawer background IDs for locationId. If no drawer backgrounds exist, use the outline's established settingKey/newPlace consistently. The next stateBefore must be exactly the previous stateAfter; array order does not matter. Travel, learning and object changes happen WITHIN a beat, never between ledgers. Retain established knowledge. Track every story-relevant prop by stable id and name, nullable selected-character ownerId, known locationId and condition. Once introduced, keep the prop in every later state, even when left behind, emptied or broken; represent its new condition/location instead of deleting it. Do not add a tool merely to solve a later problem. The scene's action and all state changes must agree with that beat's summary; never invent extra state events. On pages that share a beat, stateAfter is the beat endpoint, not a command to show future results or learned facts before the text reaches them.
setupIds introduce short unique clue/promise IDs; payoffIds refer ONLY to IDs introduced in an EARLIER beat. Record those same unresolved IDs in openPromises. Begin with no openPromises; stateAfter.openPromises equals stateBefore.openPromises plus this beat's setupIds minus its payoffIds. Close every introduced setup by the final beat and finish with no openPromises. Do not plant and resolve a clue in the same beat. IDs are references, not prose instructions.
Use structure principles only. Do not copy a reference book's plot, sentences, named characters, distinctive events, or visual style. All events must be newly authored from the current topic, selected materials, parent-entered value and ending.`;
}

const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const normalized = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim();
const canonical = (value) => JSON.stringify(sortValue(value));
function sortValue(value) {
  if (Array.isArray(value))
    return value
      .map(sortValue)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (object(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  return value;
}
const sameSet = (left, right) => canonical(left) === canonical(right);
const clone = (value) => JSON.parse(JSON.stringify(value));

function checkSchema(schema, value, path, add, beatIndex) {
  if (schema.anyOf) {
    if (
      !schema.anyOf.some((option) => {
        const misses = [];
        checkSchema(
          option,
          value,
          path,
          (code, message) => misses.push({ code, message }),
          beatIndex,
        );
        return misses.length === 0;
      })
    )
      add("invalid_field", `${path} 값의 형식을 확인해 주세요.`, beatIndex);
    return;
  }
  if (schema.type === "object") {
    if (!object(value)) {
      add("invalid_field", `${path}는 객체여야 해요.`, beatIndex);
      return;
    }
    for (const key of schema.required || [])
      if (!Object.hasOwn(value, key))
        add("missing_field", `${path}.${key}가 필요해요.`, beatIndex);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key))
        add(
          "unknown_field",
          `${path}.${key}는 플롯 장부에 없는 필드예요.`,
          beatIndex,
        );
      else
        checkSchema(
          schema.properties[key],
          value[key],
          `${path}.${key}`,
          add,
          beatIndex,
        );
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) {
      add("invalid_field", `${path}는 목록이어야 해요.`, beatIndex);
      return;
    }
    if (value.length < (schema.minItems || 0) || value.length > schema.maxItems)
      add("invalid_length", `${path} 목록의 개수를 확인해 주세요.`, beatIndex);
    if (
      schema.uniqueItems &&
      new Set(value.map(canonical)).size !== value.length
    )
      add("duplicate_value", `${path}에 같은 값이 중복됐어요.`, beatIndex);
    value
      .slice(0, 100)
      .forEach((item, index) =>
        checkSchema(
          schema.items,
          item,
          `${path}[${index + 1}]`,
          add,
          beatIndex,
        ),
      );
  } else if (schema.type === "string") {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > schema.maxLength ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
    )
      add(
        "invalid_field",
        `${path} 글자 수와 내용을 확인해 주세요.`,
        beatIndex,
      );
  } else if (schema.type === "integer") {
    if (
      !Number.isInteger(value) ||
      (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum) ||
      (schema.enum && !schema.enum.includes(value))
    )
      add("invalid_field", `${path} 번호를 확인해 주세요.`, beatIndex);
  } else if (schema.type === "null" && value !== null)
    add("invalid_field", `${path}는 null이어야 해요.`, beatIndex);
}

/** Deterministic integrity checks. Semantic causality is reviewed separately on the full prose. */
export function inspectPlotContract(contract, outline, input = {}) {
  const issues = [];
  const add = (code, message, beatIndex = null) => {
    if (
      issues.length < 80 &&
      !issues.some(
        (row) =>
          row.code === code &&
          row.message === message &&
          row.beatIndex === beatIndex,
      )
    )
      issues.push({ code, message, beatIndex, severity: "error" });
  };
  checkSchema(PLOT_CONTRACT_SCHEMA, contract, "plotContract", add, null);
  if (!object(contract))
    return { valid: false, errors: issues.map((row) => row.message), issues };
  const characters = Array.isArray(input.characters) ? input.characters : [],
    cast = new Set(characters.map((row) => row?.id).filter(Boolean));
  if (!cast.size || !cast.has(contract.protagonistId))
    add("unknown_protagonist", "주인공은 선택한 등장인물 ID 중 하나여야 해요.");
  const beats = Array.isArray(contract.beats) ? contract.beats : [],
    outlineBeats = Array.isArray(outline?.beats) ? outline.beats : [];
  if (beats.length !== outlineBeats.length)
    add("beat_count", "플롯 장부와 줄거리의 비트 개수가 같아야 해요.");
  const backgrounds = Array.isArray(input.backgrounds)
      ? input.backgrounds
      : Array.isArray(input.backgroundList)
        ? input.backgroundList
        : [],
    locations = new Set(backgrounds.map((row) => row?.id).filter(Boolean));
  if (!locations.size) {
    for (const beat of outlineBeats)
      if (beat?.settingKey) locations.add(beat.settingKey);
    for (const row of Array.isArray(outline?.settings) ? outline.settings : [])
      if (row?.newPlace) locations.add(row.newPlace);
  }
  const propsById = new Map(),
    propNames = new Map(),
    setups = new Map(),
    paid = new Set();
  let previousAfter = null;
  const inspectState = (state, beatIndex, label) => {
    if (!object(state)) return;
    const rows = Array.isArray(state.characters) ? state.characters : [],
      found = new Set();
    for (const row of rows) {
      if (!object(row)) continue;
      if (found.has(row.characterId))
        add(
          "duplicate_character",
          `${beatIndex}번 비트 ${label}에 같은 인물이 중복됐어요.`,
          beatIndex,
        );
      found.add(row.characterId);
      if (!cast.has(row.characterId))
        add(
          "unknown_character",
          `${beatIndex}번 비트 ${label}에 선택하지 않은 인물 ID가 있어요.`,
          beatIndex,
        );
      if (!locations.has(row.locationId))
        add(
          "unknown_location",
          `${beatIndex}번 비트 ${label}의 인물 장소는 등록된 배경 ID여야 해요.`,
          beatIndex,
        );
    }
    if ([...cast].some((id) => !found.has(id)))
      add(
        "missing_character",
        `${beatIndex}번 비트 ${label}에는 장면 밖 인물을 포함해 선택한 인물 모두의 상태가 필요해요.`,
        beatIndex,
      );
    const propIds = new Set(),
      names = new Set();
    for (const prop of Array.isArray(state.props) ? state.props : []) {
      if (!object(prop)) continue;
      const name = normalized(prop.name);
      if (propIds.has(prop.id))
        add(
          "duplicate_prop",
          `${beatIndex}번 비트 ${label}에 같은 소품 ID가 중복됐어요.`,
          beatIndex,
        );
      propIds.add(prop.id);
      if (names.has(name))
        add(
          "duplicate_prop_name",
          `${beatIndex}번 비트 ${label}의 같은 이름 소품은 서로 구분되는 이름을 사용해 주세요.`,
          beatIndex,
        );
      names.add(name);
      if (prop.ownerId !== null && !cast.has(prop.ownerId))
        add(
          "unknown_owner",
          `${beatIndex}번 비트 소품 소유자는 선택한 인물 ID 또는 null이어야 해요.`,
          beatIndex,
        );
      if (!locations.has(prop.locationId))
        add(
          "unknown_location",
          `${beatIndex}번 비트 ${label}의 소품 장소는 등록된 배경 ID여야 해요.`,
          beatIndex,
        );
      if (propsById.has(prop.id) && propsById.get(prop.id) !== name)
        add(
          "prop_renamed",
          `${beatIndex}번 비트에서 소품 ${prop.id}의 이름이 바뀌었어요.`,
          beatIndex,
        );
      if (propNames.has(name) && propNames.get(name) !== prop.id)
        add(
          "prop_reidentified",
          `${beatIndex}번 비트에서 같은 소품 이름의 ID가 바뀌었어요.`,
          beatIndex,
        );
      if (typeof prop.id === "string" && name) {
        propsById.set(prop.id, name);
        propNames.set(name, prop.id);
      }
    }
    for (const id of propsById.keys())
      if (!propIds.has(id))
        add(
          "prop_disappeared",
          `${beatIndex}번 비트 ${label}에서 이미 등장한 소품 ${id}가 사라졌어요. 남겨 둔 장소나 바뀐 상태를 기록해 주세요.`,
          beatIndex,
        );
  };
  beats.forEach((beat, index) => {
    if (!object(beat)) return;
    const beatIndex = Number.isInteger(beat.beatIndex)
      ? beat.beatIndex
      : index + 1;
    if (beat.beatIndex !== outlineBeats[index]?.index)
      add(
        "beat_order",
        `${index + 1}번째 플롯 장부는 같은 번호의 승인 줄거리 비트와 연결해야 해요.`,
        beatIndex,
      );
    const expected = index === 0 ? null : beats[index - 1]?.beatIndex;
    if (beat.becauseOfBeatIndex !== expected)
      add(
        "causal_link",
        `${beatIndex}번 비트는 바로 앞 비트의 결과에서 이어져야 해요. 첫 비트의 원인 번호는 null이에요.`,
        beatIndex,
      );
    if (previousAfter && !sameSet(beat.stateBefore, previousAfter))
      add(
        "state_discontinuity",
        `${beatIndex}번 비트 시작 상태가 앞 비트의 마지막 상태와 달라요. 이동·소유·정보 변화는 비트 안에서 설명해 주세요.`,
        beatIndex,
      );
    inspectState(beat.stateBefore, beatIndex, "시작 장부");
    inspectState(beat.stateAfter, beatIndex, "종료 장부");
    const before = object(beat.stateBefore) ? beat.stateBefore : {},
      after = object(beat.stateAfter) ? beat.stateAfter : {};
    for (const character of Array.isArray(before.characters)
      ? before.characters
      : []) {
      if (!object(character)) continue;
      const next = (
        Array.isArray(after.characters) ? after.characters : []
      ).find((row) => row?.characterId === character.characterId);
      if (
        next &&
        Array.isArray(character.knows) &&
        Array.isArray(next.knows) &&
        character.knows.some((fact) => !next.knows.includes(fact))
      )
        add(
          "knowledge_lost",
          `${beatIndex}번 비트에서 인물이 이미 알게 된 사실이 설명 없이 사라졌어요.`,
          beatIndex,
        );
    }
    const introduced = Array.isArray(beat.setupIds) ? beat.setupIds : [],
      payoffs = Array.isArray(beat.payoffIds) ? beat.payoffIds : [],
      openBefore = Array.isArray(before.openPromises)
        ? before.openPromises
        : [],
      openAfter = Array.isArray(after.openPromises) ? after.openPromises : [];
    if (index === 0 && openBefore.length)
      add(
        "initial_promises",
        "첫 비트 시작 장부에는 아직 심지 않은 복선이나 약속을 넣을 수 없어요.",
        beatIndex,
      );
    for (const id of introduced) {
      if (setups.has(id))
        add(
          "duplicate_setup",
          `${beatIndex}번 비트의 복선 ${id}는 이미 앞에서 사용한 ID예요.`,
          beatIndex,
        );
    }
    for (const id of payoffs) {
      if (!setups.has(id))
        add(
          "unprepared_payoff",
          `${beatIndex}번 비트의 회수 ${id}는 앞 비트에서 먼저 준비해야 해요.`,
          beatIndex,
        );
      else if (paid.has(id))
        add(
          "duplicate_payoff",
          `${beatIndex}번 비트의 복선 ${id}는 이미 회수했어요.`,
          beatIndex,
        );
      else paid.add(id);
    }
    const expectedOpen = [...new Set([...openBefore, ...introduced])].filter(
      (id) => !payoffs.includes(id),
    );
    if (!sameSet(openAfter, expectedOpen))
      add(
        "promise_state",
        `${beatIndex}번 비트의 미해결 약속 장부가 복선 추가·회수 내역과 맞지 않아요.`,
        beatIndex,
      );
    for (const id of introduced) if (!setups.has(id)) setups.set(id, beatIndex);
    previousAfter = after;
  });
  for (const [id, beatIndex] of setups)
    if (!paid.has(id))
      add(
        "unclosed_setup",
        `${beatIndex}번 비트에서 준비한 복선 ${id}를 마지막 비트까지 회수해 주세요.`,
        beatIndex,
      );
  if (previousAfter?.openPromises?.length)
    add(
      "unclosed_promises",
      "마지막 비트에는 미해결 복선이나 약속이 남지 않아야 해요.",
      beats.at(-1)?.beatIndex || null,
    );
  return {
    valid: issues.length === 0,
    errors: issues.map((row) => row.message),
    issues,
  };
}

export function plotContractForBeat(outline, beatIndex) {
  const beats = outline?.plotContract?.beats;
  return Array.isArray(beats)
    ? beats.find(
        (beat) => object(beat) && Number(beat.beatIndex) === Number(beatIndex),
      ) || null
    : null;
}

/** Explicit demo-mode metadata, never used to replace an engine's failed contract. */
export function demoPlotContract(outline, input = {}) {
  const selected = input.characters || [],
    cast = selected.map((row) => row.id),
    knownBackgrounds = new Set(
      (input.backgrounds || input.backgroundList || []).map((row) => row.id),
    ),
    beats = outline?.beats || [];
  const placeFor = (beat) => {
    const setting = outline?.settings?.find(
      (row) => row.beatIndex === beat.index,
    );
    const chosen =
      setting?.backgroundId ||
      beat.settingKey ||
      setting?.newPlace ||
      "demo-place";
    return knownBackgrounds.size && !knownBackgrounds.has(chosen)
      ? [...knownBackgrounds][0]
      : chosen;
  };
  const initialLocation = beats.length
    ? placeFor(beats[0])
    : [...knownBackgrounds][0] || "demo-place";
  let state = {
    characters: cast.map((characterId) => ({
      characterId,
      locationId: initialLocation,
      knows: [],
    })),
    props: [],
    openPromises: [],
  };
  const setupAt = beats.findIndex((beat) => beat.type === "want"),
    payoffAt = beats.findIndex((beat) => beat.type === "resolution");
  const canPay = setupAt >= 0 && payoffAt > setupAt;
  const rows = beats.map((beat, index) => {
    const before = clone(state),
      locationId = placeFor(beat),
      active = new Set(
        (beat.characters || cast).flatMap((value) => {
          const character = selected.find(
            (row) =>
              row.id === value || row.name === value || row.nameEn === value,
          );
          return character ? [character.id] : [];
        }),
      );
    if (!active.size) cast.forEach((id) => active.add(id));
    for (const row of state.characters)
      if (active.has(row.characterId)) row.locationId = locationId;
    const setupIds = canPay && index === setupAt ? ["goal-resolution"] : [],
      payoffIds = canPay && index === payoffAt ? ["goal-resolution"] : [];
    state.openPromises = [...state.openPromises, ...setupIds].filter(
      (id) => !payoffIds.includes(id),
    );
    const previous = beats[index - 1],
      next = beats[index + 1];
    return {
      beatIndex: beat.index,
      becauseOfBeatIndex: previous?.index ?? null,
      trigger: previous
        ? `앞 사건의 결과를 받아요: ${String(previous.summary).slice(0, 450)}`
        : `이야기의 시작 상황이에요: ${String(beat.summary).slice(0, 450)}`,
      attempt: String(beat.summary || "주인공이 다음 행동을 선택해요.").slice(
        0,
        500,
      ),
      obstacle:
        beat.type === "close" || beat.type === "resolution"
          ? "앞선 문제를 해결한 결과가 유지되는지 확인해요."
          : String(
              outline.problem || "목표를 이루기 위해 상황을 살펴봐야 해요.",
            ).slice(0, 500),
      result: String(beat.summary || "주인공이 행동의 결과를 확인해요.").slice(
        0,
        500,
      ),
      nextDecision: next
        ? `이 결과에서 다음 행동으로 이어가요: ${String(next.summary).slice(0, 450)}`
        : "처음 목표가 해결된 것을 확인하고 선택한 결말로 마무리해요.",
      stateBefore: before,
      stateAfter: clone(state),
      setupIds,
      payoffIds,
    };
  });
  return {
    version: 1,
    protagonistId: cast[0] || "demo-protagonist",
    goal: String(
      outline?.want || input.topic || "주인공의 목표를 이루어요.",
    ).slice(0, 500),
    resolutionCriterion: String(
      beats.find((beat) => beat.type === "resolution")?.summary ||
        outline?.twist ||
        "처음 목표가 이루어진 결과를 확인해요.",
    ).slice(0, 500),
    beats: rows,
  };
}
