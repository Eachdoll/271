// Local development/test entrypoint. Sites deploys worker.mjs instead.
'use strict';
const http = require('node:http');
const path = require('node:path');
const { Readable } = require('node:stream');
let sqlite;
const ready = Promise.all([import('./worker.mjs'), import('./local.mjs')]).then(([{ default: worker }, { localEnvironment }]) => {
  const local = localEnvironment(path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data')), process.env.INVITE_CODE);
  sqlite = local.sqlite;
  return { worker, env: local.env };
});
const server = http.createServer(async (req, res) => {
  try {
    const { worker, env } = await ready;
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method, headers: req.headers,
      ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: req, duplex: 'half' }),
    });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
  } catch (error) { console.error(error); res.writeHead(500); res.end('Local server error'); }
});
if (require.main === module) {
  ready.then(() => server.listen(Number(process.env.PORT || 3000), () => console.log(`업무프로세스 허브: http://localhost:${server.address().port}`)));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => { sqlite?.close(); process.exit(0); }));
}
module.exports = { server, ready, get db() { return sqlite; } };
