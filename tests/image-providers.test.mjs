import test from 'node:test';
import assert from 'node:assert/strict';
import { generateImage, createImageGenerator, prepareComfyWorkflow, ENGINE_METADATA } from '../dist/image-generation/providers.js';

const pixels = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=';
const png = `data:image/png;base64,${pixels}`;
const preset = { id: 'test-style', name: '종이와 색연필', stylePrompt: 'soft pencil texture', negativePrompt: 'sharp shadows', palette: ['#F2C178'], styleRefImages: [png] };
const request = { prompt: 'A small rabbit opens a book.', stylePreset: preset, referenceImages: [png, png], seed: 42, size: '1024x1024', quality: 'high' };
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const imageResponse = () => new Response(new Blob([Uint8Array.from(atob(pixels), x => x.charCodeAt(0))], { type: 'image/png' }));

test('Data URL references accept charset parameters used by the style and character SVG table', async () => {
  const svg='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"></svg>');
  await assert.rejects(generateImage({...request,referenceImages:[svg]},{engine:'google',config:{apiKey:'fixture'}}),error=>error.code==='svg_requires_browser');
  const result=await generateImage({...request,referenceImages:[`data:image/png;charset=utf-8;base64,${pixels}`]},{engine:'google',config:{apiKey:'fixture',fetch:async()=>json({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:pixels}}]}}]})}});
  assert.equal(result.imageUrl,png);
});

test('Google sends every reference, exact model, style and best-effort seed; excludes thought image', async () => {
  let called = 0;
  const result = await generateImage(request, { engine: 'google', config: { apiKey: 'secret-key', fetch: async (url, options) => {
    called++;
    assert.match(url, /models\/gemini-3\.1-flash-image:generateContent$/);
    const body = JSON.parse(options.body);
    assert.equal(body.contents[0].parts.length, 3);
    assert.equal(body.contents[0].parts[1].inlineData.data, pixels);
    assert.equal(body.contents[0].parts[2].inlineData.data, pixels);
    assert.equal(body.generationConfig.seed, 42);
    assert.match(body.contents[0].parts[0].text, /soft pencil texture/);
    assert.match(body.contents[0].parts[0].text, /sharp shadows/);
    return json({ candidates: [{ content: { parts: [{ thought: true, inlineData: { mimeType: 'image/png', data: 'not-the-final-image' } }, { inlineData: { mimeType: 'image/png', data: pixels } }] } }] });
  } } });
  assert.equal(called, 1); assert.equal(result.imageUrl, png); assert.equal(result.seed, null);
  assert.equal(result.meta.requestedSeed, 42); assert.equal(result.meta.seedSupported, false); assert.equal(result.meta.referenceCount, 2);
  assert.doesNotMatch(JSON.stringify(result), /secret-key/);
});

test('OpenAI sends all images in multipart edit request and never invents a seed or unsupported input_fidelity', async () => {
  const result = await generateImage(request, { engine: 'openai', config: { apiKey: 'secret-key', fetch: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/images/edits');
    assert.equal(options.body.get('model'), 'gpt-image-2');
    assert.equal(options.body.getAll('image[]').length, 2);
    assert.equal(options.body.get('seed'), null); assert.equal(options.body.get('input_fidelity'), null);
    assert.equal(options.headers['Content-Type'], undefined);
    return json({ output_format: 'png', data: [{ b64_json: pixels }] });
  } } });
  assert.equal(result.imageUrl, png); assert.equal(result.seed, null); assert.equal(result.meta.requestedSeed, 42);
});

test('BFL sends numbered reference fields, polls official URL, saves pixels before signed URL expires', async () => {
  const calls = [];
  const result = await generateImage(request, { engine: 'bfl', config: { apiKey: 'secret-key', pollIntervalMs: 100, fetch: async (url, options) => {
    calls.push(url);
    if (calls.length === 1) {
      const body = JSON.parse(options.body);
      assert.equal(body.seed, 42); assert.equal(body.input_image, pixels); assert.equal(body.input_image_2, pixels);
      assert.equal(body.input_image_3, undefined);
      return json({ id: 'bfl-job', polling_url: 'https://api.bfl.ai/v1/get_result?id=bfl-job' });
    }
    if (calls.length === 2) return json({ status: 'Ready', result: { sample: 'https://images.example.test/expiring.png', seed: 42 } });
    assert.equal(options.headers, undefined); // No BFL key goes to an image host.
    return imageResponse();
  } } });
  assert.equal(calls.length, 3); assert.equal(result.seed, 42); assert.equal(result.imageUrl, png); assert.equal(result.meta.requestId, 'bfl-job');
});

test('fal routes references to Seedream 5 edit, uses returned queue URLs, and stores requested seed only', async () => {
  let called = 0;
  const result = await generateImage(request, { engine: 'fal', config: { apiKey: 'secret-key', pollIntervalMs: 100, fetch: async (url, options) => {
    called++;
    if (called === 1) {
      assert.equal(url, 'https://queue.fal.run/bytedance/seedream/v5/flash/edit');
      const body = JSON.parse(options.body);
      assert.deepEqual(body.image_urls, [png, png]); assert.equal(body.seed, undefined);
      assert.equal(options.headers.Authorization, 'Key secret-key');
      return json({ request_id: 'fal-job', status_url: 'https://queue.fal.run/bytedance/seedream/requests/fal-job/status', response_url: 'https://queue.fal.run/bytedance/seedream/requests/fal-job' });
    }
    if (called === 2) return json({ status: 'COMPLETED' });
    if (called === 3) return json({ images: [{ url: png }] });
    assert.fail('Unexpected fetch');
  } } });
  assert.equal(result.imageUrl, png); assert.equal(result.seed, null); assert.equal(result.meta.requestedSeed, 42); assert.equal(called, 3);
});

const workflow = {
  '1': { class_type: 'LoadImage', inputs: { image: '{{referenceImage:0}}' } },
  '2': { class_type: 'LoadImage', inputs: { image: '{{referenceImage:1}}' } },
  '3': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } },
  '4': { class_type: 'ReferenceSampler', inputs: { prompt: ['3', 0], image: ['1', 0], style: ['2', 0], seed: '{{seed}}', width: '{{width}}', height: '{{height}}' } },
  '5': { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: 'donghwa' } },
};
test('ComfyUI uploads both references, binds uploaded names into connected workflow, submits seed and reads image output', async () => {
  const paths = [];
  const result = await generateImage(request, { engine: 'local', config: { endpoint: 'http://127.0.0.1:8188', workflow, pollIntervalMs: 100, fetch: async (url, options) => {
    paths.push(url);
    if (paths.length <= 2) {
      assert.match(url, /\/upload\/image$/);
      assert.ok(options.body.get('image') instanceof Blob);
      return json({ name: `uploaded-${paths.length}.png`, subfolder: 'references' });
    }
    if (paths.length === 3) {
      const body = JSON.parse(options.body);
      assert.equal(body.prompt['1'].inputs.image, 'references/uploaded-1.png');
      assert.equal(body.prompt['2'].inputs.image, 'references/uploaded-2.png');
      assert.equal(body.prompt['4'].inputs.seed, 42); assert.equal(typeof body.prompt['4'].inputs.seed, 'number');
      assert.match(body.prompt['3'].inputs.text, /soft pencil texture/);
      return json({ prompt_id: 'local-job', node_errors: {} });
    }
    if (paths.length === 4) return json({ 'local-job': { status: { completed: true, status_str: 'success' }, outputs: { '5': { images: [{ filename: 'rabbit.png', subfolder: '', type: 'output' }] } } } });
    assert.match(url, /\/view\?filename=rabbit.png/);
    return imageResponse();
  } } });
  assert.equal(result.imageUrl, png); assert.equal(result.seed, 42); assert.equal(paths.length, 5);
  assert.equal(workflow['1'].inputs.image, '{{referenceImage:0}}'); // Template remains reusable.
});

test('ComfyUI refuses omitted or disconnected references before uploading', async () => {
  const normalized = { ...request, size: { width: 1024, height: 1024 } };
  const missing = structuredClone(workflow); missing['2'].inputs.image = 'unrelated.png';
  assert.throws(() => prepareComfyWorkflow(missing, normalized, ['first.png', 'second.png']), error => error.code === 'unbound_references');
  const disconnected = structuredClone(workflow); delete disconnected['4'].inputs.style;
  let called = 0;
  await assert.rejects(generateImage(request, { engine: 'local', config: { workflow: disconnected, fetch: async () => { called++; assert.fail('Must prevalidate before fetch'); } } }), error => error.code === 'unconnected_inputs');
  assert.equal(called, 0);
});

test('Reference limits refuse dropped images, even when provider itself silently truncates', async () => {
  for (const engine of ['bfl', 'fal']) {
    const max = ENGINE_METADATA[engine].referenceLimit;
    await assert.rejects(generateImage({ ...request, referenceImages: Array(max + 1).fill(png) }, { engine, config: { apiKey: 'secret-key', fetch: async () => assert.fail('No request allowed') } }), error => error.code === 'reference_limit');
  }
});

test('Provider error bodies and network errors never expose credentials', async () => {
  for (const fetcher of [async () => new Response('API key secret-key is invalid', { status: 401 }), async () => { throw new Error('Request failed Authorization secret-key'); }]) {
    await assert.rejects(generateImage(request, { engine: 'google', config: { apiKey: 'secret-key', fetch: fetcher } }), error => !error.message.includes('secret-key'));
  }
});

test('Polling URLs outside provider origins are refused before authenticated fetch', async () => {
  let called = 0;
  await assert.rejects(generateImage(request, { engine: 'bfl', config: { apiKey: 'secret-key', fetch: async () => {
    called++; return json({ id: 'job', polling_url: 'https://malicious.example.test/steal-key' });
  } } }), error => error.code === 'untrusted_result_url');
  assert.equal(called, 1);
});

test('Abort and timeout stop pending requests with safe errors', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(generateImage({ ...request, signal: controller.signal }, { engine: 'google', config: { apiKey: 'secret-key', fetch: async () => assert.fail('Already aborted') } }), error => error.code === 'aborted');
  await assert.rejects(generateImage(request, { engine: 'google', config: { apiKey: 'secret-key', timeoutMs: 100, fetch: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })) } }), error => error.code === 'timeout');
});

test('Plugin factory validates engine and no-reference requests use generation endpoint', async () => {
  assert.throws(() => createImageGenerator({ engine: 'unsupported' }), error => error.code === 'invalid_engine');
  const generate = createImageGenerator({ engine: 'openai', config: { apiKey: 'secret-key', fetch: async (url, options) => {
    assert.match(url, /images\/generations$/); assert.equal(JSON.parse(options.body).model, 'gpt-image-2');
    return json({ data: [{ b64_json: pixels }] });
  } } });
  assert.equal((await generate({ ...request, referenceImages: [] })).imageUrl, png);
});
