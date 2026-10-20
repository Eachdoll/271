import { describeReadingViolation } from "./reading-ui.js";
// R12: '펼침 3 · 5쪽으로' on openings books; page books keep 'n쪽으로'.
import { unitLabel } from "./book-layout.js";
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
/** Keep page references and severity from each independent checker. */
export function collectBookChecks(book) {
  const reading = (book.readingCheck?.pages || []).flatMap((page, index) =>
    page.passed === false
      ? [
          {
            pageNo: index + 1,
            message:
              [...(page.ko?.violations || []), ...(page.en?.violations || [])]
                .map(describeReadingViolation)
                .join(" · ") || "선택한 읽기 단계 범위를 확인해 주세요.",
            severity: "warning",
          },
        ]
      : [],
  );
  for (const warning of book.readingCheck?.warnings || [])
    reading.push({
      ...warning,
      pageNo: (warning.pageIndex ?? 0) + 1,
      message: describeReadingViolation(warning),
      severity: "warning",
    });
  for (const warning of book.storyCheck?.warnings || [])
    if (
      warning?.code !== "catchphrase-repeat" &&
      !reading.some(
        (item) => item.pageNo === warning.pageNo && item.code === warning.code,
      )
    )
      reading.push({
        ...warning,
        message: describeReadingViolation(warning),
        severity: "warning",
      });
  const events = (book.storyCheck?.checks || [])
    .filter((check) => !check.passed)
    .flatMap((check) =>
      (check.violations?.length
        ? check.violations
        : [{ message: check.label }]
      ).map((v) => ({
        ...v,
        message:
          v.code || v.message ? describeReadingViolation(v) : check.label,
        severity: "warning",
      })),
    );
  // R9: catchphrase repetition is an advisory story item; it never blocks.
  for (const warning of book.storyCheck?.warnings || [])
    if (warning?.code === "catchphrase-repeat")
      events.push({
        ...warning,
        message: describeReadingViolation(warning),
        severity: "warning",
      });
  const richness =
    book.richnessCheck?.issues || book.richnessCheck?.violations || [];
  const coherence = book.pageCoherence?.issues || [];
  return [
    { id: "reading", label: "읽기", items: reading },
    { id: "events", label: "사건", items: events },
    { id: "richness", label: "풍부함", items: richness },
    { id: "coherence", label: "연결", items: coherence },
  ];
}
export function renderChecksPanel(
  book,
  { tab = "reading", details = {} } = {},
) {
  const groups = collectBookChecks(book),
    active = groups.find((group) => group.id === tab) || groups[0];
  return `<section class="panel checks-panel"><h3>검사 결과</h3><nav class="check-tabs" role="tablist" aria-label="검사 종류">${groups.map((group) => `<button type="button" role="tab" aria-selected="${active.id === group.id}" data-action="check-tab" data-tab="${group.id}">${group.label}<span class="check-result-count">${group.items.length}</span></button>`).join("")}</nav><div role="tabpanel">${
    active.items.length
      ? `<ul class="check-issues">${active.items
          .map((issue) => {
            const pageNo = Number(
                issue.pageNo ||
                  issue.page ||
                  (Array.isArray(issue.pages) ? issue.pages[0] : 1),
              ),
              index = Math.min(
                Math.max(0, Number.isFinite(pageNo) ? pageNo - 1 : 0),
                (book.pages?.length || 1) - 1,
              );
            return `<li class="${issue.severity === "error" ? "check-blocked" : "check-advisory"}"><span>${issue.severity === "error" ? "수정 필요" : "확인 권장"} · ${escape(describeReadingViolation(issue))}</span><button class="btn btn-outline btn-small" data-action="edit-page" data-page="${index}">${escape(unitLabel(book, index))}${issue.pageNo || issue.page ? "으로" : "부터 확인"}</button></li>`;
          })
          .join("")}</ul>`
      : '<p class="small-label">표시할 경고가 없어요. 자세한 검사 상태도 확인해 주세요.</p>'
  }${details[active.id] || ""}</div></section>`;
}
