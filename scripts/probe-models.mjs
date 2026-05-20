// Probe every model in each provider's live catalog with a 1-token chat call.
// Classifies each as:
//   ok       → 200 (free / "unlimited" + chat-capable)  → MAP IT
//   gated    → 402/403 (subscription / credits required) → SKIP
//   badtype  → 400/404/422 (embeddings, rerankers, etc.) → SKIP
//   other    → anything else (rate-limited, timeout, 5xx) → review
//
// Writes scripts/.model-probe.json for the registry generator to consume.
import dotenv from 'dotenv'; dotenv.config();
import https from 'node:https';
import fs from 'node:fs';

const PROVIDERS = [
  { name: 'ollama',      host: 'ollama.com',                  base: '/v1', key: process.env.OLLAMA_API_KEY },
  { name: 'huggingface', host: 'router.huggingface.co',       base: '/v1', key: process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN },
  { name: 'nvidia',      host: 'integrate.api.nvidia.com',    base: '/v1', key: process.env.NVIDIA_API_KEY },
];

function req(host, path, method, key, bodyObj) {
  return new Promise((resolve) => {
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const headers = { authorization: `Bearer ${key}`, accept: 'application/json' };
    if (body) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(body); }
    const r = https.request({ hostname: host, path, method, headers }, (res) => {
      const c = []; res.on('data', (x) => c.push(x));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') }));
    });
    r.on('error', (e) => resolve({ status: 'ERR', body: e.message }));
    r.setTimeout(40000, () => { r.destroy(); resolve({ status: 'TIMEOUT', body: 'timeout' }); });
    if (body) r.write(body);
    r.end();
  });
}

function listModels(p) {
  return req(p.host, `${p.base}/models`, 'GET', p.key).then((r) => {
    try {
      const j = JSON.parse(r.body);
      return [...new Set((j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean))].sort();
    } catch { return []; }
  });
}

function classify(status, body) {
  if (status === 200) return 'ok';
  if (status === 402 || status === 403) return 'gated';
  if (status === 400 || status === 404 || status === 422) return 'badtype';
  if (status === 429) return 'ratelimited';
  return 'other';
}

async function probeOne(p, model) {
  const r = await req(p.host, `${p.base}/chat/completions`, 'POST', p.key, {
    model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }],
  });
  let cls = classify(r.status, r.body);
  // One retry for transient rate limits.
  if (cls === 'ratelimited') {
    await new Promise((s) => setTimeout(s, 4000));
    const r2 = await req(p.host, `${p.base}/chat/completions`, 'POST', p.key, {
      model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }],
    });
    cls = classify(r2.status, r2.body);
    return { model, status: r2.status, cls, snippet: String(r2.body).replace(/\s+/g, ' ').slice(0, 120) };
  }
  return { model, status: r.status, cls, snippet: String(r.body).replace(/\s+/g, ' ').slice(0, 120) };
}

async function mapLimited(items, limit, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

const report = {};
for (const p of PROVIDERS) {
  if (!p.key) { console.log(`\n## ${p.name}: NO KEY, skipping`); continue; }
  const models = await listModels(p);
  console.log(`\n## ${p.name}: probing ${models.length} models (concurrency 4)`);
  const results = await mapLimited(models, 4, async (m, idx) => {
    const res = await probeOne(p, m);
    process.stdout.write(`  [${idx + 1}/${models.length}] ${res.cls.padEnd(11)} ${res.status}\t${m}\n`);
    return res;
  });
  report[p.name] = results;
  const ok = results.filter((r) => r.cls === 'ok').length;
  const gated = results.filter((r) => r.cls === 'gated').length;
  const bad = results.filter((r) => r.cls === 'badtype').length;
  const other = results.filter((r) => r.cls === 'other' || r.cls === 'ratelimited' || r.cls === 'TIMEOUT').length;
  console.log(`## ${p.name}: ok=${ok} gated=${gated} badtype=${bad} other=${other}`);
}

fs.writeFileSync(new URL('./.model-probe.json', import.meta.url), JSON.stringify(report, null, 2));
console.log('\nWrote scripts/.model-probe.json');
