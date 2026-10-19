// 사용: FAMILY_SIGNUP_CODE=<20자 이상 무작위 초대 코드> node scripts/r11-family-e2e.mjs [포트=4800] — dist와 실제 server/cloud-api.js(메모리 D1·R2)를 127.0.0.1에 띄웁니다.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const port = Number(process.argv[2] || process.env.PORT || 4800);
const signupCode = process.env.FAMILY_SIGNUP_CODE || "";
if (signupCode.trim().length < 20)
  console.warn(
    "FAMILY_SIGNUP_CODE가 20자보다 짧거나 없어요: 가족 계정 만들기는 닫힌 상태(signup_closed)로 동작해요.",
  );
const { handleCloudRequest } = await import(
  path.join(root, "server/cloud-api.js")
);

// D1: in-memory node:sqlite from server/cloud-schema.sql. R2: an in-memory Map.
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(fs.readFileSync(path.join(root, "server/cloud-schema.sql"), "utf8"));
const DB = {
  prepare(sql) {
    const statement = sqlite.prepare(sql);
    return {
      bind(...args) {
        return {
          async first() {
            return statement.get(...args) || null;
          },
          async all() {
            return { results: statement.all(...args) };
          },
          async run() {
            return { meta: { changes: Number(statement.run(...args).changes) } };
          },
        };
      },
    };
  },
};
const objects = new Map();
async function bytesOf(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (typeof value === "string") return new TextEncoder().encode(value);
  return new Uint8Array(await new Response(value).arrayBuffer());
}
const BUCKET = {
  async put(key, value, options = {}) {
    objects.set(key, { bytes: await bytesOf(value), options });
    return {};
  },
  async get(key) {
    const record = objects.get(key);
    if (!record) return null;
    const { bytes, options } = record;
    return {
      body: new Blob([bytes]).stream(),
      size: bytes.byteLength,
      httpMetadata: options.httpMetadata,
      customMetadata: options.customMetadata,
      arrayBuffer: async () => bytes.slice().buffer,
      text: async () => new TextDecoder().decode(bytes),
      json: async () => JSON.parse(new TextDecoder().decode(bytes)),
    };
  },
  async head(key) {
    const record = objects.get(key);
    return record ? { size: record.bytes.byteLength } : null;
  },
  async delete(key) {
    objects.delete(key);
  },
};
const env = { DB, BUCKET, FAMILY_SIGNUP_CODE: signupCode };
const log = [];
const count = (table) =>
  Number(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};
function sendJSON(res, value) {
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    // Test-only reads: cloud requests seen (tagged by X-E2E-Device) and row counts.
    if (url.pathname === "/__test/log") return sendJSON(res, log);
    if (url.pathname === "/__test/state")
      return sendJSON(res, {
        accounts: count("family_accounts"),
        sessions: count("family_sessions"),
        libraries: count("cloud_libraries"),
        assets: count("cloud_assets"),
        objects: objects.size,
      });
    if (url.pathname === "/api/cloud" || url.pathname.startsWith("/api/cloud/")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const headers = new Headers();
      // Sites (ChatGPT) identity headers from the browser are dropped, as the
      // platform does; this server never injects one.
      for (const [name, value] of Object.entries(req.headers))
        if (!name.startsWith("oai-authenticated"))
          headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      const request = new Request(url.href, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method)
          ? undefined
          : Buffer.concat(chunks),
      });
      const response = await handleCloudRequest(request, env, {});
      log.push({
        device: req.headers["x-e2e-device"] || "",
        method: req.method,
        path: url.pathname + url.search,
        status: response.status,
      });
      const body = Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(body);
      return;
    }
    if (/^\/sign(?:in|out)-with-chatgpt$/.test(url.pathname)) {
      res.writeHead(302, { location: "/" });
      res.end();
      return;
    }
    let file = path.join(dist, decodeURIComponent(url.pathname));
    if (!file.startsWith(dist)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory())
      file = path.join(file, "index.html");
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type":
        types[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(String(error?.message || error));
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`r11-family-e2e: http://127.0.0.1:${port}/`),
);
const stop = () => server.close(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
