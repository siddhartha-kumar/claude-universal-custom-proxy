// Unit / integration tests for the proxy mechanics that are independent of the
// model catalog (request/response translation, streaming, header substitution,
// routing primitives, local endpoints, config loading). Full catalog coverage
// lives in test/e2e-routing.test.mjs.

import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { once } from 'node:events';

import {
  DEFAULT_MODEL_MAP,
  DEFAULT_MODEL_ROUTES,
  DEFAULT_MODEL_ALIASES,
  DEFAULT_CLAUDE_FAMILY_FALLBACK,
  SERVER_VERSION,
  createProxyServer,
  loadConfig,
  resolveClaudeFamily,
  resolveClaudeAlias,
  resolveModelForUpstream,
  stripClaudeDate,
  rewriteModelValues,
} from '../proxy.mjs';

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────
function listen(server) {
  server.listen(0, '127.0.0.1');
  return once(server, 'listening');
}
function close(server) {
  return new Promise((resolve) => server.close(resolve));
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}
function postJson(url, payload, headers = {}) {
  const body = JSON.stringify(payload);
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null; try { json = JSON.parse(text); } catch {}
          resolve({ statusCode: res.statusCode, body: json, raw: text });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch {}
        resolve({ statusCode: res.statusCode, body: json, raw: text });
      });
    }).on('error', reject);
  });
}
// A test config wired to a single mock upstream for a given provider.
function testConfig(overrides = {}) {
  const env = { DEFAULT_PROVIDER: 'ollama', OLLAMA_API_KEY: 'ollama-test', ...overrides };
  return loadConfig(env);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Registry shape
// ─────────────────────────────────────────────────────────────────────────────
test('registry derives consistent map/routes/aliases', () => {
  const cfg = loadConfig({});
  const aliases = Object.keys(cfg.modelMap);
  assert.ok(aliases.length > 150, 'expect a large catalog');
  // Every alias has a route to a real provider.
  for (const a of aliases) {
    assert.ok(cfg.modelRoutes[a], `${a} has a route`);
    assert.ok(cfg.providers[cfg.modelRoutes[a]], `${a} routes to a configured provider`);
  }
  // The 5 native Claude models route to anthropic.
  for (const m of ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7', 'claude-sonnet-4-5', 'claude-opus-4-1']) {
    assert.equal(cfg.modelRoutes[m], 'anthropic');
  }
  // Family fallback targets exist.
  for (const alias of Object.values(DEFAULT_CLAUDE_FAMILY_FALLBACK)) {
    assert.ok(cfg.modelMap[alias], `fallback ${alias} exists`);
  }
});

test('third-party aliases never use the claude- prefix', () => {
  for (const alias of Object.keys(DEFAULT_MODEL_MAP)) {
    if (DEFAULT_MODEL_ROUTES[alias] === 'anthropic') continue;
    assert.ok(!alias.startsWith('claude-'), `${alias} must not start with claude-`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  Smart resolver
// ─────────────────────────────────────────────────────────────────────────────
test('stripClaudeDate removes the 8-digit date suffix', () => {
  assert.equal(stripClaudeDate('claude-haiku-4-5-20251001'), 'claude-haiku-4-5');
  assert.equal(stripClaudeDate('claude-sonnet-4-6'), 'claude-sonnet-4-6');
});

test('resolveClaudeFamily detects haiku/sonnet/opus', () => {
  assert.equal(resolveClaudeFamily('claude-haiku-4-5'), 'haiku');
  assert.equal(resolveClaudeFamily('claude-sonnet-4-6-20260101'), 'sonnet');
  assert.equal(resolveClaudeFamily('claude-opus-4-7'), 'opus');
  assert.equal(resolveClaudeFamily('ollama-gpt-oss-20b'), null);
});

test('dated/native Claude names fall back to Ollama when ANTHROPIC_API_KEY is empty', () => {
  const cfg = testConfig();
  assert.equal(resolveClaudeAlias('claude-haiku-4-5-20251001', cfg), DEFAULT_CLAUDE_FAMILY_FALLBACK.haiku);
  assert.equal(resolveClaudeAlias('claude-sonnet-4-6', cfg), DEFAULT_CLAUDE_FAMILY_FALLBACK.sonnet);
  assert.equal(resolveClaudeAlias('claude-opus-4-7', cfg), DEFAULT_CLAUDE_FAMILY_FALLBACK.opus);
});

test('CLAUDE_HAIKU/SONNET/OPUS_MODEL overrides are honored', () => {
  const cfg = testConfig({
    CLAUDE_HAIKU_MODEL: 'ollama-glm-4.6',
    CLAUDE_SONNET_MODEL: 'ollama-qwen3-coder-480b',
    CLAUDE_OPUS_MODEL: 'ollama-gpt-oss-120b',
  });
  assert.equal(resolveModelForUpstream('claude-haiku-4-5-20251001', cfg).upstreamModel, 'glm-4.6');
  assert.equal(resolveModelForUpstream('claude-sonnet-4-6', cfg).upstreamModel, 'qwen3-coder:480b');
  assert.equal(resolveModelForUpstream('claude-opus-4-7', cfg).upstreamModel, 'gpt-oss:120b');
});

test('native Claude names go to Anthropic directly when ANTHROPIC_API_KEY is set', () => {
  const cfg = loadConfig({ OLLAMA_API_KEY: 'x', ANTHROPIC_API_KEY: 'sk-ant-test' });
  const r = resolveModelForUpstream('claude-haiku-4-5-20251001', cfg);
  assert.equal(r.requestAlias, 'claude-haiku-4-5');
  assert.equal(r.upstreamModel, 'claude-haiku-4-5');
});

// ─────────────────────────────────────────────────────────────────────────────
//  Config loading
// ─────────────────────────────────────────────────────────────────────────────
test('provider base URLs default correctly', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.providers.ollama.upstreamBaseUrl.href, 'https://ollama.com/v1');
  assert.equal(cfg.providers.huggingface.upstreamBaseUrl.href, 'https://router.huggingface.co/v1');
  assert.equal(cfg.providers.nvidia.upstreamBaseUrl.href, 'https://integrate.api.nvidia.com/v1');
  assert.equal(cfg.providers.anthropic.upstreamBaseUrl.href, 'https://api.anthropic.com/');
  assert.equal(cfg.providers.ollama.format, 'openai-chat');
  assert.equal(cfg.providers.anthropic.authScheme, 'x-api-key');
});

test('HuggingFace + NVIDIA key aliases load', () => {
  const hf = loadConfig({ HF_TOKEN: 'hf-tok' });
  assert.equal(hf.providers.huggingface.upstreamApiKey, 'hf-tok');
  const nv = loadConfig({ NVAPI_KEY: 'nvapi-x' });
  assert.equal(nv.providers.nvidia.upstreamApiKey, 'nvapi-x');
  const nim = loadConfig({ NIM_API_KEY: 'nim-x' });
  assert.equal(nim.providers.nvidia.upstreamApiKey, 'nim-x');
});

test('REWRITE_RESPONSES defaults to true; opt out with =false', () => {
  assert.equal(loadConfig({}).rewriteResponses, true);
  assert.equal(loadConfig({ REWRITE_RESPONSES: 'false' }).rewriteResponses, false);
});

test('ADVANCED_ENV merges JSON keys', () => {
  const cfg = loadConfig({ ADVANCED_ENV: '{"OLLAMA_API_KEY":"from-advanced"}' });
  assert.equal(cfg.providers.ollama.upstreamApiKey, 'from-advanced');
});

// ─────────────────────────────────────────────────────────────────────────────
//  OpenAI-chat upstream: request translation + key substitution + response
// ─────────────────────────────────────────────────────────────────────────────
test('routes an Ollama alias through the OpenAI-compatible endpoint with the real key', async (t) => {
  let path; let auth; let body;
  const upstream = http.createServer(async (req, res) => {
    path = req.url; auth = req.headers.authorization; body = JSON.parse(await readBody(req));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'cmpl', object: 'chat.completion', model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'hello there' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    }));
  });
  await listen(upstream);
  t.after(() => close(upstream));

  const proxy = createProxyServer(loadConfig({
    DEFAULT_PROVIDER: 'ollama',
    OLLAMA_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`,
    OLLAMA_API_KEY: 'real-ollama',
  }));
  await listen(proxy);
  t.after(() => close(proxy));

  const res = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'ollama-gpt-oss-20b', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }],
  }, { authorization: 'Bearer dummy', 'x-api-key': 'dummy' });

  assert.equal(path, '/v1/chat/completions', 'rewritten to chat/completions');
  assert.equal(auth, 'Bearer real-ollama', 'dummy replaced with real key');
  assert.equal(body.model, 'gpt-oss:20b', 'alias rewritten to upstream id');
  assert.equal(res.statusCode, 200);
  // Converted to Anthropic message shape, model echoed back as the alias.
  assert.equal(res.body.type, 'message');
  assert.equal(res.body.model, 'ollama-gpt-oss-20b');
  assert.equal(res.body.content[0].text, 'hello there');
});

test('converts OpenAI streaming responses to Anthropic SSE', async (t) => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"id":"1","model":"gpt-oss:20b","choices":[{"delta":{"role":"assistant"}}]}\n\n');
    res.write('data: {"id":"1","model":"gpt-oss:20b","choices":[{"delta":{"content":"Hel"}}]}\n\n');
    res.write('data: {"id":"1","model":"gpt-oss:20b","choices":[{"delta":{"content":"lo"}}]}\n\n');
    res.write('data: {"id":"1","model":"gpt-oss:20b","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });
  await listen(upstream);
  t.after(() => close(upstream));

  const proxy = createProxyServer(loadConfig({
    DEFAULT_PROVIDER: 'ollama',
    OLLAMA_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`,
    OLLAMA_API_KEY: 'k',
  }));
  await listen(proxy);
  t.after(() => close(proxy));

  const raw = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: 'ollama-gpt-oss-20b', max_tokens: 16, stream: true, messages: [{ role: 'user', content: 'hi' }] });
    const req = http.request({ hostname: '127.0.0.1', port: proxy.address().port, path: '/v1/messages', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: 'Bearer dummy' } },
      (res) => { const cs = []; res.on('data', (c) => cs.push(c)); res.on('end', () => resolve(Buffer.concat(cs).toString('utf8'))); });
    req.on('error', reject); req.end(body);
  });

  assert.match(raw, /event: message_start/);
  assert.match(raw, /event: content_block_delta/);
  assert.match(raw, /"text":"Hel"/);
  assert.match(raw, /"text":"lo"/);
  assert.match(raw, /event: message_stop/);
});

// ─────────────────────────────────────────────────────────────────────────────
//  Anthropic upstream: x-api-key auth + passthrough
// ─────────────────────────────────────────────────────────────────────────────
test('routes native Claude to Anthropic with x-api-key when a key is set', async (t) => {
  let xApiKey; let body;
  const upstream = http.createServer(async (req, res) => {
    xApiKey = req.headers['x-api-key']; body = JSON.parse(await readBody(req));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: 'ok' }] }));
  });
  await listen(upstream);
  t.after(() => close(upstream));

  const proxy = createProxyServer(loadConfig({
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstream.address().port}`,
    ANTHROPIC_API_KEY: 'sk-ant-real',
    OLLAMA_API_KEY: 'x',
  }));
  await listen(proxy);
  t.after(() => close(proxy));

  const res = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'claude-haiku-4-5', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }],
  }, { 'x-api-key': 'dummy' });

  assert.equal(xApiKey, 'sk-ant-real');
  assert.equal(body.model, 'claude-haiku-4-5');
  assert.equal(res.statusCode, 200);
});

// ─────────────────────────────────────────────────────────────────────────────
//  Local endpoints
// ─────────────────────────────────────────────────────────────────────────────
test('/v1/models returns the Anthropic catalog shape', async (t) => {
  const proxy = createProxyServer(loadConfig({ OLLAMA_API_KEY: 'x' }));
  await listen(proxy);
  t.after(() => close(proxy));

  const res = await getJson(`http://127.0.0.1:${proxy.address().port}/v1/models`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.has_more, false);
  assert.equal(typeof res.body.first_id, 'string');
  assert.equal(typeof res.body.last_id, 'string');
  for (const required of ['ollama-gpt-oss-20b', 'hf-deepseek-r1', 'nim-llama-3.1-8b-instruct', 'claude-haiku-4-5']) {
    assert.ok(res.body.data.some((m) => m.id === required), `${required} present`);
  }
  for (const m of res.body.data) assert.equal(m.display_name, m.id);
});

test('/v1/models/{unknown} returns a 404 plain {error} body', async (t) => {
  const proxy = createProxyServer(loadConfig({ OLLAMA_API_KEY: 'x' }));
  await listen(proxy);
  t.after(() => close(proxy));
  const res = await getJson(`http://127.0.0.1:${proxy.address().port}/v1/models/nope-not-real`);
  assert.equal(res.statusCode, 404);
  assert.equal(typeof res.body.error, 'string');
});

test('/v1/messages/count_tokens is answered locally', async (t) => {
  let upstreamHit = false;
  const upstream = http.createServer((_req, res) => { upstreamHit = true; res.writeHead(404); res.end(); });
  await listen(upstream);
  t.after(() => close(upstream));

  const proxy = createProxyServer(loadConfig({
    DEFAULT_PROVIDER: 'ollama',
    OLLAMA_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`,
    OLLAMA_API_KEY: 'x',
  }));
  await listen(proxy);
  t.after(() => close(proxy));

  const res = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages/count_tokens`, {
    model: 'ollama-gpt-oss-20b', messages: [{ role: 'user', content: 'hello world' }],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.body.input_tokens, 'number');
  assert.ok(res.body.input_tokens >= 1);
  assert.equal(upstreamHit, false, 'must not hit upstream');
});

test('/healthz reports provider key flags and family fallback', async (t) => {
  const proxy = createProxyServer(loadConfig({ OLLAMA_API_KEY: 'x' }));
  await listen(proxy);
  t.after(() => close(proxy));
  const res = await getJson(`http://127.0.0.1:${proxy.address().port}/healthz`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.providers.ollama.hasApiKey, true);
  assert.equal(res.body.providers.nvidia.hasApiKey, false);
  assert.ok(res.body.claudeFamilyFallback.haiku);
});

// ─────────────────────────────────────────────────────────────────────────────
//  buildTargetUrl edge case
// ─────────────────────────────────────────────────────────────────────────────
test('does not produce /v1/v1 when the base URL already ends in /v1', async (t) => {
  let path;
  const upstream = http.createServer((req, res) => {
    path = req.url;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'c', object: 'chat.completion', model: 'gpt-oss:20b', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }));
  });
  await listen(upstream);
  t.after(() => close(upstream));

  const proxy = createProxyServer(loadConfig({
    DEFAULT_PROVIDER: 'ollama',
    OLLAMA_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`,
    OLLAMA_API_KEY: 'x',
  }));
  await listen(proxy);
  t.after(() => close(proxy));

  await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'ollama-gpt-oss-20b', max_tokens: 4, messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(path, '/v1/chat/completions');
});

// ─────────────────────────────────────────────────────────────────────────────
//  rewriteModelValues primitive
// ─────────────────────────────────────────────────────────────────────────────
test('rewriteModelValues only rewrites model-shaped keys', () => {
  const map = { 'ollama-gpt-oss-20b': 'gpt-oss:20b' };
  const out = rewriteModelValues({ model: 'ollama-gpt-oss-20b', note: 'ollama-gpt-oss-20b' }, map);
  assert.equal(out.model, 'gpt-oss:20b');
  assert.equal(out.note, 'ollama-gpt-oss-20b', 'non-model keys untouched');
});

test('version constant is a semver string', () => {
  assert.match(SERVER_VERSION, /^\d+\.\d+\.\d+$/);
});

// Reverse-alias sanity: each native model maps back to itself.
test('DEFAULT_MODEL_ALIASES round-trips native Claude models', () => {
  for (const m of ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7']) {
    assert.equal(DEFAULT_MODEL_ALIASES[m], m);
  }
});
