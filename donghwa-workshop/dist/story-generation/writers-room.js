/* 작가실 (R50, 2026-11-03). The parent, after reading the review
 * (STORY_ENGINE_REVIEW_2026-11-03.md): "go with this flow; spend more on paid
 * models for a better story; rules and limits to the minimum." Decisions
 * recorded there and here: the only things a draft must keep are the parent's
 * chosen characters (they appear) and the reading level as a target measured
 * afterwards (never a blocking loop); no fear list, no page count, no
 * name ban — the writer decides the length and the typesetting pads an odd
 * count. This module is the room's paper: the one-page brief, the cast sheet,
 * the engine menu (a menu, never an assignment), the reader panel, and the
 * requests of each round with the deterministic counting that picks between
 * candidates (reactions are counted, never scored by the model). R51 runs the
 * rounds; nothing here is wired into a draft yet. Pure module. */
import { topicEndingNote } from "./topic-ending.js";
import { ledger } from "./quality-adapter.js";
import { parseJsonLenient } from "./outline-normalize.js";
import { councilHoldError, normalizeCouncilChoice, appendDecision } from "./council.js";
import { StoryValidationError, frozenBeatCount } from "./schemas.js";
import { wantsPicturePlan, settlePicturePlans, SHOTS, SPACES } from "./picture-plan.js";
import { hasStoryDrama, settleDramaPlans } from "./story-drama.js";
import { hasTextPocket, settlePockets } from "../text-pocket.js";
import { ROOM_PHASES } from "./council-room.js";
import { checkStory } from "./checker.js";
import { leanLevelLine } from "./prompt-diet.js";
import { acceptEcoPagination, inspectStory, roomServices, storyTopicKeywords } from "./pipeline.js";
/** R54d: a caller without an engine resolver (FULL AUTO) gets the pipeline's — the same one the room's premises stage uses. */
const withEngines = (services) => (typeof services?.engineFor === "function" ? services : { ...roomServices(), ...(services || {}) });
export { ROOM_PHASES };
export const WRITERS_ROOM_VERSION = 1;
/** The marker for a new draft; the family's recent books ride inside it (never story data): [{line, engine?, laugh?}]. */
export const writersRoomPolicy = (records = []) => {
  const recent = recentRoomBooks(records);
  return { version: WRITERS_ROOM_VERSION, ...(recent.length ? { recent } : {}) };
};
/** The marker as normalize keeps it; null when it is not the R51 one. */
export const writersRoomRef = (value) => {
  if (!object(value) || value.version !== WRITERS_ROOM_VERSION) return null;
  const recent = list(value.recent)
    .filter(object)
    .map((r) => ({ line: str(r.line, 200), ...(str(r.engine, 40) ? { engine: str(r.engine, 40) } : {}), ...(str(r.laugh, 120) ? { laugh: str(r.laugh, 120) } : {}) }))
    .filter((r) => r.line)
    .slice(0, 6);
  return { version: WRITERS_ROOM_VERSION, ...(recent.length ? { recent } : {}) };
};
export const hasWritersRoom = (input) => input?.writersRoom?.version === WRITERS_ROOM_VERSION;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const str = (value, max = 200) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
export const PREMISE_COUNT = 12;
export const SHORTLIST = 3;
/* ---------- the engine menu: shown, never assigned ---------- */
export const ENGINE_MENU = Object.freeze([
  Object.freeze({ id: "want_try_turn", name: "바람-시도-전환", line: "바라는 것이 있고, 여러 번 다르게 해 보고, 어느 순간 뒤집힌다.", waits: "될까 안 될까" }),
  Object.freeze({ id: "pile_up", name: "누적", line: "하나씩 쌓이다 넷째에 와르르.", waits: "또 하나 온다!" }),
  Object.freeze({ id: "three_then_flip", name: "되풀이 셋·넷째 뒤집기", line: "같은 일이 셋, 넷째가 거꾸로.", waits: "넷째 쪽 넘기기" }),
  Object.freeze({ id: "reader_knows", name: "독자만 아는 비밀", line: "주인공은 모르고 아이는 안다.", waits: "뒤에 있잖아!" }),
  Object.freeze({ id: "role_swap", name: "역할 바꾸기", line: "하루만 엄마가 아이, 아이가 엄마.", waits: "어른이 틀리는 장면" }),
  Object.freeze({ id: "wants_ensemble", name: "바람표 앙상블", line: "넷이 서로 다른 것을 바라 부딪친다.", waits: "누가 양보하나" }),
  Object.freeze({ id: "two_threads", name: "두 줄기 만남", line: "왼쪽 쪽은 A, 오른쪽 쪽은 B, 끝에 한 그림에서 만난다.", waits: "만나는 쪽" }),
  Object.freeze({ id: "wrong_guess", name: "틀린 짐작", line: "소리·흔적의 정체를 자꾸 틀린다.", waits: "진짜 정체" }),
  Object.freeze({ id: "ask_the_reader", name: "묻고 답하기", line: "이야기꾼이 아이에게 묻고 아이가 답한다.", waits: "내가 답하기" }),
  Object.freeze({ id: "time_limit", name: "시간 제한", line: "해 지기 전에, 버스 오기 전에.", waits: "마지막 한 번" }),
]);
export const engineById = (id) => ENGINE_MENU.find((engine) => engine.id === id) || null;
const engineMenuText = () => ENGINE_MENU.map((e) => `${e.id} · ${e.name}: ${e.line} (아이가 기다리는 것: ${e.waits})`).join("\n");
/* ---------- the reader panel: how a child takes a story in, not what they like ---------- */
const AGE = Object.freeze({ K1: 4, K2: 5, K3: 7, K4: 9 });
export function readerYears(input) {
  const ko = String(input?.specs?.ko?.id || "K2");
  return AGE[ko] || 5;
}
/** This family's own child, from the first chosen child character (name, age, likes, traits); a plain child when the drawer has none. */
export function ownChild(input) {
  const c = list(input?.characters).find((row) => object(row) && row.kind === "child") || null;
  if (!c) return null;
  return { name: str(c.name, 30), age: c.age !== undefined && c.age !== "" ? c.age : null, likes: str(c.likes, 60), traits: list(c.traits).slice(0, 3).map((t) => str(t, 20)) };
}
/**
 * R50 (revised the same day): the parent — "a dinosaur-loving five-year-old is
 * too narrow; set the readers by disposition or some other measure". Four ways
 * a child takes a story in, all at the book's age, plus this family's own
 * child from the drawer and the adult who reads aloud.
 */
export function readerPanel(input) {
  const y = readerYears(input), own = ownChild(input);
  return [
    { id: "action", name: `사건을 쫓는 ${y}세`, line: "무슨 일이 벌어지는지만 봐요. 다음에 뭐가 되는지 궁금하면 몸을 앞으로 내밀고, 아무 일도 안 일어나는 쪽에서는 딴 데를 봐요." },
    { id: "laugh", name: `웃을 거리를 찾는 ${y}세`, line: "뒤집히는 일, 틀리는 어른, 셋 다음의 넷째에 깔깔 웃어요. 뻔한 농담, 어느 책에나 있는 개그에는 안 웃어요." },
    { id: "heart", name: `마음을 읽는 ${y}세`, line: "누가 왜 그러는지를 봐요. 마음이 바뀌는 순간을 알아보고, 왜 그러는지 모르면 '왜?' 하고 물어요." },
    { id: "eye", name: `그림을 보는 ${y}세`, line: "구석의 작은 것, 주인공이 못 본 것을 먼저 찾아요. 글이 그림을 설명하면 지루해하고, 그림이 보여 줄 것이 없는 쪽은 넘겨 버려요." },
    { id: "ours", name: own ? `이 집 아이 ${own.name}${own.age !== null ? ` ${own.age}세` : ""}` : `이 집 아이 ${y}세`, line: own ? `${own.likes ? `${own.likes}을(를) 좋아하고` : "제 것을 좋아하고"}${own.traits.length ? `, ${own.traits.join("·")}.` : "."} 제 이름이 나오면 눈이 커지고, 저라면 안 그랬을 일에는 고개를 갸웃해요.` : "제 이름이 나오면 눈이 커지고, 저라면 안 그랬을 일에는 고개를 갸웃해요." },
    { id: "parent", name: "소리 내어 읽어 주는 어른", line: "입에 붙는 문장, 한 번 더 읽어 달라는 쪽, 읽다가 아이가 끼어드는 쪽을 알아요. 설명이 긴 쪽은 건너뛰고 싶어져요. 소리 내어 읽기 힘든 문장과, 누가 누구에게 하는 말인지에 안 맞는 존댓말·반말은 읽다가 바로 걸려요." },
  ];
}
const panelText = (input) => readerPanel(input).map((p) => `- ${p.id} · ${p.name}: ${p.line}`).join("\n");
/* ---------- the cast sheet ---------- */
const FAMILY = /가족|엄마|아빠|어머니|아버지|할머니|할아버지|이모|고모|삼촌|누나|언니|오빠|형|동생|부모/u;
/** The parent's chosen characters as rows the premise fills (want, flaw, way of speaking); new one-book characters are added beside them. */
export function castSheet(input) {
  return list(input?.characters)
    .filter(object)
    .map((c) => ({
      id: String(c.id || ""),
      name: str(c.name, 30),
      ...(c.nameEn ? { nameEn: str(c.nameEn, 30) } : {}),
      kind: c.kind === "adult" ? "어른" : c.kind === "child" ? "아이" : str(c.kind, 20) || "친구",
      // R54e: he/she for the English edition — the drawer's gender, else a family role that says it.
      ...(genderWord(c) ? { gender: genderWord(c) } : {}),
      role: str(c.role, 20) || "친구",
      family: FAMILY.test(`${c.role || ""} ${c.name || ""}`),
      ...(c.age !== undefined && c.age !== "" ? { age: c.age } : {}),
      traits: list(c.traits).slice(0, 3).map((t) => str(t, 20)),
      ...(c.catchphrase ? { catchphrase: str(c.catchphrase, 60) } : {}),
    }));
}
const MALE_ROLE = /아빠|아버지|할아버지|삼촌|오빠|형(?![제])/u,
  FEMALE_ROLE = /엄마|어머니|할머니|이모|고모|누나|언니/u;
/** "boy"·"girl"·"man"·"woman" from the drawer's gender word or a family role; "" when unknown. */
export function genderWord(c) {
  const g = String(c?.gender || ""),
    adult = c?.kind === "adult",
    who = `${c?.role || ""} ${c?.name || ""}`;
  if (/남자|boy|male/iu.test(g)) return adult ? "man" : "boy";
  if (/여자|girl|female/iu.test(g)) return adult ? "woman" : "girl";
  if (FEMALE_ROLE.test(who)) return adult || !/누나|언니/u.test(who) ? "woman" : "girl";
  if (MALE_ROLE.test(who)) return adult || !/오빠|형/u.test(who) ? "man" : "boy";
  return "";
}
const castText = (input) =>
  castSheet(input)
    .map((c) => `- ${c.name}${c.nameEn ? ` (${c.nameEn})` : ""} · ${c.kind} · ${c.role}${c.age !== undefined ? ` · ${c.age}세` : ""}${c.traits.length ? ` · ${c.traits.join(", ")}` : ""}`)
    .join("\n");
/** The parent's chosen places (preferredBackgroundIds), else every supplied one. */
const chosenPlaces = (input) => {
  const ids = new Set(list(input?.preferredBackgroundIds).map(String));
  const all = list(input?.backgrounds).filter(object);
  return ids.size ? all.filter((b) => ids.has(String(b.id))) : all;
};
const placeText = (input) => chosenPlaces(input).map((b) => `${str(b.name, 30)}${b.description ? ` (${str(b.description, 60)})` : ""}`).join(", ");
/* ---------- the recent books: "unlike these" ---------- */
export function recentBookLines(records = [], count = 6) {
  return list(records)
    .slice(0, count)
    .map((r) => {
      const topic = str(r?.topic, 40),
        logline = str(r?.outline?.logline || r?.outline?.summary, 80),
        laugh = list(r?.usedElements?.humor)[0];
      return [topic, logline, laugh ? `웃음: ${str(laugh, 60)}` : ""].filter(Boolean).join(" — ");
    })
    .filter(Boolean);
}
/** The recent books as the marker carries them: the brief's line, the engine and the first laugh (for the sieve). */
export function recentRoomBooks(records = [], count = 6) {
  return list(records)
    .slice(0, count)
    .map((r, i) => {
      const line = recentBookLines([r])[0] || "";
      const engine = str(r?.usedElements?.engine || r?.outline?.writersRoom?.premise?.engine, 40),
        laugh = str(list(r?.usedElements?.humor)[0], 120);
      return line ? { line, ...(engine ? { engine } : {}), ...(laugh ? { laugh } : {}) } : null;
    })
    .filter(Boolean);
}
/* ---------- the brief: one page, every round reads it ---------- */
const LEVEL_LINE = Object.freeze({
  K1: "3~4세가 듣는 책 — 한 쪽에 한 사건, 짧은 말.",
  K2: "5~6세가 듣는 책 — 그래서→그래서가 이어지고, 되풀이와 순서를 좋아해요.",
  K3: "7~8세가 읽는 책 — 오해가 풀리고 시점이 바뀌어도 따라와요.",
  K4: "9~10세가 읽는 책 — 복선과 갈등이 있어도 되고 끝은 희망으로.",
});
/** Only an ending the parent typed; the R38 note the wizard writes for a placeless topic is a rule, not a wish. */
const customEnding = (input) => {
  const note = str(input?.endingNote, 120);
  if (input?.endingType !== "custom" || !note) return "";
  return [topicEndingNote(input?.topic, { change: true }), topicEndingNote(input?.topic)].map((v) => str(v, 120)).includes(note) ? "" : note;
};
/** R54b: an openings book (K2+ dual, 12 or 16 printed pages) binds the writer's pages into fixed openings. */
const isOpeningsInput = (input) => input?.layoutPolicy?.kind === "openings";
const openingCount = (input) => (isOpeningsInput(input) ? Math.max(1, Math.round(Number(input?.pageCount) / 2) || 6) : 0);
const openingsBrief = (input) => {
  const c = openingCount(input);
  return c ? ` 이 책은 펼침 ${c}개(${c * 2}쪽)로 묶어요 — 글 ${c}~${c * 2}쪽이 그대로 들어가고, 한 펼침에 한두 쪽이 놓여요.` : "";
};
/** R54e: the reading level's page band as a target (never a block): [min, max, target] or null. */
export function pageBand(input, lang) {
  const spec = input?.specs?.[lang];
  if (!spec) return null;
  const unit = spec.units?.page;
  if (unit && Number.isFinite(unit.min) && Number.isFinite(unit.max)) return [unit.min, unit.max, Number.isFinite(unit.target) ? unit.target : Math.round((unit.min + unit.max) / 2)];
  const range = Array.isArray(spec.sentencesPerPageRange) ? spec.sentencesPerPageRange : null;
  if (range && Number.isFinite(range[0]) && Number.isFinite(range[1])) return [range[0], range[1], Number.isFinite(spec.sentencesPerPage) ? spec.sentencesPerPage : Math.round((range[0] + range[1]) / 2)];
  return null;
}
/** R54e: the A/B showed both writers at 6–12 sentences a page, so the polish rewrote whole books; the target goes to the writer up front. */
const densityBrief = (input) => {
  const ko = pageBand(input, "ko"),
    en = input?.language !== "ko" ? pageBand(input, "en") : null;
  if (!ko) return "";
  return ` 그림책 밀도가 목표예요: 한글 한 쪽 ${ko[0]}~${ko[1]}문장(보통 ${ko[2]}문장) — 그림이 말하는 쪽은 한 줄이나 소리 하나여도 돼요.${en ? ` 영어판은 쪽당 ${en[0]}~${en[1]}문장.` : ""}`;
};
/** The one-page brief. What it does not say is the point: no fear list, no page count, no shape, no name ban. */
export function roomBrief(input, { records = [] } = {}) {
  const ko = String(input?.specs?.ko?.id || "K2"),
    lang = input?.language === "ko" ? "한글" : input?.language === "en" ? "영어" : "한글과 영어",
    ending = customEnding(input),
    // The records when the caller has them (tests, runners); else what the marker froze.
    recent = list(records).length ? recentBookLines(records) : list(input?.writersRoom?.recent).map((r) => str(r?.line, 200)).filter(Boolean);
  return [
    `[이 책] 주제: ${str(input?.topic, 80) || "자유"} · ${lang} · ${LEVEL_LINE[ko] || LEVEL_LINE.K2}${input?.language !== "ko" ? " 영어는 한글을 따라 나중에 씁니다." : ""}`,
    `[꼭 나오는 인물 — 부모님이 골랐어요]\n${castText(input) || "- (없음)"}`,
    `[고른 장소] ${placeText(input) || "(없음)"} — 이야기가 원하면 다른 곳도 가요.`,
    ending ? `[끝] ${ending}` : "",
    // R55d: the value the parent chose in ①, passed on as the parent's wish — not a rule; nothing when none was chosen.
    str(input?.moral, 40) ? `[부모님이 아이와 함께 생각하고 싶은 것] ${str(input.moral, 40)} — 말로 가르치지 않고, 이야기 속 일과 행동에 스며들게.` : "",
    "[좋은 그림책이 하는 일] 쪽을 넘기고 싶게 해요. 웃음은 벌어지는 일에서 나와요. 어른에게도 제 바람과 결점이 있어요. 아이는 주인공보다 먼저 알아채기를 좋아해요. 끝은 처음과 하나가 달라요 — 마지막 줄은 뜻을 말하지 않고, 달라진 것은 행동 하나로 보여요. 이건 설명이지 점검표가 아니에요 — 더 좋은 길이 보이면 그리로 가요.",
    `[길이] 쪽수는 작가가 정해요. 이야기가 원하는 만큼.${openingsBrief(input)}${densityBrief(input)}`,
    recent.length ? `[이 집에서 최근에 만든 책 — 이것과 다르게]\n${recent.map((line) => `- ${line}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
/* ---------- round 1: premises ---------- */
const PREMISE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["premises"],
  properties: {
    premises: {
      type: "array",
      minItems: PREMISE_COUNT,
      maxItems: PREMISE_COUNT,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "line", "engine", "laugh", "picture", "cast"],
        properties: {
          title: { type: "string", maxLength: 40 },
          line: { type: "string", maxLength: 300 },
          engine: { type: "string", maxLength: 40 },
          laugh: { type: "string", maxLength: 200 },
          picture: { type: "string", maxLength: 200 },
          cast: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "isNew", "want", "flaw", "speech", "nameEn", "kind", "look"],
              properties: {
                name: { type: "string", maxLength: 30 },
                isNew: { type: "boolean" },
                want: { type: "string", maxLength: 100 },
                flaw: { type: "string", maxLength: 100 },
                speech: { type: "string", maxLength: 100 },
                // R54f: a new character's card for the drawer — "" for the parent's own characters.
                nameEn: { type: "string", maxLength: 30 },
                kind: { type: "string", maxLength: 24 },
                look: { type: "string", maxLength: 160 },
              },
            },
          },
        },
      },
    },
  },
};
export function premisesRequest(input, { records = [] } = {}) {
  const brief = roomBrief(input, { records });
  return {
    system: `너는 그림책 작가실의 작가예요. 아래 브리프로 서로 다른 이야기 전제 ${PREMISE_COUNT}개를 내요. 전제마다: 제목, 한 줄 줄거리(line), 이 이야기의 모양(engine — 아래 메뉴의 id 하나, 또는 네가 만든 모양 이름; 메뉴는 참고일 뿐 안 써도 돼요), 가장 큰 웃음 한 장면(laugh — 벌어지는 일로), 아이가 보고 싶어 할 그림 한 장(picture), 인물표(cast — 부모님이 고른 인물은 모두, 이 책에만 나오는 새 인물은 자유롭게; 각자 바람·결점·말투. 새 인물(isNew)에는 nameEn(영어 이름)·kind(child, adult, 또는 동물·존재의 영어 한 단어)·look(그림 시트용 생김새 한 줄, 영어 — 주인공과 견준 크기, 색 둘, 한눈에 알아볼 표시 하나(귀·무늬·모자 같은 것); 쪽마다 같은 인물로 그릴 수 있게)도 적어요; 부모님 인물은 셋 다 빈 문자열). ${PREMISE_COUNT}개는 모양도 웃음도 서로 달라야 해요. 안전한 것보다 아이가 깔깔 웃거나 "그래서?" 하고 매달릴 것을.\n\n[이야기 모양 메뉴 — 참고]\n${engineMenuText()}`,
    user: brief,
    jsonSchema: PREMISE_SCHEMA,
    temperature: 1,
    maxTokens: 9000,
  };
}
/* ---------- the deterministic sieve: unlike the last books ---------- */
const grams = (text) => {
  const s = str(text, 300).replace(/[^\p{L}\p{N}]/gu, "");
  const out = new Set();
  for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2));
  return out;
};
export function similarity(a, b) {
  const x = grams(a), y = grams(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const g of x) if (y.has(g)) both++;
  return both / (x.size + y.size - both);
}
/** Drops a premise whose engine and laugh both echo one of the last books; keeps the rest in order. */
export function sievePremises(premises, records = [], { count = 3, laughAlike = 0.5 } = {}) {
  // Records (usedElements) or the marker's rows ({engine, laugh}).
  const recent = list(records)
    .slice(0, count)
    .map((r) => (object(r?.usedElements) ? { engine: str(r.usedElements.engine, 40), laughs: list(r.usedElements.humor) } : { engine: str(r?.engine, 40), laughs: r?.laugh ? [r.laugh] : [] }));
  return list(premises).filter((p) => {
    if (!object(p)) return false;
    return !recent.some((r) => r.engine && r.engine === str(p.engine, 40) && r.laughs.some((l) => similarity(l, p.laugh) >= laughAlike));
  });
}
export const PANEL_IDS = Object.freeze(["action", "laugh", "heart", "eye", "ours", "parent"]);
/* ---------- round 2: the panel hears the premises ---------- */
const PICK_WHY = Object.freeze(["laugh", "curious", "again", "heart"]);
const PICKS = 3;
/**
 * R54e: the panel chooses instead of reacting. The A/B showed six "yes/no"
 * reactions landing on every premise alike (11 of 12 at the same count), so
 * the first premise won by the writer's order. Now each of the six names its
 * three, in order, with one reason each; nothing is said about the rest.
 */
const panelSchema = (count) => ({
  type: "object",
  additionalProperties: false,
  required: ["readers"],
  properties: {
    readers: {
      type: "array",
      minItems: PANEL_IDS.length,
      maxItems: PANEL_IDS.length,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["reader", "picks"],
        properties: {
          reader: { type: "string", enum: PANEL_IDS },
          picks: {
            type: "array",
            minItems: Math.min(PICKS, count),
            maxItems: Math.min(PICKS, count),
            items: {
              type: "object",
              additionalProperties: false,
              required: ["premise", "why", "word"],
              properties: { premise: { type: "integer", minimum: 1, maximum: count }, why: { type: "string", enum: PICK_WHY }, word: { type: "string", maxLength: 80 } },
            },
          },
        },
      },
    },
  },
});
export function panelPremisesRequest(input, premises) {
  const rows = list(premises).map((p, i) => `${i + 1}. ${str(p.title, 40)} — ${str(p.line, 300)} / 웃음: ${str(p.laugh, 200)} / 그림: ${str(p.picture, 200)}`).join("\n"),
    picks = Math.min(PICKS, list(premises).length);
  return {
    system: `너는 여섯 사람이에요. 각자 아래 이야기 전제를 듣고 **${picks}개만** 골라요 — 1순위부터 차례로. 고른 까닭은 하나만: laugh(웃길 것 같다) / curious(다음이 궁금하다) / again(또 듣고 싶을 것 같다) / heart(마음이 간다), 그리고 한마디(word). 고르지 않은 전제에는 아무 말도 하지 않아요. 여섯 사람이 같은 셋을 고르면 안 돼요 — 각자 제 식대로. 점수가 아니라 고름이에요. 예의 차리지 말고 그 사람답게. 아이는 뻔한 것에 안 웃고 모르는 것에 금방 흥미를 잃어요.\n\n[여섯 사람]\n${panelText(input)}`,
    user: rows,
    jsonSchema: panelSchema(list(premises).length),
    temperature: 0.7,
    maxTokens: 4000,
  };
}
/** Counts, never scores: a first pick is 3, a second 2, a third 1 (pull); the reasons are kept as counts; ties keep the writer's order. */
export function countReactions(answer, count = PREMISE_COUNT) {
  const readers = list(object(answer) && !Array.isArray(answer) ? answer.readers : answer).filter(object),
    rows = new Map();
  const row = (n) => {
    if (!rows.has(n)) rows.set(n, { premise: n, laughed: 0, curious: 0, lost: 0, again: 0, heart: 0, picks: 0, pull: 0, words: [] });
    return rows.get(n);
  };
  for (const reader of readers) {
    const id = PANEL_IDS.includes(reader.reader) ? reader.reader : "?",
      picks = list(reader.picks).filter(object).slice(0, PICKS),
      seen = new Set();
    picks.forEach((pick, rank) => {
      const n = Math.round(Number(pick.premise));
      if (!(n >= 1 && n <= count) || seen.has(n)) return;
      seen.add(n);
      const r = row(n);
      r.picks += 1;
      r.pull += PICKS - rank;
      if (pick.why === "laugh") r.laughed += 1;
      else if (pick.why === "curious") r.curious += 1;
      else if (pick.why === "again") r.again += 1;
      else if (pick.why === "heart") r.heart += 1;
      if (str(pick.word, 80)) r.words.push(`${id}: ${str(pick.word, 80)}`);
    });
  }
  return [...rows.values()].sort((a, b) => a.premise - b.premise);
}
export function pickPremises(rows, count = SHORTLIST) {
  return [...list(rows)].sort((a, b) => b.pull - a.pull || b.again - a.again || a.premise - b.premise).slice(0, count).map((row) => row.premise);
}
/* ---------- round 3: a whole draft per premise ---------- */
const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "pages"],
  properties: {
    title: { type: "string", maxLength: 40 },
    // R54e: spread — this page is one big picture across both halves (an openings book binds it alone).
    pages: { type: "array", minItems: 4, maxItems: 40, items: { type: "object", additionalProperties: false, required: ["ko"], properties: { ko: { type: "string", maxLength: 1200 }, spread: { type: "boolean" } } } },
  },
};
/** R54e: an openings book — the writer marks the pages that are one big picture. */
const spreadLine = (input) => (input?.layoutPolicy?.kind === "openings" ? " 큰 그림 한 장이 두 쪽에 걸쳐 맡는 순간은 그 쪽에 spread: true를 적어요(책에 두세 번쯤; 나머지는 적지 않아요)." : "");
const castRows = (premise) => list(premise?.cast).map((c) => `- ${str(c.name, 30)}${c.isNew ? " (이 책의 새 인물)" : ""}: 바람 — ${str(c.want, 100)}; 결점 — ${str(c.flaw, 100)}; 말투 — ${str(c.speech, 100)}`).join("\n");
export function draftRequest(input, premise, { records = [] } = {}) {
  return {
    system: `너는 그림책 작가예요. 아래 전제로 책 한 권을 한글로 통째로 써요 — 쪽 단위로, 쪽마다 그 쪽의 글(ko). 쪽수는 네가 정해요. 비트도 설계도 없어요: 쪽을 넘기는 호흡은 네 몫이에요. 그림이 말할 쪽은 글이 짧고, 글이 끌어야 하는 쪽은 조금 길어요. 인물표의 말투대로 말해요. 화자는 자유예요 — 이야기꾼이 들려줘도, 주인공이 '나'로 말해도, 조연이나 사물이 말해도, 읽는 아이에게 말을 걸어도 돼요; 이 이야기에 맞는 목소리로. 제목(title)도 정해요 — 이 초고만의 제목으로(전제 제목과 달라도 돼요).${spreadLine(input)}`,
    user: `${roomBrief(input, { records })}\n\n[전제]\n${str(premise?.title, 40)} — ${str(premise?.line, 300)}\n모양: ${str(premise?.engine, 40)}\n가장 큰 웃음: ${str(premise?.laugh, 200)}\n아이가 보고 싶을 그림: ${str(premise?.picture, 200)}\n\n[인물표]\n${castRows(premise)}`,
    jsonSchema: DRAFT_SCHEMA,
    temperature: 0.9,
    maxTokens: 8000,
  };
}
/* ---------- round 4: the panel reads the drafts page by page ---------- */
/**
 * R54e: each reader names the one draft to read again, and for every draft the
 * page to skip, the page nobody could follow (0 when none) and the pages that
 * made them laugh — choices, not a yes/no per page (the A/B had every draft at
 * the same "curious 18, lost 0").
 */
const readSchema = (count) => ({
  type: "object",
  additionalProperties: false,
  required: ["readers"],
  properties: {
    readers: {
      type: "array",
      minItems: PANEL_IDS.length,
      maxItems: PANEL_IDS.length,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["reader", "favorite", "again", "drafts"],
        properties: {
          reader: { type: "string", enum: PANEL_IDS },
          favorite: { type: "integer", minimum: 1, maximum: count },
          again: { type: "boolean" },
          drafts: {
            type: "array",
            minItems: count,
            maxItems: count,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["draft", "skipPage", "lostPage", "laughPages", "change", "hardPage", "mannersPage"],
              properties: {
                draft: { type: "integer", minimum: 1, maximum: count },
                skipPage: { type: "integer", minimum: 1 },
                lostPage: { type: "integer", minimum: 0 },
                laughPages: { type: "array", maxItems: 12, items: { type: "integer", minimum: 1 } },
                // R54g: one concrete thing to change (the A/B's one-word remarks were all praise — nothing to rewrite from).
                change: { type: "string", maxLength: 160 },
                // R55d: the adult reader only — a page hard to read aloud, a page whose speech level is wrong (0 = none; children answer 0).
                hardPage: { type: "integer", minimum: 0 },
                mannersPage: { type: "integer", minimum: 0 },
              },
            },
          },
        },
      },
    },
  },
});
const draftText = (draft, i) => `=== 초고 ${i + 1} · ${str(draft?.title, 40)} ===\n${list(draft?.pages).map((p, n) => `${n + 1}쪽: ${str(p?.ko, 1200)}`).join("\n")}`;
export function panelReadRequest(input, drafts) {
  return {
    system: `너는 여섯 사람이에요. 아래 초고를 한 쪽씩 읽어 주는 자리에 있어요. 각자 **다시 읽고 싶은 초고 하나**(favorite)를 고르고, 그 초고를 또 읽어 달라고 할지(again) 말해요. 초고마다: 가장 넘기고 싶은 쪽 하나(skipPage, 꼭 하나), 무슨 말인지 몰랐던 쪽(lostPage, 없으면 0), 웃은 쪽들(laughPages, 없으면 빈 목록), 그 초고에서 **바꾸고 싶은 것 하나**(change — 어느 쪽의 무엇을 어떻게, 한 문장; 정말 없으면 빈 문자열. 칭찬은 쓰지 않아요). 읽어 주는 어른(parent)만 둘을 더 말해요: 소리 내어 읽기 힘든 쪽 하나(hardPage — 입에 안 붙거나 숨이 차는 쪽, 없으면 0)와 존댓말·반말이 어색한 쪽 하나(mannersPage — 누가 누구에게 하는 말인지에 안 맞는 쪽, 없으면 0); 아이들은 둘 다 0. 여섯 사람이 같은 초고를 고를 수도 있지만 까닭은 각자 제 식대로. 점수는 없어요. 예의 차리지 말고 그 사람답게.\n\n[여섯 사람]\n${panelText(input)}`,
    user: list(drafts).map(draftText).join("\n\n"),
    jsonSchema: readSchema(list(drafts).length),
    temperature: 0.7,
    maxTokens: 6000,
  };
}
/** Per draft: favourites × 4 + again × 2 + laughs − skipped pages (named by two) − lost pages (named by one); ties keep the writer's order. */
export function countReadings(answer, count = DRAFT_COUNT) {
  const readers = list(object(answer) && !Array.isArray(answer) ? answer.readers : answer).filter(object),
    rows = new Map(),
    row = (n) => {
      if (!rows.has(n)) rows.set(n, { draft: n, votes: 0, again: 0, laughed: 0, curious: 0, bored: 0, lost: 0, pull: 0, skip: new Map(), lostAt: new Map(), laughAt: new Map(), hardAt: new Map(), mannersAt: new Map(), words: [] });
      return rows.get(n);
    },
    bump = (map, page) => map.set(page, (map.get(page) || 0) + 1);
  for (const reader of readers) {
    const fav = Math.round(Number(reader.favorite));
    if (fav >= 1 && fav <= count) {
      const r = row(fav);
      r.votes += 1;
      r.curious += 1;
      if (reader.again === true) r.again += 1;
    }
    for (const d of list(reader.drafts).filter(object)) {
      const n = Math.round(Number(d.draft));
      if (!(n >= 1 && n <= count)) continue;
      const r = row(n),
        skip = Math.round(Number(d.skipPage)),
        lost = Math.round(Number(d.lostPage));
      if (skip >= 1) {
        bump(r.skip, skip);
        r.bored += 1;
      }
      if (lost >= 1) {
        bump(r.lostAt, lost);
        r.lost += 1;
      }
      for (const page of list(d.laughPages).map((p) => Math.round(Number(p))).filter((p) => p >= 1)) {
        bump(r.laughAt, page);
        r.laughed += 1;
      }
      // R55d: the adult's two pages (0 or absent = none; an answer saved before R55d has neither).
      const hard = Math.round(Number(d.hardPage)),
        manners = Math.round(Number(d.mannersPage));
      if (hard >= 1) bump(r.hardAt, hard);
      if (manners >= 1) bump(r.mannersAt, manners);
      // R54g: `change` (one thing to change); `word` is read too for an answer saved before R54g.
      if (str(d.change ?? d.word, 160)) r.words.push(str(d.change ?? d.word, 160));
    }
  }
  return Array.from({ length: count }, (_, i) => row(i + 1))
    .map((r) => {
      const boredPages = [...r.skip].filter(([, n]) => n >= 2).map(([p]) => p).sort((a, b) => a - b),
        lostPages = [...r.lostAt].map(([p]) => p).sort((a, b) => a - b),
        laughPages = [...r.laughAt].filter(([, n]) => n >= 2).map(([p]) => p).sort((a, b) => a - b),
        hardPages = [...r.hardAt].map(([p]) => p).sort((a, b) => a - b),
        mannersPages = [...r.mannersAt].map(([p]) => p).sort((a, b) => a - b);
      // The pull is unchanged by R55d: the adult's two pages steer the rewrite, not the choice of draft.
      return { draft: r.draft, votes: r.votes, again: r.again, laughed: r.laughed, curious: r.curious, bored: r.bored, lost: r.lost, pull: r.votes * 4 + r.again * 2 + laughPages.length - boredPages.length - lostPages.length, boredPages, lostPages, laughPages, hardPages, mannersPages, words: r.words };
    });
}
export function pickDraft(rows) {
  return [...list(rows)].sort((a, b) => b.pull - a.pull || b.again - a.again || a.draft - b.draft)[0]?.draft || 1;
}
/** What the writer hears before rewriting: the pages that dragged, the pages nobody could explain, the pages that landed. */
export function rewriteNotes(row) {
  if (!object(row)) return "";
  const lines = [];
  if (row.boredPages?.length) lines.push(`넘기고 싶어한 쪽: ${row.boredPages.join(", ")} — 줄이거나 사건을 넣어요.`);
  if (row.lostPages?.length) lines.push(`무슨 말인지 모른 쪽: ${row.lostPages.join(", ")} — 아이가 따라올 수 있게 보여 줘요.`);
  // R55d: what the adult who reads aloud hit.
  if (row.hardPages?.length) lines.push(`소리 내어 읽기 힘든 쪽: ${row.hardPages.join(", ")} — 입에 붙게 다듬어요(뜻은 그대로).`);
  if (row.mannersPages?.length) lines.push(`존댓말·반말이 어색한 쪽: ${row.mannersPages.join(", ")} — 누가 누구에게 하는 말인지에 맞게 말높임만 고쳐요.`);
  if (row.laughPages?.length) lines.push(`웃은 쪽: ${row.laughPages.join(", ")} — 숨 쉴 자리를 주고 건드리지 않아요.`);
  if (row.words?.length) lines.push(`바꾸고 싶은 것: ${row.words.join(" / ")}`);
  return lines.join("\n");
}
export function rewriteRequest(input, draft, notes, { records = [] } = {}) {
  return {
    // R54g: targeted — the A/B's astra rewrote all 14 pages (7% of the words kept) of the draft the panel had chosen.
    system: "너는 이 책을 쓴 작가예요. 독자 여섯 사람이 한 쪽씩 읽는 자리에 있었고, 아래는 그들의 반응이에요. 독자단이 이 초고를 골랐으니 책은 이대로 살려요: 반응이 가리킨 쪽(넘기고 싶어한 쪽·모른 쪽·읽기 힘든 쪽·말높임이 어색한 쪽·바꾸고 싶은 것)과 그 앞뒤 한 쪽만 손대고, 웃은 쪽은 글자 하나 바꾸지 않고, 나머지 쪽도 바꿀 까닭이 없으면 그대로 돌려줘요. 손대는 쪽에서는 합치거나 나누거나 빼거나 더해도 돼요. 분량은 늘리지 않아요 — 그림책이에요. 제목은 다시 정해도 돼요. 큰 그림 한 장이 맡는 쪽의 spread: true 표시는 그대로 두거나 새로 정해요.",
    // The notes keep their lines (str() would fold them into one).
    user: `${roomBrief(input, { records })}\n\n[독자 반응]\n${String(notes ?? "").trim().slice(0, 2000) || "(없음)"}\n\n=== 초고 · ${str(draft?.title, 40)} ===\n${list(draft?.pages).map((p, n) => `${n + 1}쪽: ${str(p?.ko, 1200)}`).join("\n")}`,
    jsonSchema: DRAFT_SCHEMA,
    temperature: 0.8,
    maxTokens: 8000,
  };
}

/* ---------- R51: the room runs (premises → the panel → the parent) ---------- */
const clone = (value) => JSON.parse(JSON.stringify(value));
/** The parent's setting (off until R53 turns it on by default) → the marker a new draft freezes, or null. */
export function writersRoomFor(state, records = []) {
  // R54c: on by default — the parent's switch stores only `false` (R51–R55a stored `true`; still read as on).
  return state?.settings?.textGeneration?.writersRoom === false ? null : writersRoomPolicy(records);
}
/** R54c: the parent's switch as the settings keep it: off only when `false` is stored. */
export const writersRoomOn = (settings) => settings?.writersRoom !== false;
/**
 * R54c diversity line (free, deterministic): over the family's recent room
 * books — how many story engines, laughs, new companions and places they used.
 * One line for the shelf; empty with no room book. A repeated engine among the
 * last four is named so the parent sees the room leaning on one shape.
 */
export function roomDiversityLine(records = [], count = 8) {
  const rows = list(records).filter((r) => r?.usedElements?.engine || r?.outline?.writersRoom?.premise).slice(0, count);
  if (!rows.length) return "";
  const engines = rows.map((r) => str(r.usedElements?.engine || r.outline?.writersRoom?.premise?.engine, 40)).filter(Boolean),
    laughs = new Set(rows.flatMap((r) => list(r.usedElements?.humor).map((h) => str(h, 120)).filter(Boolean))),
    places = new Set(rows.flatMap((r) => list(r.usedElements?.places).map((p) => str(p, 60)).filter(Boolean))),
    newCast = rows.reduce((n, r) => n + list(r.outline?.writersRoom?.premise?.cast).filter((c) => c?.isNew).length, 0),
    recent = engines.slice(0, 4),
    repeated = recent.find((e, i) => recent.indexOf(e) !== i),
    name = repeated ? ENGINE_MENU.find((e) => e.id === repeated)?.name || repeated : "";
  return `최근 작가실 책 ${rows.length}권 · 이야기 장치 ${new Set(engines).size}가지 · 웃음 ${laughs.size}가지 · 새 인물 ${newCast}명 · 장소 ${places.size}곳${name ? ` · 최근 넉 권에 '${name}'이 두 번` : ""}`;
}
const ROOM_PROGRESS = Object.freeze({
  premises: "작가실 · 작가가 이야기 전제 열두 개를 내고 있어요. 보통 2~3분 걸려요.",
  panel: "작가실 · 독자 여섯이 전제를 듣고 있어요.",
  review: "작가실 · 독자단이 고른 셋 중 하나를 골라 주세요.",
  done: "작가실이 전제를 정했어요. 줄거리를 씁니다.",
});
const roomError = (message) => new StoryValidationError("council", [message]);
/** A shortlisted premise as the review screen and the summary read it (a pitch-shaped row). */
const asPitch = (premise, n, row) => ({
  premise: n,
  title: str(premise?.title, 40) || `전제 ${n}`,
  logline: str(premise?.line, 300),
  engine: str(premise?.engine, 40),
  laugh: str(premise?.laugh, 200),
  picture: str(premise?.picture, 200),
  cast: list(premise?.cast).filter(object).map((c) => ({ name: str(c.name, 30), isNew: c.isNew === true, want: str(c.want, 100), flaw: str(c.flaw, 100), speech: str(c.speech, 100), ...(c.isNew === true && str(c.look, 160) ? { nameEn: str(c.nameEn, 30), kind: str(c.kind, 24), look: str(c.look, 160) } : {}) })),
  ...(row ? { pull: row.pull, laughed: row.laughed, curious: row.curious, again: row.again, lost: row.lost, words: row.words } : {}),
});
/**
 * The room's first half: premises (the author — the "outline" role, the
 * parent's 상위 model), the panel's reactions (the cheap model), the deterministic shortlist, then the parent's choice — a
 * hold like R22's when options.councilHold is on and no choice is given yet.
 * Every paid answer is journaled in options.councilCheckpoint, so a resumed
 * run replays the rounds and buys nothing again.
 */
export async function runWritersRoom(input, options = {}, services = {}) {
  const journal = ledger("writersRoom", input, options, { version: WRITERS_ROOM_VERSION }, "councilCheckpoint");
  const records = list(options.roomRecords);
  const record = {
    kind: "writersRoom",
    version: WRITERS_ROOM_VERSION,
    phase: "premises",
    brief: roomBrief(input, { records }),
    panel: readerPanel(input).map((p) => ({ id: p.id, name: p.name })),
    premises: [],
    dropped: 0,
    rows: [],
    shortlist: [],
    pitches: [],
    recommended: null,
    parentChoice: null,
    chosen: null,
    premise: null,
    decisions: [],
  };
  const log = (entry) => appendDecision(record, entry);
  const hold = options.councilHold === true;
  const snapshot = async (phase, message) => {
    record.phase = phase;
    journal.checkpoint.record = clone(record);
    await journal.save();
    options.onProgress?.({ stage: "council", phase, message, council: clone(record) });
  };
  const ask = async (label, request, role) => {
    const response = await journal.call(role, request, services);
    const data = response?.json !== undefined ? response.json : parseJsonLenient(String(response?.text || ""));
    if (!object(data)) throw journal.fail(roomError(`${label}의 답을 읽을 수 없어요.`));
    return data;
  };
  try {
    await snapshot("premises", ROOM_PROGRESS.premises);
    const proposed = await ask("작가", premisesRequest(input, { records }), "outline");
    const all = list(proposed.premises).filter(object).slice(0, PREMISE_COUNT);
    if (!all.length) throw journal.fail(roomError("작가가 쓸 수 있는 전제를 내지 못했어요."));
    const kept = sievePremises(all, records.length ? records : list(input.writersRoom?.recent));
    const premises = kept.length ? kept : all;
    record.premises = premises;
    record.dropped = all.length - premises.length;
    log({ by: "작가", kind: "proposed", what: `전제 ${all.length}개: ${all.map((p) => str(p.title, 24)).join(" / ")}`, why: record.dropped ? `최근 책과 모양·웃음이 닮은 ${record.dropped}개는 뺌` : "브리프 한 쪽으로" });
    await snapshot("panel", ROOM_PROGRESS.panel);
    const heard = await ask("독자단", panelPremisesRequest(input, premises), "cheap");
    const rows = countReactions(heard, premises.length);
    record.rows = rows;
    const shortlist = pickPremises(rows, Math.min(SHORTLIST, premises.length));
    record.shortlist = shortlist;
    record.pitches = shortlist.map((n, i) => asPitch(premises[n - 1], i + 1, rows.find((row) => row.premise === n)));
    record.recommended = 1;
    log({ by: "독자단", kind: "reviewed", what: `셋을 고름: ${record.pitches.map((p) => `'${p.title}' (웃음 ${p.laughed ?? 0}·궁금 ${p.curious ?? 0}·또 ${p.again ?? 0})`).join(" / ")}`, why: "웃음+궁금+또−모름을 셈 — 점수가 아니라 반응" });
    const choice = normalizeCouncilChoice(options.councilChoice, record.pitches.length);
    if (hold && !choice) {
      await snapshot("review", ROOM_PROGRESS.review);
      throw councilHoldError();
    }
    const pick = choice?.pick || 1;
    record.chosen = pick;
    record.premise = clone(premises[shortlist[pick - 1] - 1]);
    if (choice) record.parentChoice = { pick, note: choice.note };
    log({ by: choice ? "부모" : "작가실", kind: "adopted", what: `'${record.pitches[pick - 1]?.title}'`, why: choice ? (pick === 1 ? "독자단이 가장 끌린 것을 확인" : "독자단의 첫 추천 대신 고름") : "부모 확인 없이 독자단이 가장 끌린 것으로" });
    if (choice?.note) log({ by: "부모", kind: "revised", what: `한마디: ${choice.note}`, why: "작가가 줄거리에 반영" });
    await snapshot("done", ROOM_PROGRESS.done);
    return { record, usage: journal.usage(), meta: { ...journal.summary(), stage: "council" } };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw journal.fail(error, error?.name === "CouncilHold" ? { held: true } : {});
  }
}
/** The outline carries the room's record (the premise binds the outline request; no bible). */
export function attachWritersRoom(outline, result) {
  if (!object(outline) || !object(result?.record)) return outline;
  outline.writersRoom = clone(result.record);
  return outline;
}
/** R51 bridge: the chosen premise as the outline request's pitch (R52 writes whole drafts from it instead). */
export function roomPremiseBlock(record, input) {
  const p = record?.premise;
  if (!object(p)) return "";
  const cast = list(p.cast).filter(object).map((c) => `${str(c.name, 30)}${c.isNew ? " (new to this book)" : ""}: wants ${str(c.want, 100)}; flaw ${str(c.flaw, 100)}; speaks ${str(c.speech, 100)}`).join(" / ");
  const note = str(record?.parentChoice?.note, 300);
  return `THE WRITERS' ROOM CHOSE THIS PREMISE — write the outline from it, in your own way:
Title "${str(p.title, 40)}". ${str(p.line, 300)}
Shape: ${engineById(p.engine)?.line || str(p.engine, 40) || "the writer's own"}. The biggest laugh: ${str(p.laugh, 200)}. The picture a child wants to see: ${str(p.picture, 200)}.${cast ? `\nCast: ${cast}. A character new to this book is fine; the parent's chosen characters all appear.` : ""}${note ? `\nThe parent's note — keep it: ${note}` : ""}`;
}
/** The ③ summary line for a finished room (parallel to councilSummaryLine). */
export function roomSummaryLine(outline) {
  const r = outline?.writersRoom;
  if (!object(r) || !r.chosen) return "";
  const p = r.pitches?.[r.chosen - 1];
  return `작가실 · '${str(p?.title, 40)}' (전제 ${list(r.premises).length}개 중 독자단이 셋을 골라${r.parentChoice ? " 부모가" : ""} 채택)`;
}

/* ---------- R52: whole drafts → the panel reads → rewrite → finishing ---------- */
const DRAFT_COUNT = 3;
const pageRows = (draft) => list(draft?.pages).filter(object).map((p) => ({ ko: str(p.ko, 1200), ...(p.spread === true ? { spread: true } : {}) })).filter((p) => p.ko);
const normalizeDraft = (raw, fallbackTitle = "") => {
  const pages = pageRows(raw);
  return pages.length ? { title: str(raw?.title, 40) || fallbackTitle, pages } : null;
};
const numbered = (pages, key = "ko") => list(pages).map((p, i) => `${i + 1}쪽: ${str(p?.[key], 1200)}`).join("\n");
/**
 * The English edition, written after the Korean is final (the parent, 11-03:
 * "write the Korean first, then the English as its translation, and let us
 * choose the edition"): page by page, the same events, the same lines, at the
 * English level; it may say less, never something else.
 */
/** R54e: the A/B's English ran at the Korean's length (E2 page band 1–2) and called the boy "she". */
const englishBandLine = (input) => {
  const band = pageBand(input, "en");
  return band ? ` A page is ${band[0]}–${band[1]} sentences (usually ${band[2]}): keep the event and the spoken line, drop the rest.` : "";
};
const englishCastLine = (input) => {
  const rows = castSheet(input)
    .filter((c) => c.gender)
    .map((c) => `${c.name}${c.nameEn ? ` (${c.nameEn})` : ""} — ${c.gender}, ${/^(boy|man)$/u.test(c.gender) ? "he" : "she"}`);
  return rows.length ? `[cast] ${rows.join("; ")}\n\n` : "";
};
export function englishRequest(input, pages) {
  const count = list(pages).length;
  return {
    system: `You are a picture-book author writing the English edition of a finished Korean picture book, page by page. ${leanLevelLine(input, "en", { vocab: true })} Each page's English follows that page's Korean: the same events in the same order, the same spoken lines in plain English, the same surprise kept for the same page; it may say less when the level needs it, never something else.${englishBandLine(input)} One idea per sentence; no semicolons. Return exactly ${count} pages in order.`,
    user: `${englishCastLine(input)}${numbered(pages)}`,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["pages"],
      properties: { pages: { type: "array", minItems: count, maxItems: count, items: { type: "object", additionalProperties: false, required: ["en"], properties: { en: { type: "string", maxLength: 1200 } } } } },
    },
    temperature: 0.4,
    maxTokens: 6000,
  };
}
/** The level notes a page failed (deterministic, from the checker), as the writer hears them. */
export function levelNotes(outline, pages, input) {
  let report;
  try {
    report = checkStory(outline, list(pages).map((p, i) => ({ pageNo: i + 1, ko: p.ko, en: p.en || "" })), {
      specs: input?.specs,
      allowedNames: [...list(input?.characters).flatMap((c) => [c?.name, c?.nameEn]), ...list(outline?.writersRoom?.premise?.cast).map((c) => c?.name)].filter(Boolean),
      storyInput: input,
    });
  } catch {
    return [];
  }
  return list(report?.checks)
    .flatMap((check) => list(check?.violations))
    .filter((v) => object(v) && v.pageNo != null && (v.language === "ko" || v.language === "en"))
    .map((v) => ({ pageNo: Number(v.pageNo), language: v.language, message: str(v.message, 200) }))
    .filter((v) => v.pageNo && v.message)
    .slice(0, 40);
}
/** One polish: the pages the level notes name, rewritten within the level; every other page returned as it is. */
export function polishRequest(input, pages, notes) {
  const count = list(pages).length,
    both = list(pages).some((p) => p.en);
  const lines = list(notes).map((n) => `${n.pageNo}쪽 (${n.language === "en" ? "영어" : "한글"}): ${n.message}`).join("\n");
  return {
    system: `너는 이 책을 쓴 작가예요. 아래는 쪽마다 읽기 등급 검사가 남긴 참고예요. 그 쪽만 등급 안에서 다시 쓰고(이야기·대사·웃음은 그대로), 나머지 쪽은 글자 하나 바꾸지 않고 그대로 돌려줘요. ${both ? "영어가 있으면 영어도 그 쪽의 한글을 따라 함께 돌려줘요. " : ""}쪽 수는 ${count}쪽 그대로예요.\n${leanLevelLine(input, "ko")}${both ? `\n${leanLevelLine(input, "en", { vocab: true })}` : ""}`,
    user: `[등급 참고]\n${lines || "(없음)"}\n\n[책]\n${list(pages).map((p, i) => `${i + 1}쪽: ${str(p.ko, 1200)}${p.en ? `\n   EN: ${str(p.en, 1200)}` : ""}`).join("\n")}`,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["pages"],
      properties: { pages: { type: "array", minItems: count, maxItems: count, items: { type: "object", additionalProperties: false, required: both ? ["ko", "en"] : ["ko"], properties: { ko: { type: "string", maxLength: 1200 }, ...(both ? { en: { type: "string", maxLength: 1200 } } : {}) } } } },
    },
    temperature: 0.3,
    maxTokens: 8000,
  };
}
const DRAFT_PROGRESS = Object.freeze({
  drafts: "작가실 · 작가가 초고 세 권을 통째로 쓰고 있어요.",
  read: "작가실 · 독자 여섯이 초고를 한 쪽씩 읽고 있어요.",
  rewrite: "작가실 · 작가가 독자 반응을 받아 고쳐 쓰고 있어요.",
  english: "작가실 · 완성된 한글을 따라 영어판을 쓰고 있어요.",
  polish: "작가실 · 등급 검사가 남긴 쪽만 다듬고 있어요.",
  done: "작가실이 책을 다 썼어요.",
});
/**
 * The room's second half, from the chosen premise: three whole drafts (the top
 * model, in parallel), the panel's page-by-page reading (the cheap model), the
 * counted pick, one rewrite on the readers' notes, the English edition, and
 * one polish of the pages the level checker names (advisory — never a loop).
 * Journaled under writerCheckpoint; a resumed run replays and buys nothing.
 */
/* ---------- R54g: the room's deterministic guards around the writer's second and third passes ---------- */
const flat = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();
/** How much a rewrite changed, measured (never the model's word): pages kept as they were, pages changed, the count before and after. */
export function rewriteChange(before, after) {
  const prev = list(before).map((p) => flat(p?.ko)), next = list(after).map((p) => flat(p?.ko));
  const have = new Set(prev);
  const kept = next.filter((t) => have.has(t)).length;
  return { before: prev.length, after: next.length, kept, changed: next.length - kept, share: next.length ? Math.round(((next.length - kept) / next.length) * 100) / 100 : 0 };
}
/** The panel named nothing to fix (no page to skip, none lost, nothing to change): the rewrite call is skipped. */
export const nothingToRewrite = (row) => object(row) && !list(row.boredPages).length && !list(row.lostPages).length && !list(row.hardPages).length && !list(row.mannersPages).length && !list(row.words).some((w) => str(w, 160));
export async function runRoomDrafts(input, outline, options = {}, services = {}) {
  services = withEngines(services);
  const premise = outline?.writersRoom?.premise;
  if (!object(premise)) throw new StoryValidationError("prose", ["작가실이 고른 전제가 없어요. 줄거리 단계부터 다시 만들어 주세요."]);
  const journal = ledger("roomDrafts", input, options, { version: WRITERS_ROOM_VERSION, premise }, "writerCheckpoint");
  const count = Math.max(1, Math.min(DRAFT_COUNT, Number(options.roomDraftCount) || DRAFT_COUNT));
  const record = { kind: "roomDrafts", version: WRITERS_ROOM_VERSION, phase: "drafts", drafts: [], rows: [], chosen: null, notes: "", rewritten: false, rewriteSkipped: false, rewriteChange: null, english: false, levelNotes: [], polished: false, levelNotesAfter: [] };
  const snapshot = async (phase) => {
    record.phase = phase;
    journal.checkpoint.record = clone(record);
    await journal.save();
    options.onProgress?.({ stage: "roomDrafts", phase, message: DRAFT_PROGRESS[phase], room: clone(record) });
  };
  const ask = async (label, request, role) => {
    const response = await journal.call(role, request, services);
    const data = response?.json !== undefined ? response.json : parseJsonLenient(String(response?.text || ""));
    if (!object(data)) throw journal.fail(roomError(`${label}의 답을 읽을 수 없어요.`));
    return data;
  };
  try {
    await snapshot("drafts");
    const base = draftRequest(input, premise);
    const drafts = (
      await Promise.all(
        Array.from({ length: count }, (_, i) =>
          ask(`초고 ${i + 1}`, { ...base, user: `${base.user}\n\n[초고 ${i + 1}/${count} — 다른 초고와 다르게, 네 식대로]` }, "outline").then((raw) => normalizeDraft(raw, `${str(premise.title, 40)} ${i + 1}`)),
        ),
      )
    ).filter(Boolean);
    if (!drafts.length) throw journal.fail(roomError("작가가 쓸 수 있는 초고를 내지 못했어요."));
    record.drafts = drafts.map((d) => ({ title: d.title, pages: d.pages.length }));
    let pick = 1,
      chosen = drafts[0];
    if (drafts.length > 1) {
      await snapshot("read");
      const read = await ask("독자단", panelReadRequest(input, drafts), "cheap");
      const rows = countReadings(read, drafts.length);
      record.rows = rows;
      pick = Math.min(drafts.length, pickDraft(rows));
      chosen = drafts[pick - 1];
      record.notes = rewriteNotes(rows.find((row) => row.draft === pick));
    }
    record.chosen = pick;
    let pages = chosen.pages,
      title = chosen.title;
    // R54g: no page to skip, none lost, nothing to change → the panel's pick stands as written (one upper call saved).
    if (options.roomRewrite !== false && drafts.length > 1 && nothingToRewrite(record.rows.find((row) => row.draft === pick))) record.rewriteSkipped = true;
    if (options.roomRewrite !== false && drafts.length > 1 && !record.rewriteSkipped) {
      await snapshot("rewrite");
      const again = normalizeDraft(await ask("고쳐쓰기", rewriteRequest(input, chosen, record.notes), "outline"), title);
      if (again) {
        pages = again.pages;
        title = again.title;
        record.rewritten = true;
        record.rewriteChange = rewriteChange(chosen.pages, pages);
      }
    }
    if (input?.language !== "ko") {
      await snapshot("english");
      const en = await ask("영어판", englishRequest(input, pages), "outline");
      const rows = list(en.pages).map((p) => str(p?.en, 1200));
      if (rows.length === pages.length) {
        pages = pages.map((p, i) => ({ ...p, en: rows[i] }));
        record.english = true;
      }
    }
    record.levelNotes = levelNotes(outline, pages, input);
    if (record.levelNotes.length && options.roomPolish !== false) {
      await snapshot("polish");
      const polished = await ask("다듬기", polishRequest(input, pages, record.levelNotes), "outline");
      const rows = list(polished.pages).filter(object);
      if (rows.length === pages.length) {
        pages = pages.map((p, i) => ({ ...(p.spread ? { spread: true } : {}), ko: str(rows[i].ko, 1200) || p.ko, ...(p.en !== undefined ? { en: str(rows[i].en, 1200) || p.en } : {}) }));
        record.polished = true;
        record.levelNotesAfter = levelNotes(outline, pages, input);
      }
    }
    await snapshot("done");
    return {
      data: { title, language: record.english ? "dual" : "ko", pages: pages.map((p, i) => ({ pageNo: i + 1, ko: p.ko, ...(p.en !== undefined ? { en: p.en } : {}), ...(p.spread ? { spread: true } : {}) })), room: clone(record) },
      usage: journal.usage(),
      meta: { ...journal.summary(), stage: "roomDrafts" },
    };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw journal.fail(error);
  }
}
/** The ③ line for a finished room draft. */
export function roomDraftLine(draft) {
  const r = draft?.room;
  if (!object(r) || !r.chosen) return "";
  const notes = list(r.levelNotes).length;
  const change = r.rewriteChange;
  return `작가실 · 초고 ${list(r.drafts).length}권 중 독자단이 ${r.chosen}번을 골라${r.rewritten ? ` 고쳐 쓰고${change ? `(${change.after}쪽 중 ${change.changed}쪽 손봄)` : ""}` : r.rewriteSkipped ? " 고칠 곳이 없어 그대로 두고" : ""}${r.english ? " 영어판을 쓰고" : ""}${notes ? ` 등급 참고 ${notes}건 중 ${r.polished ? `다듬어 ${list(r.levelNotesAfter).length}건 남음` : "다듬지 않음"}` : " 등급 참고 없음"} · ${list(draft.pages).length}쪽`;
}

/* ---------- R53: the finished text becomes the pages the pictures and prints read ---------- */
/** The app's bindings (its beat tables and prints): a page book has 8, 12, 16 or 24 pages. */
export const PAGE_COUNTS = Object.freeze([8, 12, 16, 24]);
const nearestCount = (n) => PAGE_COUNTS.reduce((best, c) => (Math.abs(c - n) < Math.abs(best - n) || (Math.abs(c - n) === Math.abs(best - n) && c > best) ? c : best), PAGE_COUNTS[0]);
const TIMES = ["morning", "day", "afternoon", "evening", "night"];
/** Sentences of a page, for a split (Korean/English end marks, quotes kept with their sentence). */
const sentences = (value) =>
  String(value ?? "")
    .split(/(?<=[.!?。！？…][”"’']?)\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
/**
 * The binding's one physical fact, applied silently: a book has 8, 12, 16 or
 * 24 pages (the nearest; ties go up). Fewer: the longest pages are split at a
 * sentence; more: the two shortest neighbours are joined. The words never
 * change. A book too short to split stays short (the acceptor reports it).
 */
export function clampPages(pages, bounds = null) {
  let rows = list(pages)
    .filter(object)
    .map((p) => ({ ko: str(p.ko, 1200), ...(p.en !== undefined ? { en: str(p.en, 1200) } : {}), ...(p.spread === true ? { spread: true } : {}) }))
    .filter((p) => p.ko);
  // R54b: an openings book takes C..2C entries for its C openings (the writer's
  // count when it fits); a page book the nearest of 8/12/16/24.
  const target = bounds ? Math.min(Math.max(rows.length, bounds.min), bounds.max) : nearestCount(rows.length);
  let guard = 64;
  while (rows.length < target && guard-- > 0) {
    const i = rows.reduce((best, p, n) => (sentences(p.ko).length > sentences(rows[best].ko).length ? n : best), 0);
    const ko = sentences(rows[i].ko);
    if (ko.length < 2) break;
    const cut = Math.ceil(ko.length / 2),
      en = rows[i].en !== undefined ? sentences(rows[i].en) : null,
      cutEn = en ? Math.ceil(en.length / 2) : 0;
    const a = { ko: ko.slice(0, cut).join(" "), ...(en ? { en: en.slice(0, cutEn).join(" ") } : {}), ...(rows[i].spread ? { spread: true } : {}) },
      b = { ko: ko.slice(cut).join(" "), ...(en ? { en: en.slice(cutEn).join(" ") } : {}), ...(rows[i].spread ? { spread: true } : {}) };
    rows.splice(i, 1, a, b);
  }
  while (rows.length > target) {
    let best = 0,
      size = Infinity;
    for (let n = 0; n + 1 < rows.length; n++) {
      const together = rows[n].ko.length + rows[n + 1].ko.length;
      if (together < size) {
        size = together;
        best = n;
      }
    }
    const [a, b] = [rows[best], rows[best + 1]];
    rows.splice(best, 2, { ko: `${a.ko} ${b.ko}`.trim(), ...(a.en !== undefined || b.en !== undefined ? { en: `${a.en || ""} ${b.en || ""}`.trim() } : {}), ...(a.spread || b.spread ? { spread: true } : {}) });
  }
  return rows;
}
/** The cheap call that reads the finished book and returns what the pictures need: who, where, the action, a feeling, the hour, props, the beat. */
/* ---------- R54f: a drawer card for every new character the room invented ---------- */
/**
 * The chosen premise's new characters (isNew, with a look) that have no drawer
 * card yet — by name against input.characters. Without a card the pictures
 * draw them from the page text alone and their look drifts page to page.
 */
export function roomNewCast(outline, input) {
  const known = new Set(list(input?.characters).filter(object).flatMap((c) => [str(c.name, 30), str(c.nameEn, 30)]).filter(Boolean));
  const seen = new Set();
  return list(outline?.writersRoom?.premise?.cast)
    .filter((c) => object(c) && c.isNew === true && str(c.name, 30) && str(c.look, 160))
    .filter((c) => {
      const name = str(c.name, 30);
      if (known.has(name) || seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .map((c) => ({ name: str(c.name, 30), nameEn: str(c.nameEn, 30), kind: str(c.kind, 24), look: str(c.look, 160), want: str(c.want, 100), flaw: str(c.flaw, 100), speech: str(c.speech, 100) }));
}
const KIND_WORDS = Object.freeze({ child: "child", kid: "child", boy: "child", girl: "child", adult: "adult", man: "adult", woman: "adult", grandma: "adult", grandpa: "adult", teacher: "adult" });
/** The drawer record of one new character — the shape materializeAutoPlan gives a plan's new companion (its sheet is bought like theirs). */
export function roomCastRecord(c, { id, jobId, now = new Date().toISOString() } = {}) {
  const kindWord = str(c?.kind, 24).toLowerCase().replace(/[^a-z]/g, "");
  return {
    id: String(id || ""),
    name: str(c?.name, 30),
    nameEn: str(c?.nameEn, 30) || str(c?.name, 30),
    role: "조연",
    kind: KIND_WORDS[kindWord] || kindWord || "friend",
    gender: "",
    description: str(c?.look, 160),
    traits: [str(c?.want, 100), str(c?.flaw, 100)].filter(Boolean).slice(0, 2),
    catchphrase: "",
    version: 1,
    color: "#a8bb91",
    appearance: str(c?.look, 160),
    clothes: "",
    hairColor: "#493b34",
    skinColor: "#edceb3",
    wardrobe: [],
    characterSheets: [],
    source: "writers-room",
    autoRunId: String(jobId || ""),
    autoReviewPending: true,
    createdAt: now,
  };
}
/* ---------- R55c: the picture reading replaces the outline's picture plan ---------- */
const POCKETS = Object.freeze(["left", "right", "top", "bottom", "none"]);
const CARRIERS_READ = Object.freeze(["words", "picture", "both"]);
const BACKDROPS_READ = Object.freeze(["scene", "plain"]);
/** The reading's extra fields for a picture-led draft (the composition the outline used to plan before anyone wrote). */
function readingPlanFields(input) {
  if (!wantsPicturePlan(input)) return { properties: {}, line: "" };
  const drama = hasStoryDrama(input),
    pocket = hasTextPocket(input);
  return {
    properties: {
      shot: { type: "string", enum: [...SHOTS] },
      space: { type: "string", enum: [...SPACES] },
      carrier: { type: "string", enum: [...CARRIERS_READ] },
      ...(drama ? { focus: { type: "string", maxLength: 80 }, backdrop: { type: "string", enum: [...BACKDROPS_READ] } } : {}),
      ...(pocket ? { pocket: { type: "string", enum: [...POCKETS] } } : {}),
    },
    line: ` Also, for the picture of each page: shot (wide = small figures in a big world; middle; close = faces and hands fill the frame — vary it page to page as the moment asks), space (full = a busy picture; airy = lots of quiet empty space), carrier (words = the text carries this moment and the picture is quiet; picture = the text is short and the picture tells it; both)${drama ? ", focus (the one thing the eye lands on, a few English words), backdrop (scene = the place is drawn; plain = the character alone on a flat single-colour background — a thought or a line to the reader; at most two pages in the book, never the first or last)" : ""}${pocket ? ", pocket (where the printed words sit on the picture: left, right, top or bottom — the part with no action, bigger when the words carry the page; none only for a page of one shouted word)" : ""}.`,
  };
}
/** The beat of each of N pages when the book is not an openings book: the pages dealt evenly and in order over the beats. */
export function evenBeats(beats, count) {
  const rows = list(beats);
  if (!rows.length || !(count > 0)) return [];
  return Array.from({ length: count }, (_, i) => rows[Math.min(rows.length - 1, Math.floor((i * rows.length) / count))]);
}
export function extractRequest(input, outline, pages) {
  const count = list(pages).length,
    reading = readingPlanFields(input),
    // R54g: gender and pronoun per character — the A/B's reader wrote "behind her" for the boy.
    cast = list(input?.characters).filter(object).map((c) => `${c.id} = ${str(c.name, 30)}${c.nameEn ? ` (${str(c.nameEn, 30)})` : ""}${genderWord(c) ? ` — ${genderWord(c)}, ${/^(boy|man)$/u.test(genderWord(c)) ? "he" : "she"}` : ""}`).join(", "),
    lead = list(input?.characters).filter(object)[0],
    places = list(input?.backgrounds).filter(object).map((b) => `${b.id} = ${str(b.name, 30)}`).join(", "),
    // R54f: a new character that got a drawer card (roomNewCast → FULL AUTO) is in the cast list by ID.
    known = new Set(list(input?.characters).filter(object).flatMap((c) => [str(c.name, 30), str(c.nameEn, 30)]).filter(Boolean)),
    extra = list(outline?.writersRoom?.premise?.cast).filter((c) => c?.isNew).map((c) => str(c.name, 30)).filter((n) => n && !known.has(n));
  return {
    system: `You read a finished Korean picture book (with its English edition when given) and return, for every page, what the illustrator needs — never rewriting the words. Per page: who (the character IDs on the page, 1–5, from the cast list only${extra.length ? `; ${extra.join(", ")} are new to this book and have no ID — describe them inside action instead` : ""}), where (one line in English, naming a supplied place ID when the page is there), action (one English sentence of the picture: who does what, with what, where in the frame), emotion (one English word), timeOfDay (${TIMES.join("/")}), props (2–6 concrete things in English).${reading.line} Also cover: title (the book's title as given) and sceneAction (one English sentence for the cover picture: ${lead ? `${str(lead.name, 30)} alone` : "the main character alone"} — no companion on the cover). Return exactly ${count} pages in order.\n\n[cast] ${cast || "(none)"}\n[places] ${places || "(none)"}`,
    user: list(pages).map((p, i) => `${i + 1}쪽: ${str(p.ko, 1200)}${p.en ? `\n   EN: ${str(p.en, 1200)}` : ""}`).join("\n"),
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["cover", "pages"],
      properties: {
        cover: { type: "object", additionalProperties: false, required: ["title", "sceneAction"], properties: { title: { type: "string", maxLength: 100 }, sceneAction: { type: "string", maxLength: 500 } } },
        pages: {
          type: "array",
          minItems: count,
          maxItems: count,
          items: {
            type: "object",
            additionalProperties: false,
            // R55c: no beatIndex — the beats are the app's (dealt over the pages), never the reader's guess; the reading's picture fields for a picture-led draft.
            required: ["pageNo", "who", "where", "action", "emotion", "timeOfDay", "props", ...Object.keys(reading.properties)],
            properties: {
              pageNo: { type: "integer", minimum: 1 },
              who: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", maxLength: 60 } },
              where: { type: "string", maxLength: 500 },
              action: { type: "string", maxLength: 500 },
              emotion: { type: "string", maxLength: 40 },
              timeOfDay: { type: "string", enum: TIMES },
              props: { type: "array", maxItems: 12, items: { type: "string", maxLength: 80 } },
              ...reading.properties,
            },
          },
        },
      },
    },
    temperature: 0.2,
    maxTokens: 6000 + (Object.keys(reading.properties).length ? count * 60 : 0),
  };
}
/** R54b: the beat of each of N entries in an openings book of C beats (null for a page book or a count outside C..2C). */
export function openingBeats(input, beats, entries, spreads = []) {
  const c = openingCount(input);
  if (!c || list(beats).length !== c || entries < c || entries > 2 * c) return null;
  const pairs = entries - c;
  // R54e: the writer's spread marks — a marked page stands alone in its opening;
  // the pairs go to unmarked neighbours, spread evenly; when the marks leave too
  // few pairable places the remaining pairs ignore them (the count must fit).
  const marked = new Set(list(spreads).map((v, i) => (v === true ? i : -1)).filter((i) => i >= 0));
  const candidates = [];
  for (let i = 0; i + 1 < entries; i++) if (!marked.has(i) && !marked.has(i + 1)) candidates.push(i);
  const chosen = new Set();
  const take = (pool) => {
    let need = pairs - chosen.size;
    if (need <= 0 || !pool.length) return;
    const step = pool.length / need;
    for (let k = 0; k < need; k++) {
      const want = Math.floor(k * step + step / 2);
      let j = want;
      while (j < pool.length && (chosen.has(pool[j]) || chosen.has(pool[j] - 1) || chosen.has(pool[j] + 1))) j++;
      if (j >= pool.length) {
        j = want;
        while (j >= 0 && (chosen.has(pool[j]) || chosen.has(pool[j] - 1) || chosen.has(pool[j] + 1))) j--;
      }
      if (j >= 0 && j < pool.length) chosen.add(pool[j]);
    }
  };
  take(candidates);
  if (chosen.size < pairs) take(Array.from({ length: entries - 1 }, (_, i) => i));
  const out = [];
  let k = 0;
  for (let i = 0; i < entries; i++) {
    out.push(beats[Math.min(k, c - 1)]);
    if (chosen.has(i)) {
      i += 1;
      out.push(beats[Math.min(k, c - 1)]);
    }
    k += 1;
  }
  return out.length === entries ? out : null;
}
/** The extraction's rows settled against the cast and the beats (an id or beat the model made up falls back, never fails). */
export function settleExtraction(raw, input, outline, pages, title) {
  const cast = list(input?.characters).filter(object).map((c) => String(c.id)),
    castSet = new Set(cast),
    // R55c-2: the third paid A/B's haiku wrote the new characters by name ("kongi", "uncle bear")
    // instead of the card ID the [cast] line gave, so every such page lost them — a name or
    // English name (case and spaces aside) resolves to its ID; anything else is still dropped.
    castByName = new Map(list(input?.characters).filter(object).flatMap((c) => [c.id, c.name, c.nameEn].filter(Boolean).map((v) => [normName(v), String(c.id)]))),
    castId = (value) => (castSet.has(String(value)) ? String(value) : castByName.get(normName(value)) || ""),
    beats = list(outline?.beats).filter(object).map((b) => Number(b.index)).filter(Number.isInteger),
    count = list(pages).length,
    rows = list(raw?.pages).filter(object);
  let last = beats[0] || 1;
  const fallbackBeat = (i) => beats[Math.min(beats.length - 1, Math.floor((i * beats.length) / Math.max(1, count)))] || 1;
  // R54b openings: the entries are dealt into the C openings in order, the
  // doubled openings spread evenly through the book (entries − C of them);
  // every entry of opening k sits on approved beat k. Deterministic, never the
  // model's guess, so the structure the prints read is always valid.
  // R55c: a page book is dealt evenly too (the outline is the app's now; the
  // reader is not asked for a beat — an older journal's beatIndex is ignored).
  const openingBeat = openingBeats(input, beats, count, list(pages).map((p) => p?.spread === true)) || evenBeats(beats, count),
    plainOk = wantsPicturePlan(input) && hasStoryDrama(input);
  const out = list(pages).map((p, i) => {
    const row = rows.find((r) => Number(r.pageNo) === i + 1) || rows[i] || {};
    const who = [...new Set(list(row.who).map(castId).filter(Boolean))];
    let beat = openingBeat.length ? openingBeat[i] : Number(row.beatIndex);
    if (!beats.includes(beat) || beat < last) beat = Math.max(last, fallbackBeat(i));
    last = beat;
    const emotion = /^[A-Za-z]+(?:-[A-Za-z]+)?$/u.test(str(row.emotion, 40)) ? str(row.emotion, 40) : "calm";
    return {
      pageNo: i + 1,
      beatIndex: beat,
      textKo: p.ko,
      textEn: p.en || p.ko,
      scene: {
        who: who.length ? who : cast.slice(0, 1),
        where: str(row.where, 500) || "the story's place",
        action: str(row.action, 500) || str(p.en || p.ko, 500),
        emotion,
        timeOfDay: TIMES.includes(row.timeOfDay) ? row.timeOfDay : "day",
        props: list(row.props).map((v) => str(v, 80)).filter(Boolean).slice(0, 12),
      },
      variantByCharacter: {},
      isRefrainPage: false,
      // R55c: a plain-backdrop page from the reading (settleBackdrops keeps it only where the beat's plan agrees and within the caps).
      ...(plainOk && str(row.backdrop, 20) === "plain" ? { backdrop: "plain" } : {}),
    };
  });
  // R54f-2: the cover carries the writer's title; the cheap reader rewrote it in both paid A/B runs ("Kongi Hide and Seek").
  return { cover: { title: str(title, 100) || str(raw?.cover?.title, 100) || "이야기", sceneAction: str(raw?.cover?.sceneAction, 500) || str(out[0]?.scene.action, 500) || "the hero at the story's place" }, pages: out };
}
/**
 * The room's third part: the finished text, clamped to the binding, read once
 * by the cheap model for what the pictures need, settled against the cast and
 * beats, then through the app's own page acceptor and story checks (advisory).
 * The result is the pagination every later stage reads; the input's page
 * count follows the book (the caller updates its frozen input).
 */
/* ---------- R54g: the writer's spread marks made to fit the binding ---------- */
const splitPage = (p) => {
  const ko = sentences(p.ko);
  if (ko.length < 2) return null;
  const cut = Math.ceil(ko.length / 2),
    en = p.en !== undefined ? sentences(p.en) : null,
    cutEn = en ? Math.ceil(en.length / 2) : 0;
  return [
    { ko: ko.slice(0, cut).join(" "), ...(en ? { en: en.slice(0, cutEn).join(" ") } : {}) },
    { ko: ko.slice(cut).join(" "), ...(en ? { en: en.slice(cutEn).join(" ") } : {}) },
  ];
};
const joinPages = (a, b) => ({ ko: `${a.ko} ${b.ko}`.trim(), ...(a.en !== undefined || b.en !== undefined ? { en: `${a.en || ""} ${b.en || ""}`.trim() } : {}) });
/** Maximal runs of unmarked entries: [{start, length}]. */
const unmarkedRuns = (rows) => {
  const runs = [];
  let start = -1;
  rows.forEach((p, i) => {
    if (p.spread === true) {
      if (start >= 0) runs.push({ start, length: i - start });
      start = -1;
    } else if (start < 0) start = i;
  });
  if (start >= 0) runs.push({ start, length: rows.length - start });
  return runs;
};
/**
 * R54g (A/B 2차 4-2): with M marked pages in a book of C openings, the entries
 * must number exactly 2C − M and every run of unmarked pages between marks
 * must be even — otherwise the binding had to break a mark (Opus marked 10 and
 * 14; the book came out with 13 and 14 as spreads). This makes the count and
 * the parity fit by splitting the longest page or joining the two shortest
 * neighbours *inside the unmarked runs* (words untouched), preferring the odd
 * runs; marks beyond C are dropped from the end; when a run cannot be fixed
 * the pages are returned as they are (the binding then breaks a mark as before).
 */
export function fitSpreadMarks(pages, openings) {
  const c = Number(openings) || 0;
  let rows = list(pages).filter(object).map((p) => ({ ...p }));
  const marked = () => rows.filter((p) => p.spread === true).length;
  if (!c || !marked()) return { pages: rows, fitted: true, marks: 0, moved: 0 };
  let moved = 0;
  for (let i = rows.length - 1; i >= 0 && marked() > c; i--) if (rows[i].spread === true) { delete rows[i].spread; moved += 1; }
  const target = 2 * c - marked();
  const inRun = (prefer) => {
    const runs = unmarkedRuns(rows);
    const odd = runs.filter((r) => r.length % 2 === 1);
    return prefer === "odd" && odd.length ? odd : runs;
  };
  const split = (runs) => {
    let best = -1, count = 1;
    for (const r of runs) for (let i = r.start; i < r.start + r.length; i++) { const n = sentences(rows[i].ko).length; if (n > count) { count = n; best = i; } }
    if (best < 0) return false;
    const parts = splitPage(rows[best]);
    if (!parts) return false;
    rows.splice(best, 1, ...parts);
    return true;
  };
  const join = (runs) => {
    let best = -1, size = Infinity;
    for (const r of runs) for (let i = r.start; i + 1 < r.start + r.length; i++) { const n = rows[i].ko.length + rows[i + 1].ko.length; if (n < size) { size = n; best = i; } }
    if (best < 0) return false;
    rows.splice(best, 2, joinPages(rows[best], rows[best + 1]));
    return true;
  };
  let guard = 64;
  while (rows.length < target && guard-- > 0) if (!split(inRun("odd")) && !split(inRun("any"))) break;
  while (rows.length > target && guard-- > 0) if (!join(inRun("odd")) && !join(inRun("any"))) break;
  guard = 32;
  while (guard-- > 0) {
    const odd = unmarkedRuns(rows).filter((r) => r.length % 2 === 1);
    if (odd.length < 2) break;
    // One odd run grows by a split, another shrinks by a join: the count stays, both turn even.
    const before = rows.length;
    let done = false;
    for (const grow of odd) {
      if (!split([grow])) continue;
      const rest = unmarkedRuns(rows).filter((r) => r.length % 2 === 1);
      done = rest.length > 0 && join([rest[0]]);
      break;
    }
    if (!done || rows.length !== before) break;
  }
  const fitted = rows.length === target && !unmarkedRuns(rows).some((r) => r.length % 2 === 1);
  return { pages: rows, fitted, marks: marked(), moved };
}
export async function runRoomPages(input, outline, draft, options = {}, services = {}) {
  services = withEngines(services);
  if (!list(draft?.pages).length) throw new StoryValidationError("pagination", ["작가실 글이 없어요. 초고 단계부터 다시 만들어 주세요."]);
  // R54b: an openings book keeps its printed count (12 or 16) and takes C..2C
  // entries; a page book's count follows the writer (nearest binding).
  const openings = openingCount(input),
    clamped = clampPages(draft.pages, openings ? { min: openings, max: 2 * openings } : null),
    // R54g: the writer's spread marks are made to fit the binding before the deal.
    fit = openings ? fitSpreadMarks(clamped, openings) : { pages: clamped, fitted: true, marks: 0, moved: 0 },
    pages = fit.pages,
    printed = openings ? input.pageCount : pages.length;
  const sized = { ...input, pageCount: printed };
  const journal = ledger("roomPages", sized, options, { version: WRITERS_ROOM_VERSION, pages }, "enrichmentCheckpoint");
  const ask = async (label, request, role) => {
    const response = await journal.call(role, request, services);
    const data = response?.json !== undefined ? response.json : parseJsonLenient(String(response?.text || ""));
    if (!object(data)) throw journal.fail(roomError(`${label}의 답을 읽을 수 없어요.`));
    return data;
  };
  try {
    options.onProgress?.({ stage: "roomPages", phase: "extract", message: "작가실 · 완성된 글에서 그림에 필요한 것을 읽고 있어요." });
    const raw = await ask("그림 읽기", extractRequest(sized, outline, pages), "cheap");
    const settled = settleExtraction(raw, sized, outline, pages, draft.title);
    // R55c: the outline the pictures and prints read is rebuilt from the finished pages and the reading (beat summaries, places, feelings, the per-beat picture plan).
    const shaped = roomOutlineFromPages(outline, sized, settled.pages, raw);
    // R54e: the room's binding is the writer's — no "all pairs → last opening a spread" guard.
    // R55c: staging on — the pages get the camera rotation, sides and light the picture requests read (a room book had none before and fell back to the old prompt).
    const pagination = acceptEcoPagination(settled, shaped, sized, { bookId: sized.bookId, roomBinding: true, staging: true });
    const report = inspectStory(shaped, pagination, sized);
    return {
      data: pagination,
      usage: journal.usage(),
      meta: { ...journal.summary(), stage: "roomPages", pageCount: printed, entries: pages.length, openings: openings || 0, checks: report, clamped: pages.length !== list(draft.pages).length, spreadFit: { marks: fit.marks, fitted: fit.fitted, moved: fit.moved }, outline: shaped },
    };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw journal.fail(error);
  }
}

/* ---------- R55c: the outline is the app's — no paid outline call for a room book ---------- */
const BEAT_TYPES = (count) => ["setup", "want", ...Array.from({ length: Math.max(0, count - 5) }, () => "attempt"), "turn", "resolution", "close"];
const BEAT_FEELING = Object.freeze({ setup: "기대", want: "호기심", attempt: "궁금", turn: "놀람", resolution: "기쁨", close: "편안" });
const normName = (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
/** 3–5 Korean words for the outline's newWordsKo: the topic's nouns, then the premise's words. */
function roomWords(input, premise) {
  const seen = [];
  const push = (w) => {
    w = str(w, 30);
    if (w && w.length >= 2 && !seen.includes(w) && seen.length < 5) seen.push(w);
  };
  for (const w of storyTopicKeywords(str(input?.topic, 400))) push(w);
  for (const text of [premise?.title, premise?.line]) for (const w of str(text, 300).split(/[^\p{L}\p{N}]+/u)) push(w);
  for (const w of ["이야기", "친구", "하루"]) push(w);
  return seen.slice(0, 5);
}
/**
 * The skeleton outline of a room book, from the chosen premise: valid for the
 * app's checks (beats, settings, feelings, titles), never sent to a model. The
 * second paid A/B read from its exchanges that the writer never saw the paid
 * outline and the pages met it only by position — so the 18,000-character
 * request was priced for a binding count and a picture plan the finished text
 * then contradicted. runRoomPages rebuilds this skeleton from the pages.
 */
export function roomOutline(input, record) {
  const premise = object(record?.premise) ? record.premise : {},
    count = frozenBeatCount(input) || 8,
    cast = list(input?.characters).filter(object).map((c) => String(c.id)).slice(0, 5),
    placeIds = list(input?.backgrounds).filter(object).map((b) => String(b.id)),
    preferred = list(input?.preferredBackgroundIds).map(String).filter((id) => placeIds.includes(id)),
    place = preferred[0] || placeIds[0] || "",
    lead = list(premise.cast).find((c) => object(c) && c.isNew !== true) || list(premise.cast).find(object) || null,
    line = str(premise.line, 500) || str(input?.topic, 500) || "이야기",
    titles = [str(premise.title, 100), ...list(record?.pitches).map((p) => str(p?.title, 100))].filter(Boolean).filter((t, i, all) => all.indexOf(t) === i);
  while (titles.length < 3) titles.push(titles[0] || str(input?.topic, 100) || "이야기");
  const types = BEAT_TYPES(count),
    beats = types.map((type, i) => ({ index: i + 1, type, summary: line, characters: cast, settingKey: place || "the story's place" }));
  return {
    titleCandidates: titles.slice(0, 3),
    logline: line,
    want: str(lead?.want, 500) || line,
    problem: str(lead?.flaw, 500) || str(premise.laugh, 500) || line,
    twist: str(premise.laugh, 500) || line,
    beats,
    newWordsKo: roomWords(input, premise),
    newWordsEn: [],
    settings: beats.map((b) => ({ beatIndex: b.index, ...(place ? { backgroundId: place } : { newPlace: "이야기의 장소" }) })),
    emotionArc: types.map((type) => BEAT_FEELING[type]),
    endingType: str(input?.endingType, 20) || "home_sleep",
    roomOutline: { version: 1, stage: "skeleton" },
  };
}
/**
 * The outline rebuilt from the finished pages and the reading: every beat's
 * summary is its pages' Korean, its place the supplied place its pages name
 * most, its feeling its first page's, and (picture-led drafts) its picture plan
 * the reading's shot·space·carrier·focus·backdrop·pocket of its first page —
 * cleaned by the same settlers the writers' outline went through.
 */
export function roomOutlineFromPages(outline, input, pages, raw) {
  const next = clone(object(outline) ? outline : {}),
    beats = list(next.beats).filter(object),
    rows = list(raw?.pages).filter(object),
    backgrounds = list(input?.backgrounds).filter(object),
    placeOf = (where) => {
      const key = normName(where);
      if (!key) return "";
      const hit = backgrounds.find((b) => [b.id, b.name, b.nameEn].some((v) => normName(v) && normName(v) === key)) || backgrounds.find((b) => String(b.id) && key.includes(normName(b.id)));
      return hit ? String(hit.id) : "";
    },
    groups = new Map(beats.map((b) => [b.index, []]));
  list(pages).forEach((p, i) => {
    const group = groups.get(Number(p?.beatIndex));
    if (group) group.push({ page: p, row: rows.find((r) => Number(r.pageNo) === i + 1) || rows[i] || {} });
  });
  next.settings = list(next.settings).filter(object);
  next.emotionArc = list(next.emotionArc);
  const plan = wantsPicturePlan(input),
    drama = hasStoryDrama(input),
    pocket = hasTextPocket(input);
  for (const beat of beats) {
    const group = groups.get(beat.index) || [];
    if (!group.length) continue;
    const ko = group.map((g) => str(g.page.textKo, 2000)).filter(Boolean).join(" ");
    if (ko) beat.summary = ko.slice(0, 2000);
    const who = [...new Set(group.flatMap((g) => list(g.page.scene?.who).map(String)))].slice(0, 5);
    if (who.length) beat.characters = who;
    const counts = new Map();
    for (const id of group.map((g) => placeOf(g.page.scene?.where)).filter(Boolean)) counts.set(id, (counts.get(id) || 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "",
      where = str(group[0].page.scene?.where, 300);
    let setting = next.settings.find((s) => Number(s.beatIndex) === beat.index);
    if (!setting) next.settings.push((setting = { beatIndex: beat.index }));
    if (top) {
      setting.backgroundId = top;
      delete setting.newPlace;
      beat.settingKey = top;
    } else if (where) {
      delete setting.backgroundId;
      setting.newPlace = where;
      beat.settingKey = where;
    }
    const emotion = str(group[0].page.scene?.emotion, 40);
    if (/^[A-Za-z]+(?:-[A-Za-z]+)?$/u.test(emotion)) next.emotionArc[beat.index - 1] = emotion;
    if (plan) {
      const r = group[0].row;
      beat.picturePlan = {
        version: 1,
        carrier: str(r.carrier, 20) || "both",
        ...(str(r.shot, 20) ? { shot: str(r.shot, 20) } : {}),
        ...(str(r.space, 20) ? { space: str(r.space, 20) } : {}),
        ...(drama ? { ...(str(r.focus, 80) ? { focus: str(r.focus, 80) } : {}), ...(str(r.backdrop, 20) ? { backdrop: str(r.backdrop, 20) } : {}) } : {}),
        ...(pocket && str(r.pocket, 20) ? { pocket: str(r.pocket, 20) } : {}),
      };
    }
  }
  settlePicturePlans(next, input);
  settleDramaPlans(next, input);
  settlePockets(next, input);
  next.roomOutline = { version: 1, stage: "pages" };
  return next;
}

