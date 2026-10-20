import test from 'node:test';
import assert from 'node:assert/strict';
import {jobTextBudget, councilDecisionCosts, estimateStoryTextCost} from '../dist/text-generation/models.js';
import {getTextGenerationSettings} from '../dist/text-generation/settings-ui.js';
import {budgetUsd, jobBudgetSummary, renderCouncilBudget} from '../dist/story-generation/council-room.js';
import {groupCheckIssues, renderChecksPanel} from '../dist/checks-panel.js';

/** R24 화면 마무리: one text budget, one money format, repeated notes grouped. */
const settings = () => getTextGenerationSettings({settings: {textGeneration: {engine: 'openai'}}});
const jobOf = (extra = {}) => ({
  input: {pageCount: 12, councilPolicy: {version: 1}, editorPolicy: {version: 1}},
  textSettings: settings(),
  planMode: 'auto',
  completed: {},
  usage: {calls: []},
  ...extra,
});
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('R24 jobTextBudget: the unfinished steps are what remains, the saved calls are what was spent', () => {
  const job = jobOf(),
    full = estimateStoryTextCost({settings: job.textSettings, pageCount: 12, editor: true, council: true}),
    fresh = jobTextBudget(job);
  assert.equal(fresh.usedUsd, 0);
  assert.equal(fresh.stages[0].stage, 'plan');
  close(fresh.remainingUsd, full.costUsd + fresh.stages[0].costUsd);
  // The material plan and the outline (with the meeting) are done.
  job.completed = {input: 'x', plan: 'x', outline: 'x'};
  job.usage.calls.push({requests: 1, costUsdEstimated: 0.4});
  const later = jobTextBudget(job),
    gone = full.stages.filter((row) => ['council', 'outline'].includes(row.stage)).reduce((sum, row) => sum + row.costUsd, 0);
  close(later.remainingUsd, full.costUsd - gone);
  assert.equal(later.usedUsd, 0.4);
  // The prose check is half of the review row; pagination takes the other half.
  job.completed.proseCoherence = 'x';
  const review = full.stages.find((row) => row.stage === 'coherence').costUsd;
  close(jobTextBudget(job).remainingUsd, later.remainingUsd - review / 2);
  for (const key of ['briefs', 'prose', 'enrichment', 'pagination']) job.completed[key] = 'x';
  assert.equal(jobTextBudget(job).remainingUsd, 0);
  assert.equal(jobTextBudget({...job, demo: true}).remainingUsd, 0);
});

test('R24 a parked meeting owes only the bible call, and the panel and ③ use the same numbers', () => {
  const job = jobOf({status: 'council-review', completed: {input: 'x', plan: 'x'}}),
    budget = jobTextBudget(job),
    council = estimateStoryTextCost({settings: job.textSettings, pageCount: 12, editor: true, council: true}).stages.find((row) => row.stage === 'council');
  close(budget.stages.find((row) => row.stage === 'council').costUsd, council.costUsd / council.requestCount);
  assert.ok(!budget.stages.some((row) => row.stage === 'plan'));
  const decision = councilDecisionCosts(job);
  close(decision.continueUsd, budget.remainingUsd);
  close(decision.meetingUsd, council.costUsd);
  const remaining = budgetUsd(budget.remainingUsd);
  assert.ok(renderCouncilBudget(job).includes(remaining));
  assert.ok(jobBudgetSummary(job).includes(`남은 예상 ${remaining}`));
  assert.match(jobBudgetSummary(job), /쓴 금액 아직 없음/);
});

test('R24 one money format: two decimals from ten cents, three below, honest unknowns', () => {
  assert.equal(budgetUsd(1.234), '약 $1.23');
  assert.equal(budgetUsd(0.0349), '약 $0.035');
  assert.equal(budgetUsd(0, false, {empty: '아직 없음'}), '아직 없음');
  assert.equal(budgetUsd(0), '약 $0');
  assert.equal(budgetUsd(0, true), '요금 정보 없음');
  assert.equal(budgetUsd(0.5, true), '약 $0.50 · 일부 요금 미확인');
});

test('R24 the same note on several pages is one line with a button per page', () => {
  const book = {pages: Array.from({length: 6}, () => ({ko: '', en: ''}))},
    note = {code: 'x', message: '소품이 장면 설명에 없어요', severity: 'warning'},
    groups = groupCheckIssues(book, [{...note, pageNo: 5}, {...note, pageNo: 2}, {...note, pageNo: 5}, {message: '다른 지적', pageNo: 1, severity: 'warning'}]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].pages.map((page) => page.index), [1, 4]);
  const html = renderChecksPanel({...book, storyCheck: {checks: [{passed: false, label: '사건', violations: [{...note, pageNo: 2}, {...note, pageNo: 4}]}]}}, {tab: 'events'});
  assert.equal((html.match(/<li /g) || []).length, 1);
  assert.match(html, /2곳/);
  assert.equal((html.match(/data-action="edit-page"/g) || []).length, 2);
});
