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
import { pageTextKey, wantsPicturePlan, settlePicturePlans, normalizePicturePlan, SHOTS, SPACES, pictureLettering } from "./picture-plan.js";
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
/**
 * R55h (2026-11-09): "weave" — the parent found the characters and the conflict
 * simple and asked for what could be done other than adding rules. A new room
 * draft carries weave: 1 and gets, in runRoomDrafts: the cast speaking before
 * the drafts (material), three drafts written three ways (variation), two more
 * questions for the readers (selection), art notes the pictures carry, and a
 * backward look in the rewrite (process). A job frozen before R55h has no
 * weave and its requests are byte-identical.
 *
 * R56 (2026-11-09): weave 2 — the parent asked for the stages a broadcast
 * writer goes through, so the cast and the foreshadowing are finished over
 * several passes: the cast speaks and says what stands between them → three
 * treatments (a half-page flow and a short "plant and pay off" memo), the
 * panel picks one → the cast notes are revised for that flow → three drafts
 * of it → the panel reads → an editor's thread check (kept, loose, unplanted)
 * → the rewrite. Every intermediate document is the writer's own working
 * note: nothing checks it and a draft may leave it. A weave 1 job (R55h)
 * keeps its own requests.
 *
 * R57 (2026-11-09): weave 3 — "the cast and the places are too few and the
 * stories too alike". More cards do not make a story wide; the kind of story
 * does. So the twelve premises span three widths (one place / a way through
 * several places / several characters each on their own business), every
 * premise names the places it goes (new ones with a look, like new
 * characters), the three shown to the parent are of different widths with
 * their cast, places and new sheets counted on the card — choosing a premise
 * is confirming its new characters and places — and a new place gets a
 * drawer card and a place sheet. A weave 1 or 2 job keeps its own requests
 * (a job parked at the parent's choice keeps the three it was shown).
 *
 * R59 (2026-11-10): weave 4 — what three reviewers agreed after reading the
 * paid run and what the parent then decided ("remove the contradictions, then
 * one draft instead of three"). A weave 4 draft (hasRoomLean):
 *   - writes ONE draft from the flow the panel chose (the three flows differ,
 *     the three drafts were one book: 13 of 47 sentences word for word); the
 *     panel still reads it and the writer still rewrites what two readers
 *     named;
 *   - keeps the writer's spread marks through the rewrite (the rewrite was
 *     never shown them: three marks went in, none came out) — the manuscript
 *     line carries the mark and the app copies it onto a page the rewrite
 *     returned word for word;
 *   - asks the readers nothing about echoes or characters the story would not
 *     miss (all six readers answered yes for all three drafts), passes a
 *     reader's "change" on only when two readers name the same page, and the
 *     editor's thread check no longer starts a rewrite by itself;
 *   - leaves the place of the printed words to the app (the cheap reading no
 *     longer picks a pocket: 4 of 11 were usable).
 * A weave 1–3 job keeps its own requests.
 *
 * R60 (2026-11-10): weave 5 — what ten reviewers agreed about the cast and
 * the sheets, and the parent approved ("진행해"). A weave 5 draft
 * (hasRoomCounted):
 *   - drops the cast revision (its `turn` copied the chosen flow and pulled
 *     each character's own business back to the hero; nine of nine lines
 *     changed, no new noun) and the `habit` field (it gave every character a
 *     prop — five prop threads in a 163-word book); `today` is no longer told
 *     to be "unrelated to the hero", and the ties are optional, three at most;
 *   - writes no look into the twelve premises (19 written, 1 used, twelve
 *     near-identical fawns): a new character or place is named, typed and
 *     looked at once — in the cast-notes call of the chosen premise, as an
 *     instruction to the illustrator (build, size against the hero, colours
 *     and where they are, one mark seen from front and back, what it wears;
 *     a place's colours and what stands left, right and far);
 *   - buys a new card's sheet only when the finished pages need it — a
 *     character on two pages or more, a place in two wide or middle pictures
 *     or more (full-auto.js); the rest are drawn from the words and leave the
 *     book (the card is archived);
 *   - tells the rewrite where the things the ending uses are first HEARD
 *     (the words, not the art notes).
 * A weave 1–4 job keeps its own requests.
 *
 * R61 (2026-11-10): weave 6 — what the Codex R60 audit reproduced for free
 * (CODEX_R60_STORY_IMAGE_AUDIT_2026-11-10.md): the facts of the book were
 * lost between the stages. A weave 6 draft (hasRoomKept):
 *   - hears the facts the last book settled (its title, what it left for the
 *     next one, its final pages as the parent kept them) in the brief and the
 *     cast notes — a sequel's requests were byte-identical with or without it;
 *   - binds the Korean into its pages BEFORE the English (one sentence cap for
 *     every join; a join that would break it moves sentences to a neighbour
 *     instead), and the English follows the bound pages by number — a missing
 *     page is asked once more, never filled with the Korean in silence;
 *   - keeps a rewrite to the pages the readers named (and their neighbours; a
 *     page outside may only gain one sentence — a plant), never touches a page
 *     they laughed at, and a polish to the pages and languages the level check
 *     named;
 *   - reads the pictures with parts and mistakes in mind (ears over a bush are
 *     the fawn; a rock that is the fawn says so), keeps an empty picture empty,
 *     marks a page the reading did not return, and records which words each
 *     page's picture was read from (a later edit makes the plan stale);
 *   - asks nothing must exist: a character's secret, a page's props.
 * A weave 1–5 job keeps its own requests.
 */
const ROOM_WEAVE = 7;
/** The marker for a new draft; the family's recent books ride inside it (never story data): [{line, engine?, laugh?}]. */
export const writersRoomPolicy = (records = []) => {
  const recent = recentRoomBooks(records);
  return { version: WRITERS_ROOM_VERSION, weave: ROOM_WEAVE, ...(recent.length ? { recent } : {}) };
};
/** The marker as normalize keeps it; null when it is not the R51 one. */
export const writersRoomRef = (value) => {
  if (!object(value) || value.version !== WRITERS_ROOM_VERSION) return null;
  const recent = list(value.recent)
    .filter(object)
    .map((r) => ({ line: str(r.line, 200), ...(str(r.engine, 40) ? { engine: str(r.engine, 40) } : {}), ...(str(r.laugh, 120) ? { laugh: str(r.laugh, 120) } : {}) }))
    .filter((r) => r.line)
    .slice(0, 6);
  return { version: WRITERS_ROOM_VERSION, ...([1, 2, 3, 4, 5, 6, 7].includes(value.weave) ? { weave: value.weave } : {}), ...(recent.length ? { recent } : {}) };
};
export const hasWritersRoom = (input) => input?.writersRoom?.version === WRITERS_ROOM_VERSION;
export const hasRoomWeave = (input) => hasWritersRoom(input) && [1, 2, 3, 4, 5, 6, 7].includes(input.writersRoom.weave);
/** R56: the staged room — treatments, the revised cast, the thread check. */
export const hasRoomStages = (input) => hasWritersRoom(input) && [2, 3, 4, 5, 6, 7].includes(input.writersRoom.weave);
/** R57: premises of three widths, their places named, the shortlist spread by width, new places carded. */
export const hasRoomWide = (input) => hasWritersRoom(input) && [3, 4, 5, 6, 7].includes(input.writersRoom.weave);
/** R59: one draft, spread marks kept, the readers' two extra questions gone, the pocket decided by the app. */
export const hasRoomLean = (input) => hasWritersRoom(input) && [4, 5, 6, 7].includes(input.writersRoom.weave);
/** R60: no cast revision, no habit, no look in the premises; sheets bought for what the finished pages need. */
export const hasRoomCounted = (input) => hasWritersRoom(input) && [5, 6, 7].includes(input.writersRoom.weave);
/** R61: the facts kept between the stages (sequel facts, binding before English, scoped edits, a careful reading). */
export const hasRoomKept = (input) => hasWritersRoom(input) && [6, 7].includes(input.writersRoom.weave);
/** R62: a clear room draft (weave 7) — a listener hears the words without pictures, and the reading grounds the pictures in the words. */
export const hasRoomClear = (input) => hasWritersRoom(input) && input.writersRoom.weave === 7;
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
  // R61 (audit 7): "female" contains "male" — the female words are read first.
  if (/여자|girl|female|woman/iu.test(g)) return adult ? "woman" : "girl";
  if (/남자|boy|male|man/iu.test(g)) return adult ? "man" : "boy";
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
/**
 * R61 (audit C): what the last book settled, for a sequel — its title, what it left for the next one, and its final
 * pages as the parent kept them (the parent's edits are the facts). Stated as facts to continue, apart from what the
 * writer will invent; "" for a book that is not a sequel.
 */
export function sequelBlock(input) {
  const prev = object(input?.previousStory) ? input.previousStory : null,
    summary = str(input?.previousSummary || prev?.summaryForNext, 600);
  if (!prev && !summary) return "";
  const pages = list(prev?.pages).map((p) => str(p?.textKo ?? p?.ko, 300)).filter(Boolean),
    tail = pages.slice(-2);
  return [
    `[앞 이야기에서 정해진 것 — 이어 가요. 바꾸지 않아요]`,
    str(prev?.title, 60) ? `- 앞 책: ${str(prev.title, 60)}` : "",
    summary ? `- 다음 책에 남긴 것: ${summary}` : "",
    tail.length ? `- 앞 책의 마지막 쪽(부모님이 고친 그대로):\n${tail.map((t) => `  · ${t}`).join("\n")}` : "",
    "- 새 책의 바람과 일은 새로 지어요. 앞 책에서 끝난 일을 다시 하지 않고, 남은 약속·지닌 물건·달라진 사이는 이어 가요.",
  ]
    .filter(Boolean)
    .join("\n");
}
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
    hasRoomKept(input) ? sequelBlock(input) : "",
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
/** R57: a wide draft's premise also names the places the story goes — the parent's by name, a new one with what a place sheet needs. */
const WIDE_PREMISE_SCHEMA = {
  ...PREMISE_SCHEMA,
  properties: {
    premises: {
      ...PREMISE_SCHEMA.properties.premises,
      items: {
        ...PREMISE_SCHEMA.properties.premises.items,
        required: [...PREMISE_SCHEMA.properties.premises.items.required, "places"],
        properties: {
          ...PREMISE_SCHEMA.properties.premises.items.properties,
          places: {
            type: "array",
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "isNew", "nameEn", "type", "look"],
              properties: { name: { type: "string", maxLength: 30 }, isNew: { type: "boolean" }, nameEn: { type: "string", maxLength: 30 }, type: { type: "string", maxLength: 24 }, look: { type: "string", maxLength: 200 } },
            },
          },
        },
      },
    },
  },
};
/** R60: the premise schemas without a look (a new character keeps nameEn and kind, a new place nameEn and type). */
const withoutLook = (schema) => {
  const items = schema.properties.premises.items,
    cast = items.properties.cast.items,
    places = items.properties.places?.items;
  const strip = (row) => {
    const { look, ...props } = row.properties;
    return { ...row, required: row.required.filter((k) => k !== "look"), properties: props };
  };
  return {
    ...schema,
    properties: {
      premises: {
        ...schema.properties.premises,
        items: { ...items, properties: { ...items.properties, cast: { ...items.properties.cast, items: strip(cast) }, ...(places ? { places: { ...items.properties.places, items: strip(places) } } : {}) } },
      },
    },
  };
};
const COUNTED_PREMISE_SCHEMA = withoutLook(WIDE_PREMISE_SCHEMA);
const widePremiseLines = (input) =>
  hasRoomCounted(input)
    ? ` 가는 곳도 적어요(places — 이 이야기가 실제로 가는 곳을 가는 순서대로, 다섯 곳까지; 부모님이 고른 곳은 이름만 적고 isNew는 false·나머지는 빈 문자열, 이 책에만 나오는 새 장소(isNew true)는 nameEn(영어 이름)·type(영어 한 단어: forest, sea, city, market, park, farm, mountain, station 같은 것)). ${PREMISE_COUNT}개는 폭도 서로 달라요: 넷쯤은 한 곳에서 벌어지는 작은 이야기, 넷쯤은 서너 곳을 지나가는 이야기(길을 떠나거나, 쫓아가거나, 무엇을 전하러 가거나), 넷쯤은 네다섯이 저마다 제 볼일로 움직이는 이야기 — 새 인물과 새 장소를 아끼지 않아도 돼요.`
    : hasRoomWide(input)
    ? ` 가는 곳도 적어요(places — 이 이야기가 실제로 가는 곳을 가는 순서대로, 다섯 곳까지; 부모님이 고른 곳은 이름만 적고 isNew는 false·나머지는 빈 문자열, 이 책에만 나오는 새 장소(isNew true)는 nameEn(영어 이름)·type(영어 한 단어: forest, sea, city, market, park, farm, mountain, station 같은 것)·look(장소 시트용 생김새 한 줄, 영어 — 늘 그 자리에 있는 것 두세 가지와 색; 쪽마다 같은 곳으로 그릴 수 있게)). ${PREMISE_COUNT}개는 폭도 서로 달라요: 넷쯤은 한 곳에서 벌어지는 작은 이야기, 넷쯤은 서너 곳을 지나가는 이야기(길을 떠나거나, 쫓아가거나, 무엇을 전하러 가거나), 넷쯤은 네다섯이 저마다 제 볼일로 움직이는 이야기 — 새 인물과 새 장소를 아끼지 않아도 돼요.`
    : "";
export function premisesRequest(input, { records = [] } = {}) {
  const brief = roomBrief(input, { records });
  return {
    system: `너는 그림책 작가실의 작가예요. 아래 브리프로 서로 다른 이야기 전제 ${PREMISE_COUNT}개를 내요. 전제마다: 제목, 한 줄 줄거리(line), 이 이야기의 모양(engine — 아래 메뉴의 id 하나, 또는 네가 만든 모양 이름; 메뉴는 참고일 뿐 안 써도 돼요), 가장 큰 웃음 한 장면(laugh — 벌어지는 일로), 아이가 보고 싶어 할 그림 한 장(picture), 인물표(cast — 부모님이 고른 인물은 모두, 이 책에만 나오는 새 인물은 자유롭게; 각자 바람·결점·말투. ${hasRoomCounted(input) ? "새 인물(isNew)에는 nameEn(영어 이름)·kind(child, adult, 또는 동물·존재의 영어 한 단어)도 적어요; 부모님 인물은 둘 다 빈 문자열)." : "새 인물(isNew)에는 nameEn(영어 이름)·kind(child, adult, 또는 동물·존재의 영어 한 단어)·look(그림 시트용 생김새 한 줄, 영어 — 주인공과 견준 크기, 색 둘, 한눈에 알아볼 표시 하나(귀·무늬·모자 같은 것); 쪽마다 같은 인물로 그릴 수 있게)도 적어요; 부모님 인물은 셋 다 빈 문자열)."}${widePremiseLines(input)} ${PREMISE_COUNT}개는 모양도 웃음도 서로 달라야 해요. 안전한 것보다 아이가 깔깔 웃거나 "그래서?" 하고 매달릴 것을.\n\n[이야기 모양 메뉴 — 참고]\n${engineMenuText()}`,
    user: brief,
    jsonSchema: hasRoomCounted(input) ? COUNTED_PREMISE_SCHEMA : hasRoomWide(input) ? WIDE_PREMISE_SCHEMA : PREMISE_SCHEMA,
    temperature: 1,
    maxTokens: hasRoomWide(input) ? 11000 : 9000,
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
/* ---------- R57: how wide a premise is — counted, never asked ---------- */
/** The places a premise names: one per name, five at most. */
export function premisePlaces(premise) {
  const seen = new Set();
  return list(premise?.places)
    .filter(object)
    .map((p) => ({ name: str(p.name, 30), isNew: p.isNew === true, nameEn: str(p.nameEn, 30), type: str(p.type, 24), look: str(p.look, 200) }))
    .filter((p) => p.name && !seen.has(p.name) && seen.add(p.name))
    .slice(0, 5);
}
export const SCALE_LABELS = Object.freeze({ small: "작은 이야기", journey: "여러 곳을 다니는 이야기", ensemble: "여럿이 나오는 이야기" });
/**
 * The width of a premise from its own cast and places: how many characters
 * (and how many are new), how many places (and how many are new), the new
 * sheets it would buy, and its kind — three places or more is a journey, four
 * characters or more an ensemble (the stronger of the two when both), else a
 * small story.
 */
export function premiseScale(premise, { counted = false } = {}) {
  const names = new Set(),
    cast = list(premise?.cast).filter((c) => object(c) && str(c.name, 30) && !names.has(str(c.name, 30)) && names.add(str(c.name, 30))),
    places = premisePlaces(premise),
    newCast = cast.filter((c) => c.isNew === true),
    newPlaces = places.filter((p) => p.isNew);
  const wide = places.length >= 3,
    many = cast.length >= 4;
  return {
    cast: cast.length,
    newCast: newCast.map((c) => str(c.name, 30)),
    places: places.length,
    newPlaces: newPlaces.map((p) => p.name),
    // Only what a sheet can be drawn from buys one. R60: a counted room's premises carry no look — every new character
    // and place may get one, and only those on two pages or more do (the card says "at most").
    sheets: counted ? newCast.length + newPlaces.length : newCast.filter((c) => str(c.look, 160)).length + newPlaces.filter((p) => p.look).length,
    ...(counted ? { counted: true } : {}),
    kind: wide && many ? (places.length - 3 >= cast.length - 4 ? "journey" : "ensemble") : wide ? "journey" : many ? "ensemble" : "small",
  };
}
/**
 * R57: the three the parent sees are of different widths when the twelve are —
 * the panel's best journey, its best ensemble and its best small story, then
 * the panel's order fills what is left; shown in the panel's order, so the
 * first is still the one the readers wanted most.
 */
export function pickPremisesWide(rows, premises, count = SHORTLIST) {
  const ranked = [...list(rows)].sort((a, b) => b.pull - a.pull || b.again - a.again || a.premise - b.premise),
    kindOf = (n) => premiseScale(list(premises)[n - 1]).kind,
    picked = [];
  for (const kind of ["journey", "ensemble", "small"]) {
    if (picked.length >= count) break;
    const row = ranked.find((r) => !picked.includes(r.premise) && kindOf(r.premise) === kind);
    if (row) picked.push(row.premise);
  }
  for (const row of ranked) {
    if (picked.length >= count) break;
    if (!picked.includes(row.premise)) picked.push(row.premise);
  }
  const at = (n) => ranked.findIndex((r) => r.premise === n);
  return picked.sort((a, b) => at(a) - at(b));
}
/* ---------- R55h: the cast speaks before the drafts — material, never a rule ---------- */
const CAST_NOTES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["notes"],
  properties: {
    notes: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "today", "unsaid", "habit"],
        properties: { name: { type: "string", maxLength: 30 }, today: { type: "string", maxLength: 140 }, unsaid: { type: "string", maxLength: 140 }, habit: { type: "string", maxLength: 100 } },
      },
    },
  },
};
/**
 * One call on the writer's model after the premise is chosen: every character
 * says, in their own voice, what they meant to do today (their own business),
 * one thing they have not told the hero, and a habit or a thing they carry.
 * Characters with their own business collide; things unsaid and things carried
 * are what a later page can pick up again. Nothing here must be used.
 */
const TIES_PROPERTY = {
  type: "array",
  maxItems: 8,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["from", "to", "wants", "knows"],
    properties: { from: { type: "string", maxLength: 30 }, to: { type: "string", maxLength: 30 }, wants: { type: "string", maxLength: 120 }, knows: { type: "string", maxLength: 120 } },
  },
};
/** R56: the staged room also asks what stands between the characters (who wants what of whom; what one knows and the other does not). */
const STAGED_CAST_SCHEMA = { ...CAST_NOTES_SCHEMA, required: ["notes", "ties"], properties: { ...CAST_NOTES_SCHEMA.properties, ties: TIES_PROPERTY } };
const tiesLine = " 그리고 인물 사이(ties — 인물이 둘 이상이면 두 개에서 여섯 개): 누가(from) 누구에게(to) 바라는 것 하나(wants — 해 줬으면 하는 일; 눈에 보이는 것으로)와, from만 알고 to는 모르는 것 하나(knows — 없으면 빈 문자열). 주인공과 조연 사이만이 아니라 조연끼리도요.";
/** R60: the body kinds a new character's sheet is drawn from (an animal sheet is not a child's sheet with a muzzle). */
export const BUILDS = Object.freeze(["human", "four-legged", "upright-animal", "bird", "object", "other"]);
const COUNTED_NOTES_SCHEMA = (premise) => {
  const cast = list(premise?.cast).filter((c) => object(c) && c.isNew === true && str(c.name, 30)),
    places = premisePlaces(premise).filter((p) => p.isNew);
  return {
    type: "object",
    additionalProperties: false,
    required: ["notes", "ties", ...(cast.length ? ["looks"] : []), ...(places.length ? ["placeLooks"] : [])],
    properties: {
      notes: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", additionalProperties: false, required: ["name", "today", "unsaid"], properties: { name: { type: "string", maxLength: 30 }, today: { type: "string", maxLength: 140 }, unsaid: { type: "string", maxLength: 140 } } } },
      ties: { ...TIES_PROPERTY, maxItems: 3 },
      ...(cast.length ? { looks: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["name", "build", "look"], properties: { name: { type: "string", maxLength: 30 }, build: { type: "string", enum: [...BUILDS] }, look: { type: "string", maxLength: 240 } } } } } : {}),
      ...(places.length ? { placeLooks: { type: "array", maxItems: 5, items: { type: "object", additionalProperties: false, required: ["name", "look", "layout"], properties: { name: { type: "string", maxLength: 30 }, look: { type: "string", maxLength: 200 }, layout: { type: "string", maxLength: 200 } } } } } : {}),
    },
  };
};
/** R60: the illustrator's lines for the chosen premise's new characters and places (an instruction to the artist, not the writer). */
const lookLines = (premise) => {
  const cast = list(premise?.cast).filter((c) => object(c) && c.isNew === true && str(c.name, 30)),
    places = premisePlaces(premise).filter((p) => p.isNew);
  return [
    cast.length
      ? ` 이 책의 새 인물(${cast.map((c) => str(c.name, 30)).join(", ")})은 그림 시트를 그릴 화가에게 한 줄씩 적어 줘요(looks, 영어): build(몸 종류 — human, four-legged, upright-animal, bird, object, other 중 하나)와 look — 처음 보는 화가에게 말하듯, 주인공과 견준 키, 색과 그 색이 있는 곳, 앞에서도 뒤에서도 보이는 표시 하나, 입거나 늘 지닌 것(없으면 nothing). 다른 인물에 빗대지 않고, 이 책에서 하는 일·표정·자세·드는 물건은 적지 않아요.`
      : "",
    places.length
      ? ` 이 책의 새 장소(${places.map((p) => p.name).join(", ")})도 화가에게 적어 줘요(placeLooks, 영어): look — 땅·벽·하늘 같은 큰 색 둘과 아이가 알아볼 붙박이 하나; layout — 한 자리에서 본 모습: 왼쪽에 무엇, 오른쪽에 무엇, 가운데 뒤에 무엇. 사람·날씨·시간은 적지 않아요.`
      : "",
  ].join("");
};
export function castNotesRequest(input, premise) {
  const stages = hasRoomStages(input);
  // R60: no habit (it gave every character a prop), today not told to stay away from the hero, the ties optional and few;
  // the looks of the chosen premise's new characters and places are asked here, once.
  if (hasRoomCounted(input)) {
    const places = premisePlaces(premise).filter((p) => p.isNew);
    return {
      system:
        `너는 그림책 작가예요. 초고를 쓰기 전에 이 책의 인물을 한 사람씩 만나 봐요. 인물마다 그 인물의 입으로 짧게 적어요: 오늘 하려던 제 볼일(today — 이 인물이 오늘 하고 싶었던 일; 눈에 보이는 행동으로), 주인공에게 말하지 않은 것 하나(unsaid — 알면서 말 안 한 것, 감춘 것, 부끄러운 것; 작고 구체적으로${hasRoomKept(input) ? "; 그런 것이 없는 인물은 빈 문자열" : ""}). 인물끼리 서로 다르게, 어느 책에나 있는 것 말고 이 인물만의 것으로.` +
        " 인물 사이(ties)는 없어도 되고 셋까지예요: 누가(from) 누구에게(to) 바라는 것 하나(wants — 해 줬으면 하는 일; 눈에 보이는 것으로)와, from만 알고 to는 모르는 것 하나(knows — 없으면 빈 문자열)." +
        lookLines(premise) +
        " 이건 재료예요 — 줄거리를 정하지 않아요.",
      user: `[이 책] 주제: ${str(input?.topic, 80) || "자유"}\n\n[전제]\n${str(premise?.title, 40)} — ${str(premise?.line, 300)}\n\n[인물표]\n${castRows(premise)}${places.length ? `\n\n[새 장소]\n${places.map((p) => `- ${p.name}${p.type ? ` (${p.type})` : ""}`).join("\n")}` : ""}${hasRoomKept(input) && sequelBlock(input) ? `\n\n${sequelBlock(input)}` : ""}`,
      jsonSchema: COUNTED_NOTES_SCHEMA(premise),
      temperature: 1,
      maxTokens: 3000,
    };
  }
  return {
    system: "너는 그림책 작가예요. 초고를 쓰기 전에 이 책의 인물을 한 사람씩 만나 봐요. 인물마다 그 인물의 입으로 짧게 적어요: 오늘 하려던 제 볼일(today — 주인공의 일과 상관없이 이 인물이 오늘 하고 싶었던 일; 눈에 보이는 행동으로), 주인공에게 말하지 않은 것 하나(unsaid — 알면서 말 안 한 것, 감춘 것, 부끄러운 것; 작고 구체적으로), 버릇이나 늘 지니는 물건 하나(habit — 그림에 그릴 수 있는 것). 인물끼리 서로 다르게, 어느 책에나 있는 것 말고 이 인물만의 것으로." + (stages ? tiesLine : "") + " 이건 재료예요 — 줄거리를 정하지 않아요.",
    user: `[이 책] 주제: ${str(input?.topic, 80) || "자유"}\n\n[전제]\n${str(premise?.title, 40)} — ${str(premise?.line, 300)}\n\n[인물표]\n${castRows(premise)}`,
    jsonSchema: stages ? STAGED_CAST_SCHEMA : CAST_NOTES_SCHEMA,
    temperature: 1,
    maxTokens: 2500,
  };
}
/** The notes of the premise's own cast, one per name; anything else is dropped. */
export function settleCastNotes(raw, premise) {
  const names = new Set(list(premise?.cast).map((c) => str(c?.name, 30)).filter(Boolean)),
    seen = new Set();
  return list(raw?.notes)
    .filter(object)
    .map((n) => ({ name: str(n.name, 30), today: str(n.today, 140), unsaid: str(n.unsaid, 140), habit: str(n.habit, 100), ...(str(n.turn, 120) ? { turn: str(n.turn, 120) } : {}) }))
    .filter((n) => names.has(n.name) && !seen.has(n.name) && (n.today || n.unsaid || n.habit) && seen.add(n.name))
    .slice(0, 8);
}
/**
 * R60: the looks the cast-notes call gave for the chosen premise's NEW characters and places — by name, one each;
 * anything else (a parent's character, a made-up name, an empty line) is dropped. An unreadable answer gives none,
 * and the cards keep the kind alone.
 */
export function settleRoomLooks(raw, premise) {
  const newCast = new Set(list(premise?.cast).filter((c) => object(c) && c.isNew === true).map((c) => str(c.name, 30)).filter(Boolean)),
    newPlaces = new Set(premisePlaces(premise).filter((p) => p.isNew).map((p) => p.name)),
    seen = new Set();
  const cast = list(raw?.looks)
    .filter(object)
    .map((l) => ({ name: str(l.name, 30), build: BUILDS.includes(str(l.build, 20)) ? str(l.build, 20) : "other", look: str(l.look, 240) }))
    .filter((l) => newCast.has(l.name) && l.look && !seen.has(l.name) && seen.add(l.name));
  const places = list(raw?.placeLooks)
    .filter(object)
    .map((l) => ({ name: str(l.name, 30), look: str(l.look, 200), layout: str(l.layout, 200) }))
    .filter((l) => newPlaces.has(l.name) && (l.look || l.layout) && !seen.has(`@${l.name}`) && seen.add(`@${l.name}`));
  return { cast, places };
}
/**
 * R60: where the things the ending uses are first HEARD — counted from the words of each page, not the art notes
 * (the paid book's ladle was in an art note on page 2 and first in the words on page 15, and the thread check counted
 * the note as the plant). Things whose first page in the words is among the last four are listed, with the earlier
 * pages whose art note named them. A fact for the rewrite, never a rule: "" when nothing comes late.
 */
export function firstHeardNotes(pages, things = [], { names = [] } = {}) {
  const rows = list(pages).filter(object),
    tail = Math.max(1, rows.length - 3),
    cast = list(names).map((n) => str(n, 30)).filter(Boolean),
    seen = new Set(),
    out = [];
  for (const raw of list(things)) {
    const what = str(raw, 40),
      // The head noun of the phrase ("엄마의 나무 국자" → 국자); a nominalized verb ("…찍기") falls back to the first noun ("장화").
      stems = koWords(what).filter((w) => w.length >= 2 && !cast.some((n) => n.startsWith(w) || w.startsWith(n))),
      head = stems.length ? (/기$/u.test(stems.at(-1)) ? stems[0] : stems.at(-1)) : "";
    if (!what || !head || seen.has(what)) continue;
    seen.add(what);
    const heard = (text) => koWords(text).includes(head);
    const first = rows.findIndex((p) => heard(p.ko ?? p.textKo));
    if (first !== -1 && first + 1 < tail) continue;
    const art = rows.map((p, i) => (heard(p.art) && (first === -1 || i < first) ? i + 1 : 0)).filter(Boolean);
    out.push(`${what}: ${first === -1 ? "글에는 나오지 않아요" : `글에는 ${first + 1}쪽에 처음 나와요`}${art.length ? ` — 그 앞은 그림 메모뿐(${art.join("·")}쪽)` : ""}`);
    if (out.length >= 4) break;
  }
  return out.length ? `끝이 쓰는 것이 글에 처음 들리는 쪽 (글만 듣는 아이 기준): ${out.join(" / ")}` : "";
}
/** R56: the ties between the premise's own characters — one per ordered pair, with something in it. */
export function settleTies(raw, premise) {
  const names = new Set(list(premise?.cast).map((c) => str(c?.name, 30)).filter(Boolean)),
    seen = new Set();
  return list(raw?.ties)
    .filter(object)
    .map((t) => ({ from: str(t.from, 30), to: str(t.to, 30), wants: str(t.wants, 120), knows: str(t.knows, 120) }))
    .filter((t) => names.has(t.from) && names.has(t.to) && t.from !== t.to && (t.wants || t.knows) && !seen.has(`${t.from}→${t.to}`) && seen.add(`${t.from}→${t.to}`))
    .slice(0, 8);
}
export const castNotesBlock = (notes, ties = []) =>
  [
    list(notes).length
      ? `[인물들이 제 입으로 한 말 — 재료예요, 점검표가 아니에요. 쓰고 싶은 것만 써요]\n${list(notes)
          .map((n) => `- ${n.name}: ${[n.today && `오늘 하려던 일 — ${n.today}`, n.unsaid && `말 안 한 것 — ${n.unsaid}`, n.habit && `버릇·물건 — ${n.habit}`, n.turn && `이 이야기에서 — ${n.turn}`].filter(Boolean).join("; ")}`)
          .join("\n")}`
      : "",
    list(ties).length ? `[인물 사이 — 재료예요]\n${list(ties).map((t) => `- ${t.from} → ${t.to}: ${[t.wants && `바라는 것 — ${t.wants}`, t.knows && `혼자 아는 것 — ${t.knows}`].filter(Boolean).join("; ")}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
/* ---------- R56: the treatment — a half-page flow and a short plant-and-pay-off memo, the writer's own working note ---------- */
export const FLOW_COUNT = 3;
const FLOW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["flow", "plants"],
  properties: {
    flow: { type: "string", maxLength: 1600 },
    plants: {
      type: "array",
      maxItems: 4,
      items: { type: "object", additionalProperties: false, required: ["what", "plant", "payoff"], properties: { what: { type: "string", maxLength: 60 }, plant: { type: "string", maxLength: 120 }, payoff: { type: "string", maxLength: 120 } } },
    },
  },
};
/**
 * Three treatments, one for each way of weaving (DRAFT_WEAVES), on the
 * writer's model in parallel. Prose, not a form: how the scenes follow, who
 * runs into whom, where it turns and how it ends — and up to four things put
 * down early and picked up later. No page numbers, no beats, nothing checked.
 */
export function treatmentRequest(input, premise, { records = [], castNotes = [], ties = [] } = {}, i = 0, count = FLOW_COUNT) {
  const cast = castNotesBlock(castNotes, ties);
  return {
    system: "너는 그림책 작가예요. 초고를 쓰기 전에 이 책의 흐름을 반 쪽짜리 줄글로 적어 봐요(flow) — 장면이 어떻게 이어지는지, 누가 무엇을 하다 누구와 부딪치는지, 어디서 뒤집히고 어떻게 끝나는지. 쪽 번호도 비트도 없어요. 그리고 '심고 거두기' 메모(plants — 없어도 되고 넷까지): 앞에 아무렇지 않게 놓였다가 뒤에서 다시 쓰이는 것 — 무엇을(what), 어디에 어떻게 놓고(plant), 어디서 어떻게 거두는지(payoff). 글이 아니라 그림에만 놓아도 돼요." + NO_LETTERS + " 인물들의 말은 재료예요 — 제 볼일이 있는 인물끼리는 부딪치고, 말 안 한 것과 지닌 물건은 뒤에서 다시 집어 들 수 있어요. 이건 네 작업 노트예요: 초고를 쓰다 더 좋은 길이 보이면 벗어나도 돼요.",
    user: `${roomBrief(input, { records })}\n\n[전제]\n${str(premise?.title, 40)} — ${str(premise?.line, 300)}\n모양: ${str(premise?.engine, 40)}\n가장 큰 웃음: ${str(premise?.laugh, 200)}\n아이가 보고 싶을 그림: ${str(premise?.picture, 200)}\n\n[인물표]\n${castRows(premise)}${cast ? `\n\n${cast}` : ""}\n\n[흐름 ${i + 1}/${count} — ${DRAFT_WEAVES[i % DRAFT_WEAVES.length]}]`,
    jsonSchema: FLOW_SCHEMA,
    temperature: 0.9,
    maxTokens: 3000,
  };
}
export function settleTreatment(raw) {
  const flow = str(raw?.flow, 1600);
  if (!flow) return null;
  const plants = list(raw?.plants)
    .filter(object)
    .map((p) => ({ what: str(p.what, 60), plant: str(p.plant, 120), payoff: str(p.payoff, 120) }))
    .filter((p) => p.what && (p.plant || p.payoff))
    .slice(0, 4);
  return { flow, plants };
}
export const flowBlock = (treatment) =>
  object(treatment) && treatment.flow
    ? `[흐름 — 네 작업 노트예요. 쓰다가 더 좋은 길이 보이면 벗어나도 돼요]\n${treatment.flow}${list(treatment.plants).length ? `\n[심고 거두기]\n${treatment.plants.map((p) => `- ${p.what}: ${p.plant || "(앞쪽 어딘가)"} → ${p.payoff || "(뒤에서)"}`).join("\n")}` : ""}`
    : "";
/** The panel hears the treatments: the one each wants to hear told, the next, and the ones they could not follow. */
export function panelFlowsRequest(input, treatments) {
  const count = list(treatments).length;
  return {
    system: `너는 여섯 사람이에요. 작가가 책을 쓰기 전에 이야기의 흐름 ${count}가지를 들려줘요. 각자 가장 듣고 싶은 흐름 하나(favorite)와 그다음 하나(second — favorite와 다른 번호), 까닭 한마디(why), 무슨 일이 벌어지는지 따라갈 수 없던 흐름의 번호들(lost — 없으면 빈 목록)을 말해요. 점수는 없어요. 예의 차리지 말고 그 사람답게.\n\n[여섯 사람]\n${panelText(input)}`,
    user: list(treatments).map((t, i) => `=== 흐름 ${i + 1} ===\n${str(t?.flow, 1600)}${list(t?.plants).length ? `\n(앞에 놓였다가 뒤에서 다시 쓰이는 것: ${t.plants.map((p) => p.what).join(", ")})` : ""}`).join("\n\n"),
    jsonSchema: {
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
            required: ["reader", "favorite", "second", "why", "lost"],
            properties: { reader: { type: "string", enum: PANEL_IDS }, favorite: { type: "integer", minimum: 1, maximum: count }, second: { type: "integer", minimum: 1, maximum: count }, why: { type: "string", maxLength: 100 }, lost: { type: "array", maxItems: count, items: { type: "integer", minimum: 1, maximum: count } } },
          },
        },
      },
    },
    temperature: 0.7,
    maxTokens: 2500,
  };
}
/** Per treatment: first choices × 3 + second choices − 2 for every reader who could not follow it. */
export function countFlows(answer, treatments) {
  const count = list(treatments).length,
    rows = Array.from({ length: count }, (_, i) => ({ flow: i + 1, first: 0, second: 0, lost: 0, pull: 0, why: [] }));
  for (const reader of list(answer?.readers).filter(object)) {
    const fav = Math.round(Number(reader.favorite)),
      next = Math.round(Number(reader.second));
    if (fav >= 1 && fav <= count) {
      rows[fav - 1].first += 1;
      if (str(reader.why, 100)) rows[fav - 1].why.push(str(reader.why, 100));
    }
    if (next >= 1 && next <= count && next !== fav) rows[next - 1].second += 1;
    for (const n of new Set(list(reader.lost).map((v) => Math.round(Number(v))).filter((v) => v >= 1 && v <= count))) rows[n - 1].lost += 1;
  }
  return rows.map((r) => ({ ...r, pull: r.first * 3 + r.second - r.lost * 2, why: r.why.slice(0, 3) }));
}
/** The most wanted; a tie goes to the treatment that puts more down to pick up later, then to the writer's order. */
export function pickFlow(rows, treatments) {
  const plants = (n) => list(list(treatments)[n - 1]?.plants).length;
  return [...list(rows)].sort((a, b) => b.pull - a.pull || plants(b.flow) - plants(a.flow) || a.flow - b.flow)[0]?.flow || 1;
}
/** R56: the cast notes revised once for the chosen flow (the same three lines, plus what the character decides or how they change in this story). */
export function castReviseRequest(input, premise, notes, ties, treatment) {
  return {
    system: "너는 이 책의 작가예요. 흐름이 정해졌어요. 인물 노트를 이 흐름에 맞춰 한 번 고쳐요: 인물마다 제 볼일(today)·말 안 한 것(unsaid)·버릇이나 지닌 물건(habit)을 이 흐름에서 실제로 쓰이게 다듬고(그대로 좋으면 그대로 돌려줘요), 이 이야기에서 그 인물이 한 번 하는 결정이나 처음과 달라지는 점(turn — 한 줄; 정말 없으면 빈 문자열)을 더해요. 흐름에서 할 일이 없는 인물은 제 볼일이 흐름 옆에서 한 번 보이게 해요. 이건 재료예요 — 초고가 다 쓰지 않아도 돼요.",
    user: `[전제]\n${str(premise?.title, 40)} — ${str(premise?.line, 300)}\n\n[인물표]\n${castRows(premise)}\n\n${castNotesBlock(notes, ties)}\n\n${flowBlock(treatment)}`,
    jsonSchema: {
      ...CAST_NOTES_SCHEMA,
      properties: { notes: { ...CAST_NOTES_SCHEMA.properties.notes, items: { ...CAST_NOTES_SCHEMA.properties.notes.items, required: ["name", "today", "unsaid", "habit", "turn"], properties: { ...CAST_NOTES_SCHEMA.properties.notes.items.properties, turn: { type: "string", maxLength: 120 } } } } },
    },
    temperature: 0.8,
    maxTokens: 2500,
  };
}
/* ---------- R56: the editor's thread check — what was kept, what was left loose, what came from nowhere ---------- */
const threadRow = (keys) => ({ type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, required: ["what", ...keys], properties: { what: { type: "string", maxLength: 60 }, ...Object.fromEntries(keys.map((k) => [k, { type: "integer", minimum: 1 }])) } } });
export function threadCheckRequest(input, draft, treatment) {
  const plants = list(treatment?.plants);
  return {
    system: "너는 이 원고를 처음부터 끝까지 읽는 편집자예요. 고치지 않고 세 가지만 찾아 적어요: 앞에 놓였다가 뒤에서 다시 쓰인 것(kept — 무엇, 놓인 쪽 from, 다시 쓰인 쪽 to), 앞에 눈에 띄게 놓였는데 끝까지 다시 쓰이지 않은 것(loose — 무엇, 놓인 쪽 page), 뒤에서 중요하게 쓰이는데 앞에 한 번도 보이지 않은 것(unplanted — 무엇, 처음 쓰인 쪽 page). 없으면 빈 목록이에요 — 지어내지 않아요. [그림: …]은 그 쪽 그림에만 보이는 것이에요." + (hasRoomCounted(input) ? " 놓인 쪽(from)은 글에 처음 나온 쪽이에요 — [그림: …]에만 있던 것은 글을 듣는 아이에게는 아직 놓이지 않은 것이라, 글에 처음 나오는 쪽이 뒤라면 unplanted로 적어요." : ""),
    user: `${plants.length ? `[작가의 심고 거두기 메모]\n${plants.map((p) => `- ${p.what}: ${p.plant} → ${p.payoff}`).join("\n")}\n\n` : ""}=== 원고 · ${str(draft?.title, 40)} ===\n${list(draft?.pages).map(pageLine).join("\n")}`,
    jsonSchema: { type: "object", additionalProperties: false, required: ["kept", "loose", "unplanted"], properties: { kept: threadRow(["from", "to"]), loose: threadRow(["page"]), unplanted: threadRow(["page"]) } },
    temperature: 0.2,
    maxTokens: 2000,
  };
}
/** Only what names real pages: kept needs an earlier and a later page, the others a page of the draft. */
export function settleThreads(raw, pageCount) {
  const page = (v) => {
    const n = Math.round(Number(v));
    return n >= 1 && n <= pageCount ? n : 0;
  };
  const rows = (key) => list(raw?.[key]).filter(object).map((r) => ({ what: str(r.what, 60), from: page(r.from), to: page(r.to), page: page(r.page) })).filter((r) => r.what);
  return {
    kept: rows("kept").filter((r) => r.from && r.to > r.from).map(({ what, from, to }) => ({ what, from, to })).slice(0, 4),
    loose: rows("loose").filter((r) => r.page).map(({ what, page: at }) => ({ what, page: at })).slice(0, 4),
    unplanted: rows("unplanted").filter((r) => r.page).map(({ what, page: at }) => ({ what, page: at })).slice(0, 4),
  };
}
/* ---------- R62: the listener — the words alone, no pictures ---------- */
/**
 * R62: a parent reads the book aloud to a child who cannot see the pictures yet. One cheap call answers what a child
 * needs to follow the story from the words alone: why the strange thing happens, who each one is when they first act,
 * and the pages where you cannot tell what happened or who did it. Its answer is a note for the rewrite, never a gate.
 */
export function listenRequest(input, draft) {
  return {
    system: "너는 그림을 볼 수 없는 다섯 살 아이와 함께 이 책을 처음 듣는 어른이에요. 글만 들어요(그림 메모는 없어요). 고치지 않고, 들은 대로만 적어요: strange — 이 이야기에 보통과 다른 일(거꾸로 가는 길, 말하는 물건 같은)이 있으면 true; rule — 그 일이 왜·어떻게 일어나는지 글에서 들은 대로 한 문장(글이 말해 주지 않으면 빈 문자열); want — 주인공이 바라는 것 한 문장; who — 글에서 무언가 하거나 말하는 모든 인물(사람·동물·말하는 물건)과 처음 무언가 하는 쪽(page), 그 쪽에서 글이 누구인지(이름이나 무엇인지) 알려 주었는지(introduced); lost — 글만 들어서는 무슨 일인지, 누가 그랬는지, 왜 그런지 모르겠는 쪽(page)과 그 물음(question) — 다음 쪽까지 들어도 풀리지 않는 물음만(일부러 남긴 궁금증은 빼요), 4개까지. 모르겠는 게 없으면 빈 목록 — 지어내지 않아요.",
    user: `=== 원고 · ${str(draft?.title, 40)} ===\n${list(draft?.pages).map((p, i) => `${i + 1}쪽: ${str(p?.ko, 1200)}`).join("\n")}`,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["strange", "rule", "want", "who", "lost"],
      properties: {
        strange: { type: "boolean" },
        rule: { type: "string", maxLength: 200 },
        want: { type: "string", maxLength: 160 },
        who: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["name", "page", "introduced"], properties: { name: { type: "string", maxLength: 30 }, page: { type: "integer", minimum: 1 }, introduced: { type: "boolean" } } } },
        lost: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, required: ["page", "question"], properties: { page: { type: "integer", minimum: 1 }, question: { type: "string", maxLength: 140 } } } },
      },
    },
    temperature: 0.2,
    maxTokens: 1500,
  };
}
/** The listener's answer with real pages only (an unreadable answer is null: the rewrite goes on without it). */
export function settleListen(raw, pageCount) {
  if (!object(raw)) return null;
  const page = (v) => {
    const n = Math.round(Number(v));
    return n >= 1 && n <= pageCount ? n : 0;
  };
  return {
    strange: raw.strange === true,
    rule: str(raw.rule, 200),
    want: str(raw.want, 160),
    who: list(raw.who).filter(object).map((r) => ({ name: str(r.name, 30), page: page(r.page), introduced: r.introduced !== false })).filter((r) => r.name && r.page).slice(0, 8),
    lost: list(raw.lost).filter(object).map((r) => ({ page: page(r.page), question: str(r.question, 140) })).filter((r) => r.page && r.question).slice(0, 4),
  };
}
export const listenNeedsWork = (listen) => !!(listen && ((listen.strange && !listen.rule) || listen.who.some((w) => !w.introduced) || listen.lost.length));
/** The pages the listener points at (for the rewrite's scope): the lost pages, the first pages of the unintroduced, and the opening when the rule is never said. */
export function listenPages(listen) {
  if (!listen) return [];
  return [...listen.lost.map((r) => r.page), ...listen.who.filter((w) => !w.introduced).map((w) => w.page), ...(listen.strange && !listen.rule ? [1, 2] : [])];
}
export function listenNotes(listen) {
  if (!listen) return "";
  const lines = [];
  if (listen.strange && !listen.rule) lines.push("그림 없이 들으면 이 이야기의 신기한 일이 왜·어떻게 일어나는지 알 수 없어요 — 앞쪽에서 한 번은 글로 분명히 알려 줘요(인물의 말이나 행동으로, 그림에만 맡기지 않아요).");
  const strangers = listen.who.filter((w) => !w.introduced);
  if (strangers.length) lines.push(`누구인지 모른 채 나오는 인물: ${strangers.map((w) => `${w.name}(${w.page}쪽)`).join(" / ")} — 처음 나오는 쪽에서 누구인지 한 줄로 알려 줘요.`);
  if (listen.lost.length) lines.push(`그림 없이 들으면 모르는 곳: ${listen.lost.map((r) => `${r.page}쪽 — ${r.question}`).join(" / ")} — 그 쪽 글이 답하게 고쳐요.`);
  return lines.join("\n");
}
/* ---------- R63: the picture director — the reading checked against the words before any picture is bought ---------- */
/**
 * R63: one call on the middle model reads every page's words next to its picture fields and corrects only the picture
 * fields: an action that belongs to another page (a reading shifted by one), two moments on one page, a speaker or
 * counter left out of who, a mustSee that misses what the page is about, an unusual move without a side-view pose, a
 * plain backdrop where distance tells the story. It never changes the words, the pages or the cast's looks, and never
 * adds anyone the words do not name. A few lines for the parent (what the words never make clear) ride along.
 */
export function directorRequest(input, pages) {
  const cast = list(input?.characters).filter(object).map((c) => `${str(c.name, 30)}${c.nameEn ? ` (${str(c.nameEn, 30)})` : ""}`).join(", ");
  const rows = list(pages).map((p, i) => {
    const sc = p?.scene || {};
    return `${i + 1}쪽: ${str(p?.textKo, 600)}${p?.textEn ? `\n   EN: ${str(p.textEn, 600)}` : ""}\n   [picture] who: ${list(sc.who).join(", ")}${list(sc.extras).length ? ` | walk-ons: ${sc.extras.map((x) => `${x.name} (${x.look})`).join(", ")}` : ""} | where: ${sc.stage ? `${sc.stage.name} — map: ${sc.stage.map}` : sc.where || ""}${list(sc.things).length ? ` | things: ${sc.things.map((t) => t.name).join(", ")}` : ""} | action: ${str(sc.action, 300)} | mustSee: ${list(sc.mustSee).join(" / ")}${sc.pose ? ` | pose: ${sc.pose}` : ""} | shot: ${p?.picturePlan?.shot || p?.staging?.shot || "-"}${p?.backdrop === "plain" ? " | plain backdrop" : ""}`;
  });
  return {
    system: `You are the art director of a picture book. Each page below has its printed words and the picture plan an assistant wrote for it. Check every picture plan against its OWN page's words, in order, and correct only the plan — never the words. Correct when: the action belongs to another page (treat the plans as shifted only when several actions in a row match a neighbouring page's words) or shows two moments; someone in the cast who speaks, counts or acts in this page's words is missing from who (use the names as written in the cast list); mustSee misses what a child must see to understand this page; someone moves in an unusual way and there is no side-view pose, or the pose does not begin with whose pose it is (\"Mina, seen from the side: faces LEFT … moves RIGHT …\"); the action contradicts the pose (no \"facing the viewer\" with a side-view pose) — rewrite the action to agree; a plain backdrop hides a distance or a place the story depends on. Walk-ons are already listed — never add a cast member or a thing the words do not name. Leave a page out when its plan is right. Also notes: up to three short Korean lines for the parent about what the words never make clear (a rule of the story, who someone is) — empty when none.\n\n[cast] ${cast || "(none)"}`,
    user: rows.join("\n"),
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fixes", "notes"],
      properties: {
        fixes: { type: "array", maxItems: 24, items: { type: "object", additionalProperties: false, required: ["page", "action", "mustSee", "pose", "addWho", "scene", "why"], properties: { page: { type: "integer", minimum: 1 }, action: { type: "string", maxLength: 300 }, mustSee: { type: "array", maxItems: 2, items: { type: "string", maxLength: 120 } }, pose: { type: "string", maxLength: 240 }, addWho: { type: "array", maxItems: 3, items: { type: "string", maxLength: 40 } }, scene: { type: "boolean" }, why: { type: "string", maxLength: 140 } } } },
        notes: { type: "array", maxItems: 3, items: { type: "string", maxLength: 160 } },
      },
    },
    temperature: 0.2,
    maxTokens: 1500 + list(pages).length * 120,
  };
}
/** R63: the director's corrections applied to the picture fields only; a name added to who must appear in the words within two pages. */
export function applyDirector(pages, raw, input) {
  const rows = list(pages);
  const out = { fixed: [], notes: [], refused: [] };
  if (!object(raw)) return out;
  const people = list(input?.characters).filter(object);
  const idOf = (name) => {
    const n = String(name || "").trim().toLowerCase();
    return people.find((c) => [c.id, c.name, c.nameEn].some((v) => String(v || "").trim().toLowerCase() === n))?.id || "";
  };
  const near = (i, c) => [rows[i - 2], rows[i - 1], rows[i], rows[i + 1], rows[i + 2]].filter(object).some((p) => [c.name, c.nameEn].filter(Boolean).some((n) => `${p.textKo || ""} ${p.textEn || ""}`.toLowerCase().includes(String(n).toLowerCase())));
  for (const f of list(raw.fixes).filter(object)) {
    const k = Math.round(Number(f.page)), p = rows[k - 1];
    if (!p?.scene) { out.refused.push(`${k}쪽`); continue; }
    const changed = [];
    if (str(f.action, 300)) { p.scene.action = str(f.action, 300); changed.push("action"); }
    const must = list(f.mustSee).map((v) => str(v, 120)).filter(Boolean).slice(0, 2);
    if (must.length) { p.scene.mustSee = must; changed.push("mustSee"); }
    if (str(f.pose, 240)) { p.scene.pose = str(f.pose, 240); changed.push("pose"); }
    for (const name of list(f.addWho)) {
      const id = idOf(name), c = people.find((x) => x.id === id);
      if (!id || !c || list(p.scene.who).includes(id)) continue;
      if (!near(k - 1, c)) { out.refused.push(`${k}쪽 ${str(name, 40)}: 글에 없음`); continue; }
      if (list(p.scene.who).length < 5) { p.scene.who = [...list(p.scene.who), id]; changed.push(`who+${id}`); }
    }
    if (f.scene === true && p.backdrop === "plain") { delete p.backdrop; changed.push("scene"); }
    if ((p.scene.pose) && p.backdrop === "plain") delete p.backdrop;
    if (changed.length) out.fixed.push({ page: k, changed, why: str(f.why, 140) });
  }
  out.notes = list(raw.notes).map((v) => str(v, 160)).filter(Boolean).slice(0, 3);
  return out;
}
/* ---------- R63: the page editor — the bound pages read the way the book will print them ---------- */
/**
 * R63: after the Korean is bound into pages (and before the English), the editor reads page by page as a child hears
 * them with a page turn in between, and may do three things only: move a page boundary by one sentence (a question
 * and its answer, a line and its speaker, a cause and its result belong on one page; a surprise opens the next page),
 * make the smallest fix to a page whose who/where/what is lost after the turn (three pages at most), and leave the
 * illustrator a continuity note per page (what carries over from the page before). Never the plot, never a page the
 * readers laughed at, never a spread mark.
 */
export function pageEditRequest(input, pages, cast = []) {
  const people = list(cast).filter(object).map((c) => `${str(c.name, 30)}${str(c.who, 80) ? ` — ${str(c.who, 80)}` : ""}`).filter(Boolean);
  return {
    system: "너는 그림책 편집자예요. 아래는 쪽으로 나눈 책이에요 — 아이는 한 쪽을 듣고 쪽을 넘겨요. 처음부터 한 쪽씩, 앞쪽에 이어 읽으며 세 가지만 해요. 줄거리·인물·결말은 바꾸지 않아요. 고칠 게 없으면 빈 목록이에요 — 지어내지 않아요.\n1) moves — 쪽 경계에서 갈라지면 안 되는 것이 갈라졌을 때(질문과 대답, 말과 그 말을 한 사람, 앞일과 바로 그 결과): 경계를 한 문장만 옮겨요. after = n(n쪽과 n+1쪽 사이), shift = 1이면 n+1쪽의 첫 문장을 n쪽 끝으로, -1이면 n쪽의 끝 문장을 n+1쪽 처음으로. 넘겨서 놀라야 할 문장은 다음 쪽 첫머리에 둬요. (큰 그림)의 두 쪽 사이와 되풀이·셈 문장은 옮기지 않아요. 4개까지.\n2) fixes — 앞쪽에 이어 들어도 누가 말하는지·어디인지·무슨 일인지 알 수 없는 쪽만, 그 쪽 글 전체를 가장 작게 고쳐 돌려줘요(ko). 고치지 않아도 되는 문장은 글자 그대로 두고, 되풀이·셈 문장은 고치지 않고, 문장은 한 개까지만 더해요. why에 무엇이 빠졌었는지 한 줄. 3쪽까지.\n3) art — 그림 그리는 사람에게 쪽마다 짧은 영어 메모: 앞쪽에서 이어지는 것(같은 곳인지 새 곳인지, 아직 그 자리에 있는 인물, 손에 든 것, 시간·날씨), 글에 새로 나왔는데 그림 메모에 없는 인물·물건. 글이나 그림 메모에 이미 있는 것만 적어요 — 지어내지 않아요. 앞쪽과 이어지는 게 없는 쪽은 적지 않아요. 16개까지.\n[그림: …]은 작가의 그림 메모, (큰 그림)은 두 쪽에 걸친 그림이에요.",
    user: `${people.length ? `[인물]\n${people.join("\n")}\n\n` : ""}=== 쪽으로 나눈 책 ===\n${list(pages).map(markedPageLine).join("\n")}`,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["moves", "fixes", "art"],
      properties: {
        moves: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, required: ["after", "shift"], properties: { after: { type: "integer", minimum: 1 }, shift: { type: "integer", enum: [1, -1] } } } },
        fixes: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, required: ["page", "ko", "why"], properties: { page: { type: "integer", minimum: 1 }, ko: { type: "string", maxLength: 1200 }, why: { type: "string", maxLength: 140 } } } },
        art: { type: "array", maxItems: 16, items: { type: "object", additionalProperties: false, required: ["page", "note"], properties: { page: { type: "integer", minimum: 1 }, note: { type: "string", maxLength: 140 } } } },
      },
    },
    temperature: 0.3,
    maxTokens: 3000,
  };
}
/**
 * R63: the editor's answer applied by the app — every change checked: a boundary move keeps the sentence cap, never
 * empties a page and never touches a spread-marked page; a fix keeps at least half of the page's sentences word for
 * word, adds at most one, stays within the cap and never touches a page holding words the readers laughed at; a
 * continuity note joins the page's art note. Returns the pages and what was applied and refused.
 */
export function applyPageEdit(pages, raw, { cap = 0, guarded = [] } = {}) {
  let rows = list(pages).map((p) => ({ ...p }));
  const applied = { moves: [], fixes: [], art: 0 },
    refused = [];
  if (!object(raw)) return { pages: rows, applied, refused };
  const n = rows.length,
    within = (k) => Number.isInteger(k) && k >= 1 && k <= n,
    capOk = (ko) => !cap || sentences(ko).length <= cap,
    held = (p) => guarded.some((g) => g && flat(p?.ko).includes(g));
  for (const m of list(raw.moves).filter(object).slice(0, 4)) {
    const after = Math.round(Number(m.after)),
      shift = Number(m.shift);
    if (!within(after) || !within(after + 1) || ![1, -1].includes(shift)) { refused.push(`경계 ${after}`); continue; }
    const a = rows[after - 1],
      b = rows[after];
    if (a.spread || b.spread) { refused.push(`경계 ${after}: 큰 그림`); continue; }
    const sa = sentences(a.ko),
      sb = sentences(b.ko);
    const [na, nb] = shift === 1 ? [[...sa, sb[0]], sb.slice(1)] : [sa.slice(0, -1), [sa.at(-1), ...sb]];
    if (!na.length || !nb.length || !capOk(na.join(" ")) || !capOk(nb.join(" "))) { refused.push(`경계 ${after}: 상한`); continue; }
    rows[after - 1] = { ...a, ko: na.join(" ") };
    rows[after] = { ...b, ko: nb.join(" ") };
    applied.moves.push({ after, shift });
  }
  for (const f of list(raw.fixes).filter(object).slice(0, 3)) {
    const k = Math.round(Number(f.page)),
      ko = str(f.ko, 1200);
    if (!within(k) || !ko) { refused.push(`${k}쪽 고침`); continue; }
    const was = rows[k - 1],
      before = sentences(was.ko),
      after = sentences(ko),
      // A small fix keeps the page's own words: at least 70% of its words are still there.
      words = flat(was.ko).split(" ").filter(Boolean),
      now = new Set(flat(ko).split(" ").filter(Boolean)),
      kept = words.filter((w) => now.has(w)).length;
    if (held(was)) { refused.push(`${k}쪽: 웃은 쪽`); continue; }
    if (!capOk(ko) || after.length > before.length + 1 || kept < words.length * 0.7) { refused.push(`${k}쪽: 너무 많이 바뀜`); continue; }
    rows[k - 1] = { ...was, ko };
    applied.fixes.push({ page: k, why: str(f.why, 140) });
  }
  for (const a of list(raw.art).filter(object).slice(0, 16)) {
    const k = Math.round(Number(a.page)),
      note = str(a.note, 140);
    if (!within(k) || !note) continue;
    const was = str(rows[k - 1].art, 200);
    rows[k - 1] = { ...rows[k - 1], art: str(was ? `${was} / ${note}` : note, 200) };
    applied.art++;
  }
  return { pages: rows, applied, refused };
}
export const threadsNeedWork = (threads) => !!(list(threads?.loose).length || list(threads?.unplanted).length);
export function threadNotes(threads) {
  if (!object(threads)) return "";
  const lines = [];
  if (list(threads.kept).length) lines.push(`심고 거둔 것: ${threads.kept.map((r) => `${r.what} ${r.from}쪽→${r.to}쪽`).join(" / ")} — 그대로 둬요.`);
  if (list(threads.loose).length) lines.push(`놓기만 하고 다시 쓰지 않은 것: ${threads.loose.map((r) => `${r.what} (${r.page}쪽)`).join(" / ")} — 뒤에서 한 번 쓰거나 빼요.`);
  if (list(threads.unplanted).length) lines.push(`앞에 없이 나온 것: ${threads.unplanted.map((r) => `${r.what} (${r.page}쪽)`).join(" / ")} — 앞쪽 한 곳에 그림 메모나 한 줄로 먼저 놓아요.`);
  return lines.join("\n");
}
/**
 * R55h: three drafts, three ways of weaving — the panel then has a real choice
 * between a straight book and a layered one (the three used to differ only by
 * "be different"). An approach for one candidate, not a rule for the book.
 */
export const DRAFT_WEAVES = Object.freeze([
  "한 줄기로 곧게 가요 — 네 식대로.",
  "두 줄기로 써 봐요 — 조연 한 사람의 제 볼일이 주인공의 일 옆에서 따로 흘러가다가 끝에서 두 줄기가 만나요. 둘째 줄기는 글 대신 그림 메모에만 실어도 돼요.",
  "끝에서부터 써 봐요 — 끝 장면을 먼저 정하고, 끝이 쓰는 물건·말·버릇 두세 가지를 앞쪽에 아무렇지 않게 놓아 둬요. 처음 읽을 땐 그냥 지나가고, 다시 읽을 때 '아, 그거!' 하게.",
]);
export const draftWeaveLine = (input, i, count, treatment = null) =>
  // R56: with a chosen flow the three drafts share the weave and differ in the telling.
  hasRoomStages(input) && object(treatment) && treatment.flow
    ? `[초고 ${i + 1}/${count} — 같은 흐름을 네 식대로: 화자·호흡·무엇을 그림에 맡길지는 이 초고만의 것으로]`
    : hasRoomWeave(input)
      ? `[초고 ${i + 1}/${count} — ${DRAFT_WEAVES[i % DRAFT_WEAVES.length]}]`
      : `[초고 ${i + 1}/${count} — 다른 초고와 다르게, 네 식대로]`;
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
/** R55h: a weave draft's page may carry an art note — what the picture shows and the words do not say. */
const WEAVE_DRAFT_SCHEMA = {
  ...DRAFT_SCHEMA,
  properties: {
    ...DRAFT_SCHEMA.properties,
    pages: { ...DRAFT_SCHEMA.properties.pages, items: { ...DRAFT_SCHEMA.properties.pages.items, properties: { ...DRAFT_SCHEMA.properties.pages.items.properties, art: { type: "string", maxLength: 200 } } } },
  },
};
const draftSchema = (input) => (hasRoomWeave(input) ? WEAVE_DRAFT_SCHEMA : DRAFT_SCHEMA);
/**
 * R56a (실측 2026-11-09): the paid draft carried its second thread as numerals lettered into the corners of
 * seven pictures ("귀퉁이에 작은 글씨로 '하나'") — the picture request forbids letters, so the thread would
 * not have been drawn. A fact about the medium, told wherever the writer is told about art notes.
 */
// R58 (2026-11-10): "then the rocket cannot say Apollo 13?" — the ban had lumped two things together. Explanatory lettering
// (a caption, a count in the corner) stays out; writing that is on a thing in the story's world (a rocket's name, a bus
// number, a sign) is allowed, one per picture, in digits and capital Latin letters only (the picture model garbles Hangul).
const NO_LETTERS = ' 그림에는 설명하는 글자나 숫자(자막, 귀퉁이의 표시)를 넣을 수 없어요 — 세는 것은 물건의 개수나 몸짓으로 보여요. 물건에 원래 적혀 있는 짧은 글자(로켓의 이름, 버스 번호, 간판)는 한 그림에 하나까지 돼요 — 숫자와 영문 대문자만, 그림 메모에 따옴표로 그대로 적어요("13", "APOLLO 13").';
// R61 (audit 4): a plant the ending needs to be understood is heard once in the words; a picture-only plant is the joy of a second look.
const HEARD_LINE = " 끝을 이해하는 데 꼭 필요한 것은 앞쪽 글에서 한 번은 들리게 해요(한 줄이면 돼요). 그림 메모에만 두는 것은 다시 볼 때 찾는 즐거움이에요.";
const artLine = (input) => (hasRoomWeave(input) ? ` 글은 말하지 않고 그림만 보여 줄 것이 있는 쪽에는 그림 메모(art)를 한 줄 적어요 — 뒤에서 쓰일 것을 미리 놓아 두거나, 조연이 제 볼일을 하는 모습처럼. 없는 쪽은 적지 않아요.${NO_LETTERS}${hasRoomKept(input) ? HEARD_LINE : ""}` : "");
const pageLine = (p, n) => `${n + 1}쪽: ${str(p?.ko, 1200)}${str(p?.art, 200) ? ` [그림: ${str(p.art, 200)}]` : ""}`;
/** R59: the same line with the writer's spread mark — the rewrite is shown what it is told to keep. */
const markedPageLine = (p, n) => `${n + 1}쪽${p?.spread === true ? " (큰 그림)" : ""}: ${str(p?.ko, 1200)}${str(p?.art, 200) ? ` [그림: ${str(p.art, 200)}]` : ""}`;
/** R54e: an openings book — the writer marks the pages that are one big picture. */
const spreadLine = (input) => (input?.layoutPolicy?.kind === "openings" ? " 큰 그림 한 장이 두 쪽에 걸쳐 맡는 순간은 그 쪽에 spread: true를 적어요(책에 두세 번쯤; 나머지는 적지 않아요)." : "");
const castRows = (premise) => list(premise?.cast).map((c) => `- ${str(c.name, 30)}${c.isNew ? " (이 책의 새 인물)" : ""}: 바람 — ${str(c.want, 100)}; 결점 — ${str(c.flaw, 100)}; 말투 — ${str(c.speech, 100)}`).join("\n");
export function draftRequest(input, premise, { records = [], castNotes = [], ties = [], treatment = null } = {}) {
  const notes = hasRoomWeave(input) ? [castNotesBlock(castNotes, hasRoomStages(input) ? ties : []), hasRoomStages(input) ? flowBlock(treatment) : ""].filter(Boolean).join("\n\n") : "";
  return {
    system: `너는 그림책 작가예요. 아래 전제로 책 한 권을 한글로 통째로 써요 — 쪽 단위로, 쪽마다 그 쪽의 글(ko). 쪽수는 네가 정해요. 비트도 설계도 없어요: 쪽을 넘기는 호흡은 네 몫이에요. 그림이 말할 쪽은 글이 짧고, 글이 끌어야 하는 쪽은 조금 길어요. 인물표의 말투대로 말해요. 화자는 자유예요 — 이야기꾼이 들려줘도, 주인공이 '나'로 말해도, 조연이나 사물이 말해도, 읽는 아이에게 말을 걸어도 돼요; 이 이야기에 맞는 목소리로. 제목(title)도 정해요 — 이 초고만의 제목으로(전제 제목과 달라도 돼요).${spreadLine(input)}${artLine(input)}`,
    user: `${roomBrief(input, { records })}\n\n[전제]\n${str(premise?.title, 40)} — ${str(premise?.line, 300)}\n모양: ${str(premise?.engine, 40)}\n가장 큰 웃음: ${str(premise?.laugh, 200)}\n아이가 보고 싶을 그림: ${str(premise?.picture, 200)}\n\n[인물표]\n${castRows(premise)}${notes ? `\n\n${notes}` : ""}`,
    jsonSchema: draftSchema(input),
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
const readSchema = (count, weave = false, lean = false) => ({
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
              required: ["draft", "skipPage", "lostPage", "laughPages", "change", "hardPage", "mannersPage", ...(lean ? ["changePage"] : weave ? ["echoFrom", "echoTo", "echo", "flat"] : [])],
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
                // R55h: something from an early page that comes back later ("아, 그거!") — 0·0·"" when none; and a character the story would not miss.
                // R59: a lean room asks neither; it asks which page the change is about, so the app can tell when two readers mean the same page.
                ...(lean ? { changePage: { type: "integer", minimum: 0 } } : weave ? { echoFrom: { type: "integer", minimum: 0 }, echoTo: { type: "integer", minimum: 0 }, echo: { type: "string", maxLength: 80 }, flat: { type: "string", maxLength: 30 } } : {}),
              },
            },
          },
        },
      },
    },
  },
});
const draftText = (draft, i) => `=== 초고 ${i + 1} · ${str(draft?.title, 40)} ===\n${list(draft?.pages).map(pageLine).join("\n")}`;
export function panelReadRequest(input, drafts) {
  const weave = hasRoomWeave(input),
    lean = hasRoomLean(input),
    one = list(drafts).length === 1;
  // R59: one book is read (nothing to choose between), a change names its page, and the two R55h questions are not asked.
  if (lean)
    return {
      system: `너는 여섯 사람이에요. 아래 ${one ? "책을" : "초고를"} 한 쪽씩 읽어 주는 자리에 있어요. ${one ? "각자 이 책을 또 읽어 달라고 할지(again) 말해요(favorite은 1)." : "각자 **다시 읽고 싶은 초고 하나**(favorite)를 고르고, 그 초고를 또 읽어 달라고 할지(again) 말해요."} ${one ? "그리고" : "초고마다:"} 가장 넘기고 싶은 쪽 하나(skipPage, 꼭 하나), 무슨 말인지 몰랐던 쪽(lostPage, 없으면 0), 웃은 쪽들(laughPages, 없으면 빈 목록), **바꾸고 싶은 것 하나**(change — 무엇을 어떻게, 한 문장; 그 쪽 번호는 changePage에. 정말 없으면 빈 문자열과 0. 칭찬은 쓰지 않아요). 읽어 주는 어른(parent)만 둘을 더 말해요: 소리 내어 읽기 힘든 쪽 하나(hardPage — 입에 안 붙거나 숨이 차는 쪽, 없으면 0)와 존댓말·반말이 어색한 쪽 하나(mannersPage — 누가 누구에게 하는 말인지에 안 맞는 쪽, 없으면 0); 아이들은 둘 다 0. [그림: …]은 그 쪽 그림에만 보이는 것이에요. 까닭은 각자 제 식대로. 점수는 없어요. 예의 차리지 말고 그 사람답게.\n\n[여섯 사람]\n${panelText(input)}`,
      user: list(drafts).map(draftText).join("\n\n"),
      jsonSchema: readSchema(list(drafts).length, weave, true),
      temperature: 0.7,
      maxTokens: 6000,
    };
  return {
    system: `너는 여섯 사람이에요. 아래 초고를 한 쪽씩 읽어 주는 자리에 있어요. 각자 **다시 읽고 싶은 초고 하나**(favorite)를 고르고, 그 초고를 또 읽어 달라고 할지(again) 말해요. 초고마다: 가장 넘기고 싶은 쪽 하나(skipPage, 꼭 하나), 무슨 말인지 몰랐던 쪽(lostPage, 없으면 0), 웃은 쪽들(laughPages, 없으면 빈 목록), 그 초고에서 **바꾸고 싶은 것 하나**(change — 어느 쪽의 무엇을 어떻게, 한 문장; 정말 없으면 빈 문자열. 칭찬은 쓰지 않아요). 읽어 주는 어른(parent)만 둘을 더 말해요: 소리 내어 읽기 힘든 쪽 하나(hardPage — 입에 안 붙거나 숨이 차는 쪽, 없으면 0)와 존댓말·반말이 어색한 쪽 하나(mannersPage — 누가 누구에게 하는 말인지에 안 맞는 쪽, 없으면 0); 아이들은 둘 다 0.${weave ? " 여섯 사람 모두 둘을 더 말해요: 앞쪽에 나온 것(물건·말·버릇·그림 속 작은 것)이 뒤에서 다시 쓰여 '아, 그거!' 한 순간이 있으면 처음 나온 쪽(echoFrom)·다시 쓰인 쪽(echoTo)·그게 무엇인지(echo)를 적어요 — 없으면 0·0·빈 문자열, 있는 척하지 않아요; 빠져도 이야기가 그대로일 인물이 있으면 그 이름 하나(flat, 없으면 빈 문자열). [그림: …]은 그 쪽 그림에만 보이는 것이에요." : ""} 여섯 사람이 같은 초고를 고를 수도 있지만 까닭은 각자 제 식대로. 점수는 없어요. 예의 차리지 말고 그 사람답게.\n\n[여섯 사람]\n${panelText(input)}`,
    user: list(drafts).map(draftText).join("\n\n"),
    jsonSchema: readSchema(list(drafts).length, weave),
    temperature: 0.7,
    maxTokens: 6000,
  };
}
/** Per draft: favourites × 4 + again × 2 + laughs − skipped pages (named by two) − lost pages (named by one); ties keep the writer's order. */
export function countReadings(answer, count = DRAFT_COUNT, { agree = false, unique = false } = {}) {
  const readers = list(object(answer) && !Array.isArray(answer) ? answer.readers : answer).filter(object),
    rows = new Map(),
    row = (n) => {
      if (!rows.has(n)) rows.set(n, { draft: n, votes: 0, again: 0, laughed: 0, curious: 0, bored: 0, lost: 0, pull: 0, skip: new Map(), lostAt: new Map(), laughAt: new Map(), hardAt: new Map(), mannersAt: new Map(), words: [], echoReaders: 0, echoAt: new Map(), flatAt: new Map(), changeAt: new Map() });
      return rows.get(n);
    },
    bump = (map, page) => map.set(page, (map.get(page) || 0) + 1);
  // R61 (audit 7, `unique`): one reader is one vote — a repeated reader id is read once (two rows of "action" made the two-reader agreement).
  const once = new Set();
  for (const reader of readers) {
    if (unique && (once.has(String(reader.reader)) || !PANEL_IDS.includes(String(reader.reader)))) continue;
    once.add(String(reader.reader));
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
      // R59 (`agree`): a change reaches the writer only when two readers name the same page — one reader's complaint erased the
      // book's only line spoken to the child. Every change is still kept on the row (`heard`) for the parent and the runner.
      const changePage = Math.round(Number(d.changePage));
      if (str(d.change ?? d.word, 160)) {
        r.words.push(str(d.change ?? d.word, 160));
        if (changePage >= 1) (r.changeAt.get(changePage) || r.changeAt.set(changePage, []).get(changePage)).push(str(d.change, 160));
      }
      // R55h: an echo counts when it names an earlier and a later page; a flat character when a name is given.
      const from = Math.round(Number(d.echoFrom)),
        to = Math.round(Number(d.echoTo));
      if (from >= 1 && to > from) {
        r.echoReaders += 1;
        const key = `${from}쪽→${to}쪽`;
        if (!r.echoAt.has(key)) r.echoAt.set(key, str(d.echo, 80));
      }
      if (str(d.flat, 30)) bump(r.flatAt, str(d.flat, 30));
    }
  }
  return Array.from({ length: count }, (_, i) => row(i + 1))
    .map((r) => {
      const boredPages = [...r.skip].filter(([, n]) => n >= 2).map(([p]) => p).sort((a, b) => a - b),
        lostPages = [...r.lostAt].map(([p]) => p).sort((a, b) => a - b),
        laughPages = [...r.laughAt].filter(([, n]) => n >= 2).map(([p]) => p).sort((a, b) => a - b),
        hardPages = [...r.hardAt].map(([p]) => p).sort((a, b) => a - b),
        mannersPages = [...r.mannersAt].map(([p]) => p).sort((a, b) => a - b),
        // R55h: what the readers saw come back (up to four), and the characters two or more readers would not miss.
        echoList = [...r.echoAt].slice(0, 4).map(([key, what]) => `${key}${what ? ` ${what}` : ""}`),
        flatCast = [...r.flatAt].filter(([, n]) => n >= 2).map(([name]) => name);
      // The pull is unchanged by R55d: the adult's two pages steer the rewrite, not the choice of draft.
      // R55h: a draft whose early pages come back later gains up to 3 (one per reader who saw it) — a nudge beside the votes (4 each), so a
      // layered draft the readers also liked wins a tie against a straight one; an answer saved before R55h has no echo and counts as before.
      const agreed = [...r.changeAt].filter(([, texts]) => texts.length >= 2).sort((a, b) => a[0] - b[0]).map(([page, texts]) => `${page}쪽 — ${texts.join(" / ")}`);
      return { draft: r.draft, votes: r.votes, again: r.again, laughed: r.laughed, curious: r.curious, bored: r.bored, lost: r.lost, pull: r.votes * 4 + r.again * 2 + laughPages.length - boredPages.length - lostPages.length + Math.min(3, r.echoReaders), boredPages, lostPages, laughPages, hardPages, mannersPages, words: agree ? agreed : r.words, ...(agree ? { heard: r.words.length } : {}), ...(r.echoReaders ? { echoes: r.echoReaders, echoList } : {}), ...(flatCast.length ? { flatCast } : {}) };
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
  // R55h: what came back and landed, and who the story would not miss.
  if (row.echoList?.length) lines.push(`독자가 알아본 되돌아옴: ${row.echoList.join(" / ")} — 살려요.`);
  if (row.flatCast?.length) lines.push(`빠져도 그대로일 것 같다는 인물: ${row.flatCast.join(", ")} — 제 볼일을 한 번 하게 하거나, 나오는 쪽을 줄여요.`);
  if (row.words?.length) lines.push(`바꾸고 싶은 것: ${row.words.join(" / ")}`);
  return lines.join("\n");
}
export function rewriteRequest(input, draft, notes, { records = [], castNotes = [], ties = [], treatment = null } = {}) {
  const weave = hasRoomWeave(input),
    cast = weave ? [castNotesBlock(castNotes, hasRoomStages(input) ? ties : []), hasRoomStages(input) ? flowBlock(treatment) : ""].filter(Boolean).join("\n\n") : "";
  return {
    // R54g: targeted — the A/B's astra rewrote all 14 pages (7% of the words kept) of the draft the panel had chosen.
    system: "너는 이 책을 쓴 작가예요. 독자 여섯 사람이 한 쪽씩 읽는 자리에 있었고, 아래는 그들의 반응이에요. 독자단이 이 초고를 골랐으니 책은 이대로 살려요: 반응이 가리킨 쪽(넘기고 싶어한 쪽·모른 쪽·읽기 힘든 쪽·말높임이 어색한 쪽·바꾸고 싶은 것)과 그 앞뒤 한 쪽만 손대고, 웃은 쪽은 글자 하나 바꾸지 않고, 나머지 쪽도 바꿀 까닭이 없으면 그대로 돌려줘요. 손대는 쪽에서는 합치거나 나누거나 빼거나 더해도 돼요. 분량은 늘리지 않아요 — 그림책이에요. 제목은 다시 정해도 돼요. " +
      // R59: the mark is on the line the writer reads (it was not, and three marks came back as none).
      (hasRoomLean(input) ? "쪽 번호 옆의 (큰 그림)은 그 쪽이 두 쪽에 걸친 큰 그림 한 장이라는 표시예요 — 돌려줄 때 그 쪽에 spread: true를 그대로 적어요(손댄 쪽은 새로 정해도 돼요)." : "큰 그림 한 장이 맡는 쪽의 spread: true 표시는 그대로 두거나 새로 정해요.") +
      // R55h: the backward look — how a writer plants: read from the end, and put what the end uses where an early page can show it.
      (weave ? (hasRoomKept(input) ? " 한 가지는 더 해도 돼요: 끝에서 거꾸로 읽어, 끝을 이해하는 데 꼭 필요한 물건·말·버릇이 앞쪽 글에서 한 번도 들리지 않았다면 앞쪽 한 곳의 글에 한 줄로 먼저 놓아요(그 쪽에는 한 줄만 더해요). 다시 볼 때 즐거운 것은 그림 메모(art)로 충분해요; 설명은 붙이지 않아요." : " 한 가지는 더 해도 돼요: 끝에서 거꾸로 읽어, 끝이 쓰는 물건·말·버릇이 앞에서 한 번도 보이지 않았다면 앞쪽 한 곳에 아무렇지 않게 먼저 놓아요 — 그림 메모(art) 한 줄이면 충분하고, 글은 한 줄까지; 설명은 붙이지 않아요.") + " [그림: …]은 그 쪽의 그림 메모예요 — art로 그대로 돌려주거나 고쳐요." + NO_LETTERS + " 그림 메모가 설명하는 글자를 그려 넣으라고 하면 그렇게 바꿔 적어요." : ""),
    // The notes keep their lines (str() would fold them into one).
    user: `${roomBrief(input, { records })}${cast ? `\n\n${cast}` : ""}\n\n[독자 반응]\n${String(notes ?? "").trim().slice(0, 2000) || "(없음)"}\n\n=== 초고 · ${str(draft?.title, 40)} ===\n${list(draft?.pages).map(hasRoomLean(input) ? markedPageLine : pageLine).join("\n")}`,
    jsonSchema: draftSchema(input),
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
const asPitch = (premise, n, row, wide = false, counted = false) => ({
  premise: n,
  title: str(premise?.title, 40) || `전제 ${n}`,
  logline: str(premise?.line, 300),
  engine: str(premise?.engine, 40),
  laugh: str(premise?.laugh, 200),
  picture: str(premise?.picture, 200),
  cast: list(premise?.cast).filter(object).map((c) => ({ name: str(c.name, 30), isNew: c.isNew === true, want: str(c.want, 100), flaw: str(c.flaw, 100), speech: str(c.speech, 100), ...(c.isNew === true && str(c.look, 160) ? { nameEn: str(c.nameEn, 30), kind: str(c.kind, 24), look: str(c.look, 160) } : counted && c.isNew === true ? { nameEn: str(c.nameEn, 30), kind: str(c.kind, 24) } : {}) })),
  ...(row ? { pull: row.pull, laughed: row.laughed, curious: row.curious, again: row.again, lost: row.lost, words: row.words } : {}),
  // R57: the places it goes and how wide it is (counted from the premise itself) — what the parent confirms by choosing it.
  ...(wide ? { places: premisePlaces(premise).map((p) => ({ name: p.name, isNew: p.isNew })), scale: premiseScale(premise, { counted }) } : {}),
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
    const wide = hasRoomWide(input);
    const shortlist = wide ? pickPremisesWide(rows, premises, Math.min(SHORTLIST, premises.length)) : pickPremises(rows, Math.min(SHORTLIST, premises.length));
    record.shortlist = shortlist;
    record.pitches = shortlist.map((n, i) => asPitch(premises[n - 1], i + 1, rows.find((row) => row.premise === n), wide, hasRoomCounted(input)));
    if (wide) record.scales = premises.map((p) => premiseScale(p).kind);
    record.recommended = 1;
    log({ by: "독자단", kind: "reviewed", what: `셋을 고름: ${record.pitches.map((p) => `'${p.title}' (웃음 ${p.laughed ?? 0}·궁금 ${p.curious ?? 0}·또 ${p.again ?? 0})`).join(" / ")}`, why: wide ? `독자단의 순서에서 폭이 다른 이야기를 하나씩 — ${record.pitches.map((p) => SCALE_LABELS[p.scale?.kind] || "").join(" / ")}` : "웃음+궁금+또−모름을 셈 — 점수가 아니라 반응" });
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
const artOf = (p) => (str(p?.art, 200) ? { art: str(p.art, 200) } : {});
const pageRows = (draft) => list(draft?.pages).filter(object).map((p) => ({ ko: str(p.ko, 1200), ...(p.spread === true ? { spread: true } : {}), ...artOf(p) })).filter((p) => p.ko);
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
/** R61: the English answer by page number (1..count); an answer without numbers counts only when it has every page. */
export function englishByPage(answer, count) {
  const rows = list(answer?.pages).filter(object),
    out = new Map();
  const numbered = rows.every((r) => Number.isInteger(Number(r.pageNo)) && Number(r.pageNo) >= 1);
  if (numbered) for (const r of rows) {
    const n = Number(r.pageNo);
    if (n <= count && str(r.en, 1200) && !out.has(n)) out.set(n, str(r.en, 1200));
  }
  else if (rows.length === count) rows.forEach((r, i) => str(r.en, 1200) && out.set(i + 1, str(r.en, 1200)));
  return out;
}
export function englishRequest(input, pages, { only = null } = {}) {
  const count = list(pages).length;
  // R61: each English page names its page number; `only` asks for the missing pages alone (the whole book is context).
  if (hasRoomKept(input)) {
    const want = only ? list(only) : null,
      n = want ? want.length : count;
    return {
      system: `You are a picture-book author writing the English edition of a finished Korean picture book, page by page. ${leanLevelLine(input, "en", { vocab: true })} Each page's English follows that page's Korean: the same events in the same order, the same spoken lines, nothing the Korean has not yet said. It may say less; it never says something else. Return pageNo with each page's English.${want ? ` Return ONLY pages ${want.join(", ")}.` : ""}`,
      user: `${englishCastLine(input)}${numbered(pages)}`,
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["pages"],
        properties: { pages: { type: "array", minItems: n, maxItems: n, items: { type: "object", additionalProperties: false, required: ["pageNo", "en"], properties: { pageNo: { type: "integer", minimum: 1, maximum: count }, en: { type: "string", maxLength: 1200 } } } } },
      },
      temperature: 0.4,
      maxTokens: 6000,
    };
  }
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
/** R59: the wording when the room writes one draft. */
const ONE_DRAFT_PROGRESS = Object.freeze({
  drafts: "작가실 · 작가가 고른 흐름으로 책을 통째로 쓰고 있어요.",
  read: "작가실 · 독자 여섯이 책을 한 쪽씩 읽고 있어요.",
});
const DRAFT_PROGRESS = Object.freeze({
  cast: "작가실 · 작가가 인물을 한 사람씩 만나 보고 있어요.",
  flow: "작가실 · 작가가 이야기의 흐름을 세 가지로 적어 보고 있어요.",
  flowPick: "작가실 · 독자 여섯이 흐름 셋을 듣고 있어요.",
  castRevise: "작가실 · 고른 흐름에 맞춰 인물을 한 번 더 다듬고 있어요.",
  threads: "작가실 · 편집자가 앞에 놓인 것이 뒤에서 쓰였는지 보고 있어요.",
  drafts: "작가실 · 작가가 초고 세 권을 통째로 쓰고 있어요.",
  read: "작가실 · 독자 여섯이 초고를 한 쪽씩 읽고 있어요.",
  rewrite: "작가실 · 작가가 독자 반응을 받아 고쳐 쓰고 있어요.",
  listen: "작가실 · 그림 없이 글만 듣는 독자가 책을 듣고 있어요.",
  pageEdit: "작가실 · 편집자가 쪽으로 나눈 책을 한 장씩 넘기며 읽고 있어요.",
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
/**
 * R59: a page the rewrite returned word for word keeps the spread mark it had (the app's copy — the rewrite may forget it,
 * and a page the writer left alone was not re-decided). Returns the pages and how many marks were put back.
 */
export function keepSpreadMarks(before, after) {
  const marked = new Set(list(before).filter((p) => p?.spread === true).map((p) => flat(p?.ko)).filter(Boolean));
  let restored = 0;
  const pages = list(after).map((p) => {
    if (p?.spread === true || !marked.has(flat(p?.ko))) return p;
    restored += 1;
    return { ...p, spread: true };
  });
  return { pages, restored };
}
/**
 * R61 (audit D): the pages a rewrite may touch — every page the readers' notes name (skipped by two, lost, hard to
 * read aloud, wrong speech level, a change two agreed on, the editor's loose and unplanted pages) and its
 * neighbours; never a page they laughed at. 1-based page numbers.
 */
export function rewriteScope(row, threads = null, pageCount = 0, listen = null) {
  const named = new Set(),
    add = (n) => {
      const p = Math.round(Number(n));
      if (p >= 1 && (!pageCount || p <= pageCount)) [p - 1, p, p + 1].filter((x) => x >= 1 && (!pageCount || x <= pageCount)).forEach((x) => named.add(x));
    };
  for (const key of ["boredPages", "lostPages", "hardPages", "mannersPages"]) list(row?.[key]).forEach(add);
  for (const w of list(row?.words)) add((/^(\d+)쪽/u.exec(String(w)) || [])[1]);
  for (const t of [...list(threads?.loose), ...list(threads?.unplanted)]) add(t?.page);
  // R62: and the pages the listener could not follow.
  for (const p of listenPages(listen)) add(p);
  for (const p of list(row?.laughPages)) named.delete(Math.round(Number(p)));
  // R61b: the things a plant on an outside page may carry (the editor's loose and unplanted threads, by name).
  const plants = [...list(threads?.loose), ...list(threads?.unplanted)].map((t) => str(t?.what, 80)).filter(Boolean);
  return { pages: [...named].sort((a, b) => a - b), laughs: list(row?.laughPages).map((p) => Math.round(Number(p))).filter((p) => p >= 1), plants };
}
/**
 * R61: a rewrite merged into the draft it rewrote, when it kept the page count — a page outside the scope stays as it
 * was unless the rewrite only ADDED one sentence to it (a plant), a page the readers laughed at stays word for word.
 * A rewrite that changed the page count is taken whole (it merged or split pages; nothing to align). Returns the
 * pages and the page numbers it put back.
 */
export function mergeRewrite(before, after, scope) {
  const old = list(before),
    next = list(after);
  if (!old.length) return { pages: next, restored: [], structural: false };
  const allowed = new Set(list(scope?.pages)),
    laughs = new Set(list(scope?.laughs)),
    same = (a, b) => flat(a?.ko) === flat(b?.ko) && str(a?.art, 200) === str(b?.art, 200) && !!a?.spread === !!b?.spread;
  // R61b (Codex V2): a rewrite that changed the page count is aligned by the pages it left alone at the front and back;
  // the pages in between must all be pages it was asked about (and no laugh page) — else the draft stays as it was.
  if (old.length !== next.length) {
    let head = 0;
    while (head < old.length && head < next.length && same(old[head], next[head])) head++;
    let tail = 0;
    while (tail < old.length - head && tail < next.length - head && same(old[old.length - 1 - tail], next[next.length - 1 - tail])) tail++;
    const span = Array.from({ length: old.length - head - tail }, (_, k) => head + k + 1),
      touched = span.length ? span : [head, head + 1].filter((n) => n >= 1 && n <= old.length);
    const ok = touched.length && touched.every((n) => allowed.has(n) && !laughs.has(n));
    if (!ok) return { pages: old.map((p) => ({ ...p })), restored: span, structural: "rejected" };
    return { pages: [...old.slice(0, head), ...next.slice(head, next.length - tail), ...old.slice(old.length - tail)], restored: [], structural: true };
  }
  const plantWords = list(scope?.plants).flatMap((w) => String(w).split(/\s+/u)).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter((w) => w.length >= 2);
  let planted = 0;
  const restored = [];
  const pages = next.map((p, i) => {
    const n = i + 1,
      was = old[i];
    if (same(p, was)) return p;
    // R61b: a page the readers laughed at, or a page outside the scope, keeps its whole page — words, art note, spread mark.
    if (laughs.has(n)) {
      restored.push(n);
      return { ...was };
    }
    if (allowed.has(n)) return p;
    // A plant: one sentence added to an outside page, carrying a thing the editor named, at most two pages.
    const before = flat(was?.ko),
      now = flat(p?.ko),
      added = now.startsWith(before) ? now.slice(before.length) : now.endsWith(before) ? now.slice(0, now.length - before.length) : null,
      extra = sentences(now).length - sentences(before).length;
    if (added !== null && extra === 1 && planted < 2 && plantWords.some((w) => added.includes(w))) {
      planted++;
      return { ...was, ko: p.ko };
    }
    restored.push(n);
    return { ...was };
  });
  return { pages, restored, structural: false };
}
/** The panel named nothing to fix (no page to skip, none lost, nothing to change): the rewrite call is skipped. */
export const nothingToRewrite = (row) => object(row) && !list(row.boredPages).length && !list(row.lostPages).length && !list(row.hardPages).length && !list(row.mannersPages).length && !list(row.flatCast).length && !list(row.words).some((w) => str(w, 160));
export async function runRoomDrafts(input, outline, options = {}, services = {}) {
  services = withEngines(services);
  const premise = outline?.writersRoom?.premise;
  if (!object(premise)) throw new StoryValidationError("prose", ["작가실이 고른 전제가 없어요. 줄거리 단계부터 다시 만들어 주세요."]);
  const journal = ledger("roomDrafts", input, options, { version: WRITERS_ROOM_VERSION, premise }, "writerCheckpoint");
  // R59: a lean room writes one draft (its three flows are where the book is chosen).
  const lean = hasRoomLean(input);
  const count = Math.max(1, Math.min(DRAFT_COUNT, Number(options.roomDraftCount) || (lean ? 1 : DRAFT_COUNT)));
  const record = { kind: "roomDrafts", version: WRITERS_ROOM_VERSION, phase: "drafts", drafts: [], rows: [], chosen: null, notes: "", rewritten: false, rewriteSkipped: false, rewriteChange: null, english: false, levelNotes: [], polished: false, levelNotesAfter: [] };
  const snapshot = async (phase) => {
    record.phase = phase;
    journal.checkpoint.record = clone(record);
    await journal.save();
    options.onProgress?.({ stage: "roomDrafts", phase, message: (count === 1 && ONE_DRAFT_PROGRESS[phase]) || DRAFT_PROGRESS[phase], room: clone(record) });
  };
  const ask = async (label, request, role) => {
    const response = await journal.call(role, request, services);
    const data = response?.json !== undefined ? response.json : parseJsonLenient(String(response?.text || ""));
    if (!object(data)) throw journal.fail(roomError(`${label}의 답을 읽을 수 없어요.`));
    return data;
  };
  try {
    // R55h: the cast speaks first (one call on the writer's model). Material only — an answer that cannot be read leaves the drafts without it.
    const stages = hasRoomStages(input);
    // A working note, never a gate: an answer that cannot be read is null and the room goes on without it.
    const note = async (request, role) => {
      const response = await journal.call(role, request, services);
      let raw = response?.json;
      if (raw === undefined) {
        try {
          raw = parseJsonLenient(String(response?.text || ""));
        } catch {
          raw = null;
        }
      }
      return object(raw) ? raw : null;
    };
    let castNotes = [],
      ties = [],
      treatment = null;
    if (hasRoomWeave(input)) {
      await snapshot("cast");
      const raw = await note(castNotesRequest(input, premise), "outline");
      castNotes = settleCastNotes(raw, premise);
      record.castNotes = castNotes;
      // R60: the illustrator's lines for the new characters and places (FULL AUTO puts them on the cards before any sheet).
      if (hasRoomCounted(input)) record.looks = settleRoomLooks(raw, premise);
      if (stages) {
        ties = settleTies(raw, premise);
        record.ties = ties;
      }
    }
    // R56: three treatments (the three weaves) → the panel picks → the cast is revised for the chosen flow.
    if (stages) {
      await snapshot("flow");
      const flowCount = Math.max(1, Math.min(FLOW_COUNT, Number(options.roomFlowCount) || FLOW_COUNT));
      const flows = (await Promise.all(Array.from({ length: flowCount }, (_, i) => note(treatmentRequest(input, premise, { castNotes, ties }, i, flowCount), "outline").then((raw) => settleTreatment(raw))))).filter(Boolean);
      record.treatments = flows;
      if (flows.length) {
        let flowPick = 1;
        if (flows.length > 1) {
          await snapshot("flowPick");
          const rows = countFlows(await note(panelFlowsRequest(input, flows), "cheap"), flows);
          record.flowRows = rows;
          flowPick = Math.min(flows.length, pickFlow(rows, flows));
        }
        record.flowChosen = flowPick;
        treatment = flows[flowPick - 1];
        // R60: no cast revision in a counted room (it restated the flow and erased the characters' own business).
        if (castNotes.length && !hasRoomCounted(input)) {
          await snapshot("castRevise");
          const revised = settleCastNotes(await note(castReviseRequest(input, premise, castNotes, ties, treatment), "outline"), premise);
          if (revised.length) {
            castNotes = revised;
            record.castNotes = revised;
            record.castRevised = true;
          }
        }
      }
    }
    await snapshot("drafts");
    const base = draftRequest(input, premise, { castNotes, ties, treatment });
    const drafts = (
      await Promise.all(
        Array.from({ length: count }, (_, i) =>
          // R59: one draft carries no "draft n of m" tail — there is no other draft to differ from.
          ask(`초고 ${i + 1}`, lean && count === 1 ? base : { ...base, user: `${base.user}\n\n${draftWeaveLine(input, i, count, treatment)}` }, "outline").then((raw) => normalizeDraft(raw, `${str(premise.title, 40)} ${i + 1}`)),
        ),
      )
    ).filter(Boolean);
    if (!drafts.length) throw journal.fail(roomError("작가가 쓸 수 있는 초고를 내지 못했어요."));
    // R55e (A/B 3차 4-5): two of astra's three drafts shared a title; the record tells them apart with "(2)" (the drafts themselves are untouched).
    const seenTitles = new Map();
    record.drafts = drafts.map((d) => {
      const n = (seenTitles.get(d.title) || 0) + 1;
      seenTitles.set(d.title, n);
      return { title: n > 1 ? `${d.title} (${n})` : d.title, pages: d.pages.length };
    });
    let pick = 1,
      chosen = drafts[0];
    // R59: a lean room's single draft is read too (the readers' pages are what the rewrite works from).
    const reads = lean || drafts.length > 1;
    if (reads) {
      await snapshot("read");
      const read = await ask("독자단", panelReadRequest(input, drafts), "cheap");
      const rows = countReadings(read, drafts.length, { agree: lean, unique: hasRoomKept(input) });
      record.rows = rows;
      pick = Math.min(drafts.length, pickDraft(rows));
      chosen = drafts[pick - 1];
      record.notes = rewriteNotes(rows.find((row) => row.draft === pick));
    }
    record.chosen = pick;
    let pages = chosen.pages,
      title = chosen.title;
    // R56: the editor's thread check of the chosen draft (the cheap model) — its notes join the readers' before the rewrite.
    let threads = null;
    // R59: in a lean room the thread check cannot start a rewrite — it runs only when the readers already did, and its notes ride along.
    const readersAsk = reads && !nothingToRewrite(record.rows.find((row) => row.draft === pick));
    if (stages && options.roomRewrite !== false && (lean ? readersAsk : drafts.length > 1)) {
      await snapshot("threads");
      threads = settleThreads(await note(threadCheckRequest(input, chosen, treatment), "cheap"), chosen.pages.length);
      record.threads = threads;
      // R60: and where the things the ending uses are first heard (counted from the words; a counted room only).
      const heard = hasRoomCounted(input) ? firstHeardNotes(chosen.pages, [...list(treatment?.plants).map((x) => x.what), ...list(threads?.kept).map((x) => x.what)], { names: list(premise?.cast).map((c) => c?.name) }) : "";
      const more = [threadNotes(threads), heard].filter(Boolean).join("\n");
      if (more) record.notes = [record.notes, more].filter(Boolean).join("\n");
    }
    // R62: a clear room lets a listener hear the chosen draft without pictures (the cheap model); what they could not follow
    // joins the notes and starts the rewrite even when the readers asked for nothing.
    let listen = null;
    if (hasRoomClear(input) && options.roomRewrite !== false && reads) {
      await snapshot("listen");
      listen = settleListen(await note(listenRequest(input, chosen), "cheap"), chosen.pages.length);
      record.listen = listen;
      const heard = listenNotes(listen);
      if (heard) record.notes = [record.notes, heard].filter(Boolean).join("\n");
    }
    // R54g: no page to skip, none lost, nothing to change → the panel's pick stands as written (one upper call saved).
    if (options.roomRewrite !== false && reads && (lean ? !readersAsk && !listenNeedsWork(listen) : !threadsNeedWork(threads) && nothingToRewrite(record.rows.find((row) => row.draft === pick)))) record.rewriteSkipped = true;
    if (options.roomRewrite !== false && reads && !record.rewriteSkipped) {
      await snapshot("rewrite");
      const again = normalizeDraft(await ask("고쳐쓰기", rewriteRequest(input, chosen, record.notes, { castNotes, ties, treatment }), "outline"), title);
      if (again) {
        pages = again.pages;
        title = again.title;
        record.rewritten = true;
        record.rewriteChange = rewriteChange(chosen.pages, pages);
        // R61: a rewrite stays inside the pages the readers named (and their neighbours); a laughed-at page is never touched.
        if (hasRoomKept(input)) {
          const scope = rewriteScope(record.rows.find((row) => row.draft === pick), threads, chosen.pages.length, listen),
            merged = mergeRewrite(chosen.pages, pages, scope);
          pages = merged.pages;
          record.rewriteScope = { pages: [...scope.pages].sort((a, b) => a - b), restored: merged.restored, structural: merged.structural };
          record.rewriteChange = rewriteChange(chosen.pages, pages);
        }
        // R59: the marks of the pages the rewrite left alone are the app's to keep.
        if (lean) {
          const kept = keepSpreadMarks(chosen.pages, pages);
          pages = kept.pages;
          record.spreadMarks = { before: chosen.pages.filter((p) => p.spread).length, after: pages.filter((p) => p.spread).length, restored: kept.restored };
        }
      }
    }
    // R61 (audit G): the Korean is bound into the book's pages before the English is written (one sentence cap for
    // every join), so the English follows the pages the book prints and no page is cut in two languages separately.
    if (hasRoomKept(input)) {
      const openings = openingCount(input),
        cap = pageSentenceCap(input?.specs?.ko),
        before = pages.length,
        bound = clampPages(pages, openings ? { min: openings, max: 2 * openings } : null, { cap }),
        fit = openings ? fitSpreadMarks(bound, openings, { cap }) : { pages: bound, fitted: true, marks: 0, moved: 0 };
      pages = fit.pages;
      record.binding = { before, after: pages.length, cap, fitted: fit.fitted, marks: fit.marks, moved: fit.moved, over: pages.filter((p) => sentences(p.ko).length > cap).map((_, n) => n + 1).length };
      // R63: the editor reads the bound pages as they will print (the writer's model, once) — a boundary moved by a
      // sentence, the smallest fix where the turn loses who or where, a continuity note for the illustrator. A note
      // that cannot be read changes nothing.
      if (hasRoomClear(input) && options.roomPageEdit !== false) {
        await snapshot("pageEdit");
        const laughRow = list(record.rows).find((row) => row.draft === record.chosen),
          guarded = list(laughRow?.laughPages).map((k) => flat(chosen.pages[Math.round(Number(k)) - 1]?.ko)).filter(Boolean),
          cast = list(premise?.cast).filter(object).map((c) => ({ name: c.name, who: [c.isNew ? "새 인물" : "", c.want ? `바라는 것: ${c.want}` : ""].filter(Boolean).join(", ") }));
        const edit = applyPageEdit(pages, await note(pageEditRequest(input, pages, cast), "outline"), { cap, guarded });
        pages = edit.pages;
        record.pageEdit = { moves: edit.applied.moves, fixes: edit.applied.fixes, art: edit.applied.art, refused: edit.refused };
      }
    }
    if (input?.language !== "ko") {
      await snapshot("english");
      const en = await ask("영어판", englishRequest(input, pages), "outline");
      if (hasRoomKept(input)) {
        // R61 (audit H): the English is matched to its page by number; a missing page is asked for once more, alone;
        // still missing, it is recorded (the page keeps no English of its own) — never silently filled with the Korean.
        const byPage = englishByPage(en, pages.length);
        let missing = pages.map((_, n) => n + 1).filter((n) => !byPage.has(n));
        if (missing.length && missing.length < pages.length) {
          const more = await ask("영어판 보충", englishRequest(input, pages, { only: missing }), "outline");
          for (const [n, text] of englishByPage(more, pages.length)) if (missing.includes(n)) byPage.set(n, text);
          missing = missing.filter((n) => !byPage.has(n));
        }
        if (byPage.size) {
          pages = pages.map((p, i) => (byPage.has(i + 1) ? { ...p, en: byPage.get(i + 1) } : p));
          record.english = true;
        }
        if (missing.length) record.englishMissing = missing;
      } else {
        const rows = list(en.pages).map((p) => str(p?.en, 1200));
        if (rows.length === pages.length) {
          pages = pages.map((p, i) => ({ ...p, en: rows[i] }));
          record.english = true;
        }
      }
    }
    record.levelNotes = levelNotes(outline, pages, input);
    if (record.levelNotes.length && options.roomPolish !== false) {
      await snapshot("polish");
      const polished = await ask("다듬기", polishRequest(input, pages, record.levelNotes), "outline");
      const rows = list(polished.pages).filter(object);
      // R61 (audit D): only the pages and the languages the level check named take the polish.
      const named = hasRoomKept(input) ? new Set(record.levelNotes.map((n) => `${n.pageNo}:${n.language === "en" ? "en" : "ko"}`)) : null,
        may = (i, lang) => !named || named.has(`${i + 1}:${lang}`);
      if (rows.length === pages.length) {
        pages = pages.map((p, i) => ({ ...(p.spread ? { spread: true } : {}), ko: (may(i, "ko") && str(rows[i].ko, 1200)) || p.ko, ...(p.en !== undefined ? { en: (may(i, "en") && str(rows[i].en, 1200)) || p.en } : {}), ...artOf(p) }));
        record.polished = true;
        record.levelNotesAfter = levelNotes(outline, pages, input);
      }
    }
    await snapshot("done");
    return {
      data: { title, language: record.english ? "dual" : "ko", pages: pages.map((p, i) => ({ pageNo: i + 1, ko: p.ko, ...(p.en !== undefined ? { en: p.en } : {}), ...(p.spread ? { spread: true } : {}), ...artOf(p) })), room: clone(record) },
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
  const change = r.rewriteChange,
    echoes = list(list(r.rows).find((row) => row?.draft === r.chosen)?.echoList).length;
  // R59: one draft — nothing was chosen between.
  const lead = list(r.drafts).length === 1 ? `작가실 · 초고를${list(r.rows).length ? " 독자단이 읽고" : " 쓰고"}` : `작가실 · 초고 ${list(r.drafts).length}권 중 독자단이 ${r.chosen}번을 골라`;
  return `${lead}${r.rewritten ? ` 고쳐 쓰고${change ? `(${change.after}쪽 중 ${change.changed}쪽 손봄)` : ""}` : r.rewriteSkipped ? " 고칠 곳이 없어 그대로 두고" : ""}${r.english ? " 영어판을 쓰고" : ""}${notes ? ` 등급 참고 ${notes}건 중 ${r.polished ? `다듬어 ${list(r.levelNotesAfter).length}건 남음` : "다듬지 않음"}` : " 등급 참고 없음"} · ${list(draft.pages).length}쪽${list(r.castNotes).length ? ` · 인물 노트 ${list(r.castNotes).length}명` : ""}${list(draft.pages).some((p) => p?.art) ? ` · 그림 메모 ${list(draft.pages).filter((p) => p?.art).length}쪽` : ""}${echoes ? ` · 독자가 알아본 되돌아옴 ${echoes}곳` : ""}${r.flowChosen ? ` · 흐름 ${list(r.treatments).length}안 중 ${r.flowChosen}번` : ""}${object(r.threads) ? ` · 복선 점검: 거둔 것 ${list(r.threads.kept).length} · 고칠 곳 ${list(r.threads.loose).length + list(r.threads.unplanted).length}` : ""}`;
}
/**
 * R56: the writer's working notes of a finished room draft, for the folded
 * "작가 노트" on ③ — the cast in their own words, what stands between them,
 * the chosen flow with its plant-and-pay-off memo, the editor's thread check.
 * Plain text sections (the screen escapes them); null when there are none.
 */
export function roomNotesView(draft) {
  const r = draft?.room;
  if (!object(r)) return null;
  const sections = [],
    flow = list(r.treatments)[Number(r.flowChosen) - 1];
  if (list(r.castNotes).length) sections.push({ title: `인물 노트${r.castRevised ? " · 흐름에 맞춰 한 번 고침" : ""}`, lines: r.castNotes.map((n) => `${n.name}: ${[n.today && `오늘 하려던 일 — ${n.today}`, n.unsaid && `말 안 한 것 — ${n.unsaid}`, n.habit && `버릇·물건 — ${n.habit}`, n.turn && `이 이야기에서 — ${n.turn}`].filter(Boolean).join(" / ")}`) });
  if (list(r.ties).length) sections.push({ title: "인물 사이", lines: r.ties.map((t) => `${t.from} → ${t.to}: ${[t.wants && `바라는 것 — ${t.wants}`, t.knows && `혼자 아는 것 — ${t.knows}`].filter(Boolean).join(" / ")}`) });
  if (object(flow)) sections.push({ title: `흐름 · ${list(r.treatments).length}안 중 독자단이 고른 ${r.flowChosen}번`, lines: [flow.flow, ...list(flow.plants).map((p) => `심고 거두기 · ${p.what}: ${p.plant || "앞쪽"} → ${p.payoff || "뒤에서"}`)] });
  if (object(r.threads) && (list(r.threads.kept).length || threadsNeedWork(r.threads)))
    sections.push({ title: "복선 점검 · 고쳐 쓰기 전", lines: [...list(r.threads.kept).map((t) => `거둔 것 · ${t.what} ${t.from}쪽 → ${t.to}쪽`), ...list(r.threads.loose).map((t) => `놓기만 한 것 · ${t.what} (${t.page}쪽)`), ...list(r.threads.unplanted).map((t) => `앞에 없이 나온 것 · ${t.what} (${t.page}쪽)`)] });
  if (!sections.length) return null;
  return { summary: `작가 노트 · ${[list(r.castNotes).length && `인물 ${r.castNotes.length}명`, list(r.ties).length && `사이 ${r.ties.length}`, object(flow) && `흐름 · 심고 거두기 ${list(flow.plants).length}`, object(r.threads) && "복선 점검"].filter(Boolean).join(" · ")}`, sections };
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
export function clampPages(pages, bounds = null, { cap = 0 } = {}) {
  let rows = list(pages)
    .filter(object)
    .map((p) => ({ ko: str(p.ko, 1200), ...(p.en !== undefined ? { en: str(p.en, 1200) } : {}), ...(p.spread === true ? { spread: true } : {}), ...artOf(p) }))
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
    // R55h: a split page's art note stays with its first half.
    const a = { ko: ko.slice(0, cut).join(" "), ...(en ? { en: en.slice(0, cutEn).join(" ") } : {}), ...(rows[i].spread ? { spread: true } : {}), ...artOf(rows[i]) },
      b = { ko: ko.slice(cut).join(" "), ...(en ? { en: en.slice(cutEn).join(" ") } : {}), ...(rows[i].spread ? { spread: true } : {}) };
    rows.splice(i, 1, a, b);
  }
  while (rows.length > target) {
    let best = 0,
      size = Infinity;
    // R61 (audit G, `cap`): the same sentence cap as the spread fit — a pair that fits is joined first.
    const fits = (n) => !cap || sentences(rows[n].ko).length + sentences(rows[n + 1].ko).length <= cap;
    const anyFits = !cap || rows.some((_, n) => n + 1 < rows.length && fits(n));
    for (let n = 0; n + 1 < rows.length; n++) {
      if (anyFits && !fits(n)) continue;
      const together = rows[n].ko.length + rows[n + 1].ko.length;
      if (together < size) {
        size = together;
        best = n;
      }
    }
    const [a, b] = [rows[best], rows[best + 1]];
    rows.splice(best, 2, { ko: `${a.ko} ${b.ko}`.trim(), ...(a.en !== undefined || b.en !== undefined ? { en: `${a.en || ""} ${b.en || ""}`.trim() } : {}), ...(a.spread || b.spread ? { spread: true } : {}), ...joinArt(a, b) });
  }
  // R61 (audit G): a join that had to break the cap moves sentences to a neighbour with room (words unchanged, the
  // Korean only — the English is written after the binding). A page that cannot be relieved stays as it is.
  if (cap && rows.every((r) => r.en === undefined)) {
    for (let pass = 0; pass < rows.length * cap; pass++) {
      const i = rows.findIndex((r) => sentences(r.ko).length > cap);
      if (i === -1) break;
      // The nearest page with room (no spread-marked page in between): each page on the way passes one sentence on,
      // so only the over-cap page loses one and only the page with room gains one; the words keep their order.
      const room = (k) => rows[k] && !rows[k].spread && sentences(rows[k].ko).length < cap;
      const reach = (step) => {
        for (let k = i + step; k >= 0 && k < rows.length; k += step) {
          if (rows[k].spread) return -1;
          if (room(k)) return k;
        }
        return -1;
      };
      const ahead = reach(1),
        behind = ahead === -1 ? reach(-1) : -1;
      if (ahead !== -1) {
        for (let k = ahead - 1; k >= i; k--) {
          const ko = sentences(rows[k].ko);
          rows[k] = { ...rows[k], ko: ko.slice(0, -1).join(" ") };
          rows[k + 1] = { ...rows[k + 1], ko: `${ko.at(-1)} ${rows[k + 1].ko}`.trim() };
        }
      } else if (behind !== -1) {
        for (let k = behind + 1; k <= i; k++) {
          const ko = sentences(rows[k].ko);
          rows[k] = { ...rows[k], ko: ko.slice(1).join(" ") };
          rows[k - 1] = { ...rows[k - 1], ko: `${rows[k - 1].ko} ${ko[0]}`.trim() };
        }
      } else break;
    }
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
    // R60: a counted room's premises carry no look (it comes from the cast notes) — a new character needs a kind or an English name.
    .filter((c) => object(c) && c.isNew === true && str(c.name, 30) && (str(c.look, 160) || (hasRoomCounted(input) && (str(c.kind, 24) || str(c.nameEn, 30)))))
    .filter((c) => {
      const name = str(c.name, 30);
      if (known.has(name) || seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .map((c) => ({ name: str(c.name, 30), nameEn: str(c.nameEn, 30), kind: str(c.kind, 24), look: str(c.look, 160), want: str(c.want, 100), flaw: str(c.flaw, 100), speech: str(c.speech, 100) }));
}
/**
 * R57: the chosen premise's new places (isNew, with a look) that the drawer
 * does not have — by name against input.backgrounds. Without a card a place
 * the story invents is one line of text and every page draws it differently.
 */
export function roomNewPlaces(outline, input) {
  const known = new Set(list(input?.backgrounds).filter(object).flatMap((b) => [str(b.name, 30), str(b.nameEn, 30)]).filter(Boolean));
  return premisePlaces(outline?.writersRoom?.premise).filter((p) => p.isNew && (p.look || (hasRoomCounted(input) && (p.type || p.nameEn))) && !known.has(p.name) && !(p.nameEn && known.has(p.nameEn)));
}
/** The drawer record of one new place — the shape materializeAutoPlan gives a plan's new background (its sheet is bought like theirs). */
export function roomPlaceRecord(p, { id, jobId, now = new Date().toISOString(), kit = false } = {}) {
  const look = str(p?.look, 200),
    type = str(p?.type, 24).toLowerCase().replace(/[^a-z ]/gu, "").trim() || "place";
  // R60 (kit): the look and the layout are two fields (the R57 card copied one line into both, so the sheet request said it twice);
  // the sheet is drawn from the kit's two-panel template (background-sheets.js). The look arrives with the cast notes.
  if (kit) return { id: String(id || ""), name: str(p?.name, 30), nameEn: str(p?.nameEn, 30) || str(p?.name, 30), type, description: look || `a ${type}`, layout: str(p?.layout, 200), version: 1, source: "writers-room", sheetKit: 1, autoRunId: String(jobId || ""), autoReviewPending: true, createdAt: now };
  return { id: String(id || ""), name: str(p?.name, 30), nameEn: str(p?.nameEn, 30) || str(p?.name, 30), type, description: look, layout: look, version: 1, source: "writers-room", autoRunId: String(jobId || ""), autoReviewPending: true, createdAt: now };
}
const KIND_WORDS = Object.freeze({ child: "child", kid: "child", boy: "child", girl: "child", adult: "adult", man: "adult", woman: "adult", grandma: "adult", grandpa: "adult", teacher: "adult" });
/** The drawer record of one new character — the shape materializeAutoPlan gives a plan's new companion (its sheet is bought like theirs). */
/** R60: the body kind a card's sheet is drawn from — the cast notes' build, else a guess from the kind. */
export function buildOf(kind, build = "") {
  if (BUILDS.includes(build)) return build;
  const k = String(kind || "").toLowerCase();
  if (k === "child" || k === "adult") return "human";
  if (/^(bird|owl|duck|chick|hen|crow|sparrow|penguin|parrot|eagle|swan|goose)$/u.test(k)) return "bird";
  if (/^(robot|doll|toy|teddy|ball|cup|kettle|spoon|shoe|hat|cloud|star|moon|sun|lamp|book|box|clock|car|train|boat)$/u.test(k)) return "object";
  if (/^(deer|fawn|dog|puppy|cat|kitten|rabbit|bunny|fox|wolf|bear|cub|horse|pony|cow|pig|sheep|lamb|goat|mouse|squirrel|hedgehog|raccoon|tiger|lion|elephant|giraffe|zebra|dinosaur|dino|turtle|frog|lizard|otter|badger|mole|calf|foal|kid)$/u.test(k)) return "four-legged";
  return "other";
}
export function roomCastRecord(c, { id, jobId, now = new Date().toISOString(), kit = false } = {}) {
  const kindWord = str(c?.kind, 24).toLowerCase().replace(/[^a-z]/g, ""),
    kind = KIND_WORDS[kindWord] || kindWord || "friend",
    human = kind === "child" || kind === "adult",
    look = str(c?.look, 160);
  // R60 (kit): no default colours (the fawn's card carried a green body colour), the look once (not as description and
  // appearance), the body kind for the sheet template (world.js); the look arrives with the cast notes (roomCardWithLook).
  if (kit) {
    const build = buildOf(kind, str(c?.build, 20));
    return {
      id: String(id || ""),
      name: str(c?.name, 30),
      nameEn: str(c?.nameEn, 30) || str(c?.name, 30),
      role: "조연",
      kind,
      build,
      gender: "",
      description: look || `a ${kind}`,
      traits: [str(c?.want, 100), str(c?.flaw, 100)].filter(Boolean).slice(0, 2),
      catchphrase: "",
      version: 1,
      color: "",
      appearance: "",
      clothes: "",
      hairColor: "",
      skinColor: "",
      wardrobe: [],
      characterSheets: [],
      source: "writers-room",
      sheetKit: 1,
      autoRunId: String(jobId || ""),
      autoReviewPending: true,
      createdAt: now,
    };
  }
  // R55f (Codex R55e 실측): the fawn's card carried a human hair and skin colour and its sheet came out as a child's face on a deer's body —
  // an animal card says so and carries no hair or skin colour.
  const description = human || !look ? look : `${look} — a real ${kind}: animal head, face and body (no human face, hair or skin)`;
  return {
    id: String(id || ""),
    name: str(c?.name, 30),
    nameEn: str(c?.nameEn, 30) || str(c?.name, 30),
    role: "조연",
    kind,
    gender: "",
    description,
    traits: [str(c?.want, 100), str(c?.flaw, 100)].filter(Boolean).slice(0, 2),
    catchphrase: "",
    version: 1,
    color: "#a8bb91",
    appearance: description,
    clothes: "",
    hairColor: human ? "#493b34" : "",
    skinColor: human ? "#edceb3" : "",
    wardrobe: [],
    characterSheets: [],
    source: "writers-room",
    autoRunId: String(jobId || ""),
    autoReviewPending: true,
    createdAt: now,
  };
}
/**
 * R60: a kit card with the look the cast notes gave it — a character's description and body kind, a place's
 * description and layout. Returns a new record (the version is unchanged: the card has no sheet yet).
 */
export function roomCardWithLook(card, entry) {
  if (!object(card) || !object(entry)) return card;
  if ("layout" in entry) return { ...card, ...(str(entry.look, 200) ? { description: str(entry.look, 200) } : {}), ...(str(entry.layout, 200) ? { layout: str(entry.layout, 200) } : {}) };
  return { ...card, ...(str(entry.look, 240) ? { description: str(entry.look, 240) } : {}), build: buildOf(card.kind, entry.build) };
}
/** R60: a page's picture is drawn wide or from the middle distance (a place sheet is attached to those only). */
const placePicture = (page) => {
  const shot = page?.picturePlan?.shot || "";
  if (shot) return shot === "wide" || shot === "middle";
  return !["closeup", "over_shoulder"].includes(String(page?.staging?.shot || ""));
};
/**
 * R60: which new cards the finished pages need a sheet for — a character named on two pages or more (the reading's
 * who), a place in two wide or middle pictures or more (a close picture carries no place sheet). One page has no
 * other page to match, so it is drawn from its words. Returns the ids to keep and to drop, with the counts.
 */
export function roomSheetChoice(pages, { cast = [], places = [], shotOf = null } = {}) {
  const rows = list(pages).filter(object),
    count = (fn) => rows.filter(fn).length,
    // R61 (audit C): the camera the picture request will really use (effectiveStaging) when the caller can say it.
    wideEnough = (p) => (typeof shotOf === "function" ? !["closeup", "over_shoulder"].includes(String(shotOf(p) || "")) : placePicture(p));
  const castCounts = list(cast).map((id) => ({ id: String(id), pages: count((p) => [...list(p?.scene?.who), ...list(p?.scene?.extra)].map(String).includes(String(id))) })),
    placeCounts = list(places).map((id) => ({ id: String(id), pages: count((p) => String(p?.scene?.where || "") === String(id) && wideEnough(p)) }));
  return {
    cast: { keep: castCounts.filter((c) => c.pages >= 2).map((c) => c.id), drop: castCounts.filter((c) => c.pages < 2).map((c) => c.id), counts: castCounts },
    places: { keep: placeCounts.filter((c) => c.pages >= 2).map((c) => c.id), drop: placeCounts.filter((c) => c.pages < 2).map((c) => c.id), counts: placeCounts },
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
    // R59: a lean room does not ask the reading where the words sit (placeRoomPockets decides).
    pocket = hasTextPocket(input) && !hasRoomLean(input);
  return {
    properties: {
      shot: { type: "string", enum: [...SHOTS] },
      space: { type: "string", enum: [...SPACES] },
      carrier: { type: "string", enum: [...CARRIERS_READ] },
      ...(drama ? { focus: { type: "string", maxLength: 80 }, backdrop: { type: "string", enum: [...BACKDROPS_READ] } } : {}),
      ...(pocket ? { pocket: { type: "string", enum: [...POCKETS] } } : {}),
      // R55g: what the words keep from the hero (the reader sees it) and what the next page reveals — "" when the words say no such thing.
      hidden: { type: "string", maxLength: 160 },
      holdBack: { type: "string", maxLength: 120 },
      // R58: the one piece of writing a thing in this picture carries (digits and capital Latin letters) and the thing it is on — "" when none.
      lettering: { type: "string", maxLength: 24 },
      letteringOn: { type: "string", maxLength: 80 },
      // R61 (audit E): what a thing in the picture really is when someone in the story takes it for something else — "" when nothing is.
      ...(hasRoomKept(input) ? { seenAs: { type: "string", maxLength: 160 } } : {}),
    },
    line: `${hasRoomKept(input) ? " seenAs (only when someone in the story takes a thing in the picture for something else, or a character is hidden as or inside something: what it really is, what the character thinks it is, and the one clue the reader can see — e.g. \"the brown rock is Kongi curled up; Mom thinks it is a rock; one white ear tip shows\"; \"\" otherwise)." : ""} Also, for the picture of each page: shot (wide = small figures in a big world; middle; close = faces and hands fill the frame — vary it page to page as the moment asks), space (full = a busy picture; airy = lots of quiet empty space), carrier (words = the text carries this moment and the picture is quiet; picture = the text is short and the picture tells it; both)${drama ? ", focus (the one thing the eye lands on, a few English words), backdrop (scene = the place is drawn; plain = the character alone on a flat single-colour background — a thought or a line to the reader; at most two pages in the book, never the first or last)" : ""}${pocket ? ", pocket (where the printed words sit on the picture: left, right, top or bottom — the part with no action, bigger when the words carry the page; none only for a page of one shouted word)" : ""}, hidden (when someone in the story does not see or notice something that the reader can — because this page's words or art note say so, or because an earlier page hid it and nothing has revealed it yet, even when this page's words do not say it again: who does not see it, what it is, where it is in the frame relative to them, and which way they face — one English sentence; "" otherwise), holdBack (only when the NEXT page reveals something this page must not show yet: what to keep out of this picture, a few words; "" otherwise), lettering (only when the words or the art note put writing on a thing in the story's world — a rocket's name, a bus number, a shop sign: the exact characters, digits and capital Latin letters only, 12 at most, one per page; a Korean name is given by its number or its English capitals (아폴로 13호 → APOLLO 13); "" otherwise) and letteringOn (the thing it is written on and where on it, a few English words; "" when there is no lettering).`,
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
    extra = list(outline?.writersRoom?.premise?.cast).filter((c) => c?.isNew).map((c) => str(c.name, 30)).filter((n) => n && !known.has(n)),
    // R55h: the writer's art notes (what a picture shows and the words do not) reach the illustrator through the reading.
    artNote = list(pages).some((p) => str(p?.art, 400))
      ? ` A page may carry the writer's art note ([art] …): something its picture shows that the words do not say — put it into that page's action and props${reading.properties.hidden ? ", and into hidden when someone in the story does not notice it" : ""}. A picture cannot hold captions or labels: when a note asks for explanatory words or numbers in the picture (a count in a corner, a caption), give countable things or a gesture instead and never write "labeled"${reading.properties.lettering ? "; writing that is on a thing in the story's world goes into lettering" : ""}.`
      : "";
  const request = {
    system: `You read a finished Korean picture book (with its English edition when given) and return, for every page, what the illustrator needs — never rewriting the words. Per page: who (${hasRoomKept(input) ? "the IDs of every character any part of whom is in the picture — a pair of ears over a bush or a tail behind a tree is that character; a narrator who only speaks from outside the picture is not in it; [] when no one is in the picture; from the cast list only" : "the character IDs on the page, 1–5, from the cast list only"}${extra.length ? `; ${extra.join(", ")} are new to this book and have no ID — describe them inside action instead` : ""}), where (one line in English, naming a supplied place ID when the page is there), action (one English sentence of the picture: who does what, with what, where in the frame${hasRoomKept(input) ? "; a character seen only in part is described by the part that shows" : ""}), emotion (one English word), timeOfDay (${TIMES.join("/")}), props (${hasRoomKept(input) ? "0–6 concrete things in English the picture needs" : "2–6 concrete things in English"}).${reading.line}${artNote} Also cover: title (the book's title as given) and sceneAction (one English sentence for the cover picture: ${lead ? `${str(lead.name, 30)} alone` : "the main character alone"} — no companion on the cover). Return exactly ${count} pages in order.\n\n[cast] ${cast || "(none)"}\n[places] ${places || "(none)"}`,
    user: list(pages).map((p, i) => `${i + 1}쪽: ${str(p.ko, 1200)}${p.en ? `\n   EN: ${str(p.en, 1200)}` : ""}${str(p.art, 400) ? `\n   [art] ${str(p.art, 400)}` : ""}`).join("\n"),
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["cover", "pages", ...(hasRoomClear(input) ? ["things", "extras", "stages"] : [])],
      properties: {
        cover: { type: "object", additionalProperties: false, required: ["title", "sceneAction"], properties: { title: { type: "string", maxLength: 100 }, sceneAction: { type: "string", maxLength: 500 } } },
        // R62: the things that matter and come back (a sign, a toy, a door) — one fixed look each, drawn the same on every page.
        ...(hasRoomClear(input)
          ? {
              things: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, required: ["name", "look", "pages"], properties: { name: { type: "string", maxLength: 40 }, look: { type: "string", maxLength: 220 }, pages: { type: "array", maxItems: 40, items: { type: "integer", minimum: 1 } } } } },
              // R63: the walk-ons with no card, one fixed look each for the whole book; the recurring places with no sheet, one fixed layout map each.
              extras: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, required: ["name", "look"], properties: { name: { type: "string", maxLength: 40 }, look: { type: "string", maxLength: 220 } } } },
              stages: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, required: ["name", "map"], properties: { name: { type: "string", maxLength: 40 }, map: { type: "string", maxLength: 300 } } } },
            }
          : {}),
        pages: {
          type: "array",
          minItems: count,
          maxItems: count,
          items: {
            type: "object",
            additionalProperties: false,
            // R55c: no beatIndex — the beats are the app's (dealt over the pages), never the reader's guess; the reading's picture fields for a picture-led draft.
            required: ["pageNo", "who", "where", "action", "emotion", "timeOfDay", "props", ...Object.keys(reading.properties), ...(hasRoomClear(input) ? ["mustSee", "pose", "extras", "stage"] : [])],
            properties: {
              pageNo: { type: "integer", minimum: 1 },
              who: { type: "array", minItems: hasRoomKept(input) ? 0 : 1, maxItems: 5, items: { type: "string", maxLength: 60 } },
              // R63: what this page's picture must show first, the pose of an unusual move (side view), the walk-ons on it.
              ...(hasRoomClear(input)
                ? {
                    mustSee: { type: "array", minItems: 1, maxItems: 2, items: { type: "string", maxLength: 120 } },
                    pose: { type: "string", maxLength: 240 },
                    extras: { type: "array", maxItems: 3, items: { type: "string", maxLength: 40 } },
                    stage: { type: "string", maxLength: 40 },
                  }
                : {}),
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
    maxTokens: 6000 + (Object.keys(reading.properties).length ? count * 60 : 0) + (hasRoomClear(input) ? count * 40 + 600 : 0),
  };
  // R62: a clear room's reading also draws the things that come back the same way, draws the unnamed walk-ons, and says
  // which way a body faces when someone moves in an unusual way (the paid book's "walking backwards" came out as a
  // forward walk with the head turned).
  // R63: a clear room's reading is told first what matters most to the pictures (before the cast and place data).
  if (hasRoomClear(input)) request.system = request.system.replace(" Return exactly ", ` ${CLEAR_READING} Return exactly `);
  return request;
}
/** R63: the clear reading's instructions — what each picture must show, who is in it, the fixed looks and maps, the pose of an unusual move. */
const CLEAR_READING = "MOST IMPORTANT, for every page: action is the ONE moment of THIS page's own words (never the page before or after; one moment, not two). mustSee: the one or two things a child must see in the picture to understand this page (\"the bakery far away and small\", \"the new girl under the sign\"). who: everyone in the cast whom the words or the art note of this page (or the page just before or after) put in the picture — including whoever is speaking or counting there — and no one else. extras: the names of the walk-ons on this page who have no ID (a new child, a humming old goose, a shopkeeper) — each also listed once in the book-level extras with ONE fixed look (species or person, size against the hero, clothes, colours) that is repeated on every page they are on. stage: when this page is at a recurring place that is not in [places] (outdoors or indoors — a village gate, a road, the inside of a shop), its name as listed in the book-level stages with ONE layout map (what stands at the LEFT, the RIGHT, near, far — e.g. \"the old tree with the sign at the LEFT, the road runs left to right, the shop at the RIGHT end\"); \"\" otherwise. things: the objects that matter and appear on two or more pages, ONE fixed look each (material, shape, colours, how it is mounted — one reading only, never \"shaped like X\" and \"painted with X\" at once) and every page they are on. pose: only when someone moves in an unusual way (backwards, upside down, sideways, crawling), whose pose it is and the pose as seen FROM THE SIDE: which way the face, chest and toes point and which way the body moves — e.g. \"Mina, seen from the side: faces LEFT, away from the shop — face, chest and toes point left — but moves RIGHT toward it, leaning back, the right heel reaching back to the right\"; never only \"walks backwards\"; the action then says the same (never \"facing the viewer\" for a side-view pose); \"\" otherwise. A page with a pose, or where how near or far something is tells the story, is never a plain backdrop.";
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
/** R55f: the supplied place a reading's `where` names first ("forest and home" → forest), by id, name or English name; "" when none. */
export function placeIdIn(where, backgrounds) {
  const text = normName(where);
  if (!text) return "";
  let best = "", at = Infinity;
  for (const b of list(backgrounds).filter(object)) {
    for (const key of [b.id, b.name, b.nameEn].map(normName).filter(Boolean)) {
      const i = text.indexOf(key);
      if (i >= 0 && i < at) { at = i; best = String(b.id); }
    }
  }
  return best;
}
/** R55f: one page's picture plan from its own reading row (shot·space·carrier·focus·pocket; the backdrop is the page's, settled below). */
function pagePlanFromReading(row, input) {
  if (!wantsPicturePlan(input)) return null;
  const plan = normalizePicturePlan({ carrier: str(row?.carrier, 20) || "both", shot: row?.shot, space: row?.space, focus: row?.focus, backdrop: row?.backdrop, pocket: row?.pocket }, input);
  if (!plan) return null;
  if (plan.backdrop !== "plain") delete plan.backdrop;
  if (plan.pocket && !["left", "right", "top", "bottom"].includes(plan.pocket)) delete plan.pocket;
  // R55g: the story's logic the picture must keep (both optional; the request says them only when present).
  if (str(row?.hidden, 160)) plan.hidden = str(row.hidden, 160);
  // R61: a thing someone in the story takes for something else (the reading's seenAs).
  if (str(row?.seenAs, 160)) plan.seenAs = str(row.seenAs, 160);
  if (str(row?.holdBack, 120)) plan.holdBack = str(row.holdBack, 120);
  // R58: writing on a thing — only what a picture model can spell (digits and capital Latin letters), and only with the thing it is on.
  const lettering = pictureLettering(row?.lettering);
  if (lettering && str(row?.letteringOn, 80)) {
    plan.lettering = lettering;
    plan.letteringOn = str(row.letteringOn, 80);
  }
  return plan;
}
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
    plainOk = wantsPicturePlan(input) && hasStoryDrama(input),
    kept = hasRoomKept(input),
    bilingualDraft = list(pages).some((q) => typeof q?.en === "string" && q.en.trim()),
    clear = hasRoomClear(input);
  // R62: a character other than the hero is on a page only when the words or art note of that page (or the one before or
  // after) name them — the paid book drew the dinosaur and the deer into pages whose words never mention them.
  const GENERIC = new Set(["아저씨", "아줌마", "할머니", "할아버지", "아이", "친구", "엄마", "아빠"]);
  const wordsAt = (i) => [pages[i - 1], pages[i], pages[i + 1]].filter(object).map((q) => `${q.ko || ""} ${q.en || ""} ${q.art || ""}`).join(" ").toLowerCase();
  const namesOf = (id) => {
    const c = list(input?.characters).find((x) => String(x?.id) === id);
    if (!c) return [];
    const whole = [c.name, c.nameEn].map((n) => String(n || "").trim().toLowerCase()).filter(Boolean);
    const parts = String(c.name || "").split(/\s+/u).filter((t) => t.length >= 2 && !GENERIC.has(t));
    return [...whole, ...(whole.length && String(c.name || "").includes(" ") ? parts.map((t) => t.toLowerCase()) : [])];
  };
  const grounded = (id, i) => id === cast[0] || namesOf(id).some((n) => wordsAt(i).includes(n));
  // R63: the book's walk-ons and recurring places, one fixed look / map each.
  const extrasBook = clear ? list(raw?.extras).filter(object).map((x) => ({ name: str(x.name, 40), look: str(x.look, 220) })).filter((x) => x.name && x.look).slice(0, 4) : [],
    stagesBook = clear ? list(raw?.stages).filter(object).map((x) => ({ name: str(x.name, 40), map: str(x.map, 300) })).filter((x) => x.name && x.map).slice(0, 3) : [];
  const byName = (rows, name) => rows.find((r) => r.name.toLowerCase() === String(name || "").trim().toLowerCase());
  const mapNames = (stage, thing) => !!stage && String(thing.name).toLowerCase().replace(/^(the|a|an) /u, "").split(/\s+/u).filter((w) => w.length >= 4).some((w) => stage.map.toLowerCase().includes(w));
  // R62: the things that come back, by page.
  const things = clear
    ? list(raw?.things).filter(object).map((t) => ({ name: str(t.name, 40), look: str(t.look, 220), pages: [...new Set(list(t.pages).map((n) => Math.round(Number(n))).filter((n) => n >= 1 && n <= count))] })).filter((t) => t.name && t.look && t.pages.length >= 2).slice(0, 4)
    : [];
  const out = list(pages).map((p, i) => {
    const found = rows.find((r) => Number(r.pageNo) === i + 1) || (kept ? null : rows[i]),
      row = found || {};
    const missingEn = kept && bilingualDraft && !(typeof p.en === "string" && p.en.trim());
    const named = [...new Set(list(row.who).map(castId).filter(Boolean))].filter((id) => !clear || grounded(id, i)),
      // R61a: a crowded picture (six or more of the cast — the paid '구름 주문' book stopped here) keeps five on who (the
      // validator's limit), the hero first, and the rest on scene.extra; the picture request still draws them all.
      crowd = named.length > 5 ? (named.includes(cast[0]) ? [cast[0], ...named.filter((id) => id !== cast[0])] : named) : named,
      who = crowd.slice(0, 5),
      extra = crowd.slice(5),
      // R61 (audit I): an explicit empty who is a picture with no one in it (the validator needs one ID, so the hero
      // stays listed and the page is marked); a page the reading did not return is marked missing, never made up quietly.
      nobody = kept && !!found && Array.isArray(found.who) && found.who.length === 0;
    let beat = openingBeat.length ? openingBeat[i] : Number(row.beatIndex);
    if (!beats.includes(beat) || beat < last) beat = Math.max(last, fallbackBeat(i));
    last = beat;
    const emotion = /^[A-Za-z]+(?:-[A-Za-z]+)?$/u.test(str(row.emotion, 40)) ? str(row.emotion, 40) : "calm";
    // R55f: a supplied place the reading names becomes the page's place id (the staging, the place reference and the earlier-page
    // references resolve it per page — the paid book's forest page took the home reference because the beat's place was home).
    const placeId = placeIdIn(row.where, input?.backgrounds),
      plan = pagePlanFromReading(row, input);
    return {
      pageNo: i + 1,
      beatIndex: beat,
      textKo: p.ko,
      // R61b (Codex V3): a kept book's page whose English never came back keeps an empty English, marked — never the Korean.
      textEn: missingEn ? "" : p.en || p.ko,
      ...(plan ? { picturePlan: plan } : {}),
      scene: {
        who: who.length ? who : cast.slice(0, 1),
        where: placeId || str(row.where, 500) || "the story's place",
        action: str(row.action, 500) || str(p.en || p.ko, 500),
        emotion,
        timeOfDay: TIMES.includes(row.timeOfDay) ? row.timeOfDay : "day",
        props: list(row.props).map((v) => str(v, 80)).filter(Boolean).slice(0, 12),
        // R61 (audit A): the words this page's picture was read from — a later edit of the words makes the plan stale.
        ...(kept ? { textKey: pageTextKey(p.ko, p.en || p.ko), koKey: pageTextKey(p.ko), enKey: pageTextKey(missingEn ? "" : p.en || p.ko) } : {}),
        ...(missingEn ? { englishMissing: true } : {}),
        ...(extra.length ? { extra } : {}),
        // R63: every clear page has something it must show (the action when the reading gave nothing).
        ...(clear ? { mustSee: list(row.mustSee).map((v) => str(v, 120)).filter(Boolean).slice(0, 2).length ? list(row.mustSee).map((v) => str(v, 120)).filter(Boolean).slice(0, 2) : [str(row.action, 120) || str(p.en || p.ko, 120)].filter(Boolean) } : {}),
        ...(clear && str(row.pose, 240) ? { pose: str(row.pose, 240) } : {}),
        ...(clear && list(row.extras).map((n) => byName(extrasBook, n)).filter(Boolean).length ? { extras: [...new Map(list(row.extras).map((n) => byName(extrasBook, n)).filter(Boolean).map((x) => [x.name, x])).values()] } : {}),
        ...(clear && !placeId && byName(stagesBook, row.stage) ? { stage: byName(stagesBook, row.stage) } : {}),
        // R63: and on a stage page whose map names the thing (the map calls it, so its one look rides along).
        ...(things.some((t) => t.pages.includes(i + 1) || (clear && !placeId && mapNames(byName(stagesBook, row.stage), t))) ? { things: things.filter((t) => t.pages.includes(i + 1) || (clear && !placeId && mapNames(byName(stagesBook, row.stage), t))).map(({ name, look }) => ({ name, look })) } : {}),
        ...(nobody ? { nobody: true } : {}),
        ...(kept && !found ? { readingMissing: true } : {}),
      },
      variantByCharacter: {},
      isRefrainPage: false,
      // R55c: a plain-backdrop page from the reading (settleBackdrops keeps it only where the beat's plan agrees and within the caps).
      // R63: a page with a pose is never a plain backdrop.
      ...(plainOk && str(row.backdrop, 20) === "plain" && !(clear && str(row.pose, 240)) ? { backdrop: "plain" } : {}),
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
/** R55h: two joined pages keep both art notes. */
function joinArt(a, b) {
  const art = [str(a?.art, 200), str(b?.art, 200)].filter(Boolean).join(" / ").slice(0, 400);
  return art ? { art } : {};
}
const splitPage = (p) => {
  const ko = sentences(p.ko);
  if (ko.length < 2) return null;
  const cut = Math.ceil(ko.length / 2),
    en = p.en !== undefined ? sentences(p.en) : null,
    cutEn = en ? Math.ceil(en.length / 2) : 0;
  return [
    { ko: ko.slice(0, cut).join(" "), ...(en ? { en: en.slice(0, cutEn).join(" ") } : {}), ...artOf(p) },
    { ko: ko.slice(cut).join(" "), ...(en ? { en: en.slice(cutEn).join(" ") } : {}) },
  ];
};
const joinPages = (a, b) => ({ ko: `${a.ko} ${b.ko}`.trim(), ...(a.en !== undefined || b.en !== undefined ? { en: `${a.en || ""} ${b.en || ""}`.trim() } : {}), ...joinArt(a, b) });
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
/** R55e: the most sentences one single page may carry (the page check's rhythm band: max(page.max, ⌈page.max × 1.6⌉) — 5 for a picture-led K2 book), or null. */
export function pageSentenceCap(spec) {
  const max = Number(spec?.units?.page?.max);
  if (!(max > 0)) return null;
  return Math.max(max, Math.ceil(max * (Number(spec?.rhythm?.pageMaxFactor) || 1.6)));
}
export function fitSpreadMarks(pages, openings, { cap = null, capEn = null } = {}) {
  const c = Number(openings) || 0;
  let rows = list(pages).filter(object).map((p) => ({ ...p }));
  const marked = () => rows.filter((p) => p.spread === true).length;
  if (!c || !marked()) return { pages: rows, fitted: true, marks: 0, moved: 0 };
  let moved = 0;
  for (let i = rows.length - 1; i >= 0 && marked() > c; i--) if (rows[i].spread === true) { delete rows[i].spread; moved += 1; }
  // R55e: a mark the count cannot hold without an oversize page is released (the spread becomes a pair) instead.
  const release = () => {
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].spread === true) { delete rows[i].spread; moved += 1; return true; }
    return false;
  };
  const targetOf = () => 2 * c - marked();
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
  // R55e (A/B 3차 4-2): a join that would put more sentences on one page than the page check allows is not made
  // (Opus's 16 entries with two marks were joined into pages of 8 and 6 sentences).
  // R55f (Codex R55e 실측): the English of a joined page is capped too — the paid book's last page came out 5 Korean / 6 English sentences (E2 allows 4).
  const fits = (a, b) =>
    (cap === null || sentences(a.ko).length + sentences(b.ko).length <= cap) &&
    (capEn === null || (a.en === undefined && b.en === undefined) || sentences(a.en || "").length + sentences(b.en || "").length <= capEn);
  const join = (runs) => {
    let best = -1, size = Infinity;
    for (const r of runs) for (let i = r.start; i + 1 < r.start + r.length; i++) { const n = rows[i].ko.length + rows[i + 1].ko.length; if (n < size && fits(rows[i], rows[i + 1])) { size = n; best = i; } }
    if (best < 0) return false;
    rows.splice(best, 2, joinPages(rows[best], rows[best + 1]));
    return true;
  };
  let guard = 64;
  for (let round = 0; round < 8 && guard > 0; round++) {
    while (rows.length < targetOf() && guard-- > 0) if (!split(inRun("odd")) && !split(inRun("any"))) break;
    while (rows.length > targetOf() && guard-- > 0) {
      if (join(inRun("odd")) || join(inRun("any"))) continue;
      // No join fits: one spread mark less means one page less to shed.
      if (!release()) break;
    }
    const odd = unmarkedRuns(rows).filter((r) => r.length % 2 === 1);
    if (odd.length < 2 || rows.length !== targetOf()) break;
    // One odd run grows by a split, another shrinks by a join: the count stays, both turn even.
    // R55e: when no join fits under the cap the split is undone and the mark after the first odd
    // run is released instead (the runs around it merge), then the count is balanced again.
    const before = rows.map((p) => ({ ...p }));
    let done = false;
    for (const grow of odd) {
      if (!split([grow])) continue;
      const rest = unmarkedRuns(rows).filter((r) => r.length % 2 === 1);
      done = rest.length > 0 && join([rest[0]]);
      if (!done) rows = before.map((p) => ({ ...p }));
      break;
    }
    if (done) continue;
    const at = odd[0].start + odd[0].length;
    if (rows[at]?.spread === true) {
      delete rows[at].spread;
      moved += 1;
      continue;
    }
    break;
  }
  const fitted = rows.length === targetOf() && !unmarkedRuns(rows).some((r) => r.length % 2 === 1);
  return { pages: rows, fitted, marks: marked(), moved };
}
/**
 * R55h: how woven the finished book is, counted from its pages (the reading's
 * who and props per page): every character's page count, the characters on one
 * page only, and the things named on a page, absent for two pages or more, and
 * named again. A reference for the parent and the runner — nothing is checked.
 */
export function weaveReport(pages, { artNotes = 0, returning: wanted = true } = {}) {
  const rows = list(pages).filter(object),
    castPages = new Map(),
    seen = new Map();
  const head = (value) => {
    const words = String(value || "").toLowerCase().replace(/[^a-z0-9 ]+/gu, " ").trim().split(/\s+/u).filter(Boolean);
    return (words.at(-1) || "").replace(/(?<=[a-z]{3})s$/u, "");
  };
  rows.forEach((p, i) => {
    for (const id of new Set(list(p?.scene?.who).map(String).filter(Boolean))) castPages.set(id, (castPages.get(id) || 0) + 1);
    for (const prop of new Set(list(p?.scene?.props).map(head).filter((w) => w.length > 2))) (seen.get(prop) || seen.set(prop, []).get(prop)).push(i + 1);
  });
  const returning = [];
  for (const [prop, at] of seen) {
    const k = at.findIndex((page, n) => n > 0 && page - at[n - 1] >= 3);
    if (k > 0) returning.push({ prop, from: at[k - 1], to: at[k] });
  }
  return {
    pages: rows.length,
    cast: [...castPages].map(([id, count]) => ({ id, pages: count })),
    single: [...castPages].filter(([, count]) => count === 1).map(([id]) => id),
    ...(wanted ? { returning: returning.slice(0, 8) } : {}),
    artNotes,
  };
}
/* ---------- R59: the app places the printed words; the book is counted from its own Korean words ---------- */
const wordUnits = (text) => [...String(text ?? "")].reduce((n, ch) => n + (/[\u3131-\uD7A3]/u.test(ch) ? 1 : 0.5), 0);
/** The most letters (Korean 1, others ½) a page may carry and still get a field inside its picture. */
export const POCKET_WORDS_MAX = 60;
/**
 * R59: where the words of a lean room page sit. The cheap reading used to pick a side for every page (4 of 11 fields
 * were usable, and each request also said "the text is printed below"). Now the app decides, from what it already
 * knows: a field only on a wide picture whose words are short, on the side away from the figure (the side the
 * composition sentence gives the lead, so the two sentences agree); every other page prints its words below the
 * picture. Mutates the accepted pages' own plans; returns how many pages got a field.
 */
export function placeRoomPockets(pagination, input) {
  if (!hasTextPocket(input)) return 0;
  let placed = 0;
  for (const page of list(pagination?.pages)) {
    const plan = object(page?.picturePlan) ? page.picturePlan : null;
    if (!plan) continue;
    delete plan.pocket;
    if (plan.shot !== "wide" || plan.backdrop === "plain" || page.backdrop) continue;
    const words = input?.language === "en" ? page.textEn ?? page.en : page.textKo ?? page.ko;
    if (!str(words, 1200) || wordUnits(words) > POCKET_WORDS_MAX) continue;
    const side = page.staging?.characterSide,
      lead = side === "left" || side === "right" ? side : side ? "" : page.kind === "spread" ? (Number(page.openingNo) % 2 === 0 ? "right" : "left") : page.side === "right" ? "right" : "left";
    if (!lead) continue;
    plan.pocket = lead === "left" ? "right" : "left";
    placed += 1;
  }
  return placed;
}
const KO_PARTICLES = Object.freeze([
  ["에서는", 0], ["에게서", 0], ["한테서", 0], ["으로는", 1], ["이랑은", 1], ["에서", 0], ["에게", 0], ["한테", 0], ["까지", 0], ["부터", 0], ["처럼", 0], ["보다", 0], ["마다", 0], ["하고", 0], ["으로", 1], ["이랑", 1],
  ["은", 1], ["이", 1], ["을", 1], ["과", 1], ["아", 1], ["는", 2], ["가", 2], ["를", 2], ["와", 2], ["로", 2], ["랑", 2], ["야", 2], ["에", 0], ["의", 0], ["도", 0], ["만", 0],
]);
/** Everyday nouns whose last letter looks like a predicate ending (바다, 강아지 …) — kept as they are. */
const KO_NOUNS_LIKE_PREDICATES = new Set("바다 강아지 송아지 망아지 돼지 편지 바지 가지 딸기지 반지 먼지 할머니 어머니 아주머니 주머니 그네 가게 무게 날개지 담요 창고 최고 사고 냉장고 상어 문어 고등어 붕어 잉어 단어 의자 모자 과자 피자 국자 그림자 상자 아기 고기 이야기 소리 다리 머리 꼬리 도토리 개구리 오리".split(" "));
const batchim = (ch) => {
  const code = String(ch || "").codePointAt(0) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 !== 0;
};
/** A Korean word with its particle taken off by the sound it follows (1 = after a consonant, 2 = after a vowel); "" for what reads as a predicate. */
function koStem(word) {
  const w = String(word || "");
  if (w.length < 2) return "";
  if (KO_NOUNS_LIKE_PREDICATES.has(w)) return w;
  if (/(요|다|죠|까|니|네|지|고|며|서|면|게|어|아|해|여|러|려|듯|던)$/u.test(w)) return "";
  for (const [particle, after] of KO_PARTICLES) {
    // A particle chosen by sound may leave a one-letter word (코가 → 코, 집으로 → 집); the others (도·만·에·의) need two letters before them (파도 stays 파도).
    if (!w.endsWith(particle) || w.length - particle.length < (after ? 1 : 2)) continue;
    const before = w[w.length - particle.length - 1];
    if (after === 1 && !batchim(before)) continue;
    if (after === 2 && batchim(before)) continue;
    return w.slice(0, -particle.length);
  }
  return /(은|는|을)$/u.test(w) ? "" : w;
}
const koWords = (text) => (String(text ?? "").match(/[가-힣]+/gu) || []).map(koStem).filter(Boolean);
const bigrams = (text) => {
  const t = String(text ?? "").replace(/[^가-힣]+/gu, "");
  return new Set(Array.from({ length: Math.max(0, t.length - 1) }, (_, i) => t.slice(i, i + 2)));
};
/** How alike two Korean texts are: Jaccard over their two-letter runs (0–1, two decimals). */
export function textLikeness(a, b) {
  const x = bigrams(a),
    y = bigrams(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const g of x) if (y.has(g)) both += 1;
  return Math.round((both / (x.size + y.size - both)) * 100) / 100;
}
/**
 * R59: the book counted from its own Korean words — never from a model's list (the R55h count took the last English
 * word of the cheap reading's props: "forest floor" counted as a returning "floor", the acorns were missed). A
 * reference for the parent and the runner; nothing is checked and no stem rule is exact (particles are taken off by
 * sound, predicates dropped by their endings), so the words are listed beside every number.
 *   castText   who is named in the words, on which pages (cast = [{id, name}]; the first is the hero)
 *   companions pages whose words name anyone but the hero
 *   artOnly    per character, pages where only the art note names them
 *   lateWords  words first heard in the last four pages (a pay-off the listener was never given the plant for);
 *              `artFirst` marks those an earlier art note had already named
 *   refrains   short lines (≤ 12 letters) that come back on another page
 *   artShare   letters of the art notes ÷ letters of the words
 */
export function textWeave(pages, { cast = [] } = {}) {
  const rows = list(pages).filter(object).map((p) => ({ ko: String(p.textKo ?? p.ko ?? ""), art: String(p.art ?? "") })),
    names = list(cast).filter(object).map((c) => ({ id: String(c.id ?? ""), name: str(c.name, 30) })).filter((c) => c.name),
    pagesOf = (name, key) => rows.map((r, i) => (r[key].includes(name) ? i + 1 : 0)).filter(Boolean),
    castText = names.map((c) => {
      const text = pagesOf(c.name, "ko"),
        art = pagesOf(c.name, "art").filter((n) => !text.includes(n));
      return { id: c.id, name: c.name, pages: text, ...(art.length ? { artOnly: art } : {}) };
    }),
    others = names.slice(1),
    companions = rows.map((r, i) => (others.some((c) => r.ko.includes(c.name)) ? i + 1 : 0)).filter(Boolean),
    tail = Math.max(0, rows.length - 4),
    early = new Set(rows.slice(0, tail).flatMap((r) => koWords(r.ko))),
    earlyArt = new Set(rows.slice(0, tail).flatMap((r) => koWords(r.art))),
    known = new Set(names.map((c) => c.name)),
    late = [];
  rows.slice(tail).forEach((r, k) => {
    for (const w of koWords(r.ko)) if (!early.has(w) && ![...known].some((name) => name.startsWith(w)) && !late.some((x) => x.word === w)) late.push({ word: w, page: tail + k + 1, ...(earlyArt.has(w) ? { artFirst: true } : {}) });
  });
  const lines = new Map();
  rows.forEach((r, i) => {
    for (const line of new Set(sentences(r.ko).map((t) => flat(t)).filter((t) => t && [...t.replace(/[^가-힣]/gu, "")].length <= 12 && /[가-힣]/u.test(t)))) (lines.get(line) || lines.set(line, []).get(line)).push(i + 1);
  });
  const letters = (key) => rows.reduce((n, r) => n + r[key].replace(/[^가-힣]/gu, "").length, 0);
  return {
    pages: rows.length,
    castText,
    companions,
    lateWords: late.slice(0, 16),
    refrains: [...lines].filter(([, at]) => at.length >= 2).map(([line, at]) => ({ line, pages: at })).slice(0, 8),
    artShare: letters("ko") ? Math.round((letters("art") / letters("ko")) * 100) / 100 : 0,
  };
}
export async function runRoomPages(input, outline, draft, options = {}, services = {}) {
  services = withEngines(services);
  if (!list(draft?.pages).length) throw new StoryValidationError("pagination", ["작가실 글이 없어요. 초고 단계부터 다시 만들어 주세요."]);
  // R54b: an openings book keeps its printed count (12 or 16) and takes C..2C
  // entries; a page book's count follows the writer (nearest binding).
  const openings = openingCount(input),
    clamped = clampPages(draft.pages, openings ? { min: openings, max: 2 * openings } : null),
    // R54g: the writer's spread marks are made to fit the binding before the deal.
    // R55e: no join may exceed what one page is allowed to carry.
    fit = openings ? fitSpreadMarks(clamped, openings, { cap: pageSentenceCap(input?.specs?.ko), capEn: pageSentenceCap(input?.specs?.en) }) : { pages: clamped, fitted: true, marks: 0, moved: 0 },
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
    // R63: the art director checks every page's plan against its own words (the middle model, once) before any picture.
    let director = null;
    if (hasRoomClear(sized) && options.roomDirector !== false) {
      const answer = await journal.call("prose", directorRequest(sized, settled.pages), services).then((r) => (r?.json !== undefined ? r.json : (() => { try { return parseJsonLenient(String(r?.text || "")); } catch { return null; } })())).catch((error) => { if (error?.name === "AbortError") throw error; return null; });
      director = applyDirector(settled.pages, answer, sized);
    }
    // R55c: the outline the pictures and prints read is rebuilt from the finished pages and the reading (beat summaries, places, feelings, the per-beat picture plan).
    const shaped = roomOutlineFromPages(outline, sized, settled.pages, raw);
    // R54e: the room's binding is the writer's — no "all pairs → last opening a spread" guard.
    // R55c: staging on — the pages get the camera rotation, sides and light the picture requests read (a room book had none before and fell back to the old prompt).
    const pagination = acceptEcoPagination(settled, shaped, sized, { bookId: sized.bookId, roomBinding: true, staging: true });
    // R59: a lean room's text fields are the app's (after the staging, so the field is on the side away from the figure).
    const lean = hasRoomLean(sized),
      pockets = lean ? placeRoomPockets(pagination, sized) : null;
    const report = inspectStory(shaped, pagination, sized);
    return {
      data: pagination,
      usage: journal.usage(),
      meta: { ...journal.summary(), stage: "roomPages", pageCount: printed, entries: pages.length, openings: openings || 0, checks: report, clamped: pages.length !== list(draft.pages).length, spreadFit: { marks: fit.marks, fitted: fit.fitted, moved: fit.moved }, outline: shaped,
        // R55g: how often the reading found something hidden from the hero or held back for the next page (watched, not enforced).
        reading: { hidden: list(settled.pages).filter((p) => p.picturePlan?.hidden).length, holdBack: list(settled.pages).filter((p) => p.picturePlan?.holdBack).length, lettering: list(settled.pages).filter((p) => p.picturePlan?.lettering).length, ...(hasRoomClear(input) ? { things: new Set(list(settled.pages).flatMap((p) => list(p.scene?.things).map((t) => t.name))).size, extras: new Set(list(settled.pages).flatMap((p) => list(p.scene?.extras).map((t) => t.name))).size, stages: new Set(list(settled.pages).map((p) => p.scene?.stage?.name).filter(Boolean)).size, poses: list(settled.pages).filter((p) => p.scene?.pose).length } : {}) },
        ...(director ? { director: { fixed: director.fixed, notes: director.notes, refused: director.refused } } : {}),
        // R55h: measured from the finished pages, never asked of a model — who is on how many pages, and which things come back after a gap.
        // R59: a lean room is counted from its Korean words (textWeave); the English last-word count of returning props is not made for it.
        weave: { ...weaveReport(settled.pages, { artNotes: pages.filter((p) => p.art).length, returning: !lean }), text: textWeave(pages, { cast: list(sized.characters) }) },
        ...(lean ? { pockets: { placed: pockets, pages: list(pagination.pages).length } } : {}) },
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
    placeOf = (where) => placeIdIn(where, backgrounds),
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

