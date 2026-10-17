/* Shared, editable story/image details. These are story data, never instructions. */
export const BRIEF_TIMES = Object.freeze([
  "morning",
  "day",
  "afternoon",
  "evening",
  "night",
]);
const text = { type: "string", minLength: 1, maxLength: 500 };
const bi = {
  type: "object",
  additionalProperties: false,
  required: ["ko", "en"],
  properties: { ko: text, en: text },
};
export const SCENE_BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "beatIndex",
    "timeOfDay",
    "weather",
    "light",
    "sounds",
    "smellOrTouch",
    "props",
    "creature",
    "pose",
    "dialogueLine",
    "humor",
  ],
  properties: {
    beatIndex: { type: "integer", minimum: 1, maximum: 8 },
    timeOfDay: { type: "string", enum: BRIEF_TIMES },
    weather: bi,
    light: bi,
    sounds: { type: "array", items: bi, minItems: 2, maxItems: 2 },
    smellOrTouch: bi,
    props: { type: "array", items: bi, minItems: 3, maxItems: 3 },
    creature: bi,
    pose: bi,
    dialogueLine: text,
    humor: text,
  },
};
export const SCENE_BRIEFS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["briefs"],
  properties: {
    briefs: {
      type: "array",
      items: SCENE_BRIEF_SCHEMA,
      minItems: 6,
      maxItems: 8,
    },
  },
};
export const sceneBriefRows = (value) =>
  Array.isArray(value)
    ? value
    : Array.isArray(value?.briefs)
      ? value.briefs
      : [];
const validText = (v) =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= 500 &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
const validBi = (v) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  validText(v.ko) &&
  validText(v.en);
const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
const propSignature = (brief) =>
  (Array.isArray(brief?.props) ? brief.props : [])
    .map((p) => normalize(p?.en))
    .sort()
    .join("|");
const ABSTRACT =
  /^(?:기쁨|용기|행복|슬픔|희망|친절|사랑|우정|joy|courage|happiness|sadness|hope|kindness|love|friendship)$/iu;
const ACTION =
  /(?:\b(?:walk|run|lift|hold|point|crouch|blow|hug|hide|listen|splash|climb|carry|wave|peek|tiptoe|touch|reach|bend|stretch|turn|step|look|grasp|pick|put|pull|push|sit|lie|kneel|stand|tap|place|press|blowing|holding|looking|waving|sitting|lying|running|listening)[a-z]*\b)/iu;
const BODY =
  /(?:\b(?:hand|arm|foot|feet|toe|finger|head|face|eye|ear|tail|paw|leg|knee|body|shoulder|mouth|back|nose)s?\b)/iu;
export function inspectSceneBriefs(value, outline, source = {}) {
  const briefs = sceneBriefRows(value),
    beats = outline?.beats || [],
    issues = [],
    add = (beatIndex, code, message) =>
      issues.push({ beatIndex, code, message });
  const allowed = new Set(beats.map((b) => b.index));
  for (const brief of briefs)
    if (!allowed.has(brief?.beatIndex))
      add(
        beats[0]?.index || 1,
        "unknown_beat",
        "승인한 비트에 해당하는 장면 디테일만 사용할 수 있어요.",
      );
  for (const beat of beats) {
    const rows = briefs.filter((b) => b?.beatIndex === beat.index),
      brief = rows[0];
    if (rows.length !== 1) {
      add(
        beat.index,
        "missing_brief",
        `${beat.index}번 비트의 장면 디테일이 하나씩 필요해요.`,
      );
      continue;
    }
    if (!BRIEF_TIMES.includes(brief.timeOfDay))
      add(beat.index, "time", "장면의 시간대를 선택해 주세요.");
    for (const key of ["weather", "light", "smellOrTouch", "creature", "pose"])
      if (!validBi(brief[key]))
        add(beat.index, "field", `${key}에 한글·영어 설명이 필요해요.`);
    for (const [key, count] of [
      ["sounds", 2],
      ["props", 3],
    ])
      if (
        !Array.isArray(brief[key]) ||
        brief[key].length !== count ||
        brief[key].some((p) => !validBi(p))
      )
        add(
          beat.index,
          "field",
          `${key}에 한글·영어 항목 ${count}개가 필요해요.`,
        );
    for (const key of ["dialogueLine", "humor"])
      if (!validText(brief[key]))
        add(beat.index, "field", `${key}를 한글로 작성해 주세요.`);
    if (
      (Array.isArray(brief.props) ? brief.props : []).some(
        (p) => ABSTRACT.test(p?.ko || "") || ABSTRACT.test(p?.en || ""),
      )
    )
      add(
        beat.index,
        "abstract_prop",
        "소품은 감정이나 가치가 아닌 구체적인 물건이어야 해요.",
      );
    if (
      validBi(brief.pose) &&
      (!ACTION.test(brief.pose.en) || !BODY.test(brief.pose.en))
    )
      add(
        beat.index,
        "pose",
        "동작에는 눈·손·발 등 신체 부위와 그릴 수 있는 행동을 함께 적어 주세요.",
      );
  }
  const ordered = beats.map((b) =>
    briefs.find((v) => v?.beatIndex === b.index),
  );
  if (ordered[0] && ordered[0].timeOfDay !== "morning")
    add(beats[0].index, "first_time", "첫 장면은 아침부터 시작해요.");
  if (
    ordered.at(-1) &&
    !["evening", "night"].includes(ordered.at(-1).timeOfDay)
  )
    add(
      beats.at(-1).index,
      "last_time",
      "마지막 장면은 저녁이나 밤으로 이어 주세요.",
    );
  ordered.forEach((brief, i) => {
    if (!brief) return;
    const previous = ordered[i - 1];
    if (
      previous &&
      BRIEF_TIMES.indexOf(brief.timeOfDay) <
        BRIEF_TIMES.indexOf(previous.timeOfDay)
    )
      add(
        brief.beatIndex,
        "time_backwards",
        "시간이 앞 장면보다 뒤로 돌아가지 않게 해 주세요.",
      );
    if (
      i > 1 &&
      brief.props?.length === 3 &&
      propSignature(brief) === propSignature(previous) &&
      propSignature(brief) === propSignature(ordered[i - 2])
    )
      add(
        brief.beatIndex,
        "repeated_props",
        "세 장면 연속 소품 세트가 같아요. 사건에 맞는 소품을 골라 주세요.",
      );
  });
  const creatures = new Set(
    ordered
      .filter((b) => validBi(b?.creature))
      .map((b) => normalize(b.creature.en).replace(/^(?:a|an|the)\s+/u, "")),
  );
  if (ordered.length > 1 && creatures.size < 2)
    add(
      beats[Math.max(0, beats.length - 2)].index,
      "creature_variety",
      "이 장소에 살 수 있는 작은 배경 생물을 책 전체에서 두 종류 이상 보여 주세요.",
    );
  const rainy =
    /(?:^|\s)비(?:가|는|를|와|오는|의|\s|$)|빗|장마|\brain\b/iu.test(
      String(source.topic || ""),
    );
  if (rainy) {
    const middle = ordered.slice(1, -1),
      body = JSON.stringify(middle).toLowerCase();
    if (
      !/rain|비|빗/u.test(body) ||
      !/puddle|물웅덩이/u.test(body) ||
      !/umbrella|우산/u.test(body)
    )
      add(
        beats[Math.min(2, beats.length - 1)].index,
        "rain_topic",
        "비 주제의 중간 장면에 비·물웅덩이·우산을 사건에 맞게 포함해 주세요.",
      );
  }
  return {
    valid: !issues.length,
    passed: !issues.length,
    issues,
    errors: issues.map((i) => i.message),
    failedBeatIndexes: [...new Set(issues.map((i) => i.beatIndex))],
  };
}
export function sceneBriefRules() {
  return `Create one bilingual SceneBrief per approved beat. All fields are required. These details are shared by prose and illustrations.
Preserve the approved event, character identity/speech habits and fixed background geometry FIRST. Never invent a permanent structure, new room, speaking character, or action that contradicts the outline merely for variety. Creatures are small background life appropriate to the supplied place and time, never additional speaking cast.
Time progresses monotonically morning -> day -> afternoon -> evening -> night (stages may repeat or be skipped); first beat morning, final beat evening or night. Weather follows the topic and remains continuous. A rain topic includes rain, puddle and umbrella in appropriate middle beats.
Each props array has exactly THREE concrete, level-appropriate nouns; not abstract emotions or values. Do not repeat the same three-prop set across three consecutive beats. Include at least two kinds of suitable background creatures across the book.
sounds has TWO bilingual sound/movement details. pose is ONE drawable action with an explicit English physical action verb and body part (hand, foot, eyes, tail, etc.). Expressions like 'looks happy' alone are insufficient. Keep the action faithful to the beat. dialogueLine and humor are Korean; dialogue respects the character's speech habit and has an explicit subject. Prefer existing recurring props over invented replacements. English fields are image-ready descriptions, not instructions or author/studio names.`;
}
export function demoSceneBriefs(outline, input) {
  const bi = (ko, en) => ({ ko, en }),
    count = outline.beats.length;
  return outline.beats.map((beat, index) => ({
    beatIndex: beat.index,
    timeOfDay:
      index === 0
        ? "morning"
        : index === count - 1
          ? "night"
          : BRIEF_TIMES[Math.min(3, Math.floor((index * 4) / count))],
    weather: bi("잔잔한 바람", "gentle breeze"),
    light: bi(
      index === count - 1 ? "따뜻한 작은 불빛" : "부드러운 햇빛",
      index === count - 1 ? "soft warm light" : "soft daylight",
    ),
    sounds: [
      bi("휘잉", "whoosh"),
      bi(index % 2 ? "사뿐사뿐" : "살랑살랑", index % 2 ? "tiptoe" : "rustle"),
    ],
    smellOrTouch: bi("보들보들한 잎", "soft leaf texture"),
    props:
      index % 2
        ? [
            bi("작은 잎", "small leaf"),
            bi("매끈한 돌", "smooth pebble"),
            bi("풀줄기", "grass stem"),
          ]
        : [
            bi("넓은 잎", "broad leaf"),
            bi("가는 풀", "slender grass"),
            bi("작은 돌", "small pebble"),
          ],
    creature:
      index % 2
        ? bi("작은 달팽이", "small snail")
        : bi("작은 새", "small bird"),
    pose: bi("손으로 잎을 살펴보기", "holding a leaf in one hand"),
    dialogueLine: `${input.characters[0].name}는 “나는 이 소리를 들어!”라고 말해요.`,
    humor: "잎이 살짝 흔들리며 손끝을 간질여요.",
  }));
}
