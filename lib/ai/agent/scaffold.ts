import { IMAGES, INITIAL_STORY } from '../../../constants';
import { AgentPlan, AiSettings, AspectRatio, ModelRuntimeSettings, Story } from '../../../types';
import { addDebugEvent } from '../../debug/eventLog';

export interface ScaffoldProjectRequest {
  intent: string;
  aspectRatio: AspectRatio;
  keyVisualUrl?: string;
  settings: ModelRuntimeSettings;
  plannerSettings?: ModelRuntimeSettings;
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
  };
}

const joinUrl = (baseUrl: string | undefined, pathname: string) => {
  const base = String(baseUrl || '').trim().replace(/\/$/, '');
  return base ? `${base}${pathname}` : pathname;
};

const isUsefulScaffold = (story: Story | undefined | null) => {
  if (!story) return false;
  const seqs = Array.isArray(story.sequences) ? story.sequences : [];
  const locs = Array.isArray(story.locations) ? story.locations : [];
  const chars = Array.isArray(story.characters) ? story.characters : [];
  const hasAnyShots = seqs.some((s) => Array.isArray(s.shots) && s.shots.length > 0);
  return hasAnyShots || locs.length > 0 || chars.length > 0;
};

const createMockProject = (intent: string, aspectRatio: AspectRatio, keyVisualUrl?: string): ScaffoldProjectResponse => {
  const now = Date.now();
  const id = `proj-${now}`;
  const title = intent.trim().split(/\s+/).slice(0, 4).join(' ') || 'New Masterpiece';

  const story: Story = {
    ...JSON.parse(JSON.stringify(INITIAL_STORY)),
    id,
    title,
    intent,
    logline: `An AI-directed story based on: "${intent.trim()}"`,
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
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      addDebugEvent({ level: 'error', scope: 'agent.scaffold', message: 'HTTP error', data: { url, status: res.status, text } });
      throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ''}`);
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
    return createMockProject(req.intent, req.aspectRatio, req.keyVisualUrl);
  }

  const endpoint = joinUrl(req.settings.baseUrl, '/api/agent/scaffold');

  try {
    const res = await postJson<ScaffoldProjectResponse>(
      endpoint,
      {
        intent: req.intent,
        aspectRatio: req.aspectRatio,
        keyVisualUrl: req.keyVisualUrl,
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
      60_000
    );
    // Some transports may return "ok" wrappers or empty scaffolds; ensure the UI always receives something usable.
    if (!isUsefulScaffold((res as any)?.story) || !(res as any)?.plan) {
      addDebugEvent({
        level: 'warn',
        scope: 'agent.scaffold',
        message: 'Empty/invalid scaffold response; falling back to local mock',
        data: { endpoint, provider: req.settings.provider, model: req.settings.model, res },
      });
      const fallback = createMockProject(req.intent, req.aspectRatio, req.keyVisualUrl);
      return {
        ...fallback,
        debug: {
          transport: 'http',
          provider: req.settings.provider,
          model: req.settings.model,
          endpoint,
          error: 'Empty/invalid scaffold response; fell back to local mock.',
        },
      };
    }
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
    const fallback = createMockProject(req.intent, req.aspectRatio, req.keyVisualUrl);
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

export const scaffoldProjectWithSettings = async (args: {
  intent: string;
  aspectRatio: AspectRatio;
  keyVisualUrl?: string;
  aiSettings: AiSettings;
}): Promise<ScaffoldProjectResponse> => {
  return scaffoldProject({
    intent: args.intent,
    aspectRatio: args.aspectRatio,
    keyVisualUrl: args.keyVisualUrl,
    settings: args.aiSettings.scaffoldWorker,
    plannerSettings: args.aiSettings.scaffoldPlanner,
  });
};
