import { IMAGES, INITIAL_STORY } from '../../../constants';
import { AgentPlan, AiSettings, AspectRatio, ModelRuntimeSettings, Story } from '../../../types';
import { addDebugEvent } from '../../debug/eventLog';
import { AgentApiError, isAgentApiError, readErrorBody } from './apiError';

export interface ScaffoldProjectRequest {
  intent: string;
  aspectRatio: AspectRatio;
  keyVisualUrl?: string;
  settings: ModelRuntimeSettings;
  plannerSettings?: ModelRuntimeSettings;
  allowSingleFallback?: boolean;
}

export interface ScaffoldProjectResponse {
  story: Story;
  plan: AgentPlan;
  debug?: {
    transport: 'mock' | 'http';
    provider: string;
    model: string;
    endpoint?: string;
    error?: string;
    [key: string]: any;
  };
}

const joinUrl = (baseUrl: string | undefined, pathname: string) => {
  const base = String(baseUrl || '').trim().replace(/\/$/, '');
  return base ? `${base}${pathname}` : pathname;
};

const parseSseEvent = (raw: string): { event: string; data: string } | null => {
  const lines = raw.split('\n');
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim() || 'message';
    if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart());
  }
  if (!event && dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
};

export const scaffoldProjectStream = async (
  req: ScaffoldProjectRequest,
  opts?: {
    onEvent?: (ev: { event: string; data: any }) => void;
  },
): Promise<ScaffoldProjectResponse> => {
  if (req.settings.provider === 'mock') {
    return createLocalMockProject(req.intent, req.aspectRatio, req.keyVisualUrl);
  }

  const endpoint = joinUrl(req.settings.baseUrl, '/api/agent/scaffold/stream');
  const body = {
    intent: req.intent,
    aspectRatio: req.aspectRatio,
    keyVisualUrl: req.keyVisualUrl,
    allowSingleFallback: Boolean(req.allowSingleFallback),
    settings: {
      provider: req.settings.provider,
      model: req.settings.model,
      temperature: req.settings.temperature,
      maxOutputTokens: req.settings.maxOutputTokens,
    },
    plannerSettings: req.plannerSettings
      ? {
          provider: req.plannerSettings.provider,
          model: req.plannerSettings.model,
          temperature: req.plannerSettings.temperature,
          maxOutputTokens: req.plannerSettings.maxOutputTokens,
        }
      : undefined,
  };

  const controller = new AbortController();
  const timeoutMs = 10 * 60_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    addDebugEvent({ level: 'info', scope: 'agent.scaffold', message: 'POST (stream)', data: { url: endpoint, body } });
    const res = await fetch(endpoint, {
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
      throw new AgentApiError({
        message: `HTTP ${res.status}${text ? `: ${text}` : ''}`,
        status: res.status,
        url: endpoint,
        bodyText: text,
        bodyJson: json,
      });
    }

    if (!res.body) throw new Error('Missing response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      while (true) {
        const idx = buf.indexOf('\n\n');
        if (idx < 0) break;
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const parsed = parseSseEvent(raw);
        if (!parsed) continue;
        let data: any = parsed.data;
        try {
          data = parsed.data ? JSON.parse(parsed.data) : null;
        } catch {
          // keep raw string
        }
        opts?.onEvent?.({ event: parsed.event, data });
        if (parsed.event === 'hello') {
          addDebugEvent({ level: 'info', scope: 'agent.scaffold', message: 'SSE hello', data });
        }
        if (parsed.event === 'progress') {
          addDebugEvent({ level: 'info', scope: 'agent.scaffold', message: 'SSE progress', data });
        }
        if (parsed.event === 'trace') {
          addDebugEvent({ level: 'info', scope: 'agent.scaffold', message: 'SSE trace', data });
        }
        if (parsed.event === 'done' && data) {
          addDebugEvent({ level: 'info', scope: 'agent.scaffold', message: 'Response', data: { url: endpoint, json: data } });
          return data as ScaffoldProjectResponse;
        }
        if (parsed.event === 'error' && data) {
          // Server-streamed errors are sent as JSON payloads.
          const status = Number((data as any)?.status || 502);
          addDebugEvent({ level: 'error', scope: 'agent.scaffold', message: 'Response', data: { url: endpoint, json: data } });
          throw new AgentApiError({
            message: `HTTP ${status}: ${String((data as any)?.message || 'Scaffold failed')}`,
            status,
            url: endpoint,
            bodyText: JSON.stringify(data),
            bodyJson: data,
          });
        }
      }
    }

    throw new Error('Stream ended without done');
  } finally {
    clearTimeout(timeout);
  }
};

const isUsefulScaffold = (story: Story | undefined | null) => {
  if (!story) return false;
  const seqs = Array.isArray(story.sequences) ? story.sequences : [];
  const locs = Array.isArray(story.locations) ? story.locations : [];
  const chars = Array.isArray(story.characters) ? story.characters : [];
  const hasAnyShots = seqs.some((s) => Array.isArray(s.shots) && s.shots.length > 0);
  return hasAnyShots || locs.length > 0 || chars.length > 0;
};

export const createLocalMockProject = (intent: string, aspectRatio: AspectRatio, keyVisualUrl?: string): ScaffoldProjectResponse => {
  const now = Date.now();
  const id = `proj-${now}`;
  const title = intent.trim().split(/\s+/).slice(0, 4).join(' ') || 'New Masterpiece';

  const story: Story = {
    ...JSON.parse(JSON.stringify(INITIAL_STORY)),
    id,
    title,
    intent,
    logline: `An AI-directed story based on: "${intent.trim()}"`,
    styleGuide:
      'Style Guide: cinematic, cohesive art direction; consistent palette and lighting language; stable character identity; avoid drastic style shifts.',
    aspectRatio,
    keyVisualUrl: keyVisualUrl || IMAGES.SKYBRIDGE,
    status: 'ready',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };

  const plan: AgentPlan = {
    id: `plan-${now}`,
    summary: 'Scaffolded a first-pass story structure (local mock).',
    steps: [
      { id: `s-${now}-1`, title: 'Analyze intent', status: 'done' },
      { id: `s-${now}-2`, title: 'Draft environments (locations)', status: 'done' },
      { id: `s-${now}-3`, title: 'Draft casting (characters + looks)', status: 'done' },
      { id: `s-${now}-4`, title: 'Assemble sequences & shots', status: 'done' },
      { id: `s-${now}-5`, title: 'Finalize project scaffold', status: 'done' },
    ],
    actions: [{ type: 'SCAFFOLD_PROJECT' }],
  };

  return {
    story,
    plan,
    debug: {
      transport: 'mock',
      provider: 'mock',
      model: 'mock',
    },
  };
};

const postJson = async <T>(url: string, body: unknown, timeoutMs: number): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    addDebugEvent({ level: 'info', scope: 'agent.scaffold', message: 'POST', data: { url, body } });
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
      addDebugEvent({ level: 'error', scope: 'agent.scaffold', message: 'HTTP error', data: { url, status: res.status, text, json } });
      throw new AgentApiError({
        message: `HTTP ${res.status}${text ? `: ${text}` : ''}`,
        status: res.status,
        url,
        bodyText: text,
        bodyJson: json,
      });
    }
    const json = (await res.json()) as T;
    addDebugEvent({ level: 'info', scope: 'agent.scaffold', message: 'Response', data: { url, json } });
    return json;
  } finally {
    clearTimeout(timeout);
  }
};

export const scaffoldProject = async (req: ScaffoldProjectRequest): Promise<ScaffoldProjectResponse> => {
  // "mock" always works; HTTP transport is optional and can be enabled later without changing UI flow.
  if (req.settings.provider === 'mock') {
    return createLocalMockProject(req.intent, req.aspectRatio, req.keyVisualUrl);
  }

  const endpoint = joinUrl(req.settings.baseUrl, '/api/agent/scaffold');

  try {
    const res = await postJson<ScaffoldProjectResponse>(
      endpoint,
      {
        intent: req.intent,
        aspectRatio: req.aspectRatio,
        keyVisualUrl: req.keyVisualUrl,
        allowSingleFallback: Boolean(req.allowSingleFallback),
        settings: {
          provider: req.settings.provider,
          model: req.settings.model,
          temperature: req.settings.temperature,
          maxOutputTokens: req.settings.maxOutputTokens,
        },
        plannerSettings: req.plannerSettings
          ? {
              provider: req.plannerSettings.provider,
              model: req.plannerSettings.model,
              temperature: req.plannerSettings.temperature,
              maxOutputTokens: req.plannerSettings.maxOutputTokens,
            }
          : undefined,
      },
      180_000
    );

    if (!isUsefulScaffold((res as any)?.story) || !(res as any)?.plan) {
      addDebugEvent({
        level: 'warn',
        scope: 'agent.scaffold',
        message: 'Empty/invalid scaffold response',
        data: { endpoint, provider: req.settings.provider, model: req.settings.model, res },
      });
      throw new Error(`Empty/invalid scaffold response from ${req.settings.provider}/${req.settings.model}`);
    }

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
    throw new Error(`HTTP scaffold failed for ${req.settings.provider}/${req.settings.model}: ${e instanceof Error ? e.message : String(e)}`);
  }
};

export const scaffoldProjectWithSettings = async (args: {
  intent: string;
  aspectRatio: AspectRatio;
  keyVisualUrl?: string;
  aiSettings: AiSettings;
  allowSingleFallback?: boolean;
}): Promise<ScaffoldProjectResponse> => {
  return scaffoldProject({
    intent: args.intent,
    aspectRatio: args.aspectRatio,
    keyVisualUrl: args.keyVisualUrl,
    settings: args.aiSettings.scaffoldWorker,
    plannerSettings: args.aiSettings.scaffoldPlanner,
    allowSingleFallback: args.allowSingleFallback,
  });
};
