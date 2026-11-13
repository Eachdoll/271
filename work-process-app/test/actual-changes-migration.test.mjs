import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localEnvironment } from '../local.mjs';
test('0008 keeps existing actuals and voids untouched and starts with no change requests', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-changes-migration-'));
  let db = new DatabaseSync(path.join(dir, 'app.db'));
  try {
    db.exec('CREATE TABLE _local_migrations(name TEXT PRIMARY KEY)');
    const folder = new URL('../drizzle/', import.meta.url);
    for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.sql') && f < '0008').sort()) { db.exec(fs.readFileSync(new URL(file, folder), 'utf8')); db.prepare('INSERT INTO _local_migrations VALUES(?)').run(file); }
    db.prepare("INSERT INTO users(name,pw_salt,pw_hash,is_admin,roles) VALUES('기존','s','h',1,'production')").run();
    db.prepare("INSERT INTO schedules(kind,period,start_date,product,qty) VALUES('finished','day','2026-11-01','기존',10)").run();
    db.prepare("INSERT INTO production_actuals(schedule_id,production_date,qty,author_name,request_id) VALUES(1,'2026-11-01',7,'기존','old-request-0000001')").run();
    db.prepare("INSERT INTO production_actuals(schedule_id,production_date,qty,author_name,voided_at,voided_by,void_reason) VALUES(1,'2026-11-01',3,'기존','2026-11-02 09:00:00','기존','중복')").run();
    db.close(); ({ sqlite: db } = localEnvironment(dir, 'test'));
    const rows = db.prepare('SELECT * FROM production_actuals ORDER BY id').all();
    assert.deepEqual(rows.map(r => [r.qty, r.voided_at, r.corrected_at]), [[7, null, null], [3, '2026-11-02 09:00:00', null]]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM production_actual_changes').get().n, 0);
    assert.equal(db.prepare('SELECT roles FROM users').get().roles, 'production');
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
