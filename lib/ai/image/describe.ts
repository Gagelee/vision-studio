import { addDebugEvent } from '../../debug/eventLog';
import { getVisionUserRequestHeaders } from '../../userSession';

export type ImageDescribeResult = {
  description: string;
  keySubjects?: string[];
  environment?: string;
  composition?: string;
  camera?: string;
  lighting?: string;
  style?: string;
  constraints?: string[];
};

export const describeImageForRefine = async (args: { imageUrl: string; signal?: AbortSignal }) => {
  const imageUrl = String(args.imageUrl || '').trim();
  if (!imageUrl) throw new Error('Missing imageUrl');
  const endpoint = '/api/asset/image/describe';
  addDebugEvent({
    level: 'info',
    scope: 'asset.image',
    message: 'POST /api/asset/image/describe',
    data: { endpoint, imageUrlPreview: imageUrl.slice(0, 160) },
  });
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: getVisionUserRequestHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ imageUrl }),
    signal: args.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Describe failed (HTTP ${res.status})${text ? `: ${text}` : ''}`);
  }
  const json = (await res.json().catch(() => null)) as any;
  if (!json?.ok) throw new Error(String(json?.error || 'Describe failed'));
  const out = json?.describe as ImageDescribeResult;
  if (!out || typeof out.description !== 'string') throw new Error('Describe failed: missing description');
  addDebugEvent({ level: 'info', scope: 'asset.image', message: 'Describe response', data: { describe: out } });
  return out;
};
