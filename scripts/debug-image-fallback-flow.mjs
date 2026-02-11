#!/usr/bin/env node

const args = process.argv.slice(2);
const getArg = (name, fallback = '') => {
  const idx = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx < 0) return fallback;
  const v = args[idx];
  if (v.includes('=')) return v.split('=').slice(1).join('=');
  return args[idx + 1] && !args[idx + 1].startsWith('--') ? args[idx + 1] : '1';
};

const baseUrl = String(getArg('base', 'http://127.0.0.1:3000')).replace(/\/$/, '');
const user = String(getArg('user', 'debug-image-fallback'));
const timeoutMs = Math.max(8_000, Number(getArg('timeoutMs', '45000')) || 45_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...items) => console.log('[debug-image-fallback]', ...items);
const fail = (msg) => {
  console.error(`\n[debug-image-fallback] FAIL: ${msg}`);
  process.exit(1);
};

async function requestJson(path, init = {}) {
  const url = /^https?:\/\//i.test(path) ? path : `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    'content-type': 'application/json',
    'x-vision-user-id': user,
    ...(init.headers || {}),
  };
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { url, res, text, json };
}

async function waitTask(statusUrl) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    const out = await requestJson(statusUrl, { method: 'GET' });
    if (!out.res.ok) fail(`status fetch failed: ${out.res.status} ${out.url}`);
    const task = out.json?.task;
    if (!task) fail(`status payload missing task: ${String(out.text).slice(0, 160)}`);
    const status = String(task.status || '').toLowerCase();
    if (status !== last) {
      last = status;
      log(`task ${task.id} -> ${status} (waitMs=${task.waitMs ?? 'n/a'}, durationMs=${task.durationMs ?? 'n/a'})`);
    }
    if (status === 'success' || status === 'failed') return task;
    await sleep(300);
  }
  fail(`task timeout after ${timeoutMs}ms`);
}

async function submit(debugMock, label) {
  const body = {
    prompt: `debug image fallback ${label}`,
    async: true,
    settings: {
      provider: 'gemini',
      model: 'mock-sim-image',
      temperature: 0.4,
      maxOutputTokens: 1024,
    },
    debugMock: {
      enableDualChannel: true,
      ...(debugMock || {}),
    },
  };
  const out = await requestJson('/api/asset/image/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (out.res.status !== 202 || !out.json?.accepted || !out.json?.statusUrl) {
    fail(`submit failed (${out.res.status}) ${String(out.text).slice(0, 220)}`);
  }
  return out.json;
}

async function scenarioPrimaryFailFallbackSuccess() {
  log('scenario: primary fail -> fallback success');
  const submitted = await submit({ forceFailTransports: ['gemini-direct'] }, 'primary-fail-fallback-success');
  const task = await waitTask(submitted.statusUrl);
  if (String(task.status || '').toLowerCase() !== 'success') {
    fail(`expected success, got ${task.status}`);
  }
  const attempted = Array.isArray(task?.result?.debug?.attemptedTransports) ? task.result.debug.attemptedTransports : [];
  if (!attempted.includes('gemini-direct') || !attempted.includes('compass-gateway')) {
    fail(`missing attempted transport trace: ${JSON.stringify(attempted)}`);
  }
  const gateway = String(task?.result?.debug?.gateway || '');
  if (gateway !== 'compass-gateway') {
    fail(`expected fallback gateway compass-gateway, got ${gateway || '(empty)'}`);
  }
  log('scenario passed: fallback success is tracked');
}

async function scenarioAllFail() {
  log('scenario: all transports fail');
  const submitted = await submit({ forceAllTransportsFail: true }, 'all-fail');
  const task = await waitTask(submitted.statusUrl);
  if (String(task.status || '').toLowerCase() !== 'failed') {
    fail(`expected failed, got ${task.status}`);
  }
  const errorText = String(task?.error || '');
  if (!/across transports|Forced failure/i.test(errorText)) {
    fail(`unexpected task error text: ${errorText}`);
  }
  log('scenario passed: failed task stays failed with error');
}

async function scenarioBaselineSingle() {
  log('scenario: single-channel baseline success');
  const submitted = await submit({ enableDualChannel: false }, 'single-channel-success');
  const task = await waitTask(submitted.statusUrl);
  if (String(task.status || '').toLowerCase() !== 'success') {
    fail(`expected success, got ${task.status}`);
  }
  const attempted = Array.isArray(task?.result?.debug?.attemptedTransports) ? task.result.debug.attemptedTransports : [];
  if (attempted.length !== 1) {
    fail(`expected single transport attempt, got ${JSON.stringify(attempted)}`);
  }
  log('scenario passed: single-channel baseline');
}

(async () => {
  log(`base=${baseUrl} user=${user} timeoutMs=${timeoutMs}`);
  await scenarioPrimaryFailFallbackSuccess();
  await scenarioAllFail();
  await scenarioBaselineSingle();
  log('ALL SCENARIOS PASSED');
})().catch((e) => fail(e instanceof Error ? `${e.message}\n${e.stack || ''}` : String(e)));

