/**
 * Device-local credentials. Plaintext is used only in memory; library state and
 * exports never contain credentials. New keys use nonextractable AES-GCM keys
 * derived from the parent PIN with PBKDF2. Only salt/IV/ciphertext persist.
 * Version 1 IndexedDB keys are migrated on the first parent PIN unlock.
 *
 * This protects stored data, not a compromised origin or an unlocked device.
 * Settings access is additionally gated by the application's parent PIN.
 */

import { validateCredentialInput } from "./credential-validation.js";
export const CREDENTIAL_ENGINES = Object.freeze([
  "google",
  "openai",
  "anthropic",
  "bfl",
  "fal",
  "local",
]);
const PREFIX = "donghwa-workshop-credential-v1:";
const DATABASE = "donghwa-workshop-key-vault";
const STORE = "keys";
const KEY_ID = "credential-aes-gcm-v1";
const PIN_KEY_ID = "credential-pin-aes-gcm-v2";
const PIN_META_KEY = PREFIX + "pin-lock-v2";
const PIN_ITERATIONS = 210000;
const PIN_CHECK_TEXT = "donghwa-workshop-parent-vault-v2";
const MAX_SECRET_BYTES = 16384;
const encoder = new TextEncoder();
let unlockedSession = null;
let lockVersion = 0;

export class VaultError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "VaultError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function validateEngine(engine) {
  if (!CREDENTIAL_ENGINES.includes(engine)) {
    throw new VaultError("INVALID_ENGINE", "지원하지 않는 이미지 엔진이에요.");
  }
  return engine;
}

function storageKey(engine) {
  return PREFIX + validateEngine(engine);
}

function credentialStorage() {
  try {
    return globalThis.localStorage;
  } catch (error) {
    throw new VaultError(
      "STORAGE_UNAVAILABLE",
      "API 키 저장소에 접근할 수 없어요. 브라우저의 사이트 저장 권한을 확인해 주세요.",
      error,
    );
  }
}

function readRecord(engine) {
  let raw;
  try {
    raw = credentialStorage().getItem(storageKey(engine));
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw new VaultError(
      "STORAGE_UNAVAILABLE",
      "API 키 저장소를 읽을 수 없어요. 브라우저의 사이트 저장 권한을 확인해 주세요.",
      error,
    );
  }
  if (raw === null) return null;
  try {
    const record = JSON.parse(raw);
    if (
      !record ||
      ![1, 2].includes(record.version) ||
      record.algorithm !== "AES-GCM" ||
      record.keyId !== (record.version === 2 ? PIN_KEY_ID : KEY_ID) ||
      record.engine !== engine ||
      typeof record.iv !== "string" ||
      typeof record.ciphertext !== "string"
    ) {
      throw new Error("Invalid encrypted credential record");
    }
    const iv = fromBase64(record.iv);
    const ciphertext = fromBase64(record.ciphertext);
    if (
      iv.byteLength !== 12 ||
      ciphertext.byteLength < 17 ||
      ciphertext.byteLength > MAX_SECRET_BYTES + 16
    ) {
      throw new Error("Invalid encrypted credential length");
    }
    return { iv, ciphertext, version: record.version };
  } catch (error) {
    throw new VaultError(
      "CREDENTIAL_CORRUPT",
      "저장된 API 키가 손상되었어요. 해당 키를 삭제하고 다시 입력해 주세요.",
      error,
    );
  }
}

function requireCrypto() {
  if (globalThis.isSecureContext === false) {
    throw new VaultError(
      "SECURE_CONTEXT_REQUIRED",
      "API 키 암호화에는 HTTPS 또는 localhost 환경이 필요해요.",
    );
  }
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new VaultError(
      "CRYPTO_UNAVAILABLE",
      "이 브라우저는 API 키 암호화를 지원하지 않아요. 최신 브라우저를 사용해 주세요.",
    );
  }
  return globalThis.crypto;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    const fail = (code, message, cause) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new VaultError(code, message, cause));
    };
    const timeout = setTimeout(
      () =>
        fail(
          "KEY_STORE_TIMEOUT",
          "암호화 키 저장소가 응답하지 않아요. 다른 탭을 닫고 다시 시도해 주세요.",
        ),
      8000,
    );
    try {
      if (!globalThis.indexedDB) {
        fail(
          "KEY_STORE_UNAVAILABLE",
          "이 브라우저에서는 암호화 키를 저장할 수 없어요. 사이트 저장 권한을 확인해 주세요.",
        );
        return;
      }
      request = globalThis.indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE);
      };
      request.onblocked = () =>
        fail(
          "KEY_STORE_BLOCKED",
          "다른 탭에서 암호화 키 저장소를 사용 중이에요. 다른 공방 탭을 닫고 다시 시도해 주세요.",
        );
      request.onerror = () =>
        fail(
          "KEY_STORE_UNAVAILABLE",
          "암호화 키 저장소를 열 수 없어요. 사이트 저장 권한을 확인해 주세요.",
          request.error,
        );
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        if (settled) {
          db.close();
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(db);
      };
    } catch (error) {
      fail(
        "KEY_STORE_UNAVAILABLE",
        "암호화 키 저장소를 열 수 없어요. 사이트 저장 권한을 확인해 주세요.",
        error,
      );
    }
  });
}

function validEncryptionKey(key) {
  return (
    key &&
    key.type === "secret" &&
    key.extractable === false &&
    key.algorithm?.name === "AES-GCM" &&
    key.algorithm?.length === 256 &&
    key.usages?.includes("encrypt") &&
    key.usages?.includes("decrypt") &&
    (typeof globalThis.CryptoKey === "undefined" ||
      key instanceof globalThis.CryptoKey)
  );
}

/** The read/conditional put share a transaction so concurrent tabs use one key. */
function keyTransaction(db, candidate = null) {
  return new Promise((resolve, reject) => {
    let key = null;
    let transaction;
    let localError;
    try {
      transaction = db.transaction(STORE, candidate ? "readwrite" : "readonly");
      const store = transaction.objectStore(STORE);
      const request = store.get(KEY_ID);
      request.onsuccess = () => {
        key = request.result || null;
        if (key && !validEncryptionKey(key)) {
          localError = new VaultError(
            "KEY_STORE_CORRUPT",
            "이 기기의 암호화 키를 사용할 수 없어요. 저장된 API 키를 삭제하고 사이트 저장소를 초기화해 주세요.",
          );
          transaction.abort();
          return;
        }
        if (!key && candidate) {
          key = candidate;
          store.put(candidate, KEY_ID);
        }
      };
      transaction.oncomplete = () => resolve(key);
      transaction.onabort = () =>
        reject(
          localError ||
            new VaultError(
              "KEY_STORE_UNAVAILABLE",
              "암호화 키를 저장하거나 읽을 수 없어요. 브라우저 저장 권한과 여유 공간을 확인해 주세요.",
              transaction.error,
            ),
        );
      transaction.onerror = () => {};
    } catch (error) {
      reject(
        new VaultError(
          "KEY_STORE_UNAVAILABLE",
          "암호화 키 저장소에 접근할 수 없어요. 브라우저 저장 권한을 확인해 주세요.",
          error,
        ),
      );
    }
  });
}

async function encryptionKey(create) {
  const crypto = requireCrypto();
  const db = await openDatabase();
  try {
    const existing = await keyTransaction(db);
    if (existing || !create) return existing;
    // Clearing IndexedDB alone must not silently replace the key for remaining
    // ciphertexts. The user can remove those credentials and enter them again.
    let existingCiphertext;
    try {
      const storage = credentialStorage();
      existingCiphertext = CREDENTIAL_ENGINES.some(
        (engine) => storage.getItem(PREFIX + engine) !== null,
      );
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new VaultError(
        "STORAGE_UNAVAILABLE",
        "저장된 API 키를 확인할 수 없어요. 사이트 저장 권한을 확인해 주세요.",
        error,
      );
    }
    if (existingCiphertext) {
      // Another tab may have created the shared key since our initial read.
      const concurrentKey = await keyTransaction(db);
      if (concurrentKey) return concurrentKey;
      throw missingKeyError();
    }
    let candidate;
    try {
      candidate = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    } catch (error) {
      throw new VaultError(
        "ENCRYPTION_FAILED",
        "API 키 암호화를 준비할 수 없어요. 최신 브라우저에서 다시 시도해 주세요.",
        error,
      );
    }
    return await keyTransaction(db, candidate);
  } finally {
    db.close();
  }
}

function missingKeyError() {
  return new VaultError(
    "KEY_MISSING",
    "이 기기의 암호화 키가 없어 저장된 API 키를 열 수 없어요. 저장된 API 키를 모두 삭제한 뒤 다시 입력해 주세요.",
  );
}

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function fromBase64(value) {
  if (
    !value ||
    value.length > 4 * Math.ceil((MAX_SECRET_BYTES + 16) / 3) ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new Error("Invalid encrypted credential encoding");
  }
  const binary = globalThis.atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (toBase64(bytes) !== value)
    throw new Error("Noncanonical encrypted credential encoding");
  return bytes;
}

function authenticatedContext(engine, version = 1) {
  return encoder.encode(
    PREFIX + engine + ":" + (version === 2 ? PIN_KEY_ID : KEY_ID),
  );
}

function lockedError() {
  return new VaultError(
    "VAULT_LOCKED",
    "부모 PIN으로 API 키 보관함의 잠금을 해제해 주세요.",
  );
}
function validatePin(pin) {
  if (typeof pin !== "string" || !/^\d{4,12}$/.test(pin))
    throw new VaultError(
      "INVALID_PIN",
      "부모 PIN은 숫자 4~12자리로 입력해 주세요.",
    );
  return pin;
}
function readPinMetadata() {
  const raw = credentialStorage().getItem(PIN_META_KEY);
  if (!raw) return null;
  try {
    const meta = JSON.parse(raw);
    if (
      meta.version !== 2 ||
      meta.kdf !== "PBKDF2" ||
      meta.hash !== "SHA-256" ||
      meta.iterations !== PIN_ITERATIONS ||
      fromBase64(meta.salt).length !== 16 ||
      fromBase64(meta.iv).length !== 12 ||
      fromBase64(meta.check).length < 17
    )
      throw new Error("Invalid PIN metadata");
    return meta;
  } catch {
    throw new VaultError(
      "CREDENTIAL_CORRUPT",
      "PIN 암호화 설정이 손상되었어요. 기기의 사이트 저장소를 확인해 주세요.",
    );
  }
}
async function derivePinKey(pin, salt) {
  const crypto = requireCrypto();
  const bytes = encoder.encode(validatePin(pin));
  try {
    const material = await crypto.subtle.importKey(
      "raw",
      bytes,
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: PIN_ITERATIONS, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    bytes.fill(0);
  }
}
function pinSession() {
  const meta = readPinMetadata();
  if (!meta || !unlockedSession || unlockedSession.salt !== meta.salt)
    throw lockedError();
  return unlockedSession;
}
export function isVaultUnlocked() {
  try {
    return !!pinSession();
  } catch {
    return false;
  }
}
export function hasPinVault() {
  return readPinMetadata() !== null;
}
export function lockVault() {
  unlockedSession = null;
  lockVersion++;
}

async function encryptRecord(engine, value, key) {
  const crypto = requireCrypto();
  const bytes = encoder.encode(value);
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: authenticatedContext(engine, 2) },
      key,
      bytes,
    );
    return {
      version: 2,
      algorithm: "AES-GCM",
      keyId: PIN_KEY_ID,
      engine,
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(ciphertext)),
      savedAt: new Date().toISOString(),
    };
  } finally {
    bytes.fill(0);
  }
}
async function buildPinBundle(pin, credentials) {
  const crypto = requireCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derivePinKey(pin, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const check = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(PIN_KEY_ID) },
    key,
    encoder.encode(PIN_CHECK_TEXT),
  );
  const meta = {
    version: 2,
    kdf: "PBKDF2",
    hash: "SHA-256",
    iterations: PIN_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    check: toBase64(new Uint8Array(check)),
  };
  const records = await Promise.all(
    Object.entries(credentials).map(async ([engine, value]) => [
      storageKey(engine),
      JSON.stringify(await encryptRecord(engine, value, key)),
    ]),
  );
  return { key, meta, records };
}
function commitPinBundle(bundle) {
  const storage = credentialStorage();
  const entries = [
    ...bundle.records,
    [PIN_META_KEY, JSON.stringify(bundle.meta)],
  ];
  const previous = entries.map(([name]) => [name, storage.getItem(name)]);
  try {
    for (const [name, value] of entries) storage.setItem(name, value);
  } catch (error) {
    for (const [name, value] of previous) {
      try {
        if (value === null) storage.removeItem(name);
        else storage.setItem(name, value);
      } catch {}
    }
    throw new VaultError(
      error?.name === "QuotaExceededError"
        ? "STORAGE_FULL"
        : "STORAGE_UNAVAILABLE",
      "PIN 암호화 설정을 저장하지 못했어요. 저장 공간과 브라우저 권한을 확인해 주세요.",
    );
  }
  unlockedSession = {
    key: bundle.key,
    salt: bundle.meta.salt,
    version: lockVersion,
  };
}

/** Call only after the application has verified its parent PIN. */
export async function unlockVault(pin) {
  validatePin(pin);
  lockVault();
  const generation = lockVersion;
  const meta = readPinMetadata();
  if (!meta) {
    const credentials = {};
    for (const engine of CREDENTIAL_ENGINES)
      if (readRecord(engine)) credentials[engine] = await getCredential(engine);
    const bundle = await buildPinBundle(pin, credentials);
    if (generation !== lockVersion) throw lockedError();
    commitPinBundle(bundle);
    return true;
  }
  const key = await derivePinKey(pin, fromBase64(meta.salt));
  let decoded;
  try {
    decoded = new Uint8Array(
      await requireCrypto().subtle.decrypt(
        {
          name: "AES-GCM",
          iv: fromBase64(meta.iv),
          additionalData: encoder.encode(PIN_KEY_ID),
        },
        key,
        fromBase64(meta.check),
      ),
    );
    if (new TextDecoder().decode(decoded) !== PIN_CHECK_TEXT)
      throw new Error("Invalid PIN");
  } catch {
    throw new VaultError(
      "INVALID_PIN",
      "부모 PIN이 맞지 않아 API 키 보관함을 열 수 없어요.",
    );
  } finally {
    decoded?.fill(0);
  }
  if (generation !== lockVersion) throw lockedError();
  unlockedSession = { key, salt: meta.salt, version: generation };
  return true;
}

/** Re-encrypt every saved credential; the application updates its PIN hash after success. */
export async function setVaultPin(oldPin, newPin) {
  validatePin(newPin);
  await unlockVault(oldPin);
  const generation = lockVersion;
  const credentials = {};
  for (const engine of CREDENTIAL_ENGINES)
    if (readRecord(engine)) credentials[engine] = await getCredential(engine);
  const bundle = await buildPinBundle(newPin, credentials);
  if (generation !== lockVersion) throw lockedError();
  commitPinBundle(bundle);
  return true;
}

/** Save a trimmed key. Empty input is rejected; use removeCredential to clear. */
export async function saveCredential(engine, value) {
  validateEngine(engine);
  if (typeof value !== "string" || !value.trim()) {
    throw new VaultError(
      "INVALID_CREDENTIAL",
      "저장할 API 키를 입력해 주세요. 키 삭제는 삭제 버튼을 사용해 주세요.",
    );
  }
  try {
    value = validateCredentialInput(engine, value);
  } catch (error) {
    throw new VaultError("INVALID_CREDENTIAL", error.message);
  }
  const bytes = encoder.encode(value.trim());
  if (bytes.byteLength > MAX_SECRET_BYTES) {
    bytes.fill(0);
    throw new VaultError(
      "INVALID_CREDENTIAL",
      "API 키가 너무 길어요. 올바른 키인지 확인해 주세요.",
    );
  }
  let record;
  try {
    const crypto = requireCrypto();
    const pinMeta = readPinMetadata();
    const session = pinMeta ? pinSession() : null;
    const version = pinMeta ? 2 : 1;
    const key = session ? session.key : await encryptionKey(true);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: authenticatedContext(engine, version),
      },
      key,
      bytes,
    );
    if (
      session &&
      (unlockedSession !== session || session.version !== lockVersion)
    )
      throw lockedError();
    record = {
      version,
      algorithm: "AES-GCM",
      keyId: version === 2 ? PIN_KEY_ID : KEY_ID,
      engine,
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(ciphertext)),
      savedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw new VaultError(
      "ENCRYPTION_FAILED",
      "API 키를 암호화할 수 없어요. 브라우저를 새로고침하고 다시 시도해 주세요.",
      error,
    );
  } finally {
    bytes.fill(0);
  }
  try {
    credentialStorage().setItem(storageKey(engine), JSON.stringify(record));
    return true;
  } catch (error) {
    if (error instanceof VaultError) throw error;
    const quota = error?.name === "QuotaExceededError";
    throw new VaultError(
      quota ? "STORAGE_FULL" : "STORAGE_UNAVAILABLE",
      quota
        ? "저장 공간이 부족해 API 키를 저장하지 못했어요. 공간을 확보한 뒤 다시 시도해 주세요."
        : "암호화한 API 키를 저장할 수 없어요. 사이트 저장 권한을 확인해 주세요.",
      error,
    );
  }
}

/** Decrypt only when an adapter needs the credential; never log this result. */
export async function getCredential(engine) {
  validateEngine(engine);
  const record = readRecord(engine);
  if (!record) return null;
  // A legacy record must never bypass the lock after PIN migration.
  if (readPinMetadata()) pinSession();
  const crypto = requireCrypto();
  const session = record.version === 2 ? pinSession() : null;
  const key = session ? session.key : await encryptionKey(false);
  if (!key) throw missingKeyError();
  let plaintext;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: record.iv,
          additionalData: authenticatedContext(engine, record.version),
        },
        key,
        record.ciphertext,
      ),
    );
    if (
      session &&
      (unlockedSession !== session || session.version !== lockVersion)
    )
      throw lockedError();
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw new VaultError(
      "DECRYPTION_FAILED",
      "저장된 API 키를 복호화할 수 없어요. 해당 키를 삭제하고 다시 입력해 주세요.",
      error,
    );
  } finally {
    plaintext?.fill(0);
  }
}

export async function removeCredential(engine) {
  validateEngine(engine);
  try {
    credentialStorage().removeItem(storageKey(engine));
    return true;
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw new VaultError(
      "STORAGE_UNAVAILABLE",
      "저장된 API 키를 삭제할 수 없어요. 사이트 저장 권한을 확인해 주세요.",
      error,
    );
  }
}

/** Report saved status without loading the encryption key or decrypting. */
export async function hasCredential(engine) {
  validateEngine(engine);
  return readRecord(engine) !== null;
}

export async function listCredentialStatus() {
  const entries = await Promise.all(
    CREDENTIAL_ENGINES.map(async (engine) => {
      try {
        return [engine, await hasCredential(engine)];
      } catch {
        return [engine, "corrupt"];
      }
    }),
  );
  return Object.fromEntries(entries);
}
