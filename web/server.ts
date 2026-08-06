import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

import {
  DEFAULT_PRODUCT_LIMIT,
  MAX_PRODUCT_LIMIT,
  STORE_ID_PLACEHOLDER,
  STORE_URL_EXAMPLE,
} from "../store-watch-core/src/const";
import { fetchLatestProducts } from "../store-watch-core/src/naverClient";
import { mergeStoreFeed } from "../store-watch-core/src/mergeStoreFeed";
import { parseStoreInput, toStoreKey } from "../store-watch-core/src/parseStoreInput";
import type {
  SmartStoreErrorCode,
  SmartStoreSnapshot,
} from "../store-watch-core/src/types";

import { demoSnapshot, demoStoreIds } from "./src/demoFixture";
import { allowRequest } from "./src/rateLimit";
import { invalidate, readCached, writeCached } from "./src/snapshotCache";

/**
 * store-watch-core 위에 얹은 최소 서버.
 *
 * 브라우저에서 네이버를 직접 부르면 CORS로 막히기 때문에 서버를 한 단계 둡니다.
 * 프레임워크는 쓰지 않습니다 — 개인 도구라 라우팅 한 줌이면 충분하고,
 * 코어가 프레임워크에 묶이지 않는다는 성질도 그대로 지킬 수 있습니다.
 */

const PORT = Number(process.env.PORT ?? 5173);
const DEMO = process.env.DEMO === "1";
const PUBLIC_DIR = join(__dirname, "public");

/** 스토어 한 건의 조회 결과 요약 (화면 상단 칩에 그대로 씁니다) */
interface StoreOutcome {
  input: string;
  key?: string;
  displayName?: string;
  storeUrl?: string;
  count: number;
  ok: boolean;
  code?: SmartStoreErrorCode;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error);
    sendJson(res, 500, { error: "INTERNAL" });
  });
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/api/config") {
    sendJson(res, 200, {
      demo: DEMO,
      demoStores: DEMO ? demoStoreIds() : [],
      placeholder: STORE_ID_PLACEHOLDER,
      example: STORE_URL_EXAMPLE,
      defaultLimit: DEFAULT_PRODUCT_LIMIT,
      maxLimit: MAX_PRODUCT_LIMIT,
    });
    return;
  }

  if (url.pathname === "/api/feed") {
    await handleFeed(url, req, res);
    return;
  }

  await serveStatic(url.pathname, res);
}

async function handleFeed(
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const now = Date.now();
  const clientKey = clientAddress(req);
  const refresh = url.searchParams.get("refresh") === "1";

  const limit = clampLimit(url.searchParams.get("limit"));
  const inputs = (url.searchParams.get("stores") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 20);

  const outcomes: StoreOutcome[] = [];
  const snapshots: SmartStoreSnapshot[] = [];

  for (const input of inputs) {
    // 신뢰 경계. 검증을 통과한 ref만 아래로 내려갑니다.
    const parsed = parseStoreInput(input);
    if (!parsed.ok) {
      outcomes.push({ input, count: 0, ok: false, code: "INVALID_INPUT" });
      continue;
    }

    const { ref } = parsed;
    const key = toStoreKey(ref);

    if (refresh) invalidate(ref);

    const cached = readCached(ref, now);
    if (cached) {
      snapshots.push(cached);
      outcomes.push({
        input,
        key,
        displayName: cached.store.displayName,
        storeUrl: cached.store.storeUrl,
        count: cached.products.length,
        ok: true,
      });
      continue;
    }

    const demo = DEMO ? demoSnapshot(ref, limit, now) : undefined;
    if (demo) {
      writeCached(ref, demo, now);
      snapshots.push(demo);
      outcomes.push({
        input,
        key,
        displayName: demo.store.displayName,
        storeUrl: demo.store.storeUrl,
        count: demo.products.length,
        ok: true,
      });
      continue;
    }

    // 캐시에 없을 때만 네이버로 나가므로, 제한도 이 시점에만 겁니다.
    const gate = allowRequest(clientKey, now);
    if (!gate.allowed) {
      res.setHeader("Retry-After", String(gate.retryAfterSec));
      outcomes.push({ input, key, count: 0, ok: false, code: "RATE_LIMITED" });
      continue;
    }

    const result = await fetchLatestProducts(ref, limit);
    if (!result.success) {
      outcomes.push({ input, key, count: 0, ok: false, code: result.code });
      continue;
    }

    writeCached(ref, result.data, now);
    snapshots.push(result.data);
    outcomes.push({
      input,
      key,
      displayName: result.data.store.displayName,
      storeUrl: result.data.store.storeUrl,
      count: result.data.products.length,
      ok: true,
    });
  }

  sendJson(res, 200, {
    demo: DEMO,
    fetchedAt: new Date(now).toISOString(),
    stores: outcomes,
    products: mergeStoreFeed(snapshots),
  });
}

function clampLimit(raw: string | null): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PRODUCT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_PRODUCT_LIMIT);
}

/** 개인 도구라 프록시를 전제하지 않습니다. 신뢰할 수 없는 헤더는 보지 않습니다. */
function clientAddress(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");

  // 경로 탈출 차단: 정규화 후에도 public 안에 있어야 합니다.
  const target = normalize(join(PUBLIC_DIR, relative));
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + sep)) {
    sendText(res, 403, "forbidden");
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) {
      sendText(res, 404, "not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[extname(target)] ?? "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": "no-cache",
    });
    createReadStream(target).pipe(res);
  } catch {
    sendText(res, 404, "not found");
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

server.listen(PORT, () => {
  console.log(`store-watch  http://localhost:${PORT}${DEMO ? "  (DEMO)" : ""}`);
});
