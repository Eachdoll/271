/** Only explicit credential failures may offer navigation to a key form. */
export function missingCredentialError(message, engine, kind = "image") {
  return Object.assign(new Error(message), {
    code: "credential_missing",
    engine,
    credentialKind: kind,
  });
}
export function credentialToastAction(error, openSettings) {
  if (error?.code !== "credential_missing" || !error.engine) return undefined;
  const kind = error.credentialKind === "text" ? "text" : "image";
  return {
    label: kind === "text" ? "글 엔진 키 등록하기" : "그림 엔진 키 등록하기",
    run: () => openSettings(kind, error.engine),
  };
}
