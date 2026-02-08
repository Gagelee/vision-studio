import { AspectRatio } from '../../../types';
import { addDebugEvent } from '../../debug/eventLog';

export interface GenerateVideoFromImageRequest {
  prompt: string;
  imageUrl: string;
  durationSeconds: 4 | 6 | 8;
  aspectRatio?: AspectRatio;
  resolution?: '720p';
  generateAudio?: boolean;
  model?: string;
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
    },
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12 * 60_000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: String(req.prompt || ''),
        imageUrl: String(req.imageUrl || ''),
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
      const text = await res.text();
      throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ''}`);
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
      data: { error: e instanceof Error ? e.message : String(e) },
    });
    throw e;
  } finally {
    clearTimeout(timeout);
  }
};
