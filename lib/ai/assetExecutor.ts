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
  | { type: 'error'; job: AssetJob; done: number; total: number; error: string };

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

export const applyAssetStart = (story: Story, job: AssetJob): Story => {
  if (job.kind !== 'shot') return story;
  return {
    ...story,
    sequences: story.sequences.map((seq) => {
      if (seq.id !== job.sequenceId) return seq;
      return {
        ...seq,
        shots: seq.shots.map((s) => (s.id === job.shot.id ? { ...s, aiState: 'rendering', aiPrompt: 'AUTO' } : s)),
      };
    }),
  };
};

export const applyAssetError = (story: Story, job: AssetJob): Story => {
  if (job.kind !== 'shot') return story;
  return {
    ...story,
    sequences: story.sequences.map((seq) => {
      if (seq.id !== job.sequenceId) return seq;
      return {
        ...seq,
        shots: seq.shots.map((s) => (s.id === job.shot.id ? { ...s, aiState: 'idle', aiPrompt: '' } : s)),
      };
    }),
  };
};

export const applyAssetResult = (story: Story, job: AssetJob, imageUrl: string): Story => {
  if (job.kind === 'masterkv') {
    return { ...story, keyVisualUrl: imageUrl };
  }

  if (job.kind === 'location') {
    return {
      ...story,
      locations: (story.locations || []).map((l) => (l.id === job.locationId ? { ...l, previewUrl: imageUrl } : l)),
    };
  }

  if (job.kind === 'character') {
    return {
      ...story,
      characters: (story.characters || []).map((c) => (c.id === job.characterId ? { ...c, avatarUrl: imageUrl } : c)),
    };
  }

  if (job.kind === 'look') {
    return {
      ...story,
      characters: (story.characters || []).map((c) => {
        if (c.id !== job.characterId) return c;
        return {
          ...c,
          looks: (c.looks || []).map((lk) => (lk.id === job.lookId ? { ...lk, previewUrl: imageUrl } : lk)),
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

  const buildShotReferences = (story: Story, shot: Shot): ImageReference[] => {
    const refs: ImageReference[] = [];
    if (story.keyVisualUrl) refs.push({ url: story.keyVisualUrl, label: 'master kv' });

    const loc = (story.locations || []).find((l) => l.id === shot.locationId);
    if (loc?.previewUrl) refs.push({ url: loc.previewUrl, label: `environment: ${loc.name}` });

    const cast = (shot.elements as any)?.[('CASTING' as ElementType)]?.metadata?.characters;
    const castArr = Array.isArray(cast) ? cast : [];
    for (const c of castArr.slice(0, 4)) {
      const charId = String(c?.id || '');
      if (!charId) continue;
      const activeLookId = String(c?.activeLookId || '');
      const master = (story.characters || []).find((x) => x.id === charId);
      if (!master) continue;
      const look = activeLookId ? master.looks?.find((lk) => lk.id === activeLookId) : master.looks?.[0];
      const url = look?.previewUrl || master.avatarUrl;
      if (url) refs.push({ url, label: `character: ${master.name}${look?.name ? ` (${look.name})` : ''}` });
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
      if (job.kind === 'masterkv') {
        const out = await generateImageFromPrompt({
          prompt: job.prompt,
          settings: args.settings,
          aspectRatio: args.aspectRatio,
          strict: true,
        });
        done += 1;
        args.onEvent?.({ type: 'success', job, done, total, imageUrl: out.imageUrl, debug: out.debug });
        return;
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
        done += 1;
        args.onEvent?.({ type: 'success', job, done, total, imageUrl: out.imageUrl, debug: out.debug });
        return;
      }

      if (job.kind === 'location') {
        const story = args.getStoryForRefs?.() || null;
        const out = await generateImageFromPrompt({
          prompt: job.prompt,
          settings: args.settings,
          aspectRatio: args.aspectRatio,
          references: story?.keyVisualUrl ? [{ url: story.keyVisualUrl, label: 'master kv' }] : [],
          strict: true,
        });
        done += 1;
        args.onEvent?.({ type: 'success', job, done, total, imageUrl: out.imageUrl, debug: out.debug });
        return;
      }

      if (job.kind === 'character') {
        const story = args.getStoryForRefs?.() || null;
        const out = await generateImageFromPrompt({
          prompt: job.prompt,
          settings: args.settings,
          aspectRatio: '1:1',
          references: story?.keyVisualUrl ? [{ url: story.keyVisualUrl, label: 'master kv' }] : [],
          strict: true,
        });
        done += 1;
        args.onEvent?.({ type: 'success', job, done, total, imageUrl: out.imageUrl, debug: out.debug });
        return;
      }

      // look (use avatar as reference to keep identity consistent)
      const story = args.getStoryForRefs?.() || null;
      const ch = story ? (story.characters || []).find((c) => c.id === job.characterId) : null;
      const out = await generateImageFromPrompt({
        prompt:
          job.prompt +
          '\n\nUse the provided reference image(s) to keep the exact same character identity. Only vary styling described for this look.',
        settings: args.settings,
        aspectRatio: '1:1',
        references: [
          ...(story?.keyVisualUrl ? [{ url: story.keyVisualUrl, label: 'master kv' }] : []),
          ...(ch?.avatarUrl ? [{ url: ch.avatarUrl, label: `character base: ${ch.name}` }] : []),
        ],
        strict: true,
      });
      done += 1;
      args.onEvent?.({ type: 'success', job, done, total, imageUrl: out.imageUrl, debug: out.debug });
    } catch (e) {
      done += 1;
      errors += 1;
      args.onEvent?.({ type: 'error', job, done, total, error: e instanceof Error ? e.message : String(e) });
    }
  };

  // Run in dependency order so keyframes can reference generated assets:
  // masterkv -> environments -> character base -> looks -> shots
  const orderedPhases: Array<AssetJob['kind']> = ['masterkv', 'location', 'character', 'look', 'shot'];
  for (const kind of orderedPhases) {
    const phase = args.jobs.filter((j) => j.kind === kind);
    if (!phase.length) continue;
    await runPool(phase, args.concurrency ?? 2, worker);
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
