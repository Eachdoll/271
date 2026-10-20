/*
 * 기획 회의 봇 아바타 (2026-10-20, R21). Five original characters drawn as
 * inline SVG in a classic animated-film look: big round eyes with two
 * highlights, soft rounded shapes, warm gradients, a prop that says the job.
 * No image call is ever made for them; they ship with the app.
 */
const eye = (cx, cy, r, iris, prefix) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${(r * 1.15).toFixed(1)}" fill="#fff" stroke="#2b2430" stroke-width="1.2"/><circle cx="${cx}" cy="${(cy + r * 0.12).toFixed(1)}" r="${(r * 0.66).toFixed(1)}" fill="url(#${prefix}-iris)"/><circle cx="${cx}" cy="${(cy + r * 0.2).toFixed(1)}" r="${(r * 0.38).toFixed(1)}" fill="#1b1724"/><circle cx="${(cx - r * 0.28).toFixed(1)}" cy="${(cy - r * 0.25).toFixed(1)}" r="${(r * 0.22).toFixed(1)}" fill="#fff"/><circle cx="${(cx + r * 0.22).toFixed(1)}" cy="${(cy + r * 0.32).toFixed(1)}" r="${(r * 0.1).toFixed(1)}" fill="#fff" opacity=".95"/>`;
const iris = (prefix, inner, outer) =>
  `<radialGradient id="${prefix}-iris" cx="50%" cy="45%"><stop offset="0" stop-color="${inner}"/><stop offset="1" stop-color="${outer}"/></radialGradient>`;
const backdrop = (prefix, inner, outer) =>
  `<radialGradient id="${prefix}-bg" cx="50%" cy="38%"><stop offset="0" stop-color="${inner}"/><stop offset="1" stop-color="${outer}"/></radialGradient>`;
const blush = (cx, cy) => `<ellipse cx="${cx}" cy="${cy}" rx="6" ry="3.4" fill="#f58f8f" opacity=".55"/>`;
const svg = (label, body) =>
  `<svg class="council-avatar" viewBox="0 0 120 120" role="img" aria-label="${label}" focusable="false">${body}</svg>`;

/** 의장: a small brass-and-cream robot with a bow tie and a gavel; it keeps time and never argues. */
const chair = () =>
  svg(
    "의장",
    `<defs>${backdrop("ch", "#fff7de", "#efd9a3")}${iris("ch", "#8fb9ff", "#2f63c7")}<linearGradient id="ch-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="#e9d3a4"/></linearGradient></defs><circle cx="60" cy="60" r="56" fill="url(#ch-bg)"/><line x1="60" y1="21" x2="60" y2="31" stroke="#b08a4a" stroke-width="3" stroke-linecap="round"/><circle cx="60" cy="17" r="5.5" fill="#ffd44f" stroke="#b08a4a" stroke-width="2"/><circle cx="60" cy="17" r="2" fill="#fff5c2"/><circle cx="23" cy="58" r="6.5" fill="#d9b86c" stroke="#a9833f" stroke-width="2"/><circle cx="97" cy="58" r="6.5" fill="#d9b86c" stroke="#a9833f" stroke-width="2"/><rect x="26" y="31" width="68" height="58" rx="27" fill="url(#ch-body)" stroke="#a9833f" stroke-width="3"/><rect x="34" y="40" width="52" height="30" rx="15" fill="#fff" opacity=".35"/>${eye(46, 56, 9, "", "ch")}${eye(74, 56, 9, "", "ch")}<path d="M47 73 Q60 82 73 73" stroke="#7a5a2a" stroke-width="3" fill="none" stroke-linecap="round"/>${blush(36, 68)}${blush(84, 68)}<path d="M47 93 L60 98 L73 93 L73 106 L60 101 L47 106 Z" fill="#d94f4f" stroke="#a83232" stroke-width="1.5"/><circle cx="60" cy="99.5" r="3.2" fill="#a83232"/><g transform="rotate(-28 95 92)"><rect x="90" y="80" width="10" height="26" rx="4" fill="#8b5a2b" stroke="#5e3a1a" stroke-width="1.5"/><rect x="83" y="74" width="24" height="11" rx="4.5" fill="#6a4320" stroke="#4a2c12" stroke-width="1.5"/></g>`,
  );
/** 작가 봇: an owl with round spectacles and a quill; it has written for twenty years. */
const author = () =>
  svg(
    "작가 봇",
    `<defs>${backdrop("au", "#fff1dc", "#e8c59a")}${iris("au", "#ffd27a", "#c9821a")}<linearGradient id="au-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a6b3f"/><stop offset="1" stop-color="#6f4a28"/></linearGradient></defs><circle cx="60" cy="60" r="56" fill="url(#au-bg)"/><path d="M30 46 L24 22 L44 36 Z" fill="#7a5130" stroke="#4f3117" stroke-width="2"/><path d="M90 46 L96 22 L76 36 Z" fill="#7a5130" stroke="#4f3117" stroke-width="2"/><ellipse cx="60" cy="66" rx="36" ry="38" fill="url(#au-body)" stroke="#4f3117" stroke-width="3"/><ellipse cx="60" cy="62" rx="30" ry="28" fill="#f3e2c2"/><ellipse cx="44" cy="60" rx="16" ry="15" fill="#fff8ea"/><ellipse cx="76" cy="60" rx="16" ry="15" fill="#fff8ea"/>${eye(44, 60, 10, "", "au")}${eye(76, 60, 10, "", "au")}<circle cx="44" cy="60" r="14" fill="none" stroke="#3a2a4a" stroke-width="2.5"/><circle cx="76" cy="60" r="14" fill="none" stroke="#3a2a4a" stroke-width="2.5"/><line x1="58" y1="59" x2="62" y2="59" stroke="#3a2a4a" stroke-width="2.5"/><path d="M60 72 L54 80 L66 80 Z" fill="#f0a63a" stroke="#b7731c" stroke-width="1.5"/>${blush(32, 72)}${blush(88, 72)}<path d="M58 88 Q60 96 62 104" stroke="#4f3117" stroke-width="2" fill="none"/><g transform="rotate(20 92 86)"><path d="M92 62 Q104 70 94 100 Q86 80 92 62 Z" fill="#f5efe6" stroke="#8c7a66" stroke-width="1.5"/><line x1="93" y1="64" x2="93" y2="98" stroke="#8c7a66" stroke-width="1.2"/><path d="M92 100 L91 108" stroke="#2b2430" stroke-width="2" stroke-linecap="round"/></g>`,
  );
/** 편집자 봇: a fox with red spectacles and a pencil behind one ear; one brow is always a little raised. */
const editor = () =>
  svg(
    "편집자 봇",
    `<defs>${backdrop("ed", "#fdeee4", "#f2c6a9")}${iris("ed", "#8ee3c9", "#1f8a6b")}<linearGradient id="ed-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9f52"/><stop offset="1" stop-color="#e06f24"/></linearGradient></defs><circle cx="60" cy="60" r="56" fill="url(#ed-bg)"/><path d="M28 56 L20 18 L48 40 Z" fill="url(#ed-body)" stroke="#9c4a12" stroke-width="2.5"/><path d="M92 56 L100 18 L72 40 Z" fill="url(#ed-body)" stroke="#9c4a12" stroke-width="2.5"/><path d="M30 52 L26 28 L44 42 Z" fill="#3b2318"/><path d="M90 52 L94 28 L76 42 Z" fill="#3b2318"/><path d="M22 66 Q22 36 60 36 Q98 36 98 66 Q98 96 60 100 Q22 96 22 66 Z" fill="url(#ed-body)" stroke="#9c4a12" stroke-width="3"/><path d="M34 74 Q60 112 86 74 Q60 84 34 74 Z" fill="#fff6ec"/>${eye(45, 60, 9, "", "ed")}${eye(75, 60, 9, "", "ed")}<circle cx="45" cy="60" r="13" fill="none" stroke="#d13b3b" stroke-width="3"/><circle cx="75" cy="60" r="13" fill="none" stroke="#d13b3b" stroke-width="3"/><line x1="58" y1="59" x2="62" y2="59" stroke="#d13b3b" stroke-width="3"/><path d="M34 46 Q45 40 54 46" stroke="#3b2318" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M66 44 Q76 36 86 44" stroke="#3b2318" stroke-width="2.5" fill="none" stroke-linecap="round"/><ellipse cx="60" cy="80" rx="5" ry="3.5" fill="#3b2318"/><path d="M52 88 Q60 93 68 88" stroke="#3b2318" stroke-width="2.5" fill="none" stroke-linecap="round"/>${blush(33, 70)}${blush(87, 70)}<g transform="rotate(-50 96 44)"><rect x="92" y="30" width="7" height="34" rx="2" fill="#ffd34d" stroke="#b08a1a" stroke-width="1.2"/><path d="M92 64 L95.5 72 L99 64 Z" fill="#f3d9b1" stroke="#b08a1a" stroke-width="1.2"/><rect x="92" y="30" width="7" height="5" fill="#f08080"/></g>`,
  );
/** 그림 감독 봇: a raccoon in a red beret with a loaded brush; there is always paint on its paws. */
const art = () =>
  svg(
    "그림 감독 봇",
    `<defs>${backdrop("ar", "#eef4ff", "#c9d8f3")}${iris("ar", "#b7a6ff", "#5b3fc7")}<linearGradient id="ar-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9b6c4"/><stop offset="1" stop-color="#7d7890"/></linearGradient></defs><circle cx="60" cy="60" r="56" fill="url(#ar-bg)"/><ellipse cx="30" cy="44" rx="11" ry="12" fill="#7d7890" stroke="#4a4556" stroke-width="2.5"/><ellipse cx="90" cy="44" rx="11" ry="12" fill="#7d7890" stroke="#4a4556" stroke-width="2.5"/><ellipse cx="30" cy="46" rx="5" ry="6" fill="#f3d5d8"/><ellipse cx="90" cy="46" rx="5" ry="6" fill="#f3d5d8"/><ellipse cx="60" cy="66" rx="38" ry="34" fill="url(#ar-body)" stroke="#4a4556" stroke-width="3"/><path d="M26 60 Q40 48 60 52 Q80 48 94 60 Q86 76 60 74 Q34 76 26 60 Z" fill="#3b3447"/><ellipse cx="44" cy="61" rx="13" ry="11" fill="#fff"/><ellipse cx="76" cy="61" rx="13" ry="11" fill="#fff"/>${eye(44, 61, 8.5, "", "ar")}${eye(76, 61, 8.5, "", "ar")}<ellipse cx="60" cy="80" rx="18" ry="13" fill="#f4f1f7"/><ellipse cx="60" cy="78" rx="5.5" ry="4" fill="#2b2430"/><path d="M53 86 Q60 91 67 86" stroke="#2b2430" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M24 40 Q40 18 70 26 Q90 30 92 40 Q60 34 24 40 Z" fill="#d93b3b" stroke="#9c2222" stroke-width="2.5"/><circle cx="70" cy="22" r="4" fill="#d93b3b" stroke="#9c2222" stroke-width="2"/><g transform="rotate(-35 98 92)"><rect x="95" y="60" width="6" height="40" rx="2" fill="#c98a4b" stroke="#7a4c1e" stroke-width="1.2"/><rect x="93.5" y="52" width="9" height="12" rx="2" fill="#dcdcdc" stroke="#8c8c8c" stroke-width="1.2"/><path d="M93 52 Q98 38 103 52 Z" fill="#3f8cff"/></g><circle cx="36" cy="94" r="4" fill="#ffd34d"/><circle cx="84" cy="100" r="3.5" fill="#3f8cff"/><circle cx="46" cy="104" r="2.5" fill="#f06292"/>`,
  );
/** 독자 봇: a bear cub in star pyjamas hugging a blanket corner; it only listens. */
const reader = () =>
  svg(
    "독자 봇",
    `<defs>${backdrop("re", "#fff3e6", "#f6d2b0")}${iris("re", "#9a7bff", "#3d2a8c")}<linearGradient id="re-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6b574"/><stop offset="1" stop-color="#c38a44"/></linearGradient></defs><circle cx="60" cy="60" r="56" fill="url(#re-bg)"/><circle cx="30" cy="36" r="12" fill="url(#re-body)" stroke="#8a5a22" stroke-width="2.5"/><circle cx="90" cy="36" r="12" fill="url(#re-body)" stroke="#8a5a22" stroke-width="2.5"/><circle cx="30" cy="37" r="6" fill="#f7cfb0"/><circle cx="90" cy="37" r="6" fill="#f7cfb0"/><ellipse cx="60" cy="62" rx="37" ry="33" fill="url(#re-body)" stroke="#8a5a22" stroke-width="3"/>${eye(45, 58, 10.5, "", "re")}${eye(75, 58, 10.5, "", "re")}<ellipse cx="60" cy="78" rx="15" ry="11" fill="#f7dfc2"/><ellipse cx="60" cy="75" rx="5" ry="3.8" fill="#4a2e14"/><path d="M53 83 Q60 88 67 83" stroke="#4a2e14" stroke-width="2.5" fill="none" stroke-linecap="round"/>${blush(32, 70)}${blush(88, 70)}<path d="M24 100 Q30 90 44 92 L76 92 Q90 90 96 100 L96 118 L24 118 Z" fill="#bfe0ff" stroke="#6ea6d6" stroke-width="2.5"/><path d="M44 92 L60 102 L76 92" fill="none" stroke="#6ea6d6" stroke-width="2.5"/><path d="M36 106 l2 -4 l2 4 l-4 -2.5 h4 Z" fill="#fff" opacity=".9"/><path d="M82 110 l2 -4 l2 4 l-4 -2.5 h4 Z" fill="#fff" opacity=".9"/><path d="M14 118 Q10 96 30 98 L30 118 Z" fill="#f8c8d4" stroke="#d98aa0" stroke-width="2"/>`,
  );

export const COUNCIL_ROLES = Object.freeze([
  Object.freeze({ id: "chair", name: "의장", title: "코드 · 진행과 채점", voice: "토론하지 않고 기록해요" }),
  Object.freeze({ id: "author", name: "작가 봇", title: "그림책 작가 20년", voice: "반전은 아이가 먼저 알아차리게" }),
  Object.freeze({ id: "editor", name: "편집자 봇", title: "뼈대 점검표", voice: "바라는 것이 없으면 돌려보내요" }),
  Object.freeze({ id: "art", name: "그림 감독 봇", title: "그릴 수 있는가", voice: "반전은 펼침면 한 장으로" }),
  Object.freeze({ id: "reader", name: "독자 봇", title: "소리로만 듣는 아이", voice: "다음엔? 하고 묻고 싶은지" }),
]);
const AVATARS = Object.freeze({ chair, author, editor, art, reader });
/** The SVG for a role id ('' for an unknown role). */
export function councilAvatar(role) {
  const draw = AVATARS[role];
  return draw ? draw() : "";
}
export const councilRole = (id) => COUNCIL_ROLES.find((role) => role.id === id) || null;
