import { AspectRatio } from '../../../types';
import { addDebugEvent } from '../../debug/eventLog';
import { getVisionUserRequestHeaders } from '../../userSession';

export interface GenerateVideoFromImageRequest {
  prompt: string;
  imageUrl: string;
  referenceImageUrls?: string[];
  durationSeconds: 4 | 6 | 8;
  aspectRatio?: AspectRatio;
  resolution?: '720p';
  generateAudio?: boolean;
  model?: string;
  signal?: AbortSignal;
  onTaskAccepted?: (task: { taskId: string; statusUrl: string }) => void;
  promptSpec?: {
    shotDescription?: string;
    action?: string;
    style?: string;
    styleTranslation?: string;
    camera?: string;
    composition?: string;
    lensEffect?: string;
    mood?: string;
    audio?: string;
    frameDescription?: string;
    actingDirection?: string;
    storyContext?: string;
    dialogue?: string[];
    cameraman?: string;
    directorNotes?: string;
    referenceFrames?: Array<{ url: string; description?: string; panelIndex?: number }>;
    constraints?: string[];
  };
}

export interface GenerateVideoFromImageResponse {
  videoUrl: string;
  operationName?: string;
  taskId?: string;
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

const isAbortError = (e: unknown) => {
  if (e instanceof DOMException && e.name === 'AbortError') return true;
  const msg = String((e as any)?.message || '').toLowerCase();
  return msg.includes('abort');
};

const sleepWithSignal = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export const generateVideoFromImage = async (
  req: GenerateVideoFromImageRequest & { baseUrl?: string },
): Promise<GenerateVideoFromImageResponse> => {
  const endpoint = joinUrl(req.baseUrl, '/api/asset/video/generate');
  addDebugEvent({
    level: 'info',
    scope: 'asset.video',
    message: 'POST /api/asset/video/generate',
    data: {
      endpoint,
      durationSeconds: req.durationSeconds,
      aspectRatio: req.aspectRatio,
      resolution: req.resolution || '720p',
      hasPrompt: Boolean(String(req.prompt || '').trim()),
      imageUrlPreview: String(req.imageUrl || '').slice(0, 160),
      referenceImageCount: Array.isArray(req.referenceImageUrls) ? req.referenceImageUrls.length : 0,
    },
  });

  const controller = new AbortController();
  const externalSignal = req.signal;
  const abortFromExternal = () => controller.abort((externalSignal as any)?.reason || new DOMException('Aborted', 'AbortError'));
  if (externalSignal?.aborted) abortFromExternal();
  externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  const timeout = setTimeout(() => controller.abort(), 12 * 60_000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: getVisionUserRequestHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        prompt: String(req.prompt || ''),
        imageUrl: String(req.imageUrl || ''),
        async: true,
        referenceImageUrls: Array.isArray(req.referenceImageUrls) ? req.referenceImageUrls : [],
        durationSeconds: req.durationSeconds,
        aspectRatio: req.aspectRatio || '16:9',
        resolution: req.resolution || '720p',
        generateAudio: Boolean(req.generateAudio),
        model: req.model || '',
        promptSpec: req.promptSpec || undefined,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const ct = String(res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('application/json')) {
        const data = (await res.json().catch(() => null)) as any;
        addDebugEvent({ level: 'error', scope: 'asset.video', message: 'Response error', data });
        const code = String(data?.code || '').trim();
        if (code === 'RAI_MEDIA_FILTERED') {
          const reasons = Array.isArray(data?.debug?.raiReasons)
            ? data.debug.raiReasons.map((x: any) => String(x || '').trim()).filter(Boolean)
            : [];
          const reasonText = reasons.length ? ` (${reasons.join(', ')})` : '';
          throw new Error(`Provider safety filter blocked this video${reasonText}. Try softer/non-sensitive action wording and regenerate.`);
        }
        const detail = String(data?.error || '').trim();
        const err: any = new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
        err.status = res.status;
        if (data?.debug && typeof data.debug === 'object') err.debug = data.debug;
        throw err;
      }
      const text = await res.text();
      const err: any = new Error(`HTTP ${res.status}${text ? `: ${text}` : ''}`);
      err.status = res.status;
      throw err;
    }
    const data = (await res.json()) as any;
    if (data?.videoUrl) {
      addDebugEvent({ level: 'info', scope: 'asset.video', message: 'Response (sync)', data });
      return {
        videoUrl: String(data.videoUrl),
        operationName: data.operationName ? String(data.operationName) : undefined,
        taskId: data.taskId ? String(data.taskId) : undefined,
        debug: data.debug,
      };
    }

    // Async mode: server accepted task and returns taskId + status URL.
    if (res.status === 202 && data?.accepted && data?.taskId && data?.statusUrl) {
      const taskId = String(data.taskId || '').trim();
      const statusUrl = joinPossiblyRelativeUrl(req.baseUrl, String(data.statusUrl || '').trim());
      if (!taskId || !statusUrl) throw new Error('Video task accepted but missing taskId/statusUrl');
      req.onTaskAccepted?.({ taskId, statusUrl });
      addDebugEvent({
        level: 'info',
        scope: 'asset.video',
        message: 'Async task accepted',
        data: { taskId, statusUrl },
      });

      const pollTimeoutMs = 20 * 60_000;
      const pollIntervalMs = 2_000;
      const pollStartedAt = Date.now();
      let consecutivePollErrors = 0;
      const maxConsecutivePollErrors = 6;
      while (true) {
        if (Date.now() - pollStartedAt > pollTimeoutMs) {
          const err: any = new Error(`Video task timeout after ${Math.round(pollTimeoutMs / 1000)}s`);
          err.taskId = taskId;
          throw err;
        }
        await sleepWithSignal(pollIntervalMs, controller.signal);
        try {
          const statusRes = await fetch(statusUrl, {
            method: 'GET',
            headers: getVisionUserRequestHeaders(),
            signal: controller.signal,
          });
          if (!statusRes.ok) {
            if (statusRes.status === 404) {
              const err: any = new Error('Video task not found');
              err.code = 'PIPELINE_TASK_NOT_FOUND';
              err.taskId = taskId;
              throw err;
            }
            const text = await statusRes.text().catch(() => '');
            throw new Error(`Task status fetch failed (HTTP ${statusRes.status})${text ? `: ${text}` : ''}`);
          }
          const statusJson = (await statusRes.json().catch(() => null)) as any;
          const task = statusJson?.task;
          const status = String(task?.status || '').toLowerCase();
          consecutivePollErrors = 0;
          if (!status) continue;
          addDebugEvent({
            level: 'info',
            scope: 'asset.video',
            message: 'Async task poll',
            data: { taskId, status, attempts: task?.attempts, endedAt: task?.endedAt },
          });
          if (status === 'queued' || status === 'running') continue;
          if (status === 'success') {
            const videoUrl = String(task?.result?.videoUrl || '').trim();
            if (!videoUrl) throw new Error('Video task completed without videoUrl');
            return {
              videoUrl,
              operationName: String(task?.result?.operationName || '').trim() || undefined,
              taskId,
              debug: { ...(task?.result || {}), task },
            };
          }
          if (status === 'failed') {
            const errText = String(task?.error || 'Video task failed');
            const err: any = new Error(errText);
            err.taskId = taskId;
            err.task = task;
            throw err;
          }
        } catch (pollErr) {
          if (pollErr instanceof DOMException && pollErr.name === 'AbortError') throw pollErr;
          const code = String((pollErr as any)?.code || '').trim();
          if (code === 'PIPELINE_TASK_NOT_FOUND') throw pollErr;
          consecutivePollErrors += 1;
          if (consecutivePollErrors >= maxConsecutivePollErrors) {
            const err: any = new Error(
              `Video task status polling failed (${consecutivePollErrors} consecutive errors): ${String((pollErr as any)?.message || pollErr)}`,
            );
            err.taskId = taskId;
            throw err;
          }
        }
      }
    }

    throw new Error('Missing videoUrl in response');
  } catch (e) {
    addDebugEvent({
      level: 'error',
      scope: 'asset.video',
      message: 'Generate failed',
      data: { error: e instanceof Error ? e.message : String(e), debug: (e as any)?.debug },
    });
    if (isAbortError(e)) {
      const err: any = new Error('Video task aborted');
      err.name = 'AbortError';
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromExternal);
  }
};
