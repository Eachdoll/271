/* 이야기의 논리 (R47, 2026-10-29). The parent on a finished bilingual K2
 * book (돌돌 말린 길: Yuha in a space suit wants to start "a solar system trip"
 * on a cushion; a rolled bundle rolls in from nowhere and blocks him; inside
 * it, unseen until the turn, are animal friends who wanted out): "the story
 * structure is somehow awkward". Read beat by beat, three things made it so:
 * the bundle came from nowhere (nothing showed where it was or why it moved),
 * the want (a pretend trip) and the obstacle (a stuck mat) were about
 * different things until the last page, and eight of fifteen pages hung the
 * same tag on the hero's lines ("유하가 작게 말해요"). A new diet draft freezes
 * input.storyLogic {version: 1}; its outline is asked for cause and effect a
 * child can follow, and its writers to vary who-said-it. Nothing is counted
 * or checked. Drafts without the marker are unchanged. Pure module. */
export const STORY_LOGIC_VERSION = 1;
export const storyLogicPolicy = () => ({ version: STORY_LOGIC_VERSION });
/** The marker, on a diet draft. */
export const hasStoryLogic = (input) => input?.storyLogic?.version === STORY_LOGIC_VERSION && input?.promptDiet?.version === 1;
/** The outline request's paragraph (English, the outline's language). */
export function storyLogicOutlineRule(input) {
  if (!hasStoryLogic(input)) return "";
  return "LOGIC A CHILD CAN FOLLOW: everything that enters the story comes from somewhere the child has already seen or heard (a thing that blocks the way was lying there, was dropped, was blown in — never simply arrives); the want and what stands in its way are about the same thing, so every try is a try at the want; when the answer has been hidden all along, an early beat shows a small sign of it that the child can find again; the last beat answers the want — the hero gets it, or shows why it no longer matters. If the story is pretend play, the first beat shows that it is play. No one thing is in every beat: a prop that matters comes back in some beats and rests in the others, so each picture has its own thing to look at.";
}
/** The prose writers' line (Korean for the Korean writer, English otherwise). */
export function storyLogicWriterLine(input, lang = "ko") {
  if (!hasStoryLogic(input)) return "";
  return lang === "ko"
    ? "누가 말했는지 알리는 말꼬리('유하가 작게 말해요' 같은)는 앞 비트에서 쓴 것을 되풀이하지 않아요 — 대사만 두거나, 누가 말하는지는 몸짓이나 행동으로 보여 줘요."
    : "Do not repeat a speech tag an earlier beat used (\"Yuha said softly\" again and again): let a line stand alone, or show who speaks by what they do.";
}
