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
import { StoryValidationError } from "./schemas.js";
import { ROOM_PHASES } from "./council-room.js";
import { checkStory } from "./checker.js";
import { leanLevelLine } from "./prompt-diet.js";
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
    { id: "parent", name: "소리 내어 읽어 주는 어른", line: "입에 붙는 문장, 한 번 더 읽어 달라는 쪽, 읽다가 아이가 끼어드는 쪽을 알아요. 설명이 긴 쪽은 건너뛰고 싶어져요." },
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
      role: str(c.role, 20) || "친구",
      family: FAMILY.test(`${c.role || ""} ${c.name || ""}`),
      ...(c.age !== undefined && c.age !== "" ? { age: c.age } : {}),
      traits: list(c.traits).slice(0, 3).map((t) => str(t, 20)),
      ...(c.catchphrase ? { catchphrase: str(c.catchphrase, 60) } : {}),
    }));
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
    "[좋은 그림책이 하는 일] 쪽을 넘기고 싶게 해요. 웃음은 벌어지는 일에서 나와요. 어른에게도 제 바람과 결점이 있어요. 아이는 주인공보다 먼저 알아채기를 좋아해요. 끝은 처음과 하나가 달라요. 이건 설명이지 점검표가 아니에요 — 더 좋은 길이 보이면 그리로 가요.",
    "[길이] 쪽수는 작가가 정해요. 이야기가 원하는 만큼.",
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
              required: ["name", "isNew", "want", "flaw", "speech"],
              properties: {
                name: { type: "string", maxLength: 30 },
                isNew: { type: "boolean" },
                want: { type: "string", maxLength: 100 },
                flaw: { type: "string", maxLength: 100 },
                speech: { type: "string", maxLength: 100 },
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
    system: `너는 그림책 작가실의 작가예요. 아래 브리프로 서로 다른 이야기 전제 ${PREMISE_COUNT}개를 내요. 전제마다: 제목, 한 줄 줄거리(line), 이 이야기의 모양(engine — 아래 메뉴의 id 하나, 또는 네가 만든 모양 이름; 메뉴는 참고일 뿐 안 써도 돼요), 가장 큰 웃음 한 장면(laugh — 벌어지는 일로), 아이가 보고 싶어 할 그림 한 장(picture), 인물표(cast — 부모님이 고른 인물은 모두, 이 책에만 나오는 새 인물은 자유롭게; 각자 바람·결점·말투). ${PREMISE_COUNT}개는 모양도 웃음도 서로 달라야 해요. 안전한 것보다 아이가 깔깔 웃거나 "그래서?" 하고 매달릴 것을.\n\n[이야기 모양 메뉴 — 참고]\n${engineMenuText()}`,
    user: brief,
    jsonSchema: PREMISE_SCHEMA,
    temperature: 1,
    maxTokens: 6000,
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
const reaction = {
  type: "object",
  additionalProperties: false,
  required: ["laughed", "curious", "lost", "again", "word"],
  properties: {
    laughed: { type: "boolean" },
    curious: { type: "boolean" },
    lost: { type: "boolean" },
    again: { type: "boolean" },
    word: { type: "string", maxLength: 80 },
  },
};
const panelSchema = (count) => ({
  type: "object",
  additionalProperties: false,
  required: ["reactions"],
  properties: {
    reactions: {
      type: "array",
      minItems: count,
      maxItems: count,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["premise", ...PANEL_IDS],
        properties: { premise: { type: "integer", minimum: 1, maximum: count }, ...Object.fromEntries(PANEL_IDS.map((id) => [id, reaction])) },
      },
    },
  },
});
export function panelPremisesRequest(input, premises) {
  const rows = list(premises).map((p, i) => `${i + 1}. ${str(p.title, 40)} — ${str(p.line, 300)} / 웃음: ${str(p.laugh, 200)} / 그림: ${str(p.picture, 200)}`).join("\n");
  return {
    system: `너는 여섯 사람이에요. 각자 아래 이야기 전제를 듣고 솔직하게 반응해요 — 점수가 아니라 반응이에요. 전제마다 여섯 사람 각각: 웃었나(laughed), 다음이 궁금했나(curious), 무슨 말인지 몰랐나(lost), 또 들려 달라고 할까(again), 한마디(word). 예의 차리지 말고 그 사람답게. 아이는 뻔한 것에 안 웃고 모르는 것에 금방 흥미를 잃어요.\n\n[여섯 사람]\n${panelText(input)}`,
    user: rows,
    jsonSchema: panelSchema(list(premises).length),
    temperature: 0.7,
    maxTokens: 6000,
  };
}
/** Counts, never scores: laughs + curious + again − lost, per premise; ties keep the writer's order. */
export function countReactions(reactions) {
  const rows = [];
  for (const row of list(reactions)) {
    if (!object(row)) continue;
    let laughed = 0, curious = 0, lost = 0, again = 0;
    const words = [];
    for (const id of PANEL_IDS) {
      const r = row[id];
      if (!object(r)) continue;
      laughed += r.laughed === true ? 1 : 0;
      curious += r.curious === true ? 1 : 0;
      lost += r.lost === true ? 1 : 0;
      again += r.again === true ? 1 : 0;
      if (str(r.word, 80)) words.push(`${id}: ${str(r.word, 80)}`);
    }
    rows.push({ premise: Number(row.premise) || rows.length + 1, laughed, curious, lost, again, pull: laughed + curious + again - lost, words });
  }
  return rows;
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
    pages: { type: "array", minItems: 4, maxItems: 40, items: { type: "object", additionalProperties: false, required: ["ko"], properties: { ko: { type: "string", maxLength: 1200 } } } },
  },
};
const castRows = (premise) => list(premise?.cast).map((c) => `- ${str(c.name, 30)}${c.isNew ? " (이 책의 새 인물)" : ""}: 바람 — ${str(c.want, 100)}; 결점 — ${str(c.flaw, 100)}; 말투 — ${str(c.speech, 100)}`).join("\n");
export function draftRequest(input, premise, { records = [] } = {}) {
  return {
    system: `너는 그림책 작가예요. 아래 전제로 책 한 권을 한글로 통째로 써요 — 쪽 단위로, 쪽마다 그 쪽의 글(ko). 쪽수는 네가 정해요. 비트도 설계도 없어요: 쪽을 넘기는 호흡은 네 몫이에요. 그림이 말할 쪽은 글이 짧고, 글이 끌어야 하는 쪽은 조금 길어요. 인물표의 말투대로 말해요. 제목(title)도 정해요.`,
    user: `${roomBrief(input, { records })}\n\n[전제]\n${str(premise?.title, 40)} — ${str(premise?.line, 300)}\n모양: ${str(premise?.engine, 40)}\n가장 큰 웃음: ${str(premise?.laugh, 200)}\n아이가 보고 싶을 그림: ${str(premise?.picture, 200)}\n\n[인물표]\n${castRows(premise)}`,
    jsonSchema: DRAFT_SCHEMA,
    temperature: 0.9,
    maxTokens: 8000,
  };
}
/* ---------- round 4: the panel reads the drafts page by page ---------- */
const pageReaction = {
  type: "object",
  additionalProperties: false,
  required: ["page", "laughed", "curious", "bored", "lost"],
  properties: { page: { type: "integer", minimum: 1 }, laughed: { type: "array", items: { type: "string", enum: PANEL_IDS } }, curious: { type: "array", items: { type: "string", enum: PANEL_IDS } }, bored: { type: "array", items: { type: "string", enum: PANEL_IDS } }, lost: { type: "array", items: { type: "string", enum: PANEL_IDS } } },
};
const readSchema = (count) => ({
  type: "object",
  additionalProperties: false,
  required: ["readings"],
  properties: {
    readings: {
      type: "array",
      minItems: count,
      maxItems: count,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["draft", "pages", "again", "words"],
        properties: {
          draft: { type: "integer", minimum: 1, maximum: count },
          pages: { type: "array", items: pageReaction },
          again: { type: "array", items: { type: "string", enum: PANEL_IDS } },
          words: { type: "array", maxItems: 6, items: { type: "string", maxLength: 120 } },
        },
      },
    },
  },
});
const draftText = (draft, i) => `=== 초고 ${i + 1} · ${str(draft?.title, 40)} ===\n${list(draft?.pages).map((p, n) => `${n + 1}쪽: ${str(p?.ko, 1200)}`).join("\n")}`;
export function panelReadRequest(input, drafts) {
  return {
    system: `너는 여섯 사람이에요. 아래 초고를 한 쪽씩 읽어 주는 자리에 있어요. 초고마다, 쪽마다 누가 웃었는지(laughed), 다음이 궁금했는지(curious), 지루해했는지(bored), 무슨 말인지 몰랐는지(lost)를 사람 id로 적어요(없으면 빈 목록). 초고마다 끝에 "또 읽어 줘" 할 사람(again)과 여섯 사람의 한마디(words)를 적어요. 점수는 없어요. 예의 차리지 말고 그 사람답게.\n\n[여섯 사람]\n${panelText(input)}`,
    user: list(drafts).map(draftText).join("\n\n"),
    jsonSchema: readSchema(list(drafts).length),
    temperature: 0.7,
    maxTokens: 8000,
  };
}
/** Per draft: pages × people counted; pull = laughs + curious + 2·again − bored − lost. */
export function countReadings(readings) {
  return list(readings)
    .filter(object)
    .map((r, i) => {
      const pages = list(r.pages).filter(object);
      const sum = (key) => pages.reduce((n, p) => n + list(p[key]).length, 0);
      const laughed = sum("laughed"), curious = sum("curious"), bored = sum("bored"), lost = sum("lost"), again = list(r.again).length;
      return {
        draft: Number(r.draft) || i + 1,
        laughed, curious, bored, lost, again,
        pull: laughed + curious + 2 * again - bored - lost,
        boredPages: pages.filter((p) => list(p.bored).length >= 3).map((p) => Number(p.page)),
        lostPages: pages.filter((p) => list(p.lost).length >= 1).map((p) => Number(p.page)),
        laughPages: pages.filter((p) => list(p.laughed).length >= 3).map((p) => Number(p.page)),
        words: list(r.words).map((w) => str(w, 120)).filter(Boolean),
      };
    });
}
export function pickDraft(rows) {
  return [...list(rows)].sort((a, b) => b.pull - a.pull || b.again - a.again || a.draft - b.draft)[0]?.draft || 1;
}
/** What the writer hears before rewriting: the pages that dragged, the pages nobody could explain, the pages that landed. */
export function rewriteNotes(row) {
  if (!object(row)) return "";
  const lines = [];
  if (row.boredPages?.length) lines.push(`지루해한 쪽: ${row.boredPages.join(", ")} — 줄이거나 사건을 넣어요.`);
  if (row.lostPages?.length) lines.push(`무슨 말인지 모른 쪽: ${row.lostPages.join(", ")} — 아이가 따라올 수 있게 보여 줘요.`);
  if (row.laughPages?.length) lines.push(`웃은 쪽: ${row.laughPages.join(", ")} — 숨 쉴 자리를 주고 건드리지 않아요.`);
  if (row.words?.length) lines.push(`한마디: ${row.words.join(" / ")}`);
  return lines.join("\n");
}
export function rewriteRequest(input, draft, notes, { records = [] } = {}) {
  return {
    system: "너는 이 책을 쓴 작가예요. 독자 여섯 사람이 한 쪽씩 읽는 자리에 있었고, 아래는 그들의 반응이에요. 그 반응을 받아 책을 통째로 다시 써요 — 쪽을 합치거나 나누거나 빼거나 더해도 돼요. 좋았던 것은 지키고, 지루한 곳은 과감히. 제목도 다시 정해도 돼요.",
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
  return state?.settings?.textGeneration?.writersRoom === true ? writersRoomPolicy(records) : null;
}
const ROOM_PROGRESS = Object.freeze({
  premises: "작가실 · 작가가 이야기 전제 열두 개를 내고 있어요.",
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
  cast: list(premise?.cast).filter(object).map((c) => ({ name: str(c.name, 30), isNew: c.isNew === true, want: str(c.want, 100), flaw: str(c.flaw, 100), speech: str(c.speech, 100) })),
  ...(row ? { pull: row.pull, laughed: row.laughed, curious: row.curious, again: row.again, lost: row.lost, words: row.words } : {}),
});
/**
 * The room's first half: premises (the top model), the panel's reactions (the
 * cheap model), the deterministic shortlist, then the parent's choice — a
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
    const proposed = await ask("작가", premisesRequest(input, { records }), "prose");
    const all = list(proposed.premises).filter(object).slice(0, PREMISE_COUNT);
    if (!all.length) throw journal.fail(roomError("작가가 쓸 수 있는 전제를 내지 못했어요."));
    const kept = sievePremises(all, records.length ? records : list(input.writersRoom?.recent));
    const premises = kept.length ? kept : all;
    record.premises = premises;
    record.dropped = all.length - premises.length;
    log({ by: "작가", kind: "proposed", what: `전제 ${all.length}개: ${all.map((p) => str(p.title, 24)).join(" / ")}`, why: record.dropped ? `최근 책과 모양·웃음이 닮은 ${record.dropped}개는 뺌` : "브리프 한 쪽으로" });
    await snapshot("panel", ROOM_PROGRESS.panel);
    const heard = await ask("독자단", panelPremisesRequest(input, premises), "cheap");
    const rows = countReactions(heard.reactions);
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
const pageRows = (draft) => list(draft?.pages).filter(object).map((p) => ({ ko: str(p.ko, 1200) })).filter((p) => p.ko);
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
export function englishRequest(input, pages) {
  const count = list(pages).length;
  return {
    system: `You are a picture-book author writing the English edition of a finished Korean picture book, page by page. ${leanLevelLine(input, "en", { vocab: true })} Each page's English follows that page's Korean: the same events in the same order, the same spoken lines in plain English, the same surprise kept for the same page; it may say less when the level needs it, never something else. One idea per sentence; no semicolons. Return exactly ${count} pages in order.`,
    user: numbered(pages),
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
export async function runRoomDrafts(input, outline, options = {}, services = {}) {
  const premise = outline?.writersRoom?.premise;
  if (!object(premise)) throw new StoryValidationError("prose", ["작가실이 고른 전제가 없어요. 줄거리 단계부터 다시 만들어 주세요."]);
  const journal = ledger("roomDrafts", input, options, { version: WRITERS_ROOM_VERSION, premise }, "writerCheckpoint");
  const count = Math.max(1, Math.min(DRAFT_COUNT, Number(options.roomDraftCount) || DRAFT_COUNT));
  const record = { kind: "roomDrafts", version: WRITERS_ROOM_VERSION, phase: "drafts", drafts: [], rows: [], chosen: null, notes: "", rewritten: false, english: false, levelNotes: [], polished: false, levelNotesAfter: [] };
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
          ask(`초고 ${i + 1}`, { ...base, user: `${base.user}\n\n[초고 ${i + 1}/${count} — 다른 초고와 다르게, 네 식대로]` }, "prose").then((raw) => normalizeDraft(raw, `${str(premise.title, 40)} ${i + 1}`)),
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
      const rows = countReadings(read.readings);
      record.rows = rows;
      pick = Math.min(drafts.length, pickDraft(rows));
      chosen = drafts[pick - 1];
      record.notes = rewriteNotes(rows.find((row) => row.draft === pick));
    }
    record.chosen = pick;
    let pages = chosen.pages,
      title = chosen.title;
    if (options.roomRewrite !== false && drafts.length > 1) {
      await snapshot("rewrite");
      const again = normalizeDraft(await ask("고쳐쓰기", rewriteRequest(input, chosen, record.notes), "prose"), title);
      if (again) {
        pages = again.pages;
        title = again.title;
        record.rewritten = true;
      }
    }
    if (input?.language !== "ko") {
      await snapshot("english");
      const en = await ask("영어판", englishRequest(input, pages), "prose");
      const rows = list(en.pages).map((p) => str(p?.en, 1200));
      if (rows.length === pages.length) {
        pages = pages.map((p, i) => ({ ...p, en: rows[i] }));
        record.english = true;
      }
    }
    record.levelNotes = levelNotes(outline, pages, input);
    if (record.levelNotes.length && options.roomPolish !== false) {
      await snapshot("polish");
      const polished = await ask("다듬기", polishRequest(input, pages, record.levelNotes), "prose");
      const rows = list(polished.pages).filter(object);
      if (rows.length === pages.length) {
        pages = pages.map((p, i) => ({ ko: str(rows[i].ko, 1200) || p.ko, ...(p.en !== undefined ? { en: str(rows[i].en, 1200) || p.en } : {}) }));
        record.polished = true;
        record.levelNotesAfter = levelNotes(outline, pages, input);
      }
    }
    await snapshot("done");
    return {
      data: { title, language: record.english ? "dual" : "ko", pages: pages.map((p, i) => ({ pageNo: i + 1, ko: p.ko, ...(p.en !== undefined ? { en: p.en } : {}) })), room: clone(record) },
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
  return `작가실 · 초고 ${list(r.drafts).length}권 중 독자단이 ${r.chosen}번을 골라${r.rewritten ? " 고쳐 쓰고" : ""}${r.english ? " 영어판을 쓰고" : ""}${notes ? ` 등급 참고 ${notes}건 중 ${r.polished ? `다듬어 ${list(r.levelNotesAfter).length}건 남음` : "다듬지 않음"}` : " 등급 참고 없음"} · ${list(draft.pages).length}쪽`;
}
