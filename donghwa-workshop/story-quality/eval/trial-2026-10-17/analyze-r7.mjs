// r7 규칙 전문 실측 요약: node analyze-r7.mjs <runId>
import fs from 'node:fs';
const id = process.argv[2] || 'sonnet55-r7-prose';
const rows = fs.readFileSync(new URL(`${id}.jsonl`, import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
const avg = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const out = { runId: id, n: rows.length, errors: rows.filter((r) => r.error).length, costUsd: +rows.reduce((s, r) => s + (r.costUsd || 0), 0).toFixed(3), latencyMeanS: +(avg(rows.map((r) => r.latencyMs)) / 1000).toFixed(1) };
for (const lang of ['ko', 'en']) {
  const x = rows.map((r) => r[lang]);
  const viol = {}, warn = {}, pagesBy = {};
  for (const v of x) for (const c of v.checks) { for (const i of c.violations) viol[i.code] = (viol[i.code] || 0) + 1; for (const w of c.warnings || []) warn[w.code] = (warn[w.code] || 0) + 1; }
  const grammarWords = {};
  if (lang === 'en') for (const v of x) for (const c of v.checks) for (const i of c.violations) if (i.code === 'grammar') for (const w of String(i.actual).split(', ')) grammarWords[w] = (grammarWords[w] || 0) + 1;
  const oovWords = x.flatMap((v) => v.checks.map((c) => [c.metrics.outOfVocabCount || 0, c.metrics.wordCount]));
  out[lang] = {
    sentencesMean: +avg(x.map((v) => v.sentences)).toFixed(1),
    packageSentenceCountMean: +avg(x.map((v) => v.packageSentenceCount)).toFixed(1),
    booksInBudget: x.filter((v) => v.sentences <= (lang === 'ko' ? 36 : 24)).length,
    beatsAllCovered: x.filter((v) => !v.missingBeats.length).length,
    pagesPassed: `${x.reduce((s, v) => s + v.pagesPassed, 0)}/${x.reduce((s, v) => s + v.pages, 0)}`,
    booksAllPagesPass: x.filter((v) => v.pagesPassed === v.pages).length,
    violations: viol, warnings: warn,
    questionTailParagraphs: `${x.reduce((s, v) => s + v.simplified.split(/\n\s*\n/).filter((p) => /[?？]\s*$/.test(p.trim())).length, 0)}/${x.reduce((s, v) => s + v.labeledBeats, 0)}`,
    dialogueMean: +avg(x.map((v) => (v.simplified.match(/["“][^"”]+["”]/g) || []).length)).toFixed(1),
    ...(lang === 'en' ? { outOfVocabRatio: +(oovWords.reduce((s, [o]) => s + o, 0) / oovWords.reduce((s, [, w]) => s + w, 0)).toFixed(3), grammarWordsTop: Object.entries(grammarWords).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([w, n]) => `${w}:${n}`).join(' ') } : {}),
  };
}
out.child = { pass: rows.filter((r) => r.child?.pass).length, curiosityPass: rows.filter((r) => r.child?.curiosity?.pass).length, curiosityMean: +avg(rows.map((r) => r.child?.curiosity?.overall ?? 0)).toFixed(2), retellPass: rows.filter((r) => r.child?.retell?.pass).length };
console.log(JSON.stringify(out, null, 1));
