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
  debug?: any;
}

const joinUrl = (baseUrl: string | undefined, pathname: string) => {
  const base = String(baseUrl || '').trim().replace(/\/$/, '');
  return base ? `${base}${pathname}` : pathname;
};

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
    if (!data?.videoUrl) throw new Error('Missing videoUrl in response');
    addDebugEvent({ level: 'info', scope: 'asset.video', message: 'Response', data });
    return { videoUrl: String(data.videoUrl), operationName: data.operationName ? String(data.operationName) : undefined, debug: data.debug };
  } catch (e) {
    addDebugEvent({
      level: 'error',
      scope: 'asset.video',
      message: 'Generate failed',
      data: { error: e instanceof Error ? e.message : String(e), debug: (e as any)?.debug },
    });
    throw e;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromExternal);
  }
};
