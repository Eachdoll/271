/*
 * 회의실 화면 (2026-10-20, R21). Draws the writers' room from a council
 * record: five seats with their avatars, who is speaking, what each one said
 * so far, the three pitches with the chair's scores, and the bible when it is
 * settled. The record comes from the running meeting's checkpoint (partial,
 * saved after every round) or from the finished outline, so the screen can
 * follow a live run and show the same room again later.
 */
import { tensionBars, angleLabel } from "./orchestration.js";
import { councilDecisionCosts, jobTextBudget } from "../text-generation/models.js";
import { COUNCIL_ROLES, councilAvatar } from "./council-avatars.js";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const str = (value, max = 160) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
/** A spoken line without the quotes the bots already wrapped it in. */
const unquote = (value) => str(value, 120).replace(/^["“'‘]+|["”'’]+$/gu, "");
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/gu, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
export const COUNCIL_PHASES = Object.freeze([
  ["pitches", "이야기 안"],
  ["verdicts", "검토"],
  // R22: shown only for a meeting the parent looked at ('회의 결과 보고 진행').
  ["review", "부모 선택"],
  ["bible", "설계서"],
  ["done", "확정"],
]);
/** R22: a meeting parked for the parent's choice (its checkpoint record). */
export const reviewPending = (record) => record?.phase === "review" && !record?.chosen;

/** The record to draw for a job: the finished outline's, else the live checkpoint's. */
export function liveCouncilRecord(job) {
  const final = job?.outline?.council;
  if (object(final) && final.chosen)
    return { ...final, bible: job.outline.bible || final.bible || null, phase: "done", roles: null };
  const partial = job?.councilCheckpoint?.record;
  return object(partial) ? partial : null;
}
/** Before the first answer: every seat waits, the chair holds the direction. */
export function emptyCouncilRecord(input = {}) {
  return {
    phase: "waiting",
    direction: str(input?.direction, 200),
    reader: { age: "" },
    pitches: [],
    scores: [],
    verdicts: null,
    chosen: null,
    bible: null,
    decisions: [],
    roles: { chair: "speaking", author: "waiting", editor: "waiting", art: "waiting", reader: "waiting" },
  };
}

const phaseIndex = (phase) => Math.max(0, COUNCIL_PHASES.findIndex(([id]) => id === phase));
/** Who is speaking: the record's role map when the meeting is live, else everyone is done. */
function seatState(record, role) {
  if (record?.phase === "done" || !object(record?.roles)) return "done";
  return record.roles[role] || "waiting";
}
const pitchTitle = (record, n) => str(record?.pitches?.[n - 1]?.title, 40) || `이야기 안 ${n}`;
const chosenRow = (record) => list(record?.scores).find((row) => row.pitch === record?.chosen) || null;
/** R22: how the pitch was settled, for the chair's line and the summary. */
const parentTag = (record) =>
  object(record?.parentChoice) ? (record.parentChoice.pick !== record.recommended ? " · 부모가 고름" : " · 부모 확인") : "";
/** What each seat says at this moment (one short line). */
export function seatLine(record, role) {
  const phase = record?.phase || "waiting",
    at = phaseIndex(phase),
    done = phase === "done";
  const v = record?.verdicts || {};
  if (role === "chair") {
    if (done || record?.chosen) {
      const row = chosenRow(record);
      return `이야기 안 ${record.chosen} '${pitchTitle(record, record.chosen)}' 채택${row ? ` · 편집자 ${row.editor}/12 · 그림 ${row.art}/8 · 독자 ${row.reader}/4` : ""}${record.overrode ? " · 검토 의견을 보고 부모가 선택" : ""}${parentTag(record)}`;
    }
    if (phase === "review" && record?.recommended)
      return `이야기 안 ${record.recommended} '${pitchTitle(record, record.recommended)}' 추천 · 부모님의 선택을 기다려요.`;
    if (phase === "verdicts") return "세 판정을 모아 채점표를 만들고 있어요.";
    return record?.direction ? `방향: ${str(record.direction, 120)}` : "방향과 조건을 모으고 있어요.";
  }
  if (role === "author") {
    if (done && record?.bible) return `설계서 '${str(record.bible.title, 40)}' 확정 · 심은 물건: ${str(record.bible.planted?.name, 30)}`;
    if (phase === "bible") return "지적을 반영해 설계서를 쓰고 있어요.";
    if (phase === "review") return "부모님이 고르면 고른 이야기로 설계서를 써요.";
    if (list(record?.pitches).length) return `이야기 안: ${list(record.pitches).map((p) => str(p.title, 24)).join(" / ")}`;
    return phase === "pitches" ? "이야기 안 세 개를 쓰고 있어요." : "방향을 기다려요.";
  }
  if (role === "editor") {
    const rows = list(v.editor).filter(Boolean);
    if (rows.length) {
      const pick = v.picks?.editor;
      const row = rows.find((r) => r.pitch === pick) || rows[0];
      const veto = rows.find((r) => r.veto);
      return `${pick ? `이야기 안 ${pick} 추천` : "판정 끝"}${row?.fixes?.length ? ` · 고칠 점: ${str(row.fixes[0], 60)}` : ""}${veto ? ` · 이야기 안 ${veto.pitch} 검토 필요: ${str(veto.vetoReason, 40)}` : ""}`;
    }
    return at >= 1 && seatState(record, role) === "speaking" ? "점검표로 뼈대를 보고 있어요." : "점검표를 펴 두고 기다려요.";
  }
  if (role === "art") {
    const rows = list(v.art).filter(Boolean);
    if (rows.length) {
      const pick = v.picks?.art;
      const row = rows.find((r) => r.pitch === pick) || rows[0];
      const motifs = list(row?.motifs).map((m) => str(m.ko || m.en, 20)).filter(Boolean);
      return `${pick ? `이야기 안 ${pick} 추천` : "판정 끝"}${motifs.length ? ` · 모티프: ${motifs.join(", ")}` : ""}${row?.veto ? ` · 검토 필요: ${str(row.vetoReason, 40)}` : ""}`;
    }
    return at >= 1 && seatState(record, role) === "speaking" ? "그릴 수 있는 반전인지 보고 있어요." : "펼침면을 떠올리며 기다려요.";
  }
  if (role === "reader") {
    const rows = list(v.reader).filter(Boolean);
    if (rows.length) {
      const fav = v.picks?.reader;
      const row = rows.find((r) => r.pitch === fav) || rows[0];
      return `${row?.retell ? `“${unquote(row.retell)}”` : "들었어요"}${row ? ` · 다음엔? ${"★".repeat(Math.max(0, Math.min(2, Number(row.nextQuestion) || 0)))}${"☆".repeat(2 - Math.max(0, Math.min(2, Number(row.nextQuestion) || 0)))}` : ""}${row?.scary ? ` · 무서운 데: ${str(row.scary, 30)}` : ""}`;
    }
    return at >= 1 && seatState(record, role) === "speaking" ? "눈을 크게 뜨고 듣고 있어요." : "이불을 안고 기다려요.";
  }
  return "";
}

const STATE_LABEL = Object.freeze({ waiting: "기다림", speaking: "말하는 중", done: "끝" });
function seat(record, role, { compact, terse = false }) {
  const meta = COUNCIL_ROLES.find((r) => r.id === role),
    state = seatState(record, role),
    age = role === "reader" && record?.reader?.age ? `<span class="seat-age">${esc(record.reader.age)}</span>` : "";
  return `<div class="council-seat seat-${role} state-${state}" data-role="${role}"><div class="seat-avatar">${councilAvatar(role)}${age}<span class="seat-state" aria-label="${STATE_LABEL[state]}">${state === "done" ? "✓" : state === "speaking" ? "…" : ""}</span></div><div class="seat-name">${esc(meta?.name || role)}</div>${compact ? "" : `<div class="seat-title">${esc(meta?.title || "")}</div>`}${terse ? "" : `<div class="seat-bubble">${esc(seatLine(record, role))}</div>`}</div>`;
}
function pitchCards(record) {
  const pitches = list(record?.pitches);
  if (!pitches.length) return "";
  return `<ol class="council-room-pitches">${pitches
    .map((p, i) => {
      const n = i + 1,
        row = list(record.scores).find((s) => s.pitch === n),
        chosen = record.chosen === n,
        // R22: the chair's recommendation while the parent looks, or when the parent chose another.
        recommended = record.recommended === n && (!record.chosen || record.chosen !== n);
      return `<li class="${chosen ? "council-chosen" : row?.vetoes?.length ? "council-vetoed" : ""}${recommended ? " council-recommended" : ""}"><strong>${chosen ? "✓ " : ""}${esc(str(p.title, 40))}${recommended ? ' <span class="pitch-tag">의장 추천</span>' : ""}</strong><span class="pitch-logline">${esc(str(p.logline, 120))}</span>${row ? `<span class="pitch-score">편집자 ${row.editor}/12 · 그림 ${row.art}/8 · 독자 ${row.reader}/4 · 합계 ${row.score}</span>${row.vetoes?.length ? `<span class="pitch-veto">거부: ${esc(row.vetoes.join(" / "))}</span>` : ""}` : `<span class="pitch-score">판정 기다리는 중</span>`}</li>`;
    })
    .join("")}</ol>`;
}
function phaseStrip(record) {
  const at = record?.phase === "waiting" ? -1 : phaseIndex(record?.phase),
    done = record?.phase === "done",
    // R22: the parent's step appears only in a meeting the parent looked at.
    reviewed = record?.phase === "review" || object(record?.parentChoice);
  return `<ol class="council-phases" aria-label="회의 진행">${COUNCIL_PHASES.map(([id, label], i) => ({ id, label, i }))
    .filter(({ id }) => id !== "review" || reviewed)
    .map(({ label, i }) => `<li class="${done || i < at ? "done" : i === at ? "active" : ""}"${!done && i === at ? ' aria-current="step"' : ""}>${label}</li>`)
    .join("")}</ol>`;
}
/** The room. `live` adds the pulsing seats; `compact` hides the role titles. */
export function renderCouncilRoom(record, { live = false, compact = false, hidePitches = false } = {}) {
  const r = object(record) ? record : emptyCouncilRecord();
  const choosing = reviewPending(r);
  const seats = COUNCIL_ROLES.map((role) => seat(r, role.id, { compact: compact || choosing, terse: choosing })).join("");
  const opinions = choosing ? `<details class="council-opinions"><summary>봇들의 검토 의견</summary>${COUNCIL_ROLES.map(role => `<p><strong>${esc(role.name)}</strong> ${esc(seatLine(r, role.id))}</p>`).join("")}</details>` : "";
  const progress = choosing ? "부모님의 선택을 기다려요. 받은 회의 결과는 보관돼 있어요." : r.phase === "done" ? "선택한 이야기와 회의 기록을 다시 볼 수 있어요." : "봇들이 이야기의 방향을 의논하고 있어요. 받은 답은 단계마다 보관돼요.";
  const bible = r.phase === "done" && object(r.bible)
    ? `<p class="council-room-bible"><strong>이야기 설계서</strong> 잃는 것: ${esc(str(r.bible.stakes, 80))} · 가장 어려운 순간: ${esc(str(r.bible.lowPoint, 80))} · 반전: ${esc(str(r.bible.turn?.seen, 60))} → “${esc(unquote(r.bible.turn?.realized))}”</p>`
    : "";
  return `<div class="council-room ${live ? "live" : ""} phase-${esc(r.phase || "waiting")}">${phaseStrip(r)}<p class="council-progress-label">${progress}</p><div class="council-table">${seats}</div>${opinions}${choosing || hidePitches ? "" : pitchCards(r)}${bible}</div>`;
}
/**
 * The ③ / status-window block for a job: a live room while the meeting runs
 * (an empty room before the first answer), a folded one once it is over, and
 * nothing for a draft without the policy.
 */
export function councilRoomBlock(job, { live = false, compact = false, open = false } = {}) {
  const record = liveCouncilRecord(job),
    policy = job?.input?.councilPolicy?.version === 1,
    pending = policy && !job?.demo && !job?.completed?.outline;
  if (!record && !(live && pending)) return "";
  const html = renderCouncilRoom(record || emptyCouncilRecord(job?.input), { live: live && (!record || record.phase !== "done"), compact });
  if (live) return `<div id="simple-council-room" class="council-room-wrap">${html}</div>`;
  // R22: the parked meeting stays open while the parent chooses.
  if (open) return `<div class="council-room-wrap">${html}</div>`;
  const row = chosenRow(record);
  return `<details class="simple-council-details"><summary>회의실 다시 보기${record?.chosen ? ` · '${esc(pitchTitle(record, record.chosen))}' 채택${row ? ` · ${row.score}/12` : ""}${parentTag(record)}` : ""}</summary><div class="council-room-wrap">${html}</div></details>`;
}

/* ---------- R22 회의 결과 보고 진행: the parent's choice ---------- */
/**
 * The choice form for a parked meeting: one radio per pitch (the chair's
 * recommendation checked), a note for the author bot, and a folded field to
 * rewrite the direction for a new meeting. The caller adds its own buttons
 * (계속 · 방향 고쳐 다시 회의) and reads the form with readCouncilChoice /
 * readCouncilDirection. `fee` is the caller's price line for a new meeting.
 */
export function renderCouncilReviewForm(record, { direction = "", fee = "" } = {}) {
  const r = object(record) ? record : {}, pitches = list(r.pitches), recommended = r.recommended || 1;
  if (!pitches.length) return "";
  const picks = pitches.map((p, i) => {
    const n = i + 1, row = list(r.scores).find(s => s.pitch === n);
    return `<div class="council-pick-option"><label class="council-pick${n === recommended ? " council-recommended" : ""}"><input type="radio" name="council-pick" value="${n}" data-pitch-title="${esc(str(p.title, 40))}" ${n === recommended ? "checked" : ""}><span class="council-pick-body"><strong>${esc(str(p.title, 40))}${p.angle ? ` <span class="pitch-tag pitch-angle">${esc(angleLabel(p.angle))}</span>` : ""}${n === recommended ? ' <span class="pitch-tag">의장 추천</span>' : ""}</strong><span class="pitch-logline">${esc(str(p.logline, 160))}</span>${p.turn?.seen ? `<span class="pitch-turn">반전: ${esc(str(p.turn.seen, 80))} → “${esc(unquote(p.turn.realized))}”</span>` : ""}${list(p.tension).length ? `<span class="pitch-tension" aria-label="비트별 긴장도 ${esc(list(p.tension).join(", "))}"><span aria-hidden="true">긴장 ${tensionBars(p.tension)}</span></span>` : ""}</span></label>${row ? `<details class="pitch-review-details"><summary>점수·검토 의견</summary><p>편집자 ${row.editor}/12 · 그림 ${row.art}/8 · 독자 ${row.reader}/4 · 합계 ${row.score}${row.vetoes?.length ? `<br>검토 필요: ${esc(row.vetoes.join(" / "))}` : ""}</p></details>` : ""}</div>`;
  }).join("");
  return `<div class="council-review" id="council-review"><h4 id="council-choice-heading" tabindex="-1">어떤 이야기로 이어 갈까요?</h4><p class="council-review-intro">추천한 안을 쓰거나 다른 이야기를 골라 주세요.</p>${r.design?.growth ? `<p class="council-design">성장 설계 · ${esc(str(r.design.growth.want, 80))} → ${esc(str(r.design.growth.need, 80))} <small>(걸림돌: ${esc(str(r.design.growth.flaw, 60))})</small></p>` : ""}<fieldset class="council-review-picks"><legend>이야기 안 선택</legend>${picks}</fieldset><div class="field"><label for="council-note">작가 봇에게 한마디 (선택)</label><textarea id="council-note" maxlength="300" rows="2" placeholder="예: 토토가 더 많이 나오게, 가장 어려운 장면은 덜 무섭게"></textarea></div><details class="council-redirect"><summary>방향을 고쳐 다시 회의하기</summary><div class="field"><label for="council-direction">새 방향 한 줄</label><input id="council-direction" maxlength="200" value="${esc(str(direction, 200))}" placeholder="예: 친구의 작은 도움이 반전이 되는 이야기"></div><p class="small-label">다시 회의하면 지금 이야기 안 대신 새 안을 만들어요${fee ? ` · 추가 예상 ${esc(fee)}` : ""}.</p></details></div>`;
}
let choiceFeedbackBound = false;
/** Update only the selection summary; never redraw a parent's typed note. */
export function bindCouncilChoiceFeedback() {
  if (choiceFeedbackBound || typeof document === "undefined") return;
  choiceFeedbackBound = true;
  const updateKeyboardInset = () => {
    const viewport = globalThis.visualViewport;
    const inset = viewport ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop) : 0;
    document.documentElement.style.setProperty("--keyboard-inset", `${inset}px`);
    document.documentElement.classList.toggle("council-keyboard-open", inset > 100 && !!document.querySelector(".council-choice-actions"));
  };
  globalThis.visualViewport?.addEventListener?.("resize", updateKeyboardInset);
  globalThis.visualViewport?.addEventListener?.("scroll", updateKeyboardInset);
  document.addEventListener("change", event => {
    if (!event.target?.matches?.('input[name="council-pick"]')) return;
    for (const label of document.querySelectorAll("[data-council-selected-title]")) label.textContent = event.target.dataset.pitchTitle || `이야기 안 ${event.target.value}`;
  });
}
/** The pick and the note from the form (null when no form is on the page). */
export function readCouncilChoice(root = globalThis.document) {
  const checked = root?.querySelector?.('input[name="council-pick"]:checked');
  if (!checked) return null;
  return { pick: Math.round(Number(checked.value)) || 1, note: str(root.querySelector?.("#council-note")?.value, 300) };
}
/** The rewritten direction from the form ("" when empty or absent). */
export function readCouncilDirection(root = globalThis.document) {
  return str(root?.querySelector?.("#council-direction")?.value, 200);
}

/**
 * R24: one money format for every text budget on screen — '$0.42' (three
 * decimals under ten cents), '아직 없음' for nothing spent yet, and the R13
 * wording when a model outside the catalog leaves part of it unpriced.
 */
export function budgetUsd(value, unknown = false, { empty = "" } = {}) {
  const n = Math.max(0, Number(value) || 0),
    text = n <= 0 ? "$0" : "$" + n.toFixed(n < 0.1 ? 3 : 2);
  if (unknown) return n > 0 ? `약 ${text} · 일부 요금 미확인` : "요금 정보 없음";
  if (n <= 0 && empty) return empty;
  return `약 ${text}`;
}
/** R24: '쓴 금액 · 남은 예상' for a job, from the same jobTextBudget as the meeting panel. */
export function jobBudgetSummary(job) {
  const b = jobTextBudget(job);
  return `쓴 금액 ${budgetUsd(b.usedUsd, b.usedUnknown, { empty: "아직 없음" })} · 남은 예상 ${budgetUsd(b.remainingUsd, b.remainingUnknown, { empty: "없음" })}`;
}
/** Separate prior estimated usage from each upcoming action. */
export function renderCouncilBudget(job) {
  const c = councilDecisionCosts(job);
  return `<div class="council-budget"><span>지금까지 쓴 글 요금 <strong>${budgetUsd(c.usedUsd, c.usedUnknown, { empty: "아직 없음" })}</strong></span><span>이 안으로 글 끝까지 <strong>${budgetUsd(c.continueUsd, c.continueUnknown)}</strong></span><span>다시 회의하면 더 <strong>${budgetUsd(c.meetingUsd, c.meetingUnknown)}</strong></span><small>받은 회의 답은 다시 사지 않아요. 공급자 실제 청구액과 다를 수 있고 그림 요금은 별도예요.</small></div>`;
}
