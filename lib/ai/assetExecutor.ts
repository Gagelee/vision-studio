import type { AiSettings, AspectRatio, ElementType, Shot, Story } from '../../types';
import { generateImageFromPrompt, type ImageReference } from './image/generate';
import { getCharacterActiveAvatarUrl, getLocationActivePreviewUrl, getLookActivePreviewUrl, getStoryActiveKvUrl, isLikelyPlaceholderImageUrl } from './assetRefs';
import { normalizeStorySceneModel } from '../story/sceneModel';
import {
  buildMasterKeyVisualPrompt,
  buildCharacterAvatarPrompt,
  buildCharacterLookPrompt,
  buildLocationPreviewPrompt,
  buildShotImagePrompt,
  buildShotKeyframePrompt,
} from './prompts';
import { selectContactSheetPanelCount } from './prompts/image';

export type AssetScope = 'all' | 'shots' | 'locations' | 'characters' | 'looks' | 'masterkv';

export type AssetJob =
  | { kind: 'masterkv'; prompt: string }
  | { kind: 'location'; locationId: string; prompt: string }
  | { kind: 'character'; characterId: string; prompt: string }
  | { kind: 'look'; characterId: string; lookId: string; prompt: string; avatarVersionId?: string }
  | { kind: 'shot'; sequenceId: string; shot: Shot };

export type AssetJobEvent =
  | { type: 'start'; job: AssetJob; done: number; total: number }
  | { type: 'task'; job: AssetJob; done: number; total: number; taskId: string; statusUrl?: string }
  | { type: 'success'; job: AssetJob; done: number; total: number; imageUrl: string; debug?: any; meta?: any }
  | { type: 'error'; job: AssetJob; done: number; total: number; error: string; taskId?: string; statusUrl?: string }
  | { type: 'blocked'; job: AssetJob; done: number; total: number; reason: string };

type AssetTaskLedgerJobRef =
  | { kind: 'masterkv' }
  | { kind: 'location'; locationId: string }
  | { kind: 'character'; characterId: string }
  | { kind: 'look'; characterId: string; lookId: string; avatarVersionId?: string }
  | { kind: 'shot'; sequenceId: string; shotId: string };

type AssetTaskLedgerEntry = {
  scope: 'asset';
  taskId: string;
  statusUrl?: string;
  status: 'active' | 'resolved' | 'missing';
  updatedAt: number;
  job: AssetTaskLedgerJobRef;
};

const listAssetTaskLedger = (story: Story): AssetTaskLedgerEntry[] => {
  const raw = Array.isArray((story as any)?.pipelineTaskLedger) ? (story as any).pipelineTaskLedger : [];
  return raw
    .filter((e: any) => e && typeof e === 'object' && String(e.scope || '') === 'asset' && String(e.taskId || '').trim())
    .map((e: any) => ({
      scope: 'asset',
      taskId: String(e.taskId || '').trim(),
      statusUrl: String(e.statusUrl || '').trim() || undefined,
      status: String(e.status || '').trim() === 'resolved' ? 'resolved' : String(e.status || '').trim() === 'missing' ? 'missing' : 'active',
      updatedAt: Number(e.updatedAt || 0) || Date.now(),
      job: e.job as AssetTaskLedgerJobRef,
    }));
};

const writeAssetTaskLedger = (story: Story, entries: AssetTaskLedgerEntry[]): Story => {
  const prev = Array.isArray((story as any)?.pipelineTaskLedger) ? (story as any).pipelineTaskLedger : [];
  const nonAsset = prev.filter((e: any) => String(e?.scope || '') !== 'asset');
  const compactAsset = entries
    .slice()
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, 512);
  return {
    ...story,
    pipelineTaskLedger: [...nonAsset, ...compactAsset] as any,
  } as Story;
};

const toAssetTaskLedgerJobRef = (job: AssetJob): AssetTaskLedgerJobRef => {
  if (job.kind === 'masterkv') return { kind: 'masterkv' };
  if (job.kind === 'location') return { kind: 'location', locationId: String(job.locationId || '') };
  if (job.kind === 'character') return { kind: 'character', characterId: String(job.characterId || '') };
  if (job.kind === 'look') {
    return {
      kind: 'look',
      characterId: String(job.characterId || ''),
      lookId: String(job.lookId || ''),
      avatarVersionId: String(job.avatarVersionId || '').trim() || undefined,
    };
  }
  return { kind: 'shot', sequenceId: String(job.sequenceId || ''), shotId: String(job.shot?.id || '') };
};

const fromAssetTaskLedgerJobRef = (ref: AssetTaskLedgerJobRef): AssetJob | null => {
  if (!ref || typeof ref !== 'object') return null;
  if (ref.kind === 'masterkv') return { kind: 'masterkv', prompt: '' };
  if (ref.kind === 'location') return { kind: 'location', locationId: String(ref.locationId || ''), prompt: '' };
  if (ref.kind === 'character') return { kind: 'character', characterId: String(ref.characterId || ''), prompt: '' };
  if (ref.kind === 'look') {
    return {
      kind: 'look',
      characterId: String(ref.characterId || ''),
      lookId: String(ref.lookId || ''),
      prompt: '',
      avatarVersionId: String(ref.avatarVersionId || '').trim() || undefined,
    };
  }
  if (ref.kind === 'shot') {
    const shotId = String(ref.shotId || '').trim();
    const sequenceId = String(ref.sequenceId || '').trim();
    if (!shotId || !sequenceId) return null;
    return { kind: 'shot', sequenceId, shot: { id: shotId } as Shot };
  }
  return null;
};

const assetJobRefKey = (ref: AssetTaskLedgerJobRef): string => {
  if (ref.kind === 'masterkv') return 'masterkv';
  if (ref.kind === 'location') return `location|${String(ref.locationId || '')}`;
  if (ref.kind === 'character') return `character|${String(ref.characterId || '')}`;
  if (ref.kind === 'look') return `look|${String(ref.characterId || '')}|${String(ref.lookId || '')}`;
  return `shot|${String(ref.sequenceId || '')}|${String(ref.shotId || '')}`;
};

const clearAssetTaskLedgerByJob = (story: Story, job: AssetJob): Story => {
  const ref = toAssetTaskLedgerJobRef(job);
  const target = assetJobRefKey(ref);
  const next = listAssetTaskLedger(story).filter((entry) => assetJobRefKey(entry.job) !== target);
  return writeAssetTaskLedger(story, next);
};

const upsertAssetTaskLedger = (story: Story, job: AssetJob, task: { taskId: string; statusUrl?: string }): Story => {
  const taskId = String(task?.taskId || '').trim();
  if (!taskId) return story;
  const now = Date.now();
  const ref = toAssetTaskLedgerJobRef(job);
  const byTask = new Map<string, AssetTaskLedgerEntry>();
  for (const entry of listAssetTaskLedger(story)) {
    if (assetJobRefKey(entry.job) === assetJobRefKey(ref) && entry.status === 'active') continue;
    byTask.set(entry.taskId, entry);
  }
  byTask.set(taskId, {
    scope: 'asset',
    taskId,
    statusUrl: String(task?.statusUrl || '').trim() || undefined,
    status: 'active',
    updatedAt: now,
    job: ref,
  });
  return writeAssetTaskLedger(story, Array.from(byTask.values()));
};

export const clearAssetTaskLedgerByTaskId = (story: Story, taskIdRaw: string): Story => {
  const taskId = String(taskIdRaw || '').trim();
  if (!taskId) return story;
  const next = listAssetTaskLedger(story).filter((entry) => entry.taskId !== taskId);
  return writeAssetTaskLedger(story, next);
};

export const collectAssetTaskLedgerBindings = (
  story: Story,
): Array<{ taskId: string; statusUrl?: string; job: AssetJob; updatedAt: number }> => {
  const out: Array<{ taskId: string; statusUrl?: string; job: AssetJob; updatedAt: number }> = [];
  for (const entry of listAssetTaskLedger(story)) {
    if (entry.status !== 'active') continue;
    const job = fromAssetTaskLedgerJobRef(entry.job);
    if (!job) continue;
    out.push({
      taskId: entry.taskId,
      statusUrl: entry.statusUrl,
      job,
      updatedAt: Number(entry.updatedAt || 0) || 0,
    });
  }
  return out;
};

export const buildAssetJobs = (story: Story, scope: AssetScope = 'all'): AssetJob[] => {
  const jobs: AssetJob[] = [];
  const wantMasterKV = scope === 'all' || scope === 'masterkv';
  const wantShots = scope === 'all' || scope === 'shots';
  const wantLocations = scope === 'all' || scope === 'locations';
  const wantCharacters = scope === 'all' || scope === 'characters';
  const wantLooks = scope === 'all' || scope === 'looks';
  const styleGuide = String((story as any)?.styleGuide || '').trim();

  if (wantMasterKV) {
    jobs.push({
      kind: 'masterkv',
      prompt: buildMasterKeyVisualPrompt({ intent: story.intent, logline: story.logline, styleGuide } as any),
    });
  }

  if (wantLocations) {
    for (const loc of story.locations || []) {
      jobs.push({ kind: 'location', locationId: loc.id, prompt: buildLocationPreviewPrompt(loc, styleGuide) });
    }
  }

  if (wantCharacters || wantLooks) {
    for (const ch of story.characters || []) {
      if (wantCharacters) jobs.push({ kind: 'character', characterId: ch.id, prompt: buildCharacterAvatarPrompt(ch, styleGuide) });
      if (wantLooks) {
        for (const lk of ch.looks || []) {
          jobs.push({
            kind: 'look',
            characterId: ch.id,
            lookId: lk.id,
            prompt: buildCharacterLookPrompt(ch, lk, styleGuide),
            avatarVersionId: String((ch as any)?.activeAvatarVersionId || '').trim() || undefined,
          });
        }
      }
    }
  }

  if (wantShots) {
    for (const seq of story.sequences || []) {
      for (const sh of seq.shots || []) {
        jobs.push({ kind: 'shot', sequenceId: seq.id, shot: sh });
      }
    }
  }

  return jobs;
};

const bumpState = (prev: any, patch: any) => ({ ...(prev || { status: 'idle' }), ...patch });
const resolveShotSequenceId = (story: Story, requestedSequenceId: string, shotId: string): string | null => {
  const direct = (story.sequences || []).find((seq) => seq.id === requestedSequenceId && (seq.shots || []).some((s) => s.id === shotId));
  if (direct) return direct.id;
  const fallback = (story.sequences || []).find((seq) => (seq.shots || []).some((s) => s.id === shotId));
  return fallback ? fallback.id : null;
};

export const applyAssetStart = (story: Story, job: AssetJob): Story => {
  const now = Date.now();
  const runningPatch = {
    status: 'running',
    lastAttemptAt: now,
    pipelineTaskId: '',
    pipelineStatusUrl: '',
    pipelineUpdatedAt: now,
  };
  const finalize = (next: Story) => clearAssetTaskLedgerByJob(next, job);

  if (job.kind === 'masterkv') {
    return finalize({ ...story, masterKvState: bumpState((story as any).masterKvState, runningPatch) });
  }

  if (job.kind === 'location') {
    return finalize({
      ...story,
      locations: (story.locations || []).map((l) =>
        l.id === job.locationId ? { ...l, assetState: bumpState((l as any).assetState, runningPatch) } : l,
      ),
    });
  }

  if (job.kind === 'character') {
    return finalize({
      ...story,
      characters: (story.characters || []).map((c) =>
        c.id === job.characterId ? { ...c, assetState: bumpState((c as any).assetState, runningPatch) } : c,
      ),
    });
  }

  if (job.kind === 'look') {
    return finalize({
      ...story,
      characters: (story.characters || []).map((c) => {
        if (c.id !== job.characterId) return c;
        return {
          ...c,
          looks: (c.looks || []).map((lk) =>
            lk.id === job.lookId ? { ...lk, assetState: bumpState((lk as any).assetState, runningPatch) } : lk,
          ),
        };
      }),
    });
  }

  // shot
  const targetSeqId = resolveShotSequenceId(story, job.sequenceId, job.shot.id);
  if (!targetSeqId) return story;
  return finalize(normalizeStorySceneModel({
    ...story,
    sequences: story.sequences.map((seq) => {
      if (seq.id !== targetSeqId) return seq;
      return {
        ...seq,
        shots: seq.shots.map((s) =>
          s.id === job.shot.id
            ? { ...s, aiState: 'rendering', aiPrompt: 'AUTO', assetState: bumpState((s as any).assetState, runningPatch) }
            : s,
        ),
      };
    }),
  }));
};

export const applyAssetQueued = (story: Story, job: AssetJob): Story => {
  const patch = {
    status: 'queued',
    pipelineTaskId: '',
    pipelineStatusUrl: '',
    pipelineUpdatedAt: Date.now(),
  };
  const finalize = (next: Story) => clearAssetTaskLedgerByJob(next, job);

  if (job.kind === 'masterkv') {
    return finalize({ ...story, masterKvState: bumpState((story as any).masterKvState, patch) });
  }

  if (job.kind === 'location') {
    return finalize({
      ...story,
      locations: (story.locations || []).map((l) =>
        l.id === job.locationId ? { ...l, assetState: bumpState((l as any).assetState, patch) } : l,
      ),
    });
  }

  if (job.kind === 'character') {
    return finalize({
      ...story,
      characters: (story.characters || []).map((c) =>
        c.id === job.characterId ? { ...c, assetState: bumpState((c as any).assetState, patch) } : c,
      ),
    });
  }

  if (job.kind === 'look') {
    return finalize({
      ...story,
      characters: (story.characters || []).map((c) => {
        if (c.id !== job.characterId) return c;
        return {
          ...c,
          looks: (c.looks || []).map((lk) =>
            lk.id === job.lookId ? { ...lk, assetState: bumpState((lk as any).assetState, patch) } : lk,
          ),
        };
      }),
    });
  }

  // shot
  const targetSeqId = resolveShotSequenceId(story, job.sequenceId, job.shot.id);
  if (!targetSeqId) return story;
  return finalize(normalizeStorySceneModel({
    ...story,
    sequences: story.sequences.map((seq) => {
      if (seq.id !== targetSeqId) return seq;
      return {
        ...seq,
        shots: seq.shots.map((s) => (s.id === job.shot.id ? { ...s, assetState: bumpState((s as any).assetState, patch) } : s)),
      };
    }),
  }));
};

export const applyAssetTaskBinding = (story: Story, job: AssetJob, task: { taskId: string; statusUrl?: string }): Story => {
  const now = Date.now();
  const taskId = String(task?.taskId || '').trim();
  if (!taskId) return story;
  const patch = {
    pipelineTaskId: taskId,
    pipelineStatusUrl: String(task?.statusUrl || '').trim(),
    pipelineUpdatedAt: now,
  };
  const finalize = (next: Story) => upsertAssetTaskLedger(next, job, { taskId, statusUrl: String(task?.statusUrl || '').trim() || undefined });

  if (job.kind === 'masterkv') {
    return finalize({ ...story, masterKvState: bumpState((story as any).masterKvState, patch) });
  }

  if (job.kind === 'location') {
    return finalize({
      ...story,
      locations: (story.locations || []).map((l) =>
        l.id === job.locationId ? { ...l, assetState: bumpState((l as any).assetState, patch) } : l,
      ),
    });
  }

  if (job.kind === 'character') {
    return finalize({
      ...story,
      characters: (story.characters || []).map((c) =>
        c.id === job.characterId ? { ...c, assetState: bumpState((c as any).assetState, patch) } : c,
      ),
    });
  }

  if (job.kind === 'look') {
    return finalize({
      ...story,
      characters: (story.characters || []).map((c) => {
        if (c.id !== job.characterId) return c;
        return {
          ...c,
          looks: (c.looks || []).map((lk) =>
            lk.id === job.lookId ? { ...lk, assetState: bumpState((lk as any).assetState, patch) } : lk,
          ),
        };
      }),
    });
  }

  const targetSeqId = resolveShotSequenceId(story, job.sequenceId, job.shot.id);
  if (!targetSeqId) return story;
  return finalize(normalizeStorySceneModel({
    ...story,
    sequences: story.sequences.map((seq) => {
      if (seq.id !== targetSeqId) return seq;
      return {
        ...seq,
        shots: seq.shots.map((s) =>
          s.id === job.shot.id ? { ...s, assetState: bumpState((s as any).assetState, patch) } : s,
        ),
      };
    }),
  }));
};

export const clearAssetTaskBinding = (story: Story, job: AssetJob): Story => {
  const patch = {
    pipelineTaskId: '',
    pipelineStatusUrl: '',
    pipelineUpdatedAt: Date.now(),
  };
  const finalize = (next: Story) => clearAssetTaskLedgerByJob(next, job);

  if (job.kind === 'masterkv') {
    return finalize({ ...story, masterKvState: bumpState((story as any).masterKvState, patch) });
  }

  if (job.kind === 'location') {
    return finalize({
      ...story,
      locations: (story.locations || []).map((l) =>
        l.id === job.locationId ? { ...l, assetState: bumpState((l as any).assetState, patch) } : l,
      ),
    });
  }

  if (job.kind === 'character') {
    return finalize({
      ...story,
      characters: (story.characters || []).map((c) =>
        c.id === job.characterId ? { ...c, assetState: bumpState((c as any).assetState, patch) } : c,
      ),
    });
  }

  if (job.kind === 'look') {
    return finalize({
      ...story,
      characters: (story.characters || []).map((c) => {
        if (c.id !== job.characterId) return c;
        return {
          ...c,
          looks: (c.looks || []).map((lk) =>
            lk.id === job.lookId ? { ...lk, assetState: bumpState((lk as any).assetState, patch) } : lk,
          ),
        };
      }),
    });
  }

  const targetSeqId = resolveShotSequenceId(story, job.sequenceId, job.shot.id);
  if (!targetSeqId) return story;
  return finalize(normalizeStorySceneModel({
    ...story,
    sequences: story.sequences.map((seq) => {
      if (seq.id !== targetSeqId) return seq;
      return {
        ...seq,
        shots: seq.shots.map((s) =>
          s.id === job.shot.id ? { ...s, assetState: bumpState((s as any).assetState, patch) } : s,
        ),
      };
    }),
  }));
};

export const applyAssetBlocked = (story: Story, job: AssetJob, reason: string): Story => {
  const now = Date.now();
  const patch = {
    status: 'blocked',
    lastError: reason,
    lastAttemptAt: now,
    pipelineTaskId: '',
    pipelineStatusUrl: '',
    pipelineUpdatedAt: now,
  };
  const finalize = (next: Story) => clearAssetTaskLedgerByJob(next, job);

  if (job.kind === 'masterkv') return finalize({ ...story, masterKvState: bumpState((story as any).masterKvState, patch) });
  if (job.kind === 'location') {
    return finalize({
      ...story,
      locations: (story.locations || []).map((l) => (l.id === job.locationId ? { ...l, assetState: bumpState((l as any).assetState, patch) } : l)),
    });
  }
  if (job.kind === 'character') {
    return finalize({
      ...story,
      characters: (story.characters || []).map((c) => (c.id === job.characterId ? { ...c, assetState: bumpState((c as any).assetState, patch) } : c)),
    });
  }
  if (job.kind === 'look') {
    return finalize({
      ...story,
      characters: (story.characters || []).map((c) => {
        if (c.id !== job.characterId) return c;
        return {
          ...c,
          looks: (c.looks || []).map((lk) => (lk.id === job.lookId ? { ...lk, assetState: bumpState((lk as any).assetState, patch) } : lk)),
        };
      }),
    });
  }
  const targetSeqId = resolveShotSequenceId(story, job.sequenceId, job.shot.id);
  if (!targetSeqId) return story;
  return finalize(normalizeStorySceneModel({
    ...story,
    sequences: story.sequences.map((seq) => {
      if (seq.id !== targetSeqId) return seq;
      return {
        ...seq,
        shots: seq.shots.map((s) =>
          s.id === job.shot.id ? { ...s, aiState: 'idle', aiPrompt: '', assetState: bumpState((s as any).assetState, patch) } : s,
        ),
      };
    }),
  }));
};

export const applyAssetError = (story: Story, job: AssetJob, error: string): Story => {
  const now = Date.now();
  const patch = {
    status: 'error',
    lastError: error,
    lastAttemptAt: now,
    pipelineUpdatedAt: now,
  };
  const finalize = (next: Story) => clearAssetTaskLedgerByJob(next, job);

  if (job.kind === 'masterkv') return finalize({ ...story, masterKvState: bumpState((story as any).masterKvState, patch) });
  if (job.kind === 'location') {
    return finalize({
      ...story,
      locations: (story.locations || []).map((l) => (l.id === job.locationId ? { ...l, assetState: bumpState((l as any).assetState, patch) } : l)),
    });
  }
  if (job.kind === 'character') {
    return finalize({
      ...story,
      characters: (story.characters || []).map((c) => (c.id === job.characterId ? { ...c, assetState: bumpState((c as any).assetState, patch) } : c)),
    });
  }
  if (job.kind === 'look') {
    return finalize({
      ...story,
      characters: (story.characters || []).map((c) => {
        if (c.id !== job.characterId) return c;
        return {
          ...c,
          looks: (c.looks || []).map((lk) => (lk.id === job.lookId ? { ...lk, assetState: bumpState((lk as any).assetState, patch) } : lk)),
        };
      }),
    });
  }
  const targetSeqId = resolveShotSequenceId(story, job.sequenceId, job.shot.id);
  if (!targetSeqId) return story;
  return finalize(normalizeStorySceneModel({
    ...story,
    sequences: story.sequences.map((seq) => {
      if (seq.id !== targetSeqId) return seq;
      return {
        ...seq,
        shots: seq.shots.map((s) =>
          s.id === job.shot.id ? { ...s, aiState: 'idle', aiPrompt: '', assetState: bumpState((s as any).assetState, patch) } : s,
        ),
      };
    }),
  }));
};

export const applyAssetResult = (story: Story, job: AssetJob, imageUrl: string, meta?: any): Story => {
  const now = Date.now();
  const rand = () => Math.random().toString(16).slice(2, 8);
  const isLikelyPlaceholderUrl = (u: string) => {
    const s = String(u || '').trim();
    if (!s) return false;
    if (s.startsWith('/__generated__/')) return false;
    if (s.startsWith('data:image/')) return false;
    try {
      const parsed = new URL(s);
      return /images\.unsplash\.com$/i.test(parsed.hostname);
    } catch {
      return false;
    }
  };
  const isNewPlaceholder = isLikelyPlaceholderUrl(imageUrl);
  const dropPlaceholders = (versions: any[]) => (Array.isArray(versions) ? versions.filter((v: any) => String(v?.type || '') !== 'placeholder') : []);
  const finalize = (next: Story) => clearAssetTaskLedgerByJob(next, job);

  if (job.kind === 'masterkv') {
    const existing = Array.isArray((story as any).keyVisualVersions) ? (story as any).keyVisualVersions : [];
    const seededBase =
      !existing.length && story.keyVisualUrl && String(story.keyVisualUrl) !== String(imageUrl)
        ? [
            {
              id: `kv-seed-${now}-${rand()}`,
              imageUrl: String(story.keyVisualUrl),
              createdAt: (story as any).masterKvState?.lastAttemptAt || now,
              type: isLikelyPlaceholderUrl(String(story.keyVisualUrl)) ? 'placeholder' : 'base',
            },
          ]
        : [];
    const baseRaw = existing.length ? existing : seededBase;
    const base = isNewPlaceholder ? baseRaw : dropPlaceholders(baseRaw);
    const id = `kv-${now}-${rand()}`;
    const versions = [...base, { id, imageUrl, createdAt: now, type: base.length ? 'variation' : 'base', metadata: meta }];
    return finalize({
      ...story,
      keyVisualUrl: imageUrl,
      keyVisualVersions: versions as any,
      activeKeyVisualVersionId: id as any,
      masterKvState: bumpState((story as any).masterKvState, {
        status: 'done',
        lastError: '',
        pipelineTaskId: '',
        pipelineStatusUrl: '',
        pipelineUpdatedAt: now,
      }),
    });
  }

  if (job.kind === 'location') {
    return finalize({
      ...story,
      locations: (story.locations || []).map((l) =>
        l.id === job.locationId
          ? {
              ...l,
              previewUrl: imageUrl,
              ...(() => {
                const existing = Array.isArray((l as any).previewVersions) ? (l as any).previewVersions : [];
                const seededBase =
                  !existing.length && l.previewUrl && String(l.previewUrl) !== String(imageUrl)
                    ? [
                        {
                          id: `pv-seed-${now}-${rand()}`,
                          imageUrl: String(l.previewUrl),
                          createdAt: (l as any).assetState?.lastAttemptAt || now,
                          type: isLikelyPlaceholderUrl(String(l.previewUrl)) ? 'placeholder' : 'base',
                        },
                        ]
                    : [];
                const baseRaw = existing.length ? existing : seededBase;
                const base = isNewPlaceholder ? baseRaw : dropPlaceholders(baseRaw);
                const id = `pv-${now}-${rand()}`;
                return {
                  previewVersions: [...base, { id, imageUrl, createdAt: now, type: base.length ? 'variation' : 'base', metadata: meta }],
                  activePreviewVersionId: id,
                };
              })(),
              assetState: bumpState((l as any).assetState, {
                status: 'done',
                lastError: '',
                pipelineTaskId: '',
                pipelineStatusUrl: '',
                pipelineUpdatedAt: now,
              }),
            }
          : l,
      ),
    });
  }

  if (job.kind === 'character') {
    return finalize({
      ...story,
      characters: (story.characters || []).map((c) => {
        if (c.id !== job.characterId) return c;
        const existing = Array.isArray((c as any).avatarVersions) ? (c as any).avatarVersions : [];
        const seededBase =
          !existing.length && c.avatarUrl && String(c.avatarUrl) !== String(imageUrl)
            ? [
                {
                  id: `av-seed-${now}-${rand()}`,
                  imageUrl: String(c.avatarUrl),
                  createdAt: (c as any).assetState?.lastAttemptAt || now,
                  type: isLikelyPlaceholderUrl(String(c.avatarUrl)) ? 'placeholder' : 'base',
                },
              ]
            : [];
        const baseRaw = existing.length ? existing : seededBase;
        const base = isNewPlaceholder ? baseRaw : dropPlaceholders(baseRaw);
        const newId = `av-${now}-${rand()}`;
        const nextVersions = [
          ...base,
          { id: newId, imageUrl, createdAt: now, type: base.length ? 'variation' : 'base' },
        ];
        const nextLooks = (c.looks || []).map((lk) => {
          const versions = Array.isArray((lk as any).previewVersions) ? (lk as any).previewVersions : [];
          const match = versions.find((v: any) => String(v?.metadata?.sourceAvatarVersionId || '') === String(newId));
          if (!match) {
            return {
              ...lk,
              previewUrl: '',
              previewVersions: versions,
              activePreviewVersionId: '' as any,
              assetState: bumpState((lk as any).assetState, {
                status: 'blocked',
                lastError: 'Look is not bound to the latest avatar. Regenerate look variants.',
                lastAttemptAt: now,
              }),
            };
          }
          return {
            ...lk,
            previewUrl: String(match.imageUrl),
            previewVersions: versions,
            activePreviewVersionId: String(match.id),
          };
        });
        return {
          ...c,
          avatarUrl: imageUrl,
          avatarVersions: nextVersions,
          activeAvatarVersionId: newId,
          looks: nextLooks,
          assetState: bumpState((c as any).assetState, {
            status: 'done',
            lastError: '',
            pipelineTaskId: '',
            pipelineStatusUrl: '',
            pipelineUpdatedAt: now,
          }),
        };
      }),
    });
  }

  if (job.kind === 'look') {
    return finalize({
      ...story,
      characters: (story.characters || []).map((c) => {
        if (c.id !== job.characterId) return c;
        const activeAvatarId = String((c as any).activeAvatarVersionId || '').trim();
        const desiredAvatarId = String(job.avatarVersionId || '').trim();
        const avatarVersions = Array.isArray((c as any).avatarVersions) ? (c as any).avatarVersions : [];
        const hasDesired = desiredAvatarId && avatarVersions.some((v: any) => String(v?.id || '') === desiredAvatarId);
        const avatarVersionId = hasDesired ? desiredAvatarId : activeAvatarId;
        return {
          ...c,
          looks: (c.looks || []).map((lk) =>
            lk.id === job.lookId
              ? {
                  ...lk,
                  previewUrl: imageUrl,
                  ...(() => {
                    const existing = Array.isArray((lk as any).previewVersions) ? (lk as any).previewVersions : [];
                    const seededBase =
                      !existing.length && lk.previewUrl && String(lk.previewUrl) !== String(imageUrl)
                        ? [
                            {
                              id: `lv-seed-${now}-${rand()}`,
                              imageUrl: String(lk.previewUrl),
                              createdAt: (lk as any).assetState?.lastAttemptAt || now,
                              type: isLikelyPlaceholderUrl(String(lk.previewUrl)) ? 'placeholder' : 'base',
                            },
                          ]
                        : [];
                    const baseRaw = existing.length ? existing : seededBase;
                    const base = isNewPlaceholder ? baseRaw : dropPlaceholders(baseRaw);
                    const id = `lv-${now}-${rand()}`;
                    return {
                  previewVersions: [
                    ...base,
                    {
                      id,
                      imageUrl,
                      createdAt: now,
                      type: base.length ? 'variation' : 'base',
                      metadata: {
                        ...(meta || {}),
                        ...(avatarVersionId ? { sourceAvatarVersionId: avatarVersionId } : {}),
                      },
                    },
                  ],
                  activePreviewVersionId: id,
                    };
                  })(),
                  assetState: bumpState((lk as any).assetState, {
                    status: 'done',
                    lastError: '',
                    pipelineTaskId: '',
                    pipelineStatusUrl: '',
                    pipelineUpdatedAt: now,
                  }),
                }
              : lk,
          ),
        };
      }),
    });
  }

  // shot
  const targetSeqId = resolveShotSequenceId(story, job.sequenceId, job.shot.id);
  if (!targetSeqId) return story;
  return finalize(normalizeStorySceneModel({
    ...story,
    sequences: story.sequences.map((seq) => {
      if (seq.id !== targetSeqId) return seq;
      return {
        ...seq,
        shots: seq.shots.map((s) => {
          if (s.id !== job.shot.id) return s;
          const existing = Array.isArray((s as any).versions) ? (s as any).versions : [];
          const cleaned = isNewPlaceholder ? existing : dropPlaceholders(existing);

          // If we only had a placeholder base, replace it and keep the same id so selection stays stable.
          if (!isNewPlaceholder && existing.length === 1 && cleaned.length === 0 && existing[0]) {
            const base = existing[0];
            const nextVersions = [{ ...base, imageUrl, createdAt: now, type: 'base', metadata: meta || base.metadata }];
            return {
              ...s,
              versions: nextVersions,
              activeVersionId: base.id,
              thumbnailUrl: imageUrl,
              aiState: 'idle',
              aiPrompt: '',
              assetState: bumpState((s as any).assetState, {
                status: 'done',
                lastError: '',
                pipelineTaskId: '',
                pipelineStatusUrl: '',
                pipelineUpdatedAt: now,
              }),
            };
          }

          const baseList = cleaned.length ? cleaned : existing;
          const id = `v-${now}-${rand()}`;
          const nextVersions = [...baseList, { id, imageUrl, createdAt: now, type: baseList.length ? 'variation' : 'base', metadata: meta }];
          return {
            ...s,
            versions: nextVersions,
            activeVersionId: id,
            thumbnailUrl: imageUrl,
            aiState: 'idle',
            aiPrompt: '',
            assetState: bumpState((s as any).assetState, {
              status: 'done',
              lastError: '',
              pipelineTaskId: '',
              pipelineStatusUrl: '',
              pipelineUpdatedAt: now,
            }),
          };
        }),
      };
    }),
  }));
};

const runPool = async <T,>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) => {
  const queue = items.slice();
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
};

export const executeAssetJobs = async (args: {
  jobs: AssetJob[];
  settings: AiSettings['image'];
  aspectRatio: AspectRatio;
  concurrency?: number;
  getStoryForRefs?: () => Story | null;
  shouldCancelJob?: (job: AssetJob) => boolean;
  getSignalForJob?: (job: AssetJob) => AbortSignal | undefined;
  maxAttempts?: number;
  stopAfterMasterKvFailure?: boolean;
  onEvent?: (e: AssetJobEvent) => void;
}): Promise<{ total: number; done: number; errors: number }> => {
  const total = args.jobs.length;
  let done = 0;
  let errors = 0;
  const emitEvent = (event: AssetJobEvent) => {
    if (!args.onEvent) return;
    try {
      args.onEvent(event);
    } catch (e) {
      // Event consumers must never be able to flip a completed backend task into an executor failure.
      console.error('[assetExecutor] onEvent handler failed', {
        type: event.type,
        kind: event.job.kind,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const resolveShotFromStory = (story: Story, sequenceId: string, shotId: string): Shot | null => {
    const seq = (story.sequences || []).find((s) => s.id === sequenceId);
    const shot = seq?.shots?.find((s) => s.id === shotId);
    return shot || null;
  };

  const isDone = (st: any) => st && st.status === 'done';
  const getMasterOk = (s: Story | null) => {
    if (!s) return false;
    const kvUrl = getStoryActiveKvUrl(s, { activeOnly: true });
    if (!kvUrl) return false;
    if (isLikelyPlaceholderImageUrl(kvUrl)) return false;
    const st = (s as any).masterKvState || null;
    if (st?.status === 'running') return false;
    if (st?.status === 'error') return false;
    // Allow user-provided KV even if masterKvState is still idle/undefined.
    return true;
  };

  const getJobKind = (job: AssetJob): AssetJob['kind'] => job.kind;
  const isAbortLikeError = (e: unknown) => {
    if (!e) return false;
    if (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') return true;
    if ((e as any)?.name === 'AbortError') return true;
    const msg = String((e as any)?.message || e || '').toLowerCase();
    return msg.includes('abort') || msg.includes('aborted');
  };
  const orderedPhases: Array<AssetJob['kind']> = ['masterkv', 'location', 'character', 'look', 'shot'];
  const phaseIndexOf = (kind: AssetJob['kind']) => orderedPhases.indexOf(kind);

  const isPhaseComplete = (kind: AssetJob['kind'], story: Story, phaseJobs: AssetJob[]) => {
    if (kind === 'masterkv') return getMasterOk(story);

    if (kind === 'location') {
      const ids = new Set(phaseJobs.filter((j) => j.kind === 'location').map((j: any) => String(j.locationId)));
      return (story.locations || [])
        .filter((l) => ids.has(l.id))
        .every((l) => isDone((l as any).assetState) && Boolean(getLocationActivePreviewUrl(l, { activeOnly: true })));
    }

    if (kind === 'character') {
      const ids = new Set(phaseJobs.filter((j) => j.kind === 'character').map((j: any) => String(j.characterId)));
      return (story.characters || [])
        .filter((c) => ids.has(c.id))
        .every((c) => isDone((c as any).assetState) && Boolean(getCharacterActiveAvatarUrl(c, { activeOnly: true })));
    }

    if (kind === 'look') {
      for (const j of phaseJobs) {
        if (j.kind !== 'look') continue;
        const ch = (story.characters || []).find((c) => c.id === j.characterId);
        const lk = ch?.looks?.find((x) => x.id === j.lookId);
        if (!lk || !isDone((lk as any).assetState) || !getLookActivePreviewUrl(lk, { activeOnly: true })) return false;
      }
      return true;
    }

    // shot
    for (const j of phaseJobs) {
      if (j.kind !== 'shot') continue;
      const sh = resolveShotFromStory(story, j.sequenceId, j.shot.id);
      if (!sh || !isDone((sh as any).assetState)) return false;
      const thumb = String((sh as any).thumbnailUrl || '').trim();
      if (!thumb || isLikelyPlaceholderImageUrl(thumb)) return false;
    }
    return true;
  };

  const blockRemainingPhases = (fromPhaseKind: AssetJob['kind'], reason: string) => {
    const stopAt = phaseIndexOf(fromPhaseKind);
    for (const job of args.jobs) {
      const idx = phaseIndexOf(getJobKind(job));
      if (idx <= stopAt) continue;
      done += 1;
      emitEvent({ type: 'blocked', job, done, total, reason });
    }
  };

  const checkBlocked = (job: AssetJob, story: Story | null): string | null => {
    if (!story) return null;
    if (job.kind === 'masterkv') return null;

    if (job.kind === 'location') return null;
    if (job.kind === 'character') return null;

    if (job.kind === 'look') {
      const ch = (story.characters || []).find((c) => c.id === job.characterId);
      if (!ch || !isDone((ch as any).assetState)) return 'blocked: character avatar not generated';
      if (!getCharacterActiveAvatarUrl(ch, { activeOnly: true })) return `blocked: missing active avatar for character ${ch.name || ch.id}`;
      return null;
    }

    // shot
    const shot = resolveShotFromStory(story, job.sequenceId, job.shot.id) || job.shot;
    if (!shot.locationId) return 'blocked: missing environment on shot';
    const loc = (story.locations || []).find((l) => l.id === shot.locationId);
    if (!loc) return 'blocked: environment not found for shot';
    if (!isDone((loc as any).assetState)) return 'blocked: environment preview not generated';
    if (!getLocationActivePreviewUrl(loc, { activeOnly: true })) return `blocked: missing active environment preview for ${loc.name || loc.id}`;
    const cast = (shot.elements as any)?.[('CASTING' as ElementType)]?.metadata?.characters;
    const castArr = Array.isArray(cast) ? cast : [];
    const isLookBoundToAvatar = (look: any, avatarVersionId: string) => {
      if (!look || !avatarVersionId) return false;
      const versions = Array.isArray(look.previewVersions) ? look.previewVersions : [];
      const activeId = String(look.activePreviewVersionId || '').trim();
      if (!activeId) return false;
      const hit = versions.find((v: any) => String(v?.id || '') === activeId);
      return String(hit?.metadata?.sourceAvatarVersionId || '') === String(avatarVersionId);
    };

    for (const c of castArr.slice(0, 4)) {
      const charId = String(c?.id || '');
      if (!charId) continue;
      const master = (story.characters || []).find((x) => x.id === charId);
      if (!master || !isDone((master as any).assetState)) return 'blocked: cast character avatar not generated';
      if (!getCharacterActiveAvatarUrl(master, { activeOnly: true })) return `blocked: missing active avatar for cast ${master.name || master.id}`;
      const activeLookId = String(c?.activeLookId || '').trim();
      if (activeLookId) {
        const look = master.looks?.find((lk) => lk.id === activeLookId);
        if (!look || !isDone((look as any).assetState)) return 'blocked: cast look not generated';
        const avatarVersionId = String((master as any).activeAvatarVersionId || '').trim();
        const bound = isLookBoundToAvatar(look, avatarVersionId);
        if (!bound) return `blocked: look not bound to active avatar for ${master.name || master.id} (${look.name || look.id})`;
        if (!getLookActivePreviewUrl(look, { activeOnly: true })) return `blocked: missing active look for cast ${master.name || master.id} (${look.name || look.id})`;
      }
    }
    return null;
  };

  const buildShotReferences = (story: Story, shot: Shot): ImageReference[] => {
    const refs: ImageReference[] = [];

    const loc = (story.locations || []).find((l) => l.id === shot.locationId);
    const locUrl = loc && isDone((loc as any).assetState) ? getLocationActivePreviewUrl(loc, { activeOnly: true }) : '';
    if (locUrl) refs.push({ url: locUrl, label: `environment: ${loc?.name || 'unknown'}` });

    const cast = (shot.elements as any)?.[('CASTING' as ElementType)]?.metadata?.characters;
    const castArr = Array.isArray(cast) ? cast : [];
    const isLookBoundToAvatar = (look: any, avatarVersionId: string) => {
      if (!look || !avatarVersionId) return false;
      const versions = Array.isArray(look.previewVersions) ? look.previewVersions : [];
      const activeId = String(look.activePreviewVersionId || '').trim();
      if (!activeId) return false;
      const hit = versions.find((v: any) => String(v?.id || '') === activeId);
      return String(hit?.metadata?.sourceAvatarVersionId || '') === String(avatarVersionId);
    };

    for (const c of castArr.slice(0, 4)) {
      const charId = String(c?.id || '');
      if (!charId) continue;
      const activeLookId = String(c?.activeLookId || '');
      const master = (story.characters || []).find((x) => x.id === charId);
      if (!master || !isDone((master as any).assetState)) continue;
      const look = activeLookId ? master.looks?.find((lk) => lk.id === activeLookId) : null;
      const avatarVersionId = String((master as any).activeAvatarVersionId || '').trim();
      const bound = look ? isLookBoundToAvatar(look, avatarVersionId) : false;
      const lookUrl = bound && look && isDone((look as any).assetState) ? getLookActivePreviewUrl(look, { activeOnly: true }) : '';
      const avatarUrl = getCharacterActiveAvatarUrl(master, { activeOnly: true });

      // Use exactly one reference per character: active look if specified, otherwise base avatar.
      if (lookUrl && refs.length < 6) refs.push({ url: lookUrl, label: `character: ${master.name}${look?.name ? ` (${look.name})` : ''}` });
      if (!lookUrl && avatarUrl && refs.length < 6) refs.push({ url: avatarUrl, label: `character: ${master.name} (base)` });
    }

    return refs;
  };

  const getAvatarUrlByVersionId = (ch: any, versionId?: string) => {
    const id = String(versionId || '').trim();
    if (!ch || !id) return '';
    const versions = Array.isArray(ch.avatarVersions) ? ch.avatarVersions : [];
    const hit = versions.find((v: any) => String(v?.id || '') === id);
    return hit?.imageUrl ? String(hit.imageUrl) : '';
  };

  const buildShotPromptWithContext = (story: Story | null, shot: Shot) => {
    const styleGuide = story ? String((story as any).styleGuide || '').trim() : '';
    const loc = story ? (story.locations || []).find((l) => l.id === shot.locationId) : null;
    const cast = (shot.elements as any)?.[('CASTING' as ElementType)]?.metadata?.characters;
    const castArr = Array.isArray(cast) ? cast : [];
    const castNames = story
      ? castArr
          .map((c: any) => {
            const master = (story.characters || []).find((x) => x.id === String(c?.id || ''));
            if (!master) return null;
            const activeLookId = String(c?.activeLookId || '');
            const look = activeLookId ? master.looks?.find((lk) => lk.id === activeLookId) : master.looks?.[0];
            return `${master.name}${look?.name ? ` (${look.name})` : ''}`;
          })
          .filter(Boolean)
      : [];

    return buildShotKeyframePrompt({
      shot,
      styleGuide,
      environmentName: loc?.name,
      environmentStyle: String(loc?.visualStyle || '').trim(),
      castNames: castNames as any,
    });
  };

  const worker = async (job: AssetJob) => {
    if (args.shouldCancelJob?.(job)) {
      done += 1;
      emitEvent({ type: 'blocked', job, done, total, reason: 'cancelled' });
      return;
    }
    emitEvent({ type: 'start', job, done, total });
    try {
      const snapshot = args.getStoryForRefs?.() || null;
      if (args.shouldCancelJob?.(job)) {
        done += 1;
        emitEvent({ type: 'blocked', job, done, total, reason: 'cancelled' });
        return;
      }
      const blocked = checkBlocked(job, snapshot);
      if (blocked) {
        done += 1;
        emitEvent({ type: 'blocked', job, done, total, reason: blocked });
        return;
      }

      const maxAttempts = Math.max(1, Math.min(6, args.maxAttempts ?? 3));
      let lastErr: any = null;

      const attemptOnce = async () => {
        const signal = args.getSignalForJob?.(job);
        if (signal?.aborted || args.shouldCancelJob?.(job)) throw new DOMException('Aborted', 'AbortError');
        const withTaskBinding = <T extends Record<string, any>>(payload: T): T => {
          return {
            ...payload,
            onTaskAccepted: (task: { taskId: string; statusUrl: string }) => {
              const taskId = String(task?.taskId || '').trim();
              if (!taskId) return;
              emitEvent({
                type: 'task',
                job,
                done,
                total,
                taskId,
                statusUrl: String(task?.statusUrl || '').trim() || undefined,
              });
            },
          };
        };
        const withTaskMeta = (meta: any, debug: any) => {
          const taskId = String(debug?.taskId || '').trim();
          const statusUrl = String(debug?.statusUrl || '').trim();
          if (!taskId && !statusUrl) return meta;
          return {
            ...meta,
            pipeline: {
              taskId,
              statusUrl,
            },
          };
        };
        if (job.kind === 'masterkv') {
          const story = args.getStoryForRefs?.() || null;
          const refsRaw = Array.isArray((story as any)?.referenceImages) ? (story as any).referenceImages : [];
          const useRefs = (story as any)?.referenceMode !== 'off';
          const references = useRefs
            ? refsRaw
                .slice(0, 4)
                .map((r: any) => ({ url: String(r?.url || ''), label: r?.name ? String(r.name) : 'master kv reference' }))
                .filter((r: any) => r.url)
            : [];
          const out = await generateImageFromPrompt(
            withTaskBinding({
            prompt: job.prompt,
            settings: args.settings,
            aspectRatio: args.aspectRatio,
            references,
            signal,
            strict: true,
            requireAllReferences: false,
            async: true,
            pipelinePriority: 'high',
            pollIntervalMs: 450,
            }),
          );
          const meta = withTaskMeta({
            prompt: String(out.debug?.promptUsed || out.debug?.promptUsedPreview || job.prompt || '').trim(),
            references: references.map((r) => ({ url: r.url, label: r.label })),
            settings: { provider: args.settings.provider, model: args.settings.model, temperature: args.settings.temperature },
            aspectRatio: args.aspectRatio,
          }, out.debug);
          return { imageUrl: out.imageUrl, debug: out.debug, meta };
        }

        if (job.kind === 'shot') {
          const story = args.getStoryForRefs?.() || null;
          const shot = story ? resolveShotFromStory(story, job.sequenceId, job.shot.id) || job.shot : job.shot;
          const references = story ? buildShotReferences(story, shot) : [];
          const loc = story ? (story.locations || []).find((l) => l.id === shot.locationId) : null;
          const cast = (shot.elements as any)?.[('CASTING' as ElementType)]?.metadata?.characters;
          const castArr = Array.isArray(cast) ? cast : [];
          const castNames = story
            ? castArr
                .map((c: any) => {
                  const master = (story.characters || []).find((x) => x.id === String(c?.id || ''));
                  if (!master) return null;
                  const activeLookId = String(c?.activeLookId || '');
                  const look = activeLookId ? master.looks?.find((lk) => lk.id === activeLookId) : master.looks?.[0];
                  return `${master.name}${look?.name ? ` (${look.name})` : ''}`;
                })
                .filter(Boolean)
            : [];
          const styleGuide = story ? String((story as any).styleGuide || '').trim() : '';
          const panelCount = selectContactSheetPanelCount(Number(shot.duration || 0));
          const promptSpec = {
            kind: 'shot',
            styleGuide,
            aspectRatio: args.aspectRatio,
            keyframeMode: 'contact_sheet',
            panelCount,
            grid: panelCount === 9 ? '3x3' : '2x2',
            environment: loc ? { name: loc.name, description: loc.description, visualStyle: loc.visualStyle } : null,
            cast: castNames,
            shot: {
              id: shot.id,
              description: shot.description,
              timeOfDay: shot.timeOfDay,
              duration: shot.duration,
              script: String((shot.elements as any)?.SCRIPT?.prompt || '').trim(),
              camera: String((shot.elements as any)?.CAMERA?.prompt || '').trim(),
              lighting: String((shot.elements as any)?.LIGHTING?.prompt || '').trim(),
              audio: String((shot.elements as any)?.AUDIO?.prompt || '').trim(),
            },
            requirements: {
              keyframeNotPoster: true,
              keyframeContactSheet: true,
              avoidPosed: true,
              avoidLookingAtCamera: true,
              emphasizeNarrativeComposition: true,
            },
          };
          const out = await generateImageFromPrompt(
            withTaskBinding({
            prompt: buildShotPromptWithContext(story, shot),
            settings: args.settings,
            aspectRatio: args.aspectRatio,
            references,
            signal,
            promptSpec,
            composePrompt: true,
            composeSettings: { model: String((args as any)?.promptComposerModel || '') || 'gemini-3-pro-preview', temperature: 0.2, maxOutputTokens: 512 },
            strict: true,
            requireAllReferences: references.length > 0,
            async: true,
            }),
          );
          const meta = withTaskMeta({
            prompt: String(out.debug?.promptUsed || out.debug?.promptUsedPreview || buildShotPromptWithContext(story, shot) || '').trim(),
            references: references.map((r) => ({ url: r.url, label: r.label })),
            settings: {
              provider: args.settings.provider,
              model: args.settings.model,
              temperature: args.settings.temperature,
            },
            aspectRatio: args.aspectRatio,
          }, out.debug);
          return { imageUrl: out.imageUrl, debug: out.debug, meta };
        }

        if (job.kind === 'location') {
          const story = args.getStoryForRefs?.() || null;
          const loc = story ? (story.locations || []).find((l) => l.id === job.locationId) : null;
          const refsRaw = Array.isArray((loc as any)?.referenceImages) ? (loc as any).referenceImages : [];
          const useRefs = (loc as any)?.referenceMode !== 'off';
          const references = useRefs
            ? refsRaw
                .slice(0, 4)
                .map((r: any) => ({ url: String(r?.url || ''), label: r?.name ? String(r.name) : 'environment reference' }))
                .filter((r: any) => r.url)
            : [];
          const kvUrl = story ? getStoryActiveKvUrl(story, { activeOnly: true }) : '';
          if (!references.length && kvUrl && !isLikelyPlaceholderImageUrl(kvUrl)) {
            references.push({ url: kvUrl, label: 'master kv reference' });
          }
          const out = await generateImageFromPrompt(
            withTaskBinding({
            prompt: job.prompt,
            settings: args.settings,
            aspectRatio: args.aspectRatio,
            references,
            signal,
            strict: true,
            requireAllReferences: false,
            async: true,
            }),
          );
          const meta = withTaskMeta({
            prompt: String(out.debug?.promptUsed || out.debug?.promptUsedPreview || job.prompt || '').trim(),
            references: references.map((r) => ({ url: r.url, label: r.label })),
            settings: { provider: args.settings.provider, model: args.settings.model, temperature: args.settings.temperature },
            aspectRatio: args.aspectRatio,
          }, out.debug);
          return { imageUrl: out.imageUrl, debug: out.debug, meta };
        }

        if (job.kind === 'character') {
          const story = args.getStoryForRefs?.() || null;
          const ch = story ? (story.characters || []).find((c) => c.id === job.characterId) : null;
          const refsRaw = Array.isArray((ch as any)?.referenceImages) ? (ch as any).referenceImages : [];
          const useRefs = (ch as any)?.referenceMode !== 'off';
          const references = useRefs
            ? refsRaw
                .slice(0, 4)
                .map((r: any) => ({ url: String(r?.url || ''), label: r?.name ? String(r.name) : 'character reference' }))
                .filter((r: any) => r.url)
            : [];
          const out = await generateImageFromPrompt(
            withTaskBinding({
            prompt: job.prompt,
            settings: args.settings,
            aspectRatio: '1:1',
            references,
            signal,
            strict: true,
            requireAllReferences: false,
            async: true,
            }),
          );
          const meta = withTaskMeta({
            prompt: String(out.debug?.promptUsed || out.debug?.promptUsedPreview || job.prompt || '').trim(),
            references: references.map((r) => ({ url: r.url, label: r.label })),
            settings: { provider: args.settings.provider, model: args.settings.model, temperature: args.settings.temperature },
            aspectRatio: '1:1',
          }, out.debug);
          return { imageUrl: out.imageUrl, debug: out.debug, meta };
        }

	        // look
	        const story = args.getStoryForRefs?.() || null;
	        const ch = story ? (story.characters || []).find((c) => c.id === job.characterId) : null;
	        const desiredAvatarUrl = getAvatarUrlByVersionId(ch, (job as any).avatarVersionId);
	        const avatarUrl =
	          desiredAvatarUrl || (ch && isDone((ch as any)?.assetState) ? getCharacterActiveAvatarUrl(ch, { activeOnly: true }) : '');
	        const refs = avatarUrl ? [{ url: avatarUrl, label: `character base: ${ch?.name || job.characterId}` }] : [];
		        const out = await generateImageFromPrompt(
              withTaskBinding({
		          prompt: job.prompt,
		          settings: args.settings,
		          aspectRatio: '1:1',
		          references: refs,
              signal,
		          strict: true,
		          requireAllReferences: refs.length > 0,
              async: true,
		        }),
            );
          const meta = withTaskMeta({
            prompt: String(out.debug?.promptUsed || out.debug?.promptUsedPreview || job.prompt || '').trim(),
            references: refs.map((r) => ({ url: r.url, label: r.label })),
            settings: { provider: args.settings.provider, model: args.settings.model, temperature: args.settings.temperature },
            aspectRatio: '1:1',
          }, out.debug);
	        return { imageUrl: out.imageUrl, debug: out.debug, meta };
	      };

      for (let i = 1; i <= maxAttempts; i++) {
        try {
          if (args.shouldCancelJob?.(job)) throw new DOMException('Aborted', 'AbortError');
          const out = await attemptOnce();
          done += 1;
          emitEvent({ type: 'success', job, done, total, imageUrl: out.imageUrl, debug: out.debug, meta: out.meta });
          return;
        } catch (e) {
          if (isAbortLikeError(e) || args.shouldCancelJob?.(job)) {
            done += 1;
            emitEvent({ type: 'blocked', job, done, total, reason: 'cancelled' });
            return;
          }
          lastErr = e;
          if (i < maxAttempts) {
            const backoff = Math.min(5000, Math.round(700 * Math.pow(1.6, i - 1)));
            await new Promise((r) => setTimeout(r, backoff));
          }
        }
      }

      throw lastErr || new Error('failed');
    } catch (e) {
      done += 1;
      errors += 1;
      const taskId = String((e as any)?.taskId || '').trim();
      const statusUrl = String((e as any)?.statusUrl || '').trim();
      emitEvent({
        type: 'error',
        job,
        done,
        total,
        error: e instanceof Error ? e.message : String(e),
        taskId: taskId || undefined,
        statusUrl: statusUrl || undefined,
      });
    }
  };

  // Run in dependency order so keyframes can reference generated assets:
  // masterkv -> environments -> character base -> looks -> shots
  for (const kind of orderedPhases) {
    const phase = args.jobs.filter((j) => j.kind === kind);
    if (!phase.length) continue;
    await runPool(phase, args.concurrency ?? 2, worker);
    const s = args.getStoryForRefs?.();
    if (!s) continue;

    if (kind === 'masterkv' && args.stopAfterMasterKvFailure && (s as any).masterKvState?.status === 'error') {
      blockRemainingPhases(kind, 'blocked: master KV failed; downstream phases not allowed');
      break;
    }

    // Master KV is optional as a *reference* (style should come from Story.styleGuide), so KV failures should not block other phases.
    if (kind === 'masterkv') continue;

    if (!isPhaseComplete(kind, s, phase)) {
      blockRemainingPhases(kind, `blocked: previous phase (${kind}) not fully successful`);
      break;
    }
  }
  return { total, done, errors };
};

export const getJobLabel = (job: AssetJob, story: Story): string => {
  if (job.kind === 'masterkv') return 'Master KV';
  if (job.kind === 'location') {
    const loc = (story.locations || []).find((l) => l.id === job.locationId);
    return loc ? `Environment: ${loc.name}` : `Environment: ${job.locationId}`;
  }
  if (job.kind === 'character') {
    const ch = (story.characters || []).find((c) => c.id === job.characterId);
    return ch ? `Character: ${ch.name}` : `Character: ${job.characterId}`;
  }
  if (job.kind === 'look') {
    const ch = (story.characters || []).find((c) => c.id === job.characterId);
    const lk = ch?.looks?.find((x) => x.id === job.lookId);
    if (ch && lk) return `Look: ${ch.name} / ${lk.name}`;
    return `Look: ${job.characterId}/${job.lookId}`;
  }
  return `Shot #${job.shot.sequence}`;
};
