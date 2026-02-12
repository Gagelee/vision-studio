import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelRuntimeSettings, Story } from '../../types';
import { buildAssetJobs, executeAssetJobs } from '../ai/assetExecutor';
import { applyPreflightReferenceAssignments } from './referenceAssignment';

const baseStory = (): Story => ({
  id: 'story-preflight-ref-test',
  title: 'Reference Binding Test',
  logline: 'Validate @character reference binding',
  intent: 'Test',
  styleGuide: '',
  keyVisualUrl: '',
  status: 'ready',
  aspectRatio: '16:9',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  lastOpenedAt: Date.now(),
  locations: [],
  characters: [
    {
      id: 'ch-1',
      name: 'Tian Yu',
      description: 'Lead character',
      looks: [],
    },
  ],
  sequences: [],
});

describe('applyPreflightReferenceAssignments', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('binds @character:tianyu to character "Tian Yu" and passes references into character generation', async () => {
    const story = applyPreflightReferenceAssignments(baseStory(), [
      {
        id: 'ref-1',
        url: 'https://example.com/ref-tianyu.jpg',
        name: 'tianyu-reference',
        assignedTo: 'character:tianyu',
      },
    ]);
    const ch = story.characters[0] as any;
    expect(Array.isArray(ch.referenceImages)).toBe(true);
    expect(ch.referenceImages.length).toBe(1);
    expect(ch.referenceImages[0].url).toBe('https://example.com/ref-tianyu.jpg');

    const postedBodies: any[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        postedBodies.push(body);
        return new Response(JSON.stringify({ imageUrl: 'https://example.com/out.png', debug: { transport: 'mock' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const imageSettings: ModelRuntimeSettings = {
      provider: 'gemini',
      model: 'mock-sim-image',
      temperature: 0.2,
      maxOutputTokens: 1024,
      baseUrl: 'http://127.0.0.1:3000',
    };

    await executeAssetJobs({
      jobs: buildAssetJobs(story, 'characters'),
      settings: imageSettings,
      aspectRatio: '16:9',
      concurrency: 1,
      getStoryForRefs: () => story,
      onEvent: () => {},
    });

    expect(postedBodies.length).toBeGreaterThan(0);
    const characterReq = postedBodies.find((b) => Array.isArray(b.references) && b.aspectRatio === '1:1');
    expect(characterReq).toBeTruthy();
    expect(characterReq.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://example.com/ref-tianyu.jpg',
        }),
      ]),
    );
  });
});

