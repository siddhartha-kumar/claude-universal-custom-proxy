// End-to-end routing test: mock upstreams + real proxy + Claude Desktop-style
// `Bearer dummy-…` header. For EVERY alias in the registry it verifies:
//   - the request lands at the correct provider (mock-server fingerprint)
//   - the upstream sees the real API key, never the gateway placeholder
//   - the body model field is rewritten to the upstream id
//   - response.model is rewritten back to the alias the client asked for
//   - family fallback / date-stripping works for native Claude names

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';

import {
  createProxyServer,
  loadConfig,
  DEFAULT_MODEL_MAP,
  DEFAULT_MODEL_ROUTES,
} from '../proxy.mjs';

async function startMockUpstream(label) {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      received.push({ label, url: req.url, headers: { ...req.headers }, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: `mock-${label}-${received.length}`,
        object: 'chat.completion',
        model: body?.model || `mock-${label}`,
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { label, server, received, url: `http://127.0.0.1:${server.address().port}` };
}

async function startProxy(env) {
  const config = loadConfig(env);
  const server = createProxyServer(config);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: server.address().port, config };
}

function sendMessage(port, model) {
  const body = JSON.stringify({ model, max_tokens: 4, messages: [{ role: 'user', content: 'hi' }] });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1', port, path: '/v1/messages', method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          authorization: 'Bearer dummy-claude-universal-custom-proxy',
          'x-api-key': 'dummy-claude-universal-custom-proxy',
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null; try { json = JSON.parse(text); } catch {}
          resolve({ status: res.statusCode, body: text, json });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

// One mock per provider used by the registry, plus the optional ones so a future
// catalog addition doesn't silently misroute.
async function setupSuite() {
  const mocks = {
    ollama:      await startMockUpstream('ollama'),
    huggingface: await startMockUpstream('huggingface'),
    nvidia:      await startMockUpstream('nvidia'),
    anthropic:   await startMockUpstream('anthropic'),
  };
  const proxy = await startProxy({
    DEFAULT_PROVIDER: 'ollama',
    OLLAMA_BASE_URL:      `${mocks.ollama.url}/v1`,      OLLAMA_API_KEY:      'real-ollama-key',
    HUGGINGFACE_BASE_URL: `${mocks.huggingface.url}/v1`, HUGGINGFACE_API_KEY: 'real-hf-key',
    NVIDIA_BASE_URL:      `${mocks.nvidia.url}/v1`,      NVIDIA_API_KEY:      'real-nvidia-key',
    ANTHROPIC_BASE_URL:   mocks.anthropic.url,           // intentionally NO key
  });
  const teardown = () => { proxy.server.close(); for (const m of Object.values(mocks)) m.server.close(); };
  return { proxy, mocks, teardown };
}

const EXPECTED_KEY = {
  ollama: 'Bearer real-ollama-key',
  huggingface: 'Bearer real-hf-key',
  nvidia: 'Bearer real-nvidia-key',
};

test('every registry alias routes to its declared provider with the real key', async (t) => {
  const { proxy, mocks, teardown } = await setupSuite();
  t.after(teardown);

  const aliases = Object.keys(DEFAULT_MODEL_MAP);
  let ok = 0;
  const failures = [];

  for (const alias of aliases) {
    const provider = DEFAULT_MODEL_ROUTES[alias] || proxy.config.defaultProvider;
    if (provider === 'anthropic') continue; // covered by the family-fallback test
    const mock = mocks[provider];
    if (!mock) { failures.push(`${alias}: no mock for ${provider}`); continue; }
    const before = mock.received.length;
    const res = await sendMessage(proxy.port, alias);
    if (res.status !== 200) { failures.push(`${alias}: status ${res.status}`); continue; }
    if (mock.received.length !== before + 1) { failures.push(`${alias}: did not reach ${provider}`); continue; }
    const got = mock.received.at(-1);
    if (got.headers.authorization !== EXPECTED_KEY[provider]) { failures.push(`${alias}: wrong key ${got.headers.authorization}`); continue; }
    if (got.body?.model !== DEFAULT_MODEL_MAP[alias]) { failures.push(`${alias}: upstream model ${got.body?.model} != ${DEFAULT_MODEL_MAP[alias]}`); continue; }
    ok++;
  }

  if (failures.length) { console.error(`\n${failures.length} failures:`); failures.slice(0, 20).forEach((f) => console.error('  ' + f)); }
  assert.equal(failures.length, 0, `${failures.length} routing failures`);
  console.log(`  ✔ ${ok} provider aliases routed correctly`);
});

test('response.model is rewritten back to the requested alias', async (t) => {
  const { proxy, teardown } = await setupSuite();
  t.after(teardown);
  for (const alias of [
    'ollama-gpt-oss-20b', 'ollama-qwen3-coder-480b', 'ollama-glm-4.6',
    'hf-deepseek-r1', 'hf-llama-3.1-8b-instruct',
    'nim-llama-3.1-8b-instruct', 'nim-gpt-oss-120b',
  ]) {
    const res = await sendMessage(proxy.port, alias);
    assert.equal(res.status, 200, `${alias} → 200`);
    assert.equal(res.json?.model, alias, `${alias} → response.model echoes alias`);
  }
});

test('native Claude names fall back to Ollama when ANTHROPIC_API_KEY is empty', async (t) => {
  const { proxy, mocks, teardown } = await setupSuite();
  t.after(teardown);
  const cases = [
    'claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7',
    'claude-haiku-4-5-20251001', 'claude-sonnet-4-6-20260131', 'claude-opus-4-7-20260201',
    'claude-haiku', 'claude-sonnet', 'claude-opus',
  ];
  for (const model of cases) {
    const beforeOllama = mocks.ollama.received.length;
    const beforeAnthropic = mocks.anthropic.received.length;
    const res = await sendMessage(proxy.port, model);
    assert.equal(res.status, 200, `${model} → 200`);
    assert.equal(mocks.anthropic.received.length, beforeAnthropic, `${model} did not reach anthropic`);
    assert.equal(mocks.ollama.received.length, beforeOllama + 1, `${model} fell back to ollama`);
    assert.equal(mocks.ollama.received.at(-1).headers.authorization, EXPECTED_KEY.ollama);
  }
});

test('the gateway placeholder bearer never reaches an upstream', async (t) => {
  const { proxy, mocks, teardown } = await setupSuite();
  t.after(teardown);
  for (const m of ['ollama-gpt-oss-20b', 'hf-deepseek-r1', 'nim-llama-3.1-8b-instruct', 'claude-haiku-4-5']) {
    await sendMessage(proxy.port, m);
  }
  for (const mock of Object.values(mocks)) {
    for (const r of mock.received) {
      assert.ok(!String(r.headers.authorization || '').includes('dummy'), `${mock.label} got dummy bearer`);
      assert.ok(!String(r.headers['x-api-key'] || '').includes('dummy'), `${mock.label} got dummy x-api-key`);
    }
  }
});

test('/v1/models advertises brand aliases; no claude- prefix on third-party models', async (t) => {
  const { proxy, teardown } = await setupSuite();
  t.after(teardown);
  const res = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${proxy.port}/v1/models`, (r) => {
      const cs = []; r.on('data', (c) => cs.push(c));
      r.on('end', () => resolve(JSON.parse(Buffer.concat(cs).toString('utf8'))));
    }).on('error', reject);
  });
  const ids = new Set(res.data.map((m) => m.id));

  // Brand aliases present.
  for (const id of ['ollama-gpt-oss-20b', 'hf-deepseek-r1', 'nim-llama-3.1-8b-instruct']) {
    assert.ok(ids.has(id), `${id} should be visible`);
  }
  // Only native Claude family models keep the claude- prefix.
  const claudePrefixed = [...ids].filter((id) => id.startsWith('claude-')).sort();
  assert.deepEqual(claudePrefixed, [
    'claude-haiku-4-5', 'claude-opus-4-1', 'claude-opus-4-7', 'claude-sonnet-4-5', 'claude-sonnet-4-6',
  ]);
  // display_name === id.
  for (const m of res.data) assert.equal(m.display_name, m.id);
});

test('defaultProvider auto-falls-back when the configured one has no key', async () => {
  const proxy = await startProxy({ DEFAULT_PROVIDER: 'deepseek', OLLAMA_API_KEY: 'ollama-only' });
  try {
    const res = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${proxy.port}/healthz`, (r) => {
        const cs = []; r.on('data', (c) => cs.push(c));
        r.on('end', () => resolve(JSON.parse(Buffer.concat(cs).toString('utf8'))));
      }).on('error', reject);
    });
    assert.equal(res.defaultProvider, 'ollama');
  } finally {
    proxy.server.close();
  }
});
