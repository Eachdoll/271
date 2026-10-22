/* Camera planning is deterministic. Variety never creates a new story event or building. */
export const SHOTS = Object.freeze([
  "wide",
  "medium",
  "closeup",
  "high_angle",
  "low_angle",
  "from_behind",
  "over_shoulder",
]);
export const SHOT_LABELS = Object.freeze({
  wide: "넓게",
  medium: "중간 거리",
  closeup: "가까이",
  high_angle: "위에서",
  low_angle: "낮은 시선",
  from_behind: "뒤에서",
  over_shoulder: "어깨 너머",
});
export const TIMES_OF_DAY = Object.freeze([
  "morning",
  "day",
  "afternoon",
  "evening",
  "night",
]);
/** R12 openings: shots a spread may use (no close-up or over-the-shoulder across the fold). */
export const SPREAD_SHOTS = Object.freeze([
  "wide",
  "medium",
  "high_angle",
  "from_behind",
]);
const SIDES = ["left", "center", "right"],
  TEXT_SIDES = ["left", "right", "top", "bottom"];
const string = { type: "string", minLength: 1, maxLength: 1000 };
export const STAGING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "shot",
    "characterSide",
    "textSide",
    "lightMood",
    "subLocation",
    "verb",
    "seed",
  ],
  properties: {
    shot: { type: "string", enum: [...SHOTS] },
    characterSide: { type: "string", enum: SIDES },
    textSide: { type: "string", enum: TEXT_SIDES },
    lightMood: { ...string },
    subLocation: { ...string },
    verb: { type: "string", minLength: 1, maxLength: 500 },
    seed: { type: "integer", minimum: 0, maximum: 2147483647 },
  },
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const text = (value) => (typeof value === "string" ? value.trim() : "");
const english = (value) => text(typeof value === "object" ? value?.en : value);
const normalize = (value) =>
  text(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const array = (value) => (Array.isArray(value) ? value : []);

/** FNV-1a with a reserved provider-safe headroom for regeneration offsets. */
export function hashBookId(bookId) {
  let hash = 2166136261;
  for (const character of String(bookId || "untitled-book")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2000000000;
}
export function seedForPage(bookId, pageNo, regeneration = 0) {
  const page = Math.max(0, Math.min(100000, Math.trunc(Number(pageNo) || 0))),
    retry = Math.max(
      0,
      Math.min(100000, Math.trunc(Number(regeneration) || 0)),
    );
  return hashBookId(bookId) + page + 1000 * retry;
}
export function nextShot(
  current,
  { previousShot, nextShot: followingShot, exclude = [] } = {},
) {
  const blocked = new Set(
      [previousShot, followingShot, ...exclude].filter(Boolean),
    ),
    start = SHOTS.indexOf(current);
  for (let offset = 1; offset <= SHOTS.length; offset++) {
    const candidate = SHOTS[(Math.max(-1, start) + offset) % SHOTS.length];
    if (candidate !== current && !blocked.has(candidate)) return candidate;
  }
  return SHOTS.find((shot) => shot !== current) || "medium";
}

function paletteText(stylePreset = {}) {
  const palette = stylePreset?.palette;
  if (typeof palette === "string") return palette.trim();
  if (Array.isArray(palette))
    return palette
      .map((color) =>
        typeof color === "string" ? color : color?.hex || color?.name || "",
      )
      .filter(Boolean)
      .join(", ");
  if (palette && typeof palette === "object")
    return Object.values(palette)
      .filter((value) => typeof value === "string")
      .join(", ");
  return "";
}
export function lightMoodFor(emotion, timeOfDay, stylePreset = {}) {
  const mood = text(emotion).toLowerCase();
  let result = /기대|기쁨|즐거|happy|joy|excited|hope/.test(mood)
    ? "gentle warm light and soft highlights"
    : /놀람|surpris/.test(mood)
      ? "clear gentle contrast, slightly cooler light"
      : /편안|calm|peaceful/.test(mood)
        ? "soft restful dusk light"
        : "soft neutral light";
  if (timeOfDay === "evening") result = "soft dusk light and gentle shadows";
  if (timeOfDay === "night")
    result =
      "quiet evening shadows and a gentle warm light, clearly visible faces";
  const palette = paletteText(stylePreset);
  return `${result}; use only the approved preset palette${palette ? `: ${palette}` : ""}; no new colors or frightening darkness`;
}

// These are recognized actions, not a list from which the model can invent events.
const ACTIONS = [
  ["look into", /\b(?:look(?:s|ed|ing)?\s+into|peek(?:s|ed|ing)?\s+into)\b/iu],
  ["walk", /\bwalk(?:s|ed|ing)?\b|걷|걸어|걸었|걸으/u],
  ["lift", /\b(?:lift(?:s|ed|ing)?|rais(?:e|es|ed|ing))\b|들어\s*올|들어올/u],
  ["point", /\bpoint(?:s|ed|ing)?\b|가리키|가리켰/u],
  ["crouch", /\b(?:crouch(?:es|ed|ing)?|squat(?:s|ted|ting)?)\b|쪼그|웅크/u],
  ["blow", /\b(?:blow(?:s|ing)?|blew)\b|불어|불었/u],
  ["hug", /\b(?:hug(?:s|ged|ging)?|embrac(?:e|es|ed|ing))\b|안아|안았|껴안/u],
  ["run", /\b(?:run(?:s|ning)?|ran)\b|달리|달려|뛰어가/u],
  ["hide", /\b(?:hid(?:e|es|ing|den)?)\b|숨었|숨는|숨고/u],
  ["listen", /\blisten(?:s|ed|ing)?\b|귀를\s*기울|귀\s*기울|듣고|들어요/u],
  ["splash", /\bsplash(?:es|ed|ing)?\b|첨벙|찰박/u],
  ["climb", /\bclimb(?:s|ed|ing)?\b|기어\s*올|올라가/u],
  ["carry", /\b(?:carr(?:y|ies|ied|ying))\b|들고\s*가|나르|옮기/u],
  ["wave", /\bwav(?:e|es|ed|ing)\b|손을\s*흔|손\s*흔/u],
  ["open", /\bopen(?:s|ed|ing)?\b|문을\s*열|열어요|열었/u],
  ["close", /\bclos(?:e|es|ed|ing)\b|문을\s*닫|닫아요|닫았/u],
  ["hold", /\b(?:hold(?:s|ing)?|held)\b|잡고|잡아|잡았|들고/u],
  ["sit", /\b(?:sit(?:s|ting)?|sat)\b|앉아|앉았|앉는/u],
  ["stand", /\b(?:stand(?:s|ing)?|stood)\b|서\s*있/u],
  ["reach", /\breach(?:es|ed|ing)?\b|손을\s*뻗/u],
  ["pour", /\bpour(?:s|ed|ing)?\b|부어요|부었|쏟아/u],
  ["touch", /\btouch(?:es|ed|ing)?\b|만져|만졌|만지/u],
  ["follow", /\bfollow(?:s|ed|ing)?\b|따라가|따라갔/u],
  ["turn", /\bturn(?:s|ed|ing)?\b|돌아보|돌려/u],
  ["jump", /\bjump(?:s|ed|ing)?\b|폴짝|깡충/u],
  ["kneel", /\b(?:kneel(?:s|ed|ing)?|knelt)\b|무릎을\s*꿇/u],
  ["peek", /\bpeek(?:s|ed|ing)?\b|들여다/u],
  ["smile", /\bsmil(?:e|es|ed|ing)\b|미소|웃어요|웃었/u],
  ["sleep", /\b(?:sleep(?:s|ing)?|slept)\b|잠들|잠을\s*자/u],
  ["watch", /\bwatch(?:es|ed|ing)?\b|지켜보|바라보/u],
  ["place", /\bplac(?:e|es|ed|ing)\b|놓아요|놓았|놓는/u],
  ["find", /\b(?:find(?:s|ing)?|found)\b|찾아|찾았/u],
  ["brush", /\bbrush(?:es|ed|ing)?\b|쓸어요|쓸었/u],
  ["fold", /\bfold(?:s|ed|ing)?\b|접어요|접었/u],
  ["share", /\bshar(?:e|es|ed|ing)\b|나누/u],
  ["roll", /\broll(?:s|ed|ing)?\b|굴려|굴리/u],
  ["shake", /\b(?:shak(?:e|es|ing)|shook)\b|흔들/u],
  ["pick", /\bpick(?:s|ed|ing)?\b|주워|주웠|줍/u],
  ["collect", /\bcollect(?:s|ed|ing)?\b|모아|모았|모으/u],
  ["catch", /\b(?:catch(?:es|ing)?|caught)\b|받아요|받았/u],
  ["dig", /\b(?:dig(?:s|ging)?|dug)\b|파요|팠어/u],
  ["push", /\bpush(?:es|ed|ing)?\b|밀어요|밀었/u],
  ["pull", /\bpull(?:s|ed|ing)?\b|당겨|당겼/u],
  ["step", /\bstep(?:s|ped|ping)?\b|발을\s*내딛/u],
  ["lean", /\blean(?:s|ed|ing)?\b|몸을\s*기울/u],
  ["tilt", /\btilt(?:s|ed|ing)?\b|기울여|기울이/u],
  ["stretch", /\bstretch(?:es|ed|ing)?\b|쭉\s*뻗/u],
  ["press", /\bpress(?:es|ed|ing)?\b|눌러|누르/u],
  ["squeeze", /\bsqueez(?:e|es|ed|ing)\b|꼭\s*쥐/u],
  ["stroke", /\bstrok(?:e|es|ed|ing)\b|쓰다듬/u],
  ["balance", /\bbalanc(?:e|es|ed|ing)\b|균형/u],
  ["spread", /\bspread(?:s|ing)?\b|펼쳐|펼치/u],
  ["rest", /\brest(?:s|ed|ing)?\b|쉬어요|쉬었/u],
];
function recognizedActions(source) {
  return ACTIONS.flatMap(([verb, pattern]) => {
    const match = pattern.exec(source);
    return match ? [{ verb, index: match.index }] : [];
  })
    .sort((a, b) => a.index - b.index)
    .map((item) => item.verb);
}
function actionFor(page, brief, used, warn) {
  const actual = [
    page.scene?.action,
    page.textEn ?? page.en,
    page.textKo ?? page.ko,
  ]
    .filter(Boolean)
    .join(" ");
  let candidates = recognizedActions(actual);
  if (!actual.trim())
    candidates = recognizedActions(
      [english(brief?.pose), brief?.pose?.ko].filter(Boolean).join(" "),
    );
  const proposed = normalize(page.staging?.verb),
    approvedProposal = candidates.find((verb) => verb === proposed);
  if (proposed && !approvedProposal)
    warn(
      "action_ungrounded",
      "제안된 동작이 이 쪽 본문에 없어 본문 동작으로 맞췄어요.",
    );
  const verb =
    approvedProposal && !used.has(approvedProposal)
      ? approvedProposal
      : candidates.find((candidate) => !used.has(candidate)) ||
        approvedProposal ||
        candidates[0];
  if (!verb) {
    warn(
      "action_unresolved",
      "이 쪽의 핵심 동작을 자동으로 구분하기 어려워요. 승인한 장면 동작을 유지해 주세요.",
    );
    return english(page.scene?.action) || "preserve the approved page action";
  }
  if (used.has(verb))
    warn(
      "action_repeated",
      "같은 동작이 다른 쪽에도 있어요. 본문에 없는 행동을 추가하지 않고 유지했어요.",
    );
  used.add(verb);
  return verb;
}

const ANCHORS = [
  "doorway",
  "door",
  "window",
  "tree",
  "rock",
  "stone",
  "path",
  "pond",
  "table",
  "bed",
  "river",
  "bank",
  "garden",
  "gate",
  "bench",
  "fence",
  "chair",
  "hill",
  "stream",
  "grass",
  "flower",
  "leaf",
  "umbrella",
  "blanket",
  "pillow",
  "lunch box",
];
const STRUCTURES = new Set([
  "doorway",
  "door",
  "window",
  "tree",
  "path",
  "pond",
  "table",
  "bed",
  "river",
  "bank",
  "garden",
  "gate",
  "bench",
  "fence",
  "chair",
  "hill",
  "stream",
]);
const LOCATION_STOP = new Set(
  "a an the at by near beside behind below above under over in on of to with from front edge side center middle left right area established location same visible part existing within around".split(
    " ",
  ),
);
function sourceStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(sourceStrings);
  if (value && typeof value === "object")
    return Object.entries(value)
      .filter(([key]) => !/image|asset|url|base64|seed/i.test(key))
      .flatMap(([, entry]) => sourceStrings(entry));
  return [];
}
function sourceAllows(candidate, source) {
  const tokens = normalize(candidate)
    .split(" ")
    .filter((word) => word && !LOCATION_STOP.has(word));
  const allowed = new Set(normalize(source).split(" "));
  return (
    tokens.length > 0 &&
    tokens.every(
      (token) =>
        allowed.has(token) ||
        allowed.has(token + "s") ||
        (token.endsWith("s") && allowed.has(token.slice(0, -1))),
    )
  );
}
function backgroundFor(page, context) {
  const setting = array(context.outline?.settings).find(
      (row) => row?.beatIndex === page.beatIndex,
    ),
    beat = array(context.outline?.beats).find(
      (row) => row?.index === page.beatIndex,
    ),
    key = setting?.backgroundId || beat?.settingKey || page.scene?.where;
  return (
    array(context.backgrounds).find(
      (row) =>
        [row?.id, row?.name, row?.nameEn].includes(key) ||
        [row?.id, row?.name, row?.nameEn].includes(page.scene?.where),
    ) || null
  );
}
function locationFor(page, brief, background, previousLocations, warn) {
  const sceneSource = [
      page.scene?.where,
      page.scene?.action,
      page.textEn ?? page.en,
      page.textKo ?? page.ko,
    ]
      .filter(Boolean)
      .join(" "),
    canon = sourceStrings(
      background
        ? {
            nameEn: background.nameEn,
            description: background.description,
            features: background.features,
            layout: background.layout,
            subLocations: background.subLocations,
          }
        : {},
    ).join(" "),
    source = [sceneSource, canon, ...array(brief?.props).map(english)].join(
      " ",
    ),
    candidates = [];
  for (const candidate of array(background?.subLocations).map(english))
    if (candidate && /[a-z]/i.test(candidate)) candidates.push(candidate);
  const proposed = english(page.staging?.subLocation);
  if (proposed && sourceAllows(proposed, source)) candidates.push(proposed);
  else if (proposed && !/^within the established location$/i.test(proposed))
    warn(
      "location_ungrounded",
      "확인되지 않은 세부 장소를 제외하고 기존 배경 안에서 구도를 정했어요.",
    );
  for (const anchor of ANCHORS) {
    const pattern = new RegExp(
      `\\b${anchor.replaceAll(" ", "\\s+")}s?\\b`,
      "i",
    );
    if (
      pattern.test(sceneSource + " " + canon) ||
      (!STRUCTURES.has(anchor) &&
        pattern.test(array(brief?.props).map(english).join(" ")))
    )
      candidates.push(`near the ${anchor}`);
  }
  const declared = english(page.scene?.where);
  if (
    declared &&
    /\s/.test(declared) &&
    /[a-z]/i.test(declared) &&
    !array(background ? [background.id] : []).includes(declared)
  )
    candidates.push(declared);
  candidates.push("within the established location");
  const unique = [...new Set(candidates)],
    recent = previousLocations.slice(-2),
    choice =
      unique.find((candidate) => !recent.includes(candidate)) || unique[0];
  if (
    previousLocations.length >= 2 &&
    choice === previousLocations.at(-1) &&
    choice === previousLocations.at(-2)
  )
    warn(
      "location_repeated",
      "배경 안의 다른 위치를 확인할 수 없어 기존 장소를 유지했어요. 새로운 구조물은 추가하지 않았어요.",
    );
  return choice;
}

function planShots(pages, outline, warnings, preserveManual, openings = false) {
  // R12 openings: a spread only takes a spread shot; page books are unchanged.
  const spreadAt = (index) => openings && pages[index]?.kind === "spread",
    allowedAt = (index, shot) =>
      !spreadAt(index) || SPREAD_SHOTS.includes(shot);
  const n = pages.length,
    turnBeat = array(outline?.beats).find(
      (beat) => beat?.type === "turn",
    )?.index,
    turnIndex = pages.findIndex((page) => page.beatIndex === turnBeat),
    fixed = new Map(),
    pattern = [
      "wide",
      "medium",
      "closeup",
      "high_angle",
      "from_behind",
      "over_shoulder",
      "medium",
      "closeup",
      "low_angle",
      "medium",
      "from_behind",
      "wide",
    ];
  if (n) {
    fixed.set(0, "wide");
    fixed.set(n - 1, "wide");
  }
  if (turnIndex > 0 && turnIndex < n - 1)
    fixed.set(turnIndex, spreadAt(turnIndex) ? "medium" : "closeup");
  pages.forEach((page, index) => {
    if (
      preserveManual &&
      page.stagingManual?.shot &&
      SHOTS.includes(page.staging?.shot) &&
      allowedAt(index, page.staging.shot)
    )
      fixed.set(index, page.staging.shot);
  });
  const shots = pages.map(
    (page, index) =>
      fixed.get(index) || page.staging?.shot || pattern[index % pattern.length],
  );
  for (let i = 0; i < n; i++) {
    if (fixed.has(i)) continue;
    const acceptable = (shot) =>
      SHOTS.includes(shot) &&
      allowedAt(i, shot) &&
      shot !== shots[i - 1] &&
      shot !== fixed.get(i + 1);
    if (!acceptable(shots[i]))
      shots[i] =
        [pattern[i % pattern.length], ...SHOTS].find(acceptable) || "medium";
  }
  const count = (values) =>
      shots.filter((shot) => values.includes(shot)).length,
    quotas =
      n >= 8
        ? [
            { shots: ["closeup"], minimum: 2, target: 0.35 },
            { shots: ["high_angle", "low_angle"], minimum: 1, target: 0.25 },
            { shots: ["from_behind"], minimum: 1, target: 0.7 },
          ]
        : [];
  for (const quota of quotas) {
    while (count(quota.shots) < quota.minimum) {
      const indices = Array.from({ length: n }, (_, i) => i)
        .filter((i) => !fixed.has(i) && !spreadAt(i) && i > 0 && i < n - 1)
        .sort(
          (a, b) =>
            Math.abs(a - (n - 1) * quota.target) -
            Math.abs(b - (n - 1) * quota.target),
        );
      const candidate = indices.find(
        (i) =>
          !quota.shots.includes(shots[i]) &&
          quotas.every(
            (other) =>
              !other.shots.includes(shots[i]) ||
              count(other.shots) > other.minimum,
          ) &&
          quota.shots.some(
            (shot) => shot !== shots[i - 1] && shot !== shots[i + 1],
          ),
      );
      if (candidate === undefined) break;
      shots[candidate] = quota.shots.find(
        (shot) =>
          shot !== shots[candidate - 1] && shot !== shots[candidate + 1],
      );
    }
  }
  const warn = (index, code, message) =>
    warnings.push({ pageNo: pages[index]?.pageNo || index + 1, code, message });
  for (let i = 1; i < n; i++)
    if (shots[i] === shots[i - 1])
      warn(
        i,
        "shot_adjacent",
        "앞쪽과 같은 구도예요. 원하는 구도인지 확인해 주세요.",
      );
  if (n && shots[0] !== "wide")
    warn(
      0,
      "shot_opening",
      "첫 쪽은 넓은 구도가 권장돼요. 선택한 구도를 유지했어요.",
    );
  if (n > 1 && shots[n - 1] !== "wide")
    warn(
      n - 1,
      "shot_closing",
      "마지막 쪽은 넓은 구도가 권장돼요. 선택한 구도를 유지했어요.",
    );
  if (turnIndex >= 0 && !spreadAt(turnIndex) && shots[turnIndex] !== "closeup")
    warn(
      turnIndex,
      "shot_turn",
      "반전 쪽은 가까운 구도가 권장돼요. 선택한 구도를 유지했어요.",
    );
  for (const quota of quotas)
    if (count(quota.shots) < quota.minimum)
      warnings.push({
        pageNo: null,
        code: "shot_variety",
        message:
          "선택한 구도 안에서 다양성 기준을 모두 맞추기 어려워요. 쪽 구도를 확인해 주세요.",
      });
  return shots;
}

/** Adds presentation metadata only. Approved story text, canon and preset are immutable. */
export function stagePagination(pagination, context = {}) {
  const result = clone(pagination || {}),
    pages = array(result.pages),
    warnings = [],
    briefs = array(
      context.sceneBriefs?.briefs ||
        context.sceneBriefs?.sceneBriefs ||
        context.sceneBriefs,
    ),
    bookId = context.bookId || result.bookId || result.id || "untitled-book",
    preserveManual = context.preserveManual !== false,
    // R12 openings (frozen layout passed by the caller): spread and pair rules.
    openings = context.openings === true,
    // R31c: a diet draft's day is the story's own (no forced morning or evening).
    lean = context.lean === true,
    shots = planShots(pages, context.outline, warnings, preserveManual, openings),
    usedVerbs = new Set(),
    locations = new Map();
  let previousTime = 0;
  result.pages = pages.map((page, index) => {
    const warn = (code, message) =>
        warnings.push({ pageNo: page.pageNo || index + 1, code, message }),
      brief = briefs.find((row) => row?.beatIndex === page.beatIndex),
      original = page.staging || {},
      manual = preserveManual ? page.stagingManual || {} : {},
      background = backgroundFor(page, context),
      placeKey =
        background?.id ||
        page.scene?.where ||
        array(context.outline?.settings).find(
          (row) => row?.beatIndex === page.beatIndex,
        )?.backgroundId ||
        "established-place",
      oldLocations = locations.get(placeKey) || [];
    const wantedTime =
      brief?.timeOfDay ||
      page.scene?.timeOfDay ||
      TIMES_OF_DAY[
        Math.min(4, Math.floor((index * 5) / Math.max(1, pages.length)))
      ];
    let timeIndex = TIMES_OF_DAY.indexOf(wantedTime);
    if (timeIndex < 0) timeIndex = previousTime;
    if (!lean && index === 0 && brief && timeIndex !== 0) {
      warn("time_opening", "장면 브리프의 첫 시간대를 아침으로 맞췄어요.");
      timeIndex = 0;
    }
    if (timeIndex < previousTime) {
      warn(
        "time_backwards",
        "시간대가 거꾸로 흐르지 않게 앞쪽 시간대로 맞췄어요.",
      );
      timeIndex = previousTime;
    }
    if (
      !lean &&
      index === pages.length - 1 &&
      pages.length > 1 &&
      brief &&
      timeIndex < 3
    ) {
      warn("time_closing", "마지막 장면을 저녁 시간대로 맞췄어요.");
      timeIndex = 3;
    }
    previousTime = timeIndex;
    const spread = openings && page.kind === "spread",
      timeOfDay = TIMES_OF_DAY[timeIndex],
      characterSide =
        manual.characterSide &&
        SIDES.includes(original.characterSide) &&
        !(spread && original.characterSide === "center")
          ? original.characterSide
          : openings
            ? spread
              ? // A spread alternates by opening and is never centred (the fold).
                Number(page.openingNo) % 2 === 0
                ? "right"
                : "left"
              : // A page of a pair defaults to its outer side.
                page.side === "right"
                ? "right"
                : "left"
            : index % 2
              ? "right"
              : "left",
      textSide =
        manual.textSide && TEXT_SIDES.includes(original.textSide)
          ? original.textSide
          : characterSide === "left"
            ? "right"
            : characterSide === "right"
              ? "left"
              : "bottom",
      subLocation = locationFor(page, brief, background, oldLocations, warn);
    oldLocations.push(subLocation);
    locations.set(placeKey, oldLocations);
    const staging = {
      shot: shots[index],
      characterSide,
      textSide,
      lightMood: lightMoodFor(
        page.scene?.emotion ||
          array(context.outline?.emotionArc)[
            Math.max(0, (page.beatIndex || 1) - 1)
          ],
        timeOfDay,
        context.stylePreset,
      ),
      subLocation,
      verb: actionFor(page, brief, usedVerbs, warn),
      seed: seedForPage(
        bookId,
        page.pageNo || index + 1,
        page.stagingRegeneration || 0,
      ),
    };
    if (
      index &&
      characterSide === result.pages[index - 1]?.staging?.characterSide
    )
      warn(
        "side_adjacent",
        "앞쪽과 인물 위치가 같아요. 선택한 위치를 유지했어요.",
      );
    page.scene = { ...(page.scene || {}), timeOfDay };
    page.staging = staging;
    return page;
  });
  result.stagingWarnings = warnings;
  return result;
}

/** Manual camera edits are remembered; they never rewrite text or regenerate an image. */
export function updatePageStaging(
  pagination,
  pageIndex,
  patch = {},
  context = {},
) {
  const result = clone(pagination || {}),
    page = result.pages?.[pageIndex];
  if (!page) return result;
  const edits = {},
    // R12 openings: a spread refuses the centre side and non-spread shots.
    spread = context.openings === true && page.kind === "spread";
  if (SHOTS.includes(patch.shot) && (!spread || SPREAD_SHOTS.includes(patch.shot)))
    edits.shot = patch.shot;
  if (
    SIDES.includes(patch.characterSide) &&
    !(spread && patch.characterSide === "center")
  )
    edits.characterSide = patch.characterSide;
  if (TEXT_SIDES.includes(patch.textSide)) edits.textSide = patch.textSide;
  page.staging = { ...(page.staging || {}), ...edits };
  page.stagingManual = {
    ...(page.stagingManual || {}),
    ...Object.fromEntries(Object.keys(edits).map((key) => [key, true])),
  };
  if (edits.characterSide && !edits.textSide) {
    page.staging.textSide =
      edits.characterSide === "left"
        ? "right"
        : edits.characterSide === "right"
          ? "left"
          : "bottom";
    page.stagingManual.textSide = false;
  }
  return stagePagination(result, context);
}
export function coverStaging(bookId, protagonistId, stylePreset = {}) {
  return {
    shot: "medium",
    characterSide: "center",
    textSide: "top",
    lightMood: lightMoodFor("hopeful", "day", stylePreset),
    subLocation: "within the established cover location",
    verb: "preserve the approved cover action",
    seed: seedForPage(bookId, 0),
    soloCharacterId: protagonistId || null,
  };
}
