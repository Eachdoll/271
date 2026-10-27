/* 표현 원리 카드 (R37, 2026-10-24). The parent, after R35/R36: "similar
 * ways of expressing, writing and composing pictures — not a copy". R35 had
 * put one reference book's plot skeleton (three same-kind encounters, each
 * bigger, the third turning, a quiet round ending) into every picture-led
 * outline request. That template is gone. Instead each new picture-led book
 * draws a few general picture-book principles — how the words work, how the
 * telling works, how a picture is composed — from this deck, decided by the
 * book's seed and skipping the latest books' cards (as R34's voice cards),
 * and the writers get them as a spark, never a checklist. Nothing counts or
 * checks them. Pure module: no DOM, no network. */
export const EXPRESSION_VERSION = 1;
export const EXPRESSION_SLOTS = Object.freeze(["words", "telling", "frame"]);
export const EXPRESSION_LABELS = Object.freeze({ words: "글", telling: "표현", frame: "그림 구도" });
/** How many cards of each slot one book draws. */
export const EXPRESSION_COUNTS = Object.freeze({ words: 2, telling: 2, frame: 2 });
const card = (id, name, ko, en) => Object.freeze({ id, name, ko, en });
export const EXPRESSION_DECK = Object.freeze({
  words: Object.freeze([
    card("few_words", "말을 아껴요", "그림이나 아이가 채울 수 있는 것은 쓰지 않아요.", "Say less than you could; leave out what the picture or the child can fill in."),
    card("feeling_in_lines", "마음은 대사로", "마음은 설명 대신 짧은 대사로 들려줘요.", "Let feelings come through short spoken lines, not description."),
    card("echo_change", "되풀이하며 조금씩", "한 줄을 다시 쓰되 올 때마다 하나만 바꿔요.", "Bring a line back with one thing changed each time."),
    card("split_turn", "넘김에 걸친 문장", "문장을 펼침 끝에서 멈추고, 넘긴 뒤에 마무리해요.", "Let a sentence pause at the end of an opening and finish after the page turn."),
    card("plain_words", "쉬운 말로 큰 마음", "큰 마음을 꾸밈 없는 쉬운 낱말로 써요.", "Use plain, everyday words for big feelings; no fancy description."),
    card("sound_line", "소리가 한 줄", "그 순간이 소리라면 소리말 하나를 한 줄로 세워요.", "When the moment is a sound, let one sound word stand as a line."),
    card("ask_reader", "읽는 아이에게 묻기", "가끔 이야기꾼이 읽는 아이에게 작게 물어요.", "Now and then the narrator asks the reader a small question."),
  ]),
  telling: Object.freeze([
    card("words_vs_picture", "글과 그림이 어긋나기", "어딘가에서 글은 하나를 말하고 그림은 다른 것을 보여 줘요. 아이는 인물이 모르는 것을 봐요.", "Somewhere the words say one thing and the picture shows another, and the child sees what the character does not."),
    card("held_for_turn", "넘겨야 보이는 것", "한 펼침에서 감춘 것을 넘긴 뒤에야 보여 줘요.", "Hold something back on one opening and show it only after the page turn."),
    card("quiet_peak", "큰 순간엔 말 줄이기", "가장 큰 순간에 가장 적은 말을 써요.", "At the moment that matters most, use the fewest words."),
    card("situation_humor", "상황에서 나오는 웃음", "웃음은 농담이 아니라 벌어지는 일에서 나와요.", "Let the funny moments come from what happens, not from jokes."),
    card("small_and_big", "작은 것과 큰 것", "작은 인물과 큰 무언가의 대비로 마음을 전해요.", "Let a small character against something big carry the feeling."),
    card("wordless_opening", "말 없는 펼침", "한 펼침쯤은 거의 말 없이 그림만으로 가요.", "Let one opening go almost without words."),
    card("two_voices", "두 목소리", "두 인물이 짧은 말을 주고받으며 이야기를 밀고 가요.", "Two characters trade short lines and carry the story between them."),
    // R39: the narrator steps aside to the reader, or the hero speaks alone (a monologue on a plain page).
    card("aside", "한 발 물러선 화자", "어느 쪽에선 이야기꾼이 한 발 물러나 읽는 아이에게 말을 걸거나, 주인공이 혼자 속마음을 한 줄로 말해요.", "Somewhere the narrator steps aside to speak to the reader, or the hero speaks a line alone, to no one."),
  ]),
  frame: Object.freeze([
    card("one_focus", "시선은 한 곳", "그림마다 눈이 가는 곳은 하나, 나머지는 단순하게.", "One clear focal point per picture; everything else stays simple."),
    card("size_feeling", "크기로 마음", "무섭거나 외로우면 작고 멀리, 용감하거나 기쁘면 크고 가까이.", "Use size and distance for feeling: small and far when scared or alone, big and near when brave or glad."),
    card("big_shapes", "큰 덩어리와 여백", "자잘한 묘사보다 큰 덩어리와 넉넉한 여백.", "Big simple shapes and generous empty space rather than busy detail."),
    card("body_tells", "몸짓으로 마음", "인물의 자세와 바라보는 곳으로 마음을 보여 줘요.", "Show what a character feels with posture and where they look."),
    card("vary_distance", "멀리와 가까이", "책 안에서 멀리 보기와 가까이 보기를 오가요.", "Move between far and near across the book so each opening feels new."),
    card("lead_to_turn", "넘김으로 이끄는 방향", "인물의 움직임이나 시선이 다음 장 쪽으로 향해요.", "Let movement or gaze lead toward the page turn."),
    card("from_the_edge", "가장자리에서 들어오는 것", "다음 일을 그림 가장자리에 살짝 내밀어요.", "Let what comes next peek in from the edge of the picture."),
  ]),
});
const byId = new Map(EXPRESSION_SLOTS.flatMap((slot) => EXPRESSION_DECK[slot].map((c) => [c.id, { ...c, slot }])));
export const expressionCardById = (id) => byId.get(String(id ?? "")) || null;
const list = (value) => (Array.isArray(value) ? value : []);
const hash = (text) => {
  let h = 2166136261;
  for (const char of String(text)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
};
/**
 * The cards for a new picture-led book: EXPRESSION_COUNTS per slot, drawn
 * in a seed-decided order, the latest books' cards left for last (used only
 * when nothing else remains).
 */
export function chooseExpression({ seed = "", recentIds = [] } = {}) {
  const recent = new Set(list(recentIds).map(String)),
    cards = {};
  for (const slot of EXPRESSION_SLOTS) {
    const ordered = [...EXPRESSION_DECK[slot]].sort(
      (a, b) => Number(recent.has(a.id)) - Number(recent.has(b.id)) || hash(`${seed}:${slot}:${a.id}`) - hash(`${seed}:${slot}:${b.id}`),
    );
    cards[slot] = ordered.slice(0, EXPRESSION_COUNTS[slot]).map((c) => c.id);
  }
  return { version: EXPRESSION_VERSION, cards };
}
/** The frozen reference: known card ids in their own slot only, or null. */
export function expressionRef(value) {
  const source = value && typeof value === "object" && value.version === EXPRESSION_VERSION && value.cards && typeof value.cards === "object" ? value.cards : null;
  if (!source) return null;
  const cards = {};
  for (const slot of EXPRESSION_SLOTS) {
    const ids = [...new Set(list(source[slot]).map(String))].filter((id) => expressionCardById(id)?.slot === slot);
    if (!ids.length) return null;
    cards[slot] = ids;
  }
  return { version: EXPRESSION_VERSION, cards };
}
/** A diet draft's frozen cards, or null (the prompts read nothing else). */
export const expressionOf = (input) => (input?.promptDiet?.version === 1 ? expressionRef(input.storyExpression) : null);
const resolved = (value, slots = EXPRESSION_SLOTS) => {
  const ref = expressionRef(value);
  return ref ? slots.flatMap((slot) => ref.cards[slot].map((id) => expressionCardById(id))) : [];
};
/** The outline request's block (all three slots, English). */
export function expressionOutlineBlock(input) {
  const ref = expressionOf(input);
  if (!ref) return "";
  const line = (slot) => ref.cards[slot].map((id) => expressionCardById(id).en).join(" ");
  return `EXPRESSION FOR THIS BOOK (principles to lean on, a spark, not a checklist — use them where the story wants them): Words — ${line("words")} Telling — ${line("telling")} Pictures — ${line("frame")}`;
}
/** The prose writers' line (words + telling): Korean for the Korean writer, English otherwise. */
export function expressionWriterLine(input, lang = "ko") {
  const cards = resolved(expressionOf(input), ["words", "telling"]);
  if (!cards.length) return "";
  return lang === "ko"
    ? `[이 책의 표현 — 불씨예요, 점검표가 아니에요] ${cards.map((c) => `${c.name}: ${c.ko}`).join(" ")}`
    : `This book's way of telling (a spark, not a checklist): ${cards.map((c) => c.en).join(" ")}`;
}
/** The picture plan's line (frame cards, English). */
export function expressionFrameLine(input) {
  const cards = resolved(expressionOf(input), ["frame"]);
  return cards.length ? `This book's picture ideas: ${cards.map((c) => c.en).join(" ")}` : "";
}
/** The writers' room direction (Korean card names). */
export function expressionDirection(input) {
  const cards = resolved(expressionOf(input));
  return cards.length ? `표현: ${cards.map((c) => c.name).join(" · ")}` : "";
}
/** One line for ③ and the pro card. */
export function expressionSummary(value) {
  const cards = resolved(value);
  return cards.length ? `표현 · ${cards.map((c) => c.name).join(" · ")}` : "";
}
/** The card ids the latest approved books used (newest first), for the chooser. */
export function recentExpressionIds(records = [], count = 3) {
  return list(records)
    .map((record) => record?.usedElements?.expression || null)
    .filter((value) => value && typeof value === "object")
    .slice(0, count)
    .flatMap((cards) => EXPRESSION_SLOTS.flatMap((slot) => list(cards[slot])))
    .filter((id) => expressionCardById(id));
}
