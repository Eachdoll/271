/**
 * Family ID screens: the account rows shown in settings and the cloud panel,
 * the sign-in modal (로그인 / 계정 만들기 / 비밀번호를 잊었어요), the one-time
 * recovery code screen, and the password and delete dialogs.
 *
 * Renderers are pure (status in, HTML out) so tests can count buttons. All
 * account work goes through cloud-sync.js; passwords and recovery codes stay
 * in this page's memory and are never written to storage, URLs or toasts.
 */
import {
  FAMILY_MESSAGES,
  accountLabel,
  isFamilyUser,
  normalizeUsername,
} from "./family-auth.js";

const DEFAULT_SIGN_IN = "/signin-with-chatgpt?return_to=%2F";
const CHATGPT_SIGN_OUT = "/signout-with-chatgpt?return_to=%2F";
export const LOCAL_ONLY_NOTE =
  "클라우드와 연결을 끊고 이 기기의 책만 써요. 나중에 다시 로그인하면 어느 쪽 자료를 쓸지 고를 수 있어요.";
export const SIGNED_OUT_NOTE =
  "같은 가족 아이디나 ChatGPT 계정으로 로그인하면 재료·시트·책·그림을 여러 기기에서 이어 쓸 수 있어요.";
const NEW_PASSWORD_HINT =
  "영문·숫자·기호로 10자 이상이에요. 아이디는 넣지 말아 주세요.";
const TABS = [
  ["login", "로그인"],
  ["signup", "계정 만들기"],
  ["recover", "비밀번호를 잊었어요"],
];
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );

let api = {};
/**
 * getSync() → the cloud sync object, getStatus() → its last status,
 * showModal(html, cls), closeModal(), modalHeader(title), toast(message),
 * onSignedIn(user) after a successful sign-in, and optional window/document.
 */
export function configureFamilyAuthUI(options = {}) {
  api = options;
}
const win = () => api.window || globalThis.window;
const doc = () => api.document || globalThis.document;

export function signInPathOf(status) {
  const path = status?.signInPath;
  return typeof path === "string" &&
    /^\/(?!\/)/.test(path) &&
    !/[\\\x00-\x1f\x7f]/.test(path)
    ? path
    : DEFAULT_SIGN_IN;
}

/** '로그인: <displayName or username> (가족 아이디 <username>)', or the ChatGPT label as before. */
export function accountLine(user) {
  if (!user) return "";
  return isFamilyUser(user)
    ? `로그인: ${accountLabel(user)} (가족 아이디 ${user.username || ""})`
    : `로그인: ${accountLabel(user)}`;
}

export function signedOutNote(status) {
  return status?.reason === "family-session-expired"
    ? FAMILY_MESSAGES.sessionExpired
    : SIGNED_OUT_NOTE;
}

const chatGptLink = (status) =>
  `<a class="family-chatgpt-link" href="${esc(signInPathOf(status))}" target="_top" data-action="chatgpt-signin">ChatGPT로 로그인</a>`;

/** Signed out: family login first, family sign-up second, ChatGPT as a small link. */
export function renderSignedOutChoices(status) {
  return `<div class="family-signin-choices"><div class="family-signin-buttons"><button type="button" class="btn btn-green" data-action="family-login">가족 아이디로 로그인</button><button type="button" class="btn btn-outline" data-action="family-signup">가족 계정 만들기</button></div>${chatGptLink(status)}</div>`;
}

/** Signed in (cloud panel): sign-out plus, for family accounts, a folded management section. */
export function renderCloudAccountControls(status) {
  const user = status?.authenticated ? status.user : null;
  if (!user) return "";
  if (isFamilyUser(user))
    return `<div class="family-account-actions"><button type="button" class="btn btn-outline btn-small" data-action="family-logout">로그아웃</button></div><details class="family-manage"><summary>가족 계정 관리</summary><p class="small-label">비밀번호를 바꾸거나 가족 계정을 지울 수 있어요. 이 기기의 책은 그대로 있어요.</p><div class="family-manage-actions"><button type="button" class="btn btn-outline btn-small" data-action="family-password">비밀번호 바꾸기</button><button type="button" class="btn btn-plain btn-small family-danger" data-action="family-delete">가족 계정 삭제</button></div></details>`;
  return `<div class="family-account-actions"><a href="${CHATGPT_SIGN_OUT}" target="_top" class="small-label" data-action="chatgpt-signout">ChatGPT 로그아웃 · 다른 계정으로 연결</a><button type="button" class="btn btn-plain btn-small" data-action="family-migrate">가족 아이디로 옮기기</button></div>`;
}

/** Simple settings '보관' group: one line and at most two buttons for each sign-in state. */
export function renderSimpleAccountRow(status) {
  const user = status?.authenticated ? status.user : null;
  let line, actions, extra = "";
  if (!user) {
    line =
      status?.reason === "family-session-expired"
        ? FAMILY_MESSAGES.sessionExpired
        : "로그인하면 PC·모바일에서 같은 책장을 이어 써요.";
    actions =
      '<button type="button" class="btn btn-green" data-action="family-login">가족 아이디로 로그인</button><button type="button" class="btn btn-outline" data-action="family-signup">가족 계정 만들기</button>';
    extra = chatGptLink(status);
  } else if (isFamilyUser(user)) {
    line = accountLine(user);
    actions =
      '<button type="button" class="btn btn-outline" data-action="family-logout">로그아웃</button><button type="button" class="btn btn-outline" data-action="cloud-open">클라우드 관리</button>';
  } else {
    line = accountLine(user) + " · ChatGPT 계정";
    actions =
      '<button type="button" class="btn btn-outline" data-action="family-migrate">가족 아이디로 옮기기</button><button type="button" class="btn btn-outline" data-action="cloud-open">클라우드 관리</button>';
  }
  return `<div class="simple-account-row" id="simple-account-row"><p class="small-label">${esc(line)}</p><div class="simple-backup-actions">${actions}</div>${extra}</div>`;
}

/** Locked device: use this device's books without the cloud (after the parent PIN). */
export function renderLocalOnlyEscape() {
  return `<div class="family-local-escape"><button type="button" class="btn btn-outline" data-action="cloud-continue-local">이 기기 자료로 계속 쓰기</button><p class="small-label">${LOCAL_ONLY_NOTE}</p></div>`;
}

const plainHeader = (title) =>
  `<div class="modal-header"><h3>${esc(title)}</h3></div>`;
const header = (title) =>
  typeof api.modalHeader === "function"
    ? api.modalHeader(esc(title))
    : `<div class="modal-header"><h3>${esc(title)}</h3><button type="button" class="close-btn" data-action="close-modal" aria-label="닫기">×</button></div>`;
const field = (id, label, input, after = "") =>
  `<div class="field family-field"><label for="${id}">${label}</label>${input}${after}</div>`;
const usernameInput = (value) =>
  `<input id="family-username" name="username" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="latin" maxlength="40" required value="${esc(value)}">`;
const passwordInput = (id, autocomplete) =>
  `<input id="${id}" name="${id === "family-current-password" ? "current-password" : "password"}" type="password" autocomplete="${autocomplete}" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="128" required>`;
const showPassword =
  '<label class="family-check family-show-password"><input type="checkbox" data-family-show-password> 비밀번호 보기</label>';
const errorSlot =
  '<p id="family-auth-error" class="text-error family-auth-error" role="alert"></p>';

/** The sign-in modal body for one tab (a real form; the password never leaves this page). */
export function renderFamilyAuthForm(
  tab = "login",
  { username = "", notice = "", title = "가족 아이디" } = {},
) {
  const current = TABS.some(([id]) => id === tab) ? tab : "login";
  const canonical = normalizeUsername(username);
  const intro = {
    login: "가족 아이디로 로그인하면 이 계정의 책장을 PC·모바일에서 함께 써요.",
    signup:
      "가족이 함께 쓸 아이디를 만들어요. 사이트 관리자에게 받은 가족 초대 코드가 필요해요.",
    recover:
      "계정을 만들 때 받은 복구 코드로 새 비밀번호를 정해요. 다른 기기는 모두 로그아웃돼요.",
  }[current];
  const tabs = `<div class="family-auth-tabs" role="tablist" aria-label="가족 아이디">${TABS.map(([id, label]) => `<button type="button" role="tab" class="family-auth-tab" id="family-tab-${id}" aria-selected="${id === current}" data-family-tab="${id}">${label}</button>`).join("")}</div>`;
  const preview = `<p class="family-username-preview" id="family-username-preview" aria-live="polite">${canonical ? "아이디: " + esc(canonical) : ""}</p>`;
  const parts = [field("family-username", "가족 아이디", usernameInput(username), preview)];
  if (current === "signup")
    parts.push(
      field(
        "family-display-name",
        "가족 이름 (선택)",
        '<input id="family-display-name" name="nickname" type="text" autocomplete="nickname" maxlength="20" placeholder="예: 유하네">',
      ),
    );
  if (current === "recover")
    parts.push(
      field(
        "family-recovery-input",
        "복구 코드",
        '<input id="family-recovery-input" class="family-code-input" name="one-time-code" type="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="40" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" required>',
      ),
    );
  parts.push(
    field(
      "family-password",
      current === "login" ? "비밀번호" : "새 비밀번호",
      passwordInput(
        "family-password",
        current === "login" ? "current-password" : "new-password",
      ),
      current === "login"
        ? ""
        : `<p class="small-label">${NEW_PASSWORD_HINT}</p>`,
    ),
    showPassword,
  );
  if (current === "signup")
    parts.push(
      field(
        "family-invite",
        "가족 초대 코드",
        '<input id="family-invite" name="invite" type="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="200" required>',
      ),
    );
  const submit = {
    login: "로그인",
    signup: "가족 계정 만들기",
    recover: "새 비밀번호로 바꾸기",
  }[current];
  return `${header(title)}${tabs}<form id="family-auth-form" class="family-auth-form" data-family-form="${current}" novalidate><p class="modal-intro">${intro}</p>${notice ? `<div class="notice">${esc(notice)}</div>` : ""}${parts.join("")}${errorSlot}<div id="family-auth-hint" class="family-auth-hint"></div><div class="modal-actions"><button type="submit" class="btn btn-primary" id="family-auth-submit">${submit}</button></div></form>`;
}

/** Shown once after sign-up or recovery: large grouped code, three ways to keep it, and a check gating 계속. */
export function renderRecoveryCode(code, { message = "" } = {}) {
  return `${plainHeader("복구 코드를 적어 두세요")}<div data-modal-lock hidden></div>${message ? `<p class="text-error" role="alert">${esc(message)}</p>` : ""}<p class="modal-intro">비밀번호를 잊었을 때 이 복구 코드로 새 비밀번호를 만들어요. 이 화면을 닫으면 다시 볼 수 없어요.</p><p class="family-recovery-code" id="family-recovery-code" translate="no" lang="en">${esc(code)}</p><div class="family-recovery-actions"><button type="button" class="btn btn-outline" data-family-recovery="copy">복사</button><button type="button" class="btn btn-outline" data-family-recovery="download">텍스트 파일로 저장</button><button type="button" class="btn btn-outline" data-family-recovery="print">인쇄</button></div><p id="family-recovery-status" class="small-label" role="status"></p><label class="family-check"><input type="checkbox" id="family-recovery-saved"> 안전한 곳에 적어 두었어요</label><div class="modal-actions"><button type="button" class="btn btn-primary" id="family-recovery-done" disabled>계속</button></div>`;
}

const hiddenUsername = (username) =>
  `<input type="text" name="username" autocomplete="username" value="${esc(username)}" hidden readonly>`;

export function renderPasswordForm(session) {
  return `${header("비밀번호 바꾸기")}<form id="family-password-form" class="family-auth-form" novalidate>${hiddenUsername(session.username)}<p class="modal-intro">가족 아이디 ${esc(session.username)}의 비밀번호를 바꿔요. 책은 각 기기에 그대로 있어요.</p>${field("family-current-password", "지금 비밀번호", passwordInput("family-current-password", "current-password"))}${field("family-password", "새 비밀번호", passwordInput("family-password", "new-password"), `<p class="small-label">${NEW_PASSWORD_HINT}</p>`)}${showPassword}<label class="family-check"><input type="checkbox" id="family-signout-others"> 다른 기기도 모두 로그아웃</label><p class="small-label">로그아웃한 기기는 새 비밀번호로 다시 로그인하면 돼요.</p>${errorSlot}<div class="modal-actions"><button type="button" class="btn btn-outline" data-action="close-modal">취소</button><button type="submit" class="btn btn-primary" id="family-auth-submit">비밀번호 바꾸기</button></div></form>`;
}

export function renderDeleteForm(session) {
  return `${header("가족 계정 삭제")}<form id="family-delete-form" class="family-auth-form" novalidate>${hiddenUsername(session.username)}<p class="modal-intro">가족 아이디 ${esc(session.username)}와 클라우드에 보관한 책·그림을 모두 지워요. 되돌릴 수 없어요.</p><div class="notice">이 기기의 책은 그대로 남아요. 다른 기기에 있는 책도 그 기기에 남아요.</div>${field("family-delete-password", "비밀번호", passwordInput("family-delete-password", "current-password"))}${showPassword}${field("family-delete-confirm", "확인을 위해 ‘삭제’라고 적어 주세요", '<input id="family-delete-confirm" type="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="10" required>')}${errorSlot}<div class="modal-actions"><button type="button" class="btn btn-outline" data-action="close-modal">취소</button><button type="submit" class="btn btn-primary family-danger-button" id="family-auth-submit" disabled>가족 계정 삭제</button></div></form>`;
}

export function renderFramedNotice(title = "가족 아이디") {
  return `${header(title)}<p class="modal-intro">보안을 위해 로그인과 계정 관리는 동화공방을 새 창으로 열었을 때만 할 수 있어요.</p><div class="modal-actions"><a class="btn btn-primary" href="./" target="_blank" rel="noopener">새 창에서 열기</a></div>`;
}

/** Sign-in forms never render inside a frame (clickjacking). */
export function isFramed(target = win()) {
  try {
    return !!target && target.top !== target.self;
  } catch {
    return true;
  }
}

function wireShowPassword(form) {
  const toggle = form.querySelector("[data-family-show-password]");
  if (toggle)
    toggle.onchange = () =>
      form
        .querySelectorAll('input[type="password"],input[data-family-secret]')
        .forEach((input) => {
          input.setAttribute("data-family-secret", "");
          input.type = toggle.checked ? "text" : "password";
        });
}
function focusSoon(selector) {
  const later = win()?.requestAnimationFrame?.bind(win()) || ((fn) => fn());
  later(() => later(() => doc()?.querySelector(selector)?.focus()));
}
/** Disables the form while the slow password step runs and keeps Escape from closing it. */
function setPending(form, pending, label) {
  const submit = form.querySelector("#family-auth-submit"),
    close = form
      .closest(".modal")
      ?.querySelector('.modal-header [data-action="close-modal"]');
  if (close) close.disabled = pending;
  if (pending) {
    form.dataset.pending = "1";
    form.setAttribute("data-modal-lock", "");
    if (submit) {
      submit.dataset.label = submit.textContent;
      submit.disabled = true;
      submit.textContent = "확인 중…";
    }
  } else {
    delete form.dataset.pending;
    form.removeAttribute("data-modal-lock");
    if (submit) {
      submit.disabled = false;
      submit.textContent = label || submit.dataset.label || submit.textContent;
    }
  }
}
const syncOrNull = () => api.getSync?.() || null;
const notReady = "클라우드 연결을 준비하고 있어요. 잠시 뒤 다시 해 주세요.";

/** Opens the sign-in modal on a tab: 'login', 'signup' or 'recover'. */
export function openFamilyAuth(tab = "login", options = {}) {
  if (isFramed()) {
    api.showModal(renderFramedNotice(), "family-auth");
    return;
  }
  const remembered = syncOrNull()?.getFamilySession?.()?.username || "";
  const username = options.username ?? remembered;
  api.showModal(
    renderFamilyAuthForm(tab, { username, notice: options.notice || "" }),
    "family-auth",
  );
  const form = doc().querySelector("#family-auth-form");
  if (!form) return;
  const current = form.dataset.familyForm;
  const nameInput = form.querySelector("#family-username"),
    preview = form.querySelector("#family-username-preview");
  nameInput.addEventListener("input", () => {
    const canonical = normalizeUsername(nameInput.value);
    preview.textContent = canonical ? "아이디: " + canonical : "";
  });
  wireShowPassword(form);
  const switchTab = (next) =>
    openFamilyAuth(next, { username: nameInput.value, notice: options.notice });
  doc()
    .querySelectorAll("[data-family-tab]")
    .forEach((button) => {
      button.onclick = () => switchTab(button.dataset.familyTab);
    });
  focusSoon(username ? "#family-password" : "#family-username");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.pending) return;
    const error = form.querySelector("#family-auth-error"),
      hint = form.querySelector("#family-auth-hint"),
      sync = syncOrNull();
    error.textContent = "";
    hint.innerHTML = "";
    if (!sync) {
      error.textContent = notReady;
      return;
    }
    const value = (selector) => form.querySelector(selector)?.value ?? "";
    const username = value("#family-username"),
      password = value("#family-password");
    setPending(form, true);
    let result;
    try {
      result =
        current === "signup"
          ? await sync.familySignup({
              username,
              password,
              inviteCode: value("#family-invite"),
              displayName: value("#family-display-name"),
            })
          : current === "recover"
            ? await sync.familyRecover({
                username,
                recoveryCode: value("#family-recovery-input"),
                newPassword: password,
              })
            : await sync.familyLogin({ username, password });
    } catch {
      result = {
        ok: false,
        code: "failed",
        message: "요청을 완료하지 못했어요. 잠시 뒤 다시 해 주세요.",
      };
    }
    if (result.recoveryCode) {
      // Even if the modal was closed meanwhile, the one-time code must be shown.
      showRecoveryCode(result.recoveryCode, {
        username: result.user?.username || normalizeUsername(username),
        user: result.ok ? result.user : null,
        message: result.ok ? "" : result.message,
      });
      return;
    }
    if (result.ok) {
      // closeModal() runs app-wide cleanups: only for this form, never for a modal opened since.
      if (form.isConnected) api.closeModal();
      api.toast?.("가족 아이디로 로그인했어요.");
      api.onSignedIn?.(result.user);
      return;
    }
    if (!form.isConnected) {
      api.toast?.(result.message);
      return;
    }
    setPending(form, false);
    error.textContent = result.message;
    if (result.code === "username_taken") {
      hint.innerHTML =
        '<button type="button" class="btn btn-plain btn-small" data-family-tab="login">이 아이디로 로그인하기</button>';
      hint.querySelector("button").onclick = () => switchTab("login");
    }
  });
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" }),
    url = URL.createObjectURL(blob),
    link = doc().createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  doc().body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const recoveryText = (code, username) =>
  `동화공방 가족 아이디 복구 코드\n\n아이디: ${username}\n복구 코드: ${code}\n\n비밀번호를 잊었을 때 ‘비밀번호를 잊었어요’에서 이 코드를 넣어요.\n한 번 쓰면 새 복구 코드로 바뀌어요. 다른 사람에게 보여 주지 마세요.\n`;
function printRecovery(code, username) {
  const tab = win()?.open?.("", "_blank");
  if (!tab) return false;
  try {
    tab.opener = null;
    tab.document.open();
    tab.document.write(
      `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>동화공방 복구 코드</title><style>body{font-family:sans-serif;padding:32px;color:#222}code{display:block;font-size:28px;letter-spacing:2px;margin:24px 0}@media print{button{display:none}}</style></head><body><h1>동화공방 가족 아이디 복구 코드</h1><p>아이디: ${esc(username)}</p><code>${esc(code)}</code><p>비밀번호를 잊었을 때 이 코드로 새 비밀번호를 만들어요. 한 번 쓰면 새 코드로 바뀌어요.</p><button type="button" onclick="window.print()">인쇄</button></body></html>`,
    );
    tab.document.close();
    tab.focus();
    tab.print?.();
    return true;
  } catch {
    tab.close?.();
    return false;
  }
}

function showRecoveryCode(code, { username, user, message }) {
  api.showModal(
    renderRecoveryCode(code, { message }),
    "family-auth family-recovery",
  );
  const root = doc(),
    status = root.querySelector("#family-recovery-status"),
    saved = root.querySelector("#family-recovery-saved"),
    done = root.querySelector("#family-recovery-done");
  const say = (text) => {
    if (status) status.textContent = text;
  };
  root.querySelectorAll("[data-family-recovery]").forEach((button) => {
    button.onclick = async () => {
      const kind = button.dataset.familyRecovery;
      if (kind === "copy") {
        try {
          await win().navigator.clipboard.writeText(code);
          say("복사했어요. 메모장 같은 안전한 곳에 붙여 넣어 두세요.");
        } catch {
          say("복사하지 못했어요. 화면의 코드를 직접 적어 주세요.");
        }
      } else if (kind === "download") {
        try {
          downloadText(recoveryText(code, username), "donghwa-recovery-code.txt");
          say("텍스트 파일로 저장했어요.");
        } catch {
          say("파일로 저장하지 못했어요. 화면의 코드를 직접 적어 주세요.");
        }
      } else if (kind === "print")
        say(
          printRecovery(code, username)
            ? "인쇄 창을 열었어요."
            : "인쇄 창을 열지 못했어요. 팝업 차단을 확인하거나 코드를 직접 적어 주세요.",
        );
    };
  });
  saved.onchange = () => {
    done.disabled = !saved.checked;
  };
  done.onclick = () => {
    if (!saved.checked) return;
    api.closeModal();
    if (user) {
      api.toast?.("가족 아이디로 로그인했어요.");
      api.onSignedIn?.(user);
    }
  };
}

/** Signs out of the family account (the caller has already checked parent mode). */
export async function familyLogoutAction() {
  const sync = syncOrNull();
  if (!sync) return api.toast?.(notReady);
  const result = await sync.familyLogout();
  api.toast?.(
    result.ok
      ? "로그아웃했어요. 이 기기의 책은 그대로 있어요."
      : result.message,
  );
  return result;
}

function sessionOrToast() {
  const session = syncOrNull()?.getFamilySession?.();
  if (!session) api.toast?.(FAMILY_MESSAGES.familyOnly);
  return session || null;
}

export function openFamilyPassword() {
  if (isFramed()) return api.showModal(renderFramedNotice("비밀번호 바꾸기"), "family-auth");
  const session = sessionOrToast();
  if (!session) return;
  api.showModal(renderPasswordForm(session), "family-auth");
  const form = doc().querySelector("#family-password-form");
  wireShowPassword(form);
  focusSoon("#family-current-password");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.pending) return;
    const error = form.querySelector("#family-auth-error"),
      sync = syncOrNull();
    error.textContent = "";
    if (!sync) return (error.textContent = notReady);
    setPending(form, true);
    let result;
    try {
      result = await sync.familyChangePassword({
        currentPassword: form.querySelector("#family-current-password").value,
        newPassword: form.querySelector("#family-password").value,
        signOutOthers: form.querySelector("#family-signout-others").checked,
      });
    } catch {
      result = { ok: false, message: "요청을 완료하지 못했어요." };
    }
    if (result.ok) {
      if (form.isConnected) api.closeModal();
      api.toast?.("비밀번호를 바꿨어요.");
      return;
    }
    if (!form.isConnected) return api.toast?.(result.message);
    setPending(form, false);
    error.textContent = result.message;
  });
}

export function openFamilyDelete() {
  if (isFramed()) return api.showModal(renderFramedNotice("가족 계정 삭제"), "family-auth");
  const session = sessionOrToast();
  if (!session) return;
  api.showModal(renderDeleteForm(session), "family-auth");
  const form = doc().querySelector("#family-delete-form"),
    confirmInput = form.querySelector("#family-delete-confirm"),
    submit = form.querySelector("#family-auth-submit");
  wireShowPassword(form);
  confirmInput.addEventListener("input", () => {
    if (!form.dataset.pending)
      submit.disabled = confirmInput.value.trim() !== "삭제";
  });
  focusSoon("#family-delete-password");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.pending || confirmInput.value.trim() !== "삭제") return;
    const error = form.querySelector("#family-auth-error"),
      sync = syncOrNull();
    error.textContent = "";
    if (!sync) return (error.textContent = notReady);
    setPending(form, true);
    let result;
    try {
      result = await sync.familyDeleteAccount({
        password: form.querySelector("#family-delete-password").value,
        confirm: confirmInput.value,
      });
    } catch {
      result = { ok: false, message: "요청을 완료하지 못했어요." };
    }
    if (result.ok) {
      if (form.isConnected) api.closeModal();
      api.toast?.("가족 계정을 삭제했어요. 이 기기의 책은 그대로 있어요.");
      return;
    }
    if (!form.isConnected) return api.toast?.(result.message);
    setPending(form, false);
    error.textContent = result.message;
  });
}

/**
 * ChatGPT sign-in/out links: refused while FULL AUTO runs in any tab. Signing
 * in with ChatGPT also drops a stored family session, which the server would
 * otherwise keep preferring over the ChatGPT account.
 */
export async function followChatGptLink(event, link) {
  event?.preventDefault?.();
  const href = link?.getAttribute?.("href") || DEFAULT_SIGN_IN;
  if (!/^\/(?!\/)/.test(href)) return;
  const sync = syncOrNull();
  const check = (await sync?.checkAccountSwitch?.()) || { ok: true };
  if (!check.ok) return api.toast?.(check.message);
  if (link?.dataset?.action === "chatgpt-signin" && sync?.getFamilySession?.()) {
    const result = await sync.familyLogout();
    if (!result.ok) return api.toast?.(result.message);
  }
  win()?.open?.(href, "_top");
}
