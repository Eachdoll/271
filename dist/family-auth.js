/**
 * Family ID + password accounts, browser side. Pure helpers with injectable
 * storage and WebCrypto: no DOM and no network here.
 *
 * Only the session token is ever stored (localStorage FAMILY_SESSION_KEY).
 * The password, the derived passwordKey and recovery codes stay in memory.
 */
export const FAMILY_SESSION_KEY = "donghwa-family-session-v1";
export const FAMILY_SESSION_HEADER = "X-Family-Session";
export const FAMILY_PASSWORD_ITERATIONS = 600000;
/** FULL AUTO runs hold a Web Lock named with this prefix plus the job id (full-auto-ui.js). */
export const FULL_AUTO_LOCK_PREFIX = "donghwa-full-auto-";
const PASSWORD_SALT_PREFIX = "donghwa-family-pw-v1:";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const USERNAME_PATTERN = /^[a-z][a-z0-9_]{3,19}$/;
const OWNER_PATTERN = /^family:[A-Za-z0-9._-]{1,128}$/;
const RECOVERY_PATTERN = /^[0-9A-HJKMNP-TV-Z]{20}$/;
const encoder = new TextEncoder();

export const RESERVED_USERNAMES = Object.freeze([
  "admin",
  "root",
  "system",
  "support",
  "chatgpt",
  "openai",
  "family",
  "donghwa",
  "guest",
  "test",
]);
const reserved = new Set(RESERVED_USERNAMES);
/** A short list of passwords people pick first; lower-cased before comparing. */
const COMMON_PASSWORDS = new Set([
  "1234567890",
  "0123456789",
  "0987654321",
  "12345678910",
  "1111111111",
  "qwer1234!!",
  "qwer1234!@",
  "1q2w3e4r5t",
  "1q2w3e4r!!",
  "1q2w3e4r5t6y",
  "1qaz2wsx3edc",
  "password12",
  "password123",
  "password1!",
  "asdf123456",
  "asdf1234!!",
  "qwertyuiop",
  "qwerty1234",
  "abcd123456",
  "abc1234567",
  "a123456789",
  "123456789a",
  "iloveyou12",
  "zxcvbnm123",
  "qazwsx1234",
]);

export const FAMILY_MESSAGES = Object.freeze({
  usernameFormat:
    "아이디는 영문 소문자로 시작하고 영문 소문자·숫자·밑줄(_)로 4~20자예요.",
  usernameReserved: "쓸 수 없는 아이디예요.",
  passwordEmpty: "비밀번호를 입력해 주세요.",
  passwordAscii:
    "비밀번호는 영문·숫자·기호로 만들어 주세요(아이폰 비밀번호 칸에서는 한글을 입력할 수 없어요).",
  passwordShort: "비밀번호는 10자 이상이에요.",
  passwordLong: "비밀번호는 128자까지 쓸 수 있어요.",
  passwordHasUsername: "비밀번호에 아이디를 넣지 말아 주세요.",
  passwordCommon: "너무 흔한 비밀번호예요. 다른 비밀번호를 써 주세요.",
  passwordSame: "지금 비밀번호와 다른 새 비밀번호를 써 주세요.",
  displayNameLong: "가족 이름은 20자까지 쓸 수 있어요.",
  displayNameInvalid: "가족 이름에 쓸 수 없는 글자가 있어요.",
  inviteEmpty: "가족 초대 코드를 입력해 주세요.",
  recoveryFormat: "복구 코드 20자를 다시 확인해 주세요.",
  autoRunning: "자동 만들기가 끝난 뒤 계정을 바꿔 주세요.",
  busy: "로그인을 확인하고 있어요. 잠시만 기다려 주세요.",
  familyOnly: "가족 아이디로 로그인했을 때만 쓸 수 있어요.",
  deleteConfirm: "확인 칸에 ‘삭제’라고 적어 주세요.",
  sessionExpired: "가족 아이디 로그인이 끝났어요. 다시 로그인해 주세요.",
  network: "서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.",
  timeout: "서버 응답이 늦어요. 잠시 뒤 다시 해 주세요.",
  invalidResponse: "서버 응답을 확인하지 못했어요. 잠시 뒤 다시 해 주세요.",
  storage:
    "로그인 정보를 이 기기에 저장하지 못했어요. 브라우저 저장 공간과 권한을 확인해 주세요.",
  crypto:
    "이 브라우저에서는 안전한 로그인을 쓸 수 없어요. HTTPS 주소로 열어 주세요.",
});

const SERVER_MESSAGES = Object.freeze({
  invalid_credentials: "아이디 또는 비밀번호가 맞지 않아요.",
  username_taken: "이미 있는 아이디예요. 로그인하거나 다른 아이디를 써 주세요.",
  invite_invalid: "가족 초대 코드가 맞지 않아요.",
  signup_closed:
    "가족 계정 만들기가 아직 열리지 않았어요. 사이트 관리자에게 가족 초대 코드를 받아 주세요.",
  invalid_recovery: "아이디나 복구 코드가 맞지 않아요.",
  family_only: FAMILY_MESSAGES.familyOnly,
  authentication_required: FAMILY_MESSAGES.sessionExpired,
  account_mismatch:
    "로그인 계정이 바뀌었어요. 화면을 새로 고친 뒤 다시 해 주세요.",
  account_changed:
    "로그인 계정이 바뀌었어요. 화면을 새로 고친 뒤 다시 해 주세요.",
  storage_unavailable: "지금은 클라우드에 연결할 수 없어요. 잠시 뒤 다시 해 주세요.",
  cloud_unavailable: "지금은 클라우드에 연결할 수 없어요. 잠시 뒤 다시 해 주세요.",
  // The server's name for an origin refusal; the other two stay as aliases.
  origin_forbidden:
    "이 주소에서는 로그인할 수 없어요. 동화공방 주소로 직접 열어 주세요.",
  forbidden_origin: "이 주소에서는 로그인할 수 없어요. 동화공방 주소로 직접 열어 주세요.",
  origin_mismatch: "이 주소에서는 로그인할 수 없어요. 동화공방 주소로 직접 열어 주세요.",
  invalid_username: FAMILY_MESSAGES.usernameFormat,
  reserved_username: FAMILY_MESSAGES.usernameReserved,
  invalid_display_name: FAMILY_MESSAGES.displayNameInvalid,
  confirm_required: FAMILY_MESSAGES.deleteConfirm,
  invalid_password_key:
    "비밀번호 확인값이 올바르지 않아요. 화면을 새로 고친 뒤 다시 해 주세요.",
  json_required: "요청 형식이 맞지 않아요. 화면을 새로 고친 뒤 다시 해 주세요.",
  invalid_json: "요청 형식이 맞지 않아요. 화면을 새로 고친 뒤 다시 해 주세요.",
  invalid_request: "요청 형식이 맞지 않아요. 화면을 새로 고친 뒤 다시 해 주세요.",
  size_mismatch: "보내는 중에 내용이 끊겼어요. 다시 해 주세요.",
  request_interrupted: "보내는 중에 내용이 끊겼어요. 다시 해 주세요.",
  request_too_large: "입력한 내용이 너무 길어요.",
  not_found: "이 사이트에서는 가족 아이디 로그인을 아직 쓸 수 없어요.",
  method_not_allowed: "이 사이트에서는 가족 아이디 로그인을 아직 쓸 수 없어요.",
});

const defaultStorage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

/** Canonical form used for the PBKDF2 salt, the server row and the preview. */
export function normalizeUsername(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
}

export function validateUsername(value) {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username))
    return {
      ok: false,
      username,
      code: "username_format",
      message: FAMILY_MESSAGES.usernameFormat,
    };
  if (reserved.has(username))
    return {
      ok: false,
      username,
      code: "username_reserved",
      message: FAMILY_MESSAGES.usernameReserved,
    };
  return { ok: true, username };
}

const printableAscii = (value) => /^[\x20-\x7e]*$/.test(value);
const fail = (code, message) => ({ ok: false, code, message });

/** New-password rules, checked only in the browser (the server never sees the password). */
export function validatePassword(password, username = "") {
  const value = typeof password === "string" ? password : "";
  if (!value) return fail("password_empty", FAMILY_MESSAGES.passwordEmpty);
  if (!printableAscii(value))
    return fail("password_ascii", FAMILY_MESSAGES.passwordAscii);
  if (value.length < 10)
    return fail("password_short", FAMILY_MESSAGES.passwordShort);
  if (value.length > 128)
    return fail("password_long", FAMILY_MESSAGES.passwordLong);
  const lower = value.toLowerCase(),
    name = normalizeUsername(username);
  if (name && lower.includes(name))
    return fail("password_username", FAMILY_MESSAGES.passwordHasUsername);
  if (COMMON_PASSWORDS.has(lower) || /^(.)\1+$/.test(value))
    return fail("password_common", FAMILY_MESSAGES.passwordCommon);
  return { ok: true };
}

/**
 * An existing password only has to be something sign-up could have accepted:
 * non-empty printable ASCII. A Korean IME slip gets the ASCII hint at once.
 */
export function validateExistingPassword(password) {
  const value = typeof password === "string" ? password : "";
  if (!value) return fail("password_empty", FAMILY_MESSAGES.passwordEmpty);
  if (!printableAscii(value))
    return fail("password_ascii", FAMILY_MESSAGES.passwordAscii);
  if (value.length > 128)
    return fail("password_long", FAMILY_MESSAGES.passwordLong);
  return { ok: true };
}

/** Optional family name: NFC, trimmed, at most 20 UTF-16 units, no control characters. */
export function validateDisplayName(value) {
  const displayName = String(value ?? "")
    .normalize("NFC")
    .trim();
  if (/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(displayName))
    return {
      ok: false,
      displayName,
      code: "display_name_invalid",
      message: FAMILY_MESSAGES.displayNameInvalid,
    };
  if (displayName.length > 20)
    return {
      ok: false,
      displayName,
      code: "display_name_long",
      message: FAMILY_MESSAGES.displayNameLong,
    };
  return { ok: true, displayName };
}

export function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * passwordKey = base64url(PBKDF2-HMAC-SHA-256(password, 'donghwa-family-pw-v1:' + canonical
 * username, 600000 iterations, 256 bits)). Only this 43-character value is ever sent.
 */
export async function derivePasswordKey(
  username,
  password,
  {
    subtle = globalThis.crypto?.subtle,
    iterations = FAMILY_PASSWORD_ITERATIONS,
  } = {},
) {
  if (!subtle?.importKey || !subtle?.deriveBits)
    throw Object.assign(new Error(FAMILY_MESSAGES.crypto), {
      code: "crypto_unavailable",
    });
  if (!Number.isSafeInteger(iterations) || iterations < 1)
    throw new TypeError("PBKDF2 iterations must be a positive integer.");
  const material = await subtle.importKey(
    "raw",
    encoder.encode(String(password ?? "")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(PASSWORD_SALT_PREFIX + normalizeUsername(username)),
      iterations,
    },
    material,
    256,
  );
  return base64url(new Uint8Array(bits));
}

/** Uppercase, drop spaces and hyphens, read O as 0 and I/L as 1 (Crockford base32). */
export function normalizeRecoveryCode(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}
export function isRecoveryCode(value) {
  return RECOVERY_PATTERN.test(normalizeRecoveryCode(value));
}
/** XXXX-XXXX-XXXX-XXXX-XXXX for display only. */
export function formatRecoveryCode(value) {
  return (normalizeRecoveryCode(value).match(/.{1,4}/g) || []).join("-");
}

export const isSessionToken = (value) =>
  typeof value === "string" && TOKEN_PATTERN.test(value);
export const isFamilyOwnerId = (value) =>
  typeof value === "string" && OWNER_PATTERN.test(value);

function sessionShape(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !isSessionToken(value.token) ||
    !isFamilyOwnerId(value.ownerId) ||
    !USERNAME_PATTERN.test(value.username)
  )
    return null;
  const displayName = validateDisplayName(value.displayName);
  return {
    token: value.token,
    ownerId: value.ownerId,
    username: value.username,
    displayName: displayName.ok ? displayName.displayName : "",
    savedAt: typeof value.savedAt === "string" ? value.savedAt.slice(0, 40) : "",
  };
}

/** The stored session or null; never throws (blocked storage reads as signed out). */
export function readFamilySession(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem?.(FAMILY_SESSION_KEY);
    return raw ? sessionShape(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Stores exactly {token, ownerId, username, displayName, savedAt}; any other field is dropped. */
export function writeFamilySession(storage, data, now = new Date()) {
  const value = sessionShape({
    ...data,
    savedAt:
      typeof data?.savedAt === "string" && data.savedAt
        ? data.savedAt
        : now.toISOString(),
  });
  if (!value)
    throw Object.assign(new Error(FAMILY_MESSAGES.invalidResponse), {
      code: "invalid_session",
    });
  try {
    storage.setItem(FAMILY_SESSION_KEY, JSON.stringify(value));
  } catch {
    throw Object.assign(new Error(FAMILY_MESSAGES.storage), {
      code: "storage",
    });
  }
  return value;
}

export function clearFamilySession(storage = defaultStorage()) {
  try {
    if (typeof storage?.removeItem === "function")
      storage.removeItem(FAMILY_SESSION_KEY);
    else storage?.setItem?.(FAMILY_SESSION_KEY, "");
    return true;
  } catch {
    return false;
  }
}

/** {'X-Family-Session': token} when a family session is stored, otherwise {}. */
export function familySessionHeaders(storage = defaultStorage()) {
  const session = readFamilySession(storage);
  return session ? { [FAMILY_SESSION_HEADER]: session.token } : {};
}

export const isFamilyUser = (user) =>
  !!user && (user.kind === "family" || isFamilyOwnerId(user.id));
/** Display label: displayName, then username, then email. */
export const accountLabel = (user) =>
  String(user?.displayName || user?.username || user?.email || "");

/**
 * True while this tab runs FULL AUTO (isAutoRunning) or any tab holds a
 * 'donghwa-full-auto-*' Web Lock. Without the Locks API only this tab is known.
 */
export async function isFullAutoRunActive({
  isAutoRunning,
  locks = globalThis.navigator?.locks,
} = {}) {
  try {
    if (isAutoRunning?.()) return true;
  } catch {}
  if (typeof locks?.query !== "function") return false;
  try {
    const snapshot = await locks.query();
    return [...(snapshot?.held || [])].some(
      (lock) =>
        typeof lock?.name === "string" &&
        lock.name.startsWith(FULL_AUTO_LOCK_PREFIX),
    );
  } catch {
    return false;
  }
}

/** Korean message for an auth endpoint error code (server messages are not trusted for display). */
export function familyAuthMessage(code, { retryAfter = 0, status = 0 } = {}) {
  if (code === "too_many_attempts") {
    const minutes = Math.max(1, Math.ceil((Number(retryAfter) || 60) / 60));
    return `시도가 너무 많아요. ${minutes}분 뒤 다시 해 주세요.`;
  }
  if (SERVER_MESSAGES[code]) return SERVER_MESSAGES[code];
  if (FAMILY_MESSAGES[code]) return FAMILY_MESSAGES[code];
  if (status === 404 || status === 405 || status === 501)
    return "이 사이트에서는 가족 아이디 로그인을 아직 쓸 수 없어요.";
  if (status === 413) return "입력한 내용이 너무 길어요.";
  if (status === 401) return SERVER_MESSAGES.invalid_credentials;
  if (status >= 500) return SERVER_MESSAGES.storage_unavailable;
  return status
    ? `요청을 완료하지 못했어요. (HTTP ${status})`
    : "요청을 완료하지 못했어요.";
}
