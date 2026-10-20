/*
 * 기획 회의 (2026-10-20, R20). Before the outline is written, four roles with
 * different standards meet once, briefly, in structured JSON: the author
 * (three pitches), the editor (the spine checklist), the art director (is each
 * beat a strong picture, is the turn a visible moment) and a reader of the
 * book's own age (does "다음엔?" come, can the turn be retold). The chair is
 * code: it assembles the direction and the conditions every bot receives,
 * enforces the round limit and the vetoes, scores the pitches, and writes the
 * decision log (what was proposed, adopted, revised, dropped, and why). The
 * result is a story bible that binds the outline, the scene briefs, the
 * pagination and the picture prompts. New drafts freeze input.councilPolicy
 * {version: 1}; drafts without it send byte-identical requests and never meet.
 */
import { ledger } from "./quality-adapter.js";
import { frozenBeatCount, StoryValidationError } from "./schemas.js";
import { parseJsonLenient } from "./outline-normalize.js";
import { isOpeningsInput } from "./opening-prose.js";
import { renderCouncilRoom } from "./council-room.js";

export const COUNCIL_POLICY_VERSION = 1;
export const councilPolicy = () => ({ version: COUNCIL_POLICY_VERSION });
export const hasCouncilPolicy = (input) =>
  input?.councilPolicy?.version === COUNCIL_POLICY_VERSION;
/** Five economy-model calls: pitches, three verdicts in parallel, the bible. A vetoed round adds one. */
export const COUNCIL_CALLS = 5;
export const MAX_DECISIONS = 300;

const str = (value, max = 300) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
const clamp2 = (value) =>
  Math.max(0, Math.min(2, Math.round(Number(value)) || 0));
const list = (value) => (Array.isArray(value) ? value : []);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));

/* ---------- 독자 카드 (조건의 첫 줄: 독자 나이를 사람이 먼저 좁힌다) ---------- */
export const READER_CARDS = Object.freeze({
  K1: Object.freeze({
    age: "3~4세",
    years: 4,
    attention: "한 번에 4~6분, 쪽마다 사건 하나",
    causality: "바로 앞 사건과만 잇는 한 단계 인과",
    twist: "숨어 있던 것이 친숙한 것으로 드러남",
    humor: "몸개그·소리·되풀이",
    fears: "어둠·괴물·혼자 남기·크게 다침은 넣지 않음",
    counting: "셋까지",
  }),
  K2: Object.freeze({
    age: "5~6세",
    years: 5,
    attention: "8~10분",
    causality: "두 단계 인과(그래서 → 그래서)와 간단한 동기",
    twist: "믿었던 것이 다른 것이었음(역할 뒤바뀜, 작은 것이 해결)",
    humor: "실수·엉뚱한 추측·과장",
    fears: "걱정은 되돌릴 수 있는 것만, 괴물·잔인함 없음",
    counting: "다섯까지, 순서와 되풀이를 좋아함",
  }),
  K3: Object.freeze({
    age: "7~8세",
    years: 7,
    attention: "12~15분",
    causality: "세 단계 인과와 동기, 시간 건너뛰기",
    twist: "오해가 풀림, 시점이 바뀜, 단서의 재해석",
    humor: "말장난·가벼운 아이러니",
    fears: "가벼운 긴장은 되지만 해결은 아이의 힘으로",
    counting: "열까지",
  }),
  K4: Object.freeze({
    age: "9~10세",
    years: 9,
    attention: "20분",
    causality: "복선 두 개 이상, 동기와 갈등",
    twist: "앞의 사실이 재해석됨",
    humor: "아이러니·상황극",
    fears: "진짜 갈등은 되지만 희망적인 결말",
    counting: "제한 없음",
  }),
});
const EN_TO_KO = Object.freeze({ E0: "K1", E1: "K1", E2: "K2", E3: "K3", E4: "K4" });
export function readerCard(input) {
  const ko = String(input?.specs?.ko?.id || ""),
    en = String(input?.specs?.en?.id || ""),
    id = READER_CARDS[ko] ? ko : EN_TO_KO[en] || "K2";
  return { id, ...READER_CARDS[id] };
}
/** The child simulator's age for this draft ('5세'); drafts without the policy keep the package's 4세. */
export function readerAge(input) {
  if (!hasCouncilPolicy(input)) return null;
  return `${readerCard(input).years}세`;
}

/* ---------- 방향과 조건 ---------- */
const customEnding = (input) =>
  input?.endingType === "custom" && !!str(input?.endingNote, 1000);
/** One sentence every bot receives: the reader range first, then where the climax must land. */
export function directionLine(input) {
  const card = readerCard(input),
    parent = str(input?.direction, 200);
  if (parent) return `${card.age} 독자. ${parent}`;
  const moral = str(input?.moral, 80),
    ending = customEnding(input) ? str(input.endingNote, 80) : "";
  return `${card.age} 독자가 절정에서 ${moral ? `'${moral}'을(를) 말이 아니라 사건으로 느끼고` : "심은 물건이 다시 보이는 순간 '아!' 하고 반전을 스스로 알아차리고"}, ${ending ? `마지막은 부모가 적은 끝(${ending})에 닿는다` : "마지막에는 처음의 물건이나 말이 달라진 모습으로 돌아온다"}.`;
}
const sentenceRule = (spec, lang) => {
  if (!object(spec)) return "";
  const units = spec.units;
  if (object(units?.spread) && object(units?.page))
    return `${lang} 펼침면 ${units.spread.min}~${units.spread.max}문장 · 낱쪽 ${units.page.min}~${units.page.max}문장`;
  const range = object(spec.sentencesPerPageRange)
    ? `${spec.sentencesPerPageRange.min}~${spec.sentencesPerPageRange.max}`
    : String(spec.sentencesPerPage || "");
  const length =
    lang === "한글" && Array.isArray(spec.eojeolPerSentence)
      ? `, 문장당 ${spec.eojeolPerSentence[0]}~${spec.eojeolPerSentence[1]}어절`
      : lang === "영어" && object(spec.wordsPerSentence)
        ? `, 문장당 ${spec.wordsPerSentence.min}~${spec.wordsPerSentence.max}단어`
        : "";
  return range ? `${lang} 쪽당 ${range}문장${length}` : "";
};
const isHome = (b = {}) =>
  /^(?:home|house|bedroom|livingroom|living_room|room|집|방|집·방)$/iu.test(
    String(b.type || b.kind || "").trim(),
  ) ||
  /(?:집|침실|거실|주방|아이\s*방|의\s*방|우리\s*방|\b(?:home|house|bedroom|living\s*room|kitchen)\b)/iu.test(
    [b.name, b.nameEn].filter(Boolean).join(" "),
  );
/** The fixed constraints, assembled once by the chair and given to every bot verbatim. */
export function conditionBlock(input) {
  const card = readerCard(input),
    beats = frozenBeatCount(input),
    attempts = Math.max(1, beats - 5),
    ko = input?.language !== "en" ? sentenceRule(input?.specs?.ko, "한글") : "",
    en = input?.language !== "ko" ? sentenceRule(input?.specs?.en, "영어") : "",
    cast = list(input?.characters).map(
      (c) =>
        `${str(c.name, 40)}(${str(c.id, 40)}${list(c.traits).length ? `: ${list(c.traits).slice(0, 2).map((t) => str(t, 20)).join("·")}` : ""})`,
    ),
    places = list(input?.backgrounds).map(
      (b) => `${str(b.name, 40)}(${str(b.id, 40)}${isHome(b) ? ", 집" : ""})`,
    ),
    moral = str(input?.moral, 80),
    custom = customEnding(input),
    koLevel = String(input?.specs?.ko?.id || "");
  return [
    `독자: ${card.age} · 집중 ${card.attention} · 인과 ${card.causality} · 맞는 반전 ${card.twist} · 웃음 ${card.humor} · ${card.fears} · 수 ${card.counting}`,
    `분량: ${input?.pageCount || "?"}쪽, 비트 ${beats}개 (setup · want · attempt×${attempts} · turn · resolution · close). ${[ko, en].filter(Boolean).join(" / ")}`,
    `끝맺음: ${custom ? `부모가 적은 끝 그대로 — ${str(input.endingNote, 200)}` : input?.endingType === "open" ? "집에서 차분히, 행동이나 말로 다음 모험을 암시" : "집에 돌아와 차분히"}`,
    `가치: ${moral || "없음"} — 말로 하지 않고 행동으로만 보여 준다`,
    `등장인물(고정, 새 인물 금지): ${cast.join(", ") || "없음"}`,
    `장소(고정, 새 장소 금지): ${places.join(", ") || "없음"} — 처음은 집${custom ? "" : ", 끝도 집"}, 중간은 집 아닌 곳 2곳 이상`,
    "금지: 무서운 장면·벌주기·비교·놀림·잔인함. 교훈을 말로 하지 않는다.",
    /^K[12]$/u.test(koLevel) && input?.language !== "en"
      ? "소리말 후렴: 핵심 물건이나 사건이 내는 의성어 한 줄을 비트 3곳에 둔다."
      : "",
  ].filter(Boolean);
}
const SPINE_CHECKLIST = [
  "stakes: want 비트에 '못 하면 무엇을 잃는지'가 구체적으로 있는가(물건·순간·누군가의 얼굴)",
  "ladder: 시도마다 대가가 커지고 방법이 이유 있게 바뀌는가(같은 크기 세 번은 0점)",
  "lowPoint: 마지막 시도 끝이 포기 직전의 바닥이고, 단서(심은 물건)가 바로 옆에 있는가",
  "turn: 새 물건을 찾는 게 아니라 심은 물건을 다시 보는 반전인가. 믿었던 것/실제/새 역할이 한 문장으로 되말해지는가",
  "payoff: 주인공이 제 손으로 해결하고, 끝이 처음의 물건이나 말을 달라진 모습으로 되비추는가",
  "direction: [방향] 문장에 도달하는가",
];

/* ---------- 봇 ---------- */
const PERSONA = Object.freeze({
  author:
    "너는 3~7세 그림책을 20년 써 온 작가다. 반전은 아이가 먼저 알아차리게 쓰고, 바라는 것이 왜 중요한지를 첫 두 비트 안에 보여 준다. 설계를 쓰는 자리이지 본문을 쓰는 자리가 아니다. [조건]의 재료 밖 인물·장소를 만들지 않는다. JSON으로만 답한다.",
  editor:
    "너는 그림책 편집자다. 바라는 것이 분명하지 않은 원고는 돌려보낸다. 관대하지 않고, 근거는 짧게 댄다. 피치의 문장이 예쁜지는 보지 않고 뼈대만 본다. JSON으로만 답한다.",
  art: "너는 그림책 아트 디렉터다. 글이 말하지 않는 것을 그림이 말하게 한다. 반전은 펼침면 한 장으로 터져야 하고, 심은 물건은 첫 그림에 자연스럽게 놓여야 한다. 냄새나 소리만으로 버티는 비트에는 보이는 닻을 요구한다. 승인 재료 밖의 장소·인물은 거부한다. JSON으로만 답한다.",
  reader: (card) =>
    `너는 ${card.years}세 아이다. 글을 못 읽고 소리로만 듣는다. 어른이 이야기 피치를 짧게 들려주면, 아이답게 솔직하게 반응한다. ${card.fears}. 어른처럼 평가하지 않는다. JSON으로만 답한다.`,
});
const strict = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});
const s = (maxLength) => ({ type: "string", maxLength });
const score = { type: "integer", minimum: 0, maximum: 2 };
const arr = (items, max, min = 0) => ({ type: "array", items, minItems: min, maxItems: max });
function pitchSchema(attempts) {
  return strict({
    title: s(60),
    logline: s(300),
    stakes: s(300),
    planted: strict({ name: s(80), nameEn: s(80), firstSeen: s(200) }),
    ladder: arr(s(200), attempts, attempts),
    lowPoint: s(300),
    turn: strict({ seen: s(300), realized: s(300), overturns: s(300) }),
    payoff: s(300),
    echo: s(300),
  });
}
const PITCHES_SCHEMA = (attempts) => strict({ pitches: arr(pitchSchema(attempts), 3, 1) });
const EDITOR_SCHEMA = strict({
  verdicts: arr(
    strict({
      pitch: { type: "integer", minimum: 1, maximum: 3 },
      stakes: score,
      ladder: score,
      lowPoint: score,
      turn: score,
      payoff: score,
      direction: score,
      veto: { type: "boolean" },
      vetoReason: s(200),
      fixes: arr(s(200), 2),
    }),
    3,
    1,
  ),
  pick: { type: "integer", minimum: 1, maximum: 3 },
});
const ART_SCHEMA = strict({
  verdicts: arr(
    strict({
      pitch: { type: "integer", minimum: 1, maximum: 3 },
      drawableTurn: score,
      plantedVisible: score,
      lowPointVisible: score,
      variety: score,
      motifs: arr(strict({ ko: s(60), en: s(60) }), 3),
      veto: { type: "boolean" },
      vetoReason: s(200),
      fixes: arr(s(200), 2),
    }),
    3,
    1,
  ),
  pick: { type: "integer", minimum: 1, maximum: 3 },
});
const READER_SCHEMA = strict({
  reactions: arr(
    strict({
      pitch: { type: "integer", minimum: 1, maximum: 3 },
      nextQuestion: score,
      retell: s(300),
      retellHasTurn: { type: "boolean" },
      scary: s(200),
    }),
    3,
    1,
  ),
  favorite: { type: "integer", minimum: 1, maximum: 3 },
});
const BIBLE_SCHEMA = (beats, attempts) =>
  strict({
    bible: strict({
      ...pitchSchema(attempts).properties,
      visual: strict({
        pictures: arr(
          strict({ beatIndex: { type: "integer", minimum: 1, maximum: 8 }, ko: s(200), en: s(240) }),
          beats,
          beats,
        ),
        motifs: arr(strict({ ko: s(60), en: s(60) }), 3),
        plantedPlacementEn: s(200),
      }),
    }),
  });

const beatLabels = (beats) => {
  const labels = ["setup", "want"];
  for (let i = 0; i < beats - 5; i++) labels.push("attempt");
  labels.push("turn", "resolution", "close");
  return labels;
};
function normalizePitch(raw, attempts) {
  if (!object(raw)) return null;
  const ladder = list(raw.ladder).map((row) => str(row, 200)).filter(Boolean);
  while (ladder.length < attempts) ladder.push(ladder.at(-1) || "");
  const turn = object(raw.turn) ? raw.turn : {},
    planted = object(raw.planted) ? raw.planted : {};
  const pitch = {
    title: str(raw.title, 60),
    logline: str(raw.logline, 300),
    stakes: str(raw.stakes, 300),
    planted: { name: str(planted.name, 80), nameEn: str(planted.nameEn, 80), firstSeen: str(planted.firstSeen, 200) },
    ladder: ladder.slice(0, attempts),
    lowPoint: str(raw.lowPoint, 300),
    turn: { seen: str(turn.seen, 300), realized: str(turn.realized, 300), overturns: str(turn.overturns, 300) },
    payoff: str(raw.payoff, 300),
    echo: str(raw.echo, 300),
  };
  return pitch.logline && pitch.turn.seen ? pitch : null;
}
const byPitch = (rows, count) => {
  const out = [];
  for (let i = 1; i <= count; i++)
    out.push(list(rows).find((row) => object(row) && Number(row.pitch) === i) || null);
  return out;
};

/** The bible as the outline model reads it: binding beat by beat, IDs and rules still first. */
export function bibleOutlineRules(bible, input = {}) {
  if (!object(bible) || !bible.turn) return "";
  const beats = frozenBeatCount(input),
    labels = beatLabels(beats),
    lines = [],
    card = readerCard(input);
  let attempt = 0;
  labels.forEach((label, i) => {
    const n = i + 1;
    if (label === "setup")
      lines.push(`Beat ${n} (setup): plant "${bible.planted?.name}" where the child can see it: ${bible.planted?.firstSeen}`);
    else if (label === "want") lines.push(`Beat ${n} (want): ${bible.logline} STAKES (said in the beat): ${bible.stakes}`);
    else if (label === "attempt") {
      const row = bible.ladder?.[attempt] || "";
      attempt++;
      lines.push(`Beat ${n} (attempt ${attempt}): ${row}${attempt === bible.ladder?.length ? ` LOW POINT at its end: ${bible.lowPoint}` : ""}`);
    } else if (label === "turn")
      lines.push(`Beat ${n} (turn): seen: ${bible.turn.seen} | realized aloud by the protagonist: ${bible.turn.realized} | what it overturns: ${bible.turn.overturns}`);
    else if (label === "resolution") lines.push(`Beat ${n} (resolution): ${bible.payoff}`);
    else lines.push(`Beat ${n} (close): ${bible.echo}`);
  });
  const pictures = list(bible.visual?.pictures)
    .map((row) => `${row.beatIndex}: ${row.en || row.ko}`)
    .join(" · ");
  const motifs = list(bible.visual?.motifs)
    .map((m) => m.en || m.ko)
    .filter(Boolean)
    .join(", ");
  return `STORY BIBLE (binding; settled by the writers' room — author, editor, art director and a ${card.age} reader — before this outline). Follow it beat for beat in the beat summaries, plan, want/problem, twist and plotContract; keep the supplied IDs and the rules above where they conflict and keep the bible's intent.\n${lines.join("\n")}${pictures ? `\nPicture promises (what the child sees, one per beat): ${pictures}` : ""}${motifs ? `\nRecurring visual motifs: ${motifs}` : ""}`;
}
/** Scene briefs: the picture promises become pose and props; the planted thing is a beat-1 prop. */
export function bibleBriefRules(outline) {
  const bible = outline?.bible;
  if (!object(bible) || !bible.turn) return "";
  const pictures = list(bible.visual?.pictures)
    .map((row) => `beat ${row.beatIndex}: ${row.en || row.ko}`)
    .join(" | ");
  const motifs = list(bible.visual?.motifs).map((m) => m.en || m.ko).filter(Boolean);
  return `\nSTORY BIBLE PICTURES (binding for pose and props): ${pictures}. Beat 1's props include the planted thing "${bible.planted?.nameEn || bible.planted?.name}". The turn beat's pose shows the moment of seeing (${bible.turn.seen}), never a narrated explanation.${motifs.length ? ` Recurring motifs to place as small props where natural: ${motifs.join(", ")}.` : ""}`;
}
/** Pagination: the turn is the reveal spread of an openings book; a page book shows the planted thing large on the turn's first page. */
export function biblePaginationRules(outline, input = {}) {
  const bible = outline?.bible;
  if (!object(bible) || !bible.turn) return "";
  const beats = frozenBeatCount(input),
    turn = beats - 2;
  return isOpeningsInput(input)
    ? `\nREVEAL SPREAD (story bible): beat ${turn} (the turn) is ONE spread entry with cue "reveal" whose scene.action shows ${bible.turn.seen}; the beat before it ends on the low point (${bible.lowPoint}) with a quiet, uncrowded picture.`
    : `\nREVEAL (story bible): the first page of beat ${turn} (the turn) shows ${bible.turn.seen} with the planted thing "${bible.planted?.nameEn || bible.planted?.name}" large and clear; the last page of beat ${turn - 1} is the low point (${bible.lowPoint}), quiet and uncrowded.`;
}
/** Picture prompts (never the cover): the planted thing on beat 1's pictures, the motifs everywhere. */
export function biblePictureRules({ book, page, cover = false } = {}) {
  const bible = book?.outline?.bible;
  if (cover || !object(bible) || !bible.turn) return "";
  const lines = [],
    beat = Number(page?.beatIndex ?? page?.scene?.beatIndex),
    beats = frozenBeatCount(book?.storyInput || {}),
    plantedEn = str(bible.planted?.nameEn || bible.planted?.name, 80);
  if (beat === 1 && plantedEn)
    lines.push(`PLANTED OBJECT: ${plantedEn} is visible in this picture${bible.visual?.plantedPlacementEn ? ` (${str(bible.visual.plantedPlacementEn, 200)})` : ""}, clearly recognisable but not the centre of attention.`);
  if (beat === beats - 2 && plantedEn)
    lines.push(`REVEAL: this is the turn; ${plantedEn} is seen plainly, large enough to read, as the protagonist notices it.`);
  const motifs = list(bible.visual?.motifs).map((m) => str(m.en || m.ko, 60)).filter(Boolean);
  if (motifs.length)
    lines.push(`MOTIFS: keep ${motifs.join(", ")} as small recurring details where natural, never replacing the key props.`);
  return lines.join("\n");
}

/* ---------- 결정 기록 ---------- */
export function appendDecision(target, entry) {
  if (!object(target)) return null;
  if (!Array.isArray(target.decisions)) target.decisions = [];
  const row = {
    at: entry?.at || new Date().toISOString(),
    by: str(entry?.by, 40) || "의장",
    kind: ["proposed", "reviewed", "adopted", "revised", "dropped"].includes(entry?.kind) ? entry.kind : "adopted",
    what: str(entry?.what, 300),
    why: str(entry?.why, 300),
  };
  target.decisions.push(row);
  if (target.decisions.length > MAX_DECISIONS) target.decisions.splice(0, target.decisions.length - MAX_DECISIONS);
  return row;
}
/** A parent's own decision (an approved outline, an edited page) goes on the book's council record. */
export function recordParentDecision(target, what, why = "") {
  const outline = target?.outline || target;
  if (!object(outline) || !object(outline.council)) return null;
  return appendDecision(outline.council, { by: "부모", kind: "revised", what, why });
}

/* ---------- 의장: 채점 ---------- */
const editorTotal = (v) =>
  v ? clamp2(v.stakes) + clamp2(v.ladder) + clamp2(v.lowPoint) + clamp2(v.turn) + clamp2(v.payoff) + clamp2(v.direction) : 0;
const artTotal = (v) =>
  v ? clamp2(v.drawableTurn) + clamp2(v.plantedVisible) + clamp2(v.lowPointVisible) + clamp2(v.variety) : 0;
const readerTotal = (r) => (r ? clamp2(r.nextQuestion) + (r.retellHasTurn === true ? 2 : 0) : 0);
/** Weighted sum (editor 5, art 4, reader 3 out of 12) and the three vetoes. */
export function chairScores(editor, art, reader, count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const e = editor[i],
      a = art[i],
      r = reader[i],
      vetoes = [];
    if (e?.veto === true) vetoes.push(`편집자: ${str(e.vetoReason, 200) || "뼈대 결격"}`);
    if (a?.veto === true) vetoes.push(`그림 감독: ${str(a.vetoReason, 200) || "그릴 수 없는 반전"}`);
    if (r && r.retellHasTurn !== true) vetoes.push("독자: 반전을 되말하지 못함");
    const score = Math.round(((editorTotal(e) * 5) / 12 + (artTotal(a) * 4) / 8 + (readerTotal(r) * 3) / 4) * 10) / 10;
    rows.push({
      pitch: i + 1,
      editor: editorTotal(e),
      art: artTotal(a),
      reader: readerTotal(r),
      score,
      vetoes,
    });
  }
  return rows;
}
function pickPitch(rows, editor, art) {
  const open = rows.filter((row) => !row.vetoes.length);
  const pool = open.length ? open : rows;
  const best = Math.max(...pool.map((row) => row.score));
  const tied = pool.filter((row) => row.score === best);
  if (tied.length === 1) return { pick: tied[0].pitch, overrode: !open.length };
  const editorPick = Number(editor.pick),
    artPick = Number(art.pick);
  const choice =
    tied.find((row) => row.pitch === editorPick) ||
    tied.find((row) => row.pitch === artPick) ||
    tied[0];
  return { pick: choice.pitch, overrode: !open.length };
}

/* ---------- 회의 ---------- */
const PROGRESS = Object.freeze({
  pitches: "기획 회의 · 작가 봇이 피치 3개를 쓰고 있어요.",
  verdicts: "기획 회의 · 편집자·그림 감독·독자 봇이 피치를 살피고 있어요.",
  bible: "기획 회의 · 작가 봇이 스토리 바이블을 확정하고 있어요.",
  review: "기획 회의 결과 확인 · 피치를 고르거나 방향을 고쳐 이어 가 주세요.",
});
function councilError(message) {
  return new StoryValidationError("council", [message]);
}
/**
 * R22 회의 결과 보고 진행: with options.councilHold the meeting stops after the
 * chair's scores (phase "review") and throws this; the caller parks the job,
 * the parent picks a pitch (or keeps the chair's), adds a note, or rewrites
 * the direction, and the resumed run replays the paid rounds from the journal.
 */
export const COUNCIL_HOLD = "CouncilHold";
export function isCouncilHold(error) {
  return error?.name === COUNCIL_HOLD;
}
function councilHoldError() {
  const error = new Error("기획 회의 결과를 보고 피치를 고르거나 방향을 고쳐 이어 가 주세요.");
  error.name = COUNCIL_HOLD;
  error.stage = "council";
  // The paid rounds were recorded through onCheckpoint at every snapshot; a
  // step that bills an error's usage must not add a failed row for a hold.
  error.usageRecorded = true;
  return error;
}
/** The parent's choice for a held meeting: a pitch number and an optional note. */
export function normalizeCouncilChoice(choice, count) {
  if (!object(choice)) return null;
  const pick = Math.round(Number(choice.pick));
  return {
    pick: pick >= 1 && pick <= count ? pick : null,
    note: str(choice.note, 300),
  };
}
/**
 * Run the meeting (or replay it from options.councilCheckpoint without a
 * paid call). Returns {record, usage, meta}; record.bible binds the later
 * stages and record.decisions is the log.
 */
export async function runStoryCouncil(input, options = {}, services = {}) {
  const journal = ledger("council", input, options, { version: COUNCIL_POLICY_VERSION }, "councilCheckpoint");
  const beats = frozenBeatCount(input),
    attempts = Math.max(1, beats - 5),
    card = readerCard(input),
    direction = directionLine(input),
    conditions = conditionBlock(input),
    references = list(options.councilReferences).map((row) => str(row, 1500)).filter(Boolean);
  const record = {
    version: COUNCIL_POLICY_VERSION,
    direction,
    conditions,
    reader: { id: card.id, age: card.age },
    pitches: [],
    verdicts: null,
    scores: [],
    chosen: null,
    overrode: false,
    bible: null,
    decisions: [],
    // R21 회의실: which round is on and who is speaking, saved after every
    // answer so a screen (or a resumed run) can draw the room as it was.
    phase: "pitches",
    roles: { chair: "speaking", author: "speaking", editor: "waiting", art: "waiting", reader: "waiting" },
    // R22: the chair's recommendation while the parent looks (phase "review"),
    // and what the parent decided once the meeting goes on.
    recommended: null,
    parentChoice: null,
  };
  const log = (entry) => appendDecision(record, entry);
  // R22: what the parent did to earlier meetings of this story (a rewritten
  // direction) comes first in the log, so the record explains why this
  // meeting met again.
  for (const row of list(options.councilHistory))
    if (object(row) && str(row.what, 300))
      log({ by: "부모", kind: str(row.kind, 20) || "revised", what: str(row.what, 300), why: str(row.why, 300) });
  const hold = options.councilHold === true;
  const snapshot = async (phase, message) => {
    record.phase = phase;
    journal.checkpoint.record = clone(record);
    await journal.save();
    options.onProgress?.({ stage: "council", phase, message, council: clone(record) });
  };
  const ask = async (label, system, user, jsonSchema, temperature, maxTokens) => {
    const response = await journal.call("cheap", { system, user, jsonSchema, temperature, maxTokens }, services);
    const data = response?.json !== undefined ? response.json : parseJsonLenient(String(response?.text || ""));
    if (!object(data)) throw journal.fail(councilError(`${label} 봇의 답을 읽을 수 없어요.`));
    return data;
  };
  const context = [
    `[방향] ${direction}`,
    `[조건]\n${conditions.map((row, i) => `${i + 1} ${row}`).join("\n")}`,
    `[주제] ${str(input.topic, 200)}`,
  ].join("\n\n");
  const pitchInstructions = `[피치 3개 쓰기] 서로 다른 반전으로 피치 3개. 피치마다: title(제목), logline(한 줄 줄거리), stakes(못 하면 잃는 것, 구체적인 물건·순간·얼굴), planted{name(심은 물건, 한글), nameEn(영어 명사구), firstSeen(1비트에서 처음 보이는 자리)}, ladder(시도 ${attempts}개, 차례로 더 큰 대가와 다른 방법), lowPoint(마지막 시도 끝, 포기 직전의 한 문장 — 단서가 바로 옆에 있다), turn{seen(아이가 보거나 듣는 것), realized(주인공이 제 말로 알아차리는 말), overturns(뒤집히는 믿음)}, payoff(주인공이 손으로 해내는 해결), echo(처음의 물건이나 말이 달라진 모습으로 돌아오는 끝).`;
  try {
    // Round A: the author's three pitches (a second round only if every pitch is vetoed).
    let pitches = [],
      verdicts = null,
      scores = [],
      picked = null;
    for (let round = 0; round < 2; round++) {
      record.roles = { chair: "speaking", author: "speaking", editor: "waiting", art: "waiting", reader: "waiting" };
      record.verdicts = null;
      await snapshot("pitches", PROGRESS.pitches);
      const vetoNote =
        round && verdicts
          ? `\n\n[이전 피치의 거부 사유 — 같은 실수를 되풀이하지 않는다]\n${scores.map((row) => `피치 ${row.pitch}: ${row.vetoes.join(" / ")}`).join("\n")}`
          : "";
      const proposed = await ask(
        "작가",
        PERSONA.author,
        `${context}\n\n${pitchInstructions}${vetoNote}\n\n[출력] JSON만. {"pitches":[{...},{...},{...}]}`,
        PITCHES_SCHEMA(attempts),
        0.8,
        3000,
      );
      pitches = list(proposed.pitches).map((row) => normalizePitch(row, attempts)).filter(Boolean).slice(0, 3);
      if (!pitches.length) throw journal.fail(councilError("작가 봇이 쓸 수 있는 피치를 내지 못했어요."));
      log({ by: "작가 봇", kind: "proposed", what: `피치 ${pitches.length}개: ${pitches.map((p) => p.title || p.logline).join(" / ")}`, why: round ? "거부된 피치를 대신해 다시 제안" : "방향·조건에 맞춘 첫 제안" });
      record.pitches = pitches;
      record.roles = { chair: "waiting", author: "done", editor: "speaking", art: "speaking", reader: "speaking" };
      // Round B: the three critics in parallel, each with its own standard; the
      // room shows each verdict as it lands.
      await snapshot("verdicts", PROGRESS.verdicts);
      const shown = `[피치]\n${JSON.stringify(pitches)}`;
      const partial = {};
      const critic = async (role, key, shape, ...args) => {
        const data = await ask(...args);
        partial[key] = shape(data);
        record.verdicts = { ...(record.verdicts || {}), ...partial };
        record.roles[role] = "done";
        await snapshot("verdicts", PROGRESS.verdicts);
        return data;
      };
      const [editor, art, reader] = await Promise.all([
        critic("editor", "editor", (d) => byPitch(d.verdicts, pitches.length),
          "편집자",
          PERSONA.editor,
          `${context}\n\n[점검표 — 항목마다 0(없음)·1(약함)·2(분명함)]\n${SPINE_CHECKLIST.map((row, i) => `${i + 1} ${row}`).join("\n")}${references.length ? `\n\n[참조 — 좋은 책의 뼈대 카드. 인물·물건·사건 재사용 금지]\n${references.join("\n")}` : ""}\n\n${shown}\n\n[출력] JSON만. 피치마다 verdict{pitch, stakes, ladder, lowPoint, turn, payoff, direction, veto(뼈대 결격이면 true), vetoReason, fixes(고칠 점 최대 2개)}와 pick(방향에 가장 잘 도달하는 피치 번호).`,
          EDITOR_SCHEMA,
          0.2,
          1600,
        ),
        critic("art", "art", (d) => byPitch(d.verdicts, pitches.length),
          "그림 감독",
          PERSONA.art,
          `${context}\n\n[그릴 수 있는가 — 항목마다 0·1·2]\ndrawableTurn: 반전이 아이 눈에 보이는 순간인가(마음속 깨달음만이면 0)\nplantedVisible: 심은 물건이 1비트 그림에 자연스럽게 놓이는가\nlowPointVisible: 바닥이 그림으로 드러나는가(큰 공간에 작은 아이, 빈 손, 멈춘 발)\nvariety: 비트마다 장소·카메라·크기가 달라지는가\n또 피치마다 책 전체에 되풀이할 시각 모티프 2~3개(ko/en)를 제안한다. 승인 재료 밖의 장소·인물을 쓰면 veto.\n\n${shown}\n\n[출력] JSON만. verdicts[{pitch, drawableTurn, plantedVisible, lowPointVisible, variety, motifs[{ko,en}], veto, vetoReason, fixes}], pick.`,
          ART_SCHEMA,
          0.2,
          1600,
        ),
        critic("reader", "reader", (d) => byPitch(d.reactions, pitches.length),
          "독자",
          PERSONA.reader(card),
          `어른이 피치 3개를 차례로 들려줘요.\n\n${shown}\n\n[출력] JSON만. 피치마다 reaction{pitch, nextQuestion(듣다가 "다음엔?" 하고 묻고 싶은 정도 0·1·2), retell(반전을 네 말로 한 문장), retellHasTurn(그 한 문장에 반전이 들어 있으면 true), scary(무섭거나 어려운 데가 있으면 한 줄, 없으면 빈 문자열)}, favorite(제일 듣고 싶은 피치 번호).`,
          READER_SCHEMA,
          0.4,
          1200,
        ),
      ]);
      verdicts = {
        editor: byPitch(editor.verdicts, pitches.length),
        art: byPitch(art.verdicts, pitches.length),
        reader: byPitch(reader.reactions, pitches.length),
        picks: { editor: Number(editor.pick) || null, art: Number(art.pick) || null, reader: Number(reader.favorite) || null },
      };
      scores = chairScores(verdicts.editor, verdicts.art, verdicts.reader, pitches.length);
      record.verdicts = verdicts;
      record.scores = scores;
      record.roles.chair = "speaking";
      for (const row of scores)
        log({ by: "의장", kind: "reviewed", what: `피치 ${row.pitch}: 편집자 ${row.editor}/12 · 그림 ${row.art}/8 · 독자 ${row.reader}/4 → ${row.score}/12`, why: row.vetoes.length ? `거부: ${row.vetoes.join(" / ")}` : "" });
      const choice = pickPitch(scores, editor, art);
      if (!choice.overrode || round === 1) {
        picked = choice;
        break;
      }
      log({ by: "의장", kind: "dropped", what: "피치 3개 모두 거부권", why: "작가 봇에게 거부 사유를 주고 한 번 더 제안을 받음" });
    }
    record.pitches = pitches;
    record.verdicts = verdicts;
    record.scores = scores;
    record.recommended = picked.pick;
    const choice = normalizeCouncilChoice(options.councilChoice, pitches.length);
    if (hold && !choice) {
      // R22: stop here with the chair's recommendation; the parent decides.
      record.roles = { chair: "speaking", author: "waiting", editor: "done", art: "done", reader: "done" };
      log({ by: "의장", kind: "reviewed", what: `피치 ${picked.pick} '${pitches[picked.pick - 1]?.title}' 추천`, why: picked.overrode ? "모든 피치가 거부되어 가장 높은 점수를 추천" : "부모님의 선택을 기다림" });
      await snapshot("review", PROGRESS.review);
      throw councilHoldError();
    }
    const parentPick = choice?.pick && choice.pick !== picked.pick ? choice.pick : null;
    if (parentPick) picked = { pick: parentPick, overrode: !!scores.find((row) => row.pitch === parentPick)?.vetoes.length };
    const index = picked.pick - 1,
      chosen = pitches[index],
      e = verdicts.editor[index],
      a = verdicts.art[index],
      r = verdicts.reader[index];
    record.chosen = picked.pick;
    record.overrode = picked.overrode;
    if (choice) record.parentChoice = { pick: picked.pick, note: choice.note };
    for (const row of scores)
      if (row.pitch !== picked.pick)
        log({ by: "의장", kind: "dropped", what: `피치 ${row.pitch} '${pitches[row.pitch - 1]?.title}'`, why: parentPick ? "부모가 다른 피치를 고름" : row.vetoes.length ? row.vetoes.join(" / ") : `점수 ${row.score} < ${scores[index].score}` });
    if (parentPick)
      log({ by: "부모", kind: "adopted", what: `피치 ${picked.pick} '${chosen.title}'`, why: `의장 추천(피치 ${record.recommended}) 대신 회의 결과를 보고 고름${picked.overrode ? " · 거부권을 넘어 택함" : ""}` });
    else
      log({ by: choice ? "부모" : "의장", kind: "adopted", what: `피치 ${picked.pick} '${chosen.title}'`, why: choice ? "의장 추천대로 회의 결과를 보고 확인" : picked.overrode ? "모든 피치가 거부되어 가장 높은 점수를 택함" : `편집자 ${scores[index].editor}/12 · 그림 ${scores[index].art}/8 · 독자 ${scores[index].reader}/4` });
    if (choice?.note) log({ by: "부모", kind: "revised", what: `한마디: ${choice.note}`, why: "작가 봇이 바이블에 반영" });
    // Round C: the author fixes the bible from the chosen pitch and the critics' fixes.
    record.roles = { chair: "done", author: "speaking", editor: "done", art: "done", reader: "done" };
    await snapshot("bible", PROGRESS.bible);
    const fixes = [...list(e?.fixes), ...list(a?.fixes), ...(r?.scary ? [`독자: ${str(r.scary, 200)}`] : [])].map((row) => str(row, 200)).filter(Boolean);
    const motifs = list(a?.motifs).filter(object).map((m) => ({ ko: str(m.ko, 60), en: str(m.en, 60) })).filter((m) => m.ko || m.en);
    const parentNote = choice?.note ? `\n\n[부모 메모 — 반드시 반영] ${choice.note}` : "";
    const bibleReply = await ask(
      "작가",
      PERSONA.author,
      `${context}\n\n[고른 피치]\n${JSON.stringify(chosen)}\n\n[고칠 점]\n${fixes.length ? fixes.map((row, i) => `${i + 1} ${row}`).join("\n") : "없음"}\n\n[아트 디렉터의 모티프 제안]\n${JSON.stringify(motifs)}\n\n[독자 되말하기] ${str(r?.retell, 300) || "없음"}${parentNote}\n\n[바이블 확정] 고친 점을 반영해 피치의 모든 필드를 다시 쓰고, visual{pictures: 비트 ${beats}개마다 {beatIndex, ko(아이가 보는 것 한 문장), en(그릴 수 있는 영어 한 문장: 8~25단어, 물리적 동사와 보이는 소품)}, motifs(2~3개, ko/en), plantedPlacementEn(1비트 그림에서 심은 물건이 놓인 자리, 영어)}를 붙인다. 비트 순서: ${beatLabels(beats).map((l, i) => `${i + 1} ${l}`).join(", ")}.\n\n[출력] JSON만. {"bible":{...}}`,
      BIBLE_SCHEMA(beats, attempts),
      0.5,
      3500,
    );
    const bible = normalizePitch(bibleReply.bible, attempts) || chosen;
    const visual = object(bibleReply.bible?.visual) ? bibleReply.bible.visual : {};
    const pictures = [];
    for (let n = 1; n <= beats; n++) {
      const row = list(visual.pictures).find((p) => object(p) && Number(p.beatIndex) === n);
      pictures.push({ beatIndex: n, ko: str(row?.ko, 200), en: str(row?.en, 240) });
    }
    bible.visual = {
      pictures,
      revealBeat: beats - 2,
      motifs: (list(visual.motifs).filter(object).map((m) => ({ ko: str(m.ko, 60), en: str(m.en, 60) })).filter((m) => m.ko || m.en).length ? list(visual.motifs).filter(object).map((m) => ({ ko: str(m.ko, 60), en: str(m.en, 60) })).filter((m) => m.ko || m.en) : motifs).slice(0, 3),
      plantedPlacementEn: str(visual.plantedPlacementEn, 200),
    };
    record.bible = bible;
    log({ by: "작가 봇", kind: "revised", what: `바이블 확정 '${bible.title}'`, why: fixes.length ? `반영한 지적 ${fixes.length}개: ${fixes.join(" / ")}`.slice(0, 300) : "지적 없음" });
    record.roles = { chair: "done", author: "done", editor: "done", art: "done", reader: "done" };
    await snapshot("done", "기획 회의를 마쳤어요. 바이블대로 줄거리를 씁니다.");
    return { record, usage: journal.usage(), meta: { ...journal.summary(), stage: "council" } };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw journal.fail(error, isCouncilHold(error) ? { held: true } : {});
  }
}
/** The outline carries the bible (binding later stages) and the meeting record (the log). */
export function attachCouncil(outline, result) {
  if (!object(outline) || !object(result?.record)) return outline;
  const { record } = result;
  outline.bible = clone(record.bible);
  outline.council = clone({
    version: record.version,
    direction: record.direction,
    conditions: record.conditions,
    reader: record.reader,
    pitches: record.pitches,
    scores: record.scores,
    picks: record.verdicts?.picks || null,
    reactions: record.verdicts?.reader || [],
    chosen: record.chosen,
    overrode: record.overrode,
    recommended: record.recommended ?? null,
    parentChoice: record.parentChoice ?? null,
    decisions: record.decisions,
    verdicts: record.verdicts ? { editor: record.verdicts.editor, art: record.verdicts.art, reader: record.verdicts.reader, picks: record.verdicts.picks } : null,
  });
  return outline;
}

/* ---------- 보여 주기 ---------- */
export function councilSummaryLine(outline) {
  const c = outline?.council;
  if (!object(c) || !c.chosen) return "";
  const row = list(c.scores).find((s) => s.pitch === c.chosen);
  const title = str(c.pitches?.[c.chosen - 1]?.title, 60);
  return `기획 회의 · 피치 ${list(c.pitches).length}개 중 '${title}' 채택${row ? ` · 편집자 ${row.editor}/12 · 그림 ${row.art}/8 · 독자 ${row.reader}/4` : ""}${c.overrode ? " · 거부권을 넘어 택함" : ""}${object(c.parentChoice) ? (c.parentChoice.pick !== c.recommended ? " · 부모가 고름" : " · 부모 확인") : ""}`;
}
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/gu, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
/** The pro check card and the simple ③ details: direction, the pitches with scores, the bible's spine, the log. */
export function renderCouncilCard(outline) {
  const c = outline?.council,
    bible = outline?.bible;
  if (!object(c) || !c.chosen) return "";
  const pitches = list(c.pitches)
    .map((p, i) => {
      const row = list(c.scores).find((s) => s.pitch === i + 1),
        chosen = i + 1 === c.chosen;
      return `<li class="${chosen ? "council-chosen" : ""}"><strong>${chosen ? "✓ " : ""}${esc(p.title)}</strong> — ${esc(p.logline)}${row ? `<br><small>편집자 ${row.editor}/12 · 그림 ${row.art}/8 · 독자 ${row.reader}/4 · 합계 ${row.score}/12${row.vetoes.length ? ` · 거부: ${esc(row.vetoes.join(" / "))}` : ""}</small>` : ""}${c.reactions?.[i]?.retell ? `<br><small>독자(${esc(c.reader?.age || "")}) 되말하기: “${esc(c.reactions[i].retell)}”</small>` : ""}</li>`;
    })
    .join("");
  const spine = object(bible)
    ? `<dl class="council-spine"><dt>못 하면 잃는 것</dt><dd>${esc(bible.stakes)}</dd><dt>심은 물건</dt><dd>${esc(bible.planted?.name)} — ${esc(bible.planted?.firstSeen)}</dd><dt>시도 사다리</dt><dd>${list(bible.ladder).map(esc).join(" → ")}</dd><dt>바닥</dt><dd>${esc(bible.lowPoint)}</dd><dt>반전</dt><dd>${esc(bible.turn?.seen)} → “${esc(bible.turn?.realized)}” → ${esc(bible.turn?.overturns)}</dd><dt>해결·끝</dt><dd>${esc(bible.payoff)} / ${esc(bible.echo)}</dd>${list(bible.visual?.motifs).length ? `<dt>모티프</dt><dd>${list(bible.visual.motifs).map((m) => esc(m.ko || m.en)).join(" · ")}</dd>` : ""}</dl>`
    : "";
  const log = list(c.decisions)
    .slice(-12)
    .map((d) => `<li><small>${esc(d.by)} · ${esc({ proposed: "제안", reviewed: "검토", adopted: "채택", revised: "수정", dropped: "폐기" }[d.kind] || d.kind)}</small> ${esc(d.what)}${d.why ? ` <small>— ${esc(d.why)}</small>` : ""}</li>`)
    .join("");
  const parent = object(c.parentChoice)
    ? `<p class="story-note">부모 선택: 피치 ${c.parentChoice.pick}${c.parentChoice.pick !== c.recommended ? ` (의장 추천 피치 ${c.recommended} 대신)` : " (의장 추천대로)"}${c.parentChoice.note ? ` · 한마디: “${esc(c.parentChoice.note)}”` : ""}</p>`
    : "";
  return `<details class="story-card story-council"><summary>기획 회의 <span class="story-check-badge">${esc(councilSummaryLine(outline).replace(/^기획 회의 · /u, ""))}</span></summary>${renderCouncilRoom({ ...c, bible: bible || null, phase: "done", roles: null }, { compact: true })}<p class="story-note">방향: ${esc(c.direction)}</p>${parent}<ol class="council-pitches">${pitches}</ol>${spine}${log ? `<p class="story-note">결정 기록 (최근 ${Math.min(12, list(c.decisions).length)}건)</p><ul class="council-log">${log}</ul>` : ""}</details>`;
}
/** The stop report's section (from the outline, or from the checkpoint when the outline never came). */
export function councilReportRows(job) {
  const c = job?.outline?.council || job?.councilCheckpoint?.record;
  if (!object(c) || !list(c.pitches).length) return [];
  const rows = ["", "## 기획 회의", `- 방향: ${str(c.direction, 300)}`];
  for (const row of list(c.conditions)) rows.push(`- 조건: ${str(row, 400)}`);
  list(c.pitches).forEach((p, i) => {
    const score = list(c.scores).find((s) => s.pitch === i + 1);
    rows.push(`- 피치 ${i + 1}${i + 1 === c.chosen ? " (채택)" : i + 1 === c.recommended && !c.chosen ? " (의장 추천 · 부모 선택 대기)" : ""}: ${str(p.title, 60)} — ${str(p.logline, 300)}${score ? ` · 편집자 ${score.editor}/12 · 그림 ${score.art}/8 · 독자 ${score.reader}/4${score.vetoes.length ? ` · 거부 ${score.vetoes.join(" / ")}` : ""}` : ""}`);
  });
  if (object(c.parentChoice))
    rows.push(`- 부모 선택: 피치 ${c.parentChoice.pick}${c.parentChoice.pick !== c.recommended ? ` (의장 추천 피치 ${c.recommended} 대신)` : " (의장 추천대로)"}${c.parentChoice.note ? ` · 한마디: ${str(c.parentChoice.note, 300)}` : ""}`);
  if (object(c.bible || job?.outline?.bible)) {
    const b = c.bible || job.outline.bible;
    rows.push(`- 바이블: 잃는 것 ${str(b.stakes, 200)} / 심은 물건 ${str(b.planted?.name, 80)} / 바닥 ${str(b.lowPoint, 200)} / 반전 ${str(b.turn?.seen, 200)} → ${str(b.turn?.realized, 200)}`);
  }
  for (const d of list(c.decisions).slice(-20)) rows.push(`  - ${str(d.by, 40)} · ${str(d.kind, 20)} · ${str(d.what, 300)}${d.why ? ` — ${str(d.why, 300)}` : ""}`);
  return rows;
}
