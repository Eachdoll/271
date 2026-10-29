/* 아이디어 카드 (R46, 2026-10-29). The parent: "not that one book's style —
 * a feature that composes creative picture books like that at random". A
 * story shape (R33) says how the plot moves and the voice and expression
 * cards (R34, R37) say how it is told, but nothing gave a book its own odd
 * idea, its own arrangement of characters, a device that makes it play, or
 * an ending of its own — so books started to feel alike. Each new diet draft
 * now freezes input.storyIdea {version: 1, cards, from}: four slots — a
 * spark (발상, the premise), a cast pattern (인물 짜임, how the chosen
 * characters stand to each other), a device (장치, what makes it play) and
 * an ending (끝). ① '아이디어 뽑기' draws all four and fills the topic from
 * the spark; without it every new draft draws the last three from its seed,
 * the latest books' cards left for last. The writers get them as a spark,
 * never a checklist; nothing counts or checks them — except that the device
 * "same plan again" lets the R39 tries share a kind. Pure module: no DOM,
 * no network. */
export const IDEA_VERSION = 1;
export const IDEA_SLOTS = Object.freeze(["spark", "cast", "device", "ending"]);
export const IDEA_LABELS = Object.freeze({ spark: "발상", cast: "인물 짜임", device: "장치", ending: "끝" });
const card = (id, name, ko, en, extra = {}) => Object.freeze({ id, name, ko, en, ...extra });
const sparkCard = (id, name, ko, en, topics) => card(id, name, ko, en, { topics: Object.freeze(topics) });
export const IDEA_DECK = Object.freeze({
  spark: Object.freeze([
    sparkCard("living_object", "살아난 물건", "늘 쓰던 물건 하나가 하루 동안 제 뜻대로 움직여요.", "An everyday object has a will of its own for one day.", ["부엌에서 숟가락이 몰래 춤추는 날", "유치원에서 크레파스가 도망간 날"]),
    sparkCard("size_swap", "커졌다 작아졌다", "주인공이나 무언가의 크기가 갑자기 달라져요.", "The hero, or something near them, suddenly changes size.", ["정원에서 개미만큼 작아진 날", "공원에서 내 그림자만 커진 날"]),
    sparkCard("one_rule", "이상한 규칙 하나", "한 곳에 이상한 규칙 하나가 생겨요.", "One place gets one strange rule everyone must keep.", ["도서관에서 웃음을 꾹 참아야 하는 날", "거꾸로 걸어야 하는 마을에 간 날"]),
    sparkCard("lost_sound", "사라진 소리", "늘 들리던 소리 하나가 사라져서 찾아 나서요.", "A sound that was always there goes missing, and the hero goes to find it.", ["숲에서 잃어버린 메아리 찾기", "아침 시장에서 사라진 종소리 찾기"]),
    sparkCard("order_weather", "날씨 주문", "날씨를 주문할 수 있게 됐는데 주문이 자꾸 엇갈려요.", "The weather can be ordered, and the orders keep getting mixed up.", ["언덕 위에서 구름을 주문한 날", "놀이터에 눈이 딱 한 송이 온 날"]),
    sparkCard("shadow_out", "그림자의 외출", "그림자나 거울 속 모습이 따로 놀아요.", "A shadow or a reflection starts doing its own thing.", ["달밤 골목에서 그림자와 바꿔 놀기", "목욕탕 거울 속 내가 먼저 웃은 날"]),
    sparkCard("daily_visitor", "매일 오는 손님", "날마다 같은 시간에 이상한 손님이 찾아와요.", "A strange visitor comes at the same time every day.", ["창가에 매일 오는 작은 손님 맞이하기", "바닷가 오두막에 날마다 오는 갈매기"]),
    sparkCard("secret_plan", "몰래 세운 작전", "무리가 무언가를 잡거나 얻으려고 작전을 세우는데 잘 안 풀려요.", "A small group makes a plan to catch or get something, and the plan keeps going wrong.", ["숲에서 무지개 새를 만날 작전", "바닷가에서 가장 큰 조개 얻기 작전"]),
    sparkCard("misheard", "잘못 들은 말", "누군가 한 말을 엉뚱하게 알아들어서 일이 커져요.", "Someone mishears a few words and the mistake grows.", ["유치원에서 괴물이 온다고 들은 날", "공원에서 할머니 말을 잘못 들은 날"]),
    sparkCard("growing_secret", "자라는 비밀", "작은 비밀이 점점 커져서 더는 숨길 수 없게 돼요.", "A small secret keeps growing until it cannot be hidden.", ["욕조 거품이 온 집을 채운 날", "화분에 숨긴 씨앗이 쑥쑥 자란 날"]),
    sparkCard("backwards_day", "거꾸로 하루", "하루가, 또는 세상이 거꾸로 돌아가요.", "The day, or the world, runs the wrong way round.", ["저녁에 일어나 시작하는 거꾸로 하루", "동물원에서 동물이 사람 구경한 날"]),
    sparkCard("swap_jobs", "하루 바꿔 하기", "누군가와 하는 일을 하루 바꿔요.", "The hero swaps jobs with someone for a day.", ["빵집 주인과 하루 일 바꾸기", "아빠와 하루 유치원 바꿔 가기"]),
    sparkCard("collecting", "모으기", "무언가를 모으다 보니 감당 못 하게 많아져요.", "Collecting something gets out of hand.", ["바닷가에서 파도 소리를 병에 모으기", "가을 숲에서 빨간 것만 모으기"]),
    sparkCard("strange_map", "이상한 지도", "이상한 지도나 쪽지를 따라가요.", "A strange map or note leads somewhere.", ["다락방 지도를 따라 마당 끝까지", "도서관 책 속 쪽지 따라가기"]),
    sparkCard("wrong_delivery", "잘못 온 상자", "다른 누군가에게 갈 것이 잘못 와요.", "Something meant for someone else arrives by mistake.", ["우리 집에 잘못 배달된 커다란 알", "기차역에 잘못 내린 커다란 가방"]),
    sparkCard("too_much", "너무 많이", "바라던 것이 너무 많이 이루어져요.", "What was wanted comes true far too much.", ["부엌에서 팬케이크가 끝없이 나온 날", "놀이터에 비눗방울이 너무 많아진 날"]),
    sparkCard("keeps_hiding", "자꾸 숨는 누군가", "누군가 자꾸 숨어요 — 왜 숨는지가 이야기예요.", "Someone keeps hiding, and why they hide is the story.", ["숲속에서 자꾸 숨는 아기 사슴", "유치원 옷장 속에 숨은 새 친구"]),
    sparkCard("long_queue", "이상하게 긴 줄", "모두 같은 것을 기다리며 줄을 서는데 줄이 이상해져요.", "Everyone queues for the same thing, and the queue gets strange.", ["공원 그네 앞에 줄 선 동물들", "시장에서 마지막 붕어빵 기다리기"]),
    sparkCard("copycat", "따라쟁이", "누군가 주인공을 똑같이 따라 해요.", "Someone copies everything the hero does.", ["놀이터에서 나만 따라 하는 꼬마 새", "바닷가에서 내 발자국 따라오는 게"]),
    sparkCard("tiny_door", "작은 문", "아무도 몰랐던 작은 문이 보여요.", "A tiny door nobody noticed before.", ["나무 밑동 작은 문에 노크하기", "유치원 벽 아래 작은 문 열어 보기"]),
    sparkCard("borrowed", "빌린 것 돌려주기", "빌린 것을 돌려줘야 하는데 그게 쉽지 않아요.", "Something borrowed has to go back, and that is not easy.", ["친구에게 빌린 우산 돌려주러 가기", "도서관에 늦게 돌려주는 공룡 책"]),
    sparkCard("night_noise", "밤의 소리", "밤에 들리는 소리의 정체를 찾아요.", "A sound in the night, and finding out what it is.", ["캠핑장 밤에 들린 쿵쿵 소리 찾기", "할머니 댁 다락에서 나는 소리"]),
    sparkCard("stuck", "꼼짝 못 해요", "무언가 끼어서 꼼짝 못 하고, 모두가 빼내려 해요.", "Something is stuck, and everyone tries to free it.", ["공원 나무에 걸린 연 내리기", "미끄럼틀에 낀 커다란 공 빼기"]),
    sparkCard("wish_sideways", "엉뚱한 소원", "소원이 이루어지는데 생각과 다르게요.", "A wish comes true, but not the way it was meant.", ["생일에 빈 소원이 엉뚱하게 된 날", "별똥별 소원이 거꾸로 된 날"]),
  ]),
  cast: Object.freeze([
    card("odd_one", "무리와 엇박자 한 명", "무리가 함께 움직이는데 가장 작은 한 명만 늘 다르게 해요 — 결국 그 한 명이 옳아요.", "A group moves together and the smallest one keeps doing it differently — and turns out to be right."),
    card("opposites", "정반대 둘", "성격이 정반대인 둘이 같은 일을 함께 해야 해요.", "Two opposites have to do the same thing together."),
    card("three_sizes", "크기가 다른 셋", "큰 아이·중간 아이·작은 아이가 차례로 나서요.", "Big, middle and small take their turns, one after another."),
    card("joining_chain", "하나씩 늘어나는 무리", "인물이 하나씩 차례로 합류해요 — 앞 인물이 다음 인물을 데려와요.", "Characters join one at a time, each bringing the next."),
    card("all_want_one", "모두 같은 하나를", "모두가 같은 하나를 원해요.", "Everyone wants the same one thing."),
    card("different_wants", "저마다 다른 바람", "인물마다 바라는 것이 달라서 부딪혀요.", "Each character wants something different, and the wants collide."),
    card("quiet_follower", "말없이 따라오는 누군가", "누군가 말없이 내내 따라다녀요 — 주인공은 끝에야 알아차려요.", "Someone follows quietly all along; the hero notices only at the end."),
    card("grown_ups_busy", "어른은 바쁘고", "어른들은 제 일로 바빠 모르고, 아이들이 알아차리고 해결해요.", "The grown-ups are busy and miss it; the children notice and solve it."),
  ]),
  device: Object.freeze([
    card("same_plan", "같은 계획 되풀이", "같은 계획을 매번 다시 시도하고, 매번 새로운 방식으로 어긋나요 — 되풀이가 웃음이 돼요.", "The same plan is tried again and again, and each time it goes wrong in a new way — the repetition is the joke.", { sameTry: true }),
    card("piling_up", "쌓이는 이야기", "비트마다 하나씩 더해져 쌓이다가 마지막에 와르르.", "One more thing is added each beat until it all tumbles down."),
    card("countdown", "줄어드는 수", "다섯, 넷, 셋… 하나씩 줄어들어요.", "Something counts down, one fewer each time."),
    card("misreads", "잘못 읽기", "주인공은 상황을 계속 잘못 읽고, 읽는 아이는 바로 알아요.", "The hero keeps misreading what is happening; the child reading sees it at once.", { k1: false }),
    card("child_sees", "아이만 아는 것", "그림 속에 읽는 아이만 아는 것이 내내 있어요.", "The pictures hold something only the child reading knows, all along.", { k1: false }),
    card("same_question", "같은 질문", "같은 질문이 비트마다 돌아오고, 대답이 조금씩 바뀌어요.", "The same question comes back each beat, and the answer shifts."),
    card("chain_reaction", "꼬리를 무는 일", "한 일이 다음 일을 부르고, 그게 또 다음 일을 불러요.", "One thing leads to the next, which leads to the next."),
    card("refrain_turns", "되풀이 줄이 뒤집혀요", "한 줄이 계속 돌아오다가 끝에서 한 낱말이 바뀌어요.", "One line keeps coming back and turns by one word at the end."),
    card("opposite_result", "하면 할수록 반대로", "할 때마다 바라던 것과 반대가 돼요.", "Every try gets the opposite of what was wanted."),
    card("small_gains", "작은 것 하나씩", "실패할 때마다 작은 것 하나를 얻고, 끝에 그것들이 모여 해결돼요.", "Each failure leaves one small thing behind, and together they solve it at the end."),
  ]),
  ending: Object.freeze([
    card("starts_again", "또 시작", "끝나자마자 같은 일이 새 대상으로 다시 시작돼요.", "Just as it ends, the same thing starts again with something new."),
    card("places_swapped", "뒤바뀐 자리", "처음과 자리가 뒤바뀐 채 끝나요.", "It ends with the places of the beginning swapped."),
    card("small_question", "작은 물음표", "작은 물음 하나를 남기고 끝나요.", "It ends on one small open question."),
    card("quiet_mirror", "조용한 거울", "첫 장면을 되비추되 하나만 달라요.", "The last picture mirrors the first, with one thing different."),
    card("last_surprise", "마지막 한 장", "마지막 그림에 주인공은 못 본 놀라운 것 하나가 있어요.", "The last picture holds one surprise the hero does not see."),
    card("laugh_together", "다 같이 웃음", "모두 함께 웃으며 끝나요 — 웃음의 이유는 처음의 그 일이에요.", "Everyone laughs together at the end, about the very thing it began with."),
  ]),
});
const byId = new Map(IDEA_SLOTS.flatMap((slot) => IDEA_DECK[slot].map((c) => [c.id, { ...c, slot }])));
export const ideaCardById = (id) => byId.get(String(id ?? "")) || null;
const hash = (text) => {
  let h = 2166136261;
  for (const char of String(text)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
};
const list = (value) => (Array.isArray(value) ? value : []);
/**
 * One card per slot, in a seed-decided order, the latest books' cards left
 * for last; K1 skips the cards that need a reader who sees past the hero.
 * `spark: false` draws only cast, device and ending (an automatic draw keeps
 * the parent's topic as the premise).
 */
export function drawIdea({ seed = "", recentIds = [], k1 = false, spark = true } = {}) {
  const recent = new Set(list(recentIds).map(String)),
    cards = {};
  for (const slot of IDEA_SLOTS) {
    if (slot === "spark" && !spark) continue;
    const pool = IDEA_DECK[slot].filter((c) => !(k1 && c.k1 === false));
    const [first] = [...pool].sort(
      (a, b) => Number(recent.has(a.id)) - Number(recent.has(b.id)) || hash(`${seed}:${slot}:${a.id}`) - hash(`${seed}:${slot}:${b.id}`),
    );
    cards[slot] = first.id;
  }
  return { version: IDEA_VERSION, cards, from: spark ? "pick" : "auto" };
}
/** A topic for a spark card (one of its examples, not the current topic). */
export function sparkTopic(sparkId, current = "", seed = "") {
  const topics = list(ideaCardById(sparkId)?.topics).filter((topic) => topic !== String(current || "").trim());
  return topics.length ? topics[hash(`${seed}:topic`) % topics.length] : "";
}
/**
 * The frozen reference: a known card in its own slot for cast and ending, the
 * spark and the device optional (a draft whose writers' room runs three
 * candidates leaves the device to the room — one per candidate), or null.
 */
export function storyIdeaRef(value) {
  const source = value && typeof value === "object" && value.version === IDEA_VERSION && value.cards && typeof value.cards === "object" ? value.cards : null;
  if (!source) return null;
  const cards = {};
  for (const slot of IDEA_SLOTS) {
    const id = String(source[slot] ?? "");
    if (ideaCardById(id)?.slot === slot) cards[slot] = id;
    else if (slot === "cast" || slot === "ending") return null;
  }
  return { version: IDEA_VERSION, cards, from: value.from === "pick" ? "pick" : "auto" };
}
/** The idea without its device (the room picks one per candidate). */
export function withoutDevice(ref) {
  const out = storyIdeaRef(ref);
  if (out) delete out.cards.device;
  return out;
}
/** A device drawn from a seed (for a draft with no room — the eco flow — whose idea has none). */
export function withDevice(ref, seed = "", { k1 = false } = {}) {
  const out = storyIdeaRef(ref);
  if (!out || out.cards.device) return out;
  out.cards.device = drawIdea({ seed, k1, spark: false }).cards.device;
  return out;
}
/** The input with the room's chosen device filled in (when the frozen idea leaves it to the room). */
export function ideaInputFor(input, device) {
  const ref = storyIdeaRef(input?.storyIdea);
  if (!ref || ref.cards.device || ideaCardById(device)?.slot !== "device") return input;
  return { ...input, storyIdea: { ...ref, cards: { ...ref.cards, device: String(device) } } };
}
/** A diet draft's frozen idea, or null (the prompts read nothing else). */
export const ideaOf = (input) => (input?.promptDiet?.version === 1 ? storyIdeaRef(input.storyIdea) : null);
/** True when the book's device is the same plan tried again (the R39 tries may share a kind). */
export const ideaRepeatsTries = (input) => ideaCardById(ideaOf(input)?.cards.device)?.sameTry === true;
const resolved = (input) => {
  const ref = ideaOf(input);
  return ref ? IDEA_SLOTS.filter((slot) => ref.cards[slot]).map((slot) => ideaCardById(ref.cards[slot])) : [];
};
const EN_LABELS = Object.freeze({ spark: "Spark", cast: "Cast", device: "Device", ending: "Ending" });
/** The outline request's block (English). */
export function ideaOutlineBlock(input) {
  const cards = resolved(input);
  if (!cards.length) return "";
  return `IDEA FOR THIS BOOK (drawn at random so that no two books feel alike — a spark, not a checklist; bend it to the topic and the chosen characters, and let it surprise): ${cards
    .map((c) => `${EN_LABELS[c.slot]} — ${c.en}`)
    .join(" ")}${ideaRepeatsTries(input) ? " With this device the tries may be the same plan each time; what changes is how each one goes wrong." : ""}`;
}
/** The writers' line: Korean for the Korean writer, English otherwise. */
export function ideaWriterLine(input, lang = "ko") {
  const cards = resolved(input);
  if (!cards.length) return "";
  return lang === "ko"
    ? `[이 책의 아이디어 — 불씨예요, 점검표가 아니에요] ${cards.map((c) => `${IDEA_LABELS[c.slot]} · ${c.name}: ${c.ko}`).join(" ")}`
    : `This book's idea (a spark, not a checklist): ${cards.map((c) => c.en).join(" ")}`;
}
/** The writers' room direction (Korean card names). */
export function ideaDirection(input) {
  const cards = resolved(input);
  return cards.length ? `아이디어: ${cards.map((c) => `${IDEA_LABELS[c.slot]} ${c.name}`).join(" · ")}` : "";
}
/** One line for ① (the drawn combo), ③ and the pro card. */
export function ideaSummary(value) {
  const ref = storyIdeaRef(value);
  if (!ref) return "";
  return `아이디어 · ${IDEA_SLOTS.filter((slot) => ref.cards[slot])
    .map((slot) => `${IDEA_LABELS[slot]} ${ideaCardById(ref.cards[slot]).name}`)
    .join(" · ")}`;
}
/* ---------- the writers' room: three candidates that really differ ---------- */
/*
 * The parent on three R29 candidates for "우주 정거장으로 편지 띄우기": the
 * same story three times (decorate the letter bigger and bigger, it comes
 * back, a small sticker seen early turns out to be the key — a heart, a fish,
 * a star) and the same tension bars. The shared growth design already fixed
 * the turn ("not the big decoration but the small picture"), every angle's
 * line ended in "seeing the planted thing again", and one curve shape was
 * asked of all three. On an idea draft each candidate now gets its own
 * device, its own kind of turn and its own curve shape, and the growth design
 * leaves the way the problem is solved to the candidates.
 */
export const ROOM_ANGLES = Object.freeze({
  heart: Object.freeze({
    turn: "마음이 바뀌는 반전 — 주인공이 다른 누군가의 마음이나 사정을 알아차리고, 바라던 것을 스스로 바꾼다.",
    curve: "천천히 오르다 전환 바로 앞이 가장 높고, 전환 뒤에는 따뜻하게 내려와 끝은 가장 낮다(예: 0·1·1·2·3·4·2·0처럼 한 번에 오르는 언덕).",
    devices: Object.freeze(["same_question", "refrain_turns", "small_gains", "misreads", "chain_reaction"]),
  }),
  adventure: Object.freeze({
    turn: "숨어 있던 것이 드러나는 반전 — 장소·누군가·소리의 정체나 처음부터 있던 길이 드러난다. 작은 표시(스티커·무늬·조각)를 다시 보는 반전은 쓰지 않는다.",
    curve: "첫 비트부터 꽤 높게 시작해(사건이 먼저 온다) 한 번 내려갔다가 다시 끝까지 올라 전환 근처가 가장 높다(예: 2·3·1·2·3·4·1·0처럼 출렁이는 길).",
    devices: Object.freeze(["child_sees", "chain_reaction", "countdown", "small_gains", "misreads", "piling_up"]),
  }),
  humor: Object.freeze({
    turn: "되풀이가 뒤집히는 반전 — 같은 일이 거꾸로 일어나거나, 아무도 기대하지 않던 쪽(가장 작은 아이·물건·동물)이 해낸다. 작은 표시를 다시 보는 반전은 쓰지 않는다.",
    curve: "시도마다 올랐다가 웃음으로 툭 떨어지는 지그재그, 꼭대기는 점점 높아지고 전환이 가장 높다(예: 1·3·1·3·2·4·1·0처럼 톱니).",
    devices: Object.freeze(["same_plan", "piling_up", "opposite_result", "countdown", "chain_reaction", "same_question"]),
  }),
});
/**
 * One device per angle (heart, adventure, humor) for an idea draft: the
 * parent's own device for all three when they drew one, else three different
 * devices, each angle's favourites first in a seed-decided order, the latest
 * books' devices left for last. Null for any other draft.
 */
export function roomDevices(input) {
  const ref = ideaOf(input);
  if (!ref) return null;
  if (ref.cards.device) return { heart: ref.cards.device, adventure: ref.cards.device, humor: ref.cards.device };
  const seed = `${String(input?.topic || "").trim()}:${Number(input?.qualitySeedOffset) || 0}`,
    recent = new Set(recentIdeaIds(input?.storyQuality?.approvedBooks)),
    taken = new Set(),
    out = {};
  for (const angle of Object.keys(ROOM_ANGLES)) {
    const known = ROOM_ANGLES[angle].devices.filter((id) => ideaCardById(id)?.slot === "device");
    const ordered = [...known, ...IDEA_DECK.device.map((c) => c.id).filter((id) => !known.includes(id))].sort(
      (a, b) =>
        Number(taken.has(a)) - Number(taken.has(b)) ||
        Number(recent.has(a)) - Number(recent.has(b)) ||
        Number(!known.includes(a)) - Number(!known.includes(b)) ||
        hash(`${seed}:${angle}:${a}`) - hash(`${seed}:${angle}:${b}`),
    );
    out[angle] = ordered[0];
    taken.add(ordered[0]);
  }
  return out;
}
/** The growth design's extra line on an idea draft: the hero's heart only, not how the problem is solved. */
export function ideaGrowthLine(input) {
  return ideaOf(input)
    ? "need·flaw는 주인공의 마음에 관한 것만 정한다. 문제가 무엇으로 어떻게 풀리는지(반전의 방법·물건·표시)는 여기서 정하지 않는다 — 세 후보가 서로 전혀 다른 방법으로 푼다."
    : "";
}
/** One candidate's lines on an idea draft: its device, its kind of turn and its curve shape (Korean). */
export function ideaCandidateLines(input, angleId, device) {
  const angle = ROOM_ANGLES[angleId],
    card = ideaCardById(device);
  if (!ideaOf(input) || !angle) return "";
  return [
    `[이번 후보의 장치] ${card ? `${card.name} — ${card.ko}` : "자유롭게"}`,
    `[이번 후보의 반전] ${angle.turn} 다른 두 후보와 사건·물건·반전이 겹치지 않게, 이 각도만의 이야기로.`,
    `[이번 후보의 곡선 모양] ${angle.curve}`,
    "[말] 제목·한 줄 줄거리와 모든 글은 한국어로만 쓴다(한자나 다른 나라 글자 없이). 등장인물과 장소는 [조건]의 이름으로 부른다.",
  ].join("\n");
}
/**
 * The drawer's materials the room may use (names and IDs), kept on an idea
 * draft's meeting record so the parent's choice can say who and where each
 * candidate uses.
 */
export function roomMaterials(input) {
  if (!ideaOf(input)) return null;
  const rows = (items) =>
    list(items)
      .map((row) => ({ id: String(row?.id || ""), name: String(row?.name || "").trim().slice(0, 40) }))
      .filter((row) => row.id && row.name);
  return { characters: rows(input?.characters), places: rows(input?.backgrounds) };
}
/**
 * Who and where a candidate uses, measured by the app (names found in the
 * pitch's own text; the hero always counts) — never the model's own count.
 */
export function pitchMaterials(pitch, materials) {
  if (!pitch || !materials) return null;
  const text = [pitch.title, pitch.logline, pitch.stakes, pitch.planted?.name, pitch.planted?.firstSeen, ...list(pitch.ladder), pitch.lowPoint, pitch.turn?.seen, pitch.turn?.realized, pitch.turn?.overturns, pitch.payoff, pitch.echo, pitch.secret, pitch.companion]
    .map((value) => String(value ?? ""))
    .join("\n");
  const all = list(materials.characters),
    places = list(materials.places);
  return {
    characters: all.filter((row, i) => i === 0 || text.includes(row.name)),
    places: places.filter((row) => text.includes(row.name)),
    ofCharacters: all.length,
    ofPlaces: places.length,
  };
}
/** One line for a candidate card: "등장인물 3명 · 유하·해니·동동 (고른 5명 중) / 장소 1곳 · 편지방 (고른 3곳 중)". */
export function pitchMaterialsLine(pitch, materials) {
  const m = pitchMaterials(pitch, materials);
  if (!m) return "";
  const who = `등장인물 ${m.characters.length}명 · ${m.characters.map((row) => row.name).join("·")}${m.ofCharacters > m.characters.length ? ` (고른 ${m.ofCharacters}명 중)` : ""}`,
    where = m.places.length
      ? `장소 ${m.places.length}곳 · ${m.places.map((row) => row.name).join("·")}${m.ofPlaces > m.places.length ? ` (고른 ${m.ofPlaces}곳 중)` : ""}`
      : `장소 · 고른 ${m.ofPlaces}곳 중 이름이 나온 곳 없음`;
  return `${who} / ${where}`;
}
export const ideaDeviceName = (device) => (ideaCardById(device)?.slot === "device" ? ideaCardById(device).name : "");
/** The card ids the latest approved books used (newest first), for the drawer. */
export function recentIdeaIds(records = [], count = 3) {
  return list(records)
    .map((record) => record?.usedElements?.idea || null)
    .filter((value) => value && typeof value === "object")
    .slice(0, count)
    .flatMap((cards) => IDEA_SLOTS.map((slot) => cards[slot]))
    .filter((id) => ideaCardById(id));
}
