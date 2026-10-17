import test from 'node:test';
import assert from 'node:assert/strict';
import {collectBookChecks,renderChecksPanel} from '../dist/checks-panel.js';
import {renderReadingBadge} from '../dist/reading-ui.js';
test('B-5 check groups retain distinct counts, severity and page anchors and escape generated text',()=>{
 const book={pages:[{},{},{}],readingCheck:{pages:[{passed:true},{passed:false}]},storyCheck:{checks:[{passed:false,label:'사건',violations:[{pageNo:3,message:'사건 확인'}]}]},richnessCheck:{issues:[{pageNo:2,message:'감각 확인'}]},pageCoherence:{issues:[{pageNo:3,severity:'error',message:'<script>bad</script>'}]}};
 assert.deepEqual(collectBookChecks(book).map(group=>group.items.length),[1,1,1,1]);const html=renderChecksPanel(book,{tab:'coherence'});assert.match(html,/check-blocked/);assert.match(html,/data-page="2"/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});
test('B-5 malformed page numbers cannot create NaN editor navigation',()=>{const html=renderChecksPanel({pages:[{}],pageCoherence:{issues:[{pageNo:'all',message:'전체 확인'}]}},{tab:'coherence'});assert.doesNotMatch(html,/NaN/);assert.match(html,/data-page="0"/);});
test('B-6 compact reading levels retain the estimated-score caveat in the tooltip',()=>{const html=renderReadingBadge({koreanLevel:'K2',englishLevel:'E1',readingScore:{approxAR:1.5,approxLexile:250}},{compact:true});assert.match(html,/K2 · E1/);assert.match(html,/title=".*AR 약 1.5.*250L.*공식 점수 아님/);assert.doesNotMatch(html,/<small>/);});
test('R2-2 structured reading violations use Korean descriptions and other checks share the fallback',async()=>{
 const book={pages:[{}],readingCheck:{pages:[{passed:false,ko:{violations:[{code:'sentence-count',language:'ko',actual:3,expected:{min:1,max:2}}]}}]},richnessCheck:{issues:[{code:'unknown-richness',actual:0,expected:{min:1,max:3}}]},pageCoherence:{issues:[{code:'unknown-coherence',actual:['home'],expected:['forest']}]}};
 const {describeReadingViolation}=await import('../dist/reading-ui.js');assert.equal(describeReadingViolation({code:'out-of-vocabulary',language:'en',actual:1/3,max:0.15}),'영어 등급 외 어휘 비율 33.3% (최대 15%)');
 const reading=renderChecksPanel(book);assert.match(reading,/한글 문장 수 3 \(허용 1~2\)/);assert.doesNotMatch(reading,/\[object Object\]/);
 for(const tab of ['richness','coherence']){const html=renderChecksPanel(book,{tab});assert.match(html,/실제.*허용/);assert.doesNotMatch(html,/\[object Object\]/);}
});
