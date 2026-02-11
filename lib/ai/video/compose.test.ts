import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeVideoPromptWithLlm } from './compose';

const jsonResponse = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('composeVideoPromptWithLlm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns composed prompt on success', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        videoPrompt: 'Composed cinematic prompt with dialogue.',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await composeVideoPromptWithLlm({
      basePrompt: 'base prompt',
      sourceKind: 'stack',
      frameDescription: 'Rainy alley.',
      dialogue: ['LINA: "Run!"'],
      referenceFrames: [{ panelIndex: 0, description: 'Chen draws his gun.' }],
    });
    expect(out.videoPrompt).toContain('Composed cinematic prompt');
  });

  it('throws when API returns error payload', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(502, { ok: false, error: 'gateway timeout' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      composeVideoPromptWithLlm({
        basePrompt: 'base prompt',
      }),
    ).rejects.toThrow(/Compose failed/);
  });
});

