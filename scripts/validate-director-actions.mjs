#!/usr/bin/env node

/**
 * Lightweight director-action validator.
 * - Calls /api/agent/direct only (no asset generation calls).
 * - Audits action shapes, unsupported types, _raw wrappers, and ordering.
 */

const parseArgs = (argv) => {
  const out = {
    base: 'http://127.0.0.1:3000',
    timeoutMs: 30000,
    strict: false,
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    temperature: 0.3,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') out.base = String(argv[++i] || '').trim();
    else if (a === '--timeout-ms') out.timeoutMs = Number(argv[++i] || out.timeoutMs);
    else if (a === '--strict') out.strict = true;
    else if (a === '--provider') out.provider = String(argv[++i] || out.provider).trim();
    else if (a === '--model') out.model = String(argv[++i] || out.model).trim();
    else if (a === '--temperature') out.temperature = Number(argv[++i] || out.temperature);
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  return out;
};

const args = parseArgs(process.argv);

if (args.help) {
  process.stdout.write(
    [
      'validate-director-actions',
      '  --base <url>            Base URL (default http://127.0.0.1:3000)',
      '  --provider <name>       Director provider (default gemini)',
      '  --model <name>          Director model (default gemini-2.5-flash)',
      '  --temperature <n>       Director temperature (default 0.3)',
      '  --timeout-ms <n>        Request timeout',
      '  --strict                Exit non-zero if warnings exist',
      '',
    ].join('\n')
  );
  process.exit(0);
}

if (!args.base) throw new Error('Missing --base');
const base = args.base.replace(/\/$/, '');

const allowedTypes = new Set([
  'NAVIGATE',
  'UPDATE_STORY',
  'CREATE_LOCATION',
  'DELETE_LOCATION',
  'UPDATE_LOCATION',
  'CREATE_CHARACTER',
  'DELETE_CHARACTER',
  'UPDATE_CHARACTER',
  'CREATE_CHARACTER_LOOK',
  'UPDATE_CHARACTER_LOOK',
  'CREATE_SEQUENCE',
  'RENAME_SEQUENCE',
  'DELETE_SEQUENCE',
  'CREATE_SCENE',
  'RENAME_SCENE',
  'UPDATE_SCENE',
  'DELETE_SCENE',
  'CREATE_SHOT',
  'DELETE_SHOT',
  'MOVE_SHOT',
  'MOVE_SHOT_TO_SCENE',
  'UPDATE_SHOT',
  'UPDATE_ELEMENT',
  'SET_CAST',
  'GENERATE_SHOT_IMAGE',
  'GENERATE_LOCATION_PREVIEW',
  'GENERATE_CHARACTER_AVATAR',
  'GENERATE_CHARACTER_LOOK',
  'GENERATE_PROJECT_ASSETS',
  'GENERATE_MASTER_KV_PROPOSAL',
  'ACCEPT_KV_PROPOSAL',
  'DISCARD_KV_PROPOSAL',
]);

const unsupportedDestructiveTypes = new Set([
  'DELETE_CHARACTER_LOOK',
]);

const sampleStory = {
  id: 'story-dummy',
  title: 'Dummy',
  logline: 'Dummy story for command audit.',
  intent: 'Realistic family drama',
  aspectRatio: '16:9',
  keyVisualUrl: '/__generated__/dummy-kv.jpg',
  keyVisualVersions: [{ id: 'kv-1', imageUrl: '/__generated__/dummy-kv.jpg', createdAt: Date.now(), type: 'base' }],
  activeKeyVisualVersionId: 'kv-1',
  locations: [
    {
      id: 'loc-home',
      name: 'Family Apartment',
      description: 'Warm apartment interior',
      visualStyle: 'Naturalistic live-action',
      previewUrl: '/__generated__/loc-home.jpg',
      previewVersions: [{ id: 'pv-1', imageUrl: '/__generated__/loc-home.jpg', createdAt: Date.now(), type: 'base' }],
      activePreviewVersionId: 'pv-1',
      status: 'locked',
      assetState: { status: 'done' },
    },
  ],
  characters: [
    {
      id: 'char-a',
      name: 'Chen Nianren',
      description: 'Teen student',
      avatarUrl: '/__generated__/char-a.jpg',
      avatarVersions: [{ id: 'av-1', imageUrl: '/__generated__/char-a.jpg', createdAt: Date.now(), type: 'base' }],
      activeAvatarVersionId: 'av-1',
      status: 'locked',
      assetState: { status: 'done' },
      looks: [
        {
          id: 'look-school',
          name: 'School Uniform',
          description: 'School uniform look',
          previewUrl: '/__generated__/look-school.jpg',
          previewVersions: [
            {
              id: 'lv-1',
              imageUrl: '/__generated__/look-school.jpg',
              createdAt: Date.now(),
              type: 'base',
              metadata: { sourceAvatarVersionId: 'av-1' },
            },
          ],
          activePreviewVersionId: 'lv-1',
          assetState: { status: 'done' },
        },
      ],
    },
    {
      id: 'char-b',
      name: 'Fang Yuan',
      description: 'Father',
      avatarUrl: '/__generated__/char-b.jpg',
      avatarVersions: [{ id: 'av-b1', imageUrl: '/__generated__/char-b.jpg', createdAt: Date.now(), type: 'base' }],
      activeAvatarVersionId: 'av-b1',
      status: 'locked',
      assetState: { status: 'done' },
      looks: [
        {
          id: 'look-home',
          name: 'Everyday Home Wear',
          description: 'Casual home look',
          previewUrl: '/__generated__/look-home.jpg',
          previewVersions: [
            {
              id: 'lv-b1',
              imageUrl: '/__generated__/look-home.jpg',
              createdAt: Date.now(),
              type: 'base',
              metadata: { sourceAvatarVersionId: 'av-b1' },
            },
          ],
          activePreviewVersionId: 'lv-b1',
          assetState: { status: 'done' },
        },
      ],
    },
  ],
  sequences: [
    {
      id: 'seq-1',
      title: 'Story Part 1',
      context: 'Family dinner tension',
      scenes: [
        {
          id: 'scene-1',
          title: 'Dinner',
          shots: [
            {
              id: 'shot-1',
              sequence: 1,
              locationId: 'loc-home',
              timeOfDay: 'DAY',
              description: 'Family dinner table shot',
              duration: 6,
              thumbnailUrl: '/__generated__/shot-1.jpg',
              activeVersionId: 'v1',
              versions: [{ id: 'v1', imageUrl: '/__generated__/shot-1.jpg', createdAt: Date.now(), type: 'base' }],
              elements: {
                SCRIPT: { type: 'SCRIPT', prompt: '', status: 'auto' },
                CASTING: {
                  type: 'CASTING',
                  prompt: '',
                  status: 'manual',
                  metadata: {
                    characters: [
                      { id: 'char-a', activeLookId: 'look-school' },
                      { id: 'char-b', activeLookId: 'look-home' },
                    ],
                  },
                },
                CAMERA: { type: 'CAMERA', prompt: '', status: 'auto' },
                LIGHTING: { type: 'LIGHTING', prompt: '', status: 'auto' },
                AUDIO: { type: 'AUDIO', prompt: '', status: 'auto' },
              },
              aiState: 'idle',
              assetState: { status: 'done' },
              production: { status: 'idle' },
            },
          ],
        },
      ],
      shots: [],
    },
  ],
};
sampleStory.sequences[0].shots = sampleStory.sequences[0].scenes[0].shots;

const scenarios = [
  {
    id: 'character-sync',
    message:
      '把 Chen Nianren 人设改成成人，移除未成年描述，并同步更新所有包含她的 keyframe。',
    selection: { type: 'character', id: 'char-a' },
    expectSync: true,
  },
  {
    id: 'look-delete-intent',
    message:
      '删除 Chen Nianren 的 School Uniform look，并同步受影响镜头。',
    selection: { type: 'character', id: 'char-a' },
    expectDelete: true,
    expectSync: true,
  },
  {
    id: 'bundled-edit',
    message:
      '把 Chen Nianren 改成成人，并把 School Uniform 改成 Professional Wear，然后更新相关 keyframe。',
    selection: { type: 'character', id: 'char-a' },
    expectSync: true,
  },
];

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

const postDirect = async (scenario) => {
  const url = `${base}/api/agent/direct`;
  const res = await withTimeout(
    (signal) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          message: scenario.message,
          selection: scenario.selection,
          story: sampleStory,
          settings: {
            provider: args.provider,
            model: args.model,
            temperature: args.temperature,
            maxOutputTokens: 4096,
          },
          useFunctionCalling: true,
        }),
      }),
    args.timeoutMs,
    `POST /api/agent/direct (${scenario.id})`
  );
  const text = await res.text().catch(() => '');
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, textPreview: text.slice(0, 300) };
};

const validateActions = (scenario, actions) => {
  const warnings = [];
  const errors = [];

  if (!Array.isArray(actions)) {
    errors.push('actions is not an array');
    return { warnings, errors };
  }

  const generationIndices = [];
  const mutationIndices = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i] || {};
    const type = String(a.type || '');
    const payload = a.payload || {};
    if (!allowedTypes.has(type)) {
      warnings.push(`unknown_or_unsupported_action_type:${type || 'EMPTY'}`);
    }
    if (unsupportedDestructiveTypes.has(type)) {
      warnings.push(`destructive_unsupported_type:${type}`);
    }
    if (String(type).startsWith('GENERATE_')) generationIndices.push(i);
    else mutationIndices.push(i);

    if (payload && typeof payload === 'object') {
      if (typeof payload._raw === 'string') warnings.push(`raw_wrapped_payload:${type}`);
      if (payload.patch && typeof payload.patch === 'object' && typeof payload.patch._raw === 'string') {
        warnings.push(`raw_wrapped_patch:${type}`);
      }
      if (payload.metadata && typeof payload.metadata === 'object' && typeof payload.metadata._raw === 'string') {
        warnings.push(`raw_wrapped_metadata:${type}`);
      }
    }
  }

  if (mutationIndices.length && generationIndices.length) {
    const maxMutation = Math.max(...mutationIndices);
    const minGeneration = Math.min(...generationIndices);
    if (minGeneration < maxMutation) warnings.push('order_warning:generation_before_mutation');
  }

  if (scenario.expectSync) {
    const hasSyncFlag = actions.some((a) => {
      const payload = a?.payload || {};
      const patch = payload?.patch || {};
      return (
        payload?.regenerateDependents === true ||
        payload?.syncDependents === true ||
        patch?.regenerateDependents === true ||
        patch?.syncDependents === true
      );
    });
    const hasScopedGeneration = actions.some((a) => {
      const t = String(a?.type || '');
      if (t === 'GENERATE_SHOT_IMAGE') return true;
      if (t === 'GENERATE_PROJECT_ASSETS') {
        const scope = String((a?.payload || {}).scope || '');
        return scope === 'shots' || scope === 'all';
      }
      return false;
    });
    if (!hasSyncFlag && !hasScopedGeneration) {
      warnings.push('sync_intent_missing:no_sync_flag_or_generation_action');
    }
  }

  if (scenario.expectDelete) {
    const hasDelete = actions.some((a) => String(a?.type || '').includes('DELETE_'));
    if (!hasDelete) warnings.push('delete_intent_missing:no_delete_action');
  }

  return { warnings, errors };
};

const run = async () => {
  const report = {
    base,
    provider: args.provider,
    model: args.model,
    strict: args.strict,
    scenarios: [],
    summary: { warnings: 0, errors: 0 },
  };

  for (const scenario of scenarios) {
    const out = await postDirect(scenario);
    const entry = {
      id: scenario.id,
      message: scenario.message,
      status: out.status,
      ok: out.ok,
      reply: out.json?.reply || null,
      actions: Array.isArray(out.json?.actions) ? out.json.actions : [],
      warnings: [],
      errors: [],
    };

    if (!out.ok) {
      entry.errors.push(`http_error:${out.status}`);
      entry.errors.push(`response_preview:${out.textPreview}`);
    } else {
      const v = validateActions(scenario, entry.actions);
      entry.warnings.push(...v.warnings);
      entry.errors.push(...v.errors);
    }

    report.summary.warnings += entry.warnings.length;
    report.summary.errors += entry.errors.length;
    report.scenarios.push(entry);
  }

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.summary.errors > 0 || (args.strict && report.summary.warnings > 0)) {
    process.exit(1);
  }
};

run().catch((e) => {
  process.stderr.write(String(e instanceof Error ? e.message : e) + '\n');
  process.exit(1);
});
