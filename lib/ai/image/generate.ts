import { ModelRuntimeSettings, Shot } from '../../../types';
import { addDebugEvent } from '../../debug/eventLog';
import { buildShotImagePrompt } from '../prompts';
import { getVisionUserRequestHeaders } from '../../userSession';

export interface ImageReference {
  url: string;
  label?: string;
}

export interface GenerateShotImageRequest {
  shot: Shot;
  settings: ModelRuntimeSettings;
  aspectRatio?: string;
}

export interface GenerateShotImageResponse {
  imageUrl: string;
  debug?: any;
}

const joinUrl = (baseUrl: string | undefined, pathname: string) => {
  const base = String(baseUrl || '').trim().replace(/\/$/, '');
  return base ? `${base}${pathname}` : pathname;
};

const joinPossiblyRelativeUrl = (baseUrl: string | undefined, maybeRelative: string) => {
  const raw = String(maybeRelative || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return joinUrl(baseUrl, raw.startsWith('/') ? raw : `/${raw}`);
};

const fallbackUrl = () =>
  `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1964&auto=format&fit=crop&sig=${Math.floor(Math.random() * 100000)}`;

export const generateImageFromPrompt = async (req: {
  prompt: string;
  settings: ModelRuntimeSettings;
  aspectRatio?: string;
  references?: ImageReference[];
  promptSpec?: any;
  composePrompt?: boolean;
  composeSettings?: {
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
  };
  signal?: AbortSignal;
  strict?: boolean;
  requireAllReferences?: boolean;
  async?: boolean;
  onTaskAccepted?: (task: { taskId: string; statusUrl: string }) => void;
}): Promise<GenerateShotImageResponse> => {
  try {
    const endpoint = joinUrl(req.settings.baseUrl, '/api/asset/image/generate');
    addDebugEvent({
      level: 'info',
      scope: 'asset.image',
      message: 'POST /api/asset/image/generate',
      data: {
        endpoint,
        settings: { provider: req.settings.provider, model: req.settings.model, temperature: req.settings.temperature },
        promptPreview: String(req.prompt || '').slice(0, 120),
        references: Array.isArray(req.references) ? req.references.map((r) => ({ url: r.url, label: r.label })) : [],
        requireAllReferences: Boolean(req.requireAllReferences),
      },
    });
    const controller = new AbortController();
    const externalSignal = req.signal;
    const abortFromExternal = () => controller.abort((externalSignal as any)?.reason || new DOMException('Aborted', 'AbortError'));
    if (externalSignal?.aborted) abortFromExternal();
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
    const timeoutMs = 180_000;
    const timeout = setTimeout(
      () => controller.abort(new Error(`Image generation timeout after ${Math.round(timeoutMs / 1000)}s`)),
      timeoutMs,
    );
    const requestAsync = req.async !== false;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: getVisionUserRequestHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        prompt: String(req.prompt || ''),
        async: requestAsync,
        promptSpec: req.promptSpec,
        composePrompt: Boolean(req.composePrompt),
        composeSettings: req.composeSettings,
        aspectRatio: req.aspectRatio,
        references: Array.isArray(req.references) ? req.references : [],
        requireAllReferences: Boolean(req.requireAllReferences),
        settings: {
          provider: req.settings.provider,
          model: req.settings.model,
          temperature: req.settings.temperature,
          maxOutputTokens: req.settings.maxOutputTokens,
        },
      }),
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const headerTaskId = String(res.headers.get('x-vision-task-id') || '').trim();
    const data = (await res.json()) as any;
    addDebugEvent({ level: 'info', scope: 'asset.image', message: 'Response', data });

    if (res.status === 202 && data?.accepted && data?.taskId && data?.statusUrl) {
      const taskId = String(data.taskId || '').trim();
      const statusUrl = joinPossiblyRelativeUrl(req.settings.baseUrl, String(data.statusUrl || '').trim());
      if (!taskId || !statusUrl) throw new Error('Image task accepted but missing taskId/statusUrl');
      req.onTaskAccepted?.({ taskId, statusUrl });
      addDebugEvent({
        level: 'info',
        scope: 'asset.image',
        message: 'Async task accepted',
        data: { taskId, statusUrl },
      });

      const pollTimeoutMs = 20 * 60_000;
      const pollIntervalMs = 2_000;
      const pollStartedAt = Date.now();
      let consecutivePollErrors = 0;
      const maxConsecutivePollErrors = 6;
      const fetchTaskStatusOnce = async () => {
        const statusRes = await fetch(statusUrl, {
          method: 'GET',
          headers: getVisionUserRequestHeaders(),
        });
        if (!statusRes.ok) return null;
        const statusJson = (await statusRes.json().catch(() => null)) as any;
        const task = statusJson?.task;
        const status = String(task?.status || '').toLowerCase();
        if (status !== 'success') return null;
        const imageUrl = String(task?.result?.imageUrl || '').trim();
        if (!imageUrl) return null;
        return {
          imageUrl,
          debug: { ...(task?.result?.debug || {}), taskId, statusUrl, task, reconciledAfterPollError: true },
        } as GenerateShotImageResponse;
      };
      while (true) {
        if (Date.now() - pollStartedAt > pollTimeoutMs) {
          const recovered = await fetchTaskStatusOnce().catch(() => null);
          if (recovered) return recovered;
          const err: any = new Error(`Image task timeout after ${Math.round(pollTimeoutMs / 1000)}s`);
          err.taskId = taskId;
          err.statusUrl = statusUrl;
          throw err;
        }
        await new Promise<void>((resolve, reject) => {
          const onDone = () => {
            controller.signal.removeEventListener('abort', onAbort);
            resolve();
          };
          const timer = setTimeout(onDone, pollIntervalMs);
          const onAbort = () => {
            clearTimeout(timer);
            controller.signal.removeEventListener('abort', onAbort);
            reject(new DOMException('Aborted', 'AbortError'));
          };
          if (controller.signal.aborted) return onAbort();
          controller.signal.addEventListener('abort', onAbort, { once: true });
        });
        try {
          const statusRes = await fetch(statusUrl, {
            method: 'GET',
            headers: getVisionUserRequestHeaders(),
            signal: controller.signal,
          });
          if (!statusRes.ok) {
            if (statusRes.status === 404) {
              const err: any = new Error('Image task not found');
              err.code = 'PIPELINE_TASK_NOT_FOUND';
              err.taskId = taskId;
              err.statusUrl = statusUrl;
              throw err;
            }
            throw new Error(`Task status fetch failed (HTTP ${statusRes.status})`);
          }
          const statusJson = (await statusRes.json().catch(() => null)) as any;
          const task = statusJson?.task;
          const status = String(task?.status || '').toLowerCase();
          consecutivePollErrors = 0;
          if (!status || status === 'queued' || status === 'running') continue;
          if (status === 'success') {
            const imageUrl = String(task?.result?.imageUrl || '').trim();
            if (!imageUrl) throw new Error('Image task completed without imageUrl');
            return {
              imageUrl,
              debug: { ...(task?.result?.debug || {}), taskId, statusUrl, task },
            };
          }
          if (status === 'failed') {
            const err: any = new Error(String(task?.error || 'Image task failed'));
            err.taskId = taskId;
            err.statusUrl = statusUrl;
            err.task = task;
            throw err;
          }
        } catch (pollErr) {
          if (pollErr instanceof DOMException && pollErr.name === 'AbortError') throw pollErr;
          const code = String((pollErr as any)?.code || '').trim();
          if (code === 'PIPELINE_TASK_NOT_FOUND') throw pollErr;
          consecutivePollErrors += 1;
          if (consecutivePollErrors >= maxConsecutivePollErrors) {
            const recovered = await fetchTaskStatusOnce().catch(() => null);
            if (recovered) return recovered;
            const err: any = new Error(
              `Image task status polling failed (${consecutivePollErrors} consecutive errors): ${String((pollErr as any)?.message || pollErr)}`,
            );
            err.taskId = taskId;
            err.statusUrl = statusUrl;
            throw err;
          }
        }
      }
    }

    if (data?.debug?.transport === 'mock' && req.strict && req.settings.provider !== 'mock') {
      const err = data?.debug?.error ? String(data.debug.error) : 'Image generation fell back to mock transport.';
      throw new Error(err);
    }
    if (data?.imageUrl) {
      return {
        imageUrl: String(data.imageUrl),
        debug: {
          ...(data.debug || {}),
          ...(headerTaskId ? { taskId: headerTaskId } : {}),
        },
      };
    }
    return { imageUrl: fallbackUrl(), debug: { error: 'missing imageUrl' } };
  } catch (e) {
    addDebugEvent({ level: 'error', scope: 'asset.image', message: 'Generate failed', data: { error: e instanceof Error ? e.message : String(e) } });
    if (req.strict && req.settings.provider !== 'mock') throw e;
    return { imageUrl: fallbackUrl(), debug: { error: e instanceof Error ? e.message : String(e) } };
  }
};

export const generateShotImage = async (req: GenerateShotImageRequest): Promise<GenerateShotImageResponse> => {
  return generateImageFromPrompt({
    prompt: buildShotImagePrompt(req.shot),
    settings: req.settings,
    aspectRatio: req.aspectRatio,
  });
};
