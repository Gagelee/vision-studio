#!/usr/bin/env node

const args = process.argv.slice(2);
const getArg = (name, fallback = '') => {
  const idx = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx < 0) return fallback;
  const v = args[idx];
  if (v.includes('=')) return v.split('=').slice(1).join('=');
  return args[idx + 1] && !args[idx + 1].startsWith('--') ? args[idx + 1] : '1';
};
const hasArg = (name) => args.includes(`--${name}`);

const baseUrl = String(getArg('base', 'http://127.0.0.1:3000')).replace(/\/$/, '');
const timeoutMs = Math.max(5_000, Number(getArg('timeoutMs', '45000')) || 45_000);
const includeScaffold = hasArg('include-scaffold');
const taskBurst = Math.max(2, Number(getArg('taskBurst', '4')) || 4);
const userHeader = String(getArg('user', 'debug-iteration'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const log = (...items) => console.log(`[debug-iteration]`, ...items);
const fail = (msg) => {
  console.error(`\n[debug-iteration] FAIL: ${msg}`);
  process.exit(1);
};

async function requestJson(path, init = {}) {
  const url = /^https?:\/\//i.test(path) ? path : `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    'content-type': 'application/json',
    'x-vision-user-id': userHeader,
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

async function waitTask(statusUrl, opts = {}) {
  const started = Date.now();
  const transitions = [];
  let last = '';
  while (Date.now() - started <= timeoutMs) {
    const out = await requestJson(statusUrl, { method: 'GET' });
    if (!out.res.ok) fail(`task status request failed: ${out.res.status} ${out.url}`);
    if (!out.json || !out.json.task) {
      fail(`task status returned non-json or missing task object: ${out.url} => ${String(out.text).slice(0, 120)}`);
    }
    const task = out.json.task;
    const status = String(task.status || '').toLowerCase();
    if (status !== last) {
      transitions.push(status || '(empty)');
      last = status;
      log(`task ${task.id} -> ${status} (waitMs=${task.waitMs ?? 'n/a'}, durationMs=${task.durationMs ?? 'n/a'})`);
    }
    if (status === 'success' || status === 'failed') return { task, transitions };
    await sleep(Number(opts.pollMs || 350));
  }
  fail(`task polling timeout after ${timeoutMs}ms: ${statusUrl}`);
}

async function submitAsyncImage(label, priority = 'normal') {
  const body = {
    prompt: `Debug iteration ${label}: cinematic test frame, no text`,
    async: true,
    pipelinePriority: priority,
    settings: {
      provider: 'gemini',
      model: 'mock-sim-image',
      temperature: 0.4,
      maxOutputTokens: 1024,
    },
  };
  const out = await requestJson('/api/asset/image/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (out.res.status !== 202 || !out.json?.accepted || !out.json?.statusUrl) {
    fail(`image async submit failed (${out.res.status}): ${out.text.slice(0, 220)}`);
  }
  return out.json;
}

async function scenarioPipelineStatusJson() {
  log('scenario: pipeline task status endpoint returns JSON and resolves');
  const submitted = await submitAsyncImage('pipeline-status-json', 'high');
  const polled = await waitTask(submitted.statusUrl);
  if (!polled.transitions.length) fail('no status transitions observed');
  if (!['success', 'failed'].includes(String(polled.task.status || '').toLowerCase())) fail('terminal status missing');
  if (String(polled.task.status || '').toLowerCase() === 'success') {
    const imageUrl = String(polled.task?.result?.imageUrl || '').trim();
    if (!imageUrl) fail('success task missing result.imageUrl');
  }
  log('scenario passed: pipeline status JSON + transition tracking');
}

async function scenarioBurstQueue() {
  log(`scenario: burst queue (${taskBurst} normal + 1 high)`);
  const submitted = [];
  for (let i = 0; i < taskBurst; i++) {
    submitted.push(await submitAsyncImage(`burst-normal-${i + 1}`, 'normal'));
  }
  const high = await submitAsyncImage('burst-high-priority', 'high');
  submitted.push(high);

  const results = [];
  for (const s of submitted) {
    const out = await waitTask(s.statusUrl, { pollMs: 300 });
    results.push(out.task);
  }

  const terminalFailures = results.filter((t) => String(t.status || '').toLowerCase() === 'failed');
  if (terminalFailures.length) {
    fail(`burst queue has failed task(s): ${terminalFailures.map((t) => t.id).join(', ')}`);
  }

  const highTask = results.find((t) => t.id === high.taskId);
  const lowWaits = results
    .filter((t) => t.id !== high.taskId)
    .map((t) => Number(t.waitMs || 0))
    .filter((n) => Number.isFinite(n));
  if (highTask && lowWaits.length) {
    const lowAvg = Math.round(lowWaits.reduce((a, b) => a + b, 0) / lowWaits.length);
    log(`queue wait compare: high=${Number(highTask.waitMs || 0)}ms, lowAvg=${lowAvg}ms`);
  }
  log('scenario passed: burst queue tasks all reconcile to success');
}

async function scenarioScaffoldThenAsset() {
  log('scenario: scaffold (mock-sim) then master-kv-like async image');
  const scaffoldBody = {
    intent: 'Debug iteration flow test for pipeline reconciliation',
    aspectRatio: '16:9',
    allowSingleFallback: false,
    settings: {
      provider: 'gemini',
      model: 'mock-sim-scaffold-worker',
      temperature: 0.6,
      maxOutputTokens: 2048,
      useFunctionCalling: false,
    },
    plannerSettings: {
      provider: 'gemini',
      model: 'mock-sim-scaffold-planner',
      temperature: 0.4,
      maxOutputTokens: 2048,
    },
  };
  const scaffold = await requestJson('/api/agent/scaffold', {
    method: 'POST',
    body: JSON.stringify(scaffoldBody),
  });
  if (!scaffold.res.ok || !scaffold.json?.ok || !scaffold.json?.story?.id) {
    fail(`scaffold failed (${scaffold.res.status}): ${scaffold.text.slice(0, 300)}`);
  }
  log(`scaffold ok: story=${scaffold.json.story.id}`);

  const submitted = await submitAsyncImage('after-scaffold-master-kv', 'high');
  const polled = await waitTask(submitted.statusUrl);
  if (String(polled.task.status || '').toLowerCase() !== 'success') {
    fail(`master-kv-like task not success: ${JSON.stringify(polled.task).slice(0, 220)}`);
  }
  log('scenario passed: scaffold + async image flow');
}

(async () => {
  log(`base=${baseUrl}, user=${userHeader}, timeoutMs=${timeoutMs}, includeScaffold=${includeScaffold}`);
  await scenarioPipelineStatusJson();
  await scenarioBurstQueue();
  if (includeScaffold) {
    await scenarioScaffoldThenAsset();
  }
  log('ALL SCENARIOS PASSED');
})().catch((e) => {
  fail(e instanceof Error ? `${e.message}\n${e.stack || ''}` : String(e));
});
