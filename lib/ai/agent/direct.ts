import { AgentAction, AgentPlan, ElementType, ModelRuntimeSettings, SelectionState, Story } from '../../../types';
import { addDebugEvent } from '../../debug/eventLog';

export interface DirectorCommandRequest {
  message: string;
  selection: SelectionState;
  story: Story;
  settings: ModelRuntimeSettings;
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
  };
}

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
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      addDebugEvent({ level: 'error', scope: 'agent.direct', message: 'HTTP error', data: { url, status: res.status, text } });
      throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ''}`);
    }
    const json = (await res.json()) as T;
    addDebugEvent({ level: 'info', scope: 'agent.direct', message: 'Response', data: { url, json } });
    return json;
  } finally {
    clearTimeout(timeout);
  }
};

const includesAny = (text: string, phrases: string[]) => phrases.some((p) => text.includes(p));

const ruleBased = (req: DirectorCommandRequest): DirectorCommandResponse => {
  const now = Date.now();
  const msg = req.message.toLowerCase();
  const actions: AgentAction[] = [];
  const notes: string[] = [];

  if (req.selection.type === 'shot') {
    const shotId = req.selection.id;
    const sequenceId = req.selection.parentId || '';

    if (includesAny(msg, ['close up', 'close-up', 'closeup', '特写'])) {
      actions.push({
        type: 'UPDATE_ELEMENT',
        payload: { shotId, sequenceId, elementType: ElementType.CAMERA, prompt: 'Close-up shot, shallow depth of field' },
      });
      notes.push('camera → close-up');
    }

    if (includesAny(msg, ['wide', 'establishing', '远景', '全景'])) {
      actions.push({
        type: 'UPDATE_ELEMENT',
        payload: { shotId, sequenceId, elementType: ElementType.CAMERA, prompt: 'Wide establishing shot, cinematic composition' },
      });
      notes.push('camera → wide');
    }

    if (includesAny(msg, ['warmer', 'warm', '暖', '暖色'])) {
      actions.push({
        type: 'UPDATE_ELEMENT',
        payload: { shotId, sequenceId, elementType: ElementType.LIGHTING, prompt: 'Warm cinematic lighting, golden tones' },
      });
      notes.push('lighting → warmer');
    }

    if (includesAny(msg, ['cooler', 'cool', '冷', '冷色'])) {
      actions.push({
        type: 'UPDATE_ELEMENT',
        payload: { shotId, sequenceId, elementType: ElementType.LIGHTING, prompt: 'Cool cinematic lighting, blue tones' },
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
    ? `I mapped your directive into ${actions.length} structured change(s): ${notes.join(', ')}.`
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

  const endpoint = (req.settings.baseUrl || '') + '/api/agent/direct';
  try {
    const res = await postJson<DirectorCommandResponse>(
      endpoint,
      {
        message: req.message,
        selection: req.selection,
        story: req.story,
        settings: {
          provider: req.settings.provider,
          model: req.settings.model,
          temperature: req.settings.temperature,
          maxOutputTokens: req.settings.maxOutputTokens,
        },
      },
      60_000
    );
    return {
      ...res,
      debug: {
        ...(res.debug || {}),
        transport: 'http',
        provider: req.settings.provider,
        model: req.settings.model,
        endpoint,
      },
    };
  } catch (e) {
    const fallback = ruleBased(req);
    return {
      ...fallback,
      debug: {
        transport: 'http',
        provider: req.settings.provider,
        model: req.settings.model,
        endpoint,
        error: e instanceof Error ? e.message : String(e),
      },
    };
  }
};
