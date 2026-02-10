import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Story } from '../../types';

vi.mock('./image/generate', () => ({
  generateImageFromPrompt: vi.fn(),
}));

import { generateImageFromPrompt } from './image/generate';
import {
  applyAssetError,
  applyAssetResult,
  applyAssetStart,
  applyAssetTaskBinding,
  executeAssetJobs,
  type AssetJobEvent,
} from './assetExecutor';

const mockedGenerate = vi.mocked(generateImageFromPrompt);

const makeStory = (): Story =>
  ({
    id: 'proj-c1',
    title: 'Concurrent',
    logline: 'L',
    intent: 'I',
    styleGuide: '',
    aspectRatio: '16:9',
    status: 'draft',
    keyVisualUrl: '',
    locations: [
      {
        id: 'loc-1',
        name: 'Set',
        description: 'desc',
        visualStyle: '',
        previewUrl: '/__generated__/loc.png',
        previewVersions: [{ id: 'pv-1', imageUrl: '/__generated__/loc.png', createdAt: 1, type: 'base' }],
        activePreviewVersionId: 'pv-1',
        status: 'draft',
        assetState: { status: 'done' },
      },
    ],
    characters: [],
    sequences: [
      {
        id: 'seq-1',
        title: 'Seq',
        context: '',
        scenes: [
          {
            id: 'scene-1',
            title: 'Scene',
            shots: [
              {
                id: 'shot-a',
                sequence: 1,
                locationId: 'loc-1',
                timeOfDay: 'Night',
                description: 'Shot A',
                duration: 4,
                thumbnailUrl: '/__generated__/ph-a.png',
                activeVersionId: 'v1',
                versions: [{ id: 'v1', imageUrl: '/__generated__/ph-a.png', createdAt: 1, type: 'placeholder' }],
                elements: {
                  SCRIPT: { type: 'SCRIPT', prompt: '', status: 'auto' },
                  CASTING: { type: 'CASTING', prompt: '', status: 'manual', metadata: { characters: [] } },
                  CAMERA: { type: 'CAMERA', prompt: '', status: 'auto' },
                  LIGHTING: { type: 'LIGHTING', prompt: '', status: 'auto' },
                  AUDIO: { type: 'AUDIO', prompt: '', status: 'auto' },
                },
                aiState: 'idle',
                assetState: { status: 'idle' },
              },
              {
                id: 'shot-b',
                sequence: 2,
                locationId: 'loc-1',
                timeOfDay: 'Night',
                description: 'Shot B',
                duration: 4,
                thumbnailUrl: '/__generated__/ph-b.png',
                activeVersionId: 'v1',
                versions: [{ id: 'v1', imageUrl: '/__generated__/ph-b.png', createdAt: 1, type: 'placeholder' }],
                elements: {
                  SCRIPT: { type: 'SCRIPT', prompt: '', status: 'auto' },
                  CASTING: { type: 'CASTING', prompt: '', status: 'manual', metadata: { characters: [] } },
                  CAMERA: { type: 'CAMERA', prompt: '', status: 'auto' },
                  LIGHTING: { type: 'LIGHTING', prompt: '', status: 'auto' },
                  AUDIO: { type: 'AUDIO', prompt: '', status: 'auto' },
                },
                aiState: 'idle',
                assetState: { status: 'idle' },
              },
            ],
          },
        ],
        shots: [
          {
            id: 'shot-a',
            sequence: 1,
            locationId: 'loc-1',
            timeOfDay: 'Night',
            description: 'Shot A',
            duration: 4,
            thumbnailUrl: '/__generated__/ph-a.png',
            activeVersionId: 'v1',
            versions: [{ id: 'v1', imageUrl: '/__generated__/ph-a.png', createdAt: 1, type: 'placeholder' }],
            elements: {
              SCRIPT: { type: 'SCRIPT', prompt: '', status: 'auto' },
              CASTING: { type: 'CASTING', prompt: '', status: 'manual', metadata: { characters: [] } },
              CAMERA: { type: 'CAMERA', prompt: '', status: 'auto' },
              LIGHTING: { type: 'LIGHTING', prompt: '', status: 'auto' },
              AUDIO: { type: 'AUDIO', prompt: '', status: 'auto' },
            },
            aiState: 'idle',
            assetState: { status: 'idle' },
          },
          {
            id: 'shot-b',
            sequence: 2,
            locationId: 'loc-1',
            timeOfDay: 'Night',
            description: 'Shot B',
            duration: 4,
            thumbnailUrl: '/__generated__/ph-b.png',
            activeVersionId: 'v1',
            versions: [{ id: 'v1', imageUrl: '/__generated__/ph-b.png', createdAt: 1, type: 'placeholder' }],
            elements: {
              SCRIPT: { type: 'SCRIPT', prompt: '', status: 'auto' },
              CASTING: { type: 'CASTING', prompt: '', status: 'manual', metadata: { characters: [] } },
              CAMERA: { type: 'CAMERA', prompt: '', status: 'auto' },
              LIGHTING: { type: 'LIGHTING', prompt: '', status: 'auto' },
              AUDIO: { type: 'AUDIO', prompt: '', status: 'auto' },
            },
            aiState: 'idle',
            assetState: { status: 'idle' },
          },
        ],
      },
    ],
  } as any);

describe('assetExecutor concurrent shot jobs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockedGenerate.mockReset();
  });

  it('keeps later successful shots linked after one shot fails', async () => {
    let storyRef = makeStory();
    const events: AssetJobEvent[] = [];

    let callNo = 0;
    mockedGenerate.mockImplementation(async (req: any) => {
      callNo += 1;
      if (callNo === 1) {
        req?.onTaskAccepted?.({ taskId: 'task-shot-a', statusUrl: '/api/pipeline/tasks/task-shot-a' });
        throw new Error('shot-a failed');
      }
      req?.onTaskAccepted?.({ taskId: 'task-shot-b', statusUrl: '/api/pipeline/tasks/task-shot-b' });
      return { imageUrl: '/__generated__/shot-b-ok.png', debug: { taskId: 'task-shot-b', statusUrl: '/api/pipeline/tasks/task-shot-b' } };
    });

    const jobs: any[] = [
      { kind: 'shot', sequenceId: 'seq-1', shot: { id: 'shot-a' } },
      { kind: 'shot', sequenceId: 'seq-1', shot: { id: 'shot-b' } },
    ];

    const applyEvent = (ev: AssetJobEvent) => {
      events.push(ev);
      if (ev.type === 'start') storyRef = applyAssetStart(storyRef, ev.job);
      if (ev.type === 'task') storyRef = applyAssetTaskBinding(storyRef, ev.job, { taskId: ev.taskId, statusUrl: ev.statusUrl });
      if (ev.type === 'success') storyRef = applyAssetResult(storyRef, ev.job, ev.imageUrl, ev.meta);
      if (ev.type === 'error') storyRef = applyAssetError(storyRef, ev.job, ev.error);
    };

    const out = await executeAssetJobs({
      jobs: jobs as any,
      settings: { provider: 'gemini', model: 'gemini-3-flash-preview', temperature: 0.5, maxOutputTokens: 2048 } as any,
      aspectRatio: '16:9',
      concurrency: 2,
      maxAttempts: 1,
      stopAfterMasterKvFailure: false,
      getStoryForRefs: () => storyRef,
      onEvent: applyEvent,
    });

    expect(out.total).toBe(2);
    expect(out.done).toBe(2);
    expect(out.errors).toBe(1);
    expect(events.some((ev) => ev.type === 'success' && (ev.job as any)?.shot?.id === 'shot-b')).toBe(true);
    expect(events.some((ev) => ev.type === 'error' && (ev.job as any)?.shot?.id === 'shot-a')).toBe(true);

    const seq = (storyRef.sequences || [])[0] as any;
    const shotA = (seq?.shots || []).find((s: any) => s.id === 'shot-a');
    const shotB = (seq?.shots || []).find((s: any) => s.id === 'shot-b');
    expect(String(shotA?.assetState?.status || '')).toBe('error');
    expect(String(shotA?.assetState?.pipelineTaskId || '')).toBe('task-shot-a');
    expect(String(shotB?.assetState?.status || '')).toBe('done');
    expect(String(shotB?.thumbnailUrl || '')).toBe('/__generated__/shot-b-ok.png');
    expect(String(shotB?.assetState?.pipelineTaskId || '')).toBe('');
  });
});
