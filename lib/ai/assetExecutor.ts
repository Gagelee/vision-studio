import type { AiSettings, AspectRatio, ElementType, Shot, Story } from '../../types';
import { generateImageFromPrompt, type ImageReference } from './image/generate';
import {
  buildMasterKeyVisualPrompt,
  buildCharacterAvatarPrompt,
  buildCharacterLookPrompt,
  buildLocationPreviewPrompt,
  buildShotImagePrompt,
} from './prompts';

export type AssetScope = 'all' | 'shots' | 'locations' | 'characters' | 'looks' | 'masterkv';

export type AssetJob =
  | { kind: 'masterkv'; prompt: string }
  | { kind: 'location'; locationId: string; prompt: string }
  | { kind: 'character'; characterId: string; prompt: string }
  | { kind: 'look'; characterId: string; lookId: string; prompt: string }
  | { kind: 'shot'; sequenceId: string; shot: Shot };

export type AssetJobEvent =
  | { type: 'start'; job: AssetJob; done: number; total: number }
  | { type: 'success'; job: AssetJob; done: number; total: number; imageUrl: string; debug?: any }
  | { type: 'error'; job: AssetJob; done: number; total: number; error: string }
  | { type: 'blocked'; job: AssetJob; done: number; total: number; reason: string };

export const buildAssetJobs = (story: Story, scope: AssetScope = 'all'): AssetJob[] => {
  const jobs: AssetJob[] = [];
  const wantMasterKV = scope === 'all' || scope === 'masterkv';
  const wantShots = scope === 'all' || scope === 'shots';
  const wantLocations = scope === 'all' || scope === 'locations';
  const wantCharacters = scope === 'all' || scope === 'characters';
  const wantLooks = scope === 'all' || scope === 'looks';

  if (wantMasterKV) {
    jobs.push({ kind: 'masterkv', prompt: buildMasterKeyVisualPrompt({ intent: story.intent, logline: story.logline }) });
  }

  if (wantLocations) {
    for (const loc of story.locations || []) {
      jobs.push({ kind: 'location', locationId: loc.id, prompt: buildLocationPreviewPrompt(loc) });
    }
  }

  if (wantCharacters || wantLooks) {
    for (const ch of story.characters || []) {
      if (wantCharacters) jobs.push({ kind: 'character', characterId: ch.id, prompt: buildCharacterAvatarPrompt(ch) });
      if (wantLooks) {
        for (const lk of ch.looks || []) {
          jobs.push({ kind: 'look', characterId: ch.id, lookId: lk.id, prompt: buildCharacterLookPrompt(ch, lk) });
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

export const applyAssetStart = (story: Story, job: AssetJob): Story => {
  const now = Date.now();

  if (job.kind === 'masterkv') {
    return { ...story, masterKvState: bumpState((story as any).masterKvState, { status: 'running', lastAttemptAt: now }) };
  }

  if (job.kind === 'location') {
    return {
      ...story,
      locations: (story.locations || []).map((l) =>
        l.id === job.locationId ? { ...l, assetState: bumpState((l as any).assetState, { status: 'running', lastAttemptAt: now }) } : l,
      ),
    };
  }

  if (job.kind === 'character') {
    return {
      ...story,
      characters: (story.characters || []).map((c) =>
        c.id === job.characterId ? { ...c, assetState: bumpState((c as any).assetState, { status: 'running', lastAttemptAt: now }) } : c,
      ),
    };
  }

  if (job.kind === 'look') {
    return {
      ...story,
      characters: (story.characters || []).map((c) => {
        if (c.id !== job.characterId) return c;
        return {
          ...c,
          looks: (c.looks || []).map((lk) =>
            lk.id === job.lookId ? { ...lk, assetState: bumpState((lk as any).assetState, { status: 'running', lastAttemptAt: now }) } : lk,
          ),
        };
      }),
    };
  }

  // shot
  return {
    ...story,
    sequences: story.sequences.map((seq) => {
      if (seq.id !== job.sequenceId) return seq;
      return {
        ...seq,
        shots: seq.shots.map((s) =>
          s.id === job.shot.id
            ? { ...s, aiState: 'rendering', aiPrompt: 'AUTO', assetState: bumpState((s as any).assetState, { status: 'running', lastAttemptAt: now }) }
            : s,
        ),
      };
    }),
  };
};

export const applyAssetBlocked = (story: Story, job: AssetJob, reason: string): Story => {
  const now = Date.now();
  const patch = { status: 'blocked', lastError: reason, lastAttemptAt: now };

  if (job.kind === 'masterkv') return { ...story, masterKvState: bumpState((story as any).masterKvState, patch) };
  if (job.kind === 'location') {
    return {
      ...story,
      locations: (story.locations || []).map((l) => (l.id === job.locationId ? { ...l, assetState: bumpState((l as any).assetState, patch) } : l)),
    };
  }
  if (job.kind === 'character') {
    return {
      ...story,
      characters: (story.characters || []).map((c) => (c.id === job.characterId ? { ...c, assetState: bumpState((c as any).assetState, patch) } : c)),
    };
  }
  if (job.kind === 'look') {
    return {
      ...story,
      characters: (story.characters || []).map((c) => {
        if (c.id !== job.characterId) return c;
        return {
          ...c,
          looks: (c.looks || []).map((lk) => (lk.id === job.lookId ? { ...lk, assetState: bumpState((lk as any).assetState, patch) } : lk)),
        };
      }),
    };
  }
  return {
    ...story,
    sequences: story.sequences.map((seq) => {
      if (seq.id !== job.sequenceId) return seq;
      return {
        ...seq,
        shots: seq.shots.map((s) =>
          s.id === job.shot.id ? { ...s, aiState: 'idle', aiPrompt: '', assetState: bumpState((s as any).assetState, patch) } : s,
        ),
      };
    }),
  };
};

export const applyAssetError = (story: Story, job: AssetJob, error: string): Story => {
  const now = Date.now();
  const patch = { status: 'error', lastError: error, lastAttemptAt: now };

  if (job.kind === 'masterkv') return { ...story, masterKvState: bumpState((story as any).masterKvState, patch) };
  if (job.kind === 'location') {
    return {
      ...story,
      locations: (story.locations || []).map((l) => (l.id === job.locationId ? { ...l, assetState: bumpState((l as any).assetState, patch) } : l)),
    };
  }
  if (job.kind === 'character') {
    return {
      ...story,
      characters: (story.characters || []).map((c) => (c.id === job.characterId ? { ...c, assetState: bumpState((c as any).assetState, patch) } : c)),
    };
  }
  if (job.kind === 'look') {
    return {
      ...story,
      characters: (story.characters || []).map((c) => {
        if (c.id !== job.characterId) return c;
        return {
          ...c,
          looks: (c.looks || []).map((lk) => (lk.id === job.lookId ? { ...lk, assetState: bumpState((lk as any).assetState, patch) } : lk)),
        };
      }),
    };
  }
  return {
    ...story,
    sequences: story.sequences.map((seq) => {
      if (seq.id !== job.sequenceId) return seq;
      return {
        ...seq,
        shots: seq.shots.map((s) =>
          s.id === job.shot.id ? { ...s, aiState: 'idle', aiPrompt: '', assetState: bumpState((s as any).assetState, patch) } : s,
        ),
      };
    }),
  };
};

export const applyAssetResult = (story: Story, job: AssetJob, imageUrl: string): Story => {
  if (job.kind === 'masterkv') {
    return { ...story, keyVisualUrl: imageUrl, masterKvState: bumpState((story as any).masterKvState, { status: 'done', lastError: '' }) };
  }

  if (job.kind === 'location') {
    return {
      ...story,
      locations: (story.locations || []).map((l) =>
        l.id === job.locationId ? { ...l, previewUrl: imageUrl, assetState: bumpState((l as any).assetState, { status: 'done', lastError: '' }) } : l,
      ),
    };
  }

  if (job.kind === 'character') {
    return {
      ...story,
      characters: (story.characters || []).map((c) =>
        c.id === job.characterId ? { ...c, avatarUrl: imageUrl, assetState: bumpState((c as any).assetState, { status: 'done', lastError: '' }) } : c,
      ),
    };
  }

  if (job.kind === 'look') {
    return {
      ...story,
      characters: (story.characters || []).map((c) => {
        if (c.id !== job.characterId) return c;
        return {
          ...c,
          looks: (c.looks || []).map((lk) =>
            lk.id === job.lookId ? { ...lk, previewUrl: imageUrl, assetState: bumpState((lk as any).assetState, { status: 'done', lastError: '' }) } : lk,
          ),
        };
      }),
    };
  }

  // shot
  return {
    ...story,
    sequences: story.sequences.map((seq) => {
      if (seq.id !== job.sequenceId) return seq;
      return {
        ...seq,
        shots: seq.shots.map((s) => {
          if (s.id !== job.shot.id) return s;
          const first = s.versions?.[0];
          const nextVersions = first
            ? [{ ...first, imageUrl }, ...(s.versions || []).slice(1)]
            : [{ id: 'v1', imageUrl, createdAt: Date.now(), type: 'base' }];
          return {
            ...s,
            versions: nextVersions,
            activeVersionId: nextVersions[0].id,
            thumbnailUrl: imageUrl,
            aiState: 'idle',
            aiPrompt: '',
            assetState: bumpState((s as any).assetState, { status: 'done', lastError: '' }),
          };
        }),
      };
    }),
  };
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
  maxAttempts?: number;
  stopAfterMasterKvFailure?: boolean;
  onEvent?: (e: AssetJobEvent) => void;
}): Promise<{ total: number; done: number; errors: number }> => {
  const total = args.jobs.length;
  let done = 0;
  let errors = 0;

  const resolveShotFromStory = (story: Story, sequenceId: string, shotId: string): Shot | null => {
    const seq = (story.sequences || []).find((s) => s.id === sequenceId);
    const shot = seq?.shots?.find((s) => s.id === shotId);
    return shot || null;
  };

  const isDone = (st: any) => st && st.status === 'done';
  const getMasterOk = (s: Story | null) => Boolean(s && (s.keyVisualUrl || '').trim() && isDone((s as any).masterKvState));

  const getJobKind = (job: AssetJob): AssetJob['kind'] => job.kind;
  const orderedPhases: Array<AssetJob['kind']> = ['masterkv', 'location', 'character', 'look', 'shot'];
  const phaseIndexOf = (kind: AssetJob['kind']) => orderedPhases.indexOf(kind);

  const isPhaseComplete = (kind: AssetJob['kind'], story: Story, phaseJobs: AssetJob[]) => {
    if (kind === 'masterkv') return getMasterOk(story);

    if (kind === 'location') {
      const ids = new Set(phaseJobs.filter((j) => j.kind === 'location').map((j: any) => String(j.locationId)));
      return (story.locations || []).filter((l) => ids.has(l.id)).every((l) => isDone((l as any).assetState));
    }

    if (kind === 'character') {
      const ids = new Set(phaseJobs.filter((j) => j.kind === 'character').map((j: any) => String(j.characterId)));
      return (story.characters || []).filter((c) => ids.has(c.id)).every((c) => isDone((c as any).assetState));
    }

    if (kind === 'look') {
      for (const j of phaseJobs) {
        if (j.kind !== 'look') continue;
        const ch = (story.characters || []).find((c) => c.id === j.characterId);
        const lk = ch?.looks?.find((x) => x.id === j.lookId);
        if (!lk || !isDone((lk as any).assetState)) return false;
      }
      return true;
    }

    // shot
    for (const j of phaseJobs) {
      if (j.kind !== 'shot') continue;
      const sh = resolveShotFromStory(story, j.sequenceId, j.shot.id);
      if (!sh || !isDone((sh as any).assetState)) return false;
    }
    return true;
  };

  const blockRemainingPhases = (fromPhaseKind: AssetJob['kind'], reason: string) => {
    const stopAt = phaseIndexOf(fromPhaseKind);
    for (const job of args.jobs) {
      const idx = phaseIndexOf(getJobKind(job));
      if (idx <= stopAt) continue;
      done += 1;
      args.onEvent?.({ type: 'blocked', job, done, total, reason });
    }
  };

  const checkBlocked = (job: AssetJob, story: Story | null): string | null => {
    if (!story) return null;
    if (job.kind === 'masterkv') return null;
    if (!getMasterOk(story)) return 'blocked: master KV not generated (or failed)';

    if (job.kind === 'location') return null;
    if (job.kind === 'character') return null;

    if (job.kind === 'look') {
      const ch = (story.characters || []).find((c) => c.id === job.characterId);
      if (!ch || !isDone((ch as any).assetState)) return 'blocked: character avatar not generated';
      if (!ch.avatarUrl) return 'blocked: missing character avatarUrl';
      return null;
    }

    // shot
    const shot = resolveShotFromStory(story, job.sequenceId, job.shot.id) || job.shot;
    const loc = (story.locations || []).find((l) => l.id === shot.locationId);
    if (!loc || !isDone((loc as any).assetState)) return 'blocked: environment preview not generated';
    if (!loc.previewUrl) return 'blocked: missing environment previewUrl';
    const cast = (shot.elements as any)?.[('CASTING' as ElementType)]?.metadata?.characters;
    const castArr = Array.isArray(cast) ? cast : [];
    for (const c of castArr.slice(0, 4)) {
      const charId = String(c?.id || '');
      if (!charId) continue;
      const master = (story.characters || []).find((x) => x.id === charId);
      if (!master || !isDone((master as any).assetState)) return 'blocked: cast character avatar not generated';
      const activeLookId = String(c?.activeLookId || '').trim();
      if (activeLookId) {
        const look = master.looks?.find((lk) => lk.id === activeLookId);
        if (!look || !isDone((look as any).assetState)) return 'blocked: cast look not generated';
        if (!look.previewUrl) return 'blocked: missing cast look previewUrl';
      }
    }
    return null;
  };

  const buildShotReferences = (story: Story, shot: Shot): ImageReference[] => {
    const refs: ImageReference[] = [];
    if (getMasterOk(story) && story.keyVisualUrl) refs.push({ url: story.keyVisualUrl, label: 'master kv' });

    const loc = (story.locations || []).find((l) => l.id === shot.locationId);
    if (loc?.previewUrl && isDone((loc as any).assetState)) refs.push({ url: loc.previewUrl, label: `environment: ${loc.name}` });

    const cast = (shot.elements as any)?.[('CASTING' as ElementType)]?.metadata?.characters;
    const castArr = Array.isArray(cast) ? cast : [];
    for (const c of castArr.slice(0, 4)) {
      const charId = String(c?.id || '');
      if (!charId) continue;
      const activeLookId = String(c?.activeLookId || '');
      const master = (story.characters || []).find((x) => x.id === charId);
      if (!master || !isDone((master as any).assetState)) continue;
      const look = activeLookId ? master.looks?.find((lk) => lk.id === activeLookId) : null;
      if (look && isDone((look as any).assetState) && look.previewUrl) {
        refs.push({ url: look.previewUrl, label: `character: ${master.name}${look?.name ? ` (${look.name})` : ''}` });
        continue;
      }
      if (master.avatarUrl) refs.push({ url: master.avatarUrl, label: `character: ${master.name}` });
    }

    return refs;
  };

  const buildShotPromptWithContext = (story: Story | null, shot: Shot) => {
    const lines: string[] = [];
    lines.push(
      'Generate a cinematic storyboard keyframe (still image).',
      'Match the Master KV art direction: consistent palette, lighting language, lens feel, and overall rendering style.',
      'Follow the reference images strictly for identity + environment consistency. Do not drift into a different art style.',
      'No text, no subtitles, no watermarks, no logos.',
      '',
      buildShotImagePrompt(shot),
    );

    if (story) {
      const loc = (story.locations || []).find((l) => l.id === shot.locationId);
      if (loc) {
        lines.push('', `Environment: ${loc.name}`, `Environment style: ${loc.visualStyle || ''}`.trim());
      }

      const cast = (shot.elements as any)?.[('CASTING' as ElementType)]?.metadata?.characters;
      const castArr = Array.isArray(cast) ? cast : [];
      if (castArr.length) {
        const castNames = castArr
          .map((c: any) => {
            const master = (story.characters || []).find((x) => x.id === String(c?.id || ''));
            if (!master) return null;
            const activeLookId = String(c?.activeLookId || '');
            const look = activeLookId ? master.looks?.find((lk) => lk.id === activeLookId) : master.looks?.[0];
            return `${master.name}${look?.name ? ` (${look.name})` : ''}`;
          })
          .filter(Boolean);
        if (castNames.length) lines.push('', `Cast: ${castNames.join(', ')}`);
      }
    }

    return lines.filter(Boolean).join('\n');
  };

  const worker = async (job: AssetJob) => {
    args.onEvent?.({ type: 'start', job, done, total });
    try {
      const snapshot = args.getStoryForRefs?.() || null;
      const blocked = checkBlocked(job, snapshot);
      if (blocked) {
        done += 1;
        args.onEvent?.({ type: 'blocked', job, done, total, reason: blocked });
        return;
      }

      const maxAttempts = Math.max(1, Math.min(6, args.maxAttempts ?? 3));
      let lastErr: any = null;

      const attemptOnce = async () => {
        if (job.kind === 'masterkv') {
          const out = await generateImageFromPrompt({
            prompt: job.prompt,
            settings: args.settings,
            aspectRatio: args.aspectRatio,
            strict: true,
          });
          return { imageUrl: out.imageUrl, debug: out.debug };
        }

        if (job.kind === 'shot') {
          const story = args.getStoryForRefs?.() || null;
          const shot = story ? resolveShotFromStory(story, job.sequenceId, job.shot.id) || job.shot : job.shot;
          const references = story ? buildShotReferences(story, shot) : [];
          const out = await generateImageFromPrompt({
            prompt: buildShotPromptWithContext(story, shot),
            settings: args.settings,
            aspectRatio: args.aspectRatio,
            references,
            strict: true,
          });
          return { imageUrl: out.imageUrl, debug: out.debug };
        }

        if (job.kind === 'location') {
          const story = args.getStoryForRefs?.() || null;
          const out = await generateImageFromPrompt({
            prompt: job.prompt,
            settings: args.settings,
            aspectRatio: args.aspectRatio,
            references: story && getMasterOk(story) && story.keyVisualUrl ? [{ url: story.keyVisualUrl, label: 'master kv' }] : [],
            strict: true,
          });
          return { imageUrl: out.imageUrl, debug: out.debug };
        }

        if (job.kind === 'character') {
          const story = args.getStoryForRefs?.() || null;
          const out = await generateImageFromPrompt({
            prompt: job.prompt,
            settings: args.settings,
            aspectRatio: '1:1',
            references: story && getMasterOk(story) && story.keyVisualUrl ? [{ url: story.keyVisualUrl, label: 'master kv' }] : [],
            strict: true,
          });
          return { imageUrl: out.imageUrl, debug: out.debug };
        }

        // look
        const story = args.getStoryForRefs?.() || null;
        const ch = story ? (story.characters || []).find((c) => c.id === job.characterId) : null;
        const out = await generateImageFromPrompt({
          prompt:
            job.prompt +
            '\n\nUse the provided reference image(s) to keep the exact same character identity. Only vary styling described for this look.',
          settings: args.settings,
          aspectRatio: '1:1',
          references: [
            ...(story && getMasterOk(story) && story.keyVisualUrl ? [{ url: story.keyVisualUrl, label: 'master kv' }] : []),
            ...(ch?.avatarUrl && isDone((ch as any)?.assetState) ? [{ url: ch.avatarUrl, label: `character base: ${ch.name}` }] : []),
          ],
          strict: true,
        });
        return { imageUrl: out.imageUrl, debug: out.debug };
      };

      for (let i = 1; i <= maxAttempts; i++) {
        try {
          const out = await attemptOnce();
          done += 1;
          args.onEvent?.({ type: 'success', job, done, total, imageUrl: out.imageUrl, debug: out.debug });
          return;
        } catch (e) {
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
      args.onEvent?.({ type: 'error', job, done, total, error: e instanceof Error ? e.message : String(e) });
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
