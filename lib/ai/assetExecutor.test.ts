import { describe, expect, it } from 'vitest';
import { applyAssetResult, applyAssetStart, type AssetJob } from './assetExecutor';

const UNSPLASH_PLACEHOLDER =
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1964&auto=format&fit=crop&sig=123';

const makeShot = (id: string, n: number) => ({
  id,
  sequence: n,
  locationId: 'loc-1',
  timeOfDay: 'Night',
  description: `Shot ${n}`,
  duration: 4 as const,
  thumbnailUrl: UNSPLASH_PLACEHOLDER,
  activeVersionId: 'v1',
  versions: [{ id: 'v1', imageUrl: UNSPLASH_PLACEHOLDER, createdAt: 1, type: 'placeholder' as const }],
  elements: {
    SCRIPT: { type: 'SCRIPT', prompt: '', status: 'auto' as const },
    CASTING: { type: 'CASTING', prompt: '', status: 'manual' as const, metadata: { characters: [] } },
    CAMERA: { type: 'CAMERA', prompt: '', status: 'auto' as const },
    LIGHTING: { type: 'LIGHTING', prompt: '', status: 'auto' as const },
    AUDIO: { type: 'AUDIO', prompt: '', status: 'auto' as const },
  },
  aiState: 'idle' as const,
});

describe('assetExecutor shot state sync', () => {
  it('updates completed keyframe immediately while other pending shot stays placeholder', () => {
    const shotA = makeShot('shot-a', 1);
    const shotB = makeShot('shot-b', 2);
    const story: any = {
      id: 'proj-1',
      title: 'T',
      logline: 'L',
      intent: 'I',
      styleGuide: '',
      aspectRatio: '16:9',
      status: 'ready',
      locations: [],
      characters: [],
      sequences: [
        {
          id: 'seq-1',
          title: 'S1',
          context: '',
          scenes: [{ id: 'scene-1', title: 'Scene 1', shots: [shotA, shotB] }],
          shots: [shotA, shotB],
        },
      ],
    };

    const startJob: AssetJob = { kind: 'shot', sequenceId: 'seq-1', shot: { id: 'shot-b' } as any };
    const started = applyAssetStart(story, startJob) as any;

    const doneJob: AssetJob = { kind: 'shot', sequenceId: 'seq-1', shot: { id: 'shot-a' } as any };
    const realUrl = '/__generated__/shot-a-real.png';
    const updated = applyAssetResult(started, doneJob, realUrl) as any;

    const seq = updated.sequences[0];
    const seqShotA = seq.shots.find((s: any) => s.id === 'shot-a');
    const seqShotB = seq.shots.find((s: any) => s.id === 'shot-b');
    const sceneShotA = seq.scenes[0].shots.find((s: any) => s.id === 'shot-a');
    const sceneShotB = seq.scenes[0].shots.find((s: any) => s.id === 'shot-b');

    expect(seqShotA.thumbnailUrl).toBe(realUrl);
    expect(seqShotA.assetState?.status).toBe('done');
    expect(sceneShotA.thumbnailUrl).toBe(realUrl);
    expect(sceneShotA.assetState?.status).toBe('done');

    expect(seqShotB.thumbnailUrl).toBe(UNSPLASH_PLACEHOLDER);
    expect(seqShotB.assetState?.status).toBe('running');
    expect(sceneShotB.thumbnailUrl).toBe(UNSPLASH_PLACEHOLDER);
    expect(sceneShotB.assetState?.status).toBe('running');
  });
});

