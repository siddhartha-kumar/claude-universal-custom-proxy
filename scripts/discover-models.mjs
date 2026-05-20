// One-off discovery: query each provider's /v1/models endpoint with the keys
// in .env and dump the authoritative live catalog. Used to build the registry.
import dotenv from 'dotenv';
dotenv.config();
import https from 'node:https';

function get(url, key) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
        headers: { authorization: `Bearer ${key}`, accept: 'application/json' } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function ids(body) {
  try {
    const j = JSON.parse(body);
    const data = j.data || j.models || [];
    return data.map((m) => m.id || m.name || m.model).filter(Boolean).sort();
  } catch { return null; }
}

const providers = [
  { name: 'OLLAMA',      url: (process.env.OLLAMA_BASE_URL || 'https://ollama.com/v1') + '/models', key: process.env.OLLAMA_API_KEY },
  { name: 'HUGGINGFACE', url: (process.env.HUGGINGFACE_BASE_URL || 'https://router.huggingface.co/v1') + '/models', key: process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN },
  { name: 'NVIDIA',      url: (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1') + '/models', key: process.env.NVIDIA_API_KEY },
];

for (const p of providers) {
  const res = await get(p.url, p.key);
  const list = ids(res.body);
  console.log(`\n===== ${p.name} (${p.url}) status=${res.status} count=${list ? list.length : 'parse-fail'} =====`);
  if (list) list.forEach((id) => console.log(id));
  else console.log(res.body.slice(0, 500));
}
