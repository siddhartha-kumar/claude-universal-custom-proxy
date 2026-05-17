#!/usr/bin/env node

import dotenv from 'dotenv';
dotenv.config();

import http from 'node:http';
import https from 'node:https';
import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// Service identity — kept in lockstep with package.json / manifest.json /
// server/index.mjs by the manifest test.
// ─────────────────────────────────────────────────────────────────────────────
export const SERVER_NAME = 'claude-model-proxy';
export const SERVER_VERSION = '0.4.3';

// ─────────────────────────────────────────────────────────────────────────────
// Debug logging — gated by DEBUG_PROXY=true (default off)
// ─────────────────────────────────────────────────────────────────────────────
const DEBUG = String(process.env.DEBUG_PROXY || '').toLowerCase() === 'true';

function debugLog(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

function debugBlock(title, lines) {
  if (!DEBUG) return;
  console.log(`\n========== ${title} ==========`);
  for (const line of lines) console.log(line);
  console.log('='.repeat(title.length + 22) + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Default model map: Claude-style request alias → upstream model id.
// Ollama Cloud upstreams use `-cloud` for sized models, `:cloud` for unsized.
// Bare ids would hit local weights and fail on the hosted Ollama Cloud service.
// ─────────────────────────────────────────────────────────────────────────────
export const DEFAULT_MODEL_MAP = Object.freeze({
  // DeepSeek Anthropic-compatible
  'claude-deepseek-v4-flash': 'deepseek-v4-flash',
  'claude-deepseek-v4-pro': 'deepseek-v4-pro',
  // Moonshot/Kimi Anthropic-compatible
  'claude-kimi-k2.6': 'kimi-k2.6',
  // Z.AI / GLM Anthropic-compatible
  'claude-glm-4.5-air': 'glm-4.5-air',
  'claude-glm-4.6': 'glm-4.6',
  'claude-glm-4.7': 'glm-4.7',
  'claude-glm-5': 'glm-5',
  'claude-glm-5.1': 'glm-5.1',
  // Xiaomi MiMo Anthropic-compatible
  'claude-mimo-v2-flash': 'mimo-v2-flash',
  'claude-mimo-v2-pro': 'mimo-v2-pro',
  'claude-mimo-v2.5-pro': 'mimo-v2.5-pro',
  'claude-mimo-v2-omni': 'mimo-v2-omni',
  // OpenAI Chat Completions
  'claude-gpt-5.5': 'gpt-5.5',
  'claude-gpt-5.4': 'gpt-5.4',
  'claude-gpt-5.4-mini': 'gpt-5.4-mini',
  // Gemini OpenAI-compatible
  'claude-gemini-3.1-pro-preview': 'gemini-3.1-pro-preview',
  'claude-gemini-3-flash-preview': 'gemini-3-flash-preview',
  'claude-gemini-2.5-pro': 'gemini-2.5-pro',
  'claude-gemini-2.5-flash': 'gemini-2.5-flash',
  'claude-gemini-3.1-flash-lite-preview': 'gemini-3.1-flash-lite-preview',
  'claude-gemini-2.0-flash': 'gemini-2.0-flash',
  // Qwen (DashScope) OpenAI-compatible
  'claude-qwen-flash': 'qwen-flash',
  'claude-qwen-plus': 'qwen-plus',
  'claude-qwen-max': 'qwen-max',
  // Ollama Cloud (Turbo) — hosted at ollama.com, no local install required.
  'claude-ollama-gpt-oss-20b': 'gpt-oss:20b-cloud',
  'claude-ollama-gpt-oss-120b': 'gpt-oss:120b-cloud',
  'claude-ollama-deepseek-v3.1': 'deepseek-v3.1:671b-cloud',
  'claude-ollama-deepseek-v3.2': 'deepseek-v3.2:cloud',
  'claude-ollama-deepseek-v4-flash': 'deepseek-v4-flash:cloud',
  'claude-ollama-deepseek-v4-pro': 'deepseek-v4-pro:cloud',
  'claude-ollama-qwen3-coder': 'qwen3-coder:480b-cloud',
  'claude-ollama-qwen3-coder-next': 'qwen3-coder-next:cloud',
  'claude-ollama-qwen3-vl': 'qwen3-vl:235b-cloud',
  'claude-ollama-qwen3-vl-instruct': 'qwen3-vl:235b-instruct-cloud',
  'claude-ollama-qwen3-next': 'qwen3-next:80b-cloud',
  'claude-ollama-qwen3.5': 'qwen3.5:cloud',
  'claude-ollama-kimi-k2': 'kimi-k2:1t-cloud',
  'claude-ollama-kimi-k2-thinking': 'kimi-k2-thinking:cloud',
  'claude-ollama-kimi-k2.6': 'kimi-k2.6:cloud',
  'claude-ollama-glm-4.6': 'glm-4.6:cloud',
  'claude-ollama-glm-4.7': 'glm-4.7:cloud',
  'claude-ollama-glm-5': 'glm-5:cloud',
  'claude-ollama-glm-5.1': 'glm-5.1:cloud',
  'claude-ollama-minimax-m2': 'minimax-m2:cloud',
  'claude-ollama-minimax-m2.1': 'minimax-m2.1:cloud',
  'claude-ollama-minimax-m2.5': 'minimax-m2.5:cloud',
  'claude-ollama-minimax-m2.7': 'minimax-m2.7:cloud',
  'claude-ollama-nemotron-3-nano': 'nemotron-3-nano:30b-cloud',
  'claude-ollama-nemotron-3-super': 'nemotron-3-super:cloud',
  'claude-ollama-devstral-small-2': 'devstral-small-2:24b-cloud',
  'claude-ollama-ministral-3': 'ministral-3:8b-cloud',
  'claude-ollama-gemma4-31b': 'gemma4:31b-cloud',
  'claude-ollama-gemini-3-flash-preview': 'gemini-3-flash-preview:cloud',
  'claude-ollama-rnj-1': 'rnj-1:8b-cloud',
  // Short Ollama Cloud aliases
  'claude-dsv4-flash': 'deepseek-v4-flash:cloud',
  'claude-dsv4-pro': 'deepseek-v4-pro:cloud',
  'claude-glm51': 'glm-5.1:cloud',
  // HuggingFace Inference Router aliases (free tier — needs HF_TOKEN)
  'claude-hf-llama-3.1-8b': 'meta-llama/Llama-3.1-8B-Instruct',
  'claude-hf-llama-3.1-70b': 'meta-llama/Llama-3.1-70B-Instruct',
  'claude-hf-llama-3.3-70b': 'meta-llama/Llama-3.3-70B-Instruct',
  'claude-hf-llama-4-maverick': 'meta-llama/Llama-4-Maverick-17B-128E-Instruct',
  'claude-hf-llama-4-scout': 'meta-llama/Llama-4-Scout-17B-16E-Instruct',
  'claude-hf-qwen-2.5-coder-32b': 'Qwen/Qwen2.5-Coder-32B-Instruct',
  'claude-hf-qwen-2.5-72b': 'Qwen/Qwen2.5-72B-Instruct',
  'claude-hf-qwen3-coder-480b': 'Qwen/Qwen3-Coder-480B-A35B-Instruct',
  'claude-hf-qwen3-next-80b': 'Qwen/Qwen3-Next-80B-A3B-Instruct',
  'claude-hf-deepseek-r1': 'deepseek-ai/DeepSeek-R1',
  'claude-hf-deepseek-v3.1': 'deepseek-ai/DeepSeek-V3.1',
  'claude-hf-deepseek-v3.2': 'deepseek-ai/DeepSeek-V3.2',
  'claude-hf-deepseek-r1-distill-70b': 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',
  'claude-hf-glm-4.6': 'zai-org/GLM-4.6',
  'claude-hf-glm-5': 'zai-org/GLM-5',
  'claude-hf-gpt-oss-120b': 'openai/gpt-oss-120b',
  'claude-hf-gpt-oss-20b': 'openai/gpt-oss-20b',
  'claude-hf-kimi-k2.6': 'moonshotai/Kimi-K2.6',
  // NVIDIA NIM aliases — free at build.nvidia.com with an nvapi- key
  'claude-nim-llama-3.1-8b': 'meta/llama-3.1-8b-instruct',
  'claude-nim-llama-3.1-70b': 'meta/llama-3.1-70b-instruct',
  'claude-nim-llama-3.1-405b': 'meta/llama-3.1-405b-instruct',
  'claude-nim-llama-3.3-70b': 'meta/llama-3.3-70b-instruct',
  'claude-nim-llama-4-maverick': 'meta/llama-4-maverick-17b-128e-instruct',
  'claude-nim-llama-4-scout': 'meta/llama-4-scout-17b-16e-instruct',
  'claude-nim-nemotron-nano-8b': 'nvidia/llama-3.1-nemotron-nano-8b-v1',
  'claude-nim-nemotron-super-49b': 'nvidia/llama-3.3-nemotron-super-49b-v1',
  'claude-nim-nemotron-70b': 'nvidia/llama-3.1-nemotron-70b-instruct',
  'claude-nim-nemotron-340b': 'nvidia/nemotron-4-340b-instruct',
  'claude-nim-usdcode-70b': 'nvidia/usdcode-llama-3.1-70b-instruct',
  'claude-nim-deepseek-r1': 'deepseek-ai/deepseek-r1',
  'claude-nim-deepseek-r1-distill-70b': 'deepseek-ai/deepseek-r1-distill-llama-70b',
  'claude-nim-deepseek-r1-distill-8b': 'deepseek-ai/deepseek-r1-distill-llama-8b',
  'claude-nim-deepseek-v3.1': 'deepseek-ai/deepseek-v3.1',
  'claude-nim-deepseek-v3.2': 'deepseek-ai/deepseek-v3.2',
  'claude-nim-deepseek-v4-pro': 'deepseek-ai/deepseek-v4-pro',
  'claude-nim-deepseek-v4-flash': 'deepseek-ai/deepseek-v4-flash',
  'claude-nim-qwen-2.5-coder-32b': 'qwen/qwen2.5-coder-32b-instruct',
  'claude-nim-qwen-2.5-coder-7b': 'qwen/qwen2.5-coder-7b-instruct',
  'claude-nim-qwen-2.5-72b': 'qwen/qwen2.5-72b-instruct',
  'claude-nim-qwen-3-235b': 'qwen/qwen3-235b-a22b',
  'claude-nim-qwq-32b': 'qwen/qwq-32b',
  'claude-nim-mixtral-8x22b': 'mistralai/mixtral-8x22b-instruct-v0.1',
  'claude-nim-mixtral-8x7b': 'mistralai/mixtral-8x7b-instruct-v0.1',
  'claude-nim-mistral-7b': 'mistralai/mistral-7b-instruct-v0.3',
  'claude-nim-mistral-nemo-12b': 'mistralai/mistral-nemo-12b-instruct',
  'claude-nim-codestral-22b': 'mistralai/codestral-22b-v0.1',
  'claude-nim-phi-4': 'microsoft/phi-4',
  'claude-nim-phi-3-medium': 'microsoft/phi-3-medium-4k-instruct',
  'claude-nim-phi-3.5-mini': 'microsoft/phi-3.5-mini-instruct',
  'claude-nim-gemma-2-27b': 'google/gemma-2-27b-it',
  'claude-nim-gemma-2-9b': 'google/gemma-2-9b-it',
  'claude-nim-granite-3-8b': 'ibm-granite/granite-3.1-8b-instruct',
  'claude-nim-palmyra-creative-122b': 'writer/palmyra-creative-122b',
  'claude-nim-yi-large': '01-ai/yi-large',
  // Native Anthropic Claude (forwarded to Anthropic Messages when ANTHROPIC_API_KEY is set)
  'claude-haiku-4-5': 'claude-haiku-4-5',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-opus-4-7': 'claude-opus-4-7',
  'claude-sonnet-4-5': 'claude-sonnet-4-5',
  'claude-opus-4-1': 'claude-opus-4-1',
});

// Upstream model id → Claude-style alias, used to rewrite response model fields.
export const DEFAULT_MODEL_ALIASES = Object.freeze({
  'deepseek-v4-flash': 'claude-deepseek-v4-flash',
  'deepseek-v4-pro': 'claude-deepseek-v4-pro',
  'kimi-k2.6': 'claude-kimi-k2.6',
  'glm-4.5-air': 'claude-glm-4.5-air',
  'glm-4.6': 'claude-glm-4.6',
  'glm-4.7': 'claude-glm-4.7',
  'glm-5': 'claude-glm-5',
  'glm-5.1': 'claude-glm-5.1',
  'mimo-v2-flash': 'claude-mimo-v2-flash',
  'mimo-v2-pro': 'claude-mimo-v2-pro',
  'mimo-v2.5-pro': 'claude-mimo-v2.5-pro',
  'mimo-v2-omni': 'claude-mimo-v2-omni',
  'gpt-5.5': 'claude-gpt-5.5',
  'gpt-5.4': 'claude-gpt-5.4',
  'gpt-5.4-mini': 'claude-gpt-5.4-mini',
  'gemini-3.1-flash-lite-preview': 'claude-gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview': 'claude-gemini-3-flash-preview',
  'gemini-3.1-pro-preview': 'claude-gemini-3.1-pro-preview',
  'gemini-2.5-pro': 'claude-gemini-2.5-pro',
  'gemini-2.5-flash': 'claude-gemini-2.5-flash',
  'gemini-2.0-flash': 'claude-gemini-2.0-flash',
  'qwen-flash': 'claude-qwen-flash',
  'qwen-plus': 'claude-qwen-plus',
  'qwen-max': 'claude-qwen-max',
  'gpt-oss:20b-cloud': 'claude-ollama-gpt-oss-20b',
  'gpt-oss:120b-cloud': 'claude-ollama-gpt-oss-120b',
  'deepseek-v3.1:671b-cloud': 'claude-ollama-deepseek-v3.1',
  'deepseek-v3.2:cloud': 'claude-ollama-deepseek-v3.2',
  'deepseek-v4-flash:cloud': 'claude-dsv4-flash',
  'deepseek-v4-pro:cloud': 'claude-dsv4-pro',
  'qwen3-coder:480b-cloud': 'claude-ollama-qwen3-coder',
  'qwen3-coder-next:cloud': 'claude-ollama-qwen3-coder-next',
  'qwen3-vl:235b-cloud': 'claude-ollama-qwen3-vl',
  'qwen3-vl:235b-instruct-cloud': 'claude-ollama-qwen3-vl-instruct',
  'qwen3-next:80b-cloud': 'claude-ollama-qwen3-next',
  'qwen3.5:cloud': 'claude-ollama-qwen3.5',
  'kimi-k2:1t-cloud': 'claude-ollama-kimi-k2',
  'kimi-k2-thinking:cloud': 'claude-ollama-kimi-k2-thinking',
  'kimi-k2.6:cloud': 'claude-ollama-kimi-k2.6',
  'glm-4.6:cloud': 'claude-ollama-glm-4.6',
  'glm-4.7:cloud': 'claude-ollama-glm-4.7',
  'glm-5:cloud': 'claude-ollama-glm-5',
  'glm-5.1:cloud': 'claude-glm51',
  'minimax-m2:cloud': 'claude-ollama-minimax-m2',
  'minimax-m2.1:cloud': 'claude-ollama-minimax-m2.1',
  'minimax-m2.5:cloud': 'claude-ollama-minimax-m2.5',
  'minimax-m2.7:cloud': 'claude-ollama-minimax-m2.7',
  'nemotron-3-nano:30b-cloud': 'claude-ollama-nemotron-3-nano',
  'nemotron-3-super:cloud': 'claude-ollama-nemotron-3-super',
  'devstral-small-2:24b-cloud': 'claude-ollama-devstral-small-2',
  'ministral-3:8b-cloud': 'claude-ollama-ministral-3',
  'gemma4:31b-cloud': 'claude-ollama-gemma4-31b',
  'gemini-3-flash-preview:cloud': 'claude-ollama-gemini-3-flash-preview',
  'rnj-1:8b-cloud': 'claude-ollama-rnj-1',
  // HuggingFace Router reverse aliases
  'meta-llama/Llama-3.1-8B-Instruct': 'claude-hf-llama-3.1-8b',
  'meta-llama/Llama-3.1-70B-Instruct': 'claude-hf-llama-3.1-70b',
  'meta-llama/Llama-3.3-70B-Instruct': 'claude-hf-llama-3.3-70b',
  'meta-llama/Llama-4-Maverick-17B-128E-Instruct': 'claude-hf-llama-4-maverick',
  'meta-llama/Llama-4-Scout-17B-16E-Instruct': 'claude-hf-llama-4-scout',
  'Qwen/Qwen2.5-Coder-32B-Instruct': 'claude-hf-qwen-2.5-coder-32b',
  'Qwen/Qwen2.5-72B-Instruct': 'claude-hf-qwen-2.5-72b',
  'Qwen/Qwen3-Coder-480B-A35B-Instruct': 'claude-hf-qwen3-coder-480b',
  'Qwen/Qwen3-Next-80B-A3B-Instruct': 'claude-hf-qwen3-next-80b',
  'deepseek-ai/DeepSeek-R1': 'claude-hf-deepseek-r1',
  'deepseek-ai/DeepSeek-V3.1': 'claude-hf-deepseek-v3.1',
  'deepseek-ai/DeepSeek-V3.2': 'claude-hf-deepseek-v3.2',
  'deepseek-ai/DeepSeek-R1-Distill-Llama-70B': 'claude-hf-deepseek-r1-distill-70b',
  'zai-org/GLM-4.6': 'claude-hf-glm-4.6',
  'zai-org/GLM-5': 'claude-hf-glm-5',
  'openai/gpt-oss-120b': 'claude-hf-gpt-oss-120b',
  'openai/gpt-oss-20b': 'claude-hf-gpt-oss-20b',
  'moonshotai/Kimi-K2.6': 'claude-hf-kimi-k2.6',
  // NVIDIA NIM reverse aliases
  'meta/llama-3.1-8b-instruct': 'claude-nim-llama-3.1-8b',
  'meta/llama-3.1-70b-instruct': 'claude-nim-llama-3.1-70b',
  'meta/llama-3.1-405b-instruct': 'claude-nim-llama-3.1-405b',
  'meta/llama-3.3-70b-instruct': 'claude-nim-llama-3.3-70b',
  'meta/llama-4-maverick-17b-128e-instruct': 'claude-nim-llama-4-maverick',
  'meta/llama-4-scout-17b-16e-instruct': 'claude-nim-llama-4-scout',
  'nvidia/llama-3.1-nemotron-nano-8b-v1': 'claude-nim-nemotron-nano-8b',
  'nvidia/llama-3.3-nemotron-super-49b-v1': 'claude-nim-nemotron-super-49b',
  'nvidia/llama-3.1-nemotron-70b-instruct': 'claude-nim-nemotron-70b',
  'nvidia/nemotron-4-340b-instruct': 'claude-nim-nemotron-340b',
  'nvidia/usdcode-llama-3.1-70b-instruct': 'claude-nim-usdcode-70b',
  'deepseek-ai/deepseek-r1': 'claude-nim-deepseek-r1',
  'deepseek-ai/deepseek-r1-distill-llama-70b': 'claude-nim-deepseek-r1-distill-70b',
  'deepseek-ai/deepseek-r1-distill-llama-8b': 'claude-nim-deepseek-r1-distill-8b',
  'deepseek-ai/deepseek-v3.1': 'claude-nim-deepseek-v3.1',
  'deepseek-ai/deepseek-v3.2': 'claude-nim-deepseek-v3.2',
  'deepseek-ai/deepseek-v4-pro': 'claude-nim-deepseek-v4-pro',
  'deepseek-ai/deepseek-v4-flash': 'claude-nim-deepseek-v4-flash',
  'qwen/qwen2.5-coder-32b-instruct': 'claude-nim-qwen-2.5-coder-32b',
  'qwen/qwen2.5-coder-7b-instruct': 'claude-nim-qwen-2.5-coder-7b',
  'qwen/qwen2.5-72b-instruct': 'claude-nim-qwen-2.5-72b',
  'qwen/qwen3-235b-a22b': 'claude-nim-qwen-3-235b',
  'qwen/qwq-32b': 'claude-nim-qwq-32b',
  'mistralai/mixtral-8x22b-instruct-v0.1': 'claude-nim-mixtral-8x22b',
  'mistralai/mixtral-8x7b-instruct-v0.1': 'claude-nim-mixtral-8x7b',
  'mistralai/mistral-7b-instruct-v0.3': 'claude-nim-mistral-7b',
  'mistralai/mistral-nemo-12b-instruct': 'claude-nim-mistral-nemo-12b',
  'mistralai/codestral-22b-v0.1': 'claude-nim-codestral-22b',
  'microsoft/phi-4': 'claude-nim-phi-4',
  'microsoft/phi-3-medium-4k-instruct': 'claude-nim-phi-3-medium',
  'microsoft/phi-3.5-mini-instruct': 'claude-nim-phi-3.5-mini',
  'google/gemma-2-27b-it': 'claude-nim-gemma-2-27b',
  'google/gemma-2-9b-it': 'claude-nim-gemma-2-9b',
  'ibm-granite/granite-3.1-8b-instruct': 'claude-nim-granite-3-8b',
  'writer/palmyra-creative-122b': 'claude-nim-palmyra-creative-122b',
  '01-ai/yi-large': 'claude-nim-yi-large',
  'claude-haiku-4-5': 'claude-haiku-4-5',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-opus-4-7': 'claude-opus-4-7',
  'claude-sonnet-4-5': 'claude-sonnet-4-5',
  'claude-opus-4-1': 'claude-opus-4-1',
});

// Model/Claude alias → provider name. Provider names are normalized at load.
export const DEFAULT_MODEL_ROUTES = Object.freeze({
  'deepseek-v4-flash': 'deepseek',
  'deepseek-v4-pro': 'deepseek',
  'kimi-k2.6': 'moonshot',
  'glm-4.5-air': 'glm',
  'glm-4.6': 'glm',
  'glm-4.7': 'glm',
  'glm-5': 'glm',
  'glm-5.1': 'glm',
  'mimo-v2-flash': 'xiaomi',
  'mimo-v2-pro': 'xiaomi',
  'mimo-v2.5-pro': 'xiaomi',
  'mimo-v2-omni': 'xiaomi',
  'gpt-5.5': 'openai',
  'gpt-5.4': 'openai',
  'gpt-5.4-mini': 'openai',
  'gemini-3.1-pro-preview': 'gemini',
  'gemini-3-flash-preview': 'gemini',
  'gemini-2.5-pro': 'gemini',
  'gemini-2.5-flash': 'gemini',
  'gemini-3.1-flash-lite-preview': 'gemini',
  'gemini-2.0-flash': 'gemini',
  'qwen-flash': 'qwen',
  'qwen-plus': 'qwen',
  'qwen-max': 'qwen',
  'claude-ollama-gpt-oss-20b': 'ollama',
  'claude-ollama-gpt-oss-120b': 'ollama',
  'claude-ollama-deepseek-v3.1': 'ollama',
  'claude-ollama-deepseek-v3.2': 'ollama',
  'claude-ollama-deepseek-v4-flash': 'ollama',
  'claude-ollama-deepseek-v4-pro': 'ollama',
  'claude-ollama-qwen3-coder': 'ollama',
  'claude-ollama-qwen3-coder-next': 'ollama',
  'claude-ollama-qwen3-vl': 'ollama',
  'claude-ollama-qwen3-vl-instruct': 'ollama',
  'claude-ollama-qwen3-next': 'ollama',
  'claude-ollama-qwen3.5': 'ollama',
  'claude-ollama-kimi-k2': 'ollama',
  'claude-ollama-kimi-k2-thinking': 'ollama',
  'claude-ollama-kimi-k2.6': 'ollama',
  'claude-ollama-glm-4.6': 'ollama',
  'claude-ollama-glm-4.7': 'ollama',
  'claude-ollama-glm-5': 'ollama',
  'claude-ollama-glm-5.1': 'ollama',
  'claude-ollama-minimax-m2': 'ollama',
  'claude-ollama-minimax-m2.1': 'ollama',
  'claude-ollama-minimax-m2.5': 'ollama',
  'claude-ollama-minimax-m2.7': 'ollama',
  'claude-ollama-nemotron-3-nano': 'ollama',
  'claude-ollama-nemotron-3-super': 'ollama',
  'claude-ollama-devstral-small-2': 'ollama',
  'claude-ollama-ministral-3': 'ollama',
  'claude-ollama-gemma4-31b': 'ollama',
  'claude-ollama-gemini-3-flash-preview': 'ollama',
  'claude-ollama-rnj-1': 'ollama',
  'claude-dsv4-flash': 'ollama',
  'claude-dsv4-pro': 'ollama',
  'claude-glm51': 'ollama',
  // HuggingFace Router routes
  'claude-hf-llama-3.1-8b': 'huggingface',
  'claude-hf-llama-3.1-70b': 'huggingface',
  'claude-hf-llama-3.3-70b': 'huggingface',
  'claude-hf-llama-4-maverick': 'huggingface',
  'claude-hf-llama-4-scout': 'huggingface',
  'claude-hf-qwen-2.5-coder-32b': 'huggingface',
  'claude-hf-qwen-2.5-72b': 'huggingface',
  'claude-hf-qwen3-coder-480b': 'huggingface',
  'claude-hf-qwen3-next-80b': 'huggingface',
  'claude-hf-deepseek-r1': 'huggingface',
  'claude-hf-deepseek-v3.1': 'huggingface',
  'claude-hf-deepseek-v3.2': 'huggingface',
  'claude-hf-deepseek-r1-distill-70b': 'huggingface',
  'claude-hf-glm-4.6': 'huggingface',
  'claude-hf-glm-5': 'huggingface',
  'claude-hf-gpt-oss-120b': 'huggingface',
  'claude-hf-gpt-oss-20b': 'huggingface',
  'claude-hf-kimi-k2.6': 'huggingface',
  // NVIDIA NIM routes
  'claude-nim-llama-3.1-8b': 'nvidia',
  'claude-nim-llama-3.1-70b': 'nvidia',
  'claude-nim-llama-3.1-405b': 'nvidia',
  'claude-nim-llama-3.3-70b': 'nvidia',
  'claude-nim-llama-4-maverick': 'nvidia',
  'claude-nim-llama-4-scout': 'nvidia',
  'claude-nim-nemotron-nano-8b': 'nvidia',
  'claude-nim-nemotron-super-49b': 'nvidia',
  'claude-nim-nemotron-70b': 'nvidia',
  'claude-nim-nemotron-340b': 'nvidia',
  'claude-nim-usdcode-70b': 'nvidia',
  'claude-nim-deepseek-r1': 'nvidia',
  'claude-nim-deepseek-r1-distill-70b': 'nvidia',
  'claude-nim-deepseek-r1-distill-8b': 'nvidia',
  'claude-nim-deepseek-v3.1': 'nvidia',
  'claude-nim-deepseek-v3.2': 'nvidia',
  'claude-nim-deepseek-v4-pro': 'nvidia',
  'claude-nim-deepseek-v4-flash': 'nvidia',
  'claude-nim-qwen-2.5-coder-32b': 'nvidia',
  'claude-nim-qwen-2.5-coder-7b': 'nvidia',
  'claude-nim-qwen-2.5-72b': 'nvidia',
  'claude-nim-qwen-3-235b': 'nvidia',
  'claude-nim-qwq-32b': 'nvidia',
  'claude-nim-mixtral-8x22b': 'nvidia',
  'claude-nim-mixtral-8x7b': 'nvidia',
  'claude-nim-mistral-7b': 'nvidia',
  'claude-nim-mistral-nemo-12b': 'nvidia',
  'claude-nim-codestral-22b': 'nvidia',
  'claude-nim-phi-4': 'nvidia',
  'claude-nim-phi-3-medium': 'nvidia',
  'claude-nim-phi-3.5-mini': 'nvidia',
  'claude-nim-gemma-2-27b': 'nvidia',
  'claude-nim-gemma-2-9b': 'nvidia',
  'claude-nim-granite-3-8b': 'nvidia',
  'claude-nim-palmyra-creative-122b': 'nvidia',
  'claude-nim-yi-large': 'nvidia',
  'claude-haiku-4-5': 'anthropic',
  'claude-sonnet-4-6': 'anthropic',
  'claude-opus-4-7': 'anthropic',
  'claude-sonnet-4-5': 'anthropic',
  'claude-opus-4-1': 'anthropic',
});

// Claude family fallbacks — used when an incoming model is a dated/unknown
// Claude model AND the Anthropic provider has no API key configured.
// Each value is a Claude-style request alias that exists in DEFAULT_MODEL_MAP.
export const DEFAULT_CLAUDE_FAMILY_FALLBACK = Object.freeze({
  haiku: 'claude-ollama-qwen3-coder-next',
  sonnet: 'claude-ollama-qwen3-coder',
  opus: 'claude-ollama-gpt-oss-120b',
});

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const MODEL_VALUE_KEYS = new Set([
  'default_model',
  'id',
  'model',
  'model_id',
  'name',
]);

const MODEL_ARRAY_KEYS = new Set([
  'inferenceModels',
  'inference_models',
  'models',
]);

const DEFAULT_REQUEST_BODY_LIMIT_BYTES = 50 * 1024 * 1024;

const CLAUDE_DATED_SUFFIX = /-(\d{8})$/;

// ─────────────────────────────────────────────────────────────────────────────
// Smart model resolution — handles dated Claude names + family fallbacks.
// ─────────────────────────────────────────────────────────────────────────────

export function resolveClaudeFamily(model) {
  if (typeof model !== 'string') return null;
  if (/^claude-haiku\b/.test(model)) return 'haiku';
  if (/^claude-sonnet\b/.test(model)) return 'sonnet';
  if (/^claude-opus\b/.test(model)) return 'opus';
  return null;
}

export function stripClaudeDate(model) {
  if (typeof model !== 'string') return model;
  return model.replace(CLAUDE_DATED_SUFFIX, '');
}

/**
 * Resolve an incoming Claude-style request model to its upstream id.
 *
 * Resolution order:
 *   1. Exact MODEL_MAP lookup
 *   2. MODEL_MAP lookup with the date suffix stripped (claude-haiku-4-5-20251001 → claude-haiku-4-5)
 *   3. If the model is a Claude family (haiku/sonnet/opus) AND the Anthropic
 *      provider has no API key, fall back to the configured family alias and
 *      resolve again.
 *   4. Pass through unchanged.
 *
 * Returns { upstreamModel, requestAlias, family }. requestAlias is the
 * Claude-style alias the caller should see in the response (used to rewrite
 * response model fields).
 */
export function resolveModelForUpstream(model, config) {
  if (typeof model !== 'string' || !model) {
    return { upstreamModel: model, requestAlias: model, family: null };
  }

  const anthropicHasKey = Boolean(config.providers?.anthropic?.upstreamApiKey);
  const stripped = stripClaudeDate(model);

  // Helper: would looking up `alias` in modelRoutes send us to Anthropic? If so,
  // and Anthropic has no key, treat this as "no usable mapping" and fall through
  // to the family fallback. This is what keeps Ollama-only setups working when
  // Claude Desktop emits internal calls like claude-haiku-4-5-20251001.
  const routesToAnthropicWithoutKey = (alias) =>
    config.modelRoutes?.[alias] === 'anthropic' && !anthropicHasKey;

  // 1. Exact map hit (unless that hit routes to Anthropic with no key).
  if (config.modelMap[model] && !routesToAnthropicWithoutKey(model)) {
    return {
      upstreamModel: config.modelMap[model],
      requestAlias: model,
      family: resolveClaudeFamily(model),
    };
  }

  // 2. Date-stripped map hit (same caveat).
  if (
    stripped !== model
    && config.modelMap[stripped]
    && !routesToAnthropicWithoutKey(stripped)
  ) {
    return {
      upstreamModel: config.modelMap[stripped],
      requestAlias: stripped,
      family: resolveClaudeFamily(stripped),
    };
  }

  // 3. Family fallback when Anthropic has no key.
  const family = resolveClaudeFamily(model) || resolveClaudeFamily(stripped);
  if (family && !anthropicHasKey) {
    const fallbackAlias = config.claudeFamilyFallback?.[family];
    if (fallbackAlias && config.modelMap[fallbackAlias]) {
      return {
        upstreamModel: config.modelMap[fallbackAlias],
        requestAlias: fallbackAlias,
        family,
      };
    }
  }

  // 4. Last resort: if exact or stripped hit exists (even when it would route
  //    to Anthropic-without-key), use it. The forwarded request will fail at
  //    the upstream stage, but at least we don't return the raw dated name
  //    that no provider knows about.
  if (config.modelMap[model]) {
    return {
      upstreamModel: config.modelMap[model],
      requestAlias: model,
      family: resolveClaudeFamily(model),
    };
  }
  if (stripped !== model && config.modelMap[stripped]) {
    return {
      upstreamModel: config.modelMap[stripped],
      requestAlias: stripped,
      family: resolveClaudeFamily(stripped),
    };
  }

  // 5. Pass through.
  return {
    upstreamModel: model,
    requestAlias: model,
    family,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Config loading
// ─────────────────────────────────────────────────────────────────────────────

export function loadConfig(env = process.env) {
  env = mergeAdvancedEnv(env);

  const port = parseInteger(env.PORT || env.CLAUDE_DEEPSEEK_PROXY_PORT, 8787);
  const modelMap = {
    ...DEFAULT_MODEL_MAP,
    ...parseStringMap(env.MODEL_MAP, 'MODEL_MAP'),
  };
  const modelAliases = {
    ...DEFAULT_MODEL_ALIASES,
    ...parseStringMap(env.MODEL_ALIASES, 'MODEL_ALIASES'),
  };
  const modelRoutes = normalizeProviderRoutes({
    ...DEFAULT_MODEL_ROUTES,
    ...parseStringMap(env.MODEL_ROUTES, 'MODEL_ROUTES'),
  });

  const claudeFamilyFallback = {
    ...DEFAULT_CLAUDE_FAMILY_FALLBACK,
    ...(env.CLAUDE_HAIKU_MODEL ? { haiku: env.CLAUDE_HAIKU_MODEL } : {}),
    ...(env.CLAUDE_SONNET_MODEL ? { sonnet: env.CLAUDE_SONNET_MODEL } : {}),
    ...(env.CLAUDE_OPUS_MODEL ? { opus: env.CLAUDE_OPUS_MODEL } : {}),
  };

  return {
    port,
    baseUrl: env.BASE_URL || env.PROXY_BASE_URL || 'http://127.0.0.1:8787',
    defaultProvider: normalizeProviderName(env.DEFAULT_PROVIDER || 'deepseek'),
    providers: {
      deepseek: {
        upstreamBaseUrl: new URL(
          env.DEEPSEEK_BASE_URL
            || env.UPSTREAM_BASE_URL
            || 'https://api.deepseek.com/anthropic',
        ),
        upstreamApiKey: env.DEEPSEEK_API_KEY || env.UPSTREAM_API_KEY || '',
        format: 'anthropic',
        authScheme: 'bearer',
      },
      moonshot: {
        upstreamBaseUrl: new URL(
          env.MOONSHOT_BASE_URL
            || env.KIMI_BASE_URL
            || 'https://api.moonshot.cn/anthropic',
        ),
        upstreamApiKey: env.MOONSHOT_API_KEY || env.KIMI_API_KEY || '',
        format: 'anthropic',
        authScheme: 'bearer',
      },
      glm: {
        upstreamBaseUrl: new URL(
          env.GLM_BASE_URL
            || env.ZAI_BASE_URL
            || env.ZHIPU_BASE_URL
            || 'https://api.z.ai/api/anthropic',
        ),
        upstreamApiKey: env.GLM_API_KEY || env.ZAI_API_KEY || env.ZHIPU_API_KEY || '',
        format: 'anthropic',
        authScheme: 'bearer',
      },
      xiaomi: {
        upstreamBaseUrl: new URL(
          env.XIAOMI_BASE_URL
            || env.MIMO_BASE_URL
            || 'https://api.xiaomimimo.com/anthropic',
        ),
        upstreamApiKey: env.XIAOMI_API_KEY || env.MIMO_API_KEY || '',
        format: 'anthropic',
        authScheme: 'bearer',
      },
      openai: {
        upstreamBaseUrl: new URL(env.OPENAI_BASE_URL || 'https://api.openai.com/v1'),
        upstreamApiKey: env.OPENAI_API_KEY || '',
        format: 'openai-chat',
        authScheme: 'bearer',
        maxTokensField: 'max_completion_tokens',
      },
      gemini: {
        upstreamBaseUrl: new URL(
          env.GEMINI_BASE_URL
            || env.GOOGLE_BASE_URL
            || 'https://generativelanguage.googleapis.com/v1beta/openai',
        ),
        upstreamApiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '',
        format: 'openai-chat',
        authScheme: 'bearer',
        maxTokensField: 'max_tokens',
      },
      qwen: {
        upstreamBaseUrl: new URL(
          env.QWEN_BASE_URL
            || env.DASHSCOPE_BASE_URL
            || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        ),
        upstreamApiKey: env.QWEN_API_KEY || env.DASHSCOPE_API_KEY || '',
        format: 'openai-chat',
        authScheme: 'bearer',
        maxTokensField: 'max_tokens',
      },
      ollama: {
        upstreamBaseUrl: new URL(env.OLLAMA_BASE_URL || 'https://ollama.com/v1'),
        upstreamApiKey: env.OLLAMA_API_KEY || '',
        format: 'openai-chat',
        authScheme: 'bearer',
        maxTokensField: 'max_tokens',
      },
      huggingface: {
        upstreamBaseUrl: new URL(
          env.HUGGINGFACE_BASE_URL
            || env.HF_BASE_URL
            || 'https://router.huggingface.co/v1',
        ),
        upstreamApiKey:
          env.HUGGINGFACE_API_KEY
          || env.HF_API_KEY
          || env.HF_TOKEN
          || '',
        format: 'openai-chat',
        authScheme: 'bearer',
        maxTokensField: 'max_tokens',
      },
      nvidia: {
        upstreamBaseUrl: new URL(
          env.NVIDIA_BASE_URL
            || env.NIM_BASE_URL
            || 'https://integrate.api.nvidia.com/v1',
        ),
        upstreamApiKey:
          env.NVIDIA_API_KEY
          || env.NVAPI_KEY
          || env.NIM_API_KEY
          || '',
        format: 'openai-chat',
        authScheme: 'bearer',
        maxTokensField: 'max_tokens',
      },
      anthropic: {
        upstreamBaseUrl: new URL(env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'),
        upstreamApiKey: env.ANTHROPIC_API_KEY || '',
        format: 'anthropic',
        authScheme: 'x-api-key',
        anthropicVersion: env.ANTHROPIC_VERSION || '2023-06-01',
      },
    },
    modelMap,
    modelAliases,
    modelRoutes,
    claudeFamilyFallback,
    rewriteResponses: parseBoolean(env.REWRITE_RESPONSES, false),
    requestBodyLimitBytes: parseInteger(
      env.REQUEST_BODY_LIMIT_BYTES,
      DEFAULT_REQUEST_BODY_LIMIT_BYTES,
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Server
// ─────────────────────────────────────────────────────────────────────────────

export function createProxyServer(config = loadConfig()) {
  const normalizedConfig = normalizeConfig(config);

  return http.createServer(async (clientReq, clientRes) => {
    const requestStart = Date.now();

    debugBlock('INCOMING REQUEST', [
      `Method: ${clientReq.method}`,
      `URL: ${clientReq.url}`,
      `User-Agent: ${clientReq.headers['user-agent'] || ''}`,
      `Content-Type: ${clientReq.headers['content-type'] || ''}`,
    ]);

    try {
      // 1. Local health check.
      if (clientReq.method === 'GET' && clientReq.url === '/healthz') {
        sendJson(clientRes, 200, {
          ok: true,
          baseUrl: normalizedConfig.baseUrl,
          defaultProvider: normalizedConfig.defaultProvider,
          providers: getProviderStatus(normalizedConfig.providers),
          modelMap: normalizedConfig.modelMap,
          modelAliases: normalizedConfig.modelAliases,
          modelRoutes: normalizedConfig.modelRoutes,
          claudeFamilyFallback: normalizedConfig.claudeFamilyFallback,
          rewriteResponses: normalizedConfig.rewriteResponses,
        });
        return;
      }

      // 2. Local /v1/models discovery (Anthropic-compatible shape, matches 6315023).
      if (clientReq.method === 'GET' && isModelsRequest(clientReq.url)) {
        handleModelsRequest(clientReq, clientRes, normalizedConfig);
        return;
      }

      // 3. /v1/messages/count_tokens — answered locally with a character heuristic.
      //    OpenAI-compatible upstreams (Ollama, OpenAI, etc.) don't expose this
      //    endpoint, and the Anthropic upstream's response would be wrong because
      //    the upstream model is different from the alias the client asked about.
      if (clientReq.method === 'POST' && isCountTokensRequest(clientReq.url)) {
        await handleCountTokensRequest(clientReq, clientRes, normalizedConfig);
        return;
      }

      const rawBody = await readRequestBody(
        clientReq,
        normalizedConfig.requestBodyLimitBytes,
      );
      const contentType = String(clientReq.headers['content-type'] || '');
      const preparedRequest = prepareRequest(rawBody, contentType, normalizedConfig);
      const target = buildTargetUrl(preparedRequest.provider, clientReq.url || '/');
      const headers = buildUpstreamHeaders(
        clientReq.headers,
        target,
        preparedRequest.body,
        preparedRequest.provider,
      );

      forwardRequest({
        target,
        method: clientReq.method || 'GET',
        headers,
        body: preparedRequest.body,
        clientRes,
        rewriteResponses: normalizedConfig.rewriteResponses,
        responseModelMap: preparedRequest.responseModelMap,
        provider: preparedRequest.provider,
        requestStart,
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      console.error(`[claude-model-proxy] ${statusCode} ${error.message}`);
      sendJson(clientRes, statusCode, {
        error: String(error.message || error),
      });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Local endpoints
// ─────────────────────────────────────────────────────────────────────────────

function isModelsRequest(rawUrl = '/') {
  const pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
  return pathname === '/v1/models' || pathname.startsWith('/v1/models/');
}

function isCountTokensRequest(rawUrl = '/') {
  const pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
  return pathname === '/v1/messages/count_tokens'
    || pathname.endsWith('/v1/messages/count_tokens');
}

// Anthropic Messages models endpoint — character-identical to v0.2.0
// (commit 6315023), which was the last known-good shape. Query parameters
// are intentionally ignored: the endpoint always returns the entire catalog
// with has_more=false. Anything more sophisticated has broken at least one
// Claude surface in past versions.
function handleModelsRequest(req, res, config) {
  const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  const models = listConfiguredModels(config);

  if (pathname === '/v1/models') {
    sendJson(res, 200, {
      data: models,
      first_id: models[0]?.id || null,
      has_more: false,
      last_id: models.at(-1)?.id || null,
    });
    return;
  }

  const modelId = decodeURIComponent(pathname.slice('/v1/models/'.length));
  const model = models.find((item) => item.id === modelId);
  if (!model) {
    sendJson(res, 404, {
      error: `Unknown model: ${modelId}`,
    });
    return;
  }

  sendJson(res, 200, model);
}

const MODELS_CREATED_AT = '2026-01-01T00:00:00Z';

function listConfiguredModels(config) {
  return Object.keys(config.modelMap)
    .sort()
    .map((id) => ({
      type: 'model',
      id,
      display_name: toModelDisplayName(id),
      created_at: MODELS_CREATED_AT,
    }));
}

function toModelDisplayName(id) {
  const stripped = id.replace(/^claude-/, '');
  return stripped
    .split('-')
    .filter(Boolean)
    .map((segment) => {
      if (/^v?\d/.test(segment)) {
        return segment;
      }
      return segment[0].toUpperCase() + segment.slice(1);
    })
    .join(' ');
}

async function handleCountTokensRequest(req, res, config) {
  const rawBody = await readRequestBody(req, config.requestBodyLimitBytes);
  let payload = {};
  if (rawBody.length > 0) {
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      payload = {};
    }
  }

  const inputTokens = estimateAnthropicTokenCount(payload);
  debugBlock('COUNT TOKENS (LOCAL)', [
    `Model: ${payload.model || '(none)'}`,
    `Estimated input_tokens: ${inputTokens}`,
  ]);

  sendJson(res, 200, { input_tokens: inputTokens });
}

/**
 * Heuristic Anthropic token count: total character length of all text content
 * divided by 4 (roughly the ratio for English; close enough for cost-of-prompt
 * estimates that drive client-side decisions like "should we summarize?").
 */
function estimateAnthropicTokenCount(payload) {
  const parts = [];

  for (const block of toArray(payload.system)) {
    if (typeof block === 'string') parts.push(block);
    else if (block?.text) parts.push(block.text);
  }

  for (const message of toArray(payload.messages)) {
    const content = message?.content;
    if (typeof content === 'string') {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === 'string') parts.push(block);
        else if (block?.text) parts.push(block.text);
        else if (block?.content) parts.push(stringifyUnknownContent(block.content));
      }
    }
  }

  for (const tool of toArray(payload.tools)) {
    if (tool?.name) parts.push(tool.name);
    if (tool?.description) parts.push(tool.description);
    if (tool?.input_schema) parts.push(JSON.stringify(tool.input_schema));
  }

  const totalChars = parts.reduce((sum, value) => sum + (value?.length || 0), 0);
  return Math.max(1, Math.ceil(totalChars / 4));
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

// ─────────────────────────────────────────────────────────────────────────────
// Forwarded requests
// ─────────────────────────────────────────────────────────────────────────────

function prepareRequest(rawBody, contentType, config) {
  if (rawBody.length === 0 || !isJsonContentType(contentType)) {
    return {
      body: rawBody,
      provider: resolveProvider('', '', config),
      responseModelMap: config.modelAliases,
    };
  }

  const text = rawBody.toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const err = new Error(`Request body is not valid JSON: ${error.message}`);
    err.statusCode = 400;
    throw err;
  }

  // Pre-resolve the primary request model using the smart resolver so dated
  // Claude names and family fallbacks are honored before the rest of the body
  // is rewritten.
  const primaryRequestModel = typeof parsed?.model === 'string' ? parsed.model : '';
  const primaryResolution = resolveModelForUpstream(primaryRequestModel, config);
  const requestAlias = primaryResolution.requestAlias || primaryRequestModel;

  // Rewrite all `model`/`id`/... values in the body via the modelMap, and then
  // overwrite the primary model with the upstream id from the smart resolver so
  // it picks up date-strip + family fallbacks even when the modelMap doesn't
  // contain the dated alias.
  const rewritten = rewriteModelValues(parsed, config.modelMap);
  if (primaryRequestModel && rewritten && typeof rewritten === 'object') {
    rewritten.model = primaryResolution.upstreamModel;
  }

  const requestModels = collectModelValues(parsed);
  const upstreamModels = collectModelValues(rewritten);
  const upstreamModel = primaryResolution.upstreamModel
    || upstreamModels[0]
    || requestAlias;

  const provider = resolveProvider(upstreamModel, requestAlias, config);

  debugBlock('MODEL ROUTING', [
    `Incoming model: ${primaryRequestModel || '(none)'}`,
    `Resolved request alias: ${requestAlias || '(none)'}`,
    `Upstream model: ${upstreamModel || '(none)'}`,
    `Family fallback: ${primaryResolution.family || 'n/a'}`,
    `Provider: ${provider?.name || ''} (${provider?.upstreamBaseUrl?.host || ''})`,
    `Format: ${provider?.format || ''}`,
  ]);

  return {
    body: formatRequestBody(rewritten, provider),
    provider,
    responseModelMap: buildResponseModelMap(
      [upstreamModel, ...upstreamModels],
      config.modelAliases,
      [requestAlias, ...requestModels],
      config.modelMap,
    ),
  };
}

function forwardRequest({
  target,
  method,
  headers,
  body,
  clientRes,
  rewriteResponses,
  responseModelMap,
  provider,
  requestStart,
}) {
  const transport = target.protocol === 'https:' ? https : http;

  debugBlock('FORWARDING REQUEST', [
    `Method: ${method}`,
    `Target: ${target.href}`,
    `Body Size: ${body.length}`,
  ]);

  const upstreamReq = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      method,
      path: `${target.pathname}${target.search}`,
      headers,
    },
    (upstreamRes) => {
      const duration = Date.now() - (requestStart || Date.now());
      debugBlock('UPSTREAM RESPONSE', [
        `Duration: ${duration}ms`,
        `Status: ${upstreamRes.statusCode} ${upstreamRes.statusMessage || ''}`,
        `Content-Type: ${upstreamRes.headers['content-type'] || ''}`,
      ]);
      handleUpstreamResponse(upstreamRes, clientRes, {
        rewriteResponses,
        responseModelMap,
        provider,
      });
    },
  );

  upstreamReq.on('error', (error) => {
    console.error(`[claude-model-proxy] upstream error: ${error.message}`);
    if (!clientRes.headersSent) {
      sendJson(clientRes, 502, {
        error: `Upstream request failed: ${error.message}`,
      });
      return;
    }
    clientRes.destroy(error);
  });

  upstreamReq.end(body);
}

function handleUpstreamResponse(upstreamRes, clientRes, config) {
  const headers = sanitizeResponseHeaders(upstreamRes.headers);
  const contentType = String(headers['content-type'] || '');

  if (
    config.provider?.format === 'openai-chat'
    && isSuccessfulStatus(upstreamRes.statusCode)
  ) {
    handleOpenAIChatResponse(upstreamRes, clientRes, {
      ...config,
      headers,
      contentType,
    });
    return;
  }

  if (config.rewriteResponses && isJsonContentType(contentType)) {
    collectResponse(upstreamRes)
      .then((body) => {
        if (!isSuccessfulStatus(upstreamRes.statusCode) && DEBUG) {
          console.log('\n========== UPSTREAM ERROR BODY ==========');
          console.log(body.toString('utf8'));
          console.log('=========================================\n');
        }
        const rewritten = rewriteJsonResponseBody(body, config.responseModelMap);
        headers['content-length'] = String(rewritten.length);
        clientRes.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage, headers);
        clientRes.end(rewritten);
      })
      .catch((error) => {
        if (!clientRes.headersSent) {
          sendJson(clientRes, 502, {
            error: `Upstream response handling failed: ${error.message}`,
          });
          return;
        }
        clientRes.destroy(error);
      });
    return;
  }

  clientRes.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage, headers);

  if (config.rewriteResponses && isTextualContentType(contentType)) {
    upstreamRes.pipe(createReplaceStream(config.responseModelMap)).pipe(clientRes);
    return;
  }

  upstreamRes.pipe(clientRes);
}

function formatRequestBody(rewrittenBody, provider) {
  if (provider.format === 'openai-chat') {
    return Buffer.from(JSON.stringify(toOpenAIChatRequest(rewrittenBody, provider)));
  }
  return Buffer.from(JSON.stringify(rewrittenBody));
}

function toOpenAIChatRequest(body, provider) {
  const request = {
    model: body.model,
    messages: [],
  };

  const systemContent = toOpenAIContent(body.system, 'system');
  if (!isEmptyOpenAIContent(systemContent)) {
    request.messages.push({
      role: 'system',
      content: systemContent,
    });
  }

  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    const role = toOpenAIMessageRole(message.role);
    request.messages.push({
      role,
      content: toOpenAIContent(message.content, role),
    });
  }

  copyDefined(request, body, 'temperature');
  copyDefined(request, body, 'top_p');
  copyDefined(request, body, 'stream');
  copyDefined(request, body, 'presence_penalty');
  copyDefined(request, body, 'frequency_penalty');

  if (body.max_tokens !== undefined) {
    request[provider.maxTokensField || 'max_tokens'] = body.max_tokens;
  }

  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length > 0) {
    request.stop = body.stop_sequences;
  }

  if (typeof body.metadata?.user_id === 'string' && body.metadata.user_id) {
    request.user = body.metadata.user_id;
  }

  return request;
}

function toOpenAIMessageRole(role) {
  return role === 'assistant' ? 'assistant' : 'user';
}

function toOpenAIContent(content, role) {
  if (content === undefined || content === null) {
    return '';
  }

  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return stringifyUnknownContent(content);
  }

  const parts = content.flatMap((part) => toOpenAIContentPart(part));
  const hasNonTextPart = parts.some((part) => typeof part !== 'string' && part.type !== 'text');
  if (role !== 'user' || !hasNonTextPart) {
    return parts.map((part) => (typeof part === 'string' ? part : part.text || '')).join('');
  }

  return parts.map((part) => (typeof part === 'string' ? { type: 'text', text: part } : part));
}

function toOpenAIContentPart(part) {
  if (typeof part === 'string') {
    return [part];
  }

  if (!part || typeof part !== 'object') {
    return [String(part ?? '')];
  }

  if (part.type === 'text') {
    return [{ type: 'text', text: part.text || '' }];
  }

  if (part.type === 'image' && part.source?.type === 'base64') {
    return [{
      type: 'image_url',
      image_url: {
        url: `data:${part.source.media_type || 'image/png'};base64,${part.source.data || ''}`,
      },
    }];
  }

  if (part.type === 'tool_result') {
    return [{ type: 'text', text: toTextContent(part.content) }];
  }

  if (part.text) {
    return [{ type: 'text', text: String(part.text) }];
  }

  return [{ type: 'text', text: stringifyUnknownContent(part) }];
}

function toTextContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === 'string') return item;
      if (item?.type === 'text') return item.text || '';
      return stringifyUnknownContent(item);
    }).join('');
  }
  return stringifyUnknownContent(content);
}

function stringifyUnknownContent(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function isEmptyOpenAIContent(content) {
  if (Array.isArray(content)) return content.length === 0;
  return content === '';
}

function copyDefined(target, source, key) {
  if (source[key] !== undefined) target[key] = source[key];
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI-Chat response → Anthropic Messages response
// ─────────────────────────────────────────────────────────────────────────────

function handleOpenAIChatResponse(upstreamRes, clientRes, config) {
  const responseModelMap = config.rewriteResponses ? config.responseModelMap : {};

  if (isJsonContentType(config.contentType)) {
    collectResponse(upstreamRes)
      .then((body) => {
        const converted = convertOpenAIChatJsonResponse(body, responseModelMap);
        config.headers['content-type'] = 'application/json; charset=utf-8';
        config.headers['content-length'] = String(converted.length);
        clientRes.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage, config.headers);
        clientRes.end(converted);
      })
      .catch((error) => {
        if (!clientRes.headersSent) {
          sendJson(clientRes, 502, {
            error: `OpenAI-compatible response handling failed: ${error.message}`,
          });
          return;
        }
        clientRes.destroy(error);
      });
    return;
  }

  clientRes.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage, {
    ...config.headers,
    'content-type': 'text/event-stream; charset=utf-8',
  });
  upstreamRes.pipe(createOpenAIChatSseToAnthropicStream(responseModelMap)).pipe(clientRes);
}

function convertOpenAIChatJsonResponse(body, responseModelMap) {
  if (body.length === 0) {
    return body;
  }

  const parsed = JSON.parse(body.toString('utf8'));
  const choice = parsed.choices?.[0];
  if (!choice) {
    return Buffer.from(JSON.stringify(rewriteModelValues(parsed, responseModelMap)));
  }

  const text = openAIMessageText(choice.message);
  const message = {
    id: parsed.id || 'msg_openai_proxy',
    type: 'message',
    role: 'assistant',
    model: rewriteModelName(parsed.model || '', responseModelMap),
    content: text ? [{ type: 'text', text }] : [],
    stop_reason: toAnthropicStopReason(choice.finish_reason),
    stop_sequence: null,
    usage: toAnthropicUsage(parsed.usage),
  };

  return Buffer.from(JSON.stringify(message));
}

function openAIMessageText(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return part.text || '';
      if (part?.text) return String(part.text);
      if (part?.refusal) return String(part.refusal);
      return '';
    }).join('');
  }
  return message.refusal || '';
}

function createOpenAIChatSseToAnthropicStream(responseModelMap) {
  const decoder = new StringDecoder('utf8');
  const state = {
    buffer: '',
    messageStarted: false,
    contentBlockStarted: false,
    stopped: false,
    id: 'msg_openai_proxy',
    model: '',
    stopReason: 'end_turn',
    usage: { input_tokens: 0, output_tokens: 0 },
  };

  return new Transform({
    transform(chunk, _encoding, callback) {
      state.buffer += decoder.write(chunk).replace(/\r\n/g, '\n');
      processOpenAISseBuffer(this, state, responseModelMap);
      callback();
    },
    flush(callback) {
      state.buffer += decoder.end().replace(/\r\n/g, '\n');
      processOpenAISseBuffer(this, state, responseModelMap, true);
      stopAnthropicStream(this, state);
      callback();
    },
  });
}

function processOpenAISseBuffer(stream, state, responseModelMap, flush = false) {
  while (true) {
    const separatorIndex = state.buffer.indexOf('\n\n');
    if (separatorIndex === -1) break;
    const eventText = state.buffer.slice(0, separatorIndex);
    state.buffer = state.buffer.slice(separatorIndex + 2);
    handleOpenAISseEvent(stream, eventText, state, responseModelMap);
  }
  if (flush && state.buffer.trim()) {
    handleOpenAISseEvent(stream, state.buffer, state, responseModelMap);
    state.buffer = '';
  }
}

function handleOpenAISseEvent(stream, eventText, state, responseModelMap) {
  const data = eventText
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();

  if (!data) return;

  if (data === '[DONE]') {
    stopAnthropicStream(stream, state);
    return;
  }

  let parsed;
  try { parsed = JSON.parse(data); } catch { return; }

  startAnthropicStream(stream, state, parsed, responseModelMap);

  const choice = parsed.choices?.[0];
  if (!choice) {
    if (parsed.usage) state.usage = toAnthropicUsage(parsed.usage);
    return;
  }

  if (choice.finish_reason) state.stopReason = toAnthropicStopReason(choice.finish_reason);

  const text = openAIStreamDeltaText(choice.delta);
  if (text) {
    if (!state.contentBlockStarted) {
      pushSse(stream, 'content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      });
      state.contentBlockStarted = true;
    }
    pushSse(stream, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    });
  }

  if (parsed.usage) state.usage = toAnthropicUsage(parsed.usage);
}

function startAnthropicStream(stream, state, chunk, responseModelMap) {
  if (state.messageStarted) return;
  state.id = chunk.id || state.id;
  state.model = rewriteModelName(chunk.model || state.model, responseModelMap);
  pushSse(stream, 'message_start', {
    type: 'message_start',
    message: {
      id: state.id,
      type: 'message',
      role: 'assistant',
      model: state.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: state.usage,
    },
  });
  state.messageStarted = true;
}

function stopAnthropicStream(stream, state) {
  if (state.stopped) return;
  if (!state.messageStarted) startAnthropicStream(stream, state, {}, {});
  if (state.contentBlockStarted) {
    pushSse(stream, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  }
  pushSse(stream, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: state.stopReason, stop_sequence: null },
    usage: { output_tokens: state.usage.output_tokens || 0 },
  });
  pushSse(stream, 'message_stop', { type: 'message_stop' });
  state.stopped = true;
}

function pushSse(stream, event, payload) {
  stream.push(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function openAIStreamDeltaText(delta) {
  if (!delta) return '';
  if (typeof delta.content === 'string') return delta.content;
  if (Array.isArray(delta.content)) {
    return delta.content.map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return part.text || '';
      if (part?.text) return String(part.text);
      return '';
    }).join('');
  }
  return '';
}

function toAnthropicUsage(usage = {}) {
  return {
    input_tokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
  };
}

function toAnthropicStopReason(reason) {
  if (reason === 'length') return 'max_tokens';
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use';
  return 'end_turn';
}

function rewriteModelName(model, responseModelMap) {
  return responseModelMap[model] || model;
}

function rewriteJsonResponseBody(body, responseModelMap) {
  if (body.length === 0) return body;
  const text = body.toString('utf8');
  let parsed;
  try { parsed = JSON.parse(text); } catch { return body; }
  const rewritten = rewriteModelValues(parsed, responseModelMap);
  return Buffer.from(JSON.stringify(rewritten));
}

export function rewriteModelValues(value, modelMap, keyName = '') {
  if (typeof value === 'string') {
    if (MODEL_VALUE_KEYS.has(keyName) || MODEL_ARRAY_KEYS.has(keyName)) {
      return modelMap[value] || value;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteModelValues(item, modelMap, keyName));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rewriteModelValues(item, modelMap, key),
      ]),
    );
  }
  return value;
}

export function createReplaceStream(modelMap) {
  const entries = Object.entries(modelMap).sort((a, b) => b[0].length - a[0].length);
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  return new Transform({
    transform(chunk, _encoding, callback) {
      buffer += decoder.write(chunk);
      const emitEnd = buffer.lastIndexOf('\n');
      if (emitEnd === -1) { callback(); return; }
      const emitText = replaceAllModels(buffer.slice(0, emitEnd + 1), entries);
      buffer = buffer.slice(emitEnd + 1);
      this.push(emitText);
      callback();
    },
    flush(callback) {
      const text = buffer + decoder.end();
      this.push(replaceAllModels(text, entries));
      callback();
    },
  });
}

function replaceAllModels(text, entries) {
  let output = text;
  for (const [from, to] of entries) {
    output = output.replaceAll(from, to);
  }
  return output;
}

function collectModelValues(value, keyName = '') {
  if (typeof value === 'string') {
    return MODEL_VALUE_KEYS.has(keyName) || MODEL_ARRAY_KEYS.has(keyName) ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectModelValues(item, keyName));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => collectModelValues(item, key));
  }
  return [];
}

function buildResponseModelMap(upstreamModels, modelAliases, requestModels = [], modelMap = {}) {
  const selected = {};

  // Pair each request alias with the upstream id it produced, so responses are
  // rewritten back to the exact alias the client asked for.
  for (const requestModel of requestModels) {
    if (!requestModel) continue;
    const upstreamModel = modelMap[requestModel] || requestModel;
    if (upstreamModels.includes(upstreamModel)) {
      selected[upstreamModel] = requestModel;
    }
  }

  // Fill in any remaining upstream ids from the global alias table.
  for (const model of upstreamModels) {
    if (!model) continue;
    if (!selected[model] && modelAliases[model]) {
      selected[model] = modelAliases[model];
    }
  }

  return Object.keys(selected).length > 0 ? selected : modelAliases;
}

function buildUpstreamHeaders(clientHeaders, target, body, provider) {
  const headers = {};

  for (const [key, value] of Object.entries(clientHeaders)) {
    const lowerKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerKey) || lowerKey === 'host' || lowerKey === 'content-length') {
      continue;
    }
    headers[lowerKey] = value;
  }

  headers.host = target.host;
  headers['content-length'] = String(body.length);
  headers['accept-encoding'] = 'identity';

  if (provider.format === 'openai-chat') {
    delete headers['anthropic-version'];
    delete headers['anthropic-beta'];
    delete headers['x-api-key'];
    headers['content-type'] = 'application/json';
  }

  if (provider.upstreamApiKey) {
    delete headers.authorization;
    delete headers['x-api-key'];
    if (provider.authScheme === 'x-api-key') {
      headers['x-api-key'] = provider.upstreamApiKey;
    } else {
      headers.authorization = `Bearer ${provider.upstreamApiKey}`;
    }
  }

  if (provider.authScheme === 'x-api-key' && provider.anthropicVersion) {
    headers['anthropic-version'] = headers['anthropic-version'] || provider.anthropicVersion;
  }

  return headers;
}

function sanitizeResponseHeaders(upstreamHeaders) {
  const headers = {};
  for (const [key, value] of Object.entries(upstreamHeaders)) {
    const lowerKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerKey)) continue;
    headers[lowerKey] = value;
  }
  delete headers['content-encoding'];
  delete headers['content-length'];
  return headers;
}

/**
 * Build the upstream URL for a forwarded request.
 *
 * Source paths we care about:
 *   /v1/messages                       (Anthropic Messages)
 *   /v1/messages/count_tokens          (Anthropic count-tokens — handled locally
 *                                       before we get here, but we still guard)
 *
 * For openai-chat providers, /v1/messages is rewritten to /chat/completions.
 *
 * Path-prefix handling: the upstream base URL may already include a /v1 prefix
 * (e.g. https://ollama.com/v1). To avoid producing /v1/v1/... when the source
 * path also starts with /v1, we strip the leading /v1 from the source path
 * before concatenating it with the base.
 */
function buildTargetUrl(provider, incomingUrl) {
  const source = new URL(incomingUrl, 'http://localhost');
  const target = new URL(provider.upstreamBaseUrl.href);
  const basePath = target.pathname.replace(/\/$/, '');

  let sourcePath = source.pathname;

  if (provider.format === 'openai-chat') {
    if (sourcePath === '/v1/messages' || sourcePath.endsWith('/v1/messages')) {
      sourcePath = '/chat/completions';
    } else if (
      sourcePath === '/v1/messages/count_tokens'
      || sourcePath.endsWith('/v1/messages/count_tokens')
    ) {
      // Already handled locally; if we ever reach here, route to a sensible
      // endpoint instead of /v1/v1/messages/count_tokens.
      sourcePath = '/chat/completions';
    } else if (basePath.endsWith('/v1') && sourcePath.startsWith('/v1/')) {
      // Avoid producing /v1/v1/... for any other /v1/* call when the base URL
      // is already /v1.
      sourcePath = sourcePath.slice(3);
    }
  } else if (basePath.endsWith('/v1') && sourcePath.startsWith('/v1/')) {
    // Same guard for Anthropic-compatible upstreams whose base URL ends in /v1.
    sourcePath = sourcePath.slice(3);
  }

  target.pathname = `${basePath}${sourcePath}`.replace(/\/{2,}/g, '/');
  target.search = provider.format === 'openai-chat' ? '' : source.search;
  return target;
}

async function readRequestBody(req, limitBytes) {
  const chunks = [];
  let totalLength = 0;
  for await (const chunk of req) {
    totalLength += chunk.length;
    if (totalLength > limitBytes) {
      const error = new Error(`Request body exceeds ${limitBytes} bytes`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function collectResponse(res) {
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function sendJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
  });
  res.end(body);
}

function mergeAdvancedEnv(env) {
  return { ...parseAdvancedEnv(env.ADVANCED_ENV), ...env };
}

function parseAdvancedEnv(raw) {
  if (!raw) return {};
  const trimmed = String(raw).trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ADVANCED_ENV must be a JSON object');
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => {
      if (!key || value === null || typeof value === 'object') {
        throw new Error('ADVANCED_ENV keys must be non-empty and values must be strings, numbers, or booleans');
      }
      return [key, String(value)];
    }),
  );
}

function parseStringMap(raw, name) {
  if (!raw) return {};
  let trimmed = String(raw).trim();
  if (!trimmed) return {};

  if (trimmed.startsWith('{')) {
    // Tolerate dotenv multi-line JSON: collapse newlines, drop trailing commas.
    trimmed = trimmed
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/,\s*}/g, '}');
    try {
      const parsed = JSON.parse(trimmed);
      return normalizeStringMap(parsed, name);
    } catch (error) {
      console.error(`\n[claude-model-proxy] ERROR: ${name} is not valid JSON.`);
      console.error(`  Raw value (first 300 chars): ${String(raw).slice(0, 300)}`);
      console.error(`  JSON error: ${error.message}\n`);
      throw new Error(`${name} contains invalid JSON`);
    }
  }

  const parsed = Object.fromEntries(
    trimmed.split(',').map((entry) => {
      const separatorIndex = entry.indexOf('=');
      if (separatorIndex === -1) {
        throw new Error(`${name} entries must use from=to format`);
      }
      return [
        entry.slice(0, separatorIndex).trim(),
        entry.slice(separatorIndex + 1).trim(),
      ];
    }),
  );

  return normalizeStringMap(parsed, name);
}

function normalizeStringMap(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object or from=to list`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([from, to]) => {
      if (!from || typeof to !== 'string' || !to) {
        throw new Error(`${name} keys and values must be non-empty strings`);
      }
      return [from, to];
    }),
  );
}

function normalizeConfig(config) {
  const providers = normalizeProviders(config);
  const providerNames = Object.keys(providers);
  const defaultProvider = normalizeProviderName(
    config.defaultProvider || (providers.deepseek ? 'deepseek' : providerNames[0]),
  );

  if (!providers[defaultProvider]) {
    throw new Error(`No upstream provider configured for ${defaultProvider}`);
  }

  return {
    ...config,
    baseUrl: config.baseUrl || `http://127.0.0.1:${config.port || 8787}`,
    defaultProvider,
    providers,
    modelMap: config.modelMap || DEFAULT_MODEL_MAP,
    modelAliases: config.modelAliases || config.reverseModelMap || DEFAULT_MODEL_ALIASES,
    modelRoutes: normalizeProviderRoutes(config.modelRoutes || DEFAULT_MODEL_ROUTES),
    claudeFamilyFallback: config.claudeFamilyFallback || DEFAULT_CLAUDE_FAMILY_FALLBACK,
    rewriteResponses: config.rewriteResponses ?? false,
    requestBodyLimitBytes: config.requestBodyLimitBytes || DEFAULT_REQUEST_BODY_LIMIT_BYTES,
  };
}

function normalizeProviders(config) {
  if (config.providers) {
    return Object.fromEntries(
      Object.entries(config.providers).map(([name, provider]) => [
        normalizeProviderName(name),
        { ...normalizeProvider(provider), name: normalizeProviderName(name) },
      ]),
    );
  }

  if (config.upstreamBaseUrl) {
    return {
      deepseek: {
        ...normalizeProvider({
          upstreamBaseUrl: config.upstreamBaseUrl,
          upstreamApiKey: config.upstreamApiKey || '',
        }),
        name: 'deepseek',
      },
    };
  }

  throw new Error('At least one upstream provider must be configured');
}

function normalizeProvider(provider) {
  if (!provider?.upstreamBaseUrl) {
    throw new Error('Provider upstreamBaseUrl is required');
  }
  return {
    upstreamBaseUrl: provider.upstreamBaseUrl instanceof URL
      ? provider.upstreamBaseUrl
      : new URL(provider.upstreamBaseUrl),
    upstreamApiKey: provider.upstreamApiKey || '',
    format: normalizeProviderFormat(provider.format || 'anthropic'),
    authScheme: normalizeAuthScheme(provider.authScheme || 'bearer'),
    anthropicVersion: provider.anthropicVersion || '2023-06-01',
    maxTokensField: provider.maxTokensField || 'max_tokens',
  };
}

function normalizeProviderFormat(format) {
  const normalized = String(format || '').trim().toLowerCase();
  if (normalized === 'anthropic' || normalized === 'openai-chat') return normalized;
  throw new Error(`Unsupported provider format: ${format}`);
}

function normalizeAuthScheme(authScheme) {
  const normalized = String(authScheme || '').trim().toLowerCase();
  if (normalized === 'bearer' || normalized === 'x-api-key') return normalized;
  throw new Error(`Unsupported auth scheme: ${authScheme}`);
}

function normalizeProviderRoutes(modelRoutes) {
  return Object.fromEntries(
    Object.entries(modelRoutes).map(([model, provider]) => [
      model,
      normalizeProviderName(provider),
    ]),
  );
}

function normalizeProviderName(provider) {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === 'kimi') return 'moonshot';
  if (normalized === 'hf') return 'huggingface';
  if (normalized === 'nim' || normalized === 'nemo' || normalized === 'nvapi') return 'nvidia';
  return normalized;
}

/**
 * Decide which provider handles a given (upstreamModel, requestAlias).
 *
 * Precedence:
 *   1. modelRoutes[requestAlias] — alias-specific override (lets
 *      claude-glm-4.6 → Z.AI and claude-ollama-glm-4.6 → Ollama coexist).
 *   2. modelRoutes[upstreamModel] — upstream-id route.
 *   3. config.defaultProvider.
 */
function resolveProvider(upstreamModel, requestAlias, config) {
  const providerName = (requestAlias && config.modelRoutes[requestAlias])
    || (upstreamModel && config.modelRoutes[upstreamModel])
    || config.defaultProvider;

  const provider = config.providers[providerName];
  if (!provider) {
    throw new Error(`No upstream provider configured for ${providerName}`);
  }
  return provider;
}

function getProviderStatus(providers) {
  return Object.fromEntries(
    Object.entries(providers).map(([name, provider]) => [
      name,
      {
        upstreamBaseUrl: redactUrl(provider.upstreamBaseUrl),
        hasApiKey: Boolean(provider.upstreamApiKey),
        format: provider.format,
        authScheme: provider.authScheme,
      },
    ]),
  );
}

function parseInteger(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: ${raw}`);
  }
  return parsed;
}

function parseBoolean(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const lower = String(raw).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(lower)) return true;
  if (['0', 'false', 'no', 'off'].includes(lower)) return false;
  throw new Error(`Invalid boolean: ${raw}`);
}

function isSuccessfulStatus(statusCode) {
  return Number.isInteger(statusCode) && statusCode >= 200 && statusCode < 300;
}

function isJsonContentType(contentType) {
  return /\bapplication\/(?:[\w.+-]+\+)?json\b/i.test(contentType);
}

function isTextualContentType(contentType) {
  return /^text\//i.test(contentType) || /\bjson\b/i.test(contentType);
}

function redactUrl(url) {
  const redacted = new URL(url.href);
  redacted.username = '';
  redacted.password = '';
  return redacted.href;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI entry
// ─────────────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  try {
    const config = loadConfig();
    const server = createProxyServer(config);

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`[claude-model-proxy] port ${config.port} is already in use`);
        process.exit(0);
      }
      console.error(`[claude-model-proxy] failed: ${error.message}`);
      process.exit(1);
    });

    server.listen(config.port, '127.0.0.1', () => {
      console.log('========================================');
      console.log(' CLAUDE MODEL PROXY');
      console.log('========================================');
      console.log(`Listening:        http://127.0.0.1:${config.port}`);
      console.log(`Gateway base URL: ${config.baseUrl}`);
      console.log(`Default provider: ${config.defaultProvider}`);
      console.log(`Rewrite responses: ${config.rewriteResponses}`);
      console.log(`Debug logging:    ${DEBUG ? 'on' : 'off'} (DEBUG_PROXY=true to enable)`);
      console.log('----------------------------------------');
      console.log(' Providers (✔ = API key set):');
      for (const [name, provider] of Object.entries(config.providers)) {
        const flag = provider.upstreamApiKey ? '✔' : ' ';
        console.log(`  ${flag} ${name.padEnd(10)} ${provider.upstreamBaseUrl.href}  [${provider.format}]`);
      }
      console.log('----------------------------------------');
      console.log(' Claude family fallback (used when ANTHROPIC_API_KEY is empty):');
      for (const [family, alias] of Object.entries(config.claudeFamilyFallback)) {
        const upstream = config.modelMap[alias] || alias;
        console.log(`  ${family.padEnd(8)} → ${alias}  →  ${upstream}`);
      }
      console.log('----------------------------------------');
      console.log(` Models exposed at /v1/models: ${Object.keys(config.modelMap).length}`);
      console.log('========================================');
    });
  } catch (error) {
    console.error(`[claude-model-proxy] startup failed: ${error.message}`);
    process.exit(1);
  }
}
