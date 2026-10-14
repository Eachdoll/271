import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { generateImage } from '../dist/image-generation/providers.js';
import { translateWardrobeWithGoogle } from '../dist/wardrobe-translation.js';

const KEY_ENV = Object.freeze({ google: 'GOOGLE_IMAGE_API_KEY', openai: 'OPENAI_API_KEY', bfl: 'BFL_API_KEY', fal: 'FAL_KEY', local: 'COMFYUI_API_KEY' });
const ENDPOINT_ENV = Object.freeze({ google: 'GOOGLE_IMAGE_ENDPOINT', openai: 'OPENAI_IMAGE_ENDPOINT', bfl: 'BFL_IMAGE_ENDPOINT', fal: 'FAL_IMAGE_ENDPOINT', local: 'COMFYUI_BASE_URL' });

function proxyError(status, message) { const error = new Error(message); error.status = status; return error; }
function originsFromEnv(env) {
  return new Set(String(env.IMAGE_PROXY_ALLOWED_ORIGINS || 'http://127.0.0.1:8080,http://localhost:8080').split(',').map(value => value.trim()).filter(Boolean));
}
function rejectCredentials(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(apiKey|api_key|key|token|authorization|password|pin)$/i.test(key)) throw proxyError(400, '프록시 요청에 인증 정보를 넣을 수 없어요. 서버 환경변수에만 설정해 주세요.');
    rejectCredentials(child);
  }
}
async function readBody(request, limit) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw proxyError(415, 'JSON 요청만 받을 수 있어요.');
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw proxyError(413, '참조 이미지 요청이 너무 커요. 이미지 크기를 줄여 주세요.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw proxyError(400, '요청 JSON을 읽을 수 없어요.'); }
}
function respond(response, status, payload, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
  if (origin) { headers['Access-Control-Allow-Origin'] = origin; headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'; headers['Access-Control-Allow-Headers'] = 'Content-Type'; }
  response.writeHead(status, headers);
  response.end(status === 204 ? '' : JSON.stringify(payload));
}

/** Loopback service. Credentials are read exclusively from its environment. */
export function createImageProxyHandler({ env = process.env, generate = generateImage, translate = translateWardrobeWithGoogle, maxBodyBytes = 70 * 1024 * 1024 } = {}) {
  const allowedOrigins = originsFromEnv(env);
  return async (request, response) => {
    let origin;
    try {
      const claimedOrigin = request.headers.origin;
      if (claimedOrigin && !allowedOrigins.has(claimedOrigin)) throw proxyError(403, '이 앱 주소의 프록시 접근이 허용되지 않았어요.');
      origin = claimedOrigin;
      const path = new URL(request.url, 'http://localhost').pathname;
      const match = path.match(/^\/api\/image\/(google|openai|bfl|fal|local)$/);
      const translation = path === '/api/translate/wardrobe/google';
      if (!match && !translation) throw proxyError(404, '이미지 엔진 주소를 확인해 주세요.');
      if (request.method === 'OPTIONS') { respond(response, 204, null, origin); return; }
      if (request.method !== 'POST') throw proxyError(405, 'POST 이미지 요청만 받을 수 있어요.');
      const engine = translation ? 'google' : match[1];
      const payload = await readBody(request, translation ? 4096 : maxBodyBytes);
      rejectCredentials(payload);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw proxyError(400, '이미지 요청 형식이 올바르지 않아요.');
      if (translation) {
        if (Object.keys(payload).some(key=>key!=='description') || typeof payload.description!=='string' || !payload.description.trim() || payload.description.length>500) throw proxyError(400,'옷·소품·머리 설명을 500자 이하로 보내 주세요.');
        if (!env.GOOGLE_IMAGE_API_KEY) throw proxyError(503,'서버 환경변수에 Google API 키를 설정해 주세요.');
        const controller=new AbortController();
        const close=()=>{if(!response.writableEnded)controller.abort();};
        response.once('close',close);
        try {
          const result=await translate(payload.description,{config:{apiKey:env.GOOGLE_IMAGE_API_KEY,...(env.GOOGLE_IMAGE_ENDPOINT?{endpoint:env.GOOGLE_IMAGE_ENDPOINT}:{})},signal:controller.signal,approved:true});
          if (!response.destroyed) respond(response,200,result,origin);
        } finally { response.removeListener('close',close); }
        return;
      }
      const references = payload.referenceImages || [];
      if (!Array.isArray(references) || references.length > 30 || references.some(ref => typeof ref?.dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(ref.dataUrl))) throw proxyError(400, '참조 이미지는 PNG·JPEG·WebP 데이터로 보내 주세요.');
      const config = {
        apiKey: env[KEY_ENV[engine]] || undefined,
        ...(env[ENDPOINT_ENV[engine]] ? { endpoint: env[ENDPOINT_ENV[engine]] } : {}),
        googlePro: payload.googlePro === true,
        modelVariant: payload.modelVariant === 'pro' ? 'pro' : undefined,
      };
      if (engine === 'local') {
        if (env.COMFYUI_WORKFLOW_JSON) { try { config.workflow = JSON.parse(env.COMFYUI_WORKFLOW_JSON); } catch { throw proxyError(503, '서버의 ComfyUI 워크플로 JSON을 확인해 주세요.'); } }
        else throw proxyError(503, '서버 환경변수 COMFYUI_WORKFLOW_JSON에 API 워크플로를 설정해 주세요.');
      } else if (!config.apiKey) throw proxyError(503, '서버 환경변수에 이 엔진의 API 키를 설정해 주세요.');
      const controller = new AbortController();
      const close = () => { if (!response.writableEnded) controller.abort(); };
      response.once('close', close);
      try {
        const result = await generate({ scenePrompt: payload.scenePrompt, stylePrompt: payload.stylePrompt, negativePrompt: payload.negativePrompt, stylePreset: payload.stylePreset, referenceImages: references, seed: payload.seed, size: payload.size, quality: payload.quality, signal: controller.signal }, { engine, config });
        if (response.destroyed) return;
        respond(response, 200, { imageUrl: result.imageUrl, seed: result.seed, model: result.meta.model, meta: result.meta, ...(result.meta.costUsd !== undefined ? { cost_usd: result.meta.costUsd } : {}) }, origin);
      } finally { response.removeListener('close', close); }
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;
      // Never include provider response bodies, URLs, stack traces or keys.
      const status = error.status || (error.name === 'ImageGenerationError' ? 502 : 500);
      const message = error.status ? error.message : '이미지 요청을 처리하지 못했어요. 서버의 엔진 설정과 사용량을 확인해 주세요.';
      respond(response, status, { error: message }, origin);
    }
  };
}

export function startImageProxy({ env = process.env } = {}) {
  const server = http.createServer(createImageProxyHandler({ env }));
  // Bind only to the local device. No public key-bearing endpoint by default.
  server.listen(Number(env.IMAGE_PROXY_PORT) || 8787, '127.0.0.1');
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startImageProxy();
