// Free replay of the R55e English-merge defect. No API credentials or paid calls.
import fs from 'node:fs';
import {fitSpreadMarks} from '../../dist/story-generation/writers-room.js';
import {splitSentences} from '../../dist/story-quality/dist/util.js';
const fixture=JSON.parse(fs.readFileSync(new URL('./source-draft.json',import.meta.url),'utf8'));
const fit=fitSpreadMarks(structuredClone(fixture.draft),fixture.openings,{cap:fixture.koCap});
console.log(JSON.stringify({entries:fit.pages.length,marks:fit.marks,lastKo:splitSentences(fit.pages.at(-1).ko).length,lastEn:splitSentences(fit.pages.at(-1).en).length,englishCap:fixture.enCap},null,2));
