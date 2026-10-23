/* 목소리 카드 (R34, 2026-10-23): every paid manuscript so far read like the
 * same person on the same day — a quarter of the sentences began "유하는",
 * nine in ten ended in "-었어요", one in ten carried dialogue, none asked
 * the reader anything. Not a rule was to blame: the writer prompt simply said
 * nothing about voice, and its budget line asked for even sentences. This
 * deck gives each new book a voice of its own, chosen once from the topic's
 * seed (never repeating the latest books' cards) in five slots — narrator,
 * dialogue, rhythm, sentence endings, first sentence — and hands the writer
 * a short card for each with an example or two, plus a palette of what good
 * picture-book prose does. A spark, not a checklist: no checker counts it.
 * Pure: no DOM, no network. */
export const VOICE_VERSION = 1;
const ALL = Object.freeze(["K1", "K2", "K3", "K4"]),
  K2UP = Object.freeze(["K2", "K3", "K4"]);
const card = (id, name, ko, examples, en, levels = ALL, shapes = []) =>
  Object.freeze({ id, name, ko, examples: Object.freeze(examples), en, levels, shapes: Object.freeze(shapes) });
export const VOICE_SLOTS = Object.freeze(["narrator", "dialogue", "rhythm", "ending", "opener"]);
export const SLOT_LABELS = Object.freeze({ narrator: "화자", dialogue: "대화", rhythm: "리듬", ending: "끝맺음", opener: "첫 문장" });
/** {name} is the protagonist, {friend} the first companion (or 친구). */
export const VOICE_DECK = Object.freeze({
  narrator: Object.freeze([
    card("storyteller", "말 거는 이야기꾼", "독자에게 말을 걸어요. '있잖아요', '그런데 말이에요', '어떻게 됐을까요?' 같은 말로 아이를 이야기 안으로 불러요.",
      ["있잖아요, 그날 아침은 조금 이상했어요.", "어떻게 됐을까요? 한번 볼까요."], "a storyteller who speaks to the listening child now and then", ALL, ["why_chain", "riddler"]),
    card("quiet_watcher", "조용한 관찰자", "한 걸음 떨어져서 보이는 것만 차분히 적어요. 설명하지 않고 그림처럼 보여 줘요.",
      ["창가에 빗방울 하나. 또 하나.", "{name}은 가만히 서서 기다렸어요."], "a quiet observer who shows and never explains", ALL, ["waiting", "seed_grow", "quiet"]),
    card("inside_head", "주인공 속마음 가까이", "주인공이 느끼는 대로 따라가고, 속마음 한 줄을 가끔 섞어요. '설마.', '아직은 아니야.'",
      ["설마, 벌써? {name} 가슴이 콩콩 뛰었어요.", "괜찮아. 한 번만 더."], "close to the hero's own thoughts, a thought in its own short line now and then", K2UP, ["first_time", "brave_step", "share_or_keep", "sleepless"]),
    card("singsong", "노래하듯", "리듬이 있는 문장을 써요. 같은 소리, 같은 꼴이 돌아와서 읽으면 노래가 돼요.",
      ["통통, 통통, 공이 가요. 데굴데굴, 공이 가요.", "바람이 불면 모자가 날고, 모자가 날면 {name}이 달려요."], "sing-song lines whose sounds and shapes come back like a song", ALL, ["sound_adventure", "count_to_ten", "color_hunt", "journey_repeat", "accumulate"]),
    card("riddler", "수수께끼 내는 화자", "답을 바로 말하지 않고 묻고 넘겨요. 아이가 먼저 맞히게 해요.",
      ["저 소리는 누구일까요? 쥐? 바람? 아니면…", "상자 안에 뭐가 들어 있을까요?"], "a narrator who asks before telling, so the child guesses first", K2UP, ["mystery_sound", "search_wrong_answers", "answer_pile", "follow_tracks", "hide_and_seek"]),
    card("live", "현재형 생중계", "지금 일어나는 일처럼 현재형으로 써요. 문장이 짧고 빨라요.",
      ["{name}이 문을 열어요. 바람이 확 들어와요.", "하나, 둘… 뛰어요!"], "present-tense narration, as if it happens right now", ALL, ["escalation", "weather_turn", "opposite_day", "mix_up"]),
    card("warm_teller", "다정한 옛이야기꾼", "할머니가 무릎에 앉혀 놓고 들려주듯 느긋하고 다정하게 이야기해요.",
      ["옛날 옛적, 아니 바로 어제였어요.", "그래서 {name}은 어떻게 했냐면요—"], "a warm, unhurried teller, like a grandparent on a lap", ALL, ["visitor", "gift_making", "trade_chain", "delivery"]),
  ]),
  dialogue: Object.freeze([
    card("back_and_forth", "주고받는 대화", "짧은 대사를 두세 번 주고받아요. 대사 사이에 행동 한 줄을 끼워요.",
      ["\"갈래?\" \"응!\" {friend}가 신발을 신었어요. \"잠깐, 모자!\""], "short lines of dialogue traded back and forth, an action between them", ALL, ["escalation", "share_or_keep", "trade_chain", "role_swap"]),
    card("one_liner", "대사 하나와 행동", "꼭 필요한 대사 하나만 두고 나머지는 행동으로 보여 줘요.",
      ["\"찾았다!\" {name}이 조개를 번쩍 들었어요."], "one line of speech where it matters, the rest shown by action", ALL, ["quiet_watcher"]),
    card("self_talk", "혼잣말·속삭임", "주인공이 혼자 작게 중얼거려요. 속삭이듯, 다짐하듯.",
      ["\"괜찮아, 괜찮아.\" {name}은 작게 말했어요.", "\"조금만… 조금만 더.\""], "the hero's whispered self-talk", ALL, ["brave_step", "first_time", "sleepless", "seed_grow"]),
    card("sound_first", "소리가 말해요", "대사보다 소리가 많아요. 소리가 사건을 먼저 알려 줘요.",
      ["쿵. 쿵쿵. 문 뒤에서 또 쿵.", "딸랑— {name}이 고개를 들었어요."], "sounds carry the scene more than speech does", ALL, ["sound_adventure", "mystery_sound", "weather_turn", "sleepless"]),
    card("question_game", "질문-대답 놀이", "한 사람이 묻고 다른 사람이 답하는 리듬. '이거야?' '아니.' '그럼 저거?'",
      ["\"이거야?\" \"아니.\" \"그럼… 저거?\" \"맞아!\""], "a question-and-answer game between two voices", ALL, ["search_wrong_answers", "answer_pile", "hide_and_seek", "why_chain", "riddler"]),
    card("everyone_talks", "여럿이 한마디씩", "조연들이 한마디씩 거들어요. 누가 말했는지는 꼭 보이게.",
      ["\"내가 먼저!\" \"아니, 나!\" 둘이 동시에 손을 들었어요."], "several voices chiming in, each clearly marked", K2UP, ["everyone", "visitor", "mix_up", "build_together", "escalation"]),
  ]),
  rhythm: Object.freeze([
    card("short_short_long", "짧-짧-긴", "짧은 문장 둘, 긴 문장 하나. 그다음엔 거꾸로. 길이가 들쭉날쭉한 게 리듬이에요.",
      ["비가 와요. 또 와요. 우산 위로 톡톡 떨어지다가 길 위로 또르르 굴러가요."], "two short sentences, then one long one, then the other way round", ALL),
    card("one_word_drop", "한 단어 문장", "긴 문장 뒤에 한 단어 문장을 툭 떨어뜨려요.",
      ["{name}은 상자를 천천히 열었어요. 텅.", "조개. 또 조개. 그리고… 게!"], "a single-word sentence dropped after a long one", ALL, ["mystery_sound", "hide_and_seek", "search_wrong_answers"]),
    card("list_pile", "하나, 둘, 셋 쌓기", "같은 꼴의 문장이나 낱말을 세 번 쌓고, 셋째에서 뒤집어요.",
      ["빨간 조개, 하얀 조개, 그리고 움직이는 조개?"], "things piled in threes, the third one different", ALL, ["accumulate", "count_to_ten", "color_hunt", "answer_pile", "build_together"]),
    card("refrain_turn", "되풀이의 변주", "한 줄이 돌아오되 낱말 하나씩 바뀌어요.",
      ["아직 멀었어. / 조금 남았어. / 다 왔어!"], "a line that returns with one word changed each time", ALL, ["journey_repeat", "waiting", "seed_grow", "delivery"]),
    card("page_turn_hook", "넘기고 싶은 끝", "비트의 마지막 문장은 다음을 궁금하게 끝내요. '그런데 그때—'",
      ["그런데 그때, 뒤에서 무언가 움직였어요."], "each beat ends on a line that makes you turn the page", K2UP, ["follow_tracks", "mystery_sound", "brave_step", "visitor"]),
    card("even_steps", "고른 걸음", "비슷한 길이의 문장이 차분히 이어져요. 가끔 한 문장만 길게 늘여요.",
      ["{name}은 길을 따라 걸었어요. 해가 조금씩 높아졌어요. 저 멀리, 아주 멀리, 작은 지붕 하나가 보였어요."], "even, calm sentences with one long one now and then", ALL, ["waiting", "quiet_watcher", "warm_teller"]),
  ]),
  ending: Object.freeze([
    card("past_mixed", "'-지요·-답니다' 섞기", "'-했어요'만 쓰지 않아요. '-했지요', '-했답니다', '-하네요'를 번갈아 써서 끝이 노래처럼 바뀌어요.",
      ["{name}은 달렸지요. {friend}도 따라왔답니다. 둘 다 숨이 차네요."], "", ALL),
    card("present_live", "현재형 끝맺음", "'-해요', '-하네요', '-어요'로 지금 보는 것처럼 끝내요.",
      ["파도가 밀려와요. 발가락이 간질간질하네요."], "", ALL, ["live", "weather_turn", "opposite_day"]),
    card("talk_to_reader", "말 거는 끝맺음", "'-할까요?', '-겠지요?', '-했을까요?'를 섞어 아이에게 물어요.",
      ["{name}은 어디로 갔을까요? 바다로 갔겠지요?"], "", ALL, ["storyteller", "riddler", "why_chain", "hide_and_seek"]),
    card("hearsay", "전해 듣는 말투", "'-했대요', '-라는 거예요', '-했다지 뭐예요'로 옛이야기처럼 전해요.",
      ["옛날에 아주 작은 게가 살았대요. 집이 없었다지 뭐예요."], "", K2UP, ["warm_teller", "visitor", "trade_chain"]),
    card("plain_past", "또박또박 과거형", "'-했어요'를 주로 쓰되, 문장 길이와 첫머리로 변화를 줘요.",
      ["{name}은 조개를 주웠어요. 작고 하얀 조개였어요. 귀에 대자, 쏴아— 바다 소리가 났어요."], "", ALL),
  ]),
  opener: Object.freeze([
    card("sound", "소리로 시작", "책의 첫 문장은 소리예요.", ["쏴아. 쏴아. 파도가 먼저 인사했어요."], "the book opens on a sound", ALL, ["sound_adventure", "mystery_sound", "weather_turn"]),
    card("question", "질문으로 시작", "첫 문장이 아이에게 묻는 말이에요.", ["바닷가에서 제일 먼저 만나는 건 뭘까요?"], "the book opens with a question to the child", ALL, ["riddler", "why_chain", "answer_pile"]),
    card("dialogue", "대사로 시작", "첫 문장이 누군가의 말이에요.", ["\"오늘은 꼭 찾을 거야!\""], "the book opens on a line of speech", ALL, ["escalation", "share_or_keep", "first_time"]),
    card("time_weather", "시간·날씨로 시작", "하루의 때나 날씨가 먼저 와요.", ["해가 막 올라온 아침이었어요."], "the book opens with the hour or the weather", ALL, ["waiting", "weather_turn", "sleepless"]),
    card("object", "사물 하나로 시작", "작은 물건 하나가 첫 문장이에요.", ["노란 양동이 하나. 그게 시작이었어요."], "the book opens on one small object", ALL, ["trade_chain", "build_together", "gift_making", "delivery"]),
    card("action_no_name", "이름 없이 행동으로", "이름을 부르지 않고 몸의 움직임으로 시작해요.", ["맨발이 모래 위를 달려요."], "the book opens on a movement, no name yet", ALL, ["live", "brave_step", "hide_and_seek"]),
  ]),
});
/** What good picture-book prose does — possibilities for the writer, never counted by a checker. */
export const VOICE_PALETTE =
  "[좋은 그림책 산문이 하는 일 — 가능성이지 점검표가 아니에요] 긴 문장 뒤에 한 단어 문장을 떨어뜨리고, 같은 꼴을 세 번 쌓다가 셋째에서 뒤집고, 대사를 주고받다가 행동 한 줄로 숨을 돌려요. 문장은 이름 말고도 소리·시간·사물·대사로 시작할 수 있어요(모든 문장이 '이름은'으로 시작하면 노래가 되지 않아요). 끝맺음은 '-했어요' 하나에 묶이지 않아요('-했지요', '-했답니다', '-하네요', '-할까요?'). 독자에게 묻고, 속마음을 한 줄 들려주고, 소리는 소리 그대로 써요. 길이가 들쭉날쭉한 게 리듬이에요 — 평균만 수준 안이면 돼요.";
const byId = new Map(VOICE_SLOTS.flatMap((slot) => VOICE_DECK[slot].map((c) => [c.id, { ...c, slot }])));
export const voiceCardById = (id) => byId.get(String(id ?? "")) || null;
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
const list = (value) => (Array.isArray(value) ? value : []);
/** A stable number in [0, 1) from a text (the seed decides, never Math.random). */
const unit = (text) => parseInt(hash(text), 16) / 0x100000000;
/**
 * A voice for a new book: one card per slot, suited to the level, skipping
 * the cards the latest books used (when any other remains). The draw is a
 * weighted lottery decided by the seed: a card that names the story shape,
 * or a card already drawn for this book, is twice as likely — a lean, never
 * a rule, so the same shape still gets different voices from different seeds.
 */
export function chooseVoice({ seed = "", level = "K2", recentIds = [], shapeId = "" } = {}) {
  const lvl = levelOf(level),
    recent = new Set(list(recentIds).map(String)),
    cards = {};
  let picked = [];
  for (const slot of VOICE_SLOTS) {
    const suited = VOICE_DECK[slot].filter((c) => c.levels.includes(lvl)),
      fresh = suited.filter((c) => !recent.has(c.id)),
      pool = fresh.length ? fresh : suited,
      weights = pool.map((c) => 1 + c.shapes.filter((s) => s === shapeId || picked.includes(s)).length),
      total = weights.reduce((a, b) => a + b, 0);
    let roll = unit(`${seed}:${slot}`) * total,
      best = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll < 0) {
        best = pool[i];
        break;
      }
    }
    cards[slot] = best.id;
    picked = [...picked, best.id];
  }
  return { version: VOICE_VERSION, cards };
}
/** The frozen reference: version and one known card id per slot, or null. */
export function voiceRef(voice) {
  const source = voice && typeof voice === "object" && voice.cards && typeof voice.cards === "object" ? voice.cards : null;
  if (!source) return null;
  const cards = {};
  for (const slot of VOICE_SLOTS) {
    const c = voiceCardById(source[slot]);
    if (!c || c.slot !== slot) return null;
    cards[slot] = c.id;
  }
  return { version: VOICE_VERSION, cards };
}
/** Korean particles after a filled-in name follow its last syllable: 유하는·유하가·유하도, 해님은·해님이. */
const hasFinal = (word) => {
  const code = String(word || "").codePointAt(String(word || "").length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 !== 0;
};
const PARTICLES = { "은": "는", "이": "가" };
export function fillName(text, token, name) {
  const final = hasFinal(name);
  return String(text || "").replace(new RegExp(`${token.replace(/[{}]/gu, "\\$&")}(은|이)?`, "gu"), (_, particle) =>
    `${name}${particle ? (final ? particle : PARTICLES[particle]) : ""}`,
  );
}
const resolved = (voice) => {
  const ref = voiceRef(voice);
  return ref ? Object.fromEntries(VOICE_SLOTS.map((slot) => [slot, voiceCardById(ref.cards[slot])])) : null;
};
/** The writer's block for a frozen voice: Korean cards with examples; English gets one light line. */
export function voiceBlock(input, lang = "ko") {
  const voice = resolved(input?.storyVoice);
  if (!voice) return "";
  if (lang === "en")
    return `This book's voice (a spark, not a checklist): ${VOICE_SLOTS.filter((slot) => voice[slot].en).map((slot) => voice[slot].en).join("; ")}.`;
  const name = String(list(input?.characters)[0]?.name || "아이"),
    friend = String(list(input?.characters)[1]?.name || "친구"),
    fill = (text) => fillName(fillName(text, "{name}", name), "{friend}", friend);
  return `[이 책의 목소리 — 불씨예요, 점검표가 아니에요]\n${VOICE_SLOTS.map((slot) => `${SLOT_LABELS[slot]}: ${voice[slot].name} — ${voice[slot].ko} 예) ${voice[slot].examples.map(fill).join(" / ")}`).join("\n")}`;
}
/** One line for ③ and the pro card: 문체 · 말 거는 이야기꾼 · 주고받는 대화 · … */
export function voiceSummary(voice) {
  const cards = resolved(voice);
  return cards ? `문체 · ${VOICE_SLOTS.map((slot) => cards[slot].name).join(" · ")}` : "";
}
/** The card ids the latest approved books used (newest first), for the chooser. */
export function recentVoiceIds(records = [], count = 3) {
  return list(records)
    .map((record) => record?.usedElements?.voice || record?.voice || null)
    .filter((voice) => voice && typeof voice === "object")
    .slice(0, count)
    .flatMap((voice) => VOICE_SLOTS.map((slot) => voice[slot]).filter((id) => voiceCardById(id)));
}
