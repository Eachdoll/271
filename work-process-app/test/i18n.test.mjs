// 언어 전환 (15.31): the translator works on rendered Korean text; dictionaries cover the same keys with intact placeholders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = name => fs.readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
const engine = () => { const c = vm.createContext({}); vm.runInContext(read('i18n.js') + ';globalThis.make = i18nTranslator; globalThis.langs = I18N_LANGS;', c); return c; };
const dictOf = lang => { const c = vm.createContext({ window: {} }); vm.runInContext(read(`i18n-${lang}.js`), c); return c.window.I18N_DICT; };

test('Translator: exact text, required mark, templates, inserted names, and untouched data', () => {
  const t = engine().make({ '저장': 'Save', '작업일': 'Work date', '{0}건 조회': '{0} found', '{0} 생산일정': '{0} schedule', '완제품': 'Finished', '계정을 만들었습니다.': 'account created.', '{0}건': '{0} items', '합계 ({0}회)': 'Total ({0} runs)' });
  assert.equal(t('저장'), 'Save'); assert.equal(t('  작업일 * '), '  Work date * ');
  assert.equal(t('12건 조회'), '12 found'); assert.equal(t('완제품 생산일정'), 'Finished schedule'); assert.equal(t('합계 (3회)'), 'Total (3 runs)');
  assert.equal(t('염건영 계정을 만들었습니다.'), '염건영 account created.');
  assert.equal(t('1,200건'), '1,200 items'); assert.equal(t('긴급 건'), '긴급 건', 'a one-syllable template only takes numbers');
  assert.equal(t('부직포 원단'), '부직포 원단', 'unknown text (user data) stays'); assert.equal(t('NX-707'), 'NX-707'); assert.equal(t(''), '');
});

test('Every language file has the same keys, non-empty values and the same placeholders', () => {
  const langs = Object.keys(engine().langs).filter(l => l !== 'ko'); assert.deepEqual(langs, ['en', 'vi', 'km', 'zh']);
  const base = Object.keys(dictOf('en')).sort(); assert.ok(base.length > 1500, 'dictionary is filled');
  const holders = s => (s.match(/\{\d+\}/g) || []).sort().join();
  for (const lang of langs) {
    const dict = dictOf(lang); assert.deepEqual(Object.keys(dict).sort(), base, lang);
    for (const [key, value] of Object.entries(dict)) { assert.ok(typeof value === 'string' && value.trim(), `${lang}: ${key}`); assert.equal(holders(value), holders(key), `${lang}: ${key}`); }
  }
  for (const key of ['저장', '로그인', '세탁수량', '발주목록', '제품등록']) assert.ok(base.includes(key), key);
});

test('15.51 messages: a retried save, per-unit totals and the save total translate', () => {
  const t = engine().make(dictOf('en'));
  assert.match(t('MR-261115-01 생산의뢰는 앞서 이미 등록되었습니다. 저장된 내용을 엽니다. 고칠 내용이 있으면 「수정」을 누르세요.'), /^Production request MR-261115-01 was already registered/);
  assert.match(t('PR-261115-01 구매의뢰는 앞서 이미 상신되었습니다. 저장된 내용을 엽니다.'), /^Purchase request PR-261115-01 was already submitted/);
  assert.equal(t('합계 (BOX) · 의뢰 20 · 계획 0 · 생산 0'), 'Total (BOX) · Requested 20 · Planned 0 · Production 0');
  assert.doesNotMatch(t('합계 수량 20 BOX · 500 매 · 2줄'), /[가-힣]/);
  for (const text of ['초안 보관됨 · 이 탭에서만 보관됩니다. 사진은 다시 첨부하세요.', '보관된 입력 초안이 있습니다. · 이 탭에서만 보관됩니다.', '입력 내용은 이 탭에 자동 보관됩니다.']) assert.doesNotMatch(t(text), /[가-힣]/, text);
});
