// Reads scripts/.model-probe.json (from probe-models.mjs) and the live
// /v1/models catalogs, then prints the PROVIDER_MODELS array to paste into
// proxy.mjs.
//
// Policy per provider:
//   ollama  → keep only probe cls==='ok' (403 = permanent subscription wall).
//   nvidia  → keep only probe cls==='ok' if the probe was healthy; otherwise
//             fall back to name-filtered served catalog.
//   hf      → HF Router is credit-metered (402 when the monthly free credit is
//             spent), so a probe taken with an empty balance is unreliable.
//             Use the served catalog minus non-chat model-name patterns.
//
// "Non-chat" name patterns are excluded everywhere (embeddings, rerankers,
// safety guards, reward models, OCR/parse, CLIP, translate-only, etc.).
import fs from 'node:fs';

const probe = JSON.parse(fs.readFileSync(new URL('./.model-probe.json', import.meta.url), 'utf8'));

const NON_CHAT = [
  /embed/i, /\bbge\b/i, /rerank/i, /retriev/i, /nemoretriever/i,
  /guard/i, /safety/i, /\breward\b/i, /content-safety/i, /topic-control/i,
  /\bparse\b/i, /\bocr\b/i, /\bclip\b/i, /nvclip/i, /gliner/i, /\bpii\b/i,
  /deplot/i, /kosmos/i, /\bfuyu\b/i, /\bvila\b/i, /\bneva\b/i,
  /translate/i, /detector/i, /recurrentgemma/i, /-vlm-/i, /nv-embed/i,
];

const isChat = (id) => !NON_CHAT.some((re) => re.test(id));

// Build a clean brand-alias slug from an upstream id.
function slug(provider, upstream) {
  let name = upstream;
  // Drop owner prefix for HF/NVIDIA (owner/model).
  if (name.includes('/')) name = name.split('/').slice(1).join('/');
  name = name.toLowerCase()
    .replace(/[:/]+/g, '-')      // colons & slashes → dash
    .replace(/[^a-z0-9.+-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const prefix = provider === 'huggingface' ? 'hf' : provider === 'nvidia' ? 'nim' : provider;
  return `${prefix}-${name}`;
}

function pickOllama() {
  return (probe.ollama || [])
    .filter((r) => r.cls === 'ok' && isChat(r.model))
    .map((r) => r.model);
}

function pickNvidia() {
  const rows = probe.nvidia || [];
  const okCount = rows.filter((r) => r.cls === 'ok').length;
  // If the probe found a healthy number of OK models, trust it; else fall back
  // to the served catalog minus non-chat patterns.
  const useProbe = okCount >= 10;
  const ids = useProbe
    ? rows.filter((r) => r.cls === 'ok').map((r) => r.model)
    : rows.map((r) => r.model);
  return [...new Set(ids)].filter(isChat);
}

function pickHuggingface() {
  // Credit-metered → probe unreliable. Use served catalog minus non-chat.
  const rows = probe.huggingface || [];
  const ids = rows.map((r) => r.model);
  return [...new Set(ids)].filter(isChat);
}

function emit(provider, upstreams) {
  const seen = new Set();
  const lines = [];
  for (const upstream of upstreams.sort()) {
    let alias = slug(provider, upstream);
    let n = 2;
    while (seen.has(alias)) alias = `${slug(provider, upstream)}-${n++}`;
    seen.add(alias);
    lines.push(`  { provider: '${provider}', alias: '${alias}', upstream: ${JSON.stringify(upstream)} },`);
  }
  return lines;
}

const ollama = pickOllama();
const nvidia = pickNvidia();
const hf = pickHuggingface();

console.log('// ===== Ollama Cloud (free tier — probe-verified 200) =====');
console.log(emit('ollama', ollama).join('\n'));
console.log('\n// ===== HuggingFace Inference Router (served catalog, chat-capable) =====');
console.log(emit('huggingface', hf).join('\n'));
console.log('\n// ===== NVIDIA NIM (free tier) =====');
console.log(emit('nvidia', nvidia).join('\n'));

console.error(`\nCounts: ollama=${ollama.length} huggingface=${hf.length} nvidia=${nvidia.length} total=${ollama.length + hf.length + nvidia.length}`);
