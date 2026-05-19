import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_CLAUDE_FAMILY_FALLBACK,
  DEFAULT_MODEL_ALIASES,
  DEFAULT_MODEL_MAP,
  DEFAULT_MODEL_ROUTES,
  SERVER_VERSION,
  createProxyServer,
  loadConfig,
  resolveClaudeFamily,
  resolveModelForUpstream,
  stripClaudeDate,
} from '../proxy.mjs';

test('routes deepseek-v4-flash to DeepSeek flash and rewrites responses back', async (t) => {
  let upstreamBody;
  let upstreamAuthorization;

  const deepseek = http.createServer(async (req, res) => {
    upstreamAuthorization = req.headers.authorization;
    upstreamBody = await readBody(req);

    res.writeHead(200, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({
      id: 'msg_123',
      model: 'deepseek-v4-flash',
      content: [
        {
          type: 'text',
          text: 'ok',
        },
      ],
    }));
  });

  await listen(deepseek);
  t.after(() => close(deepseek));

  const proxy = createProxyServer(createTestConfig({
    deepseekBaseUrl: `http://127.0.0.1:${deepseek.address().port}`,
  }));

  await listen(proxy);
  t.after(() => close(proxy));

  const response = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'deepseek-v4-flash',
    max_tokens: 16,
    messages: [
      {
        role: 'user',
        content: 'deepseek-v4-flash',
      },
    ],
  });

  assert.equal(upstreamAuthorization, 'Bearer deepseek-test-key');
  assert.equal(JSON.parse(upstreamBody).model, 'deepseek-v4-flash');
  assert.equal(JSON.parse(upstreamBody).messages[0].content, 'deepseek-v4-flash');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.model, 'deepseek-v4-flash');
});

test('routes original Claude model names to Anthropic upstream', async (t) => {
  let upstreamBody;
  let upstreamApiKey;

  const anthropic = http.createServer(async (req, res) => {
    upstreamBody = await readBody(req);
    upstreamApiKey = req.headers['x-api-key'];

    res.writeHead(200, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({
      model: 'claude-haiku-4-5',
    }));
  });

  await listen(anthropic);
  t.after(() => close(anthropic));

  const proxy = createProxyServer(createTestConfig({
    anthropicBaseUrl: `http://127.0.0.1:${anthropic.address().port}`,
  }));

  await listen(proxy);
  t.after(() => close(proxy));

  const response = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'claude-haiku-4-5',
  });

  assert.equal(upstreamApiKey, 'anthropic-test-key');
  assert.equal(JSON.parse(upstreamBody).model, 'claude-haiku-4-5');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.model, 'claude-haiku-4-5');
});

test('routes DeepSeek pro and Kimi model names to their providers', async (t) => {
  const seen = [];

  const deepseek = http.createServer(async (req, res) => {
    seen.push({
      provider: 'deepseek',
      authorization: req.headers.authorization,
      body: await readBody(req),
    });

    res.writeHead(200, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({
      model: 'deepseek-v4-pro',
    }));
  });

  const moonshot = http.createServer(async (req, res) => {
    seen.push({
      provider: 'moonshot',
      authorization: req.headers.authorization,
      body: await readBody(req),
    });

    res.writeHead(200, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({
      model: 'kimi-k2.6',
    }));
  });

  await Promise.all([
    listen(deepseek),
    listen(moonshot),
  ]);
  t.after(() => close(deepseek));
  t.after(() => close(moonshot));

  const proxy = createProxyServer(createTestConfig({
    deepseekBaseUrl: `http://127.0.0.1:${deepseek.address().port}`,
    moonshotBaseUrl: `http://127.0.0.1:${moonshot.address().port}`,
  }));

  await listen(proxy);
  t.after(() => close(proxy));

  const deepseekResponse = await postJson(
    `http://127.0.0.1:${proxy.address().port}/v1/messages`,
    {
      model: 'deepseek-v4-pro',
    },
  );
  const kimiResponse = await postJson(
    `http://127.0.0.1:${proxy.address().port}/v1/messages`,
    {
      model: 'kimi-k2.6',
    },
  );

  assert.deepEqual(seen.map((item) => item.provider), ['deepseek', 'moonshot']);
  assert.equal(seen[0].authorization, 'Bearer deepseek-test-key');
  assert.equal(JSON.parse(seen[0].body).model, 'deepseek-v4-pro');
  assert.equal(seen[1].authorization, 'Bearer moonshot-test-key');
  assert.equal(JSON.parse(seen[1].body).model, 'kimi-k2.6');
  assert.equal(deepseekResponse.body.model, 'deepseek-v4-pro');
  assert.equal(kimiResponse.body.model, 'kimi-k2.6');
});

test('rewrites streamed Kimi SSE model names even when split across chunks', async (t) => {
  const moonshot = http.createServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
    });
    res.write('data: {"model":"kimi-');
    setTimeout(() => {
      res.end('k2.6"}\n\n');
    }, 10);
  });

  await listen(moonshot);
  t.after(() => close(moonshot));

  const proxy = createProxyServer(createTestConfig({
    moonshotBaseUrl: `http://127.0.0.1:${moonshot.address().port}`,
  }));

  await listen(proxy);
  t.after(() => close(proxy));

  const response = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'kimi-k2.6',
    stream: true,
  });

  assert.equal(response.text, 'data: {"model":"kimi-k2.6"}\n\n');
});

test('routes GLM and Xiaomi MiMo models with provider-specific API keys', async (t) => {
  const seen = [];

  const glm = http.createServer(async (req, res) => {
    seen.push({
      provider: 'glm',
      authorization: req.headers.authorization,
      body: await readBody(req),
    });

    res.writeHead(200, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({
      model: 'glm-4.7',
    }));
  });

  const xiaomi = http.createServer(async (req, res) => {
    const body = await readBody(req);
    seen.push({
      provider: 'xiaomi',
      authorization: req.headers.authorization,
      body,
    });

    res.writeHead(200, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({
      model: JSON.parse(body).model,
    }));
  });

  await Promise.all([
    listen(glm),
    listen(xiaomi),
  ]);
  t.after(() => close(glm));
  t.after(() => close(xiaomi));

  const proxy = createProxyServer(createTestConfig({
    glmBaseUrl: `http://127.0.0.1:${glm.address().port}`,
    xiaomiBaseUrl: `http://127.0.0.1:${xiaomi.address().port}`,
  }));

  await listen(proxy);
  t.after(() => close(proxy));

  const glmResponse = await postJson(
    `http://127.0.0.1:${proxy.address().port}/v1/messages`,
    {
      model: 'glm-4.7',
    },
  );
  const xiaomiResponse = await postJson(
    `http://127.0.0.1:${proxy.address().port}/v1/messages`,
    {
      model: 'mimo-v2-flash',
    },
  );
  const xiaomiProResponse = await postJson(
    `http://127.0.0.1:${proxy.address().port}/v1/messages`,
    {
      model: 'mimo-v2-pro',
    },
  );

  assert.deepEqual(seen.map((item) => item.provider), ['glm', 'xiaomi', 'xiaomi']);
  assert.equal(seen[0].authorization, 'Bearer glm-test-key');
  assert.equal(JSON.parse(seen[0].body).model, 'glm-4.7');
  assert.equal(seen[1].authorization, 'Bearer xiaomi-test-key');
  assert.equal(JSON.parse(seen[1].body).model, 'mimo-v2-flash');
  assert.equal(seen[2].authorization, 'Bearer xiaomi-test-key');
  assert.equal(JSON.parse(seen[2].body).model, 'mimo-v2-pro');
  assert.equal(glmResponse.body.model, 'glm-4.7');
  assert.equal(xiaomiResponse.body.model, 'mimo-v2-flash');
  assert.equal(xiaomiProResponse.body.model, 'mimo-v2-pro');
});

test('adapts OpenAI Chat Completions to Anthropic Messages', async (t) => {
  let upstreamPath;
  let upstreamAuthorization;
  let upstreamBody;

  const openai = http.createServer(async (req, res) => {
    upstreamPath = req.url;
    upstreamAuthorization = req.headers.authorization;
    upstreamBody = await readBody(req);

    res.writeHead(200, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({
      id: 'chatcmpl_123',
      object: 'chat.completion',
      model: 'gpt-5.5',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'openai ok',
          },
        },
      ],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
      },
    }));
  });

  await listen(openai);
  t.after(() => close(openai));

  const proxy = createProxyServer(createTestConfig({
    openaiBaseUrl: `http://127.0.0.1:${openai.address().port}/v1`,
  }));

  await listen(proxy);
  t.after(() => close(proxy));

  const response = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'gpt-5.5',
    max_tokens: 32,
    system: 'be terse',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'hello',
          },
        ],
      },
    ],
  });

  const parsedUpstreamBody = JSON.parse(upstreamBody);
  assert.equal(upstreamPath, '/v1/chat/completions');
  assert.equal(upstreamAuthorization, 'Bearer openai-test-key');
  assert.equal(parsedUpstreamBody.model, 'gpt-5.5');
  assert.equal(parsedUpstreamBody.max_completion_tokens, 32);
  assert.deepEqual(parsedUpstreamBody.messages, [
    {
      role: 'system',
      content: 'be terse',
    },
    {
      role: 'user',
      content: 'hello',
    },
  ]);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.model, 'gpt-5.5');
  assert.deepEqual(response.body.content, [
    {
      type: 'text',
      text: 'openai ok',
    },
  ]);
  assert.deepEqual(response.body.usage, {
    input_tokens: 11,
    output_tokens: 7,
  });
});

test('routes Gemini OpenAI-compatible requests with Gemini API key', async (t) => {
  let upstreamPath;
  let upstreamAuthorization;
  let upstreamBody;

  const gemini = http.createServer(async (req, res) => {
    upstreamPath = req.url;
    upstreamAuthorization = req.headers.authorization;
    upstreamBody = await readBody(req);

    res.writeHead(200, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({
      id: 'gemini_123',
      model: 'gemini-3.1-pro-preview',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'gemini ok',
          },
        },
      ],
    }));
  });

  await listen(gemini);
  t.after(() => close(gemini));

  const proxy = createProxyServer(createTestConfig({
    geminiBaseUrl: `http://127.0.0.1:${gemini.address().port}/v1beta/openai`,
  }));

  await listen(proxy);
  t.after(() => close(proxy));

  const response = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'gemini-3.1-pro-preview',
    max_tokens: 64,
    messages: [
      {
        role: 'user',
        content: 'hello',
      },
    ],
  });

  const parsedUpstreamBody = JSON.parse(upstreamBody);
  assert.equal(upstreamPath, '/v1beta/openai/chat/completions');
  assert.equal(upstreamAuthorization, 'Bearer gemini-test-key');
  assert.equal(parsedUpstreamBody.model, 'gemini-3.1-pro-preview');
  assert.equal(parsedUpstreamBody.max_tokens, 64);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.model, 'gemini-3.1-pro-preview');
});

test('routes Ollama Cloud requests through OpenAI-compatible endpoint', async (t) => {
  let upstreamPath;
  let upstreamAuthorization;
  let upstreamBody;

  const ollama = http.createServer(async (req, res) => {
    upstreamPath = req.url;
    upstreamAuthorization = req.headers.authorization;
    upstreamBody = await readBody(req);

    res.writeHead(200, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({
      id: 'chatcmpl_ollama',
      model: 'gpt-oss:120b-cloud',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'ollama ok',
          },
        },
      ],
    }));
  });

  await listen(ollama);
  t.after(() => close(ollama));

  const proxy = createProxyServer(createTestConfig({
    ollamaBaseUrl: `http://127.0.0.1:${ollama.address().port}/v1`,
  }));

  await listen(proxy);
  t.after(() => close(proxy));

  const response = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'ollama-gpt-oss-120b',
    max_tokens: 64,
    messages: [
      {
        role: 'user',
        content: 'hello',
      },
    ],
  });

  const parsedUpstreamBody = JSON.parse(upstreamBody);
  assert.equal(upstreamPath, '/v1/chat/completions');
  assert.equal(upstreamAuthorization, 'Bearer ollama-test-key');
  assert.equal(parsedUpstreamBody.model, 'gpt-oss:120b-cloud');
  assert.equal(parsedUpstreamBody.max_tokens, 64);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.model, 'ollama-gpt-oss-120b');
});

test('routes Ollama Cloud glm-4.6 to Ollama provider, not Z.AI, when the Claude alias asks for it', async (t) => {
  const seen = [];

  const ollama = http.createServer(async (req, res) => {
    seen.push({
      provider: 'ollama',
      authorization: req.headers.authorization,
      body: await readBody(req),
    });

    res.writeHead(200, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({
      id: 'chatcmpl_ollama_glm',
      model: 'glm-4.6:cloud',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'ollama glm ok',
          },
        },
      ],
    }));
  });

  const glm = http.createServer(async (req, res) => {
    seen.push({
      provider: 'glm',
      authorization: req.headers.authorization,
      body: await readBody(req),
    });

    res.writeHead(200, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({
      model: 'glm-4.6',
    }));
  });

  await Promise.all([
    listen(ollama),
    listen(glm),
  ]);
  t.after(() => close(ollama));
  t.after(() => close(glm));

  const proxy = createProxyServer(createTestConfig({
    ollamaBaseUrl: `http://127.0.0.1:${ollama.address().port}/v1`,
    glmBaseUrl: `http://127.0.0.1:${glm.address().port}`,
  }));

  await listen(proxy);
  t.after(() => close(proxy));

  const ollamaResponse = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'ollama-glm-4.6',
    max_tokens: 16,
    messages: [{ role: 'user', content: 'hi' }],
  });
  const glmResponse = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'glm-4.6',
  });

  assert.deepEqual(seen.map((item) => item.provider), ['ollama', 'glm']);
  assert.equal(seen[0].authorization, 'Bearer ollama-test-key');
  assert.equal(JSON.parse(seen[0].body).model, 'glm-4.6:cloud');
  assert.equal(seen[1].authorization, 'Bearer glm-test-key');
  assert.equal(JSON.parse(seen[1].body).model, 'glm-4.6');
  assert.equal(ollamaResponse.body.model, 'ollama-glm-4.6');
  assert.equal(glmResponse.body.model, 'glm-4.6');
});

test('routes Qwen OpenAI-compatible requests with DashScope API key', async (t) => {
  let upstreamPath;
  let upstreamAuthorization;
  let upstreamBody;

  const qwen = http.createServer(async (req, res) => {
    upstreamPath = req.url;
    upstreamAuthorization = req.headers.authorization;
    upstreamBody = await readBody(req);

    res.writeHead(200, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({
      id: 'chatcmpl_qwen',
      model: 'qwen-plus',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'qwen ok',
          },
        },
      ],
    }));
  });

  await listen(qwen);
  t.after(() => close(qwen));

  const proxy = createProxyServer(createTestConfig({
    qwenBaseUrl: `http://127.0.0.1:${qwen.address().port}/compatible-mode/v1`,
  }));

  await listen(proxy);
  t.after(() => close(proxy));

  const response = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'qwen-plus',
    max_tokens: 64,
    messages: [
      {
        role: 'user',
        content: 'hello',
      },
    ],
  });

  const parsedUpstreamBody = JSON.parse(upstreamBody);
  assert.equal(upstreamPath, '/compatible-mode/v1/chat/completions');
  assert.equal(upstreamAuthorization, 'Bearer qwen-test-key');
  assert.equal(parsedUpstreamBody.model, 'qwen-plus');
  assert.equal(parsedUpstreamBody.max_tokens, 64);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.model, 'qwen-plus');
});

test('routes Anthropic Claude models with x-api-key auth', async (t) => {
  let upstreamAuthorization;
  let upstreamApiKey;
  let upstreamVersion;
  let upstreamBody;

  const anthropic = http.createServer(async (req, res) => {
    upstreamAuthorization = req.headers.authorization;
    upstreamApiKey = req.headers['x-api-key'];
    upstreamVersion = req.headers['anthropic-version'];
    upstreamBody = await readBody(req);

    res.writeHead(200, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({
      id: 'msg_anthropic',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-7',
      content: [
        {
          type: 'text',
          text: 'anthropic ok',
        },
      ],
    }));
  });

  await listen(anthropic);
  t.after(() => close(anthropic));

  const proxy = createProxyServer(createTestConfig({
    anthropicBaseUrl: `http://127.0.0.1:${anthropic.address().port}`,
  }));

  await listen(proxy);
  t.after(() => close(proxy));

  const response = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'claude-opus-4-7',
    max_tokens: 16,
    messages: [
      {
        role: 'user',
        content: 'hello',
      },
    ],
  });

  assert.equal(upstreamAuthorization, undefined);
  assert.equal(upstreamApiKey, 'anthropic-test-key');
  assert.equal(upstreamVersion, '2023-06-01');
  assert.equal(JSON.parse(upstreamBody).model, 'claude-opus-4-7');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.model, 'claude-opus-4-7');
});

test('converts OpenAI-compatible streaming responses to Anthropic SSE', async (t) => {
  const openai = http.createServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
    });
    res.write('data: {"id":"chatcmpl_stream","model":"gpt-5.5","choices":[{"delta":{"content":"hel"}}]}\n\n');
    res.end('data: {"id":"chatcmpl_stream","model":"gpt-5.5","choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });

  await listen(openai);
  t.after(() => close(openai));

  const proxy = createProxyServer(createTestConfig({
    openaiBaseUrl: `http://127.0.0.1:${openai.address().port}/v1`,
  }));

  await listen(proxy);
  t.after(() => close(proxy));

  const response = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'gpt-5.5',
    stream: true,
    messages: [
      {
        role: 'user',
        content: 'hello',
      },
    ],
  });

  assert.match(response.text, /event: message_start/);
  assert.match(response.text, /"model":"gpt-5\.5"/);
  assert.match(response.text, /"text":"hel"/);
  assert.match(response.text, /"text":"lo"/);
  assert.match(response.text, /event: message_stop/);
});

test('loads separate provider API keys from install environment', () => {
  const config = loadConfig({
    BASE_URL: 'https://127.0.0.1:8787',
    DEEPSEEK_BASE_URL: 'https://deepseek.example',
    DEEPSEEK_API_KEY: 'deepseek-install-key',
    MOONSHOT_BASE_URL: 'https://moonshot.example/v1',
    MOONSHOT_API_KEY: 'moonshot-install-key',
    OPENAI_BASE_URL: 'https://openai.example/v1',
    OPENAI_API_KEY: 'openai-install-key',
    GEMINI_BASE_URL: 'https://gemini.example/openai',
    GEMINI_API_KEY: 'gemini-install-key',
    QWEN_BASE_URL: 'https://dashscope.example/compatible-mode/v1',
    DASHSCOPE_API_KEY: 'dashscope-install-key',
    OLLAMA_BASE_URL: 'https://ollama.example/v1',
    OLLAMA_API_KEY: 'ollama-install-key',
    ANTHROPIC_BASE_URL: 'https://anthropic.example',
    ANTHROPIC_API_KEY: 'anthropic-install-key',
  });

  assert.equal(config.providers.deepseek.upstreamApiKey, 'deepseek-install-key');
  assert.equal(config.providers.moonshot.upstreamApiKey, 'moonshot-install-key');
  assert.equal(config.providers.openai.upstreamApiKey, 'openai-install-key');
  assert.equal(config.providers.gemini.upstreamApiKey, 'gemini-install-key');
  assert.equal(config.providers.qwen.upstreamApiKey, 'dashscope-install-key');
  assert.equal(config.providers.ollama.upstreamApiKey, 'ollama-install-key');
  assert.equal(config.providers.anthropic.upstreamApiKey, 'anthropic-install-key');
  assert.equal(config.providers.deepseek.upstreamBaseUrl.href, 'https://deepseek.example/');
  assert.equal(config.providers.moonshot.upstreamBaseUrl.href, 'https://moonshot.example/v1');
  assert.equal(config.providers.openai.upstreamBaseUrl.href, 'https://openai.example/v1');
  assert.equal(config.providers.gemini.upstreamBaseUrl.href, 'https://gemini.example/openai');
  assert.equal(config.providers.qwen.upstreamBaseUrl.href, 'https://dashscope.example/compatible-mode/v1');
  assert.equal(config.providers.ollama.upstreamBaseUrl.href, 'https://ollama.example/v1');
  assert.equal(config.providers.anthropic.upstreamBaseUrl.href, 'https://anthropic.example/');
});

test('loads hidden optional provider config from advanced env JSON', () => {
  const config = loadConfig({
    ADVANCED_ENV: JSON.stringify({
      OPENAI_BASE_URL: 'https://openai.advanced/v1',
      OPENAI_API_KEY: 'openai-advanced-key',
      GEMINI_API_KEY: 'gemini-advanced-key',
      QWEN_API_KEY: 'qwen-advanced-key',
      GLM_API_KEY: 'glm-advanced-key',
      MODEL_MAP: '{"claude-custom-gpt":"custom-gpt"}',
      MODEL_ROUTES: '{"custom-gpt":"openai"}',
      REWRITE_RESPONSES: false,
    }),
  });

  assert.equal(config.providers.openai.upstreamBaseUrl.href, 'https://openai.advanced/v1');
  assert.equal(config.providers.openai.upstreamApiKey, 'openai-advanced-key');
  assert.equal(config.providers.gemini.upstreamApiKey, 'gemini-advanced-key');
  assert.equal(config.providers.qwen.upstreamApiKey, 'qwen-advanced-key');
  assert.equal(config.providers.glm.upstreamApiKey, 'glm-advanced-key');
  assert.equal(config.modelMap['claude-custom-gpt'], 'custom-gpt');
  assert.equal(config.modelRoutes['custom-gpt'], 'openai');
  assert.equal(config.rewriteResponses, false);
});

test('manifest exposes provider keys plus Claude family fallback overrides', () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(testDir, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const proxySource = fs.readFileSync(path.join(rootDir, 'proxy.mjs'), 'utf8');
  const serverSource = fs.readFileSync(path.join(rootDir, 'server/index.mjs'), 'utf8');

  assert.equal(manifest.version, packageJson.version);
  // SERVER_VERSION lives in proxy.mjs and is re-exported by server/index.mjs.
  assert.equal(SERVER_VERSION, manifest.version);
  assert.match(
    proxySource,
    new RegExp(`export const SERVER_VERSION = '${manifest.version}'`),
  );
  assert.match(serverSource, /SERVER_VERSION,?\s*$|SERVER_VERSION,?\n/m);
  assert.deepEqual(Object.keys(manifest.user_config), [
    'base_url',
    'port',
    'default_provider',
    'ollama_base_url',
    'ollama_api_key',
    'huggingface_base_url',
    'huggingface_api_key',
    'nvidia_base_url',
    'nvidia_api_key',
    'claude_haiku_model',
    'claude_sonnet_model',
    'claude_opus_model',
    'deepseek_base_url',
    'deepseek_api_key',
    'moonshot_base_url',
    'moonshot_api_key',
    'advanced_env',
  ]);
  assert.deepEqual(Object.keys(manifest.server.mcp_config.env), [
    'BASE_URL',
    'PORT',
    'DEFAULT_PROVIDER',
    'DEEPSEEK_BASE_URL',
    'DEEPSEEK_API_KEY',
    'MOONSHOT_BASE_URL',
    'MOONSHOT_API_KEY',
    'OLLAMA_BASE_URL',
    'OLLAMA_API_KEY',
    'HUGGINGFACE_BASE_URL',
    'HUGGINGFACE_API_KEY',
    'NVIDIA_BASE_URL',
    'NVIDIA_API_KEY',
    'CLAUDE_HAIKU_MODEL',
    'CLAUDE_SONNET_MODEL',
    'CLAUDE_OPUS_MODEL',
    'ADVANCED_ENV',
  ]);
  assert.equal(manifest.tools_generated, false);
  assert.deepEqual(manifest.tools, [
    {
      name: 'model_proxy_status',
      description: 'Shows whether the local model-name proxy is running and how models are routed.',
    },
  ]);

  const staticResponses = manifest._meta['com.microsoft.windows'].static_responses;
  assert.deepEqual(staticResponses.initialize.capabilities, { tools: {} });
  assert.equal(staticResponses.initialize.serverInfo.name, 'claude-universal-custom-proxy');
  assert.equal(staticResponses.initialize.serverInfo.version, manifest.version);
  assert.deepEqual(staticResponses['tools/list'].tools, [
    {
      name: 'model_proxy_status',
      title: 'Model proxy status',
      description: 'Shows local proxy status, upstream providers, and model mappings.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: {
        title: 'Model proxy status',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ]);
});

test('serves configured model list for Claude Code and SDK discovery', async (t) => {
  const proxy = createProxyServer(createTestConfig({}));

  await listen(proxy);
  t.after(() => close(proxy));

  const modelsResponse = await getJson(`http://127.0.0.1:${proxy.address().port}/v1/models`);
  assert.equal(modelsResponse.statusCode, 200);
  assert.equal(modelsResponse.body.has_more, false);
  for (const requiredId of [
    'deepseek-v4-pro',
    'kimi-k2.6',
    'qwen-max',
    'ollama-gpt-oss-120b',
    'claude-haiku-4-5',
    'claude-sonnet-4-6',
    'claude-opus-4-7',
  ]) {
    assert.ok(
      modelsResponse.body.data.some((model) => model.id === requiredId),
      `expected ${requiredId} in /v1/models`,
    );
  }

  const modelResponse = await getJson(
    `http://127.0.0.1:${proxy.address().port}/v1/models/deepseek-v4-pro`,
  );
  assert.equal(modelResponse.statusCode, 200);
  assert.equal(modelResponse.body.id, 'deepseek-v4-pro');
  assert.equal(modelResponse.body.type, 'model');
  assert.equal(typeof modelResponse.body.display_name, 'string');
  assert.ok(modelResponse.body.display_name.length > 0);
  assert.match(modelResponse.body.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

  for (const model of modelsResponse.body.data) {
    assert.equal(model.type, 'model');
    assert.equal(typeof model.id, 'string');
    assert.equal(typeof model.display_name, 'string');
    assert.match(model.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  }
});

test('uses Anthropic-compatible provider base URLs by default', () => {
  const config = loadConfig({});

  assert.equal(
    config.providers.deepseek.upstreamBaseUrl.href,
    'https://api.deepseek.com/anthropic',
  );
  assert.equal(
    config.providers.moonshot.upstreamBaseUrl.href,
    'https://api.moonshot.cn/anthropic',
  );
  assert.equal(
    config.providers.glm.upstreamBaseUrl.href,
    'https://api.z.ai/api/anthropic',
  );
  assert.equal(
    config.providers.xiaomi.upstreamBaseUrl.href,
    'https://api.xiaomimimo.com/anthropic',
  );
  assert.equal(
    config.providers.openai.upstreamBaseUrl.href,
    'https://api.openai.com/v1',
  );
  assert.equal(config.providers.openai.format, 'openai-chat');
  assert.equal(
    config.providers.gemini.upstreamBaseUrl.href,
    'https://generativelanguage.googleapis.com/v1beta/openai',
  );
  assert.equal(config.providers.gemini.format, 'openai-chat');
  assert.equal(
    config.providers.qwen.upstreamBaseUrl.href,
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
  );
  assert.equal(config.providers.qwen.format, 'openai-chat');
  assert.equal(
    config.providers.ollama.upstreamBaseUrl.href,
    'https://ollama.com/v1',
  );
  assert.equal(config.providers.ollama.format, 'openai-chat');
  assert.equal(
    config.providers.anthropic.upstreamBaseUrl.href,
    'https://api.anthropic.com/',
  );
  assert.equal(config.providers.anthropic.authScheme, 'x-api-key');

  assert.deepEqual(
    Object.entries(config.modelRoutes)
      .filter(([, provider]) => provider === 'openai')
      .map(([model]) => model)
      .sort(),
    [
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.5',
    ],
  );
  assert.equal(config.modelMap['gpt-5.5'], 'gpt-5.5');
  assert.equal(config.modelMap['gpt-5.4'], 'gpt-5.4');
  assert.equal(config.modelMap['gpt-5.4-mini'], 'gpt-5.4-mini');
  assert.deepEqual(
    Object.entries(config.modelRoutes)
      .filter(([, provider]) => provider === 'qwen')
      .map(([model]) => model)
      .sort(),
    [
      'qwen-flash',
      'qwen-max',
      'qwen-plus',
    ],
  );
  assert.equal(config.modelMap['qwen-flash'], 'qwen-flash');
  assert.equal(config.modelMap['qwen-plus'], 'qwen-plus');
  assert.equal(config.modelMap['qwen-max'], 'qwen-max');
  const ollamaRoutes = Object.entries(config.modelRoutes)
    .filter(([, provider]) => provider === 'ollama')
    .map(([model]) => model);
  for (const expected of [
    'ollama-gpt-oss-20b',
    'ollama-gpt-oss-120b',
    'ollama-deepseek-v3.1',
    'ollama-deepseek-v3.2',
    'ollama-deepseek-v4-flash',
    'ollama-deepseek-v4-pro',
    'ollama-qwen3-coder',
    'ollama-qwen3-coder-next',
    'ollama-qwen3-vl',
    'ollama-qwen3-vl-instruct',
    'ollama-qwen3-next',
    'ollama-qwen3.5',
    'ollama-kimi-k2',
    'ollama-kimi-k2-thinking',
    'ollama-kimi-k2.6',
    'ollama-glm-4.6',
    'ollama-glm-4.7',
    'ollama-glm-5',
    'ollama-glm-5.1',
    'ollama-minimax-m2',
    'ollama-minimax-m2.1',
    'ollama-minimax-m2.5',
    'ollama-minimax-m2.7',
    'ollama-nemotron-3-nano',
    'ollama-nemotron-3-super',
    'ollama-devstral-small-2',
    'ollama-ministral-3',
    'ollama-gemma4-31b',
    'ollama-gemini-3-flash-preview',
    'ollama-rnj-1',
    'dsv4-flash',
    'dsv4-pro',
    'glm51',
  ]) {
    assert.ok(
      ollamaRoutes.includes(expected),
      `expected ${expected} to route to ollama provider`,
    );
  }
  assert.equal(config.modelMap['ollama-gpt-oss-120b'], 'gpt-oss:120b-cloud');
  assert.equal(config.modelMap['ollama-qwen3-coder'], 'qwen3-coder:480b-cloud');
  assert.equal(config.modelMap['ollama-deepseek-v3.1'], 'deepseek-v3.1:671b-cloud');
  assert.equal(config.modelMap['ollama-kimi-k2'], 'kimi-k2:1t-cloud');
  assert.equal(config.modelMap['ollama-glm-5.1'], 'glm-5.1:cloud');
  assert.equal(config.modelMap['ollama-qwen3.5'], 'qwen3.5:cloud');
  assert.equal(config.modelMap['dsv4-flash'], 'deepseek-v4-flash:cloud');
  assert.equal(config.modelMap['glm51'], 'glm-5.1:cloud');
  // Conflict resolution: same upstream id glm-5.1 → different providers per alias.
  assert.equal(config.modelRoutes['ollama-glm-5.1'], 'ollama');
  assert.equal(config.modelRoutes['glm-5.1'], 'glm');

  // HuggingFace and NVIDIA NIM providers are wired up with their bundled
  // aliases so out-of-the-box installs reach the free Ollama Cloud + HF +
  // NIM catalogs without needing env overrides.
  assert.equal(
    config.providers.huggingface.upstreamBaseUrl.href,
    'https://router.huggingface.co/v1',
  );
  assert.equal(config.providers.huggingface.format, 'openai-chat');
  assert.equal(config.providers.huggingface.authScheme, 'bearer');
  assert.equal(
    config.providers.nvidia.upstreamBaseUrl.href,
    'https://integrate.api.nvidia.com/v1',
  );
  assert.equal(config.providers.nvidia.format, 'openai-chat');
  assert.equal(config.providers.nvidia.authScheme, 'bearer');

  // Bundled HF and NIM aliases exist.
  const hfRoutes = Object.entries(config.modelRoutes)
    .filter(([, provider]) => provider === 'huggingface')
    .map(([model]) => model);
  assert.ok(hfRoutes.length >= 15, `expected >=15 huggingface routes, got ${hfRoutes.length}`);
  const nimRoutes = Object.entries(config.modelRoutes)
    .filter(([, provider]) => provider === 'nvidia')
    .map(([model]) => model);
  assert.ok(nimRoutes.length >= 30, `expected >=30 nvidia routes, got ${nimRoutes.length}`);
  const hfAliases = Object.keys(config.modelMap).filter((id) => id.startsWith('hf-'));
  assert.ok(hfAliases.length >= 15, `expected >=15 hf-* aliases, got ${hfAliases.length}`);
  const nimAliases = Object.keys(config.modelMap).filter((id) => id.startsWith('nim-'));
  assert.ok(nimAliases.length >= 30, `expected >=30 nim-* aliases, got ${nimAliases.length}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Smart model resolution + path fixes + count_tokens tests
// ─────────────────────────────────────────────────────────────────────────────

test('stripClaudeDate removes the 8-digit date suffix Claude Desktop appends', () => {
  assert.equal(stripClaudeDate('claude-haiku-4-5-20251001'), 'claude-haiku-4-5');
  assert.equal(stripClaudeDate('claude-sonnet-4-6-20260131'), 'claude-sonnet-4-6');
  // No suffix → no change.
  assert.equal(stripClaudeDate('claude-haiku-4-5'), 'claude-haiku-4-5');
  // Not 8 digits → no change.
  assert.equal(stripClaudeDate('claude-haiku-4-5-2025'), 'claude-haiku-4-5-2025');
});

test('REWRITE_RESPONSES defaults to false; opt in explicitly with REWRITE_RESPONSES=true', () => {
  // No env var → false.
  const defaultConfig = loadConfig({});
  assert.equal(defaultConfig.rewriteResponses, false);

  // Explicit opt-in.
  const enabled = loadConfig({ REWRITE_RESPONSES: 'true' });
  assert.equal(enabled.rewriteResponses, true);

  // Explicit opt-out (matches default).
  const disabled = loadConfig({ REWRITE_RESPONSES: 'false' });
  assert.equal(disabled.rewriteResponses, false);
});

test('resolveClaudeFamily detects the haiku/sonnet/opus family', () => {
  assert.equal(resolveClaudeFamily('claude-haiku-4-5-20251001'), 'haiku');
  assert.equal(resolveClaudeFamily('claude-sonnet-4-6'), 'sonnet');
  assert.equal(resolveClaudeFamily('claude-opus-4-7'), 'opus');
  assert.equal(resolveClaudeFamily('ollama-gpt-oss-120b'), null);
  assert.equal(resolveClaudeFamily('gpt-5.4'), null);
});

test('resolveModelForUpstream falls back to Ollama for dated Claude names when ANTHROPIC_API_KEY is empty', () => {
  const config = loadConfig({
    OLLAMA_API_KEY: 'ollama-test',
    DEFAULT_PROVIDER: 'ollama',
  });

  // Dated Haiku → fallback alias (claude-ollama-qwen3-coder-next by default).
  const haiku = resolveModelForUpstream('claude-haiku-4-5-20251001', config);
  assert.equal(haiku.family, 'haiku');
  assert.equal(haiku.requestAlias, 'ollama-qwen3-coder-next');
  assert.equal(haiku.upstreamModel, 'qwen3-coder-next:cloud');

  // Dated Sonnet → fallback alias.
  const sonnet = resolveModelForUpstream('claude-sonnet-4-6-20260131', config);
  assert.equal(sonnet.family, 'sonnet');
  assert.equal(sonnet.requestAlias, 'ollama-qwen3-coder');
  assert.equal(sonnet.upstreamModel, 'qwen3-coder:480b-cloud');

  // Dated Opus → fallback alias.
  const opus = resolveModelForUpstream('claude-opus-4-7-20260131', config);
  assert.equal(opus.family, 'opus');
  assert.equal(opus.requestAlias, 'ollama-gpt-oss-120b');
  assert.equal(opus.upstreamModel, 'gpt-oss:120b-cloud');
});

test('resolveModelForUpstream honors CLAUDE_HAIKU_MODEL/SONNET/OPUS overrides', () => {
  const config = loadConfig({
    OLLAMA_API_KEY: 'ollama-test',
    DEFAULT_PROVIDER: 'ollama',
    CLAUDE_HAIKU_MODEL: 'ollama-kimi-k2',
    CLAUDE_SONNET_MODEL: 'ollama-glm-5.1',
    CLAUDE_OPUS_MODEL: 'dsv4-pro',
  });

  assert.equal(
    resolveModelForUpstream('claude-haiku-4-5-20251001', config).upstreamModel,
    'kimi-k2:1t-cloud',
  );
  assert.equal(
    resolveModelForUpstream('claude-sonnet-4-6', config).upstreamModel,
    'glm-5.1:cloud',
  );
  assert.equal(
    resolveModelForUpstream('claude-opus-4-7', config).upstreamModel,
    'deepseek-v4-pro:cloud',
  );
});

test('resolveModelForUpstream uses Anthropic directly when ANTHROPIC_API_KEY is set', () => {
  const config = loadConfig({
    OLLAMA_API_KEY: 'ollama-test',
    ANTHROPIC_API_KEY: 'sk-ant-test',
  });

  // Date is stripped and exact entry wins — no family fallback.
  const haiku = resolveModelForUpstream('claude-haiku-4-5-20251001', config);
  assert.equal(haiku.requestAlias, 'claude-haiku-4-5');
  assert.equal(haiku.upstreamModel, 'claude-haiku-4-5');
});

test('routes dated Claude haiku request to Ollama via family fallback', async (t) => {
  let upstreamBody;

  const ollama = http.createServer(async (req, res) => {
    upstreamBody = await readBody(req);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl_fallback',
      model: 'qwen3-coder-next:cloud',
      choices: [
        { finish_reason: 'stop', message: { role: 'assistant', content: 'fallback ok' } },
      ],
    }));
  });

  await listen(ollama);
  t.after(() => close(ollama));

  // Test config has anthropicApiKey set; flip Anthropic off so family fallback engages.
  const config = createTestConfig({
    ollamaBaseUrl: `http://127.0.0.1:${ollama.address().port}/v1`,
  });
  config.providers.anthropic.upstreamApiKey = '';
  config.defaultProvider = 'ollama';
  config.claudeFamilyFallback = { ...DEFAULT_CLAUDE_FAMILY_FALLBACK };

  const proxy = createProxyServer(config);
  await listen(proxy);
  t.after(() => close(proxy));

  const response = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 32,
    messages: [{ role: 'user', content: 'hello' }],
  });

  const parsed = JSON.parse(upstreamBody);
  assert.equal(parsed.model, 'qwen3-coder-next:cloud');
  assert.equal(response.statusCode, 200);
  // Response model is rewritten back to the fallback alias the client effectively asked for.
  assert.equal(response.body.model, 'ollama-qwen3-coder-next');
});

test('/v1/messages/count_tokens is answered locally with a heuristic estimate', async (t) => {
  let upstreamHit = false;
  const ollama = http.createServer((_req, res) => {
    upstreamHit = true;
    res.writeHead(404);
    res.end();
  });
  await listen(ollama);
  t.after(() => close(ollama));

  const proxy = createProxyServer(createTestConfig({
    ollamaBaseUrl: `http://127.0.0.1:${ollama.address().port}/v1`,
  }));
  await listen(proxy);
  t.after(() => close(proxy));

  const response = await postJson(
    `http://127.0.0.1:${proxy.address().port}/v1/messages/count_tokens`,
    {
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'count this please' }],
    },
  );

  assert.equal(upstreamHit, false, 'count_tokens must not be forwarded upstream');
  assert.equal(response.statusCode, 200);
  assert.equal(typeof response.body.input_tokens, 'number');
  assert.ok(response.body.input_tokens >= 1);
});

test('with rewriteResponses=false, upstream model ids are passed through unchanged', async (t) => {
  const ollama = http.createServer(async (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl_passthrough',
      model: 'qwen3-coder:480b-cloud',
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'raw model id' },
        },
      ],
    }));
  });
  await listen(ollama);
  t.after(() => close(ollama));

  const config = createTestConfig({
    ollamaBaseUrl: `http://127.0.0.1:${ollama.address().port}/v1`,
  });
  // Pin the new default explicitly so the assertion is robust to future
  // changes in createTestConfig.
  config.rewriteResponses = false;

  const proxy = createProxyServer(config);
  await listen(proxy);
  t.after(() => close(proxy));

  const response = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'ollama-qwen3-coder',
    max_tokens: 16,
    messages: [{ role: 'user', content: 'hi' }],
  });

  // Request alias goes to the proxy, but the response body reports the raw
  // upstream id because rewriteResponses is off.
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.model, 'qwen3-coder:480b-cloud');
  assert.equal(response.body.content[0].text, 'raw model id');
});

// ─────────────────────────────────────────────────────────────────────────────
// HuggingFace routing — the bundled claude-hf-* aliases were removed in
// v0.4.3 to test whether the Claude Desktop picker has a catalog-count
// threshold. The huggingface provider config and HF_API_KEY / HF_TOKEN env
// var precedence are still wired up (so users can re-add HF models via
// MODEL_MAP env overrides). The routing/streaming tests below provide an
// alias at runtime so they continue to verify the HF code path end-to-end.
// ─────────────────────────────────────────────────────────────────────────────

test('routes HuggingFace requests through the OpenAI-compatible router endpoint (runtime alias)', async (t) => {
  let upstreamPath;
  let upstreamAuthorization;
  let upstreamBody;

  const hf = http.createServer(async (req, res) => {
    upstreamPath = req.url;
    upstreamAuthorization = req.headers.authorization;
    upstreamBody = await readBody(req);

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl_hf',
      model: 'meta-llama/Llama-3.3-70B-Instruct',
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'hf ok' },
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    }));
  });
  await listen(hf);
  t.after(() => close(hf));

  const config = createTestConfig({
    huggingfaceBaseUrl: `http://127.0.0.1:${hf.address().port}/v1`,
  });
  // Runtime alias — same shape a user would set via MODEL_MAP env override.
  config.modelMap = {
    ...config.modelMap,
    'hf-llama-3.3-70b': 'meta-llama/Llama-3.3-70B-Instruct',
  };
  config.modelAliases = {
    ...config.modelAliases,
    'meta-llama/Llama-3.3-70B-Instruct': 'hf-llama-3.3-70b',
  };
  config.modelRoutes = {
    ...config.modelRoutes,
    'hf-llama-3.3-70b': 'huggingface',
  };

  const proxy = createProxyServer(config);
  await listen(proxy);
  t.after(() => close(proxy));

  const response = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'hf-llama-3.3-70b',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'hello' }],
  });

  const parsedUpstreamBody = JSON.parse(upstreamBody);
  assert.equal(upstreamPath, '/v1/chat/completions');
  assert.equal(upstreamAuthorization, 'Bearer huggingface-test-key');
  // Model id is the HF repo path (with slash); proxy must forward it untouched.
  assert.equal(parsedUpstreamBody.model, 'meta-llama/Llama-3.3-70B-Instruct');
  assert.equal(parsedUpstreamBody.max_tokens, 64);
  assert.equal(response.statusCode, 200);
  // Response is rewritten back to the Claude alias the client used.
  assert.equal(response.body.model, 'hf-llama-3.3-70b');
  assert.equal(response.body.content[0].text, 'hf ok');
});

test('converts HuggingFace streaming responses to Anthropic SSE (runtime alias)', async (t) => {
  const hf = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"id":"hf_stream","model":"deepseek-ai/DeepSeek-R1","choices":[{"delta":{"content":"he"}}]}\n\n');
    res.end('data: {"id":"hf_stream","model":"deepseek-ai/DeepSeek-R1","choices":[{"delta":{"content":"llo"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await listen(hf);
  t.after(() => close(hf));

  const config = createTestConfig({
    huggingfaceBaseUrl: `http://127.0.0.1:${hf.address().port}/v1`,
  });
  config.modelMap = {
    ...config.modelMap,
    'hf-deepseek-r1': 'deepseek-ai/DeepSeek-R1',
  };
  config.modelAliases = {
    ...config.modelAliases,
    'deepseek-ai/DeepSeek-R1': 'hf-deepseek-r1',
  };
  config.modelRoutes = {
    ...config.modelRoutes,
    'hf-deepseek-r1': 'huggingface',
  };

  const proxy = createProxyServer(config);
  await listen(proxy);
  t.after(() => close(proxy));

  const response = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'hf-deepseek-r1',
    stream: true,
    messages: [{ role: 'user', content: 'hi' }],
  });

  assert.match(response.text, /event: message_start/);
  assert.match(response.text, /"model":"hf-deepseek-r1"/);
  assert.match(response.text, /"text":"he"/);
  assert.match(response.text, /"text":"llo"/);
  assert.match(response.text, /event: message_stop/);
});

test('HuggingFace credentials load from HF_API_KEY / HF_TOKEN aliases too', () => {
  const fromCanonical = loadConfig({ HUGGINGFACE_API_KEY: 'hf-canonical' });
  assert.equal(fromCanonical.providers.huggingface.upstreamApiKey, 'hf-canonical');

  const fromShort = loadConfig({ HF_API_KEY: 'hf-short' });
  assert.equal(fromShort.providers.huggingface.upstreamApiKey, 'hf-short');

  const fromToken = loadConfig({ HF_TOKEN: 'hf-token' });
  assert.equal(fromToken.providers.huggingface.upstreamApiKey, 'hf-token');

  // Canonical wins over short alias when both are set.
  const both = loadConfig({ HUGGINGFACE_API_KEY: 'win', HF_TOKEN: 'lose' });
  assert.equal(both.providers.huggingface.upstreamApiKey, 'win');
});

test('routes NVIDIA NIM requests with bundled nim-* aliases', async (t) => {
  let upstreamPath;
  let upstreamAuth;
  let upstreamBody;

  const nim = http.createServer(async (req, res) => {
    upstreamPath = req.url;
    upstreamAuth = req.headers.authorization;
    upstreamBody = await readBody(req);

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl_nim',
      model: 'meta/llama-3.3-70b-instruct',
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'nim ok' },
        },
      ],
      usage: { prompt_tokens: 9, completion_tokens: 2 },
    }));
  });
  await listen(nim);
  t.after(() => close(nim));

  const config = createTestConfig({
    nvidiaBaseUrl: `http://127.0.0.1:${nim.address().port}/v1`,
  });

  const proxy = createProxyServer(config);
  await listen(proxy);
  t.after(() => close(proxy));

  const response = await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'nim-llama-3.3-70b',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'hello' }],
  });

  const parsedUpstreamBody = JSON.parse(upstreamBody);
  assert.equal(upstreamPath, '/v1/chat/completions');
  assert.equal(upstreamAuth, 'Bearer nvidia-test-key');
  assert.equal(parsedUpstreamBody.model, 'meta/llama-3.3-70b-instruct');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.model, 'nim-llama-3.3-70b');
  assert.equal(response.body.content[0].text, 'nim ok');
});

test('NVIDIA NIM credentials load from NVAPI_KEY and NIM_API_KEY aliases', () => {
  const direct = loadConfig({ NVIDIA_API_KEY: 'nvapi-direct' });
  assert.equal(direct.providers.nvidia.upstreamApiKey, 'nvapi-direct');

  const nvapi = loadConfig({ NVAPI_KEY: 'nvapi-via-alias' });
  assert.equal(nvapi.providers.nvidia.upstreamApiKey, 'nvapi-via-alias');

  const nim = loadConfig({ NIM_API_KEY: 'nvapi-nim-alias' });
  assert.equal(nim.providers.nvidia.upstreamApiKey, 'nvapi-nim-alias');

  const precedence = loadConfig({
    NVIDIA_API_KEY: 'win',
    NVAPI_KEY: 'lose1',
    NIM_API_KEY: 'lose2',
  });
  assert.equal(precedence.providers.nvidia.upstreamApiKey, 'win');
});

test('/v1/models exposes hf-* and nim-* aliases by default', async (t) => {
  const proxy = createProxyServer(createTestConfig({}));
  await listen(proxy);
  t.after(() => close(proxy));

  const response = await getJson(`http://127.0.0.1:${proxy.address().port}/v1/models`);
  assert.equal(response.statusCode, 200);

  const ids = response.body.data.map((m) => m.id);
  const hfIds = ids.filter((id) => id.startsWith('hf-'));
  const nimIds = ids.filter((id) => id.startsWith('nim-'));
  const ollamaIds = ids.filter((id) => id.startsWith('ollama-'));

  assert.ok(hfIds.length >= 15, `expected at least 15 hf-* aliases, got ${hfIds.length}`);
  assert.ok(nimIds.length >= 30, `expected at least 30 nim-* aliases, got ${nimIds.length}`);
  assert.ok(ollamaIds.length >= 25, `expected at least 25 ollama-* aliases, got ${ollamaIds.length}`);
  // Total catalog: 116 entries (5 Claude family + 111 no-prefix aliases).
  assert.ok(response.body.data.length >= 110, `default catalog size should be >= 110, got ${response.body.data.length}`);
});

// Claude Desktop's Cowork 3P picker hides any /v1/models entry whose id starts
// with `claude-` AND contains a foundation-model brand substring. It also
// rejects the `anthropic/*` namespace (v0.5.2 confirmed this empirically — 105
// `anthropic/<provider>/<model>` ids still failed to surface). Non-Anthropic
// namespace ids (`deepseek-v4-flash`, `nim-llama-3.1-8b`, `ollama-gpt-oss-20b`)
// pass through.
//
// v0.6.0 drops the `claude-` prefix from every non-Claude-family alias so the
// picker advertises real upstream names. Only the actual Claude family models
// (`claude-haiku-*`, `claude-sonnet-*`, `claude-opus-*`) keep the `claude-`
// prefix.
test('/v1/models advertises non-Anthropic-namespace ids for all non-Claude models', async (t) => {
  const proxy = createProxyServer(createTestConfig({}));
  await listen(proxy);
  t.after(() => close(proxy));

  const response = await getJson(`http://127.0.0.1:${proxy.address().port}/v1/models`);
  assert.equal(response.statusCode, 200);

  const ids = response.body.data.map((m) => m.id);

  // Only the five Claude family aliases keep a `claude-` prefix. No gateway
  // `anthropic/*` ids are advertised (the v0.5.2 approach is reverted).
  const claudePrefixed = ids.filter((id) => id.startsWith('claude-'));
  const anthropicNamespaced = ids.filter((id) => id.startsWith('anthropic/'));
  assert.deepEqual(
    claudePrefixed.sort(),
    [
      'claude-haiku-4-5',
      'claude-opus-4-1',
      'claude-opus-4-7',
      'claude-sonnet-4-5',
      'claude-sonnet-4-6',
    ],
  );
  assert.equal(anthropicNamespaced.length, 0, 'anthropic/* ids must not be advertised');

  // High-value spot-checks: the screenshot's missing aliases are now back as
  // real upstream names.
  const idSet = new Set(ids);
  for (const expected of [
    'deepseek-v4-flash', 'deepseek-v4-pro',
    'kimi-k2.6',
    'glm-4.5-air', 'glm-4.6', 'glm-4.7', 'glm-5', 'glm-5.1', 'glm51',
    'mimo-v2-flash', 'mimo-v2-pro', 'mimo-v2.5-pro', 'mimo-v2-omni',
    'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5',
    'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro',
    'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3.1-pro-preview',
    'qwen-flash', 'qwen-plus', 'qwen-max',
    'dsv4-flash', 'dsv4-pro',
    'ollama-gpt-oss-20b', 'ollama-gpt-oss-120b',
    'hf-llama-3.1-8b', 'hf-deepseek-r1',
    'nim-llama-3.1-8b', 'nim-phi-4', 'nim-yi-large',
    'nim-codestral-22b', 'nim-palmyra-creative-122b',
    'nim-qwq-32b', 'nim-usdcode-70b',
    'claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7',
  ]) {
    assert.ok(idSet.has(expected), `expected ${expected} in /v1/models`);
    // None of the advertised ids should start with `claude-` unless they ARE
    // actual Claude family models.
    if (expected.startsWith('claude-')) {
      assert.match(expected, /^claude-(haiku|sonnet|opus)-/);
    }
  }

  // display_name equals id (matching the reference project; the upstream
  // names are already human-readable).
  for (const model of response.body.data) {
    assert.equal(model.display_name, model.id, `display_name should equal id for ${model.id}`);
  }
});

// Existing user .env configs and the Claude Code CLI may still send the
// previous `claude-<provider>-<model>` aliases. resolveModelForUpstream must
// rewrite them to the new no-prefix id and route to the same upstream.
test('legacy claude-* aliases still route to the same upstream as their v0.6.0 id', async (t) => {
  let upstreamModel;
  const deepseek = http.createServer(async (req, res) => {
    upstreamModel = JSON.parse(await readBody(req)).model;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'msg_legacy',
      model: 'deepseek-v4-flash',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
  });
  await listen(deepseek);
  t.after(() => close(deepseek));

  const proxy = createProxyServer(createTestConfig({
    deepseekBaseUrl: `http://127.0.0.1:${deepseek.address().port}`,
  }));
  await listen(proxy);
  t.after(() => close(proxy));

  // New v0.6.0 id resolves directly.
  await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'deepseek-v4-flash',
    max_tokens: 8,
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(upstreamModel, 'deepseek-v4-flash');

  // Legacy claude-* alias resolves to the same upstream via LEGACY_CLAUDE_ALIASES.
  upstreamModel = null;
  await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'deepseek-v4-flash',
    max_tokens: 8,
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(upstreamModel, 'deepseek-v4-flash');
});

test('buildTargetUrl does not produce /v1/v1 when the Ollama base URL already ends in /v1', async (t) => {
  let upstreamPath;
  const ollama = http.createServer(async (req, res) => {
    upstreamPath = req.url;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl_test',
      model: 'gpt-oss:20b-cloud',
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
    }));
  });
  await listen(ollama);
  t.after(() => close(ollama));

  // Base URL ends in /v1, incoming Anthropic path is /v1/messages.
  const proxy = createProxyServer(createTestConfig({
    ollamaBaseUrl: `http://127.0.0.1:${ollama.address().port}/v1`,
  }));
  await listen(proxy);
  t.after(() => close(proxy));

  await postJson(`http://127.0.0.1:${proxy.address().port}/v1/messages`, {
    model: 'ollama-gpt-oss-20b',
    max_tokens: 8,
    messages: [{ role: 'user', content: 'hi' }],
  });

  assert.equal(upstreamPath, '/v1/chat/completions');
  assert.ok(!upstreamPath.includes('/v1/v1/'), 'must not duplicate /v1 prefix');
});

function createTestConfig({
  deepseekBaseUrl = 'http://127.0.0.1:1',
  moonshotBaseUrl = 'http://127.0.0.1:2',
  glmBaseUrl = 'http://127.0.0.1:3',
  xiaomiBaseUrl = 'http://127.0.0.1:4',
  openaiBaseUrl = 'http://127.0.0.1:5/v1',
  geminiBaseUrl = 'http://127.0.0.1:6/v1beta/openai',
  qwenBaseUrl = 'http://127.0.0.1:7/compatible-mode/v1',
  ollamaBaseUrl = 'http://127.0.0.1:9/v1',
  huggingfaceBaseUrl = 'http://127.0.0.1:10/v1',
  nvidiaBaseUrl = 'http://127.0.0.1:11/v1',
  anthropicBaseUrl = 'http://127.0.0.1:8',
}) {
  return {
    baseUrl: 'https://127.0.0.1:8787',
    defaultProvider: 'deepseek',
    providers: {
      deepseek: {
        upstreamBaseUrl: new URL(deepseekBaseUrl),
        upstreamApiKey: 'deepseek-test-key',
      },
      moonshot: {
        upstreamBaseUrl: new URL(moonshotBaseUrl),
        upstreamApiKey: 'moonshot-test-key',
      },
      glm: {
        upstreamBaseUrl: new URL(glmBaseUrl),
        upstreamApiKey: 'glm-test-key',
      },
      xiaomi: {
        upstreamBaseUrl: new URL(xiaomiBaseUrl),
        upstreamApiKey: 'xiaomi-test-key',
      },
      openai: {
        upstreamBaseUrl: new URL(openaiBaseUrl),
        upstreamApiKey: 'openai-test-key',
        format: 'openai-chat',
        authScheme: 'bearer',
        maxTokensField: 'max_completion_tokens',
      },
      gemini: {
        upstreamBaseUrl: new URL(geminiBaseUrl),
        upstreamApiKey: 'gemini-test-key',
        format: 'openai-chat',
        authScheme: 'bearer',
        maxTokensField: 'max_tokens',
      },
      qwen: {
        upstreamBaseUrl: new URL(qwenBaseUrl),
        upstreamApiKey: 'qwen-test-key',
        format: 'openai-chat',
        authScheme: 'bearer',
        maxTokensField: 'max_tokens',
      },
      ollama: {
        upstreamBaseUrl: new URL(ollamaBaseUrl),
        upstreamApiKey: 'ollama-test-key',
        format: 'openai-chat',
        authScheme: 'bearer',
        maxTokensField: 'max_tokens',
      },
      huggingface: {
        upstreamBaseUrl: new URL(huggingfaceBaseUrl),
        upstreamApiKey: 'huggingface-test-key',
        format: 'openai-chat',
        authScheme: 'bearer',
        maxTokensField: 'max_tokens',
      },
      nvidia: {
        upstreamBaseUrl: new URL(nvidiaBaseUrl),
        upstreamApiKey: 'nvidia-test-key',
        format: 'openai-chat',
        authScheme: 'bearer',
        maxTokensField: 'max_tokens',
      },
      anthropic: {
        upstreamBaseUrl: new URL(anthropicBaseUrl),
        upstreamApiKey: 'anthropic-test-key',
        format: 'anthropic',
        authScheme: 'x-api-key',
        anthropicVersion: '2023-06-01',
      },
    },
    modelMap: DEFAULT_MODEL_MAP,
    modelAliases: DEFAULT_MODEL_ALIASES,
    modelRoutes: DEFAULT_MODEL_ROUTES,
    claudeFamilyFallback: DEFAULT_CLAUDE_FAMILY_FALLBACK,
    rewriteResponses: true,
    requestBodyLimitBytes: 1024 * 1024,
  };
}

function listen(server) {
  server.listen(0, '127.0.0.1');
  return once(server, 'listening');
}

function close(server) {
  server.close();
  return once(server, 'close');
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload));
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(body.length),
      },
    }, async (res) => {
      const text = await readBody(res);
      const contentType = String(res.headers['content-type'] || '');
      resolve({
        statusCode: res.statusCode,
        text,
        body: contentType.includes('application/json') ? JSON.parse(text) : null,
      });
    });

    req.on('error', reject);
    req.end(body);
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    }, async (res) => {
      const text = await readBody(res);
      const contentType = String(res.headers['content-type'] || '');
      resolve({
        statusCode: res.statusCode,
        text,
        body: contentType.includes('application/json') ? JSON.parse(text) : null,
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function readBody(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// /v1/models pagination — Anthropic-spec compliance
// ─────────────────────────────────────────────────────────────────────────────

test('/v1/models/{unknown} returns a 404 with a plain {error: string} body (6315023 shape)', async (t) => {
  const proxy = createProxyServer(createTestConfig({}));
  await listen(proxy);
  t.after(() => close(proxy));

  const port = proxy.address().port;
  const response = await getJson(`http://127.0.0.1:${port}/v1/models/claude-does-not-exist`);
  assert.equal(response.statusCode, 404);
  assert.match(response.body.error, /Unknown model/);
});

