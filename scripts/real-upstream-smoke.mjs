// Real-upstream smoke test — sends one tiny prompt through the proxy to each
// of the user's free-tier providers. Stays within free quotas (max_tokens=8,
// trivial prompt, sequential).
//
// Usage:  node test/real-upstream-smoke.mjs
//
// Reads .env via the proxy's own dotenv side-effect.  Skips any provider that
// returns 402 / payment-required.

import http from 'node:http';
import { once } from 'node:events';
import { createProxyServer, loadConfig } from '../proxy.mjs';

const TARGETS = [
  { alias: 'ollama-gpt-oss-20b',          provider: 'ollama',      note: 'free Ollama Cloud Turbo' },
  { alias: 'ollama-qwen3-coder-480b',     provider: 'ollama',      note: 'free Ollama Cloud Turbo' },
  { alias: 'nim-llama-3.1-8b-instruct',   provider: 'nvidia',      note: 'free NVIDIA NIM' },
  { alias: 'nim-gpt-oss-120b',            provider: 'nvidia',      note: 'free NVIDIA NIM' },
  { alias: 'hf-llama-3.1-8b-instruct',    provider: 'huggingface', note: 'HF Router (credit-metered)' },
  { alias: 'claude-haiku-4-5',            provider: '(family fallback)', note: 'reroutes to Ollama (no anthropic key)' },
];

async function startProxy() {
  const config = loadConfig(process.env);
  const server = createProxyServer(config);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: server.address().port, config };
}

function sendPrompt(port, model) {
  const body = JSON.stringify({
    model,
    max_tokens: 8,
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
  });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1', port, path: '/v1/messages', method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          authorization: 'Bearer dummy-claude-universal-custom-proxy',
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = null; try { parsed = JSON.parse(text); } catch {}
          resolve({ status: res.statusCode, body: text, json: parsed });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('timeout after 30s')); });
    req.end(body);
  });
}

function extractText(json) {
  if (!json) return '(no JSON)';
  // Anthropic shape
  if (Array.isArray(json.content)) {
    return json.content.map((p) => p.text || '').join('').trim();
  }
  // OpenAI shape (shouldn't happen — proxy converts, but just in case)
  if (json.choices?.[0]?.message?.content) return String(json.choices[0].message.content).trim();
  if (json.error) return `ERROR: ${typeof json.error === 'string' ? json.error : JSON.stringify(json.error)}`;
  return JSON.stringify(json).slice(0, 200);
}

function isPaymentRequired(status, body) {
  if (status === 402) return true;
  const lower = body.toLowerCase();
  return lower.includes('payment') || lower.includes('insufficient') || lower.includes('quota')
    || lower.includes('credit') || lower.includes('billing');
}

(async function main() {
  const { server, port, config } = await startProxy();
  console.log(`Proxy v${(await import('../proxy.mjs')).SERVER_VERSION} on 127.0.0.1:${port}`);
  console.log(`Default provider: ${config.defaultProvider}`);
  console.log('Keys loaded: '
    + ['ollama', 'huggingface', 'nvidia'].map((p) => `${p}=${config.providers[p]?.upstreamApiKey ? '✔' : '✘'}`).join(' '));
  console.log('');

  const results = [];
  for (const target of TARGETS) {
    process.stdout.write(`→ ${target.alias.padEnd(28)} (${target.note}) ... `);
    try {
      const t0 = Date.now();
      const res = await sendPrompt(port, target.alias);
      const ms = Date.now() - t0;
      if (isPaymentRequired(res.status, res.body)) {
        console.log(`SKIP (payment required)`);
        results.push({ ...target, status: 'skip-paid' });
        continue;
      }
      if (res.status >= 200 && res.status < 300) {
        const text = extractText(res.json);
        const model = res.json?.model || '(no model)';
        console.log(`OK ${ms}ms   model=${model}   reply="${text.slice(0, 60)}"`);
        results.push({ ...target, status: 'ok', ms, model, text });
      } else {
        console.log(`HTTP ${res.status}  ${res.body.slice(0, 200)}`);
        results.push({ ...target, status: `http-${res.status}`, body: res.body.slice(0, 500) });
      }
    } catch (error) {
      console.log(`ERROR ${error.message}`);
      results.push({ ...target, status: 'error', error: error.message });
    }
  }

  server.close();

  console.log('\n=== Summary ===');
  const ok = results.filter((r) => r.status === 'ok').length;
  const skip = results.filter((r) => r.status === 'skip-paid').length;
  const fail = results.length - ok - skip;
  console.log(`OK: ${ok}    Skipped (paid): ${skip}    Failed: ${fail}`);
  if (fail > 0) process.exitCode = 1;
})();
