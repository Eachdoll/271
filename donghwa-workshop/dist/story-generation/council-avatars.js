/*
 * Five original watercolor portraits for the planning council.
 * A single bundled 3-by-2 transparent sheet keeps requests and offline storage
 * small. Each 120px SVG viewport displays one cell; role labels and the public
 * councilAvatar API stay the same. No model is called when this UI renders.
 */
export const COUNCIL_AVATAR_SHEET = "./assets/council/watercolor-portraits.webp";
const FRAMES = Object.freeze({
  chair: [0, 0],
  author: [1, 0],
  editor: [2, 0],
  art: [0, 1],
  reader: [1, 1],
});

export const COUNCIL_ROLES = Object.freeze([
  Object.freeze({ id: "chair", name: "의장", title: "코드 · 진행과 채점", voice: "토론하지 않고 기록해요" }),
  Object.freeze({ id: "author", name: "작가 봇", title: "그림책 작가 20년", voice: "반전은 아이가 먼저 알아차리게" }),
  Object.freeze({ id: "editor", name: "편집자 봇", title: "뼈대 점검표", voice: "바라는 것이 없으면 돌려보내요" }),
  Object.freeze({ id: "art", name: "그림 감독 봇", title: "그릴 수 있는가", voice: "반전은 펼침면 한 장으로" }),
  Object.freeze({ id: "reader", name: "독자 봇", title: "소리로만 듣는 아이", voice: "다음엔? 하고 묻고 싶은지" }),
]);
/** The accessible SVG viewport for a role (empty for an unknown role). */
export function councilAvatar(role) {
  const frame = Object.hasOwn(FRAMES, role) ? FRAMES[role] : null;
  if (!frame) return "";
  const [column, row] = frame;
  const label = councilRole(role).name;
  return `<svg class="council-avatar" viewBox="0 0 120 120" role="img" aria-label="${label}" focusable="false"><image href="${COUNCIL_AVATAR_SHEET}" x="${-column * 120}" y="${-row * 120}" width="360" height="240" preserveAspectRatio="xMidYMid meet"/></svg>`;
}
export const councilRole = (id) => COUNCIL_ROLES.find((role) => role.id === id) || null;
