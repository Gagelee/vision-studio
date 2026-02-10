import { describe, expect, it } from 'vitest';
import {
  applyAssetError,
  applyAssetResult,
  applyAssetStart,
  applyAssetTaskBinding,
  clearAssetTaskBinding,
  collectAssetTaskLedgerBindings,
  type AssetJob,
} from './assetExecutor';

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

  it('still applies shot result when job.sequenceId is stale but shot id exists elsewhere', () => {
    const shotA = makeShot('shot-a', 1);
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
          id: 'seq-real',
          title: 'S1',
          context: '',
          scenes: [{ id: 'scene-1', title: 'Scene 1', shots: [shotA] }],
          shots: [shotA],
        },
      ],
    };

    const doneJob: AssetJob = { kind: 'shot', sequenceId: 'seq-stale', shot: { id: 'shot-a' } as any };
    const realUrl = '/__generated__/shot-a-real-stale-seq.png';
    const updated = applyAssetResult(story, doneJob, realUrl) as any;

    const seqShotA = updated.sequences[0].shots.find((s: any) => s.id === 'shot-a');
    const sceneShotA = updated.sequences[0].scenes[0].shots.find((s: any) => s.id === 'shot-a');
    expect(seqShotA.thumbnailUrl).toBe(realUrl);
    expect(seqShotA.assetState?.status).toBe('done');
    expect(sceneShotA.thumbnailUrl).toBe(realUrl);
    expect(sceneShotA.assetState?.status).toBe('done');
  });

  it('preserves task binding on transient error and clears it on terminal reconciliation', () => {
    const shotA = makeShot('shot-a', 1);
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
          scenes: [{ id: 'scene-1', title: 'Scene 1', shots: [shotA] }],
          shots: [shotA],
        },
      ],
    };

    const job: AssetJob = { kind: 'shot', sequenceId: 'seq-1', shot: { id: 'shot-a' } as any };
    const started = applyAssetStart(story, job) as any;
    const linked = applyAssetTaskBinding(started, job, { taskId: 'task-123', statusUrl: '/api/pipeline/tasks/task-123' }) as any;
    const errored = applyAssetError(linked, job, 'Task status fetch failed (HTTP 502)') as any;
    const shotAfterError = errored.sequences[0].shots[0];
    expect(shotAfterError.assetState?.status).toBe('error');
    expect(shotAfterError.assetState?.pipelineTaskId).toBe('task-123');

    const cleared = clearAssetTaskBinding(errored, job) as any;
    const shotAfterClear = cleared.sequences[0].shots[0];
    expect(shotAfterClear.assetState?.pipelineTaskId).toBe('');
    expect(shotAfterClear.assetState?.pipelineStatusUrl).toBe('');
  });

  it('tracks task bindings in story-level ledger and clears them on success', () => {
    const story: any = {
      id: 'proj-1',
      title: 'T',
      logline: 'L',
      intent: 'I',
      styleGuide: '',
      keyVisualUrl: '',
      aspectRatio: '16:9',
      status: 'ready',
      locations: [],
      characters: [],
      sequences: [],
    };

    const job: AssetJob = { kind: 'masterkv', prompt: 'kv' };
    const linked = applyAssetTaskBinding(story, job, {
      taskId: 'pipe-1',
      statusUrl: '/api/pipeline/tasks/pipe-1',
    }) as any;

    const bindings = collectAssetTaskLedgerBindings(linked as any);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.taskId).toBe('pipe-1');
    expect(bindings[0]?.job?.kind).toBe('masterkv');

    const done = applyAssetResult(linked as any, job, '/__generated__/kv.png') as any;
    const after = collectAssetTaskLedgerBindings(done as any);
    expect(after).toHaveLength(0);
  });

  it('rebuilds pending binding from ledger even when entity state taskId is missing', () => {
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
          scenes: [{ id: 'scene-1', title: 'Scene 1', shots: [] }],
          shots: [],
        },
      ],
      pipelineTaskLedger: [
        {
          scope: 'asset',
          taskId: 'pipe-ledger',
          statusUrl: '/api/pipeline/tasks/pipe-ledger',
          status: 'active',
          updatedAt: Date.now(),
          job: { kind: 'masterkv' },
        },
      ],
    };
    const bindings = collectAssetTaskLedgerBindings(story as any);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.taskId).toBe('pipe-ledger');
    expect(bindings[0]?.job?.kind).toBe('masterkv');
  });
});
