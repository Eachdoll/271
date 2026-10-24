const valueText = (value) => {
  if (value == null) return "미지정";
  if (typeof value === "number" && Number.isFinite(value))
    return String(Number(value.toFixed(3)));
  if (typeof value !== "object") return String(value);
  if ("min" in value || "max" in value)
    return `${value.min ?? "—"}~${value.max ?? "—"}`;
  return JSON.stringify(value);
};
const UNIT_NAMES = { spread: "펼침면", page: "낱쪽", opening: "펼침" };
const measure = (value, word) =>
  Number.isFinite(Number(value)) ? `${Number(Number(value).toFixed(1))}${word}` : "—";
/** R12 openings (Korean unit rules; R31e lean English too): the three blocking codes and the one combined note. */
function describeUnitViolation(violation) {
  const unit = UNIT_NAMES[violation.unit] || "쪽",
    en = violation.language === "en",
    lang = en ? "영어" : "한글",
    word = en ? "단어" : "어절",
    eojeol = (value) => measure(value, word),
    range = (value) => `${value?.min ?? "—"}~${value?.max ?? "—"}`;
  switch (violation.code) {
    case "unit-sentence-count":
      return `${lang} ${unit} 문장 ${violation.actual}개 (권장 ${range(violation.expected)} · ${range(violation.band)}개를 벗어나면 고쳐 써요)`;
    case "unit-mean-length":
      return `${lang} ${unit} 문장 평균 ${eojeol(violation.actual)} (허용 ${range(violation.expected)}${word})`;
    case "unit-long-sentences":
      // R35 그림책 결: only the hard cap blocks there.
      if (violation.pictureLed)
        return `${lang} ${unit} 가장 긴 문장 ${eojeol(violation.longest)} (한 문장 ${violation.hardLimit}${word}까지)`;
      return `${lang} ${unit} 긴 문장 ${violation.actual}개 · 가장 긴 문장 ${eojeol(violation.longest)} (${violation.limit}${word} 넘는 문장은 ${violation.max}개까지, ${violation.hardLimit}${word} 넘는 문장은 없어야 해요)`;
    case "unit-length-note": {
      const parts = [
        ...(violation.offSentences
          ? [`짧거나 긴 문장 ${violation.offSentences}개`]
          : []),
        ...(violation.mean != null ? [`평균 ${eojeol(violation.mean)}`] : []),
        `문장 ${violation.sentenceCount}개(권장 ${range(violation.expected)})`,
        ...(violation.characters
          ? [
              `${violation.characters.actual}자(권장 ${violation.characters.min}~${violation.characters.max}자)`,
            ]
          : []),
      ];
      return `${lang} ${unit} 참고 · ${parts.join(" · ")}`;
    }
    default:
      return "";
  }
}
/** Plain text only; callers escape it when rendering HTML. */
export function describeReadingViolation(violation) {
  if (typeof violation === "string") return violation;
  if (!violation || typeof violation !== "object")
    return "내용을 확인해 주세요.";
  if (typeof violation.message === "string" && violation.message)
    return violation.message;
  if (typeof violation.suggestion === "string" && violation.suggestion)
    return violation.suggestion;
  const unitMessage = describeUnitViolation(violation);
  if (unitMessage) return unitMessage;
  // R31e: on the diet an E2+ page's out-of-list share is a note with the words themselves.
  if (violation.code === "out-of-vocabulary" && violation.advisory === true)
    return `${violation.language === "ko" ? "한글" : "영어"} 등급 외 어휘 ${Math.round(violation.actual * 1000) / 10}% · 참고${Array.isArray(violation.words) && violation.words.length ? ` (목록 밖: ${violation.words.slice(0, 8).join(", ")}${violation.words.length > 8 ? " …" : ""})` : ""}`;
  if (
    violation.code === "out-of-vocabulary" &&
    violation.severity === "warning"
  )
    return `들려주기 단계라 어휘는 참고 정보예요. 등급 외 단어 비율 ${Math.round(violation.actual * 1000) / 10}%`;
  const labels = {
    grammar: "시제·문법",
    "sentence-count": "문장 수",
    "sentence-length": "문장 길이",
    "out-of-vocabulary": "등급 외 어휘 비율",
    "page-words": "쪽 단어 수",
    "page-characters": "쪽 글자 수",
    "connective-endings": "연결어미 수",
    "new-word-budget": "새 어휘 수",
    "book-sentence-total": "책 전체 문장 수",
    "sentence-average": "쪽 문장 평균 어절",
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
