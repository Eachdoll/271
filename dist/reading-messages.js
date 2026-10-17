const valueText = (value) => {
  if (value == null) return "미지정";
  if (typeof value === "number" && Number.isFinite(value))
    return String(Number(value.toFixed(3)));
  if (typeof value !== "object") return String(value);
  if ("min" in value || "max" in value)
    return `${value.min ?? "—"}~${value.max ?? "—"}`;
  return JSON.stringify(value);
};
/** Plain text only; callers escape it when rendering HTML. */
export function describeReadingViolation(violation) {
  if (typeof violation === "string") return violation;
  if (!violation || typeof violation !== "object")
    return "내용을 확인해 주세요.";
  if (typeof violation.message === "string" && violation.message)
    return violation.message;
  if (typeof violation.suggestion === "string" && violation.suggestion)
    return violation.suggestion;
  const labels = {
    "sentence-count": "문장 수",
    "sentence-length": "문장 길이",
    "out-of-vocabulary": "등급 외 어휘 비율",
    "page-words": "쪽 단어 수",
    "page-characters": "쪽 글자 수",
    "connective-endings": "연결어미 수",
    "new-word-budget": "새 어휘 수",
  };
  const prefix =
    violation.language === "ko"
      ? "한글 "
      : violation.language === "en"
        ? "영어 "
        : "";
  const display = (value) =>
    violation.code === "out-of-vocabulary" &&
    typeof value === "number" &&
    Number.isFinite(value)
      ? `${Math.round(value * 1000) / 10}%`
      : valueText(value);
  if (labels[violation.code]) {
    const expected =
      violation.expected != null
        ? `허용 ${valueText(violation.expected)}`
        : `최대 ${display(violation.max)}`;
    return `${prefix}${labels[violation.code]} ${display(violation.actual)} (${expected})`;
  }
  return `${violation.code || "검사 항목"} · 실제 ${valueText(violation.actual)} / 허용 ${valueText(violation.expected ?? violation.max)}`;
}
