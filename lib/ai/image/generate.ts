import { ModelRuntimeSettings, Shot } from '../../types';
import { addDebugEvent } from '../../debug/eventLog';

export interface GenerateShotImageRequest {
  shot: Shot;
  settings: ModelRuntimeSettings;
  aspectRatio?: string;
}

export interface GenerateShotImageResponse {
  imageUrl: string;
  debug?: any;
}

const fallbackUrl = () =>
  `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1964&auto=format&fit=crop&sig=${Math.floor(Math.random() * 100000)}`;

export const generateShotImage = async (req: GenerateShotImageRequest): Promise<GenerateShotImageResponse> => {
  try {
    addDebugEvent({
      level: 'info',
      scope: 'asset.image',
      message: 'POST /api/asset/image/generate',
      data: {
        settings: { provider: req.settings.provider, model: req.settings.model, temperature: req.settings.temperature },
        promptPreview: buildPrompt(req.shot).slice(0, 120),
      },
    });
    const res = await fetch('/api/asset/image/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: buildPrompt(req.shot),
        aspectRatio: req.aspectRatio,
        settings: {
          provider: req.settings.provider,
          model: req.settings.model,
          temperature: req.settings.temperature,
          maxOutputTokens: req.settings.maxOutputTokens,
        },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as any;
    addDebugEvent({ level: 'info', scope: 'asset.image', message: 'Response', data });
    if (data?.imageUrl) return { imageUrl: String(data.imageUrl), debug: data.debug };
    return { imageUrl: fallbackUrl(), debug: { error: 'missing imageUrl' } };
  } catch (e) {
    addDebugEvent({ level: 'error', scope: 'asset.image', message: 'Generate failed', data: { error: e instanceof Error ? e.message : String(e) } });
    return { imageUrl: fallbackUrl(), debug: { error: e instanceof Error ? e.message : String(e) } };
  }
};

const buildPrompt = (shot: Shot) => {
  const parts = [
    shot.description,
    `Time: ${shot.timeOfDay}`,
    `Camera: ${shot.elements?.CAMERA?.prompt || ''}`,
    `Lighting: ${shot.elements?.LIGHTING?.prompt || ''}`,
    `Audio: ${shot.elements?.AUDIO?.prompt || ''}`,
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  return parts.join('\n');
};
