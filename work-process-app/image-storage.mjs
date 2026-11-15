// Private company R2 access via S3 SigV4. No credentials or signed URLs reach the browser.
const imageKey = /^[a-f0-9]{24}\.(jpg|png|webp)$/;
const imageLimit = 8 * 1024 * 1024;
const encoder = new TextEncoder();
const asBytes = value => typeof value === 'string' ? encoder.encode(value) : value;
const digestHex = value => Array.from(new Uint8Array(value), n => n.toString(16).padStart(2, '0')).join('');
const sha256 = async value => digestHex(await crypto.subtle.digest('SHA-256', asBytes(value)));
const uriPart = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
async function hmac(key, value) {
  const imported = await crypto.subtle.importKey('raw', asBytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, asBytes(value)));
}

export async function signS3Request(url, { method = 'GET', headers = {}, body } = {}, credentials, date = new Date()) {
  const target = new URL(url), signed = new Headers(headers);
  const stamp = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  signed.set('host', target.host);
  signed.set('x-amz-date', stamp);
  signed.set('x-amz-content-sha256', await sha256(body ?? new Uint8Array()));
  const names = [...signed.keys()].sort();
  const canonicalHeaders = names.map(name => name + ':' + signed.get(name).trim().replace(/\s+/g, ' ') + '\n').join('');
  const query = [...target.searchParams].map(([key, value]) => [uriPart(key), uriPart(value)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0).map(pair => pair.join('=')).join('&');
  const canonical = [method, target.pathname, query, canonicalHeaders, names.join(';'), signed.get('x-amz-content-sha256')].join('\n');
  const scope = stamp.slice(0, 8) + '/' + credentials.region + '/s3/aws4_request';
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256(canonical)].join('\n');
  const dayKey = await hmac('AWS4' + credentials.secretAccessKey, stamp.slice(0, 8));
  const regionKey = await hmac(dayKey, credentials.region);
  const serviceKey = await hmac(regionKey, 's3');
  const signature = digestHex(await hmac(await hmac(serviceKey, 'aws4_request'), toSign));
  signed.set('authorization', `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`);
  return new Request(target, { method, headers: signed, ...(body === undefined ? {} : { body }), redirect: 'error', signal: AbortSignal.timeout(20000) });
}

async function photoBytes(object) {
  const reader = new Response(object.body).body.getReader();
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > imageLimit) throw new Error('이전할 사진이 8MB 제한을 초과합니다.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function createImageStorage(env, { outbound = fetch, clock = () => new Date() } = {}) {
  const mode = env.R2_STORAGE_MODE || 'native';
  const required = ['R2_S3_ENDPOINT', 'R2_S3_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
  const missing = required.filter(key => !String(env[key] || '').trim());
  function config() {
    if (missing.length) throw new Error('회사 사진 저장소 연결 설정이 필요합니다.');
    const endpoint = new URL(env.R2_S3_ENDPOINT);
    if (!/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com\/?$/.test(env.R2_S3_ENDPOINT) || endpoint.username || endpoint.password) throw new Error('회사 R2 엔드포인트가 올바르지 않습니다.');
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.R2_S3_BUCKET)) throw new Error('회사 R2 버킷 이름이 올바르지 않습니다.');
    return { endpoint, bucket: env.R2_S3_BUCKET, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, region: 'auto' };
  }
  function assertKey(key) { if (!imageKey.test(key)) throw new Error('사진 파일 이름이 올바르지 않습니다.'); }
  function assertMode() { if (!['native', 'external'].includes(mode)) throw new Error('사진 저장소 모드가 올바르지 않습니다.'); }
  async function request(method, key = '', bytes, headers = {}) {
    const settings = config(); if (key) assertKey(key);
    const url = new URL('/' + settings.bucket + (key ? '/' + key : ''), settings.endpoint);
    return outbound(await signS3Request(url, { method, headers, body: bytes }, settings, clock()));
  }
  async function remoteGet(key) {
    const result = await request('GET', key);
    if (result.status === 404) { await result.body?.cancel(); return null; }
    if (!result.ok) { await result.body?.cancel(); throw new Error('회사 사진 저장소 조회 실패 (HTTP ' + result.status + ')'); }
    return { body: result.body, httpMetadata: { contentType: result.headers.get('content-type') || 'application/octet-stream' } };
  }
  async function remotePut(key, bytes, metadata, onlyIfAbsent = false) {
    const headers = { 'content-type': metadata?.contentType || 'application/octet-stream' };
    if (onlyIfAbsent) headers['if-none-match'] = '*';
    const result = await request('PUT', key, bytes, headers);
    await result.body?.cancel();
    if (onlyIfAbsent && result.status === 412) return;
    if (!result.ok) throw new Error('회사 사진 저장소 업로드 실패 (HTTP ' + result.status + ')');
  }
  return {
    status() {
      let error = ''; try { assertMode(); config(); } catch (e) { error = e.message; }
      return { mode, ready: !error, missing, bucket: env.R2_S3_BUCKET || '', message: error };
    },
    async check() {
      const result = await request('HEAD'); await result.body?.cancel();
      if (!result.ok) throw new Error('회사 사진 저장소 연결 실패 (HTTP ' + result.status + ')');
      return { ok: true };
    },
    async put(key, bytes, options) {
      assertKey(key); assertMode();
      return mode === 'external' ? remotePut(key, bytes, options?.httpMetadata) : env.BUCKET.put(key, bytes, options);
    },
    async get(key) {
      assertKey(key); assertMode();
      if (mode === 'native') return env.BUCKET.get(key);
      // Only a confirmed missing object falls back. Authentication/outage errors stay visible.
      return await remoteGet(key) || env.BUCKET.get(key);
    },
    async delete(key) {
      assertKey(key); assertMode();
      if (mode === 'native') return env.BUCKET.delete(key);
      const result = await request('DELETE', key); await result.body?.cancel();
      if (!result.ok && result.status !== 404) throw new Error('회사 사진 저장소 삭제 실패 (HTTP ' + result.status + ')');
      // The original bucket is retained as the migration source; never delete its copies here.
    },
    async copyPage(cursor = '') {
      assertMode(); config();
      if (typeof cursor !== 'string' || cursor.length > 4096) throw new Error('사진 이전 위치가 올바르지 않습니다.');
      if (typeof env.BUCKET.list !== 'function') throw new Error('기존 사진 목록을 읽을 수 없습니다.');
      const page = await env.BUCKET.list({ limit: 3, ...(cursor ? { cursor } : {}) });
      let copied = 0, verified = 0;
      for (const object of page.objects) {
        assertKey(object.key);
        const source = await env.BUCKET.get(object.key);
        if (!source) throw new Error('이전 중 기존 사진이 변경됐습니다. 입력을 잠시 멈추고 다시 실행하세요.');
        const bytes = await photoBytes(source);
        let destination = await remoteGet(object.key);
        if (!destination) {
          await remotePut(object.key, bytes, source.httpMetadata, true); copied++;
          destination = await remoteGet(object.key);
        }
        if (!destination || await sha256(bytes) !== await sha256(await photoBytes(destination))) throw new Error('사진 복사 검증 실패: ' + object.key + '. 원본은 유지됩니다.');
        if (source.httpMetadata?.contentType && source.httpMetadata.contentType !== destination.httpMetadata.contentType) throw new Error('사진 형식 정보 검증 실패: ' + object.key + '. 원본은 유지됩니다.');
        verified++;
      }
      if (page.truncated && !page.cursor) throw new Error('사진 이전의 다음 위치를 읽을 수 없습니다.');
      return { copied, verified, next: page.truncated ? page.cursor : null };
    },
  };
}
