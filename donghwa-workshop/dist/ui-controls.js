/* Presentation-only switches. The existing click/change handlers own state. */
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const copy = (id, label, description) => `<span class="setting-switch-copy"><span id="${esc(id)}-label" class="setting-switch-title">${esc(label)}</span>${description ? `<small id="${esc(id)}-help">${esc(description)}</small>` : ""}</span>`;
const track = '<span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>';
export function renderActionSwitch({ id, label, description = "", action, checked = false, disabled = false, className = "" }) {
  return `<div class="setting-switch-row ${esc(className)}">${copy(id, label, description)}<span class="switch-value">${checked ? "켜짐" : "꺼짐"}</span><button type="button" id="${esc(id)}" class="setting-switch" role="switch" aria-checked="${checked === true}" aria-labelledby="${esc(id)}-label"${description ? ` aria-describedby="${esc(id)}-help"` : ""} data-simple-action="${esc(action)}"${disabled ? " disabled" : ""}>${track}</button></div>`;
}
export function renderCheckboxSwitch({ id, label, description = "", checked = false, disabled = false, qualityFlag = "", className = "" }) {
  return `<label class="setting-switch-row ${esc(className)}" for="${esc(id)}">${copy(id, label, description)}<span class="switch-input-wrap"><input id="${esc(id)}" type="checkbox" role="switch" aria-labelledby="${esc(id)}-label"${description ? ` aria-describedby="${esc(id)}-help"` : ""}${qualityFlag ? ` data-quality-flag="${esc(qualityFlag)}"` : ""}${checked ? " checked" : ""}${disabled ? " disabled" : ""}>${track}</span></label>`;
}

/** Short, truthful storage status. This never changes cloud or library data. */
export function storageStatusView(status = {}, blocked = false) {
  if (blocked) return { label: "자료 보호 중", state: "attention" };
  if (status.phase === "choice") return { label: "클라우드 연결 선택", state: "attention" };
  if (["conflict", "account-changed"].includes(status.phase)) return { label: "변경 확인 필요", state: "attention" };
  if (status.reason === "quota") return { label: "클라우드 공간 부족", state: "attention" };
  if (!status.connected && !status.authenticated) return { label: "이 기기에 보관", state: "local" };
  if (["error", "unavailable"].includes(status.phase)) return { label: "동기화 확인 필요", state: "attention" };
  if (!status.connected) return { label: "이 기기에 보관", state: "local" };
  if (status.dirty || ["syncing", "paused", "checking"].includes(status.phase)) return { label: status.phase === "syncing" ? "동기화 중" : "클라우드 저장 대기", state: "pending" };
  const date = new Date(status.updatedAt);
  return { label: "클라우드 저장됨", state: "saved", time: status.updatedAt && Number.isFinite(date.getTime()) ? date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }) : "" };
}
