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
