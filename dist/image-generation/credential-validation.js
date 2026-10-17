/** Reject recognizable copied UI identifiers without echoing credential values. */
export class CredentialInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "CredentialInputError";
    this.code = "invalid_credential";
  }
}
export function validateCredentialInput(engine, value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key)
    throw new CredentialInputError(
      "저장하거나 사용할 API 비밀 키를 입력해 주세요.",
    );
  if (engine === "openai") {
    if (/^key_/i.test(key))
      throw new CredentialInputError(
        "OpenAI 추적 ID를 입력했어요. key_로 시작하는 추적 ID 대신 sk-로 시작하는 비밀 키 전체를 입력해 주세요. 비밀 키 전체를 보관하지 않았다면 OpenAI에서 새 비밀 키를 만들어 주세요.",
      );
    if (/…|\.{3,}|\*{2,}|•{2,}/u.test(key))
      throw new CredentialInputError(
        "가려진 OpenAI 키는 사용할 수 없어요. sk-…처럼 표시된 값 대신 생성할 때 복사한 비밀 키 전체를 입력해 주세요. 전체 키가 없다면 새 비밀 키를 만들어 주세요.",
      );
  }
  return key;
}
