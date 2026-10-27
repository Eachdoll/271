/* 등장인물의 관계 (R41, 2026-10-27). The parent on a finished book with two
 * characters (a child and a mother, every page the same pair): "from K1 up,
 * make the cast four or five by default and let the story show more varied
 * relationships." Two things were thin: the simple picks offered two friends
 * at most, and the outline asked for nothing about how the cast relate — so
 * every companion was a kind helper. A new diet draft freezes
 * input.storyCast {version: 1}; its material plan aims at four or five
 * characters; its outline names, for every companion, a relation to the hero
 * that is not "helps" and a want of their own, and at least two of those
 * relations change by the end; the writers hear each beat's relations.
 * Drafts without the marker are unchanged.
 *
 * 첫 등장 (R43, 2026-10-27). The parent on a finished K2 draft: "did 해니
 * appear out of nowhere because of the four-or-more rule?" Partly: ② filled
 * the picks from the drawer in order, and no rule anywhere asked a
 * companion's first appearance to be shown — 해니 was hugging a cushion on
 * page 3 with no line that brought her in. A new diet draft freezes
 * storyCast {version: 1, entrance: true}: every relation row also says the
 * beat where the child first sees that companion (firstBeat — settled from
 * the beats themselves) and how they come into the story (entrance); the
 * writers, the K1 writer and pagination show that moment; the material plan
 * takes drawer records that have something to do in the story, never one to
 * reach the number; ② preselects only the friends the topic calls for.
 * R41 drafts ({version: 1}) are unchanged. Pure module. */
export const STORY_CAST_VERSION = 1;
/** The frozen marker; R43: a new draft freezes {version: 1, entrance: true}. */
export const storyCastPolicy = ({ entrance } = {}) => ({ version: STORY_CAST_VERSION, ...(entrance === true ? { entrance: true } : {}) });
/** normalizeStoryInput keeps the marker as it was frozen (the entrance flag included). */
export const storyCastRef = (value) => (value && typeof value === "object" && value.version === STORY_CAST_VERSION ? storyCastPolicy({ entrance: value.entrance === true }) : null);
export const hasStoryCast = (input) => input?.storyCast?.version === STORY_CAST_VERSION && input?.promptDiet?.version === 1;
/** R43: the first appearance of every companion is part of the contract. */
export const hasCastEntrance = (input) => hasStoryCast(input) && input.storyCast.entrance === true;
/** The cast the simple picks and the material plan aim at (the hero included). */
export const CAST_TARGET = Object.freeze({ min: 4, max: 5 });
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const str = (value, max = 200) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
const clause = (value, max = 200) => str(value, max).replace(/[.。!]+$/u, "");
const isK1 = (input) => input?.k1Policy?.version === 1 || /^K1$/u.test(String(input?.specs?.ko?.id || ""));
const leadId = (input) => list(input?.characters)[0]?.id;
const companionsOf = (input) => list(input?.characters).slice(1);
/** The outline request schema's relations list (one row per companion). */
export function withCastSchema(schema, input) {
  if (!hasStoryCast(input) || !schema?.properties) return schema;
  const ids = companionsOf(input).map((c) => c.id);
  if (!ids.length) return schema;
  schema.properties.relations = {
    type: "array",
    minItems: ids.length,
    maxItems: ids.length,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["characterId", "relation", "want", ...(hasCastEntrance(input) ? ["firstBeat", "entrance"] : [])],
      properties: {
        characterId: { type: "string", enum: ids },
        relation: { type: "string", minLength: 1, maxLength: 80 },
        want: { type: "string", minLength: 1, maxLength: 160 },
        // R43: the beat where the child first sees this companion and how they come in.
        ...(hasCastEntrance(input) ? { firstBeat: { type: "integer", minimum: 1 }, entrance: { type: "string", minLength: 1, maxLength: 120 } } : {}),
      },
    },
  };
  schema.required = [...new Set([...(schema.required || []), "relations"])];
  return schema;
}
/** The outline request's paragraph (English, the writers' language there). */
export function castRule(input) {
  if (!hasStoryCast(input)) return "";
  const companions = companionsOf(input);
  if (!companions.length) return "";
  const k1 = isK1(input);
  return `CAST: this story has ${list(input.characters).length} characters and every one of them matters. Return relations — one row per companion (every supplied ID except the first): relation is what that character is to the hero in THIS story, never simply "helps" (${
    k1
      ? "a little one who copies, a bigger one who goes first, a grown-up busy with something else, a shy one who only watches, one who wants the same toy"
      : "a rival who wants the same thing, a little one who copies, a grown-up busy with their own task, a shy one who watches, a bossy one who directs, one who does not believe"
  }); want is what they want for themselves. Companions get in the way, go their own way or help by accident; the hero still solves it. At least two of these relations are different by the end (the rival shares, the shy one speaks up, the busy grown-up finally looks) — show it in a beat, never say it. Every character acts in at least two beats; the picture of one beat holds at most four. No two companions have the same relation.${
    hasCastEntrance(input)
      ? ` ENTRANCE: for every companion also return firstBeat (the beat where the child first sees them) and entrance (how they come into the story — walking in, already there busy with their own thing, heard before seen; one short phrase). That beat's summary includes it; nobody is simply present from one line to the next. A companion with nothing to do in this story stays out of the beats.`
      : ""
  }`;
}
/** Clean the relations on an outline (in place): asked-for drafts keep rows for supplied companions, others carry none. */
export function settleRelations(outline, input) {
  if (!object(outline)) return outline;
  if (!hasStoryCast(input)) {
    delete outline.relations;
    return outline;
  }
  const ids = new Set(companionsOf(input).map((c) => c.id)),
    seen = new Set(),
    rows = [],
    entrance = hasCastEntrance(input),
    // R43: the beats are the truth about where a companion first appears; the model's firstBeat is replaced by it.
    firstBeatOf = (id) => {
      const beat = list(outline.beats).find((row) => object(row) && list(row.characters).includes(id));
      return beat && Number.isInteger(Number(beat.index)) ? Number(beat.index) : null;
    };
  for (const row of list(outline.relations)) {
    if (!object(row)) continue;
    const characterId = str(row.characterId, 80),
      relation = clause(row.relation, 80),
      want = clause(row.want, 160);
    if (!ids.has(characterId) || seen.has(characterId) || !relation) continue;
    seen.add(characterId);
    const out = { characterId, relation, ...(want ? { want } : {}) };
    if (entrance) {
      const actual = firstBeatOf(characterId),
        claimed = Number.isInteger(Number(row.firstBeat)) && Number(row.firstBeat) >= 1 ? Number(row.firstBeat) : null,
        first = actual ?? (list(outline.beats).length ? null : claimed),
        how = clause(row.entrance, 120);
      if (first) out.firstBeat = first;
      if (first && how) out.entrance = how;
    }
    rows.push(out);
  }
  if (rows.length) outline.relations = rows;
  else delete outline.relations;
  return outline;
}
const nameOf = (input, id) => {
  const c = list(input?.characters).find((row) => row?.id === id);
  return c ? str(c.name || c.nameEn || id, 40) : str(id, 40);
};
/** The beat writers' line: the relations of the companions in this beat (empty without rows). */
export function castWriterLine(outline, beat, input, lang = "ko") {
  const rows = list(outline?.relations).filter((row) => object(row) && list(beat?.characters).includes(row.characterId));
  if (!rows.length) return "";
  const ko = lang === "ko";
  const parts = rows.map((row) => (ko ? `${nameOf(input, row.characterId)}는 ${row.relation}${row.want ? ` — 바라는 것: ${row.want}` : ""}` : `${nameOf(input, row.characterId)} is ${row.relation}${row.want ? ` — wants: ${row.want}` : ""}`));
  const line = ko ? `[관계] ${parts.join(" / ")}. 조연은 제 바람대로 움직여요. 돕기만 하는 사람은 없어요.` : `[Relations] ${parts.join(" / ")}. Each companion follows their own want; nobody only helps.`;
  // R43: the companions who appear for the first time in this beat.
  const entering = rows.filter((row) => Number(row.firstBeat) === Number(beat?.index));
  if (!entering.length) return line;
  const arrivals = entering.map((row) => `${nameOf(input, row.characterId)}${row.entrance ? (ko ? ` — ${row.entrance}` : ` — ${row.entrance}`) : ""}`).join(" / ");
  return `${line}\n${ko ? `[첫 등장] ${arrivals}. 여기서 처음 나와요 — 들어오는 모습이나 이미 거기서 하던 일을 한 줄로 보여 줘요. 갑자기 옆에 있지 않아요.` : `[First appearance] ${arrivals}. They appear here for the first time — show them arriving or already there at something of their own, in one line; nobody is simply there.`}`;
}
/** The K1 writer's block (whole book at once). */
export function castK1Block(outline, input) {
  const rows = list(outline?.relations).filter(object);
  if (!rows.length) return "";
  const entering = rows.filter((row) => Number.isInteger(row.firstBeat));
  return `[등장인물의 관계] ${rows.map((row) => `${nameOf(input, row.characterId)}는 ${row.relation}${row.want ? `(바라는 것: ${row.want})` : ""}`).join(" / ")}. 조연마다 제 바람대로 움직이고, 끝에서 둘쯤은 달라져요.${
    entering.length ? ` 첫 등장: ${entering.map((row) => `${nameOf(input, row.characterId)} ${row.firstBeat}비트${row.entrance ? `(${row.entrance})` : ""}`).join(" / ")} — 그 쪽에서 들어오는 모습이나 이미 하던 일을 한 줄로 보여 줘요. 갑자기 옆에 있지 않아요.` : ""
  }`;
}
/** One line for ③, the eco outline and the pro card. */
export function castSummary(outline, input) {
  const rows = list(outline?.relations).filter(object);
  return rows.length ? `관계 · ${rows.map((row) => `${nameOf(input, row.characterId)} ${str(row.relation, 30)}${Number.isInteger(row.firstBeat) ? ` (${row.firstBeat}비트부터)` : ""}`).join(" · ")}` : "";
}
/** R43: the pagination requests' line (pages, openings, eco): the entry where a companion first appears shows the arrival. */
export function castPaginationLine(input) {
  if (!hasCastEntrance(input) || !companionsOf(input).length) return "";
  return "ENTRANCE: on the entry of the beat where a companion first appears (relations[].firstBeat, entrance), scene.action shows them coming in or already there at their own thing, as the outline says; a companion never simply stands in a picture from one entry to the next.";
}
/** The writers' room's extra sentence for the pitch (Korean, the room's language). */
export function castPitchInstructions(input) {
  if (!hasStoryCast(input) || companionsOf(input).length < 2) return "";
  return "조연마다 주인공과의 관계가 서로 다르고(돕는 역할만은 없음: 같은 것을 바라는 라이벌·따라 하는 꼬마·제 일로 바쁜 어른·지켜보는 조용한 아이·앞장서는 아이…) 제 바람이 있다; 끝에서 둘쯤의 관계가 달라진다.";
}
/** The material planner's sentence (auto plan): four or five characters in all. */
export function castPlanRule(input) {
  if (!hasStoryCast(input)) return "";
  // R43: drawer records are taken for what they can do in the story, never to reach the number.
  if (hasCastEntrance(input))
    return `\nCAST SIZE: ${CAST_TARGET.min} or ${CAST_TARGET.max} characters in all (the hero and ${CAST_TARGET.min - 1}–${CAST_TARGET.max - 1} companions who relate to the hero in different ways — a rival, a little one, a busy grown-up, a shy one…); the parent's picks first, then drawer records that have something to do in this story (a want of their own that touches the topic), new ones only when the drawer has none; a record that would only stand in the pictures stays out — fewer characters beat a filler; never more than ${CAST_TARGET.max}.`;
  return `\nCAST SIZE: ${CAST_TARGET.min} or ${CAST_TARGET.max} characters in all (the hero and ${CAST_TARGET.min - 1}–${CAST_TARGET.max - 1} companions who relate to the hero in different ways — a rival, a little one, a busy grown-up, a shy one…); the parent's picks and fitting drawer records first, new ones only when the drawer runs out; never more than ${CAST_TARGET.max}.`;
}
