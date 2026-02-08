import { AgentAction, AgentPlan, ElementType, ModelRuntimeSettings, SelectionState, Story } from '../../../types';
import { addDebugEvent } from '../../debug/eventLog';
import { AgentApiError, isAgentApiError, readErrorBody } from './apiError';

export interface DirectorCommandRequest {
  message: string;
  selection: SelectionState;
  story: Story;
  settings: ModelRuntimeSettings;
  allowSingleFallback?: boolean;
  useFunctionCalling?: boolean;
}

export interface DirectorCommandResponse {
  reply: string;
  plan: AgentPlan;
  actions: AgentAction[];
  debug?: {
    transport: 'rule' | 'http';
    provider: string;
    model: string;
    endpoint?: string;
    error?: string;
    [key: string]: any;
  };
}

export type DirectorStreamEvent =
  | { event: 'status'; data: { message: string } }
  | { event: 'agent_start'; data: { agent: string } }
  | { event: 'agent_done'; data: { agent: string; ok: boolean; ms?: number; error?: string } }
  | { event: 'reply_delta'; data: { delta: string } }
  | { event: 'reply_done'; data: { text: string } }
  | { event: 'result'; data: DirectorCommandResponse }
  | { event: 'error'; data: { message: string } };

const joinUrl = (baseUrl: string | undefined, pathname: string) => {
  const base = String(baseUrl || '').trim().replace(/\/$/, '');
  return base ? `${base}${pathname}` : pathname;
};

const postJson = async <T>(url: string, body: unknown, timeoutMs: number): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    addDebugEvent({ level: 'info', scope: 'agent.direct', message: 'POST', data: { url, body } });
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      }).catch((e) => {
        if (e && typeof e === 'object' && (e as any).name === 'AbortError') {
          throw new Error(`Timeout after ${timeoutMs}ms`);
        }
        throw e;
      });
    if (!res.ok) {
      const { text, json } = await readErrorBody(res);
      addDebugEvent({ level: 'error', scope: 'agent.direct', message: 'HTTP error', data: { url, status: res.status, text, json } });
      throw new AgentApiError({
        message: `HTTP ${res.status}${text ? `: ${text}` : ''}`,
        status: res.status,
        url,
        bodyText: text,
        bodyJson: json,
      });
    }
    const json = (await res.json()) as T;
    addDebugEvent({ level: 'info', scope: 'agent.direct', message: 'Response', data: { url, json } });
    return json;
  } finally {
    clearTimeout(timeout);
  }
};

const parseSse = async (res: Response, onEvent: (ev: DirectorStreamEvent) => void) => {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Streaming not supported in this environment');
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      if (!chunk) continue;
      let eventName = 'message';
      let dataLine = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) dataLine += line.slice(5).trim();
      }
      if (!dataLine) continue;
      try {
        const data = JSON.parse(dataLine);
        onEvent({ event: eventName as any, data } as DirectorStreamEvent);
      } catch {
        // ignore malformed chunk
      }
    }
  }
};

const includesAny = (text: string, phrases: string[]) => phrases.some((p) => text.includes(p));

const ruleBased = (req: DirectorCommandRequest): DirectorCommandResponse => {
  const now = Date.now();
  const raw = String(req.message || '').trim();
  const msg = raw.toLowerCase();
  const actions: AgentAction[] = [];
  const notes: string[] = [];

  const story = req.story;
  const selection = req.selection;

  const findByName = <T extends { id: string; name: string }>(items: T[], needle: string) => {
    const q = needle.trim().toLowerCase();
    if (!q) return null;
    return items.find((x) => String(x.name || '').toLowerCase().includes(q)) || null;
  };

  const findMentioned = <T extends { id: string; name: string }>(items: T[]) => {
    const found: T[] = [];
    for (const it of items) {
      const n = String(it.name || '').toLowerCase();
      if (n && msg.includes(n)) found.push(it);
    }
    return found;
  };

  const getSelectedShot = () => {
    if (selection.type !== 'shot') return null;
    const seqId = selection.parentId || '';
    const seq = story.sequences.find((s) => s.id === seqId);
    const shot = seq?.shots.find((s) => s.id === selection.id) || null;
    return shot ? { seqId, shot } : null;
  };

  // Navigation ("open/go to")
  if (includesAny(msg, ['open', 'go to', 'goto', '打开', '进入', '跳转'])) {
    const mentionedChars = findMentioned(story.characters || []);
    if (mentionedChars.length) {
      actions.push({ type: 'NAVIGATE', payload: { type: 'character', id: mentionedChars[0].id } });
      notes.push('navigate → character');
    }
    const mentionedLocs = findMentioned(story.locations || []);
    if (!mentionedChars.length && mentionedLocs.length) {
      actions.push({ type: 'NAVIGATE', payload: { type: 'location', id: mentionedLocs[0].id } });
      notes.push('navigate → location');
    }
  }

  // Story-level edits
  if (includesAny(msg, ['title:', '标题:', '标题：', '改标题', 'rename title'])) {
    const m = raw.match(/(?:title|标题)\s*[:：]\s*(.+)$/i);
    const title = m?.[1]?.trim();
    if (title) {
      actions.push({ type: 'UPDATE_STORY', payload: { patch: { title } } });
      notes.push('update story title');
    }
  }

  if (includesAny(msg, ['logline:', '一句话:', '一句话：', '改logline', '改一句话'])) {
    const m = raw.match(/(?:logline|一句话)\s*[:：]\s*(.+)$/i);
    const logline = m?.[1]?.trim();
    if (logline) {
      actions.push({ type: 'UPDATE_STORY', payload: { patch: { logline } } });
      notes.push('update story logline');
    }
  }

  if (includesAny(msg, ['intent:', '意图:', '意图：', '改意图'])) {
    const m = raw.match(/(?:intent|意图)\s*[:：]\s*(.+)$/i);
    const intent = m?.[1]?.trim();
    if (intent) {
      actions.push({ type: 'UPDATE_STORY', payload: { patch: { intent } } });
      notes.push('update story intent');
    }
  }

  // Create sequence / shot
  if (includesAny(msg, ['new sequence', '新增sequence', '新增段落', '新增序列', 'add sequence'])) {
    actions.push({ type: 'CREATE_SEQUENCE', payload: {} });
    notes.push('create sequence');
  }

  if (includesAny(msg, ['new shot', '新增镜头', '新增分镜', '新增beat', 'add shot', 'add beat'])) {
    const selected = getSelectedShot();
    if (selected) {
      actions.push({
        type: 'CREATE_SHOT',
        payload: {
          sequenceId: selected.seqId,
          afterShotId: selected.shot.id,
          locationId: selected.shot.locationId,
          timeOfDay: selected.shot.timeOfDay,
        },
      });
      notes.push('create shot (after current)');
    } else if (selection.type === 'sequence') {
      actions.push({ type: 'CREATE_SHOT', payload: { sequenceId: selection.id } });
      notes.push('create shot (append)');
    }
  }

  // Shot structure edits: time/location/cast
  const selected = getSelectedShot();
  if (selected) {
    if (includesAny(msg, ['night', '夜'])) {
      actions.push({ type: 'UPDATE_SHOT', payload: { shotId: selected.shot.id, sequenceId: selected.seqId, patch: { timeOfDay: 'Night' } } });
      notes.push('shot time → night');
    } else if (includesAny(msg, ['day', '白天', '日'])) {
      actions.push({ type: 'UPDATE_SHOT', payload: { shotId: selected.shot.id, sequenceId: selected.seqId, patch: { timeOfDay: 'Day' } } });
      notes.push('shot time → day');
    }

    const mentionedLocs = findMentioned(story.locations || []);
    if (mentionedLocs.length) {
      actions.push({
        type: 'UPDATE_SHOT',
        payload: { shotId: selected.shot.id, sequenceId: selected.seqId, patch: { locationId: mentionedLocs[0].id } },
      });
      notes.push('shot environment → ' + mentionedLocs[0].name);
    }

    const mentionedChars = findMentioned(story.characters || []);
    if (includesAny(msg, ['add', '加入', '加上', '加', 'cast']) && mentionedChars.length) {
      const existing = (selected.shot.elements as any)?.CASTING?.metadata?.characters;
      const existingArr = Array.isArray(existing) ? existing : [];
      const seen = new Set(existingArr.map((c: any) => String(c?.id || '')));
      const next = existingArr.slice();
      for (const c of mentionedChars) {
        if (seen.has(c.id)) continue;
        next.push({ id: c.id, activeLookId: c.looks?.[0]?.id || '' });
      }
      actions.push({ type: 'SET_CAST', payload: { sequenceId: selected.seqId, shotId: selected.shot.id, cast: next } });
      notes.push('update cast (+)');
    }
  }

  const wantsGenerate = includesAny(msg, ['generate', 'render', 'asset', 'assets', 'image', 'images', '出图', '生成', '渲染', '资产', '缩略图']);
  const wantsKvProposalGenerate = includesAny(msg, [
    'update kv',
    'regenerate kv',
    'generate kv',
    'master kv',
    'key visual',
    '主kv',
    '主视觉',
  ]);
  const wantsKvAccept = includesAny(msg, ['accept kv', 'accept', '采用', '确认', '同意', '更新资产']);
  const wantsKvDiscard = includesAny(msg, ['discard kv', 'discard', 'reject', '拒绝', '放弃', '丢弃']);
  const wantsKvRetry = includesAny(msg, ['retry kv', 'retry', '重新生成kv', '重试kv', '重试']);

  if (wantsKvRetry) {
    actions.push({ type: 'DISCARD_KV_PROPOSAL', payload: {} as any });
    actions.push({ type: 'GENERATE_MASTER_KV_PROPOSAL', payload: { reason: 'retry' } as any });
    notes.push('kv proposal: retry');
  } else if (wantsKvAccept) {
    actions.push({ type: 'ACCEPT_KV_PROPOSAL', payload: { updateAssets: true } as any });
    notes.push('kv proposal: accept');
  } else if (wantsKvDiscard) {
    actions.push({ type: 'DISCARD_KV_PROPOSAL', payload: {} as any });
    notes.push('kv proposal: discard');
  } else if (wantsKvProposalGenerate) {
    actions.push({ type: 'GENERATE_MASTER_KV_PROPOSAL', payload: { reason: 'director_request' } as any });
    notes.push('kv proposal: generate');
  }

  const hasKvProposalControl = wantsKvProposalGenerate || wantsKvAccept || wantsKvDiscard || wantsKvRetry;
  if (wantsGenerate && !hasKvProposalControl) {
    if (req.selection.type === 'shot') {
      const shotId = req.selection.id;
      const sequenceId = req.selection.parentId || '';
      if (shotId && sequenceId) {
        actions.push({ type: 'GENERATE_SHOT_IMAGE', payload: { shotId, sequenceId } });
        notes.push('generate shot image');
      }
    } else if (req.selection.type === 'location') {
      const locationId = req.selection.id;
      if (locationId) {
        actions.push({ type: 'GENERATE_LOCATION_PREVIEW', payload: { locationId } });
        notes.push('generate location preview');
      }
    } else if (req.selection.type === 'character') {
      const characterId = req.selection.id;
      if (characterId) {
        actions.push({ type: 'GENERATE_CHARACTER_AVATAR', payload: { characterId } });
        notes.push('generate character avatar');
      }
    } else {
      const scope = includesAny(msg, ['kv', 'key visual', '主视觉', '主kv'])
        ? 'masterkv'
        : includesAny(msg, ['shot', 'shots', '镜头', '分镜'])
        ? 'shots'
        : includesAny(msg, ['location', 'locations', '环境', '置景'])
          ? 'locations'
          : includesAny(msg, ['character', 'characters', '角色', '人物'])
            ? 'characters'
            : includesAny(msg, ['look', 'looks', '造型'])
              ? 'looks'
              : 'all';
      actions.push({ type: 'GENERATE_PROJECT_ASSETS', payload: { scope, concurrency: 2 } });
      notes.push(`generate project assets (${scope})`);
    }
  }

  // Create look (2-level casting workflow)
  if (includesAny(msg, ['new look', 'add look', 'create look', '新增look', '新增造型', '新增定妆', '新增服装', '新增造型照'])) {
    const mentionedChars = findMentioned(story.characters || []);
    const characterId =
      req.selection.type === 'character'
        ? req.selection.id
        : mentionedChars[0]?.id
          ? String(mentionedChars[0].id)
          : '';
    if (characterId) {
      const ch = story.characters.find((c) => c.id === characterId) || null;
      const n = (ch?.looks || []).length + 1;

      const nameMatch =
        raw.match(/(?:look|造型|定妆)\s*[:：]\s*([^\n,，;；]+)/i) ||
        raw.match(/(?:叫|命名)\s*([^\n,，;；]+)/i) ||
        raw.match(/new look\s+(.+)$/i);
      const name = (nameMatch?.[1] || `Look ${n}`).trim();

      const descMatch = raw.match(/(?:desc|description|描述)\s*[:：]\s*(.+)$/i);
      const description =
        (descMatch?.[1] || '').trim() ||
        `Wardrobe/makeup/hair variation for ${ch?.name || 'this character'}. Keep identity consistent with the base avatar.`;

      actions.push({ type: 'CREATE_CHARACTER_LOOK', payload: { characterId, name, description } });
      notes.push('create character look');
    }
  }

  if (req.selection.type === 'shot') {
    const shotId = req.selection.id;
    const sequenceId = req.selection.parentId || '';

    if (includesAny(msg, ['close up', 'close-up', 'closeup', '特写'])) {
      actions.push({
        type: 'UPDATE_ELEMENT',
        payload: { shotId, sequenceId, elementType: ElementType.CAMERA, prompt: 'Close-up shot, subject-isolated framing' },
      });
      notes.push('camera → close-up');
    }

    if (includesAny(msg, ['wide', 'establishing', '远景', '全景'])) {
      actions.push({
        type: 'UPDATE_ELEMENT',
        payload: { shotId, sequenceId, elementType: ElementType.CAMERA, prompt: 'Wide establishing shot, layered composition' },
      });
      notes.push('camera → wide');
    }

    if (includesAny(msg, ['warmer', 'warm', '暖', '暖色'])) {
      actions.push({
        type: 'UPDATE_ELEMENT',
        payload: { shotId, sequenceId, elementType: ElementType.LIGHTING, prompt: 'Warm lighting, golden tones' },
      });
      notes.push('lighting → warmer');
    }

    if (includesAny(msg, ['cooler', 'cool', '冷', '冷色'])) {
      actions.push({
        type: 'UPDATE_ELEMENT',
        payload: { shotId, sequenceId, elementType: ElementType.LIGHTING, prompt: 'Cool lighting, blue tones' },
      });
      notes.push('lighting → cooler');
    }
  }

  const plan: AgentPlan = {
    id: `plan-${now}`,
    summary: notes.length > 0 ? `Proposed edits: ${notes.join(', ')}` : 'No structured edits recognized (rule-based).',
    steps: [
      { id: `s-${now}-1`, title: 'Parse directive', status: 'done' },
      { id: `s-${now}-2`, title: 'Generate structured actions', status: 'done' },
      { id: `s-${now}-3`, title: 'Ready to apply', status: 'done' },
    ],
    actions,
  };

  const reply = actions.length
    ? `I mapped your directive into ${actions.length} structured action(s): ${notes.join(', ')}.`
    : `I couldn't map that into a structured change yet. Try: "warmer light", "close up", "wide establishing".`;

  return {
    reply,
    plan,
    actions,
    debug: { transport: 'rule', provider: 'mock', model: 'rule' },
  };
};

export const runDirectorCommand = async (req: DirectorCommandRequest): Promise<DirectorCommandResponse> => {
  if (req.settings.provider === 'mock') return ruleBased(req);

  const endpoint = joinUrl(req.settings.baseUrl, '/api/agent/direct');
  try {
    const res = await postJson<DirectorCommandResponse>(
      endpoint,
      {
        message: req.message,
        selection: req.selection,
        story: req.story,
        allowSingleFallback: Boolean(req.allowSingleFallback),
        useFunctionCalling: Boolean(req.useFunctionCalling ?? (req.settings as any)?.useFunctionCalling),
        settings: {
          provider: req.settings.provider,
          model: req.settings.model,
          temperature: req.settings.temperature,
          maxOutputTokens: req.settings.maxOutputTokens,
        },
      },
      120_000
    );
    return {
      ...res,
      debug: {
        ...(res.debug || {}),
        transport: (res as any)?.debug?.transport || 'http',
        provider: req.settings.provider,
        model: req.settings.model,
        endpoint,
      },
    };
  } catch (e) {
    if (isAgentApiError(e)) throw e;
    throw new Error(`HTTP director failed for ${req.settings.provider}/${req.settings.model}: ${e instanceof Error ? e.message : String(e)}`);
  }
};

export const runDirectorCommandStream = async (
  req: DirectorCommandRequest,
  onEvent: (ev: DirectorStreamEvent) => void
): Promise<DirectorCommandResponse> => {
  if (req.settings.provider === 'mock') {
    const res = ruleBased(req);
    onEvent({ event: 'result', data: res });
    return res;
  }
  const endpoint = joinUrl(req.settings.baseUrl, '/api/agent/direct');
  addDebugEvent({ level: 'info', scope: 'agent.direct', message: 'POST (stream)', data: { url: endpoint } });
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: req.message,
      selection: req.selection,
      story: req.story,
      allowSingleFallback: Boolean(req.allowSingleFallback),
      useFunctionCalling: Boolean(req.useFunctionCalling ?? (req.settings as any)?.useFunctionCalling),
      useStreaming: true,
      settings: {
        provider: req.settings.provider,
        model: req.settings.model,
        temperature: req.settings.temperature,
        maxOutputTokens: req.settings.maxOutputTokens,
      },
    }),
  });
  if (!res.ok) {
    const { text, json } = await readErrorBody(res);
    throw new AgentApiError({
      message: `HTTP ${res.status}${text ? `: ${text}` : ''}`,
      status: res.status,
      url: endpoint,
      bodyText: text,
      bodyJson: json,
    });
  }
  let final: DirectorCommandResponse | null = null;
  await parseSse(res, (ev) => {
    if (ev.event === 'result') final = ev.data as DirectorCommandResponse;
    onEvent(ev);
  });
  if (!final) throw new Error('Streaming ended without result');
  return final;
};
