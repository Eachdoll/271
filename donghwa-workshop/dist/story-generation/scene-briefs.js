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
/*
 * 2026-10-19 hotfix. The pose gate used to demand one of ~40 English verbs AND a
 * body-part noun in pose.en, so ordinary drawable actions ('Yuha scoops leaves
 * into the hat', 'Yuha nods', 'Yuha hops toward the pond') stopped a paid book
 * after two repairs with the same message. Now only an emotion-only pose
 * ('looks happy') is a repair target, accepted as a note once repairs run out;
 * a pose without a listed verb or body part is a note and never a stop.
 *
 * Severity: 'hard' stops the stage after repairs (beat number, required
 * fields, counts outside the accepted range); 'soft' is repaired, then kept as
 * a note; 'advisory' is never repaired or billed (prop variety, creature
 * variety, rain props, pose detail) because repairing it for variety alone
 * changes approved props or scenes.
 */
import { hasPromptDiet, leanSceneBriefRules } from "./prompt-diet.js";
// R31c: on the diet the day's clock and the pose/prop style are notes, not fix calls.
const LEAN_ADVISORY = new Set(["first_time", "last_time", "time_backwards", "pose", "abstract_prop"]);
export const SCENE_BRIEF_SEVERITY = Object.freeze({
  unknown_beat: "hard",
  missing_brief: "hard",
  time: "hard",
  field: "hard",
  abstract_prop: "soft",
  pose: "soft",
  first_time: "soft",
  last_time: "soft",
  time_backwards: "soft",
  pose_detail: "advisory",
  repeated_props: "advisory",
  creature_variety: "advisory",
  rain_topic: "advisory",
});
/** Accepted counts: the prompt still asks for 2 sounds and 3 props. */
export const SCENE_BRIEF_COUNTS = Object.freeze({
  sounds: Object.freeze({ target: 2, min: 1, max: 3 }),
  props: Object.freeze({ target: 3, min: 2, max: 4 }),
});
const ACTION_WORDS =
  "walk|run|jump|hop|skip|leap|lift|hold|carry|point|crouch|kneel|squat|blow|hug|hide|listen|splash|climb|wave|peek|peer|tiptoe|touch|reach|bend|stretch|turn|step|look|gaze|stare|watch|grasp|grab|pick|put|pull|push|sit|lie|lay|stand|tap|place|press|scoop|nod|shake|dig|pour|fill|open|close|shut|throw|toss|catch|kick|roll|spin|dance|sing|shout|call|whisper|wipe|brush|pat|rub|stroke|pet|feed|bite|chew|eat|drink|sip|sniff|smell|lean|crawl|swim|float|fly|flap|wag|stomp|stamp|shuffle|slide|swing|hang|balance|tilt|drop|cover|wrap|tie|fold|hand|give|take|offer|show|raise|lower|rest|cuddle|snuggle|curl|perch|glance|squint|blink|wink|smile|grin|laugh|giggle|yawn|bow|pedal|ride|row|paddle|sweep|scrub|wash|spray|squeeze|pinch|poke|knock|ring|stir|mix|knead|sprinkle|scatter|plant|water|pluck|gather|collect|tuck|slip|dip|drag|tug|trot|gallop|dash|race|chase|follow|lead|guide|cup|clap|hum|wiggle|wriggle|stumble|trip|duck|dodge|sneak|march|wade|scramble|clutch|cradle|hoist|haul|heave|peel|crack|snap|bounce|twirl|sway|rock|nudge|bump|flick|swish|swoop|dive|bury|build|stack|pile|arrange|sort|count|draw|paint|write|read|trace|cut|tear|stick|glue|hammer|sew|knit|comb|tidy|dangle|fetch|bring|pass|share|seek|search|hunt|spot|find|notice|examine|inspect|study|measure|weigh|serve|kneel|crouch|lift";
const ACTION = new RegExp(`\\b(?:${ACTION_WORDS})[a-z]*\\b`, "iu");
const BODY =
  /(?:\b(?:hand|arm|foot|feet|toe|finger|thumb|palm|fist|head|face|eye|ear|tail|paw|leg|knee|body|shoulder|mouth|back|nose|chin|cheek|lip|tongue|neck|belly|tummy|wing|beak|hoof|hooves|claw|snout|whisker|elbow|wrist|ankle|heel|lap|chest|hip)s?\b)/iu;
const BODY_KO =
  /(?:손|팔|발|다리|무릎|머리|얼굴|눈|귀|꼬리|입|코|어깨|등|배|날개|부리|발톱|손가락|발가락|뺨|볼|턱|목|앞발|뒷발|주둥이|수염)/u;
const ACTION_KO =
  /(?:들어|들고|들며|잡|만지|만져|뛰|달리|달려|걷|걸어|앉|눕|숨|안아|안고|가리키|가리켜|흔들|두드리|두드려|밀|당기|당겨|던지|던져|줍|주워|담|담아|퍼|올리|올려|내리|내려|밟|끄덕|숙이|숙여|펴|기대|오르|올라|열|닫|쓰다듬|긁|쓸|닦|문지르|비비|핥|씹|먹|마시|맡|기어|헤엄|날아|파|붓|채우|채워|굴리|굴려|돌리|돌려|춤추|노래|외치|외쳐|부르|불러|속삭|웃|하품|절하|찌르|찔러|누르|눌러|꼬집|살피|살펴|들여다보|바라보|쳐다보|올려다보|내려다보|구르|굴러|미끄러|매달리|매달려|기울|덮|싸|묶|접|건네|받|보여주|쥐고|쥐어|뻗|감싸|끌|업|태우|타고|젓|빨|씻|뿌리|뿌려|심|모으|모아|끼우|빼|넣|꺼내|담그|뛰어|서서|세우|앉히|눕히|두고|놓|집어|집고|쌓|그리|그려|쓰고|자르|잘라|찢|붙이|붙여|두르|풀|쓰러|구부리|펼치|펼쳐|툭|콩콩|살금|총총|폴짝|깡충|성큼)/u;
const EMOTION_WORDS =
  "happy|glad|sad|joyful|joyous|cheerful|excited|thrilled|delighted|pleased|proud|brave|courageous|scared|afraid|frightened|worried|nervous|anxious|angry|mad|upset|calm|relaxed|tired|sleepy|shy|surprised|amazed|curious|hopeful|grateful|thankful|lonely|bored|confused|content|relieved|embarrassed|disappointed|frustrated|jealous|silly|sorry|fine|okay|ok|good|great|wonderful|cozy|comfortable|safe|warm|happier|braver|calmer|sadder";
const COPULA =
  "is|are|was|were|be|being|looks?|looking|feels?|feeling|seems?|seeming|appears?|appearing|gets?|getting|becomes?|becoming|stays?|staying|remains?|remaining";
const DEGREE =
  "(?:(?:very|so|really|quite|rather|truly|too|all|a\\s+little|a\\s+bit|extra|super)\\s+)?";
/** 'Yuha looks very happy.', 'feels brave', 'happy' — a feeling with no action to draw. */
const EMOTION_ONLY_EN = new RegExp(
  `^\\W*(?:(?:[a-z][a-z'-]*\\s+){0,4}(?:${COPULA})\\s+|(?:[a-z][a-z'-]*\\s+)?)${DEGREE}(?:${EMOTION_WORDS})(?:\\s*(?:,|and|but)\\s*${DEGREE}(?:${EMOTION_WORDS}))?\\W*$`,
  "iu",
);
/** null = drawable; 'soft' = emotion only; 'advisory' = no listed verb or body part. */
export function poseConcern(pose) {
  const en = String(pose?.en || ""),
    ko = String(pose?.ko || "");
  if (EMOTION_ONLY_EN.test(en)) return "soft";
  if (ACTION.test(en) || BODY.test(en) || BODY_KO.test(ko) || ACTION_KO.test(ko))
    return null;
  return "advisory";
}
const TIME_ALIASES = Object.freeze({
  dawn: "morning",
  sunrise: "morning",
  "early morning": "morning",
  아침: "morning",
  새벽: "morning",
  noon: "day",
  midday: "day",
  daytime: "day",
  낮: "day",
  점심: "day",
  "late afternoon": "afternoon",
  오후: "afternoon",
  dusk: "evening",
  sunset: "evening",
  twilight: "evening",
  저녁: "evening",
  해질녘: "evening",
  midnight: "night",
  밤: "night",
  한밤: "night",
});
/**
 * Deterministic clean-up of one model-written brief (also applied to a saved
 * checkpoint, so a resumed job replays without a new call): a numeric string
 * beatIndex, a time-of-day synonym or capital, and an unusable sound/prop item
 * (no ko or no en) dropped when enough valid items remain. Content is never
 * added or rewritten; a brief that is already valid comes back byte-identical.
 */
export function normalizeSceneBrief(brief) {
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) return brief;
  const next = { ...brief };
  if (typeof next.beatIndex === "string" && /^\s*\d+\s*$/u.test(next.beatIndex))
    next.beatIndex = Number(next.beatIndex);
  if (typeof next.timeOfDay === "string") {
    const key = next.timeOfDay.trim().toLowerCase();
    next.timeOfDay = BRIEF_TIMES.includes(key)
      ? key
      : TIME_ALIASES[key] || next.timeOfDay;
  }
  for (const [key, { min }] of Object.entries(SCENE_BRIEF_COUNTS))
    if (Array.isArray(next[key])) {
      const kept = next[key].filter(validBi);
      if (kept.length !== next[key].length && kept.length >= min)
        next[key] = kept;
    }
  return next;
}
export const normalizeSceneBriefs = (value) =>
  sceneBriefRows(value).map(normalizeSceneBrief);
/** Messages carry their scene number ('3번 장면: …') unless they already name it. */
export const locateBriefIssue = (issue) =>
  /^\d+번 (?:비트|장면)/u.test(String(issue?.message || ""))
    ? issue.message
    : `${issue.beatIndex}번 장면: ${issue.message}`;
const uniqueMessages = (rows) => [...new Set(rows.map(locateBriefIssue))];
export function inspectSceneBriefs(value, outline, source = {}) {
  const briefs = sceneBriefRows(value),
    beats = outline?.beats || [],
    issues = [],
    lean = hasPromptDiet(source),
    add = (beatIndex, code, message) =>
      issues.push({
        beatIndex,
        code,
        message,
        severity: lean && LEAN_ADVISORY.has(code) ? "advisory" : SCENE_BRIEF_SEVERITY[code] || "hard",
      });
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
    for (const [key, { target, min, max }] of Object.entries(
      SCENE_BRIEF_COUNTS,
    ))
      if (
        !Array.isArray(brief[key]) ||
        brief[key].length < min ||
        brief[key].length > max ||
        brief[key].some((p) => !validBi(p))
      )
        add(
          beat.index,
          "field",
          `${key}에 한글·영어 항목 ${target}개가 필요해요.`,
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
    if (validBi(brief.pose)) {
      const concern = poseConcern(brief.pose);
      if (concern === "soft")
        add(
          beat.index,
          "pose",
          "동작이 감정 표현뿐이에요(예: looks happy). 눈·손·발 등 신체 부위와 그릴 수 있는 행동을 적어 주세요.",
        );
      else if (concern === "advisory")
        add(
          beat.index,
          "pose_detail",
          "동작에 신체 부위(눈·손·발 등)를 더하면 그림에 도움이 돼요.",
        );
    }
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
      (brief.props?.length || 0) >= SCENE_BRIEF_COUNTS.props.min &&
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
  const hard = issues.filter((i) => i.severity === "hard"),
    soft = issues.filter((i) => i.severity === "soft"),
    advisories = issues.filter((i) => i.severity === "advisory"),
    repairable = issues.filter((i) => i.severity !== "advisory");
  return {
    // valid: nothing blocks the book; passed: nothing left to repair either.
    valid: !hard.length,
    passed: !repairable.length,
    issues: repairable,
    advisories,
    errors: uniqueMessages(hard),
    softIssues: uniqueMessages(soft),
    notes: uniqueMessages(advisories),
    failedBeatIndexes: [...new Set(repairable.map((i) => i.beatIndex))],
    hardBeatIndexes: [...new Set(hard.map((i) => i.beatIndex))],
  };
}
export function sceneBriefRules(input = null) {
  if (hasPromptDiet(input)) return leanSceneBriefRules();
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
