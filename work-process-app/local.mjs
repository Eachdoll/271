// Local-only adapters. Production uses native D1/R2; these never enter the build.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
export function localEnvironment(dataDir, inviteCode) {
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  const sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS _local_migrations(name TEXT PRIMARY KEY);');
  for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter(f => f.endsWith('.sql')).sort()) {
    if (sqlite.prepare('SELECT 1 FROM _local_migrations WHERE name=?').get(file)) continue;
    sqlite.exec('BEGIN');
    try {
      sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8'));
      sqlite.prepare('INSERT INTO _local_migrations VALUES(?)').run(file);
      sqlite.exec('COMMIT');
    } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  }
  function prepare(sql) {
    let args = [];
    const executeAll = () => {
      const results = sqlite.prepare(sql).all(...args);
      const meta = sqlite.prepare('SELECT changes() AS changes, last_insert_rowid() AS last_row_id').get();
      return { results, success: true, meta };
    };
    return {
      bind(...values) { args = values; return this; },
      async first() { return sqlite.prepare(sql).get(...args) || null; },
      async all() { return executeAll(); },
      executeAll,
      async run() { const r = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    };
  }
  const DB = { prepare, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const out = statements.map(s => s.executeAll()); sqlite.exec('COMMIT'); return out; }
    catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  } };
  const filePath = key => {
    if (!/^[a-f0-9]{24}\.(jpg|png|webp)$/.test(key)) throw new Error('Invalid object key');
    return path.join(dataDir, 'uploads', key);
  };
  const BUCKET = {
    async put(key, bytes) { fs.writeFileSync(filePath(key), new Uint8Array(bytes)); },
    async get(key) {
      if (!fs.existsSync(filePath(key))) return null;
      return { body: fs.readFileSync(filePath(key)), httpMetadata: { contentType: ({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[key.split('.').pop()] } };
    },
    async delete(key) { fs.rmSync(filePath(key), { force: true }); },
  };
  const ASSETS = { async fetch(req) {
    const pathname = new URL(req.url).pathname;
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!['index.html', 'app.js', 'forms.js', 'reports.js', 'comments.js', 'multi-items.js', 'stock.js', 'style.css', 'assets/seoulsemi-logo-blue.png'].includes(name)) return new Response('Not found', { status: 404 });
    return new Response(req.method === 'HEAD' ? null : fs.readFileSync(path.join(root, 'public', name)), { headers: { 'Content-Type': name.endsWith('.png') ? 'image/png' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
  } };
  return { env: { DB, BUCKET, ASSETS, INVITE_CODE: inviteCode }, sqlite };
}
