/*
 * 회의실 화면 (2026-10-20, R21). Draws the writers' room from a council
 * record: five seats with their avatars, who is speaking, what each one said
 * so far, the three pitches with the chair's scores, and the bible when it is
 * settled. The record comes from the running meeting's checkpoint (partial,
 * saved after every round) or from the finished outline, so the screen can
 * follow a live run and show the same room again later.
 */
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
  ["pitches", "피치"],
  ["verdicts", "판정"],
  ["bible", "바이블"],
  ["done", "확정"],
]);

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
const pitchTitle = (record, n) => str(record?.pitches?.[n - 1]?.title, 40) || `피치 ${n}`;
const chosenRow = (record) => list(record?.scores).find((row) => row.pitch === record?.chosen) || null;
/** What each seat says at this moment (one short line). */
export function seatLine(record, role) {
  const phase = record?.phase || "waiting",
    at = phaseIndex(phase),
    done = phase === "done";
  const v = record?.verdicts || {};
  if (role === "chair") {
    if (done || record?.chosen) {
      const row = chosenRow(record);
      return `피치 ${record.chosen} '${pitchTitle(record, record.chosen)}' 채택${row ? ` · 편집자 ${row.editor}/12 · 그림 ${row.art}/8 · 독자 ${row.reader}/4` : ""}${record.overrode ? " · 거부권을 넘어 택함" : ""}`;
    }
    if (phase === "verdicts") return "세 판정을 모아 채점표를 만들고 있어요.";
    return record?.direction ? `방향: ${str(record.direction, 120)}` : "방향과 조건을 모으고 있어요.";
  }
  if (role === "author") {
    if (done && record?.bible) return `바이블 '${str(record.bible.title, 40)}' 확정 · 심은 물건: ${str(record.bible.planted?.name, 30)}`;
    if (phase === "bible") return "지적을 반영해 바이블을 쓰고 있어요.";
    if (list(record?.pitches).length) return `피치: ${list(record.pitches).map((p) => str(p.title, 24)).join(" / ")}`;
    return phase === "pitches" ? "피치 세 개를 쓰고 있어요." : "방향을 기다려요.";
  }
  if (role === "editor") {
    const rows = list(v.editor).filter(Boolean);
    if (rows.length) {
      const pick = v.picks?.editor;
      const row = rows.find((r) => r.pitch === pick) || rows[0];
      const veto = rows.find((r) => r.veto);
      return `${pick ? `피치 ${pick} 추천` : "판정 끝"}${row?.fixes?.length ? ` · 고칠 점: ${str(row.fixes[0], 60)}` : ""}${veto ? ` · 피치 ${veto.pitch} 거부: ${str(veto.vetoReason, 40)}` : ""}`;
    }
    return at >= 1 && seatState(record, role) === "speaking" ? "점검표로 뼈대를 보고 있어요." : "점검표를 펴 두고 기다려요.";
  }
  if (role === "art") {
    const rows = list(v.art).filter(Boolean);
    if (rows.length) {
      const pick = v.picks?.art;
      const row = rows.find((r) => r.pitch === pick) || rows[0];
      const motifs = list(row?.motifs).map((m) => str(m.ko || m.en, 20)).filter(Boolean);
      return `${pick ? `피치 ${pick} 추천` : "판정 끝"}${motifs.length ? ` · 모티프: ${motifs.join(", ")}` : ""}${row?.veto ? ` · 거부: ${str(row.vetoReason, 40)}` : ""}`;
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
function seat(record, role, { compact }) {
  const meta = COUNCIL_ROLES.find((r) => r.id === role),
    state = seatState(record, role),
    age = role === "reader" && record?.reader?.age ? `<span class="seat-age">${esc(record.reader.age)}</span>` : "";
  return `<div class="council-seat seat-${role} state-${state}" data-role="${role}"><div class="seat-avatar">${councilAvatar(role)}${age}<span class="seat-state" aria-label="${STATE_LABEL[state]}">${state === "done" ? "✓" : state === "speaking" ? "…" : ""}</span></div><div class="seat-name">${esc(meta?.name || role)}</div>${compact ? "" : `<div class="seat-title">${esc(meta?.title || "")}</div>`}<div class="seat-bubble">${esc(seatLine(record, role))}</div></div>`;
}
function pitchCards(record) {
  const pitches = list(record?.pitches);
  if (!pitches.length) return "";
  return `<ol class="council-room-pitches">${pitches
    .map((p, i) => {
      const n = i + 1,
        row = list(record.scores).find((s) => s.pitch === n),
        chosen = record.chosen === n;
      return `<li class="${chosen ? "council-chosen" : row?.vetoes?.length ? "council-vetoed" : ""}"><strong>${chosen ? "✓ " : ""}${esc(str(p.title, 40))}</strong><span class="pitch-logline">${esc(str(p.logline, 120))}</span>${row ? `<span class="pitch-score">편집자 ${row.editor}/12 · 그림 ${row.art}/8 · 독자 ${row.reader}/4 · 합계 ${row.score}</span>${row.vetoes?.length ? `<span class="pitch-veto">거부: ${esc(row.vetoes.join(" / "))}</span>` : ""}` : `<span class="pitch-score">판정 기다리는 중</span>`}</li>`;
    })
    .join("")}</ol>`;
}
function phaseStrip(record) {
  const at = record?.phase === "waiting" ? -1 : phaseIndex(record?.phase),
    done = record?.phase === "done";
  return `<ol class="council-phases" aria-label="회의 진행">${COUNCIL_PHASES.map(([id, label], i) => `<li class="${done || i < at ? "done" : i === at ? "active" : ""}">${label}</li>`).join("")}</ol>`;
}
/** The room. `live` adds the pulsing seats; `compact` hides the role titles. */
export function renderCouncilRoom(record, { live = false, compact = false } = {}) {
  const r = object(record) ? record : emptyCouncilRecord();
  const seats = COUNCIL_ROLES.map((role) => seat(r, role.id, { compact })).join("");
  const bible = r.phase === "done" && object(r.bible)
    ? `<p class="council-room-bible"><strong>바이블</strong> 잃는 것: ${esc(str(r.bible.stakes, 80))} · 바닥: ${esc(str(r.bible.lowPoint, 80))} · 반전: ${esc(str(r.bible.turn?.seen, 60))} → “${esc(unquote(r.bible.turn?.realized))}”</p>`
    : "";
  return `<div class="council-room ${live ? "live" : ""} phase-${esc(r.phase || "waiting")}">${phaseStrip(r)}<div class="council-table">${seats}</div>${pitchCards(r)}${bible}</div>`;
}
/**
 * The ③ / status-window block for a job: a live room while the meeting runs
 * (an empty room before the first answer), a folded one once it is over, and
 * nothing for a draft without the policy.
 */
export function councilRoomBlock(job, { live = false, compact = false } = {}) {
  const record = liveCouncilRecord(job),
    policy = job?.input?.councilPolicy?.version === 1,
    pending = policy && !job?.demo && !job?.completed?.outline;
  if (!record && !(live && pending)) return "";
  const html = renderCouncilRoom(record || emptyCouncilRecord(job?.input), { live: live && (!record || record.phase !== "done"), compact });
  if (live) return `<div id="simple-council-room" class="council-room-wrap">${html}</div>`;
  const row = chosenRow(record);
  return `<details class="simple-council-details"><summary>회의실 다시 보기${record?.chosen ? ` · '${esc(pitchTitle(record, record.chosen))}' 채택${row ? ` · ${row.score}/12` : ""}` : ""}</summary><div class="council-room-wrap">${html}</div></details>`;
}
