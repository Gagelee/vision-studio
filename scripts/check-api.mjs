#!/usr/bin/env node
/**
 * Quick API connectivity check for local dev/preview servers.
 *
 * Usage:
 *   node scripts/check-api.mjs --base http://127.0.0.1:3000
 *   node scripts/check-api.mjs --base http://127.0.0.1:4173 --require-http
 *   node scripts/check-api.mjs --base http://127.0.0.1:4173 --include-image
 */

const parseArgs = (argv) => {
  const out = { base: 'http://127.0.0.1:3000', requireHttp: false, includeImage: false, timeoutMs: 15000 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') out.base = String(argv[++i] || '').trim();
    else if (a === '--require-http') out.requireHttp = true;
    else if (a === '--include-image') out.includeImage = true;
    else if (a === '--timeout-ms') out.timeoutMs = Number(argv[++i] || out.timeoutMs);
    else if (a === '-h' || a === '--help') out.help = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  return out;
};

const args = parseArgs(process.argv);
if (args.help) {
  process.stdout.write(
    [
      'check-api',
      '  --base <url>          Base URL (default http://127.0.0.1:3000)',
      '  --require-http        Fail if debug.transport is not "http"',
      '  --include-image       Also test /api/asset/image/generate (+ fetch generated asset)',
      '  --timeout-ms <n>       Request timeout (default 15000)',
      '',
    ].join('\n')
  );
  process.exit(0);
}
if (!args.base) throw new Error('Missing --base');
const base = args.base.replace(/\/$/, '');

const withTimeout = async (fn, ms, label) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${label} failed: ${msg}`);
  } finally {
    clearTimeout(t);
  }
};

const postJson = async (path, body) => {
  const url = `${base}${path}`;
  const started = Date.now();
  const res = await withTimeout(
    (signal) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      }),
    args.timeoutMs,
    `POST ${path}`
  );
  const text = await res.text().catch(() => '');
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { url, ms: Date.now() - started, status: res.status, ok: res.ok, json, textPreview: text.slice(0, 280) };
};

const head = async (path) => {
  const url = `${base}${path}`;
  const started = Date.now();
  const res = await withTimeout(
    (signal) => fetch(url, { method: 'HEAD', signal }),
    args.timeoutMs,
    `HEAD ${path}`
  );
  return {
    url,
    ms: Date.now() - started,
    status: res.status,
    ok: res.ok,
    contentType: res.headers.get('content-type') || '',
    contentLength: res.headers.get('content-length') || '',
  };
};

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const pretty = (obj) => JSON.stringify(obj, null, 2);

const run = async () => {
  const results = [];

  // Scaffold
  const scaffold = await postJson('/api/agent/scaffold', {
    intent: 'API connectivity test',
    aspectRatio: '16:9',
    settings: { provider: 'gemini', model: 'gemini-3-pro-preview', temperature: 0.4, maxOutputTokens: 2048 },
  });
  results.push({ name: 'scaffold', ...scaffold, debug: scaffold.json?.debug });
  assert(scaffold.ok, `scaffold HTTP ${scaffold.status}`);
  assert(scaffold.json && scaffold.json.ok === true, `scaffold: expected {ok:true} (got ${scaffold.textPreview})`);
  assert(scaffold.json.story && scaffold.json.plan, 'scaffold: missing story/plan');
  if (args.requireHttp) assert(scaffold.json?.debug?.transport === 'http', `scaffold: transport=${scaffold.json?.debug?.transport}`);

  // Director
  const direct = await postJson('/api/agent/direct', {
    message: 'make it warmer',
    selection: { type: 'shot', id: 'shot-1', parentId: 'seq-1' },
    story: scaffold.json.story,
    settings: { provider: 'gemini', model: 'gemini-3-pro-preview', temperature: 0.3, maxOutputTokens: 2048 },
  });
  results.push({ name: 'direct', ...direct, debug: direct.json?.debug });
  assert(direct.ok, `direct HTTP ${direct.status}`);
  assert(direct.json && typeof direct.json.reply === 'string', `direct: missing reply (got ${direct.textPreview})`);
  assert(Array.isArray(direct.json.actions), 'direct: missing actions[]');
  if (args.requireHttp) assert(direct.json?.debug?.transport === 'http', `direct: transport=${direct.json?.debug?.transport}`);

  // Image (optional)
  if (args.includeImage) {
    const img = await postJson('/api/asset/image/generate', {
      prompt: 'Cinematic environment concept art, sunrise. No text. No watermark.',
      aspectRatio: '16:9',
      settings: { provider: 'gemini', model: 'nano-banana-pro', temperature: 0.4 },
    });
    results.push({ name: 'image.generate', ...img, debug: img.json?.debug });
    assert(img.ok, `image.generate HTTP ${img.status}`);
    assert(img.json && typeof img.json.imageUrl === 'string', `image.generate: missing imageUrl (got ${img.textPreview})`);
    const imageUrl = img.json.imageUrl;
    if (typeof imageUrl === 'string' && imageUrl.startsWith('/__generated__/')) {
      const h = await head(imageUrl);
      results.push({ name: 'image.fetch', ...h });
      assert(h.ok, `image.fetch HTTP ${h.status}`);
      assert(h.contentType.startsWith('image/'), `image.fetch: content-type=${h.contentType}`);
    }
  }

  process.stdout.write(pretty({ base, requireHttp: args.requireHttp, includeImage: args.includeImage, results }) + '\n');
};

run().catch((e) => {
  process.stderr.write(String(e instanceof Error ? e.message : e) + '\n');
  process.exit(1);
});
