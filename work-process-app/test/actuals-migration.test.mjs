import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localEnvironment } from '../local.mjs';
test('Multi-item migration preserves old accounts and completed plans without inventing production actuals',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'actuals-migration-'));let db=new DatabaseSync(path.join(dir,'app.db'));
 try {
  db.exec('CREATE TABLE _local_migrations(name TEXT PRIMARY KEY)');
  const folder=new URL('../drizzle/',import.meta.url);
  for(const file of fs.readdirSync(folder).filter(f=>f.endsWith('.sql')&&f<'0007').sort()) {db.exec(fs.readFileSync(new URL(file,folder),'utf8'));db.prepare('INSERT INTO _local_migrations VALUES(?)').run(file);}
  db.prepare('INSERT INTO users(name,pw_salt,pw_hash,is_admin,roles) VALUES(?,?,?,?,?)').run('기존관리자','salt','hash',1,'quality_approver');
  db.prepare('INSERT INTO schedules(kind,period,start_date,product,qty,done,created_by) VALUES(?,?,?,?,?,?,?)').run('finished','day','2026-11-13','기존완제품',100,1,'기존관리자');
  db.prepare('INSERT INTO laundry(in_date,in_qty,discard_qty,note,photos,created_by) VALUES(?,?,?,?,?,?)').run('2026-11-13',10,1,'기존사진','["file.png"]','기존관리자');
  db.close();({sqlite:db}=localEnvironment(dir,'test'));
  const plan=db.prepare('SELECT * FROM schedules').get();assert.equal(plan.qty,100);assert.equal(plan.done,1);assert.equal(plan.product,'기존완제품');assert.equal(plan.batch_id,'');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM production_actuals').get().n,0);assert.equal(db.prepare('SELECT roles FROM users').get().roles,'quality_approver');
  assert.equal(db.prepare('SELECT photos FROM laundry').get().photos,'["file.png"]');assert.equal(db.prepare('SELECT item FROM laundry').get().item,'');
 } finally {db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
