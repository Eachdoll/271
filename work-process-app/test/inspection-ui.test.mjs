import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';
const c=vm.createContext({esc:x=>String(x??'').replace(/</g,'&lt;').replace(/>/g,'&gt;'),fmtNum:n=>String(n)});
vm.runInContext(fs.readFileSync(new URL('../public/inspections.js',import.meta.url),'utf8'),c);
test('Inspection preview checks every MD/CD value and treats zero, blanks and boundaries correctly',()=>{
  const spec={items:[{key:'i0',name:'MD',unit:'초',min:0,max:60,count:2},{key:'i1',name:'CD',unit:'초',min:0,max:60,count:2}]};
  const row=(a,b,c,d)=>[{lot:'lot',values:{i0:[a,b],i1:[c,d]}}];
  assert.equal(c.inspectionPreview(spec,row(0,60,60,0)),'pass');assert.equal(c.inspectionPreview(spec,row(0,'',20,30)),'pending');assert.equal(c.inspectionPreview(spec,row(1,1,1,61)),'fail');assert.equal(c.inspectionPreview(spec,row('',1,1,61)),'fail');
  const html=c.inspectionMatrix(spec,[{lot:'<img onerror=x>',values:{i0:[1,61],i1:[1,null]}}]);assert.ok(!html.includes('<img'));assert.match(html,/red-text/);assert.match(html,/미입력/);
});
test('Inspection migration adds only empty structures and preserves old request values',()=>{
  const db=new DatabaseSync(':memory:');const root=new URL('../drizzle/',import.meta.url);
  for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.sql')&&!f.startsWith('0022')).sort())db.exec(fs.readFileSync(new URL(file,root),'utf8'));
  db.exec("INSERT INTO requests(type,title,category,status,data,result_note) VALUES('analysis','기존 원단','수입검사','done','{\"item_category\":\"상품\"}','기존 수기 결과')");
  const old=db.prepare('SELECT * FROM requests').get();db.exec(fs.readFileSync(new URL('0022_quality_inspections.sql',root),'utf8'));
  const next=db.prepare('SELECT * FROM requests').get();assert.equal(next.inspection_snapshot,'');delete next.inspection_snapshot;assert.deepEqual(next,old);assert.equal(db.prepare('SELECT COUNT(*) n FROM inspection_specs').get().n,0);db.close();
});
