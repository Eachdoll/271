/*
 * Story-spine rules (2026-10-20, R19). A parent read finished books and said
 * the stories stay light even after the editor's read-through: the outline
 * rules and the reference examples asked only for the skeleton (a planted
 * object, three different failures, a twist) and no stage asked for stakes,
 * rising tries, a low point before the turn, or a staged reveal; the simplify
 * pass then cut whatever carried them. New drafts freeze input.arcPolicy
 * {version: 1}; every rule here is gated on it, so existing drafts, jobs and
 * books send byte-identical requests.
 */
export const ARC_POLICY_VERSION = 1;
export const arcPolicy = () => ({ version: ARC_POLICY_VERSION });
export const hasArcPolicy = (input) =>
  input?.arcPolicy?.version === ARC_POLICY_VERSION;

/** Reference examples for the quality path: story-spine cards, 9-point examples, a wider budget. */
export const ARC_EXAMPLE_STYLE = "arc";
export const ARC_EXAMPLE_MIN_RUBRIC = 9;
export const ARC_EXAMPLE_TOKEN_BUDGET = 3200;

const OUTLINE_RULES = [
  "STAKES: by the want beat, one concrete line says what the protagonist loses or misses if the want fails (a thing, a moment, someone's face), so a four-year-old knows why it matters; a later beat shows that loss coming closer.",
  "RISING TRIES: each attempt costs more than the one before (a wet sock, then the hat gone, then the planted thing itself out of reach) and changes the plan for a reason; never three tries of the same size.",
  "LOW POINT: the last attempt ends at the lowest moment of the book: the protagonist is about to give up and says so in one short line, while the clue (the planted thing or its sound) is right there, unnoticed.",
  "TURN = SEEING AGAIN: the turn does not find a new thing; it sees the planted thing in a new way. plan.twistReveal names (a) what the protagonist believed, (b) what is actually true, (c) the planted thing's new role, in words a child can retell in one sentence.",
  "PAYOFF: in the resolution the protagonist does the solving with their own hands, using what the turn showed; the close echoes one object or line from the first beat with one visible difference that shows what changed.",
  "EMOTION LADDER: emotionArc runs calm → eager → hopeful → funny or frustrated → almost giving up → surprised → proud or relieved → calm; each beat summary shows its feeling through an action, never a label.",
];
/** Outline stage (app path, and the quality path's canon). */
export function arcOutlineRules(input) {
  if (!hasArcPolicy(input)) return "";
  return `STORY SPINE (picture-book arc):\n${OUTLINE_RULES.join("\n")}`;
}

const PROSE_RULES = [
  "STAKES LINE: the want beat's paragraph keeps one short line, in the protagonist's own words, of what is at stake.",
  "LOW POINT: the last attempt's paragraph ends with the quietest sentence of the book (the protagonist near giving up): not a question, not a sound word.",
  "TURN IN THREE STEPS: the turn paragraph shows, in order, (1) a sight or sound of the planted thing, (2) the protagonist's realization spoken aloud in their own words, (3) what it means now. The narrator never explains the answer before the protagonist sees it and never writes '알고 보니' or 'it turned out' narration.",
  "PAYOFF: the resolution shows the protagonist's hands doing the solving; the close repeats one image or line from the opening with one changed detail.",
];
/** Prose stages (app prose, enrichment, the quality path's rich/simplify/fix canon). */
export function arcProseRules(input) {
  if (!hasArcPolicy(input)) return "";
  return `STORY SPINE IN PROSE:\n${PROSE_RULES.join("\n")}`;
}

/** The quality path's canon block for the outline and prose stages. */
export function arcCanonRules(input, stage = "outline") {
  return stage === "prose" ? arcProseRules(input) : arcOutlineRules(input);
}

/**
 * The lines the package's simplify, fix and condense calls add to their
 * '[반드시 지킬 것]' list: the sentences that carry the spine are never the
 * ones cut to fit the level.
 */
export function arcSimplifyKeep(input, lang = "ko") {
  if (!hasArcPolicy(input)) return "";
  return lang === "en"
    ? "- Keep the spine when shortening: the want beat's one line of what is at stake, the quietest last sentence of the final attempt (near giving up), the turn's three steps (a sight or sound of the planted thing → the protagonist's own words of realization → what it means) and the resolution sentence where the protagonist's hands do the solving. Cut side description and repetition first."
    : "- 뼈대는 줄이지 않는다: want 비트의 '못 하면 어떻게 되는지' 한 문장, 마지막 attempt 끝의 가장 조용한 한 문장(포기 직전), turn 비트의 세 걸음(심은 물건을 보거나 듣는 문장 → 주인공이 제 말로 알아차리는 문장 → 그래서 어떻게 되는지), resolution에서 주인공이 손으로 해내는 문장. 줄여야 하면 곁가지 묘사와 반복을 먼저 줄인다.";
}

/** The editor's read-through: extra aspects and what to restage, wording only. */
export const ARC_REVISION_ASPECTS = Object.freeze(["stakes", "lowPoint", "turn"]);
export function arcRevisionRules(input) {
  if (!hasArcPolicy(input)) return "";
  return " Also, for the story spine (wording only, the events stay): a turn page where the narrator explains the answer before the protagonist sees it (restage the same event as a sight or sound of the planted thing → the protagonist's own words → what it means, inside the page's sentence range); the page just before the turn that does not read as the lowest moment (end it on the protagonist's quietest line, not a question); a want page that never says what is at stake; a closing page that does not echo one image or line from the opening. Report these under the aspects stakes, lowPoint and turn.";
}

const KO_PARTICLES = /(?:이|가|을|를|은|는|과|와|도|로|으로|에|에서|의|랑|이랑|까지|부터|만|들)$/u;
/** The head noun of plan.planted ('목에 작은 종이 달린 말 인형. 유하가 …' → '인형'). */
export function plantedHeadNoun(planted) {
  const first = String(planted ?? "")
    .split(/\s[—–-]\s|[—–:：(（\n]|\.(?:\s|$)/u)[0]
    .trim();
  const words = first.split(/\s+/u).filter(Boolean);
  const last = words.at(-1) || "";
  const bare = last.replace(KO_PARTICLES, "");
  return bare.length >= 2 ? bare : last;
}
/**
 * Advisory (soft) outline check: the turn beat must bring the planted thing
 * back. The quality path's own plotCheck asks the same; this covers the app
 * path, where only the SUSPENSE rule mentioned the planted object.
 */
export function inspectArc(outline, input) {
  if (!hasArcPolicy(input)) return [];
  const planted = outline?.plan?.planted;
  const turn = (Array.isArray(outline?.beats) ? outline.beats : []).find(
    (beat) => beat?.type === "turn",
  );
  if (typeof planted !== "string" || !planted.trim() || !turn) return [];
  const noun = plantedHeadNoun(planted);
  const text = `${turn.summary || ""}\n${outline?.plan?.twistReveal || ""}`;
  if (!noun || text.includes(noun)) return [];
  return [
    {
      code: "arc_turn_planted",
      message: `반전 비트(${turn.index})에 처음에 심은 물건 ‘${noun}’이(가) 다시 나오게 해 주세요.`,
      beatIndex: turn.index,
    },
  ];
}
