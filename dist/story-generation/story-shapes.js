/* 이야기 모양 (R33-2, 2026-10-23): the shapes a picture book can take — many
 * more than the six plot patterns the quality package seeds with. A shape is
 * a spark for the outline (one sentence of how the story moves), never a
 * checklist: the lean outline request carries it as STORY SHAPE, the writers'
 * room hears it in the direction, the accepted outline records it and the
 * next book avoids the last three. Pure: no DOM, no network. */
export const STORY_SHAPE_VERSION = 1;
const ALL = Object.freeze(["K1", "K2", "K3", "K4"]),
  K2UP = Object.freeze(["K2", "K3", "K4"]),
  LITTLE = Object.freeze(["K1", "K2"]);
const card = (id, name, shape, line, bestFor, levels = ALL, refrain = "") =>
  Object.freeze({ id, name, shape, line, bestFor: Object.freeze(bestFor), levels, refrain });
export const STORY_SHAPES = Object.freeze([
  // The six the quality package already knows (same ids, so an older setting still picks them).
  card("journey_repeat", "반복 여정형", "같은 틀의 장애물을 하나씩 지나 목적지에 닿고, 챙긴 물건이 마지막에 도움이 돼요.",
    "A journey past obstacles met with the same little refrain (one word changes each time); something packed at the start helps at the hardest one; the goal turns out different from expected; a quick return the same way.",
    ["모험", "탐험", "길", "찾아가", "날씨", "공룡", "여행"], ALL, "a frame line that repeats with one word changed"),
  card("accumulate", "누적형", "하나, 둘, 셋… 모으다 너무 많아져 탈이 나고, 가장 작은 것이 해결해요.",
    "Counting up — one, two, three — each beat adds one more and lists the ones before; too many brings a small mishap; the smallest one is the answer; changed by the end.",
    ["먹", "모으", "숫자", "생일", "쌓", "많이"], ALL, "a counting line that grows"),
  card("search_wrong_answers", "찾기-오답형", "찾는 것이 자꾸 다른 것으로 나와요. 마지막에 뜻밖의 곳에서 찾아요.",
    "Looking for one thing and finding the wrong things that look or sound like it (a shell that is a flower); each miss teaches something; found in a surprising place that was there all along.",
    ["숨바꼭질", "잃어버", "찾", "소리", "어디"], ALL, "'Is it this? No, it is a …' once per beat"),
  card("waiting", "기다림형", "기다리는 동안 작은 일들이 생기고, 기다림 끝에 온 것이 기대와 조금 달라요.",
    "Waiting for something (a friend, the rain, a cake to bake); little things happen while waiting and each changes the mood; what arrives is a little different from the hope — and better.",
    ["기다", "생일", "비", "손님", "언제", "아직"], ALL),
  card("escalation", "경쟁-확장형", "작은 겨루기가 점점 커지다 함께 하는 쪽으로 뒤집혀요.",
    "A small contest grows bigger and sillier each round until it topples; the real win is doing it together.",
    ["경주", "겨루", "시합", "누가", "형", "언니", "동생"], K2UP),
  card("mystery_sound", "소리의 정체형", "이상한 소리를 따라가며 정체를 추측하다 뜻밖의 작은 것을 만나요.",
    "A strange sound; each beat guesses what makes it and finds something else; the maker is small, close and friendly.",
    ["소리", "밤", "뭐지", "이상한", "쿵"], ALL, "the sound itself, written the same way each time"),
  // R33: the new shapes.
  card("sound_adventure", "소리 모험형", "소리를 내며·따라가며 떠나는 모험. 쪽마다 새 소리말이 생겨요.",
    "An adventure led by sounds: each beat brings a new sound the child can make (splash, crunch, ding) and at the end all the sounds come back together as one song or one noisy moment.",
    ["소리", "악기", "노래", "동물", "비", "북", "딸랑"], ALL, "the beats' sounds, all together at the end"),
  card("answer_pile", "정답 누적형", "수수께끼를 하나씩 맞히며 조각(답)을 모아 마지막에 큰 답이 돼요.",
    "A chain of small riddles or questions; each answer is a piece the child keeps; the pieces fit together into the big answer at the end.",
    ["수수께끼", "퀴즈", "질문", "보물", "맞히", "힌트"], K2UP, "'One more piece!' as each answer is kept"),
  // R35: the picture-led composition as a shape of its own (the reference round, 2026-10-24).
  card("three_waves", "세 번의 파도형", "같은 일이 세 번, 점점 크게 닥치고 세 번째에 뒤집혀요. 글은 짧고 그림이 말해요.",
    "The same kind of thing comes three times, each bigger or closer than the last (a wave, a knock, a gust, a puddle); the small one braces and the big one stays near; the third time tips the story over into the turn, where what was feared turns out to hold something good; the ending is quiet and round, back where it began with one thing changed.",
    ["파도", "바다", "무서", "용기", "처음", "세 번", "점점", "크게", "바람"], ALL, "the same sound word at each of the three, bigger each time"),
  card("first_time", "처음 해보기형", "처음 하는 일에 조마조마하다 작게 해내요.",
    "Doing something for the first time: small worries before, a wobble in the middle, one brave step, and a small, real success.",
    ["처음", "유치원", "심부름", "혼자", "첫", "용기"], ALL),
  card("tiny_helper", "작은 도움형", "가장 작은 존재가 큰 문제를 풀어요.",
    "The smallest one (an ant, a button, the littlest child) solves what the big ones cannot, in a small clever way nobody expected.",
    ["작은", "개미", "도움", "도와", "큰", "힘"], ALL),
  card("build_together", "만들기형", "재료를 하나씩 모아 무언가를 만들고, 마지막 조각이 뜻밖의 것이에요.",
    "Making something piece by piece; each beat finds a part; the last missing part is something unexpected and already at hand.",
    ["만들", "집짓", "눈사람", "케이크", "쌓", "블록", "기지"], ALL),
  card("why_chain", "왜?-질문형", "'왜?'가 '왜?'를 부르다 마지막에 작은 답을 찾아요.",
    "'Why?' leads to another 'why?'; each beat asks someone new and gets a different piece; the last answer is simple and funny.",
    ["왜", "질문", "궁금", "물어"], K2UP, "'왜?' at the start of every beat"),
  card("opposite_day", "거꾸로 날형", "하루 동안 모든 게 거꾸로! 되돌리는 길을 찾아요.",
    "A day when things go backwards or upside down; each beat something else flips; finding the way to set it right — or deciding to keep one upside-down thing.",
    ["거꾸로", "반대", "장난", "뒤집"], K2UP),
  card("visitor", "손님형", "뜻밖의 손님이 찾아와 함께 지내다 떠나요.",
    "An unexpected visitor arrives; each beat tries a way to make them welcome (some go wrong); they leave with a gift or a promise.",
    ["손님", "방문", "찾아온", "놀러 온", "새 친구"], ALL),
  card("delivery", "전하기형", "무언가를 누군가에게 전하러 가는 길. 도중에 바뀌어요.",
    "Carrying something to someone; on the way it changes, drops or grows; what is delivered is not what was packed, and it is just right.",
    ["심부름", "편지", "선물", "배달", "전해", "갖다"], ALL),
  card("weather_turn", "날씨 변신형", "날씨가 바뀔 때마다 놀이가 바뀌어요.",
    "The weather changes beat by beat (sun, wind, rain, rainbow, snow) and each change turns the play into something new.",
    ["비", "바람", "눈", "날씨", "무지개", "구름", "해"], ALL),
  card("follow_tracks", "발자국 따라가기형", "흔적을 따라가다 정체를 알아요.",
    "Following tracks or clues (footprints, crumbs, a trail of petals); each beat a new clue and a wrong guess; the trail leads back to someone close.",
    ["발자국", "흔적", "탐정", "따라가", "자국"], K2UP),
  card("share_or_keep", "나눌까 말까형", "하나뿐인 것을 나누는 마음.",
    "One precious thing and the wish to keep it; each beat someone needs a piece; giving it away brings something back that is bigger.",
    ["나누", "선물", "과자", "장난감", "하나뿐", "내 거"], ALL),
  card("sleepless", "잠 안 오는 밤형", "잠들기 전 작은 모험. 소리마다 확인하고 결국 잠들어요.",
    "Bedtime, not sleepy: each beat a sound or a worry to check (it is only the curtain, only the cat); the last check is cozy and the child sleeps.",
    ["밤", "잠", "꿈", "달", "자기 싫", "이불"], ALL),
  card("hide_and_seek", "숨바꼭질형", "숨고 찾고, 마지막은 뜻밖의 곳.",
    "Hide and seek: each beat a hiding place that almost works (a giggle, a tail showing); the last one is found in the silliest spot of all.",
    ["숨바꼭질", "숨", "찾", "놀이"], ALL, "'Found you!' once per beat"),
  card("trade_chain", "바꾸기 사슬형", "작은 것을 차례로 바꾸다 원래 것으로 돌아오거나 더 좋은 것이 돼요.",
    "Trading one thing for another, beat by beat (a button for a feather, a feather for a shell); the chain ends with the first thing back — or the thing truly needed.",
    ["바꾸", "시장", "교환", "장터"], K2UP),
  card("mix_up", "뒤바뀜형", "모자·이름·물건이 뒤바뀌어 소동, 바로잡으며 웃어요.",
    "Things get mixed up (hats, names, lunch boxes); each beat the mix-up causes a new funny scene; sorting it out shows who is who.",
    ["바뀌", "모자", "쌍둥이", "소동", "헷갈"], K2UP),
  card("count_to_ten", "열까지 세기형", "하나부터 열까지 세는 동안 사건이 하나씩.",
    "Counting up to ten (or down to one); every number brings one small event; at the last number, the big moment.",
    ["숫자", "세기", "열", "하나 둘", "기다"], LITTLE, "the numbers, in order"),
  card("color_hunt", "색깔 찾기형", "색마다 하나씩 찾아요.",
    "A hunt for colours or shapes: each beat finds one (something red, something round); the collection makes a picture, a rainbow or a gift at the end.",
    ["색깔", "빨강", "노랑", "파랑", "모양", "무지개"], LITTLE),
  card("brave_step", "한 걸음 용기형", "무서운 것에 한 걸음씩 다가가요. 알고 보니 작은 것.",
    "Something scary ahead (a dark shed, a big dog, a tall slide); each beat one step closer with a helper or a trick; close up it is small and friendly.",
    ["무서", "용기", "어둠", "미끄럼틀", "큰 개", "무섭"], ALL),
  card("gift_making", "선물 만들기형", "누군가를 위한 선물을 만들다 실패하고 마음으로 완성해요.",
    "Making a present for someone; each try goes a bit wrong (too big, too wet, eaten); the final present is simple and made of the tries.",
    ["선물", "생일", "엄마", "아빠", "할머니", "만들"], ALL),
  card("seed_grow", "씨앗 키우기형", "심고 기다리고 돌보다 자라요.",
    "Planting and tending: each beat gives the seed something (water, sun, a song, patience); the sprout appears when least expected; a bloom or a harvest at the end.",
    ["씨앗", "키우", "꽃", "텃밭", "심", "자라"], ALL),
  card("role_swap", "역할 바꾸기형", "하루 동안 역할을 바꿔 봐요(엄마가 아이, 아이가 엄마).",
    "Swapping roles for a day (the child is the parent, the puppy is the boss); each beat the swapped job turns out harder and funnier; swapping back with new respect.",
    ["역할", "엄마", "아빠", "선생님", "대신", "하루만"], K2UP),
]);
const byId = new Map(STORY_SHAPES.map((shape) => [shape.id, shape]));
export const shapeById = (id) => byId.get(String(id ?? "")) || null;
export const isStoryShapeId = (id) => byId.has(String(id ?? ""));
export const storyShapeLabel = (id) => shapeById(id)?.name || "";
/** Select rows: 자동 first, then every shape as "이름 · 한 줄". */
export const STORY_SHAPE_OPTIONS = Object.freeze([
  ["auto", "자동 · 주제에 맞게 고르고 최근 책과 겹치지 않게"],
  ...STORY_SHAPES.map((shape) => [shape.id, `${shape.name} · ${shape.shape}`]),
]);
const hash = (text) => {
  let h = 2166136261;
  for (const char of String(text)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};
const levelOf = (value) => {
  const match = /K[1-4]/u.exec(String(value || ""));
  return match ? match[0] : "K2";
};
/**
 * The shape for a story: the parent's pick when it is a known id; otherwise
 * the best fit for the topic among the shapes suited to the level, skipping
 * the ones the latest books used, ties broken by a stable hash of the seed
 * (the same topic gets the same shape again; a new seed offset turns it).
 */
export function chooseStoryShape(topic, { recentIds = [], level = "K2", pick = "auto", seed = "" } = {}) {
  const chosen = shapeById(pick);
  if (chosen) return chosen;
  const text = String(topic || ""),
    lvl = levelOf(level),
    suited = STORY_SHAPES.filter((shape) => shape.levels.includes(lvl)),
    recent = new Set((Array.isArray(recentIds) ? recentIds : []).map(String)),
    fresh = suited.filter((shape) => !recent.has(shape.id)),
    pool = fresh.length ? fresh : suited.length ? suited : [...STORY_SHAPES],
    score = (shape) => shape.bestFor.reduce((total, word) => total + (word && text.includes(word) ? 2 : 0), 0),
    key = (shape) => hash(`${seed || text}:${shape.id}`);
  return [...pool].sort((a, b) => score(b) - score(a) || key(a).localeCompare(key(b)))[0];
}
/** What the frozen input and the accepted outline keep: id and name only. */
export const storyShapeRef = (shape) =>
  shape && shapeById(shape.id) ? { version: STORY_SHAPE_VERSION, id: shape.id, name: shapeById(shape.id).name } : null;
/** The outline request's STORY SHAPE block for a frozen reference; empty when the id is unknown. */
export function storyShapeRule(ref) {
  const shape = shapeById(ref?.id);
  if (!shape) return "";
  return `STORY SHAPE — ${shape.name}: ${shape.line}${shape.refrain ? ` Refrain idea: ${shape.refrain}.` : ""} Lean on this shape; it is a spark, not a checklist.`;
}
/** The writers' room hears the shape in its direction (Korean, one clause). */
export function storyShapeDirection(ref) {
  const shape = shapeById(ref?.id);
  return shape ? `이야기 모양: ${shape.name} — ${shape.shape}` : "";
}
/** The ids of the latest approved books' shapes (newest first), for the chooser. */
export function recentShapeIds(records = [], count = 3) {
  return (Array.isArray(records) ? records : [])
    .map((record) => record?.usedElements?.patternId || record?.patternId || "")
    .filter((id) => isStoryShapeId(id))
    .slice(0, count);
}
