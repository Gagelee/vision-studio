import { addDebugEvent } from '../../debug/eventLog';
import { getVisionUserRequestHeaders } from '../../userSession';

export interface ComposeVideoPromptRequest {
  basePrompt: string;
  sourceKind?: 'single' | 'stack';
  frameDescription?: string;
  shotAction?: string;
  shotDescription?: string;
  sequenceContext?: string;
  cameraPrompt?: string;
  lightingPrompt?: string;
  styleGuide?: string;
  locationStyle?: string;
  dialogue?: string[];
  referenceFrames?: Array<{ panelIndex?: number; description?: string; url?: string }>;
  signal?: AbortSignal;
}

export interface ComposeVideoPromptResponse {
  videoPrompt: string;
  usage?: { promptTokens?: number; outputTokens?: number; totalTokens?: number };
  debug?: any;
}

const joinUrl = (baseUrl: string | undefined, pathname: string) => {
  const base = String(baseUrl || '').trim().replace(/\/$/, '');
  return base ? `${base}${pathname}` : pathname;
};

export const composeVideoPromptWithLlm = async (
  req: ComposeVideoPromptRequest & { baseUrl?: string },
): Promise<ComposeVideoPromptResponse> => {
  const endpoint = joinUrl(req.baseUrl, '/api/asset/video/prompt/compose');
  const basePrompt = String(req.basePrompt || '').trim();
  if (!basePrompt) throw new Error('Missing basePrompt');
  addDebugEvent({
    level: 'info',
    scope: 'video.prompt',
    message: 'POST /api/asset/video/prompt/compose',
    data: {
      endpoint,
      sourceKind: String(req.sourceKind || 'single'),
      hasFrameDescription: Boolean(String(req.frameDescription || '').trim()),
      referenceFrameCount: Array.isArray(req.referenceFrames) ? req.referenceFrames.length : 0,
    },
  });
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: getVisionUserRequestHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      basePrompt,
      sourceKind: String(req.sourceKind || 'single') === 'stack' ? 'stack' : 'single',
      frameDescription: String(req.frameDescription || ''),
      shotAction: String(req.shotAction || ''),
      shotDescription: String(req.shotDescription || ''),
      sequenceContext: String(req.sequenceContext || ''),
      cameraPrompt: String(req.cameraPrompt || ''),
      lightingPrompt: String(req.lightingPrompt || ''),
      styleGuide: String(req.styleGuide || ''),
      locationStyle: String(req.locationStyle || ''),
      dialogue: Array.isArray(req.dialogue) ? req.dialogue : [],
      referenceFrames: Array.isArray(req.referenceFrames) ? req.referenceFrames : [],
    }),
    signal: req.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Compose failed (HTTP ${res.status})${text ? `: ${text}` : ''}`);
  }
  const json = (await res.json().catch(() => null)) as any;
  if (!json?.ok) throw new Error(String(json?.error || 'Compose failed'));
  const videoPrompt = String(json?.videoPrompt || '').trim();
  if (!videoPrompt) throw new Error('Compose failed: missing videoPrompt');
  addDebugEvent({
    level: 'info',
    scope: 'video.prompt',
    message: 'Compose response',
    data: { hasVideoPrompt: true, usage: json?.usage, debug: json?.debug },
  });
  return { videoPrompt, usage: json?.usage, debug: json?.debug };
};

