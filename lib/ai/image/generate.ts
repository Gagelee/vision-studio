import { ModelRuntimeSettings, Shot } from '../../../types';
import { addDebugEvent } from '../../debug/eventLog';
import { buildShotImagePrompt } from '../prompts';

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

const fallbackUrl = () =>
  `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1964&auto=format&fit=crop&sig=${Math.floor(Math.random() * 100000)}`;

export const generateImageFromPrompt = async (req: {
  prompt: string;
  settings: ModelRuntimeSettings;
  aspectRatio?: string;
  references?: ImageReference[];
  strict?: boolean;
  requireAllReferences?: boolean;
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
    const timeout = setTimeout(() => controller.abort(), 60_000);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: String(req.prompt || ''),
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
    }).finally(() => clearTimeout(timeout));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as any;
    addDebugEvent({ level: 'info', scope: 'asset.image', message: 'Response', data });
    if (data?.debug?.transport === 'mock' && req.strict && req.settings.provider !== 'mock') {
      const err = data?.debug?.error ? String(data.debug.error) : 'Image generation fell back to mock transport.';
      throw new Error(err);
    }
    if (data?.imageUrl) return { imageUrl: String(data.imageUrl), debug: data.debug };
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
