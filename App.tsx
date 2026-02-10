
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import { Sidebar } from './components/Layout/Sidebar';
import { ScriptEditorModal } from './components/Stage/ScriptEditorModal';
import { DirectorConsole } from './components/Console/DirectorConsole';
import { InspectorPanel } from './components/Inspector/InspectorPanel';
import { MasterPlayer } from './components/Player/MasterPlayer';
import { CharacterEditor } from './components/Stage/CharacterEditor';
import { LocationEditor } from './components/Stage/LocationEditor';
import { ProjectCreationWizard } from './components/Stage/ProjectCreationWizard';
import { ProjectDashboard } from './components/Stage/ProjectDashboard';
import { ProjectLibrary } from './components/Stage/ProjectLibrary';
import { ShotEditor } from './components/Stage/ShotEditor';
import { StageView } from './components/Stage/StageView';
import { AiSettingsModal } from './components/Settings/AiSettingsModal';
import { StartProductionModal } from './components/Production/StartProductionModal';
import { DebugPanel } from './components/Debug/DebugPanel';
import { ImageLightbox } from './components/Overlay/ImageLightbox';
import { createDemoProject, loadWorkspace, saveWorkspace } from './lib/workspaceStorage';
import { normalizeStorySceneModel } from './lib/story/sceneModel';
import { loadAiSettings, saveAiSettings } from './lib/ai/aiSettingsStorage';
import { runDirectorCommand, runDirectorCommandStream, type DirectorCommandResponse, type DirectorStreamEvent } from './lib/ai/agent/direct';
import { isAgentApiError } from './lib/ai/agent/apiError';
import { addDebugEvent } from './lib/debug/eventLog';
import { buildCharacterAvatarPrompt, buildCharacterLookPrompt, buildLocationPreviewPrompt } from './lib/ai/prompts';
import { getCharacterActiveAvatarUrl, getLookActivePreviewUrl, isLikelyPlaceholderImageUrl } from './lib/ai/assetRefs';
import { applyAssetBlocked, applyAssetError, applyAssetQueued, applyAssetResult, applyAssetStart, buildAssetJobs, executeAssetJobs, type AssetJob } from './lib/ai/assetExecutor';
import { generateVideoFromImage } from './lib/ai/video/generate';
import { buildActingDirection, composeStructuredVideoPrompt, extractDialogueLines, resolveVideoSourceBundle } from './lib/ai/videoPromptComposer';
import { getOrCreateVisionUserId, getVisionUserRequestHeaders } from './lib/userSession';
import { appendProjectTransferLog, buildProjectExportEnvelope, parseProjectImportText } from './lib/projectTransfer';
import { IMAGES } from './constants';
import {
  AgentAction,
  AgentLogEntry,
  AgentPlan,
  AiSettings,
  Character,
  DialogueLine,
  ElementType,
  Location,
  SelectionState,
  Sequence,
  Shot,
  Story,
  WorkspaceState,
} from './types';

type Screen = 'library' | 'creation' | 'project';

interface DirectorApplyResult {
  applied: number;
  dropped: number;
  droppedActions: AgentAction[];
  deferredJobs?: AssetJob[];
  scopeLabel?: string;
  concurrency?: number;
  storyAfterUpdates?: Story;
}

interface PendingInteractionGeneration {
  id: string;
  projectId: string;
  jobs: AssetJob[];
  scopeLabel: string;
  concurrency: number;
  story: Story;
}

const cloneStory = (story: Story): Story => JSON.parse(JSON.stringify(story)) as Story;
const STALE_GENERATION_MAX_AGE_MS = 30 * 60_000;
const STALE_PRODUCTION_MAX_AGE_MS = 60 * 60_000;
const GENERATED_PREFIX = '/__generated__/';

const collectGeneratedAssetUrlsFromStory = (story: Story): string[] => {
  const out = new Set<string>();
  const push = (raw: unknown) => {
    const v = String(raw || '').trim();
    if (!v || !v.startsWith(GENERATED_PREFIX)) return;
    out.add(v.split('?')[0].split('#')[0]);
  };

  push((story as any)?.keyVisualUrl);
  for (const kv of (story as any)?.keyVisualVersions || []) push((kv as any)?.imageUrl);

  for (const loc of story.locations || []) {
    push((loc as any)?.previewUrl);
    for (const v of (loc as any)?.previewVersions || []) push((v as any)?.imageUrl);
  }

  for (const ch of story.characters || []) {
    push((ch as any)?.avatarUrl);
    for (const v of (ch as any)?.avatarVersions || []) push((v as any)?.imageUrl);
    for (const lk of ch.looks || []) {
      push((lk as any)?.previewUrl);
      for (const v of (lk as any)?.previewVersions || []) push((v as any)?.imageUrl);
    }
  }

  for (const seq of story.sequences || []) {
    for (const sh of seq.shots || []) {
      push((sh as any)?.thumbnailUrl);
      for (const v of (sh as any)?.versions || []) {
        push((v as any)?.imageUrl);
        const meta: any = (v as any)?.metadata || {};
        for (const r of meta?.references || []) push((r as any)?.url);
        push(meta?.source?.originalImageUrl);
        push(meta?.source?.refinedImageUrl);
        for (const p of meta?.panelGroup?.panels || []) {
          push((p as any)?.imageUrl);
          push((p as any)?.originalImageUrl);
          push((p as any)?.refinedImageUrl);
          for (const r of (p as any)?.refine?.references || []) push((r as any)?.url);
        }
      }
      for (const pv of (sh as any)?.production?.variants || []) {
        push((pv as any)?.videoUrl);
        push((pv as any)?.metadata?.sourceImageUrl);
        for (const r of (pv as any)?.metadata?.referenceImageUrls || []) push(r);
      }
      push((sh as any)?.production?.videoUrl);
    }
  }

  return Array.from(out);
};

const assetJobKey = (projectId: string, job: AssetJob): string => {
  if (job.kind === 'masterkv') return `${projectId}|masterkv`;
  if (job.kind === 'location') return `${projectId}|location|${job.locationId}`;
  if (job.kind === 'character') return `${projectId}|character|${job.characterId}`;
  if (job.kind === 'look') return `${projectId}|look|${job.characterId}|${job.lookId}`;
  return `${projectId}|shot|${job.sequenceId}|${job.shot.id}`;
};

const recoverAssetStateIfStale = (state: any, now: number, fallbackTs: number): { next: any; fixed: boolean } => {
  if (!state) return { next: state, fixed: false };
  const status = String(state.status || '').toLowerCase();
  if (status !== 'queued' && status !== 'running') return { next: state, fixed: false };
  const ts = typeof state.lastAttemptAt === 'number' ? state.lastAttemptAt : fallbackTs;
  if (!ts || now - ts < STALE_GENERATION_MAX_AGE_MS) return { next: state, fixed: false };
  return {
    next: {
      ...state,
      status: 'error',
      lastAttemptAt: ts,
      lastError: String(state.lastError || 'Recovered from stale generation state. Please retry generation.'),
    },
    fixed: true,
  };
};

const recoverProductionStateIfStale = (production: any, now: number, fallbackTs: number): { next: any; fixed: boolean } => {
  if (!production || typeof production !== 'object') return { next: production, fixed: false };
  const status = String(production.status || '').toLowerCase();
  if (status !== 'queued' && status !== 'running') return { next: production, fixed: false };
  const ts = typeof production.lastStartedAt === 'number' ? production.lastStartedAt : fallbackTs;
  if (!ts || now - ts < STALE_PRODUCTION_MAX_AGE_MS) return { next: production, fixed: false };
  return {
    next: {
      ...production,
      status: 'error',
      lastStartedAt: ts,
      lastError: String(production.lastError || 'Recovered from stale production state. Please retry generation.'),
    },
    fixed: true,
  };
};

const recoverStoryStaleGenerationStates = (
  story: Story,
  now: number,
  opts?: { activeAssetKeys?: Set<string>; activeProductionKeys?: Set<string> },
): { next: Story; fixedCount: number } => {
  const fallbackTs =
    (typeof story.updatedAt === 'number' && story.updatedAt) ||
    (typeof story.createdAt === 'number' && story.createdAt) ||
    now;
  const activeAssetKeys = opts?.activeAssetKeys || new Set<string>();
  const activeProductionKeys = opts?.activeProductionKeys || new Set<string>();
  const storyId = String(story.id || '');
  let fixedCount = 0;

  const master = activeAssetKeys.has(`${storyId}|masterkv`)
    ? { next: (story as any).masterKvState, fixed: false }
    : recoverAssetStateIfStale((story as any).masterKvState, now, fallbackTs);
  if (master.fixed) fixedCount += 1;

  const locations = (story.locations || []).map((loc) => {
    const locKey = `${storyId}|location|${String((loc as any)?.id || '')}`;
    if (activeAssetKeys.has(locKey)) return loc;
    const rec = recoverAssetStateIfStale((loc as any).assetState, now, fallbackTs);
    if (rec.fixed) fixedCount += 1;
    return rec.fixed ? { ...loc, assetState: rec.next } : loc;
  });

  const characters = (story.characters || []).map((ch) => {
    const charId = String((ch as any)?.id || '');
    const charKey = `${storyId}|character|${charId}`;
    const rec = activeAssetKeys.has(charKey)
      ? { next: (ch as any).assetState, fixed: false }
      : recoverAssetStateIfStale((ch as any).assetState, now, fallbackTs);
    if (rec.fixed) fixedCount += 1;
    const looks = (ch.looks || []).map((lk) => {
      const lookKey = `${storyId}|look|${charId}|${String((lk as any)?.id || '')}`;
      if (activeAssetKeys.has(lookKey)) return lk;
      const lookRec = recoverAssetStateIfStale((lk as any).assetState, now, fallbackTs);
      if (lookRec.fixed) fixedCount += 1;
      return lookRec.fixed ? { ...lk, assetState: lookRec.next } : lk;
    });
    if (rec.fixed || looks !== ch.looks) return { ...ch, assetState: rec.next, looks };
    return ch;
  });

  const sequences = (story.sequences || []).map((seq) => {
    const shots = (seq.shots || []).map((shot) => {
      const shotKey = `${storyId}|shot|${String((seq as any)?.id || '')}|${String((shot as any)?.id || '')}`;
      const productionKey = `${storyId}|${String((seq as any)?.id || '')}|${String((shot as any)?.id || '')}`;
      const rec = activeAssetKeys.has(shotKey)
        ? { next: (shot as any).assetState, fixed: false }
        : recoverAssetStateIfStale((shot as any).assetState, now, fallbackTs);
      const prodRec = activeProductionKeys.has(productionKey)
        ? { next: (shot as any).production, fixed: false }
        : recoverProductionStateIfStale((shot as any).production, now, fallbackTs);
      const shotTs =
        (typeof (shot as any)?.assetState?.lastAttemptAt === 'number' && (shot as any).assetState.lastAttemptAt) || fallbackTs;
      const staleAi =
        !activeAssetKeys.has(shotKey) &&
        (shot.aiState === 'rendering' || shot.aiState === 'thinking') &&
        now - shotTs >= STALE_GENERATION_MAX_AGE_MS;
      if (rec.fixed || staleAi || prodRec.fixed) {
        if (rec.fixed) fixedCount += 1;
        if (staleAi) fixedCount += 1;
        if (prodRec.fixed) fixedCount += 1;
        return {
          ...shot,
          aiState: staleAi ? 'idle' : shot.aiState,
          aiPrompt: staleAi ? '' : shot.aiPrompt,
          assetState: rec.fixed ? rec.next : shot.assetState,
          production: prodRec.fixed ? prodRec.next : shot.production,
        };
      }
      return shot;
    });
    return shots !== seq.shots ? { ...seq, shots } : seq;
  });

  if (fixedCount === 0) return { next: story, fixedCount: 0 };
  return {
    next: {
      ...story,
      masterKvState: master.fixed ? master.next : (story as any).masterKvState,
      locations,
      characters,
      sequences,
      updatedAt: now,
    },
    fixedCount,
  };
};

const mergeIncomingStoryPreferRealPreviews = (incoming: Story, existing?: Story | null): Story => {
  if (!existing || existing.id !== incoming.id) return incoming;
  const pickUrl = (nextUrl: string, prevUrl: string) => {
    const n = String(nextUrl || '').trim();
    const p = String(prevUrl || '').trim();
    const nReal = n && !isLikelyPlaceholderImageUrl(n);
    const pReal = p && !isLikelyPlaceholderImageUrl(p);
    if (nReal) return n;
    if (pReal) return p;
    return n || p;
  };
  const mergeVersions = (nextVersions: any[], prevVersions: any[]) => {
    const rank = (v: any) => {
      const type = String(v?.type || '').trim();
      const url = String(v?.imageUrl || '').trim();
      const nonPlaceholderType = type !== 'placeholder';
      const realUrl = Boolean(url) && !isLikelyPlaceholderImageUrl(url);
      return (realUrl ? 2 : 0) + (nonPlaceholderType ? 1 : 0);
    };
    const pickBetter = (a: any, b: any) => {
      const ra = rank(a);
      const rb = rank(b);
      if (rb > ra) return b;
      if (ra > rb) return a;
      const ta = Number(a?.createdAt || 0);
      const tb = Number(b?.createdAt || 0);
      if (tb > ta) return b;
      return a;
    };
    const map = new Map<string, any>();
    const all = [...(Array.isArray(nextVersions) ? nextVersions : []), ...(Array.isArray(prevVersions) ? prevVersions : [])];
    for (const v of all) {
      const key = String(v?.id || '') || String(v?.imageUrl || '');
      if (!key) continue;
      const cur = map.get(key);
      map.set(key, cur ? pickBetter(cur, v) : v);
    }
    return Array.from(map.values()).sort((a: any, b: any) => Number(a?.createdAt || 0) - Number(b?.createdAt || 0));
  };
  const nextSequences = (incoming.sequences || []).map((seq) => {
    const prevSeq = (existing.sequences || []).find((s) => s.id === seq.id);
    if (!prevSeq) return seq;
    return {
      ...seq,
      shots: (seq.shots || []).map((shot) => {
        const prevShot = (prevSeq.shots || []).find((s) => s.id === shot.id);
        if (!prevShot) return shot;
        const nextThumb = pickUrl(String((shot as any).thumbnailUrl || ''), String((prevShot as any).thumbnailUrl || ''));
        const nextVersions = mergeVersions((shot as any).versions || [], (prevShot as any).versions || []);
        const currentActive = nextVersions.find((v: any) => String(v?.id || '') === String((shot as any).activeVersionId || ''));
        const prevActive = nextVersions.find((v: any) => String(v?.id || '') === String((prevShot as any).activeVersionId || ''));
        const currentActiveReal = Boolean(currentActive?.imageUrl) && !isLikelyPlaceholderImageUrl(String(currentActive.imageUrl));
        const prevActiveReal = Boolean(prevActive?.imageUrl) && !isLikelyPlaceholderImageUrl(String(prevActive.imageUrl));
        const activeVersionId =
          currentActiveReal || !prevActiveReal ? (shot as any).activeVersionId : (prevShot as any).activeVersionId;
        return {
          ...shot,
          thumbnailUrl: nextThumb,
          versions: nextVersions,
          activeVersionId,
        } as any;
      }),
    };
  });
  return {
    ...incoming,
    sequences: nextSequences,
  };
};

function renumberShots(shots: Shot[]): Shot[] {
  return shots.map((s, idx) => ({ ...s, sequence: idx + 1 }));
}

function normalizeShotDurationSeconds(raw: unknown): 4 | 6 | 8 {
  let n = Number(raw);
  if (!Number.isFinite(n)) return 4;
  // Some agent payloads may pass milliseconds.
  if (n > 60) n = Math.round(n / 1000);
  const rounded = Math.round(n);
  if (rounded <= 5) return 4;
  if (rounded <= 7) return 6;
  return 8;
}

const preferTerminalStatus = (a: string, b: string) => {
  const terminal = new Set(['done', 'error', 'blocked']);
  const aTerm = terminal.has(String(a || '').toLowerCase());
  const bTerm = terminal.has(String(b || '').toLowerCase());
  if (aTerm && !bTerm) return true;
  if (!aTerm && bTerm) return false;
  return false;
};

const mergeAssetGenerationState = (current: any, incoming: any) => {
  if (!current) return incoming;
  if (!incoming) return current;
  const currentTs = Number(current?.lastAttemptAt || 0);
  const incomingTs = Number(incoming?.lastAttemptAt || 0);
  if (incomingTs > currentTs) return incoming;
  if (currentTs > incomingTs) return current;
  return preferTerminalStatus(String(current?.status || ''), String(incoming?.status || '')) ? current : incoming;
};

const mergeShotProductionState = (current: any, incoming: any) => {
  if (!current) return incoming;
  if (!incoming) return current;
  const score = (p: any) => Math.max(Number(p?.lastCompletedAt || 0), Number(p?.lastStartedAt || 0));
  const currentScore = score(current);
  const incomingScore = score(incoming);
  if (incomingScore > currentScore) return incoming;
  if (currentScore > incomingScore) return current;
  return preferTerminalStatus(String(current?.status || ''), String(incoming?.status || '')) ? current : incoming;
};

function createBlankShot(
  story: Story,
  seq: Sequence,
  init?: Partial<Pick<Shot, 'locationId' | 'timeOfDay' | 'description' | 'duration'>>,
): Shot {
  const now = Date.now();
  const fallbackLocationId = story.locations[0]?.id || '';
  const shotNumber = seq.shots.length + 1;
  const thumb = IMAGES.SHOT_WIDE;

  return {
    id: `shot-${now}-${Math.random().toString(16).slice(2, 8)}`,
    sequence: shotNumber,
    locationId: init?.locationId || fallbackLocationId,
    timeOfDay: init?.timeOfDay || 'Day',
    description: init?.description || 'New shot',
    duration: normalizeShotDurationSeconds(init?.duration),
    thumbnailUrl: thumb,
    activeVersionId: 'v1',
    versions: [{ id: 'v1', imageUrl: thumb, createdAt: now, type: 'placeholder' }],
    elements: {
      [ElementType.SCRIPT]: { type: ElementType.SCRIPT, prompt: '', status: 'auto' },
      [ElementType.CASTING]: { type: ElementType.CASTING, prompt: '', status: 'manual', metadata: { characters: [] } },
      [ElementType.CAMERA]: { type: ElementType.CAMERA, prompt: 'Narrative shot', status: 'auto' },
      [ElementType.LIGHTING]: { type: ElementType.LIGHTING, prompt: 'Scene-consistent lighting', status: 'auto' },
      [ElementType.AUDIO]: { type: ElementType.AUDIO, prompt: 'Ambient sound', status: 'auto' },
    },
    aiState: 'idle',
    production: { status: 'idle' },
  };
}

const applyActionsToStory = (story: Story, actions: AgentAction[]): Story => {
  const normalizeReferenceImages = (list: any[]) =>
    (Array.isArray(list) ? list : [])
      .slice(0, 4)
      .map((r) => ({
        id: String(r?.id || `ref-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
        url: String(r?.url || ''),
        name: r?.name ? String(r.name) : undefined,
        createdAt: typeof r?.createdAt === 'number' ? r.createdAt : Date.now(),
      }))
      .filter((r) => r.url);

  const getSeqScenes = (seq: Sequence) => {
    const scenes = Array.isArray((seq as any).scenes) ? ((seq as any).scenes as any[]) : [];
    if (scenes.length) return scenes;
    return [{ id: `${seq.id}-scene-1`, title: 'Scene 1', shots: Array.isArray(seq.shots) ? seq.shots : [] }];
  };
  const syncSequenceFromScenes = (seq: Sequence, rawScenes: any[]): Sequence => {
    const scenes = (Array.isArray(rawScenes) ? rawScenes : [])
      .map((sc: any, idx: number) => ({
        id: String(sc?.id || `${seq.id}-scene-${idx + 1}`),
        title: String(sc?.title || `Scene ${idx + 1}`),
        summary: typeof sc?.summary === 'string' ? sc.summary : undefined,
        shots: Array.isArray(sc?.shots) ? sc.shots : [],
      }))
      .filter((sc: any) => Array.isArray(sc.shots));
    const nonEmpty = scenes.filter((sc: any) => sc.shots.length > 0);
    const safeScenes = nonEmpty.length ? nonEmpty : [{ id: `${seq.id}-scene-1`, title: 'Scene 1', shots: [] }];
    const flat = renumberShots(safeScenes.flatMap((sc: any) => sc.shots || []));
    const byId = new Map(flat.map((s) => [s.id, s]));
    const syncedScenes = safeScenes.map((sc: any) => ({
      ...sc,
      shots: (sc.shots || []).map((s: any) => byId.get(String(s?.id || '')) || s).filter(Boolean),
    }));
    return { ...seq, scenes: syncedScenes as any, shots: flat };
  };
  const syncSequenceFromShots = (seq: Sequence, nextShots: Shot[]): Sequence => {
    const ordered = renumberShots(nextShots);
    const byId = new Map(ordered.map((s) => [s.id, s]));
    const existing = getSeqScenes(seq);
    const assigned = new Set<string>();
    const remapped = existing.map((sc: any) => {
      const keep = (Array.isArray(sc?.shots) ? sc.shots : [])
        .map((s: any) => byId.get(String(s?.id || '')))
        .filter(Boolean) as Shot[];
      for (const s of keep) assigned.add(String(s.id));
      return { ...sc, shots: keep };
    });
    const remaining = ordered.filter((s) => !assigned.has(String(s.id)));
    if (remaining.length) {
      if (remapped.length) {
        const last = remapped[remapped.length - 1];
        remapped[remapped.length - 1] = { ...last, shots: [...(last.shots || []), ...remaining] };
      } else {
        remapped.push({ id: `${seq.id}-scene-1`, title: 'Scene 1', shots: remaining });
      }
    }
    return syncSequenceFromScenes(seq, remapped);
  };

  const nextStory = actions.reduce((acc: Story, action) => {
    if (action.type === 'UPDATE_STORY') {
      const patch = action.payload?.patch || action.payload || {};
      let next: Story = {
        ...acc,
        title: typeof patch.title === 'string' ? patch.title : acc.title,
        logline: typeof patch.logline === 'string' ? patch.logline : acc.logline,
        intent: typeof patch.intent === 'string' ? patch.intent : acc.intent,
        styleGuide: typeof patch.styleGuide === 'string' ? patch.styleGuide : acc.styleGuide,
        keyVisualUrl: typeof patch.keyVisualUrl === 'string' ? patch.keyVisualUrl : acc.keyVisualUrl,
        referenceImages: Array.isArray(patch.referenceImages) ? normalizeReferenceImages(patch.referenceImages) : acc.referenceImages,
        referenceMode: patch.referenceMode === 'auto' || patch.referenceMode === 'off' ? patch.referenceMode : acc.referenceMode,
        proposedStyleGuide: typeof patch.styleGuide === 'string' ? '' : (acc as any).proposedStyleGuide,
        proposedStyleGuideUpdatedAt:
          typeof patch.styleGuide === 'string' ? Date.now() : (acc as any).proposedStyleGuideUpdatedAt,
        proposedStyleGuideSourceKvVersionId:
          typeof patch.styleGuide === 'string' ? '' : (acc as any).proposedStyleGuideSourceKvVersionId,
        updatedAt: Date.now(),
      };

      if (typeof patch.keyVisualUrl === 'string') {
        const url = String(patch.keyVisualUrl || '').trim();
        if (url) {
          const now = Date.now();
          const rand = () => Math.random().toString(16).slice(2, 8);
          const existing = Array.isArray((acc as any).keyVisualVersions) ? (acc as any).keyVisualVersions : [];
          const seededBase =
            !existing.length && acc.keyVisualUrl && String(acc.keyVisualUrl) !== url
              ? [
                  {
                    id: `kv-seed-${now}-${rand()}`,
                    imageUrl: String(acc.keyVisualUrl),
                    createdAt: now,
                    type: isLikelyPlaceholderImageUrl(String(acc.keyVisualUrl)) ? 'placeholder' : 'base',
                  },
                ]
              : [];
          const baseRaw = existing.length ? existing : seededBase;
          const isPlaceholder = isLikelyPlaceholderImageUrl(url);
          const base = isPlaceholder ? baseRaw : baseRaw.filter((v: any) => String(v?.type || '') !== 'placeholder');
          const id = `kv-${now}-${rand()}`;
          const versions = [...base, { id, imageUrl: url, createdAt: now, type: base.length ? 'variation' : 'base' }];
          next = {
            ...next,
            keyVisualVersions: versions as any,
            activeKeyVisualVersionId: id as any,
            masterKvState: {
              ...(acc as any).masterKvState,
              status: isPlaceholder ? ((acc as any).masterKvState?.status || 'idle') : 'done',
              lastError: isPlaceholder ? 'Active KV is a placeholder; generate a real Master KV.' : '',
            },
          };
        }
      }

      return next;
    }

    if (action.type === 'CREATE_SEQUENCE') {
      const now = Date.now();
      const title = typeof action.payload?.title === 'string' ? action.payload.title : 'New Story Part';
      const context = typeof action.payload?.context === 'string' ? action.payload.context : 'Describe the narrative beat...';
      const newSeq: Sequence = {
        id: `seq-${now}-${Math.random().toString(16).slice(2, 8)}`,
        title,
        context,
        scenes: [{ id: `scene-${now}-1`, title: 'Scene 1', shots: [] }],
        shots: [],
      };
      return { ...acc, sequences: [...acc.sequences, newSeq], updatedAt: Date.now() };
    }

    if (action.type === 'RENAME_SEQUENCE') {
      const sequenceId = String(action.payload?.sequenceId || '');
      const title = action.payload?.title;
      if (!sequenceId || typeof title !== 'string') return acc;
      return {
        ...acc,
        sequences: acc.sequences.map((s) => (s.id === sequenceId ? { ...s, title } : s)),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'DELETE_SEQUENCE') {
      const sequenceId = String(action.payload?.sequenceId || '');
      if (!sequenceId) return acc;
      return { ...acc, sequences: acc.sequences.filter((s) => s.id !== sequenceId), updatedAt: Date.now() };
    }

    if (action.type === 'CREATE_SCENE') {
      const sequenceId = String(action.payload?.sequenceId || '');
      if (!sequenceId) return acc;
      const title = typeof action.payload?.title === 'string' ? String(action.payload.title).trim() : '';
      const summary = typeof action.payload?.summary === 'string' ? String(action.payload.summary).trim() : '';
      const afterSceneId = action.payload?.afterSceneId ? String(action.payload.afterSceneId) : '';
      return {
        ...acc,
        sequences: acc.sequences.map((seq) => {
          if (seq.id !== sequenceId) return seq;
          const scenes = getSeqScenes(seq).slice();
          const now = Date.now();
          const newScene = {
            id: `scene-${now}-${Math.random().toString(16).slice(2, 8)}`,
            title: title || `Scene ${scenes.length + 1}`,
            summary: summary || undefined,
            shots: [],
          };
          let insertAt = scenes.length;
          if (afterSceneId) {
            const idx = scenes.findIndex((sc: any) => String(sc?.id || '') === afterSceneId);
            if (idx >= 0) insertAt = idx + 1;
          }
          scenes.splice(insertAt, 0, newScene);
          return syncSequenceFromScenes(seq, scenes);
        }),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'RENAME_SCENE' || action.type === 'UPDATE_SCENE') {
      const sequenceId = String(action.payload?.sequenceId || '');
      const sceneId = String(action.payload?.sceneId || '');
      if (!sequenceId || !sceneId) return acc;
      const patch = action.type === 'UPDATE_SCENE' ? action.payload?.patch || {} : { title: action.payload?.title };
      return {
        ...acc,
        sequences: acc.sequences.map((seq) => {
          if (seq.id !== sequenceId) return seq;
          const scenes = getSeqScenes(seq).map((sc: any) => {
            if (String(sc?.id || '') !== sceneId) return sc;
            return {
              ...sc,
              title: typeof patch?.title === 'string' ? patch.title : sc.title,
              summary: typeof patch?.summary === 'string' ? patch.summary : sc.summary,
            };
          });
          return syncSequenceFromScenes(seq, scenes);
        }),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'DELETE_SCENE') {
      const sequenceId = String(action.payload?.sequenceId || '');
      const sceneId = String(action.payload?.sceneId || '');
      if (!sequenceId || !sceneId) return acc;
      return {
        ...acc,
        sequences: acc.sequences.map((seq) => {
          if (seq.id !== sequenceId) return seq;
          const scenes = getSeqScenes(seq).slice();
          const idx = scenes.findIndex((sc: any) => String(sc?.id || '') === sceneId);
          if (idx < 0) return seq;
          const removed = scenes[idx];
          const carry = Array.isArray(removed?.shots) ? removed.shots : [];
          scenes.splice(idx, 1);
          if (!scenes.length) scenes.push({ id: `${seq.id}-scene-1`, title: 'Scene 1', shots: [] });
          const targetIdx = Math.max(0, Math.min(idx, scenes.length - 1));
          scenes[targetIdx] = { ...scenes[targetIdx], shots: [...(scenes[targetIdx].shots || []), ...carry] };
          return syncSequenceFromScenes(seq, scenes);
        }),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'CREATE_SHOT') {
      const sequenceId = String(action.payload?.sequenceId || '');
      if (!sequenceId) return acc;
      const afterShotId = action.payload?.afterShotId ? String(action.payload.afterShotId) : undefined;
      const rawDuration = action.payload?.duration;
      const normalizedDuration = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? normalizeShotDurationSeconds(rawDuration) : undefined;
      const init = {
        locationId: action.payload?.locationId ? String(action.payload.locationId) : undefined,
        timeOfDay: action.payload?.timeOfDay ? String(action.payload.timeOfDay) : undefined,
        description: action.payload?.description ? String(action.payload.description) : undefined,
        duration: normalizedDuration,
      };
      return {
        ...acc,
        sequences: acc.sequences.map((seq) => {
          if (seq.id !== sequenceId) return seq;
          const newShot = createBlankShot(acc, seq, init);
          const patchPrompt = (el: ElementType, promptKey: string) => {
            const val = action.payload?.[promptKey];
            if (typeof val !== 'string') return;
            const nextPrompt = String(val).trim();
            if (!nextPrompt) return;
            (newShot.elements as any)[el] = { ...(newShot.elements as any)[el], prompt: nextPrompt, status: 'manual' };
          };
          patchPrompt(ElementType.SCRIPT, 'script');
          patchPrompt(ElementType.CAMERA, 'camera');
          patchPrompt(ElementType.LIGHTING, 'lighting');
          patchPrompt(ElementType.AUDIO, 'audio');
          if (typeof action.payload?.visualStyle === 'string' && action.payload.visualStyle.trim()) {
            const v = String(action.payload.visualStyle).trim();
            (newShot.elements as any)[ElementType.CAMERA] = {
              ...(newShot.elements as any)[ElementType.CAMERA],
              prompt: v,
              status: 'manual',
              metadata: { ...((newShot.elements as any)[ElementType.CAMERA]?.metadata || {}), videoPrompt: v },
            };
          }
          if (typeof action.payload?.videoPrompt === 'string') {
            const v = String(action.payload.videoPrompt || '').trim();
            if (v) {
              (newShot.elements as any)[ElementType.CAMERA] = {
                ...(newShot.elements as any)[ElementType.CAMERA],
                metadata: { ...((newShot.elements as any)[ElementType.CAMERA]?.metadata || {}), videoPrompt: v },
                status: 'manual',
              };
            }
          }
          const castSource = Array.isArray(action.payload?.cast)
            ? action.payload.cast
            : Array.isArray(action.payload?.characterIds)
              ? action.payload.characterIds.map((id: any) => ({ id: String(id || '') }))
              : action.payload?.characterId
                ? [{ id: String(action.payload.characterId), activeLookId: action.payload.lookId ? String(action.payload.lookId) : '' }]
                : null;
          if (castSource) {
            const cast = castSource
              .map((c: any) => ({ id: String(c?.id || ''), activeLookId: c?.activeLookId ? String(c.activeLookId) : '' }))
              .filter((c: any) => c.id);
            (newShot.elements as any)[ElementType.CASTING] = {
              ...(newShot.elements as any)[ElementType.CASTING],
              status: 'manual',
              metadata: { ...((newShot.elements as any)[ElementType.CASTING]?.metadata || {}), characters: cast },
            };
          }
          const sceneId = action.payload?.sceneId ? String(action.payload.sceneId) : '';
          const scenes = getSeqScenes(seq).map((sc: any) => ({
            ...sc,
            shots: Array.isArray(sc?.shots) ? sc.shots.slice() : [],
          }));
          let target = sceneId ? scenes.find((sc: any) => String(sc?.id || '') === sceneId) : null;
          if (!target && afterShotId) {
            target = scenes.find((sc: any) => (Array.isArray(sc?.shots) ? sc.shots : []).some((s: any) => String(s?.id || '') === afterShotId)) || null;
          }
          if (!target) target = scenes[scenes.length - 1] || scenes[0];
          if (!target) {
            scenes.push({ id: `${seq.id}-scene-1`, title: 'Scene 1', shots: [newShot] });
            return syncSequenceFromScenes(seq, scenes);
          }
          let insertAt = target.shots.length;
          if (afterShotId) {
            const idx = target.shots.findIndex((s: any) => String(s?.id || '') === afterShotId);
            if (idx >= 0) insertAt = idx + 1;
          }
          target.shots.splice(insertAt, 0, newShot);
          return syncSequenceFromScenes(seq, scenes);
        }),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'DELETE_SHOT') {
      const sequenceId = String(action.payload?.sequenceId || '');
      const shotId = String(action.payload?.shotId || '');
      if (!sequenceId || !shotId) return acc;
      return {
        ...acc,
        sequences: acc.sequences.map((seq) => {
          if (seq.id !== sequenceId) return seq;
          return syncSequenceFromShots(seq, seq.shots.filter((s) => s.id !== shotId));
        }),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'MOVE_SHOT') {
      const sequenceId = String(action.payload?.sequenceId || '');
      const shotId = String(action.payload?.shotId || '');
      if (!sequenceId || !shotId) return acc;
      const direction = action.payload?.direction === 'left' || action.payload?.direction === 'right' ? action.payload.direction : null;
      const toIndex = typeof action.payload?.toIndex === 'number' ? Math.floor(action.payload.toIndex) : null;
      return {
        ...acc,
        sequences: acc.sequences.map((seq) => {
          if (seq.id !== sequenceId) return seq;
          const idx = seq.shots.findIndex((s) => s.id === shotId);
          if (idx < 0) return seq;
          const next = seq.shots.slice();
          const [item] = next.splice(idx, 1);
          if (!item) return seq;
          let insertAt = idx;
          if (direction) insertAt = direction === 'left' ? Math.max(0, idx - 1) : Math.min(next.length, idx + 1);
          if (toIndex !== null) insertAt = Math.min(Math.max(0, toIndex), next.length);
          next.splice(insertAt, 0, item);
          return syncSequenceFromShots(seq, next);
        }),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'MOVE_SHOT_TO_SCENE') {
      const sequenceId = String(action.payload?.sequenceId || '');
      const shotId = String(action.payload?.shotId || '');
      const toSceneId = String(action.payload?.toSceneId || '');
      const toIndex = typeof action.payload?.toIndex === 'number' ? Math.max(0, Math.floor(action.payload.toIndex)) : null;
      if (!sequenceId || !shotId || !toSceneId) return acc;
      return {
        ...acc,
        sequences: acc.sequences.map((seq) => {
          if (seq.id !== sequenceId) return seq;
          const scenes = getSeqScenes(seq).map((sc: any) => ({
            ...sc,
            shots: Array.isArray(sc?.shots) ? sc.shots.slice() : [],
          }));
          let moved: Shot | null = null;
          for (const sc of scenes) {
            const idx = sc.shots.findIndex((s: any) => String(s?.id || '') === shotId);
            if (idx >= 0) {
              const [taken] = sc.shots.splice(idx, 1);
              if (taken) moved = taken;
              break;
            }
          }
          if (!moved) return seq;
          const target = scenes.find((sc: any) => String(sc?.id || '') === toSceneId);
          if (!target) return syncSequenceFromScenes(seq, scenes);
          if (toIndex === null || toIndex >= target.shots.length) target.shots.push(moved);
          else target.shots.splice(toIndex, 0, moved);
          return syncSequenceFromScenes(seq, scenes);
        }),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'UPDATE_SHOT') {
      const shotId = String(action.payload?.shotId || '');
      const sequenceId = action.payload?.sequenceId ? String(action.payload.sequenceId) : null;
      const patch = action.payload?.patch || {};
      if (!shotId) return acc;
      return {
        ...acc,
        sequences: acc.sequences.map((seq) => {
          if (sequenceId && seq.id !== sequenceId) return seq;
          if (!seq.shots.some((s) => s.id === shotId)) return seq;
          const nextShots = seq.shots.map((s) => {
              if (s.id !== shotId) return s;
              return {
                ...s,
                description: typeof patch.description === 'string' ? patch.description : s.description,
                timeOfDay: typeof patch.timeOfDay === 'string' ? patch.timeOfDay : s.timeOfDay,
                locationId: typeof patch.locationId === 'string' ? patch.locationId : s.locationId,
                duration: typeof patch.duration === 'number' && Number.isFinite(patch.duration) ? normalizeShotDurationSeconds(patch.duration) : s.duration,
              };
            });
          return syncSequenceFromShots(seq, nextShots);
        }),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'SET_CAST') {
      const shotId = String(action.payload?.shotId || '');
      const sequenceId = String(action.payload?.sequenceId || '');
      const cast = Array.isArray(action.payload?.cast) ? action.payload.cast : [];
      if (!shotId || !sequenceId) return acc;
      return {
        ...acc,
        sequences: acc.sequences.map((seq) => {
          if (seq.id !== sequenceId) return seq;
          const nextShots = seq.shots.map((shot) => {
              if (shot.id !== shotId) return shot;
              return {
                ...shot,
                elements: {
                  ...shot.elements,
                  [ElementType.CASTING]: {
                    ...shot.elements[ElementType.CASTING],
                    metadata: { ...(shot.elements[ElementType.CASTING].metadata || {}), characters: cast },
                    status: 'manual' as const,
                  },
                },
              };
            });
          return syncSequenceFromShots(seq, nextShots);
        }),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'CREATE_LOCATION') {
      const now = Date.now();
      const name = typeof action.payload?.name === 'string' ? action.payload.name : 'New Environment';
      const description = typeof action.payload?.description === 'string' ? action.payload.description : 'Describe the atmospheric details...';
      const visualStyle = typeof action.payload?.visualStyle === 'string' ? action.payload.visualStyle : 'Cinematic style details...';
      const newLoc: Location = {
        id: `loc-${now}-${Math.random().toString(16).slice(2, 8)}`,
        name,
        description,
        visualStyle,
        previewUrl: acc.keyVisualUrl || IMAGES.SKYBRIDGE,
        status: 'draft',
      };
      return { ...acc, locations: [...acc.locations, newLoc], updatedAt: Date.now() };
    }

    if (action.type === 'DELETE_LOCATION') {
      const locationId = String(action.payload?.locationId || '');
      if (!locationId) return acc;
      return {
        ...acc,
        locations: acc.locations.filter((l) => l.id !== locationId),
        sequences: acc.sequences.map((seq) => syncSequenceFromShots(seq, seq.shots.map((shot) => (shot.locationId === locationId ? { ...shot, locationId: '' } : shot)))),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'UPDATE_LOCATION') {
      const locationId = String(action.payload?.locationId || '');
      const patch = action.payload?.patch || {};
      if (!locationId) return acc;
      return {
        ...acc,
        locations: acc.locations.map((l) =>
          l.id === locationId
            ? {
                ...l,
                name: typeof patch.name === 'string' ? patch.name : l.name,
                description: typeof patch.description === 'string' ? patch.description : l.description,
                visualStyle: typeof patch.visualStyle === 'string' ? patch.visualStyle : l.visualStyle,
                status: patch.status === 'draft' || patch.status === 'locked' ? patch.status : l.status,
                referenceImages: Array.isArray(patch.referenceImages) ? normalizeReferenceImages(patch.referenceImages) : l.referenceImages,
                referenceMode: patch.referenceMode === 'auto' || patch.referenceMode === 'off' ? patch.referenceMode : l.referenceMode,
              }
            : l,
        ),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'CREATE_CHARACTER') {
      const now = Date.now();
      const name = typeof action.payload?.name === 'string' ? action.payload.name : 'New Character';
      const description = typeof action.payload?.description === 'string' ? action.payload.description : 'Describe physical traits and personality...';
      const newChar: Character = {
        id: `char-${now}-${Math.random().toString(16).slice(2, 8)}`,
        name,
        description,
        avatarUrl: acc.keyVisualUrl || IMAGES.SILAS,
        status: 'draft',
        looks: [],
      };
      return { ...acc, characters: [...acc.characters, newChar], updatedAt: Date.now() };
    }

    if (action.type === 'DELETE_CHARACTER') {
      const characterId = String(action.payload?.characterId || '');
      if (!characterId) return acc;
      return {
        ...acc,
        characters: acc.characters.filter((c) => c.id !== characterId),
        sequences: acc.sequences.map((seq) => syncSequenceFromShots(seq, seq.shots.map((shot) => {
            const cast = (shot.elements as any)?.[ElementType.CASTING]?.metadata?.characters;
            const castArr = Array.isArray(cast) ? cast : [];
            const nextCast = castArr.filter((c: any) => String(c?.id || '') !== characterId);
            return {
              ...shot,
              elements: {
                ...shot.elements,
                [ElementType.CASTING]: {
                  ...shot.elements[ElementType.CASTING],
                  metadata: { ...(shot.elements[ElementType.CASTING].metadata || {}), characters: nextCast },
                  status: 'manual' as const,
                },
              },
            };
          }))),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'UPDATE_CHARACTER') {
      const characterId = String(action.payload?.characterId || '');
      const patch = action.payload?.patch || action.payload || {};
      if (!characterId) return acc;
      return {
        ...acc,
        characters: acc.characters.map((c) =>
          c.id === characterId
            ? {
                ...c,
                name: typeof patch.name === 'string' ? patch.name : c.name,
                description: typeof patch.description === 'string' ? patch.description : c.description,
                status: patch.status === 'draft' || patch.status === 'locked' ? patch.status : c.status,
                referenceImages: Array.isArray(patch.referenceImages) ? normalizeReferenceImages(patch.referenceImages) : c.referenceImages,
                referenceMode: patch.referenceMode === 'auto' || patch.referenceMode === 'off' ? patch.referenceMode : c.referenceMode,
              }
            : c,
        ),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'CREATE_CHARACTER_LOOK') {
      const characterId = String(action.payload?.characterId || '');
      if (!characterId) return acc;
      const now = Date.now();
      const rawName = typeof action.payload?.name === 'string' ? action.payload.name : '';
      const rawDesc = typeof action.payload?.description === 'string' ? action.payload.description : '';
      const name = rawName.trim() ? rawName.trim() : 'New Look';
      const description = rawDesc.trim() ? rawDesc.trim() : 'Describe wardrobe and makeup...';
      return {
        ...acc,
        characters: acc.characters.map((c) => {
          if (c.id !== characterId) return c;
          const look = {
            id: `look-${now}-${Math.random().toString(16).slice(2, 8)}`,
            name,
            description,
            previewUrl: '',
            assetState: { status: 'idle', attempts: 0 },
          };
          return { ...c, looks: [...(c.looks || []), look] };
        }),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'UPDATE_CHARACTER_LOOK') {
      const raw = action.payload || {};
      let characterId = String(raw?.characterId || '');
      let lookId = String(raw?.lookId || raw?.id || '');
      let patch = raw?.patch || {};
      if ((!patch || typeof patch !== 'object') && (typeof raw?.name === 'string' || typeof raw?.description === 'string')) {
        patch = {
          name: typeof raw?.name === 'string' ? raw.name : undefined,
          description: typeof raw?.description === 'string' ? raw.description : undefined,
        };
      }
      if (!characterId && lookId) {
        const found = acc.characters.find((c) => (c.looks || []).some((l) => String(l.id) === lookId));
        if (found) characterId = String(found.id || '');
      }
      if (!characterId || !lookId) return acc;
      return {
        ...acc,
        characters: acc.characters.map((c) => {
          if (c.id !== characterId) return c;
          return {
            ...c,
            looks: (c.looks || []).map((l: any) =>
              l.id === lookId
                ? {
                    ...l,
                    name: typeof patch.name === 'string' ? patch.name : l.name,
                    description: typeof patch.description === 'string' ? patch.description : l.description,
                  }
                : l,
            ),
          };
        }),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'UPDATE_ELEMENT') {
      const { shotId, sequenceId, elementType, prompt, metadata } = action.payload || {};
      if (!shotId || !sequenceId || !elementType) return acc;
      return {
        ...acc,
        sequences: acc.sequences.map((seq) => {
          if (seq.id !== sequenceId) return seq;
          const nextShots = seq.shots.map((shot) => {
              if (shot.id !== shotId) return shot;
              const prev = shot.elements[elementType as ElementType] || null;
              const nextMetadata =
                metadata && typeof metadata === 'object' && !Array.isArray(metadata)
                  ? { ...(prev?.metadata || {}), ...metadata }
                  : prev?.metadata;
              return {
                ...shot,
                elements: {
                  ...shot.elements,
                  [elementType]: {
                    ...prev,
                    prompt: typeof prompt === 'string' ? prompt : shot.elements[elementType as ElementType]?.prompt,
                    status: 'manual' as const,
                    metadata: nextMetadata,
                  },
                },
              };
            });
          return syncSequenceFromShots(seq, nextShots);
        }),
      };
    }

    return acc;
  }, story as Story);
  return normalizeStorySceneModel(nextStory);
};

export default function App() {
  const currentUserIdRef = useRef<string>(getOrCreateVisionUserId());
  const currentUserId = currentUserIdRef.current;
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isCinemaMode, setIsCinemaMode] = useState(false);
  const [isPlayingMaster, setIsPlayingMaster] = useState(false);
  const [masterPlayerShots, setMasterPlayerShots] = useState<Shot[] | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: 'success' | 'info' }>>([]);
  const [pendingDirectorFallback, setPendingDirectorFallback] = useState<null | { projectId: string; res: DirectorCommandResponse }>(null);
  const [pendingDirectorFallbackArmed, setPendingDirectorFallbackArmed] = useState(false);
  const [pendingDirectorMultiAgentFailure, setPendingDirectorMultiAgentFailure] = useState<
    null | { projectId: string; message: string; selection: SelectionState; error: string; details?: any }
  >(null);
  const [pendingDirectorSingleFallbackArmed, setPendingDirectorSingleFallbackArmed] = useState(false);

  const [workspace, setWorkspace] = useState<WorkspaceState>(() => loadWorkspace(currentUserId));
  const [aiSettings, setAiSettings] = useState<AiSettings>(() => loadAiSettings());
  const [screen, setScreen] = useState<Screen>(() => (loadWorkspace(currentUserId).activeProjectId ? 'project' : 'library'));

  const [selection, setSelection] = useState<SelectionState>(() => ({
    type: 'story',
    id: loadWorkspace(currentUserId).activeProjectId || '',
  }));

  const [agentHistoryByProject, setAgentHistoryByProject] = useState<Record<string, AgentLogEntry[]>>({});
  const [isAiSettingsOpen, setIsAiSettingsOpen] = useState(false);
  const [productionTarget, setProductionTarget] = useState<{ sequenceId: string; shotId: string } | null>(null);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [isScriptEditorOpen, setIsScriptEditorOpen] = useState(false);
  const [isDirectorThinking, setIsDirectorThinking] = useState(false);
  const [kvConsoleActionRequest, setKvConsoleActionRequest] = useState<null | { id: number; type: 'generate' | 'accept' | 'discard' | 'regenerate' }>(null);
  const [directorStream, setDirectorStream] = useState<null | {
    status?: string;
    reply?: string;
    steps: Array<{ agent: string; ok?: boolean; ms?: number; error?: string; status?: string }>;
  }>(null);
  const [pendingInteractionGeneration, setPendingInteractionGeneration] = useState<PendingInteractionGeneration | null>(null);
  const [viewport, setViewport] = useState<{ width: number; height: number }>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1440,
    height: typeof window !== 'undefined' ? window.innerHeight : 900,
  }));
  const staleRecoveryDoneRef = useRef(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const cancelledAssetJobKeysRef = useRef<Set<string>>(new Set());
  const assetJobAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const shotProductionAbortControllersRef = useRef<Map<string, AbortController>>(new Map());

  const activeStory = useMemo<Story | null>(() => {
    if (!workspace.activeProjectId) return null;
    return workspace.projects.find((p) => p.id === workspace.activeProjectId) || null;
  }, [workspace]);
  const workspaceRef = useRef(workspace);

  const agentHistory = useMemo<AgentLogEntry[]>(() => {
    if (!workspace.activeProjectId) return [];
    return agentHistoryByProject[workspace.activeProjectId] || [];
  }, [agentHistoryByProject, workspace.activeProjectId]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isToggle = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd');
      if (isToggle) {
        e.preventDefault();
        setIsDebugOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    return () => {
      for (const ctrl of assetJobAbortControllersRef.current.values()) ctrl.abort();
      assetJobAbortControllersRef.current.clear();
      for (const ctrl of shotProductionAbortControllersRef.current.values()) ctrl.abort();
      shotProductionAbortControllersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    saveWorkspace(workspace);
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    saveAiSettings(aiSettings);
  }, [aiSettings]);

  useEffect(() => {
    if (staleRecoveryDoneRef.current) return;
    staleRecoveryDoneRef.current = true;
    if (!Array.isArray(workspace.projects) || workspace.projects.length === 0) return;
    const now = Date.now();
    const activeAssetKeys = new Set(Array.from(assetJobAbortControllersRef.current.keys()));
    const activeProductionKeys = new Set(Array.from(shotProductionAbortControllersRef.current.keys()));
    let recovered = 0;
    let changed = false;
    const nextProjects = workspace.projects.map((p) => {
      const r = recoverStoryStaleGenerationStates(p, now, { activeAssetKeys, activeProductionKeys });
      if (r.fixedCount > 0) {
        changed = true;
        recovered += r.fixedCount;
        return r.next;
      }
      return p;
    });
    if (changed) {
      setWorkspace((prev) => ({ ...prev, projects: nextProjects }));
    }
    if (recovered > 0) {
      setTimeout(() => addToast(`Recovered ${recovered} stale generation states.`, 'info'), 0);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const activeAssetKeys = new Set(Array.from(assetJobAbortControllersRef.current.keys()));
      const activeProductionKeys = new Set(Array.from(shotProductionAbortControllersRef.current.keys()));
      setWorkspace((prev) => {
        if (!Array.isArray(prev.projects) || prev.projects.length === 0) return prev;
        const now = Date.now();
        let changed = false;
        const projects = prev.projects.map((p) => {
          const r = recoverStoryStaleGenerationStates(p, now, { activeAssetKeys, activeProductionKeys });
          if (r.fixedCount > 0) {
            changed = true;
            return r.next;
          }
          return p;
        });
        return changed ? { ...prev, projects } : prev;
      });
    }, 90_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (screen === 'project' && !workspace.activeProjectId) setScreen('library');
  }, [screen, workspace.activeProjectId]);

  useEffect(() => {
    if (!workspace.activeProjectId) return;
    setSelection({ type: 'story', id: workspace.activeProjectId });
  }, [workspace.activeProjectId]);

  useEffect(() => {
    if (!pendingInteractionGeneration) return;
    if (pendingInteractionGeneration.projectId !== workspace.activeProjectId) {
      setPendingInteractionGeneration(null);
    }
  }, [workspace.activeProjectId, pendingInteractionGeneration]);

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  const addToast = (message: string, type: 'success' | 'info' = 'info') => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };

  const updateStoryById = (projectId: string, updater: (prev: Story) => Story) => {
    setWorkspace((prev) => {
      const idx = prev.projects.findIndex((p) => p.id === projectId);
      if (idx < 0) return prev;
      const now = Date.now();
      const projects = prev.projects.slice();
      projects[idx] = { ...normalizeStorySceneModel(updater(projects[idx])), updatedAt: now };
      return { ...prev, projects };
    });
  };

  const updateActiveStory = (updater: (prev: Story) => Story) => {
    setWorkspace((prev) => {
      const projectId = prev.activeProjectId;
      if (!projectId) return prev;
      const idx = prev.projects.findIndex((p) => p.id === projectId);
      if (idx < 0) return prev;

      const now = Date.now();
      const current = prev.projects[idx];
      const updated = normalizeStorySceneModel(updater(current));
      const projects = prev.projects.slice();
      projects[idx] = { ...updated, updatedAt: now };
      return { ...prev, projects };
    });
  };

  const cancelAssetJobs = (matcher: (key: string) => boolean) => {
    for (const key of Array.from(assetJobAbortControllersRef.current.keys()) as string[]) {
      if (!matcher(key)) continue;
      cancelledAssetJobKeysRef.current.add(key);
      const ctrl = assetJobAbortControllersRef.current.get(key);
      ctrl?.abort();
      assetJobAbortControllersRef.current.delete(key);
    }
  };

  const cancelShotProduction = (matcher: (key: string) => boolean) => {
    for (const key of Array.from(shotProductionAbortControllersRef.current.keys()) as string[]) {
      if (!matcher(key)) continue;
      const ctrl = shotProductionAbortControllersRef.current.get(key);
      ctrl?.abort();
      shotProductionAbortControllersRef.current.delete(key);
    }
  };

  const queueKvConsoleAction = (type: 'generate' | 'accept' | 'discard' | 'regenerate', projectId: string) => {
    setSelection({ type: 'story', id: projectId });
    setKvConsoleActionRequest({ id: Date.now() + Math.floor(Math.random() * 1000), type });
  };

  const deleteLocalGeneratedAssets = async (urls: string[]) => {
    const unique = Array.from(new Set((urls || []).map((u) => String(u || '').trim()).filter(Boolean)));
    if (!unique.length) return { deleted: 0, missing: 0, rejected: 0 };
    try {
    const res = await fetch('/api/local-assets/delete', {
        method: 'POST',
        headers: getVisionUserRequestHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ urls: unique }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as any;
      return {
        deleted: Number(data?.deleted || 0),
        missing: Number(data?.missing || 0),
        rejected: Number(data?.rejected || 0),
      };
    } catch (e) {
      addDebugEvent({
        level: 'warn',
        scope: 'local.assets',
        message: 'Failed to delete local generated assets',
        data: { error: e instanceof Error ? e.message : String(e), count: unique.length },
      });
      return null;
    }
  };

  // ----- Workspace / Project Library -----

  const openProject = (projectId: string) => {
    setWorkspace((prev) => {
      const now = Date.now();
      return {
        ...prev,
        activeProjectId: projectId,
        projects: prev.projects.map((p) => (p.id === projectId ? { ...p, lastOpenedAt: now } : p)),
      };
    });
    setSelection({ type: 'story', id: projectId });
    setScreen('project');
  };

  const handleRenameProject = (projectId: string) => {
    const existing = workspace.projects.find((p) => p.id === projectId);
    if (!existing) return;
    const title = window.prompt('Project title', existing.title)?.trim();
    if (!title) return;
    setWorkspace((prev) => ({
      ...prev,
      projects: prev.projects.map((p) => (p.id === projectId ? { ...p, title, updatedAt: Date.now() } : p)),
    }));
    addToast('Project renamed', 'success');
  };

  const handleDeleteProject = async (projectId: string) => {
    const existing = workspace.projects.find((p) => p.id === projectId);
    if (!existing) return;
    if (!window.confirm(`Delete project "${existing.title}"? This cannot be undone.`)) return;

    cancelledAssetJobKeysRef.current.add(`${projectId}|masterkv`);
    for (const loc of existing.locations || []) cancelledAssetJobKeysRef.current.add(`${projectId}|location|${loc.id}`);
    for (const ch of existing.characters || []) {
      cancelledAssetJobKeysRef.current.add(`${projectId}|character|${ch.id}`);
      for (const lk of ch.looks || []) cancelledAssetJobKeysRef.current.add(`${projectId}|look|${ch.id}|${lk.id}`);
    }
    for (const seq of existing.sequences || []) {
      for (const sh of seq.shots || []) cancelledAssetJobKeysRef.current.add(`${projectId}|shot|${seq.id}|${sh.id}`);
    }
    cancelAssetJobs((key) => key.startsWith(`${projectId}|`));
    cancelShotProduction((key) => key.startsWith(`${projectId}|`));
    setPendingInteractionGeneration((prev) => (prev?.projectId === projectId ? null : prev));

    setWorkspace((prev) => {
      const nextProjects = prev.projects.filter((p) => p.id !== projectId);
      const activeProjectId = prev.activeProjectId === projectId ? undefined : prev.activeProjectId;
      return { ...prev, projects: nextProjects, activeProjectId };
    });

    const deletionStats = await deleteLocalGeneratedAssets(collectGeneratedAssetUrlsFromStory(existing));
    if (workspace.activeProjectId === projectId) setScreen('library');
    if (deletionStats) {
      const extra =
        deletionStats.missing || deletionStats.rejected
          ? ` (${deletionStats.deleted} deleted, ${deletionStats.missing} missing, ${deletionStats.rejected} skipped)`
          : ` (${deletionStats.deleted} files deleted)`;
      addToast(`Project deleted${extra}`, 'info');
      return;
    }
    addToast('Project deleted', 'info');
  };

  const handleDuplicateProject = (projectId: string) => {
    const existing = workspace.projects.find((p) => p.id === projectId);
    if (!existing) return;
    const now = Date.now();
    const dup = cloneStory(existing);
    dup.id = `proj-${now}`;
    dup.title = `${existing.title} (Copy)`;
    dup.createdAt = now;
    dup.updatedAt = now;
    dup.lastOpenedAt = now;
    dup.ownerUserId = currentUserId;
    dup.source = { type: 'local' };

    setWorkspace((prev) => ({ ...prev, projects: [dup, ...prev.projects] }));
    addToast('Project duplicated', 'success');
  };

  const handleCreateDemoProject = () => {
    const demo = createDemoProject(currentUserId);
    setWorkspace((prev) => ({
      ...prev,
      projects: [demo, ...prev.projects],
      activeProjectId: demo.id,
    }));
    setSelection({ type: 'story', id: demo.id });
    setScreen('project');
    addToast('Demo project created', 'success');
  };

  const handleExportProject = (projectId: string) => {
    const existing = workspace.projects.find((p) => p.id === projectId);
    if (!existing) return;
    const envelope = buildProjectExportEnvelope(existing, currentUserId);
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json;charset=utf-8' });
    const safeTitle = String(existing.title || 'project').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 48) || 'project';
    const fileName = `${safeTitle}-${new Date().toISOString().slice(0, 10)}.vision-project.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    appendProjectTransferLog(currentUserId, {
      id: `transfer-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      kind: 'export',
      at: Date.now(),
      projectId: existing.id,
      projectTitle: existing.title,
      fileName,
      exportedByUserId: currentUserId,
    });
    addToast(`Project exported: ${fileName}`, 'success');
  };

  const handleImportProjects = async (files: FileList | File[]) => {
    const picked = Array.from(files || []).slice(0, 8);
    if (!picked.length) return;
    const importedStories: Story[] = [];
    for (const file of picked) {
      try {
        const text = await file.text();
        const parsed = parseProjectImportText(text, { currentUserId, sourceFileName: file.name });
        importedStories.push(...parsed);
      } catch (e) {
        addDebugEvent({
          level: 'warn',
          scope: 'project.import',
          message: 'Failed to parse project import file',
          data: { fileName: file.name, error: e instanceof Error ? e.message : String(e) },
        });
      }
    }
    if (!importedStories.length) {
      addToast('Import failed: no valid project found', 'info');
      return;
    }
    const now = Date.now();
    const usedIds = new Set(workspace.projects.map((p) => p.id));
    const incoming = importedStories.map((s, idx) => {
      const next = cloneStory(s);
      if (!next.id || usedIds.has(next.id)) next.id = `proj-${now}-${idx}-${Math.random().toString(16).slice(2, 6)}`;
      usedIds.add(next.id);
      next.ownerUserId = currentUserId;
      next.source = { ...(next.source || {}), type: 'imported', importedByUserId: currentUserId, importedAt: Date.now() } as any;
      return next;
    });
    setWorkspace((prev) => ({ ...prev, projects: [...incoming, ...prev.projects], activeProjectId: incoming[0]?.id || prev.activeProjectId }));
    const first = incoming[0];
    if (first?.id) {
      setSelection({ type: 'story', id: first.id });
      setScreen('project');
    }
    for (const s of incoming) {
      appendProjectTransferLog(currentUserId, {
        id: `transfer-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        kind: 'import',
        at: Date.now(),
        projectId: s.id,
        projectTitle: s.title,
        importedByUserId: currentUserId,
        exportedByUserId: s.source?.exportedByUserId,
        fileName: s.source?.sourceFileName,
      });
    }
    addToast(`Imported ${importedStories.length} project(s)`, 'success');
  };

  const upsertWorkspaceProject = (project: Story) => {
    setWorkspace((prev) => {
      const idx = prev.projects.findIndex((p) => p.id === project.id);
      if (idx < 0) return { ...prev, projects: [project, ...prev.projects] };
      const projects = prev.projects.slice();
      projects[idx] = mergeIncomingStoryPreferRealPreviews(project, projects[idx]);
      return { ...prev, projects };
    });
  };

  const handleCreationComplete = (project: Story, plan: AgentPlan, debug?: any) => {
    const ownedProject = {
      ...project,
      ownerUserId: project.ownerUserId || currentUserId,
      source: project.source || { type: 'local' },
    } as Story;
    setWorkspace((prev) => {
      const idx = prev.projects.findIndex((p) => p.id === ownedProject.id);
      const projects = prev.projects.slice();
      if (idx < 0) projects.unshift(ownedProject);
      else projects[idx] = mergeIncomingStoryPreferRealPreviews(ownedProject, projects[idx]);
      return { ...prev, projects, activeProjectId: ownedProject.id };
    });
    setSelection({ type: 'story', id: ownedProject.id });
    setScreen('project');

    const systemEntry: AgentLogEntry = {
      id: `sys-${Date.now()}`,
      role: 'system',
      content: `Scaffold complete: ${plan.summary}${plan.steps?.length ? `\n- ${plan.steps.map(s => s.title).join('\n- ')}` : ''}`,
      timestamp: Date.now(),
      actionDetails: { type: 'SCAFFOLD_PROJECT', actions: plan.actions, planId: plan.id },
      debug,
    };

    setAgentHistoryByProject((prev) => ({
      ...prev,
      [ownedProject.id]: [...(prev[ownedProject.id] || []), systemEntry],
    }));

    const fellBack = Boolean(debug?.error);
    if (fellBack && aiSettings.scaffoldWorker.provider !== 'mock') {
      addToast('Scaffold fell back to mock/rules. Open Debug (Ctrl/Cmd+Shift+D) for details.', 'info');
    } else {
      addToast('Project scaffolded by Director AI', 'success');
    }

  };

  const composeRuntimeVideoPrompt = (args: { story: Story; seq: any; shot: any; sourceBundle: any; authoredPrompt?: string }) => {
    const { story, seq, shot, sourceBundle } = args;
    const styleGuide = String((story as any)?.styleGuide || '').trim();
    const location = (story.locations || []).find((l) => l.id === shot.locationId);
    const shotAction = String((shot.elements as any)?.[ElementType.SCRIPT]?.prompt || '').trim();
    const cameraPrompt = String((shot.elements as any)?.[ElementType.CAMERA]?.prompt || '').trim();
    const lightingPrompt = String((shot.elements as any)?.[ElementType.LIGHTING]?.prompt || '').trim();
    const audioPrompt = String((shot.elements as any)?.[ElementType.AUDIO]?.prompt || '').trim();
    const authoredPrompt = String(args.authoredPrompt || '').trim();
    const frameDescription = String(sourceBundle.frameDescription || shot.description || '').trim();
    const dialogue = extractDialogueLines(shotAction);
    const storyContext = [
      story.logline ? `Logline: ${String(story.logline).trim()}` : '',
      story.intent ? `Intent: ${String(story.intent).trim()}` : '',
      seq.context ? `Sequence context: ${String(seq.context).trim()}` : '',
      shot.description ? `Shot dramatic beat: ${String(shot.description).trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const actingDirection = buildActingDirection({
      frameDescription,
      script: shotAction,
      shotDescription: String(shot.description || '').trim(),
      sequenceContext: String(seq.context || '').trim(),
      dialogue,
    });
    const minimalStyleLock =
      String(location?.visualStyle || '').trim() ||
      String(styleGuide || '')
        .split(/\n|[。.!?]/)
        .map((x) => x.trim())
        .find(Boolean) ||
      '';
    const { prompt: videoPrompt } = composeStructuredVideoPrompt({
      sourceKind: sourceBundle.sourceKind,
      referenceFrames: sourceBundle.referenceFrames,
      frameDescription,
      storyContext,
      actingDirection,
      cameraPrompt,
      lightingPrompt,
      audioPrompt,
      style: minimalStyleLock,
      styleTranslation: '',
      dialogue,
      directorNotes: authoredPrompt,
      constraints: [
        'Preserve character identity and wardrobe continuity.',
        'Avoid flicker, morphing artifacts, and geometry instability.',
      ],
      maxChars: 7200,
    });
    return {
      videoPrompt: String(videoPrompt || '').trim(),
      frameDescription,
      storyContext,
      actingDirection,
      shotAction,
      dialogue,
      cameraPrompt,
      lightingPrompt,
      audioPrompt,
      styleGuide,
      locationStyle: String(location?.visualStyle || '').trim(),
    };
  };

  const hydrateShotVideoPromptFromKeyframe = (story: Story, sequenceId: string, shotId: string, nowTs?: number): Story => {
    const seq =
      (story.sequences || []).find((s) => s.id === sequenceId && (s.shots || []).some((x) => x.id === shotId)) ||
      (story.sequences || []).find((s) => (s.shots || []).some((x) => x.id === shotId));
    const shot = (seq?.shots || []).find((s) => s.id === shotId);
    if (!seq || !shot) return story;
    const targetSequenceId = String(seq.id || sequenceId);

    const activeVersion =
      (Array.isArray(shot.versions) ? shot.versions : []).find((v) => v.id === shot.activeVersionId) ||
      (Array.isArray(shot.versions) ? shot.versions : [])[Math.max(0, (shot.versions || []).length - 1)];
    if (!activeVersion) return story;

    const sourceBundle = resolveVideoSourceBundle(shot, activeVersion as any);
    const sourceImageUrl = String(sourceBundle.sourceImageUrl || '').trim();
    if (!sourceImageUrl) return story;

    const cameraMeta = ((shot.elements as any)?.[ElementType.CAMERA]?.metadata || {}) as Record<string, any>;
    const existingVideoPrompt = String(cameraMeta.videoPrompt || '').trim();
    const previousSource = String(cameraMeta.videoPromptSourceImageUrl || '').trim();
    const isReady = Boolean(cameraMeta.videoPromptReady);
    const shouldHydrate = previousSource !== sourceImageUrl || !existingVideoPrompt || !isReady;
    if (!shouldHydrate) return story;

    const composed = composeRuntimeVideoPrompt({
      story,
      seq,
      shot,
      sourceBundle,
      authoredPrompt: existingVideoPrompt,
    });
    if (!composed.videoPrompt) return story;

    const ts = nowTs || Date.now();
    return {
      ...story,
      sequences: (story.sequences || []).map((s) =>
        s.id !== targetSequenceId
          ? s
          : {
              ...s,
              shots: (s.shots || []).map((x) =>
                x.id !== shotId
                  ? x
                  : {
                      ...x,
                      elements: {
                        ...x.elements,
                        [ElementType.CAMERA]: {
                          ...x.elements[ElementType.CAMERA],
                          metadata: {
                            ...(x.elements?.[ElementType.CAMERA]?.metadata || {}),
                            videoPrompt: composed.videoPrompt,
                            videoPromptReady: true,
                            videoPromptReadyReason: 'keyframe-enriched',
                            videoPromptSourceImageUrl: sourceImageUrl,
                            videoPromptReadyAt: ts,
                            runtimeVideoPromptGeneratedAt: ts,
                          },
                        },
                      },
                    },
              ),
            },
      ),
    };
  };

  const startShotProduction = async (args: { sequenceId: string; shotId: string }) => {
    const now = Date.now();
    const aspectRatio = activeStory?.aspectRatio === '9:16' ? '9:16' : '16:9';
    const storyNow = activeStory;
    const seq = storyNow?.sequences.find((s) => s.id === args.sequenceId);
    const shot = seq?.shots.find((s) => s.id === args.shotId);
    if (!storyNow || !seq || !shot) {
      addToast('Shot not found', 'info');
      return;
    }

	    const activeVersion =
	      (Array.isArray(shot.versions) ? shot.versions : []).find((v) => v.id === shot.activeVersionId) ||
	      (Array.isArray(shot.versions) ? shot.versions : [])[Math.max(0, (shot.versions || []).length - 1)];

    const sourceBundle = resolveVideoSourceBundle(shot, activeVersion as any);
    const imageUrl = String(sourceBundle.sourceImageUrl || '').trim();
    if (!imageUrl) {
      addToast('Start Production blocked: generate/select a keyframe first.', 'info');
      return;
    }

    const cameraMeta = ((shot.elements as any)?.[ElementType.CAMERA]?.metadata || {}) as Record<string, any>;
    const authoredVideoPrompt = String(cameraMeta.videoPrompt || '').trim();
    const isPromptReady = Boolean(cameraMeta.videoPromptReady);
    const readySourceImageUrl = String(cameraMeta.videoPromptSourceImageUrl || '').trim();
    const needsLinearEnrich = !authoredVideoPrompt || !isPromptReady || readySourceImageUrl !== imageUrl;
    const composed = composeRuntimeVideoPrompt({
      story: storyNow,
      seq,
      shot,
      sourceBundle,
      authoredPrompt: authoredVideoPrompt,
    });
    const videoPrompt = needsLinearEnrich ? composed.videoPrompt : authoredVideoPrompt;
    if (!videoPrompt) {
      addToast('Start Production blocked: video prompt not ready, regenerate keyframe or retry.', 'info');
      updateActiveStory((prev) => ({
        ...prev,
        sequences: prev.sequences.map((s) =>
          s.id !== args.sequenceId
            ? s
            : {
                ...s,
                shots: s.shots.map((x) =>
                  x.id !== args.shotId
                    ? x
                    : {
                        ...x,
                        elements: {
                          ...x.elements,
                          [ElementType.CAMERA]: {
                            ...x.elements[ElementType.CAMERA],
                            metadata: {
                              ...(x.elements?.[ElementType.CAMERA]?.metadata || {}),
                              videoPromptReady: false,
                              videoPromptReadyReason: 'blocked-missing-prompt',
                              videoPromptSourceImageUrl: imageUrl,
                              videoPromptReadyAt: now,
                            },
                          },
                        },
                      },
                ),
              },
        ),
      }));
      return;
    }

    const durationSeconds = normalizeShotDurationSeconds(shot.duration);
    const productionKey = `${storyNow.id}|${args.sequenceId}|${args.shotId}`;
    shotProductionAbortControllersRef.current.get(productionKey)?.abort();
    const productionController = new AbortController();
    shotProductionAbortControllersRef.current.set(productionKey, productionController);

    updateActiveStory((prev) => ({
      ...prev,
      sequences: prev.sequences.map((s) =>
        s.id !== args.sequenceId
          ? s
          : {
              ...s,
              shots: s.shots.map((x) =>
                x.id !== args.shotId
                  ? x
                  : {
                      ...x,
                      duration: durationSeconds,
                      elements: {
                        ...x.elements,
                        [ElementType.CAMERA]: {
                          ...x.elements[ElementType.CAMERA],
                          metadata: {
                            ...(x.elements?.[ElementType.CAMERA]?.metadata || {}),
                            videoPrompt,
                            videoPromptReady: true,
                            videoPromptReadyReason: needsLinearEnrich ? 'video-preflight-linear-enrich' : 'precomputed',
                            videoPromptSourceImageUrl: imageUrl,
                            videoPromptReadyAt: now,
                            runtimeVideoPromptGeneratedAt: now,
                          },
                        },
                      },
                      production: {
                        ...x.production,
                        status: 'running',
                        lastStartedAt: now,
                        lastError: '',
                        durationSeconds,
                        resolution: '720p',
                      },
                    },
              ),
            },
      ),
    }));

    try {
      const out = await generateVideoFromImage({
        prompt: videoPrompt,
        imageUrl,
        referenceImageUrls: sourceBundle.referenceImageUrls,
        durationSeconds,
        aspectRatio,
        resolution: '720p',
        generateAudio: true,
        signal: productionController.signal,
        promptSpec: {
          frameDescription: composed.frameDescription,
          shotDescription: String(shot.description || '').trim(),
          action: composed.shotAction,
          actingDirection: composed.actingDirection,
          storyContext: composed.storyContext,
          dialogue: composed.dialogue,
          cameraman: composed.cameraPrompt,
          directorNotes: authoredVideoPrompt,
          style: composed.styleGuide || composed.locationStyle,
          styleTranslation: '',
          camera: composed.cameraPrompt,
          composition: `Aspect ratio ${aspectRatio}`,
          mood: composed.lightingPrompt,
          audio: composed.audioPrompt,
          referenceFrames: sourceBundle.referenceFrames.slice(0, 9),
          constraints: [
            'Preserve character identity and wardrobe continuity.',
            'Avoid flicker, morphing artifacts, and geometry instability.',
            'No text overlays, subtitles, logos, or watermark.',
          ],
        },
      });

      const finishedAt = Date.now();
      const nextVariantId = `pv-${finishedAt}-${Math.random().toString(16).slice(2, 8)}`;
      updateActiveStory((prev) => ({
        ...prev,
        sequences: prev.sequences.map((s) =>
          s.id !== args.sequenceId
            ? s
            : {
                ...s,
                shots: s.shots.map((x) =>
                  x.id !== args.shotId
                    ? x
                    : (() => {
                        const prevVariants = Array.isArray(x.production?.variants) ? x.production?.variants : [];
                        const newVariant = {
                          id: nextVariantId,
                          videoUrl: out.videoUrl,
                          createdAt: finishedAt,
                          durationSeconds,
                          resolution: '720p' as const,
                          operationName: out.operationName,
	                          metadata: {
	                            prompt: videoPrompt,
                              sourceImageUrl: imageUrl,
                              sourceShotVersionId: String(activeVersion?.id || ''),
                              referenceImageUrls: sourceBundle.referenceImageUrls,
                              frameDescription: composed.frameDescription,
                              actingDirection: composed.actingDirection,
                          },
                        };
                        return {
                          ...x,
                          production: {
                            ...x.production,
                            status: 'done',
                            lastCompletedAt: finishedAt,
                            lastError: '',
                            durationSeconds,
                            resolution: '720p',
                            operationName: out.operationName,
                            videoUrl: out.videoUrl,
                            variants: [...prevVariants, newVariant],
                            activeVariantId: newVariant.id,
                          },
                        };
                      })(),
                ),
              },
        ),
      }));
      addToast(`Shot production complete (${durationSeconds}s, 720p)`, 'success');
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const aborted =
        productionController.signal.aborted ||
        (e instanceof DOMException && e.name === 'AbortError') ||
        /abort/i.test(String((e as any)?.message || ''));
      if (aborted) {
        updateActiveStory((prev) => ({
          ...prev,
          sequences: prev.sequences.map((s) =>
            s.id !== args.sequenceId
              ? s
              : {
                  ...s,
                  shots: s.shots.map((x) =>
                    x.id !== args.shotId
                      ? x
                      : {
                          ...x,
                          production: {
                            ...x.production,
                            status: 'idle',
                            lastError: '',
                          },
                        },
                  ),
                },
          ),
        }));
        return;
      }
      addDebugEvent({
        level: 'error',
        scope: 'asset.video',
        message: 'Start production failed',
        data: { error: err, sequenceId: args.sequenceId, shotId: args.shotId, debug: (e as any)?.debug },
      });
      updateActiveStory((prev) => ({
        ...prev,
        sequences: prev.sequences.map((s) =>
          s.id !== args.sequenceId
            ? s
            : {
                ...s,
                shots: s.shots.map((x) =>
                  x.id !== args.shotId
                    ? x
                    : {
                        ...x,
                        production: {
                          ...x.production,
                          status: 'error',
                          lastError: err,
                          durationSeconds,
                          resolution: '720p',
                        },
                      },
                ),
              },
        ),
      }));
      addToast(`Shot production failed: ${err}`, 'info');
    } finally {
      shotProductionAbortControllersRef.current.delete(productionKey);
    }
  };

  // ----- Render Helpers -----

  const getActiveItem = () => {
    if (!activeStory) return null;
    switch (selection.type) {
      case 'sequence':
        return activeStory.sequences.find((s) => s.id === selection.id);
      case 'shot': {
        for (const seq of activeStory.sequences) {
          const shot = seq.shots.find((s) => s.id === selection.id);
          if (shot) return shot;
        }
        return null;
      }
      case 'location':
        return activeStory.locations.find((l) => l.id === selection.id);
      case 'character':
        return activeStory.characters.find((c) => c.id === selection.id);
      default:
        return activeStory;
    }
  };

  const activeItem = getActiveItem();

  const getContextLocation = () => {
    if (selection.type === 'shot' && activeStory && activeItem) {
      const shot = activeItem as Shot;
      return activeStory.locations.find((l) => l.id === shot.locationId);
    }
    return undefined;
  };

  const consoleContextType: 'story' | 'sequence' | 'shot' =
    selection.type === 'shot' ? 'shot' : selection.type === 'sequence' ? 'sequence' : 'story';
  const isCompactLayout = viewport.width < 1400 || viewport.height < 860;

  // ----- Project Editing Handlers -----

  const handleSelect = (sel: SelectionState) => setSelection(sel);

  const handleCreateSequence = () => {
    if (!activeStory) return;
    const now = Date.now();
    const newId = `seq-${now}`;
    const newSeq: Sequence = {
      id: newId,
      title: 'New Story Part',
      context: 'Describe the narrative beat...',
      scenes: [{ id: `${newId}-scene-1`, title: 'Scene 1', shots: [] }],
      shots: [],
    };
    updateActiveStory((prev) => ({ ...prev, sequences: [...prev.sequences, newSeq] }));
    setSelection({ type: 'sequence', id: newId });
    addToast('New story part added', 'success');
  };

  const handleAddShot = (
    seqId: string,
    opts?: { sceneId?: string; afterShotId?: string; locationId?: string; timeOfDay?: string },
  ) => {
    if (!activeStory) return;
    updateActiveStory((prev) => {
      return applyActionsToStory(prev, [
        {
          type: 'CREATE_SHOT',
          payload: {
            sequenceId: seqId,
            sceneId: opts?.sceneId,
            afterShotId: opts?.afterShotId,
            locationId: opts?.locationId,
            timeOfDay: opts?.timeOfDay,
          },
        } as any,
      ]);
    });
    addToast('New shot added to sequence', 'success');
  };

  const handleDeleteShot = (seqId: string, shotId: string) => {
    if (activeStory?.id) {
      const projectId = activeStory.id;
      const prefix = `${projectId}|shot|${seqId}|${shotId}`;
      cancelledAssetJobKeysRef.current.add(prefix);
      cancelAssetJobs((key) => key === prefix);
      cancelShotProduction((key) => key === `${projectId}|${seqId}|${shotId}`);
    }
    updateActiveStory((prev) =>
      applyActionsToStory(prev, [{ type: 'DELETE_SHOT', payload: { sequenceId: seqId, shotId } } as any]),
    );
    if (selection.type === 'shot' && selection.id === shotId) setSelection({ type: 'sequence', id: seqId });
    addToast('Shot removed', 'info');
  };

  const handleMoveShot = (seqId: string, shotId: string, direction: 'left' | 'right') => {
    updateActiveStory((prev) => {
      return applyActionsToStory(prev, [
        { type: 'MOVE_SHOT', payload: { sequenceId: seqId, shotId, direction } } as any,
      ]);
    });
  };

  const handleMoveShotToScene = (seqId: string, shotId: string, toSceneId: string) => {
    updateActiveStory((prev) =>
      applyActionsToStory(prev, [
        { type: 'MOVE_SHOT_TO_SCENE', payload: { sequenceId: seqId, shotId, toSceneId } } as any,
      ]),
    );
  };

  const handleRenameSequence = (seqId: string, title: string) => {
    const nextTitle = String(title || '').trim();
    if (!nextTitle) return;
    updateActiveStory((prev) =>
      applyActionsToStory(prev, [
        { type: 'RENAME_SEQUENCE', payload: { sequenceId: seqId, title: nextTitle } } as any,
      ]),
    );
  };

  const handleUpdateScene = (seqId: string, sceneId: string, patch: { title?: string; summary?: string }) => {
    updateActiveStory((prev) =>
      applyActionsToStory(prev, [
        { type: 'UPDATE_SCENE', payload: { sequenceId: seqId, sceneId, patch } } as any,
      ]),
    );
  };

  const handleSequenceUpdate = (updatedSeq: Sequence) => {
    updateActiveStory((prev) => ({
      ...prev,
      sequences: prev.sequences.map((s) => (s.id === updatedSeq.id ? updatedSeq : s)),
    }));
  };

  const handleShotUpdate = (updatedShot: Shot) => {
    const normalizedShot: Shot = {
      ...updatedShot,
      duration: normalizeShotDurationSeconds(updatedShot.duration),
    };
    updateActiveStory((prev) => ({
      ...prev,
      sequences: prev.sequences.map((seq) => {
        if (seq.shots.some((s) => s.id === normalizedShot.id)) {
          return {
            ...seq,
            shots: seq.shots.map((s) => {
              if (s.id !== normalizedShot.id) return s;
              const mergedAssetState = mergeAssetGenerationState((s as any)?.assetState, (normalizedShot as any)?.assetState);
              const mergedProduction = mergeShotProductionState((s as any)?.production, (normalizedShot as any)?.production);
              const terminalAsset =
                String((mergedAssetState as any)?.status || '').toLowerCase() === 'done' ||
                String((mergedAssetState as any)?.status || '').toLowerCase() === 'error' ||
                String((mergedAssetState as any)?.status || '').toLowerCase() === 'blocked';
              const terminalProduction =
                String((mergedProduction as any)?.status || '').toLowerCase() === 'done' ||
                String((mergedProduction as any)?.status || '').toLowerCase() === 'error';
              const nextAiState = terminalAsset || terminalProduction ? 'idle' : (normalizedShot.aiState ?? s.aiState);
              return {
                ...s,
                ...normalizedShot,
                duration: normalizeShotDurationSeconds(normalizedShot.duration),
                aiState: nextAiState as any,
                aiPrompt: nextAiState === 'idle' ? '' : (normalizedShot.aiPrompt ?? s.aiPrompt),
                assetState: mergedAssetState,
                production: mergedProduction,
              };
            }),
          };
        }
        return seq;
      }),
    }));
  };

  const handleCreateLocation = () => {
    const newId = `loc-${Date.now()}`;
    const newLoc: Location = {
      id: newId,
      name: 'New Environment',
      description: 'Describe the atmospheric details...',
      visualStyle: 'Cinematic style details...',
      previewUrl: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?q=80&w=2148&auto=format&fit=crop',
      status: 'draft',
    };
    updateActiveStory((prev) => ({ ...prev, locations: [...prev.locations, newLoc] }));
    setSelection({ type: 'location', id: newId });
    addToast('New environment added to library', 'success');
  };

  const handleCreateCharacter = () => {
    const newId = `char-${Date.now()}`;
    const newChar: Character = {
      id: newId,
      name: 'New Character',
      description: 'Describe physical traits and personality...',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=1287&auto=format&fit=crop',
      status: 'draft',
      looks: [],
    };
    updateActiveStory((prev) => ({ ...prev, characters: [...prev.characters, newChar] }));
    setSelection({ type: 'character', id: newId });
    addToast('New character casted', 'success');
  };

  const handleUpdateLocation = (loc: Location) => {
    updateActiveStory((prev) => ({ ...prev, locations: prev.locations.map((l) => (l.id === loc.id ? loc : l)) }));
    addToast('Environment updated', 'info');
  };

  const isAssetDone = (state: any) => String(state?.status || '').toLowerCase() === 'done';
  const isAssetQueuedOrRunning = (state: any) => {
    const s = String(state?.status || '').toLowerCase();
    return s === 'queued' || s === 'running';
  };
  const isLookBoundToAvatar = (look: any, avatarVersionId: string) => {
    if (!look || !avatarVersionId) return false;
    const versions = Array.isArray((look as any).previewVersions) ? (look as any).previewVersions : [];
    const activeId = String((look as any).activePreviewVersionId || '').trim();
    const hit = versions.find((v: any) => String(v?.id || '') === activeId) || versions[versions.length - 1];
    return String(hit?.metadata?.sourceAvatarVersionId || '') === String(avatarVersionId);
  };
  const getShotCast = (shot: Shot) => {
    const cast = (shot.elements as any)?.[ElementType.CASTING]?.metadata?.characters;
    return Array.isArray(cast) ? cast : [];
  };
  const collectAffectedShotRefsForCharacter = (story: Story, characterId: string): Array<{ sequenceId: string; shotId: string }> => {
    const out: Array<{ sequenceId: string; shotId: string }> = [];
    for (const seq of story.sequences || []) {
      for (const shot of seq.shots || []) {
        if (!isAssetQueuedOrRunning((shot as any)?.assetState)) continue;
        const hasCharacter = getShotCast(shot).some((c: any) => String(c?.id || '').trim() === characterId);
        if (!hasCharacter) continue;
        out.push({ sequenceId: String(seq.id || ''), shotId: String(shot.id || '') });
      }
    }
    return out;
  };
  const applyStopForAffectedShots = (
    story: Story,
    projectId: string,
    affected: Array<{ sequenceId: string; shotId: string }>,
    reason: string,
  ) => {
    const now = Date.now();
    const affectedKeys = new Set(affected.map((x) => `${x.sequenceId}|${x.shotId}`));
    for (const { sequenceId, shotId } of affected) {
      const key = `${projectId}|shot|${sequenceId}|${shotId}`;
      cancelledAssetJobKeysRef.current.add(key);
      cancelAssetJobs((k) => k === key);
    }
    return {
      ...story,
      sequences: (story.sequences || []).map((seq) => ({
        ...seq,
        shots: (seq.shots || []).map((shot) => {
          const sk = `${String(seq.id || '')}|${String(shot.id || '')}`;
          if (!affectedKeys.has(sk)) return shot;
          if (!isAssetQueuedOrRunning((shot as any)?.assetState)) return shot;
          return {
            ...shot,
            aiState: 'idle',
            aiPrompt: '',
            assetState: {
              ...((shot as any)?.assetState || {}),
              status: 'blocked',
              lastError: reason,
              lastAttemptAt: now,
            },
          } as Shot;
        }),
      })),
    };
  };
  const validateNewIdentityForAffectedShots = (
    story: Story,
    characterId: string,
    affected: Array<{ sequenceId: string; shotId: string }>,
  ): string | null => {
    const ch = (story.characters || []).find((x) => String(x.id || '').trim() === characterId);
    if (!ch) return '角色不存在，无法继续生产。';
    if (!isAssetDone((ch as any)?.assetState)) return '新 avatar 尚未生成完成，无法用新形象继续。';
    const avatarVersionId = String((ch as any)?.activeAvatarVersionId || '').trim();
    const avatarUrl = getCharacterActiveAvatarUrl(ch, { activeOnly: true });
    if (!avatarVersionId || !avatarUrl || isLikelyPlaceholderImageUrl(avatarUrl)) return '新 avatar 不可用，已停止当前镜头生产。';
    for (const { sequenceId, shotId } of affected) {
      const seq = (story.sequences || []).find((s) => String(s.id || '') === sequenceId);
      const shot = (seq?.shots || []).find((s) => String(s.id || '') === shotId);
      if (!shot) continue;
      const castEntry = getShotCast(shot).find((c: any) => String(c?.id || '').trim() === characterId);
      if (!castEntry) continue;
      const lookId = String((castEntry as any)?.activeLookId || '').trim();
      if (!lookId) continue;
      const look = (ch.looks || []).find((lk) => String(lk.id || '').trim() === lookId);
      if (!look || !isAssetDone((look as any)?.assetState)) {
        return `角色 Look 未生成完成（${lookId}），已停止当前镜头生产。`;
      }
      if (!isLookBoundToAvatar(look, avatarVersionId)) {
        return `角色 Look 未绑定到当前 avatar（${lookId}），已停止当前镜头生产。`;
      }
      const lookUrl = getLookActivePreviewUrl(look, { activeOnly: true });
      if (!lookUrl || isLikelyPlaceholderImageUrl(lookUrl)) {
        return `角色 Look 预览不可用（${lookId}），已停止当前镜头生产。`;
      }
    }
    return null;
  };

  const handleUpdateCharacter = (char: Character) => {
    if (!activeStory?.id) {
      updateActiveStory((prev) => ({ ...prev, characters: prev.characters.map((c) => (c.id === char.id ? char : c)) }));
      addToast('Character profile updated', 'info');
      return;
    }
    const projectId = activeStory.id;
    const prevChar = (activeStory.characters || []).find((c) => String(c.id || '') === String(char.id || ''));
    const prevAvatarVersionId = String((prevChar as any)?.activeAvatarVersionId || '').trim();
    const nextAvatarVersionId = String((char as any)?.activeAvatarVersionId || '').trim();
    const avatarChanged = prevAvatarVersionId !== nextAvatarVersionId;
    const storyAfterCharUpdate: Story = {
      ...activeStory,
      characters: (activeStory.characters || []).map((c) => (c.id === char.id ? char : c)),
    };

    if (!avatarChanged) {
      updateStoryById(projectId, () => storyAfterCharUpdate);
      addToast('Character profile updated', 'info');
      return;
    }

    const affected = collectAffectedShotRefsForCharacter(activeStory, String(char.id || '').trim());
    if (!affected.length) {
      updateStoryById(projectId, () => storyAfterCharUpdate);
      addToast('Character avatar updated', 'info');
      return;
    }

    const userChoice = window.prompt(
      '检测到该角色在镜头 keyframe 队列中：\n1 = 停止生产\n2 = 继续生产\n3 = 使用新形象重新生产\n请输入 1/2/3',
      '2',
    );
    if (userChoice === null) {
      addToast('Avatar update cancelled', 'info');
      return;
    }
    const choice = String(userChoice || '').trim();

    if (choice === '1') {
      const stoppedStory = applyStopForAffectedShots(
        storyAfterCharUpdate,
        projectId,
        affected,
        'Stopped by user after avatar update.',
      );
      updateStoryById(projectId, () => stoppedStory);
      addToast('Stopped queued/running keyframe tasks for updated avatar', 'info');
      return;
    }

    if (choice === '3') {
      const invalidReason = validateNewIdentityForAffectedShots(storyAfterCharUpdate, String(char.id || '').trim(), affected);
      if (invalidReason) {
        const stoppedStory = applyStopForAffectedShots(storyAfterCharUpdate, projectId, affected, invalidReason);
        updateStoryById(projectId, () => stoppedStory);
        window.alert(invalidReason);
        addToast('Shot generation stopped: new identity unavailable', 'info');
        return;
      }
      const stoppedStory = applyStopForAffectedShots(
        storyAfterCharUpdate,
        projectId,
        affected,
        'Avatar changed, requeue with new identity.',
      );
      updateStoryById(projectId, () => stoppedStory);
      const jobs: AssetJob[] = [];
      for (const { sequenceId, shotId } of affected) {
        const seq = (stoppedStory.sequences || []).find((s) => String(s.id || '') === sequenceId);
        const shot = (seq?.shots || []).find((s) => String(s.id || '') === shotId);
        if (!seq || !shot) continue;
        jobs.push({ kind: 'shot', sequenceId: String(seq.id || ''), shot });
      }
      if (jobs.length) {
        runAssetJobsForDirector({
          projectId,
          story: stoppedStory,
          jobs,
          scopeLabel: 'avatar-update:regenerate-shots',
          concurrency: 2,
        });
      }
      addToast('Queued shot regeneration with new avatar identity', 'success');
      return;
    }

    updateStoryById(projectId, () => storyAfterCharUpdate);
    addToast('Avatar updated, keeping current keyframe queue', 'info');
  };

  const handleDeleteSequence = (id: string) => {
    if (activeStory?.id) {
      const projectId = activeStory.id;
      const prefix = `${projectId}|shot|${id}|`;
      const seq = activeStory.sequences.find((s) => s.id === id);
      for (const sh of seq?.shots || []) {
        cancelledAssetJobKeysRef.current.add(`${projectId}|shot|${id}|${sh.id}`);
      }
      cancelAssetJobs((key) => key.startsWith(prefix));
      cancelShotProduction((key) => key.startsWith(`${projectId}|${id}|`));
    }
    updateActiveStory((prev) => ({ ...prev, sequences: prev.sequences.filter((s) => s.id !== id) }));
    if ((selection.type === 'sequence' && selection.id === id) || (selection.type === 'shot' && selection.parentId === id)) {
      if (activeStory) setSelection({ type: 'story', id: activeStory.id });
    }
    addToast('Story part removed', 'info');
  };

  const handleDeleteLocation = (id: string) => {
    if (activeStory?.id) {
      const projectId = activeStory.id;
      cancelledAssetJobKeysRef.current.add(`${projectId}|location|${id}`);
      cancelAssetJobs((key) => key === `${projectId}|location|${id}`);
    }
    updateActiveStory((prev) => ({
      ...prev,
      locations: prev.locations.filter((l) => l.id !== id),
      sequences: prev.sequences.map((seq) => ({
        ...seq,
        shots: seq.shots.map((shot) => (shot.locationId === id ? { ...shot, locationId: '' } : shot)),
      })),
    }));
    if (activeStory) setSelection({ type: 'story', id: activeStory.id });
    addToast('Environment removed', 'info');
  };

  const handleDeleteCharacter = (id: string) => {
    if (activeStory?.id) {
      const projectId = activeStory.id;
      cancelledAssetJobKeysRef.current.add(`${projectId}|character|${id}`);
      const ch = activeStory.characters.find((c) => c.id === id);
      for (const lk of ch?.looks || []) {
        cancelledAssetJobKeysRef.current.add(`${projectId}|look|${id}|${lk.id}`);
      }
      cancelAssetJobs((key) => key === `${projectId}|character|${id}` || key.startsWith(`${projectId}|look|${id}|`));
    }
    updateActiveStory((prev) => ({
      ...prev,
      characters: prev.characters.filter((c) => c.id !== id),
      sequences: prev.sequences.map((seq) => ({
        ...seq,
        shots: seq.shots.map((shot) => {
          const cast = (shot.elements as any)?.[ElementType.CASTING]?.metadata?.characters;
          const castArr = Array.isArray(cast) ? cast : [];
          const nextCast = castArr.filter((c: any) => String(c?.id || '') !== id);
          return {
            ...shot,
            elements: {
              ...shot.elements,
              [ElementType.CASTING]: {
                ...shot.elements[ElementType.CASTING],
                metadata: { ...(shot.elements[ElementType.CASTING].metadata || {}), characters: nextCast },
                status: 'manual' as const,
              },
            },
          };
        }),
      })),
    }));
    if (selection.type === 'character' && selection.id === id && activeStory) setSelection({ type: 'story', id: activeStory.id });
    addToast('Character removed from casting', 'info');
  };

  const handleCastingUpdate = (shotId: string, seqId: string, newCharacters: Character[]) => {
    updateActiveStory((prev) => {
      const updatedSequences = prev.sequences.map((seq) => {
        if (seq.id !== seqId) return seq;
        return {
          ...seq,
          shots: seq.shots.map((shot) => {
            if (shot.id !== shotId) return shot;
            return {
              ...shot,
              elements: {
                ...shot.elements,
                [ElementType.CASTING]: {
                  ...shot.elements[ElementType.CASTING],
                  metadata: {
                    ...shot.elements[ElementType.CASTING].metadata,
                    characters: newCharacters,
                  },
                  status: 'manual' as const,
                },
              },
            };
          }),
        };
      });
      return { ...prev, sequences: updatedSequences };
    });
  };

  const handleCharacterPromptChange = (_shotId: string, _seqId: string, _charId: string, _prompt: string) => {
    // TODO: per-shot visual overrides (future consistency engine).
  };

  const handleScriptUpdate = (_shotId: string, _seqId: string, _dialogue: DialogueLine[]) => {
    // TODO: structured dialogue lines (future).
  };

  const isJobCancelledOrMissing = (projectId: string, job: AssetJob): boolean => {
    const key = assetJobKey(projectId, job);
    if (cancelledAssetJobKeysRef.current.has(key)) return true;
    const project = workspaceRef.current.projects.find((p) => p.id === projectId);
    if (!project) return true;
    if (job.kind === 'masterkv') return false;
    if (job.kind === 'location') return !(project.locations || []).some((l) => l.id === job.locationId);
    if (job.kind === 'character') return !(project.characters || []).some((c) => c.id === job.characterId);
    if (job.kind === 'look') {
      const ch = (project.characters || []).find((c) => c.id === job.characterId);
      return !ch || !(ch.looks || []).some((lk) => lk.id === job.lookId);
    }
    const seq = (project.sequences || []).find((s) => s.id === job.sequenceId);
    if (seq && (seq.shots || []).some((s) => s.id === job.shot.id)) return false;
    // Sequence ID may be stale after reorder/move; fall back to global shot-id lookup.
    const existsByShotId = (project.sequences || []).some((s) => (s.shots || []).some((x) => x.id === job.shot.id));
    return !existsByShotId;
  };

  const runAssetJobsForDirector = (args: {
    projectId: string;
    story: Story;
    jobs: AssetJob[];
    scopeLabel: string;
    concurrency: number;
  }) => {
    const { projectId, story, jobs, scopeLabel, concurrency } = args;
    if (!jobs.length) return;
    if (aiSettings.image.provider === 'mock') {
      addToast('Asset generation requested, but Image Provider is Mock.', 'info');
      return;
    }

    const jobKeys = jobs.map((job) => assetJobKey(projectId, job));
    for (const key of jobKeys) {
      cancelledAssetJobKeysRef.current.delete(key);
    }
    const releaseJobController = (job: AssetJob) => {
      const key = assetJobKey(projectId, job);
      assetJobAbortControllersRef.current.delete(key);
    };
    const applyQueued = (s: Story) => jobs.reduce((acc, job) => applyAssetQueued(acc, job), s);
    const queuedStory = applyQueued(story);
    updateStoryById(projectId, (prev) => applyQueued(prev));
    addToast(`Queued asset generation (${jobs.length})…`, 'info');
    addDebugEvent({ level: 'info', scope: 'asset.exec', message: 'Queue asset generation', data: { projectId, scope: scopeLabel, jobs: jobs.length, concurrency } });

    setTimeout(() => {
      let storyRef = queuedStory;
      const handleAssetEvent = (ev: any) => {
        if (ev.type === 'start') {
          storyRef = applyAssetStart(storyRef, ev.job);
          updateStoryById(projectId, (prev) => applyAssetStart(prev, ev.job));
          addDebugEvent({ level: 'info', scope: 'asset.exec', message: 'Start', data: { done: ev.done, total: ev.total, job: ev.job } });
        }
        if (ev.type === 'success') {
          releaseJobController(ev.job);
          const applySuccess = (base: Story) => {
            const afterResult = applyAssetResult(base, ev.job, ev.imageUrl, ev.meta);
            if (ev.job?.kind !== 'shot') return afterResult;
            return hydrateShotVideoPromptFromKeyframe(
              afterResult,
              String(ev.job.sequenceId || ''),
              String(ev.job.shot?.id || ''),
              Date.now(),
            );
          };
          storyRef = applySuccess(storyRef);
          updateStoryById(projectId, (prev) => applySuccess(prev));
          addDebugEvent({
            level: 'info',
            scope: 'asset.exec',
            message: 'Success',
            data: { done: ev.done, total: ev.total, job: ev.job, imageUrl: ev.imageUrl, debug: ev.debug },
          });
          if (ev.job?.kind === 'character') {
            const characterId = String(ev.job.characterId || '');
            const ch = storyRef.characters.find((c) => c.id === characterId);
            if (ch?.looks?.length) {
              const hasShotJobsInBatch = jobs.some((j) => j.kind === 'shot');
              const hasLookJobsInBatch = jobs.some(
                (j) => j.kind === 'look' && String((j as any).characterId || '') === characterId,
              );
              if (!hasShotJobsInBatch && !hasLookJobsInBatch) {
                const styleGuide = (storyRef as any)?.styleGuide;
                const avatarVersionId = String((ch as any).activeAvatarVersionId || '').trim();
                const lookJobs: AssetJob[] = ch.looks.map((lk) => ({
                  kind: 'look',
                  characterId,
                  lookId: lk.id,
                  prompt: buildCharacterLookPrompt(ch, lk, styleGuide),
                  avatarVersionId,
                }));
                storyRef = lookJobs.reduce((acc, job) => applyAssetQueued(acc, job), storyRef);
                updateStoryById(projectId, (prev) => lookJobs.reduce((acc, job) => applyAssetQueued(acc, job), prev));
                executeAssetJobs({
                  jobs: lookJobs,
                  settings: aiSettings.image,
                  aspectRatio: storyRef.aspectRatio,
                  concurrency,
                  getStoryForRefs: () => storyRef,
                  shouldCancelJob: (job) => isJobCancelledOrMissing(projectId, job),
                  getSignalForJob: (job) => {
                    const key = assetJobKey(projectId, job);
                    if (cancelledAssetJobKeysRef.current.has(key)) return undefined;
                    const existing = assetJobAbortControllersRef.current.get(key);
                    if (existing) return existing.signal;
                    const ctrl = new AbortController();
                    assetJobAbortControllersRef.current.set(key, ctrl);
                    return ctrl.signal;
                  },
                  maxAttempts: 3,
                  stopAfterMasterKvFailure: true,
                  onEvent: handleAssetEvent,
                });
              }
            }
          }
        }
        if (ev.type === 'blocked') {
          releaseJobController(ev.job);
          storyRef = applyAssetBlocked(storyRef, ev.job, ev.reason);
          updateStoryById(projectId, (prev) => applyAssetBlocked(prev, ev.job, ev.reason));
          if (String(ev.reason || '').toLowerCase() !== 'cancelled') addToast(`Blocked: ${ev.reason}`, 'info');
          addDebugEvent({
            level: 'warn',
            scope: 'asset.exec',
            message: 'Blocked',
            data: { done: ev.done, total: ev.total, job: ev.job, reason: ev.reason },
          });
        }
        if (ev.type === 'error') {
          releaseJobController(ev.job);
          storyRef = applyAssetError(storyRef, ev.job, ev.error);
          updateStoryById(projectId, (prev) => applyAssetError(prev, ev.job, ev.error));
          addDebugEvent({
            level: 'warn',
            scope: 'asset.exec',
            message: 'Error',
            data: { done: ev.done, total: ev.total, job: ev.job, error: ev.error },
          });
        }
        if (ev.done === ev.total) addToast('Assets generated (director).', 'success');
      };
      executeAssetJobs({
        jobs,
        settings: aiSettings.image,
        aspectRatio: story.aspectRatio,
        concurrency,
        getStoryForRefs: () => storyRef,
        shouldCancelJob: (job) => isJobCancelledOrMissing(projectId, job),
        getSignalForJob: (job) => {
          const key = assetJobKey(projectId, job);
          if (cancelledAssetJobKeysRef.current.has(key)) return undefined;
          const existing = assetJobAbortControllersRef.current.get(key);
          if (existing) return existing.signal;
          const ctrl = new AbortController();
          assetJobAbortControllersRef.current.set(key, ctrl);
          return ctrl.signal;
        },
        maxAttempts: 3,
        stopAfterMasterKvFailure: true,
        onEvent: handleAssetEvent,
      }).catch(() => {
        addToast('Asset generation had errors. Check Debug.', 'info');
      });
    }, 0);
  };

  const applyDirectorActions = (
    projectId: string,
    story: Story,
    actions: AgentAction[],
    opts?: { deferGeneration?: boolean },
  ): DirectorApplyResult => {
    if (!actions.length) {
      addToast('No changes applied', 'info');
      return { applied: 0, dropped: 0, droppedActions: [] as AgentAction[] };
    }

    const validateAction = (a: AgentAction): { ok: boolean; reason?: string } => {
      const t = a.type;
      const p: any = a.payload || {};
      if (t === 'UPDATE_STORY') {
        const patch = p.patch || p;
        const hasString = ['title', 'logline', 'intent', 'styleGuide', 'keyVisualUrl'].some((k) => typeof patch?.[k] === 'string');
        const hasRefPatch = Array.isArray(patch?.referenceImages) || patch?.referenceMode === 'auto' || patch?.referenceMode === 'off';
        const hasAny = hasString || hasRefPatch;
        return hasAny ? { ok: true } : { ok: false, reason: 'UPDATE_STORY missing patch' };
      }
      if (t === 'NAVIGATE') {
        return p?.type && p?.id ? { ok: true } : { ok: false, reason: 'NAVIGATE missing payload' };
      }
      if (t === 'CREATE_LOCATION') {
        return { ok: true };
      }
      if (t === 'DELETE_LOCATION') {
        return p?.locationId ? { ok: true } : { ok: false, reason: 'DELETE_LOCATION missing id' };
      }
      if (t === 'UPDATE_LOCATION') {
        return p?.locationId ? { ok: true } : { ok: false, reason: 'UPDATE_LOCATION missing id' };
      }
      if (t === 'CREATE_CHARACTER') {
        return { ok: true };
      }
      if (t === 'DELETE_CHARACTER') {
        return p?.characterId ? { ok: true } : { ok: false, reason: 'DELETE_CHARACTER missing id' };
      }
      if (t === 'UPDATE_CHARACTER') {
        return p?.characterId ? { ok: true } : { ok: false, reason: 'UPDATE_CHARACTER missing id' };
      }
      if (t === 'CREATE_SHOT') {
        return p?.sequenceId ? { ok: true } : { ok: false, reason: 'CREATE_SHOT missing sequenceId' };
      }
      if (t === 'CREATE_SCENE') {
        return p?.sequenceId ? { ok: true } : { ok: false, reason: 'CREATE_SCENE missing sequenceId' };
      }
      if (t === 'RENAME_SEQUENCE') {
        return p?.sequenceId && typeof p?.title === 'string'
          ? { ok: true }
          : { ok: false, reason: 'RENAME_SEQUENCE missing fields' };
      }
      if (t === 'RENAME_SCENE') {
        return p?.sequenceId && p?.sceneId && typeof p?.title === 'string'
          ? { ok: true }
          : { ok: false, reason: 'RENAME_SCENE missing fields' };
      }
      if (t === 'UPDATE_SCENE') {
        return p?.sequenceId && p?.sceneId ? { ok: true } : { ok: false, reason: 'UPDATE_SCENE missing ids' };
      }
      if (t === 'DELETE_SCENE') {
        return p?.sequenceId && p?.sceneId ? { ok: true } : { ok: false, reason: 'DELETE_SCENE missing ids' };
      }
      if (t === 'DELETE_SHOT') {
        return p?.sequenceId && p?.shotId ? { ok: true } : { ok: false, reason: 'DELETE_SHOT missing ids' };
      }
      if (t === 'MOVE_SHOT') {
        return p?.sequenceId && p?.shotId ? { ok: true } : { ok: false, reason: 'MOVE_SHOT missing ids' };
      }
      if (t === 'MOVE_SHOT_TO_SCENE') {
        return p?.sequenceId && p?.shotId && p?.toSceneId ? { ok: true } : { ok: false, reason: 'MOVE_SHOT_TO_SCENE missing ids' };
      }
      if (t === 'UPDATE_SHOT') {
        return p?.shotId ? { ok: true } : { ok: false, reason: 'UPDATE_SHOT missing shotId' };
      }
      if (t === 'UPDATE_ELEMENT') {
        return p?.shotId && p?.sequenceId && p?.elementType ? { ok: true } : { ok: false, reason: 'UPDATE_ELEMENT missing ids' };
      }
      if (t === 'SET_CAST') {
        return p?.shotId && p?.sequenceId ? { ok: true } : { ok: false, reason: 'SET_CAST missing ids' };
      }
      if (t === 'CREATE_CHARACTER_LOOK') {
        return p?.characterId && p?.name && p?.description ? { ok: true } : { ok: false, reason: 'CREATE_CHARACTER_LOOK missing fields' };
      }
      if (t === 'UPDATE_CHARACTER_LOOK') {
        const lookId = p?.lookId || p?.id;
        const hasPatch = Boolean(p?.patch || typeof p?.description === 'string' || typeof p?.name === 'string');
        return lookId && hasPatch ? { ok: true } : { ok: false, reason: 'UPDATE_CHARACTER_LOOK missing ids' };
      }
      if (t === 'GENERATE_SHOT_IMAGE') {
        return p?.sequenceId && p?.shotId ? { ok: true } : { ok: false, reason: 'GENERATE_SHOT_IMAGE missing ids' };
      }
      if (t === 'GENERATE_LOCATION_PREVIEW') {
        return p?.locationId ? { ok: true } : { ok: false, reason: 'GENERATE_LOCATION_PREVIEW missing id' };
      }
      if (t === 'GENERATE_CHARACTER_AVATAR') {
        return p?.characterId ? { ok: true } : { ok: false, reason: 'GENERATE_CHARACTER_AVATAR missing id' };
      }
      if (t === 'GENERATE_CHARACTER_LOOK') {
        return p?.characterId && p?.lookId ? { ok: true } : { ok: false, reason: 'GENERATE_CHARACTER_LOOK missing ids' };
      }
      if (t === 'GENERATE_PROJECT_ASSETS') {
        return { ok: true };
      }
      if (t === 'GENERATE_MASTER_KV_PROPOSAL' || t === 'ACCEPT_KV_PROPOSAL' || t === 'DISCARD_KV_PROPOSAL') {
        return { ok: true };
      }
      return { ok: false, reason: `Unknown action type: ${String(t)}` };
    };

    const lookOwnerById = new Map<string, string>();
    for (const ch of Array.isArray(story?.characters) ? story.characters : []) {
      const characterId = String((ch as any)?.id || '').trim();
      if (!characterId) continue;
      for (const lk of Array.isArray((ch as any)?.looks) ? (ch as any).looks : []) {
        const lookId = String((lk as any)?.id || '').trim();
        if (!lookId || lookOwnerById.has(lookId)) continue;
        lookOwnerById.set(lookId, characterId);
      }
    }

    const parseRawObject = (v: any): Record<string, any> => {
      if (!v) return {};
      if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, any>;
      if (typeof v !== 'string') return {};
      const s = String(v || '').trim();
      if (!s) return {};
      try {
        const parsed = JSON.parse(s);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, any>) : {};
      } catch {
        return {};
      }
    };

    const normalizeActionPayload = (a: AgentAction): AgentAction => {
      const payload: any = (a as any)?.payload || {};
      const payloadRaw = parseRawObject(payload?._raw);
      const metadataRaw = parseRawObject(payload?.metadata?._raw);
      const mergedPayload = { ...payloadRaw, ...payload, ...metadataRaw };
      const patchRaw = parseRawObject(mergedPayload?.patch?._raw);
      const mergedPatch =
        mergedPayload?.patch && typeof mergedPayload.patch === 'object'
          ? { ...patchRaw, ...mergedPayload.patch }
          : { ...patchRaw };
      const withPatch = Object.keys(mergedPatch).length ? { ...mergedPayload, patch: mergedPatch } : mergedPayload;

      const normalizeByType = () => {
        if (a.type === 'UPDATE_STORY') {
          const patch = Object.keys(mergedPatch).length ? mergedPatch : mergedPayload?.patch || {};
          return { ...withPatch, patch };
        }
        if (a.type === 'UPDATE_LOCATION') {
          return {
            ...withPatch,
            locationId: String(withPatch.locationId || withPatch.id || '').trim(),
          };
        }
        if (a.type === 'DELETE_LOCATION') {
          return {
            ...withPatch,
            locationId: String(withPatch.locationId || withPatch.id || '').trim(),
          };
        }
        if (a.type === 'UPDATE_CHARACTER') {
          const patch = {
            ...(mergedPatch || {}),
            ...(typeof withPatch?.name === 'string' ? { name: withPatch.name } : {}),
            ...(typeof withPatch?.description === 'string' ? { description: withPatch.description } : {}),
          };
          const normalized: any = {
            ...withPatch,
            characterId: String(withPatch.characterId || withPatch.id || '').trim(),
            patch,
          };
          if (typeof withPatch?.regenerateDependents === 'boolean') normalized.regenerateDependents = withPatch.regenerateDependents;
          if (typeof withPatch?.syncDependents === 'boolean') normalized.syncDependents = withPatch.syncDependents;
          return normalized;
        }
        if (a.type === 'DELETE_CHARACTER') {
          return {
            ...withPatch,
            characterId: String(withPatch.characterId || withPatch.id || '').trim(),
          };
        }
        if (a.type === 'UPDATE_CHARACTER_LOOK') {
          const patch = {
            ...(mergedPatch || {}),
            ...(typeof withPatch?.name === 'string' ? { name: withPatch.name } : {}),
            ...(typeof withPatch?.description === 'string' ? { description: withPatch.description } : {}),
          };
          const normalized: any = {
            ...withPatch,
            characterId: String(withPatch.characterId || '').trim(),
            lookId: String(withPatch.lookId || withPatch.id || '').trim(),
            patch,
          };
          if (typeof withPatch?.regenerateDependents === 'boolean') normalized.regenerateDependents = withPatch.regenerateDependents;
          if (typeof withPatch?.syncDependents === 'boolean') normalized.syncDependents = withPatch.syncDependents;
          return normalized;
        }
        if (a.type === 'DELETE_SHOT' || a.type === 'MOVE_SHOT' || a.type === 'MOVE_SHOT_TO_SCENE') {
          return {
            ...withPatch,
            sequenceId: String(withPatch.sequenceId || withPatch.parentId || '').trim(),
            shotId: String(withPatch.shotId || withPatch.id || '').trim(),
          };
        }
        if (a.type === 'UPDATE_SHOT') {
          return {
            ...withPatch,
            shotId: String(withPatch.shotId || withPatch.id || '').trim(),
            sequenceId: String(withPatch.sequenceId || withPatch.parentId || '').trim(),
            patch: mergedPatch,
          };
        }
        if (a.type === 'UPDATE_ELEMENT' || a.type === 'SET_CAST' || a.type === 'GENERATE_SHOT_IMAGE') {
          return {
            ...withPatch,
            shotId: String(withPatch.shotId || withPatch.id || '').trim(),
            sequenceId: String(withPatch.sequenceId || withPatch.parentId || '').trim(),
          };
        }
        if (a.type === 'GENERATE_LOCATION_PREVIEW') {
          return {
            ...withPatch,
            locationId: String(withPatch.locationId || withPatch.id || '').trim(),
          };
        }
        if (a.type === 'GENERATE_CHARACTER_AVATAR') {
          return {
            ...withPatch,
            characterId: String(withPatch.characterId || withPatch.id || '').trim(),
          };
        }
        if (a.type === 'RENAME_SEQUENCE') {
          return {
            ...withPatch,
            sequenceId: String(withPatch.sequenceId || withPatch.id || '').trim(),
          };
        }
        if (a.type === 'RENAME_SCENE' || a.type === 'UPDATE_SCENE' || a.type === 'DELETE_SCENE') {
          return {
            ...withPatch,
            sequenceId: String(withPatch.sequenceId || withPatch.parentId || '').trim(),
            sceneId: String(withPatch.sceneId || withPatch.id || '').trim(),
            patch: mergedPatch,
          };
        }
        if (a.type === 'CREATE_SCENE' || a.type === 'CREATE_SHOT') {
          return {
            ...withPatch,
            sequenceId: String(withPatch.sequenceId || withPatch.parentId || '').trim(),
          };
        }
        return withPatch;
      };

      const normalizedByType = normalizeByType();

      if (a.type === 'UPDATE_CHARACTER') {
        const patch = {
          ...(normalizedByType?.patch || {}),
          ...(typeof normalizedByType?.name === 'string' ? { name: normalizedByType.name } : {}),
          ...(typeof normalizedByType?.description === 'string' ? { description: normalizedByType.description } : {}),
        };
        const normalized: any = {
          ...normalizedByType,
          patch,
        };
        if (typeof normalizedByType?.regenerateDependents === 'boolean') normalized.regenerateDependents = normalizedByType.regenerateDependents;
        if (typeof normalizedByType?.syncDependents === 'boolean') normalized.syncDependents = normalizedByType.syncDependents;
        return { ...a, payload: normalized };
      }

      if (a.type === 'UPDATE_CHARACTER_LOOK') {
        const patch = {
          ...(normalizedByType?.patch || {}),
          ...(typeof normalizedByType?.name === 'string' ? { name: normalizedByType.name } : {}),
          ...(typeof normalizedByType?.description === 'string' ? { description: normalizedByType.description } : {}),
        };
        return {
          ...a,
          payload: {
            ...normalizedByType,
            patch,
          },
        };
      }

      if (a.type === 'GENERATE_CHARACTER_LOOK') {
        const lookId = String(normalizedByType.lookId || normalizedByType.id || '').trim();
        const characterId = String(normalizedByType.characterId || '').trim() || (lookId ? String(lookOwnerById.get(lookId) || '') : '');
        if (
          lookId &&
          characterId &&
          (normalizedByType.lookId !== lookId || normalizedByType.characterId !== characterId || normalizedByType.id)
        ) {
          return {
            ...a,
            payload: {
              ...normalizedByType,
              lookId,
              characterId,
            },
          };
        }
      }
      if (Object.keys(payloadRaw).length || Object.keys(metadataRaw).length || normalizedByType !== payload) {
        return { ...a, payload: normalizedByType };
      }
      return a;
    };

    const normalizedActions = actions.map(normalizeActionPayload);
    const repaired = normalizedActions.filter((a, i) => {
      const before = actions[i] as any;
      const after = a as any;
      return JSON.stringify(before?.payload || {}) !== JSON.stringify(after?.payload || {});
    });
    if (repaired.length) {
      addDebugEvent({
        level: 'info',
        scope: 'agent.direct',
        message: 'Repaired action payloads',
        data: { repaired },
      });
    }

    const invalid: AgentAction[] = [];
    const invalidReasons: Array<{ action: AgentAction; reason?: string }> = [];
    const validActions = normalizedActions.filter((a) => {
      const v = validateAction(a);
      if (!v.ok) {
        invalid.push(a);
        invalidReasons.push({ action: a, reason: v.reason });
      }
      return v.ok;
    });

    if (!validActions.length) {
      addToast('Director actions were invalid (missing payload).', 'info');
      addDebugEvent({ level: 'warn', scope: 'agent.direct', message: 'Dropped invalid actions', data: { actions, invalidReasons } });
      return { applied: 0, dropped: invalid.length, droppedActions: invalid };
    }

    if (invalid.length) {
      addDebugEvent({ level: 'warn', scope: 'agent.direct', message: 'Some actions dropped', data: { invalid, invalidReasons } });
    }

    const navigateActions = validActions.filter((a) => a.type === 'NAVIGATE');
    const kvFlowActions = validActions.filter((a) =>
      a.type === 'GENERATE_MASTER_KV_PROPOSAL' || a.type === 'ACCEPT_KV_PROPOSAL' || a.type === 'DISCARD_KV_PROPOSAL',
    );
    const mutationActions = validActions.filter(
      (a) =>
        !a.type.startsWith('GENERATE_') &&
        a.type !== 'NAVIGATE' &&
        a.type !== 'ACCEPT_KV_PROPOSAL' &&
        a.type !== 'DISCARD_KV_PROPOSAL',
    );
    const generateActions = validActions.filter((a) => a.type.startsWith('GENERATE_') && a.type !== 'GENERATE_MASTER_KV_PROPOSAL');
    const kvUpdated = mutationActions.some((a) => {
      if (a.type !== 'UPDATE_STORY') return false;
      const patch = (a as any)?.payload?.patch || (a as any)?.payload || {};
      if (typeof patch?.keyVisualUrl !== 'string') return false;
      return String(patch.keyVisualUrl || '').trim() !== String(story.keyVisualUrl || '').trim();
    });
    const styleGuideUpdated = mutationActions.some((a) => {
      if (a.type !== 'UPDATE_STORY') return false;
      const patch = (a as any)?.payload?.patch || (a as any)?.payload || {};
      if (typeof patch?.styleGuide !== 'string') return false;
      return String(patch.styleGuide || '').trim() !== String((story as any)?.styleGuide || '').trim();
    });

    if (mutationActions.length) {
      updateStoryById(projectId, (prev) => applyActionsToStory(prev, mutationActions));
      addToast('Director applied edits', 'success');
    }

    if (navigateActions.length) {
      const last = navigateActions[navigateActions.length - 1];
      const nextSel = last?.payload as SelectionState | undefined;
      if (nextSel?.type && nextSel?.id) setSelection(nextSel);
    }

    if (kvFlowActions.length) {
      const hasDiscard = kvFlowActions.some((a) => a.type === 'DISCARD_KV_PROPOSAL');
      const hasGenerate = kvFlowActions.some((a) => a.type === 'GENERATE_MASTER_KV_PROPOSAL');
      const hasAccept = kvFlowActions.some((a) => a.type === 'ACCEPT_KV_PROPOSAL');
      if (hasDiscard && hasGenerate) {
        queueKvConsoleAction('regenerate', projectId);
        addToast('KV regenerate requested by Director. Review in Project Dashboard.', 'info');
      } else if (hasGenerate) {
        queueKvConsoleAction('generate', projectId);
        addToast('KV update requested by Director. Review in Project Dashboard.', 'info');
      } else if (hasAccept) {
        queueKvConsoleAction('accept', projectId);
        addToast('Director requested accepting current KV proposal.', 'info');
      } else if (hasDiscard) {
        queueKvConsoleAction('discard', projectId);
        addToast('Director requested discarding current KV proposal.', 'info');
      }
    }

    const storyAfterUpdates = mutationActions.length ? applyActionsToStory(story, mutationActions) : story;

    const deduped = new Map<string, AssetJob>();
    const addJob = (key: string, job: AssetJob) => {
      if (!deduped.has(key)) deduped.set(key, job);
    };
    const getAvatarVersionId = (ch: any) => {
      const id = String(ch?.activeAvatarVersionId || '').trim();
      return id || undefined;
    };

    // Auto-generate storyboard images for newly created shots.
    const createdShots: Array<{ sequenceId: string; shot: Shot }> = [];
    if (mutationActions.some((a) => a.type === 'CREATE_SHOT')) {
      const beforeMap = new Map<string, Set<string>>();
      for (const seq of story.sequences || []) {
        beforeMap.set(seq.id, new Set((seq.shots || []).map((s) => s.id)));
      }
      for (const seq of storyAfterUpdates.sequences || []) {
        const before = beforeMap.get(seq.id) || new Set<string>();
        for (const sh of seq.shots || []) {
          if (!before.has(sh.id)) createdShots.push({ sequenceId: seq.id, shot: sh });
        }
      }
    }

    if (createdShots.length) {
      for (const { sequenceId, shot } of createdShots) {
        addJob(`shot:${sequenceId}:${shot.id}`, { kind: 'shot', sequenceId, shot });
      }
    }

    let concurrency = 2;
    let scopeLabel = 'director';

    // Auto-generate look images for newly created looks (director-created) to avoid avatar fallback.
    if (mutationActions.some((a) => a.type === 'CREATE_CHARACTER_LOOK')) {
      const beforeMap = new Map<string, Set<string>>();
      for (const ch of story.characters || []) {
        beforeMap.set(
          ch.id,
          new Set((ch.looks || []).map((lk) => String(lk.id)))
        );
      }
      const styleGuide = (storyAfterUpdates as any)?.styleGuide;
      for (const ch of storyAfterUpdates.characters || []) {
        const prev = beforeMap.get(ch.id) || new Set<string>();
        for (const lk of ch.looks || []) {
          const lookId = String(lk.id || '');
          if (!lookId || prev.has(lookId)) continue;
          addJob(`look:${ch.id}:${lookId}`, {
            kind: 'look',
            characterId: ch.id,
            lookId,
            prompt: buildCharacterLookPrompt(ch, lk, styleGuide),
            avatarVersionId: getAvatarVersionId(ch),
          });
        }
      }
    }

    // Auto-generate storyboard images when director updates shot description/time/location.
    const updatedShotIds: Array<{ sequenceId?: string; shotId: string }> = [];
    for (const a of mutationActions) {
      if (a.type !== 'UPDATE_SHOT') continue;
      const payload = (a as any).payload || {};
      const patch = payload?.patch || {};
      const hasVisualChange =
        typeof patch.description === 'string' ||
        typeof patch.timeOfDay === 'string' ||
        typeof patch.locationId === 'string' ||
        typeof patch.duration === 'number';
      if (!hasVisualChange) continue;
      const shotId = String(payload.shotId || '');
      if (!shotId) continue;
      const sequenceId = payload.sequenceId ? String(payload.sequenceId) : undefined;
      updatedShotIds.push({ sequenceId, shotId });
    }
    if (updatedShotIds.length) {
      for (const { sequenceId, shotId } of updatedShotIds) {
        let seq = sequenceId ? storyAfterUpdates.sequences.find((s) => s.id === sequenceId) : undefined;
        if (!seq) seq = storyAfterUpdates.sequences.find((s) => s.shots.some((sh) => sh.id === shotId));
        const shot = seq?.shots.find((s) => s.id === shotId);
        if (seq && shot) addJob(`shot:${seq.id}:${shotId}`, { kind: 'shot', sequenceId: seq.id, shot });
      }
    }

    // Auto-generate look images when look descriptions are updated.
    const updatedLooks: Array<{ characterId: string; lookId: string }> = [];
    const updatedLooksWithDependentSync: Array<{ characterId: string; lookId: string }> = [];
    for (const a of mutationActions) {
      if (a.type !== 'UPDATE_CHARACTER_LOOK') continue;
      const payload = (a as any).payload || {};
      let characterId = String(payload.characterId || '').trim();
      const lookId = String(payload.lookId || payload.id || '').trim();
      const patch = payload.patch || {};
      const hasVisualChange =
        typeof patch.description === 'string' ||
        typeof patch.name === 'string' ||
        typeof payload.description === 'string' ||
        typeof payload.name === 'string';
      const wantsDependentSync =
        payload.regenerateDependents === true ||
        payload.syncDependents === true ||
        patch.regenerateDependents === true ||
        patch.syncDependents === true;
      if (!characterId && lookId) {
        const found = storyAfterUpdates.characters.find((c) => (c.looks || []).some((l) => String(l.id) === lookId));
        if (found) characterId = String(found.id || '').trim();
      }
      if (characterId && lookId && hasVisualChange) {
        updatedLooks.push({ characterId, lookId });
        if (wantsDependentSync) updatedLooksWithDependentSync.push({ characterId, lookId });
      }
    }
    if (updatedLooks.length) {
      const styleGuide = (storyAfterUpdates as any)?.styleGuide;
      for (const { characterId, lookId } of updatedLooks) {
        const ch = storyAfterUpdates.characters.find((c) => c.id === characterId);
        const lk = ch?.looks?.find((x) => x.id === lookId);
        if (!ch || !lk) continue;
        addJob(`look:${characterId}:${lookId}`, {
          kind: 'look',
          characterId,
          lookId,
          prompt: buildCharacterLookPrompt(ch, lk, styleGuide),
          avatarVersionId: getAvatarVersionId(ch),
        });
      }
    }
    if (updatedLooksWithDependentSync.length) {
      scopeLabel = scopeLabel === 'director' ? 'director:look->dependent-shots' : scopeLabel;
      for (const { characterId, lookId } of updatedLooksWithDependentSync) {
        for (const seq of storyAfterUpdates.sequences || []) {
          for (const shot of seq.shots || []) {
            const cast = (shot.elements as any)?.[ElementType.CASTING]?.metadata?.characters;
            const castArr = Array.isArray(cast) ? cast : [];
            const included = castArr.some(
              (c: any) =>
                String(c?.id || '').trim() === characterId &&
                String(c?.activeLookId || '').trim() === lookId,
            );
            if (!included) continue;
            addJob(`shot:${seq.id}:${shot.id}`, {
              kind: 'shot',
              sequenceId: String(seq.id || ''),
              shot,
            });
          }
        }
      }
    }

    // Auto-generate dependent assets when character identity is updated.
    // This makes directives like "rename character + remove minor traits + sync keyframes" executable in one step.
    const updatedCharacterIds = new Set<string>();
    for (const a of mutationActions) {
      if (a.type !== 'UPDATE_CHARACTER') continue;
      const payload = (a as any).payload || {};
      const characterId = String(payload.characterId || '').trim();
      const patch = payload.patch || payload || {};
      const hasIdentityChange = typeof patch.name === 'string' || typeof patch.description === 'string';
      const wantsDependentSync =
        payload.regenerateDependents === true ||
        payload.syncDependents === true ||
        patch.regenerateDependents === true ||
        patch.syncDependents === true;
      if (characterId && hasIdentityChange && wantsDependentSync) updatedCharacterIds.add(characterId);
    }
    if (updatedCharacterIds.size) {
      scopeLabel = scopeLabel === 'director' ? 'director:character->dependents' : scopeLabel;
      const styleGuide = String((storyAfterUpdates as any)?.styleGuide || '').trim();
      for (const characterId of updatedCharacterIds) {
        const ch = storyAfterUpdates.characters.find((c) => String(c.id || '') === characterId);
        if (!ch) continue;

        addJob(`character:${characterId}`, {
          kind: 'character',
          characterId,
          prompt: buildCharacterAvatarPrompt(ch, styleGuide),
        });

        for (const lk of ch.looks || []) {
          const lookId = String((lk as any)?.id || '').trim();
          if (!lookId) continue;
          addJob(`look:${characterId}:${lookId}`, {
            kind: 'look',
            characterId,
            lookId,
            prompt: buildCharacterLookPrompt(ch, lk, styleGuide),
            avatarVersionId: getAvatarVersionId(ch),
          });
        }

        for (const seq of storyAfterUpdates.sequences || []) {
          for (const shot of seq.shots || []) {
            const cast = (shot.elements as any)?.[ElementType.CASTING]?.metadata?.characters;
            const castArr = Array.isArray(cast) ? cast : [];
            const included = castArr.some((c: any) => String(c?.id || '').trim() === characterId);
            if (!included) continue;
            addJob(`shot:${seq.id}:${shot.id}`, {
              kind: 'shot',
              sequenceId: String(seq.id || ''),
              shot,
            });
          }
        }
      }
    }

    if (kvUpdated || styleGuideUpdated) {
      scopeLabel = 'director:kv->all';
      const jobs = buildAssetJobs(storyAfterUpdates, 'all');
      for (const j of jobs) {
        if (j.kind === 'masterkv') addJob(`masterkv`, j);
        if (j.kind === 'shot') addJob(`shot:${j.sequenceId}:${j.shot.id}`, j);
        if (j.kind === 'location') addJob(`location:${j.locationId}`, j);
        if (j.kind === 'character') addJob(`character:${j.characterId}`, j);
        if (j.kind === 'look') addJob(`look:${j.characterId}:${j.lookId}`, j);
      }
    }

    if (!generateActions.length && deduped.size === 0) {
      return { applied: validActions.length, dropped: invalid.length, droppedActions: invalid };
    }

    for (const a of generateActions) {
      const payload = (a as any).payload || {};
      if (a.type === 'GENERATE_PROJECT_ASSETS') {
        const scope = String(payload.scope || 'all') as any;
        if (typeof payload.concurrency === 'number' && payload.concurrency > 0 && payload.concurrency <= 6) {
          concurrency = Math.floor(payload.concurrency);
        }
        scopeLabel = `director:${scope}`;
        const jobs = buildAssetJobs(storyAfterUpdates, scope);
        for (const j of jobs) {
          if (j.kind === 'masterkv') addJob(`masterkv`, j);
          if (j.kind === 'shot') addJob(`shot:${j.sequenceId}:${j.shot.id}`, j);
          if (j.kind === 'location') addJob(`location:${j.locationId}`, j);
          if (j.kind === 'character') addJob(`character:${j.characterId}`, j);
          if (j.kind === 'look') addJob(`look:${j.characterId}:${j.lookId}`, j);
        }
        continue;
      }

      if (a.type === 'GENERATE_SHOT_IMAGE') {
        const sequenceId = String(payload.sequenceId || '');
        const shotId = String(payload.shotId || '');
        const seq = storyAfterUpdates.sequences.find((s) => s.id === sequenceId);
        const shot = seq?.shots.find((s) => s.id === shotId);
        if (shot && sequenceId) addJob(`shot:${sequenceId}:${shotId}`, { kind: 'shot', sequenceId, shot });
        continue;
      }

      if (a.type === 'GENERATE_LOCATION_PREVIEW') {
        const locationId = String(payload.locationId || '');
        const loc = storyAfterUpdates.locations.find((l) => l.id === locationId);
        if (loc) addJob(`location:${locationId}`, { kind: 'location', locationId, prompt: buildLocationPreviewPrompt(loc, (storyAfterUpdates as any)?.styleGuide) });
        continue;
      }

      if (a.type === 'GENERATE_CHARACTER_AVATAR') {
        const characterId = String(payload.characterId || '');
        const ch = storyAfterUpdates.characters.find((c) => c.id === characterId);
        if (ch) addJob(`character:${characterId}`, { kind: 'character', characterId, prompt: buildCharacterAvatarPrompt(ch, (storyAfterUpdates as any)?.styleGuide) });
        continue;
      }

      if (a.type === 'GENERATE_CHARACTER_LOOK') {
        const characterId = String(payload.characterId || '');
        const lookId = String(payload.lookId || '');
        const ch = storyAfterUpdates.characters.find((c) => c.id === characterId);
        const lk = ch?.looks?.find((x) => x.id === lookId);
        if (ch && lk)
          addJob(`look:${characterId}:${lookId}`, {
            kind: 'look',
            characterId,
            lookId,
            prompt: buildCharacterLookPrompt(ch, lk, (storyAfterUpdates as any)?.styleGuide),
            avatarVersionId: getAvatarVersionId(ch),
          });
        continue;
      }
    }

    const ensurePrerequisiteJobs = () => {
      const currentJobs = Array.from(deduped.values());
      const hasShotJob = currentJobs.some((j) => j.kind === 'shot');
      if (!hasShotJob) return;

      const styleGuide = String((storyAfterUpdates as any)?.styleGuide || '').trim();
      for (const j of currentJobs) {
        if (j.kind !== 'shot') continue;
        const seq = storyAfterUpdates.sequences.find((s) => s.id === j.sequenceId);
        const shot = seq?.shots.find((s) => s.id === j.shot.id) || j.shot;
        const locId = String(shot.locationId || '').trim();
        if (locId) {
          const loc = storyAfterUpdates.locations.find((l) => l.id === locId);
          if (loc) addJob(`location:${locId}`, { kind: 'location', locationId: locId, prompt: buildLocationPreviewPrompt(loc, styleGuide) });
        }

        const cast = (shot.elements as any)?.CASTING?.metadata?.characters;
        const castArr = Array.isArray(cast) ? cast : [];
        for (const c of castArr.slice(0, 4)) {
          const characterId = String(c?.id || '').trim();
          if (!characterId) continue;
          const ch = storyAfterUpdates.characters.find((x) => x.id === characterId);
          if (!ch) continue;
          addJob(`character:${characterId}`, { kind: 'character', characterId, prompt: buildCharacterAvatarPrompt(ch, styleGuide) });

          const lookId = String(c?.activeLookId || '').trim();
          if (!lookId) continue;
          const lk = ch.looks?.find((x) => x.id === lookId);
          if (!lk) continue;
          addJob(`look:${characterId}:${lookId}`, {
            kind: 'look',
            characterId,
            lookId,
            prompt: buildCharacterLookPrompt(ch, lk, styleGuide),
            // Do not pin to a possibly stale avatar version in shot prerequisite batches.
            // If character jobs run in the same batch, look jobs must bind to the latest active avatar.
            avatarVersionId: undefined,
          });
        }
      }
    };
    ensurePrerequisiteJobs();

    // If a character avatar job exists in this batch, clear look-job avatar pinning for that character.
    // This prevents "look not bound to active avatar" blocks when active avatar changes during the same batch.
    const queuedCharacterIds = new Set(
      Array.from(deduped.values())
        .filter((j): j is Extract<AssetJob, { kind: 'character' }> => j.kind === 'character')
        .map((j) => String(j.characterId || '').trim())
        .filter(Boolean),
    );
    if (queuedCharacterIds.size) {
      for (const [key, job] of deduped.entries()) {
        if (job.kind !== 'look') continue;
        const characterId = String(job.characterId || '').trim();
        if (!characterId || !queuedCharacterIds.has(characterId)) continue;
        deduped.set(key, {
          ...job,
          avatarVersionId: undefined,
        });
      }
    }

    const jobs = Array.from(deduped.values());
    if (jobs.length && opts?.deferGeneration) {
      return {
        applied: validActions.length,
        dropped: invalid.length,
        droppedActions: invalid,
        deferredJobs: jobs,
        scopeLabel,
        concurrency,
        storyAfterUpdates,
      };
    }
    if (jobs.length) runAssetJobsForDirector({ projectId, story: storyAfterUpdates, jobs, scopeLabel, concurrency });
    return { applied: validActions.length, dropped: invalid.length, droppedActions: invalid, storyAfterUpdates };
  };

  const handleAcceptProposedStyleGuide = (args: { styleGuide: string; regenerateAssets: boolean }) => {
    if (!activeStory || !workspace.activeProjectId) return;
    const styleGuide = String(args.styleGuide || '').trim();
    if (!styleGuide) return;
    const projectId = workspace.activeProjectId;
    updateStoryById(projectId, (prev) => ({
      ...prev,
      styleGuide,
      proposedStyleGuide: '',
      proposedStyleGuideUpdatedAt: Date.now(),
      proposedStyleGuideSourceKvVersionId: '',
      assetsSyncedKvVersionId: String((prev as any).activeKeyVisualVersionId || ''),
    }));
    addToast('Style guide accepted', 'success');
    if (args.regenerateAssets) {
      const storyForExec = {
        ...activeStory,
        styleGuide,
        proposedStyleGuide: '',
        proposedStyleGuideUpdatedAt: Date.now(),
        proposedStyleGuideSourceKvVersionId: '',
        assetsSyncedKvVersionId: String((activeStory as any).activeKeyVisualVersionId || ''),
      } as Story;
      applyDirectorActions(projectId, storyForExec, [{ type: 'GENERATE_PROJECT_ASSETS', payload: { scope: 'all' } }]);
      addToast('Regenerating all assets with new style guide…', 'info');
    }
  };

  const handleUpdateAssetsFromKv = (activeKvVersionId: string) => {
    if (!activeStory || !workspace.activeProjectId) return;
    const projectId = workspace.activeProjectId;
    updateStoryById(projectId, (prev) => ({
      ...prev,
      assetsSyncedKvVersionId: String(activeKvVersionId || (prev as any).activeKeyVisualVersionId || ''),
    }));
    applyDirectorActions(projectId, activeStory, [{ type: 'GENERATE_PROJECT_ASSETS', payload: { scope: 'all' } }]);
    addToast('Regenerating all assets from active KV…', 'info');
  };

  const parseChatImageAttachments = async (files: File[]) => {
    const picked = (files || []).filter((f) => f.type.startsWith('image/')).slice(0, 4);
    const reads = picked.map(
      (file) =>
        new Promise<{ id: string; url: string; name?: string; createdAt?: number }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              id: `chat-ref-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
              url: String(reader.result || ''),
              name: file.name,
              createdAt: Date.now(),
            });
          reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
          reader.readAsDataURL(file);
        }),
    );
    const settled = await Promise.allSettled(reads);
    return settled
      .filter((r): r is PromiseFulfilledResult<{ id: string; url: string; name?: string; createdAt?: number }> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((r) => r.url);
  };

  const attachReferencesBySelection = (
    story: Story,
    selectionSnapshot: SelectionState,
    refs: Array<{ id: string; url: string; name?: string; createdAt?: number }>,
  ): Story => {
    if (!refs.length) return story;
    const mergeRefs = (existing: any[]) => [...(Array.isArray(existing) ? existing : []), ...refs].slice(-4);
    if (selectionSnapshot.type === 'location') {
      return {
        ...story,
        locations: story.locations.map((l) =>
          l.id === selectionSnapshot.id ? ({ ...l, referenceImages: mergeRefs((l as any).referenceImages), referenceMode: 'auto' } as any) : l,
        ),
      };
    }
    if (selectionSnapshot.type === 'character') {
      return {
        ...story,
        characters: story.characters.map((c) =>
          c.id === selectionSnapshot.id ? ({ ...c, referenceImages: mergeRefs((c as any).referenceImages), referenceMode: 'auto' } as any) : c,
        ),
      };
    }
    return { ...story, referenceImages: mergeRefs((story as any).referenceImages), referenceMode: 'auto' } as any;
  };

  const interactionCandidateSummary = useMemo(() => {
    if (!pendingInteractionGeneration) return null;
    const s = pendingInteractionGeneration.story;
    const jobs = pendingInteractionGeneration.jobs || [];
    const hasKv = jobs.some((j) => j.kind === 'masterkv');
    const locationIds = Array.from(new Set(jobs.filter((j) => j.kind === 'location').map((j: any) => String(j.locationId || '')))).filter(Boolean);
    const characterIds = Array.from(
      new Set(
        jobs
          .filter((j) => j.kind === 'character' || j.kind === 'look')
          .map((j: any) => String(j.characterId || '')),
      ),
    ).filter(Boolean);
    return {
      hasKv,
      kvRefCount: Array.isArray((s as any).referenceImages) ? (s as any).referenceImages.length : 0,
      locations: locationIds
        .map((id) => s.locations.find((l) => l.id === id))
        .filter(Boolean)
        .map((l) => ({
          id: String((l as any).id),
          name: String((l as any).name || 'Location'),
          desc: String((l as any).description || ''),
          refs: Array.isArray((l as any).referenceImages) ? (l as any).referenceImages.length : 0,
        })),
      cast: characterIds
        .map((id) => s.characters.find((c) => c.id === id))
        .filter(Boolean)
        .map((c) => ({
          id: String((c as any).id),
          name: String((c as any).name || 'Character'),
          desc: String((c as any).description || ''),
          refs: Array.isArray((c as any).referenceImages) ? (c as any).referenceImages.length : 0,
        })),
    };
  }, [pendingInteractionGeneration]);

  const confirmInteractionGeneration = () => {
    const pending = pendingInteractionGeneration;
    if (!pending) return;
    runAssetJobsForDirector({
      projectId: pending.projectId,
      story: pending.story,
      jobs: pending.jobs,
      scopeLabel: pending.scopeLabel,
      concurrency: pending.concurrency,
    });
    setPendingInteractionGeneration(null);
  };

  const narrowShotScopedGenerateActions = (actions: AgentAction[], sel: SelectionState): AgentAction[] => {
    if (sel.type !== 'shot') return actions;
    const sequenceId = String(sel.parentId || '').trim();
    const shotId = String(sel.id || '').trim();
    if (!sequenceId || !shotId) return actions;
    // If new shots are being created, keep broad generation because IDs may be unstable.
    if (actions.some((a) => a.type === 'CREATE_SHOT')) return actions;

    let injected = false;
    const next: AgentAction[] = [];
    for (const a of actions) {
      if (a.type === 'GENERATE_PROJECT_ASSETS') {
        const scope = String((a as any)?.payload?.scope || 'all').toLowerCase();
        if (scope === 'shots' || scope === 'all') {
          if (!injected) {
            next.push({ type: 'GENERATE_SHOT_IMAGE', payload: { sequenceId, shotId } } as any);
            injected = true;
          }
          continue;
        }
      }
      next.push(a);
    }
    return next;
  };

  // ----- Director Console -----

		  const handleDirectorMessage = async (msg: string, attachments: File[] = []) => {
		    if (!activeStory || !workspace.activeProjectId) return;
        if (pendingInteractionGeneration) {
          setPendingInteractionGeneration(null);
          addToast('Pending generation confirmation was cleared. Applying your new instruction.', 'info');
        }
        const isInteractionMode = String((aiSettings.direct as any)?.workflowMode || 'auto') === 'interaction';
        const normalizedMsg = String(msg || '').trim() || 'Use attached images as references and continue with interaction flow.';
        const directive = isInteractionMode
          ? [
              '[Interaction Mode]',
              'First clarify intent and constraints. For KV/location/cast generation, ask for references and propose candidates before generation.',
              'Do not run generation actions until user explicitly confirms to generate.',
              `User: ${normalizedMsg}`,
            ].join('\n')
          : normalizedMsg;
		      const projectId = workspace.activeProjectId;
        const selectionSnapshot = selection;
        const parsedRefs = await parseChatImageAttachments(attachments || []);
        const storyWithAttachments = parsedRefs.length
          ? attachReferencesBySelection(activeStory, selectionSnapshot, parsedRefs)
          : activeStory;
        if (parsedRefs.length) {
          updateStoryById(projectId, () => storyWithAttachments);
          addToast(`Attached ${parsedRefs.length} reference image(s) to current context.`, 'info');
        }
        setIsDirectorThinking(true);
        addDebugEvent({
          level: 'info',
          scope: 'agent.direct',
          message: 'Request',
          data: {
            message: directive,
            rawMessage: msg,
            selection: selectionSnapshot,
            storyId: activeStory.id,
            interactionMode: isInteractionMode,
            attachmentCount: parsedRefs.length,
          },
        });
        const useStreaming = Boolean((aiSettings.direct as any)?.useStreaming);
        if (useStreaming) {
          setDirectorStream({ status: 'Starting…', steps: [] });
        } else {
          setDirectorStream(null);
        }

	    const userEntry: AgentLogEntry = {
	      id: `u-${Date.now()}`,
	      role: 'user',
      content: parsedRefs.length ? `${normalizedMsg}\n[Attachments: ${parsedRefs.map((x) => x.name || 'image').join(', ')}]` : normalizedMsg,
      timestamp: Date.now(),
    };

	    setAgentHistoryByProject((prev) => ({
	      ...prev,
	      [projectId]: [...(prev[projectId] || []), userEntry],
	    }));

        let res: DirectorCommandResponse;
        try {
          if (useStreaming) {
            res = await runDirectorCommandStream(
              {
                message: directive,
                selection: selectionSnapshot,
                story: storyWithAttachments,
                settings: aiSettings.direct,
                allowSingleFallback: false,
                useFunctionCalling: Boolean((aiSettings.direct as any)?.useFunctionCalling),
              },
              (ev: DirectorStreamEvent) => {
                if (ev.event === 'status') {
                  setDirectorStream((prev) => ({ status: ev.data.message, reply: prev?.reply, steps: prev?.steps || [] }));
                }
                if (ev.event === 'agent_start') {
                  setDirectorStream((prev) => ({
                    status: `Running ${ev.data.agent}…`,
                    reply: prev?.reply,
                    steps: [...(prev?.steps || []), { agent: ev.data.agent, status: 'running' }],
                  }));
                }
                if (ev.event === 'agent_done') {
                  setDirectorStream((prev) => ({
                    status: prev?.status,
                    reply: prev?.reply,
                    steps: (prev?.steps || []).map((s) =>
                      s.agent === ev.data.agent
                        ? { ...s, ok: ev.data.ok, ms: ev.data.ms, error: ev.data.error, status: ev.data.ok ? 'done' : 'error' }
                        : s
                    ),
                  }));
                }
                if (ev.event === 'reply_delta') {
                  setDirectorStream((prev) => ({
                    status: prev?.status,
                    reply: `${prev?.reply || ''}${ev.data.delta || ''}`,
                    steps: prev?.steps || [],
                  }));
                }
                if (ev.event === 'reply_done') {
                  setDirectorStream((prev) => ({
                    status: prev?.status,
                    reply: ev.data.text || prev?.reply,
                    steps: prev?.steps || [],
                  }));
                }
              }
            );
          } else {
            res = await runDirectorCommand({
              message: directive,
              selection: selectionSnapshot,
              story: storyWithAttachments,
              settings: aiSettings.direct,
              allowSingleFallback: false,
              useFunctionCalling: Boolean((aiSettings.direct as any)?.useFunctionCalling),
            });
          }
          addDebugEvent({ level: 'info', scope: 'agent.direct', message: 'Response', data: res });
        } catch (e) {
          const errMsg = isAgentApiError(e)
            ? String(e.bodyJson?.multiAgentError || e.bodyJson?.message || e.message)
            : e instanceof Error
              ? e.message
              : String(e);

          const agentEntry: AgentLogEntry = {
            id: `a-${Date.now()}`,
            role: 'agent',
            content: `Director request failed: ${errMsg}`,
            timestamp: Date.now(),
            actionDetails: { type: 'DIRECTOR_ERROR' },
            debug: isAgentApiError(e) ? { ...(e.bodyJson || {}), status: e.status, url: e.url } : { error: errMsg },
          };

          setAgentHistoryByProject((prev) => ({
            ...prev,
            [projectId]: [...(prev[projectId] || []), agentEntry],
          }));

          if (isAgentApiError(e) && e.bodyJson?.errorCode === 'MULTI_AGENT_FAILED') {
            setPendingDirectorMultiAgentFailure({
              projectId,
              message: msg,
              selection: selectionSnapshot,
              error: errMsg,
              details: e.bodyJson,
            });
            setPendingDirectorSingleFallbackArmed(false);
            addToast('Director multi-agent failed. Retry or choose single-call fallback.', 'info');
          } else {
            addToast('Director request failed. Open Debug (Ctrl/Cmd+Shift+D) for details.', 'info');
          }
          setIsDirectorThinking(false);
          setDirectorStream(null);
          return;
        }

        const isFallback = res.debug?.transport === 'rule' && aiSettings.direct.provider !== 'mock';

        const agentEntryId = `a-${Date.now()}`;
        const agentEntry: AgentLogEntry = {
          id: agentEntryId,
          role: 'agent',
          content: res.reply,
          timestamp: Date.now(),
          actionDetails: { type: isFallback ? 'DIRECTOR_FALLBACK_PENDING' : 'DIRECTOR_COMMAND', actions: res.actions, planId: res.plan.id },
          debug: res.debug,
        };

		    setAgentHistoryByProject((prev) => ({
		      ...prev,
		      [projectId]: [...(prev[projectId] || []), agentEntry],
		    }));

        if (isFallback) {
          setPendingDirectorFallback({ projectId, res });
          setPendingDirectorFallbackArmed(false);
          addToast('Director returned fallback output. Confirm before applying.', 'info');
          setIsDirectorThinking(false);
          setDirectorStream(null);
          return;
        }
		
        const scopedActions = narrowShotScopedGenerateActions(res.actions || [], selectionSnapshot);
        const exec = applyDirectorActions(projectId, storyWithAttachments, scopedActions, {
          deferGeneration: isInteractionMode,
        });
        if (isInteractionMode && exec.deferredJobs?.length) {
          setPendingInteractionGeneration({
            id: `pending-gen-${Date.now()}`,
            projectId,
            jobs: exec.deferredJobs,
            scopeLabel: exec.scopeLabel || 'director:interaction',
            concurrency: exec.concurrency || 2,
            story: exec.storyAfterUpdates || activeStory,
          });
          addToast('Interaction mode: generation is waiting for your confirmation.', 'info');
        }
        if (exec) {
          setAgentHistoryByProject((prev) => ({
            ...prev,
            [projectId]: (prev[projectId] || []).map((entry) =>
              entry.id === agentEntryId
                ? {
                    ...entry,
                    actionDetails: {
                      ...entry.actionDetails,
                      applied: exec.applied,
                      dropped: exec.dropped,
                      droppedActions: exec.droppedActions,
                    },
                  }
                : entry
            ),
          }));
        }
        setIsDirectorThinking(false);
        setDirectorStream(null);
		  };

      const retryDirectorAfterFailure = async (allowSingleFallback: boolean) => {
        if (!pendingDirectorMultiAgentFailure || !activeStory || !workspace.activeProjectId) return;
        if (pendingDirectorMultiAgentFailure.projectId !== activeStory.id) return;

        const projectId = pendingDirectorMultiAgentFailure.projectId;
        const msg = pendingDirectorMultiAgentFailure.message;
        const isInteractionMode = String((aiSettings.direct as any)?.workflowMode || 'auto') === 'interaction';
        const directive = isInteractionMode
          ? [
              '[Interaction Mode]',
              'First clarify intent and constraints. For KV/location/cast generation, ask for references and propose candidates before generation.',
              'Do not run generation actions until user explicitly confirms to generate.',
              `User: ${msg}`,
            ].join('\n')
          : msg;
        const selectionSnapshot = pendingDirectorMultiAgentFailure.selection;
        setIsDirectorThinking(true);
        const useStreaming = Boolean((aiSettings.direct as any)?.useStreaming);
        if (useStreaming) {
          setDirectorStream({ status: 'Retrying…', steps: [] });
        } else {
          setDirectorStream(null);
        }

        try {
          const res = useStreaming
            ? await runDirectorCommandStream(
                {
                  message: directive,
                  selection: selectionSnapshot,
                  story: activeStory,
                  settings: aiSettings.direct,
                  allowSingleFallback,
                  useFunctionCalling: Boolean((aiSettings.direct as any)?.useFunctionCalling),
                },
                (ev: DirectorStreamEvent) => {
                  if (ev.event === 'status') {
                    setDirectorStream((prev) => ({ status: ev.data.message, reply: prev?.reply, steps: prev?.steps || [] }));
                  }
                  if (ev.event === 'agent_start') {
                    setDirectorStream((prev) => ({
                      status: `Running ${ev.data.agent}…`,
                      reply: prev?.reply,
                      steps: [...(prev?.steps || []), { agent: ev.data.agent, status: 'running' }],
                    }));
                  }
                  if (ev.event === 'agent_done') {
                    setDirectorStream((prev) => ({
                      status: prev?.status,
                      reply: prev?.reply,
                      steps: (prev?.steps || []).map((s) =>
                        s.agent === ev.data.agent
                          ? { ...s, ok: ev.data.ok, ms: ev.data.ms, error: ev.data.error, status: ev.data.ok ? 'done' : 'error' }
                          : s
                      ),
                    }));
                  }
                  if (ev.event === 'reply_delta') {
                    setDirectorStream((prev) => ({
                      status: prev?.status,
                      reply: `${prev?.reply || ''}${ev.data.delta || ''}`,
                      steps: prev?.steps || [],
                    }));
                  }
                  if (ev.event === 'reply_done') {
                    setDirectorStream((prev) => ({
                      status: prev?.status,
                      reply: ev.data.text || prev?.reply,
                      steps: prev?.steps || [],
                    }));
                  }
                }
              )
            : await runDirectorCommand({
                message: directive,
                selection: selectionSnapshot,
                story: activeStory,
                settings: aiSettings.direct,
                allowSingleFallback,
                useFunctionCalling: Boolean((aiSettings.direct as any)?.useFunctionCalling),
              });

          const agentEntryId = `sys-${Date.now()}`;
          const agentEntry: AgentLogEntry = {
            id: agentEntryId,
            role: 'system',
            content: `Director retry (${allowSingleFallback ? 'single-call fallback enabled' : 'multi-agent only'}) succeeded.`,
            timestamp: Date.now(),
            actionDetails: { type: 'DIRECTOR_RETRY', actions: res.actions, planId: res.plan.id },
            debug: res.debug,
          };
          setAgentHistoryByProject((prev) => ({
            ...prev,
            [projectId]: [...(prev[projectId] || []), agentEntry],
          }));

          const isFallback = res.debug?.transport === 'rule' && aiSettings.direct.provider !== 'mock';
          if (isFallback) {
            setPendingDirectorFallback({ projectId, res });
            setPendingDirectorFallbackArmed(false);
            setPendingDirectorMultiAgentFailure(null);
            setPendingDirectorSingleFallbackArmed(false);
            addToast('Director returned fallback output. Confirm before applying.', 'info');
            setIsDirectorThinking(false);
            setDirectorStream(null);
            return;
          }

          const scopedActions = narrowShotScopedGenerateActions(res.actions || [], selectionSnapshot);
          const exec = applyDirectorActions(projectId, activeStory, scopedActions, {
            deferGeneration: isInteractionMode,
          });
          if (isInteractionMode && exec.deferredJobs?.length) {
            setPendingInteractionGeneration({
              id: `pending-gen-${Date.now()}`,
              projectId,
              jobs: exec.deferredJobs,
              scopeLabel: exec.scopeLabel || 'director:interaction',
              concurrency: exec.concurrency || 2,
              story: exec.storyAfterUpdates || activeStory,
            });
            addToast('Interaction mode: generation is waiting for your confirmation.', 'info');
          }
          if (exec) {
            setAgentHistoryByProject((prev) => ({
              ...prev,
              [projectId]: (prev[projectId] || []).map((entry) =>
                entry.id === agentEntryId
                  ? {
                      ...entry,
                      actionDetails: {
                        ...entry.actionDetails,
                        applied: exec.applied,
                        dropped: exec.dropped,
                        droppedActions: exec.droppedActions,
                      },
                    }
                  : entry
              ),
            }));
          }
          setPendingDirectorMultiAgentFailure(null);
          setPendingDirectorSingleFallbackArmed(false);
          setIsDirectorThinking(false);
          setDirectorStream(null);
        } catch (e) {
          const errMsg = isAgentApiError(e)
            ? String(e.bodyJson?.multiAgentError || e.bodyJson?.message || e.message)
            : e instanceof Error
              ? e.message
              : String(e);
          setPendingDirectorMultiAgentFailure((prev) => (prev ? { ...prev, error: errMsg, details: isAgentApiError(e) ? e.bodyJson : prev.details } : prev));
          setPendingDirectorSingleFallbackArmed(false);
          addToast('Director retry failed. Check Debug.', 'info');
          setIsDirectorThinking(false);
          setDirectorStream(null);
        }
      };

  // ----- Screens -----

  if (screen === 'library') {
    return (
      <>
        <ProjectLibrary
          projects={workspace.projects}
          currentUserId={currentUserId}
          theme={theme}
          toggleTheme={toggleTheme}
          onOpenProject={openProject}
          onCreateProject={() => setScreen('creation')}
          onCreateDemoProject={handleCreateDemoProject}
          onRenameProject={handleRenameProject}
          onDuplicateProject={handleDuplicateProject}
          onDeleteProject={handleDeleteProject}
          onExportProject={handleExportProject}
          onImportProjects={() => importInputRef.current?.click()}
          onOpenAiSettings={() => setIsAiSettingsOpen(true)}
          onOpenDebug={() => setIsDebugOpen(true)}
        />
        <input
          ref={importInputRef}
          type="file"
          accept=".json,.vision-project.json"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files?.length) handleImportProjects(files);
            e.currentTarget.value = '';
          }}
        />

        {isAiSettingsOpen && (
          <AiSettingsModal
            settings={aiSettings}
            onSave={(next) => {
              setAiSettings(next);
              setIsAiSettingsOpen(false);
              addToast('AI settings saved', 'success');
            }}
            onClose={() => setIsAiSettingsOpen(false)}
          />
        )}
        {isDebugOpen && (
          <DebugPanel
            aiSettings={aiSettings}
            activeStory={null}
            agentHistory={[]}
            onClose={() => setIsDebugOpen(false)}
          />
        )}
      </>
    );
  }

  if (screen === 'creation') {
    return (
      <>
        <ProjectCreationWizard
          aiSettings={aiSettings}
          workflowMode={String((aiSettings.direct as any)?.workflowMode || 'auto') as any}
          onWorkflowModeChange={(mode) =>
            setAiSettings((prev) => ({ ...prev, direct: { ...prev.direct, workflowMode: mode } as any }))
          }
          onComplete={handleCreationComplete}
          onDraftProject={upsertWorkspaceProject}
          onCancel={() => setScreen('library')}
        />
        {isAiSettingsOpen && (
          <AiSettingsModal settings={aiSettings} onSave={setAiSettings} onClose={() => setIsAiSettingsOpen(false)} />
        )}

        {isDebugOpen && (
          <DebugPanel
            aiSettings={aiSettings}
            activeStory={activeStory}
            agentHistory={agentHistory}
            onClose={() => setIsDebugOpen(false)}
          />
        )}
      </>
    );
  }

  if (!activeStory) {
    return <div className="flex h-screen items-center justify-center bg-zinc-950 text-white">Loading Vision Studio...</div>;
  }

  return (
    <div
      className={`flex h-screen w-full overflow-hidden bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100 font-sans transition-colors duration-300 ${
        isCinemaMode ? 'fullscreen-mode' : ''
      }`}
    >
      {/* Global Player Overlay */}
      {isPlayingMaster && (
        <MasterPlayer
          story={activeStory}
          shots={masterPlayerShots || undefined}
          onClose={() => {
            setIsPlayingMaster(false);
            setMasterPlayerShots(null);
          }}
        />
      )}

      {/* 1. Left Sidebar */}
      {!isCinemaMode && !isPlayingMaster && (
        <Sidebar
          story={activeStory}
          selection={selection}
          theme={theme}
          toggleTheme={toggleTheme}
          onBackToLibrary={() => {
            setScreen('library');
            setIsCinemaMode(false);
            setIsPlayingMaster(false);
            setMasterPlayerShots(null);
          }}
          onOpenAiSettings={() => setIsAiSettingsOpen(true)}
          onOpenDebug={() => setIsDebugOpen(true)}
          onOpenScript={() => setIsScriptEditorOpen(true)}
          onDeleteSequence={handleDeleteSequence}
          onDeleteLocation={handleDeleteLocation}
          onDeleteCharacter={handleDeleteCharacter}
          onSelect={handleSelect}
          onCreateLocation={handleCreateLocation}
          onCreateCharacter={handleCreateCharacter}
          onCreateSequence={handleCreateSequence}
        />
      )}

      {/* 2. Middle Stage (Main Content) */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="flex-1 overflow-hidden relative z-0">
          {selection.type === 'story' && (
            <ProjectDashboard
              story={activeStory}
              onSelect={handleSelect}
              imageSettings={aiSettings.image}
              directSettings={aiSettings.direct}
              onUpdateStory={updateActiveStory}
              onAcceptProposedStyleGuide={handleAcceptProposedStyleGuide}
              onUpdateAssets={handleUpdateAssetsFromKv}
              kvActionRequest={kvConsoleActionRequest}
              onKvActionHandled={(id) => {
                setKvConsoleActionRequest((prev) => (prev && prev.id === id ? null : prev));
              }}
              onToast={addToast}
              onPlayCinema={() => {
                setMasterPlayerShots(null);
                setIsPlayingMaster(true);
                addToast('Starting Master Screen...', 'success');
              }}
            />
          )}

          {selection.type === 'sequence' && activeItem && (
            <StageView
              sequence={activeItem as Sequence}
              allLocations={activeStory.locations}
              aspectRatio={activeStory.aspectRatio}
              isImmersive={isCinemaMode}
              onToggleImmersive={() => setIsCinemaMode(!isCinemaMode)}
              onSelectShot={(id) => setSelection({ type: 'shot', id, parentId: (activeItem as Sequence).id })}
              onAddShot={(opts) => handleAddShot((activeItem as Sequence).id, opts)}
              onDeleteShot={(id) => handleDeleteShot((activeItem as Sequence).id, id)}
              onMoveShot={(id, direction) => handleMoveShot((activeItem as Sequence).id, id, direction)}
              onMoveShotToScene={(shotId, toSceneId) => handleMoveShotToScene((activeItem as Sequence).id, shotId, toSceneId)}
              onRenameSequence={(title) => handleRenameSequence((activeItem as Sequence).id, title)}
              onRenameScene={(sceneId, title) => handleUpdateScene((activeItem as Sequence).id, sceneId, { title })}
              onPlayScene={(sceneId) => {
                const seq = activeItem as Sequence;
                const scenes = Array.isArray((seq as any)?.scenes) ? ((seq as any).scenes as any[]) : [];
                const scene = scenes.find((sc: any) => String(sc?.id || '') === String(sceneId || ''));
                const sceneShots = Array.isArray(scene?.shots) ? (scene.shots as Shot[]) : [];
                if (!sceneShots.length) {
                  addToast('No shots in this scene to play.', 'info');
                  return;
                }
                setMasterPlayerShots(sceneShots);
                setIsPlayingMaster(true);
              }}
              onUpdateShot={handleShotUpdate}
              onBackToSequence={() => setSelection({ type: 'story', id: activeStory.id })}
              onEditLocation={() => {}}
            />
          )}

          {selection.type === 'shot' && activeItem && (
            <ShotEditor
              shot={activeItem as Shot}
              story={activeStory}
              aspectRatio={activeStory.aspectRatio}
              isImmersive={isCinemaMode}
              onToggleImmersive={() => setIsCinemaMode(!isCinemaMode)}
              onUpdateShot={handleShotUpdate}
              imageSettings={aiSettings.image}
              onStartProduction={() => {
                const shotId = (activeItem as Shot).id;
                const inferredSeqId =
                  activeStory.sequences.find((seq) => (seq.shots || []).some((s) => s.id === shotId))?.id || '';
                const seqId = selection.parentId || inferredSeqId;
                if (!seqId) {
                  addToast('Cannot determine sequence for this shot.', 'info');
                  return;
                }
                setProductionTarget({ sequenceId: seqId, shotId: (activeItem as Shot).id });
              }}
              onBack={() =>
                setSelection({
                  type: 'sequence',
                  id:
                    selection.parentId ||
                    activeStory.sequences.find((seq) => (seq.shots || []).some((s) => s.id === (activeItem as Shot).id))?.id ||
                    activeStory.sequences[0]?.id ||
                    activeStory.id,
                })
              }
            />
          )}

          {selection.type === 'location' && activeItem && (
            <LocationEditor
              location={activeItem as Location}
              sequences={activeStory.sequences}
              onSave={handleUpdateLocation}
              onPropagate={() => addToast('Propagation coming soon', 'info')}
              onSelectShot={(shotId, seqId) => setSelection({ type: 'shot', id: shotId, parentId: seqId })}
              imageSettings={aiSettings.image}
              keyVisualUrl={activeStory.keyVisualUrl}
              styleGuide={activeStory.styleGuide}
              aspectRatio={activeStory.aspectRatio}
            />
          )}

          {selection.type === 'character' && activeItem && (
            <CharacterEditor
              character={activeItem as Character}
              sequences={activeStory.sequences}
              onSave={handleUpdateCharacter}
              onPropagate={() => addToast('Propagation coming soon', 'info')}
              onSelectShot={(shotId, seqId) => setSelection({ type: 'shot', id: shotId, parentId: seqId })}
              imageSettings={aiSettings.image}
              keyVisualUrl={activeStory.keyVisualUrl}
              styleGuide={activeStory.styleGuide}
            />
          )}
        </div>

        {/* Director Console Overlay */}
        {!isCinemaMode && !isPlayingMaster && (
          <div className="relative z-20">
            <DirectorConsole
              context={{
                type: consoleContextType,
                label: activeItem ? (activeItem as any).title || (activeItem as any).name || (activeItem as any).description : activeStory.title,
                id: selection.id,
              }}
              history={agentHistory}
              onSendMessage={handleDirectorMessage}
              isThinking={isDirectorThinking}
              stream={directorStream || undefined}
              compact={isCompactLayout}
              workflowMode={String((aiSettings.direct as any)?.workflowMode || 'auto') as any}
              onWorkflowModeChange={(mode) =>
                setAiSettings((prev) => ({ ...prev, direct: { ...prev.direct, workflowMode: mode } as any }))
              }
            />
          </div>
        )}

        {/* Floating Console for Cinema Mode */}
        {isCinemaMode && !isPlayingMaster && (
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50">
            <DirectorConsole
              variant="floating"
              context={{ type: 'shot', label: 'Cinema Mode', id: 'cinema' }}
              history={agentHistory}
              onSendMessage={handleDirectorMessage}
              isThinking={isDirectorThinking}
              stream={directorStream || undefined}
              workflowMode={String((aiSettings.direct as any)?.workflowMode || 'auto') as any}
              onWorkflowModeChange={(mode) =>
                setAiSettings((prev) => ({ ...prev, direct: { ...prev.direct, workflowMode: mode } as any }))
              }
            />
          </div>
        )}
      </div>

      {/* 3. Right Inspector (Contextual) - STRICTLY LIMITED TO SHOTS */}
      {!isCinemaMode && !isPlayingMaster && selection.type === 'shot' && !isCompactLayout && (
        <InspectorPanel
          selection={selection}
          selectedItem={activeItem}
          type={selection.type}
          contextLocation={getContextLocation()}
          availableLocations={activeStory.locations}
          availableCharacters={activeStory.characters}
          keyVisualUrl={activeStory.keyVisualUrl}
          masterStyle={[
            activeStory.styleGuide ? String(activeStory.styleGuide) : '',
            activeStory.intent ? `Intent: ${activeStory.intent}` : '',
            activeStory.logline ? `Logline: ${activeStory.logline}` : '',
          ]
            .filter(Boolean)
            .join('\n')}
          onNavigate={handleSelect}
          onCastingUpdate={handleCastingUpdate}
          onCharacterPromptChange={handleCharacterPromptChange}
          onScriptUpdate={handleScriptUpdate}
          onSequenceUpdate={handleSequenceUpdate}
          onShotUpdate={handleShotUpdate}
          sequences={activeStory.sequences}
          onMoveShotToScene={handleMoveShotToScene}
          onUpdateScene={handleUpdateScene}
        />
      )}

      {isAiSettingsOpen && (
        <AiSettingsModal
          settings={aiSettings}
          onSave={(next) => {
            setAiSettings(next);
            setIsAiSettingsOpen(false);
            addToast('AI settings saved', 'success');
          }}
          onClose={() => setIsAiSettingsOpen(false)}
        />
      )}

      {isScriptEditorOpen && (
        <ScriptEditorModal
          story={activeStory}
          onClose={() => setIsScriptEditorOpen(false)}
          onUpdateShot={handleShotUpdate}
        />
      )}

      {isDebugOpen && (
        <DebugPanel
          aiSettings={aiSettings}
          activeStory={activeStory}
          agentHistory={agentHistory}
          onClose={() => setIsDebugOpen(false)}
        />
      )}

      <ImageLightbox />

      {pendingDirectorMultiAgentFailure && pendingDirectorMultiAgentFailure.projectId === activeStory.id && !isPlayingMaster && (
        <div className="fixed inset-0 z-[4500] bg-black/60 backdrop-blur-sm p-6 flex items-center justify-center">
          <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-white dark:bg-[#050505] shadow-2xl overflow-hidden">
            <div className="h-14 px-5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/60">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <div className="text-sm font-bold">Multi-agent failed</div>
              </div>
              <button
                onClick={() => {
                  setPendingDirectorMultiAgentFailure(null);
                  setPendingDirectorSingleFallbackArmed(false);
                }}
                className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                title="Close"
              >
                <X className="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="text-sm text-zinc-700 dark:text-zinc-200">
                The Director multi-agent pipeline failed. Retry multi-agent, or explicitly opt into a single-call fallback.
              </div>

              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 p-4 text-sm text-zinc-700 dark:text-zinc-200">
                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Error</div>
                <div className="whitespace-pre-wrap break-words">{pendingDirectorMultiAgentFailure.error}</div>
              </div>

              {pendingDirectorMultiAgentFailure.details && (
                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
                  <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Trace</div>
                  </div>
                  <pre className="p-4 text-[11px] leading-relaxed font-mono whitespace-pre-wrap text-zinc-700 dark:text-zinc-200 max-h-56 overflow-y-auto custom-scrollbar">
                    {JSON.stringify(pendingDirectorMultiAgentFailure.details, null, 2)}
                  </pre>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => retryDirectorAfterFailure(false)}
                  className="px-4 py-2 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 text-[11px] font-black uppercase tracking-widest hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  Retry Multi-agent
                </button>
                <button
                  onClick={() => {
                    if (!pendingDirectorSingleFallbackArmed) {
                      setPendingDirectorSingleFallbackArmed(true);
                      return;
                    }
                    retryDirectorAfterFailure(true);
                  }}
                  className="px-4 py-2 rounded-xl bg-amber-500 text-black text-[11px] font-black uppercase tracking-widest hover:opacity-90"
                >
                  {pendingDirectorSingleFallbackArmed ? 'Confirm Single-call' : 'Use Single-call'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingDirectorFallback && pendingDirectorFallback.projectId === activeStory.id && !isPlayingMaster && (
        <div className="fixed inset-0 z-[4500] bg-black/60 backdrop-blur-sm p-6 flex items-center justify-center">
          <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-white dark:bg-[#050505] shadow-2xl overflow-hidden">
            <div className="h-14 px-5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/60">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <div className="text-sm font-bold">Fallback confirmation</div>
              </div>
              <button
                onClick={() => {
                  setPendingDirectorFallback(null);
                  setPendingDirectorFallbackArmed(false);
                }}
                className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                title="Close"
              >
                <X className="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="text-sm text-zinc-700 dark:text-zinc-200">
                Director returned a <span className="font-bold">fallback</span> (rule-based) result. This is not guaranteed to match your intent.
                Confirm explicitly before applying.
              </div>

              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 p-4 text-sm text-zinc-700 dark:text-zinc-200">
                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Reply</div>
                <div className="whitespace-pre-wrap">{pendingDirectorFallback.res.reply}</div>
              </div>

              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Actions ({pendingDirectorFallback.res.actions.length})
                  </div>
                </div>
                <pre className="p-4 text-[11px] leading-relaxed font-mono whitespace-pre-wrap text-zinc-700 dark:text-zinc-200 max-h-56 overflow-y-auto custom-scrollbar">
                  {JSON.stringify(pendingDirectorFallback.res.actions, null, 2)}
                </pre>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => {
                    setPendingDirectorFallback(null);
                    setPendingDirectorFallbackArmed(false);
                  }}
                  className="px-4 py-2 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 text-[11px] font-black uppercase tracking-widest hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  Discard
                </button>
                <button
                  onClick={() => {
                    if (!pendingDirectorFallbackArmed) {
                      setPendingDirectorFallbackArmed(true);
                      return;
                    }
                    const isInteractionMode = String((aiSettings.direct as any)?.workflowMode || 'auto') === 'interaction';
                    const exec = applyDirectorActions(
                      pendingDirectorFallback.projectId,
                      activeStory,
                      pendingDirectorFallback.res.actions,
                      { deferGeneration: isInteractionMode },
                    );
                    if (isInteractionMode && exec.deferredJobs?.length) {
                      setPendingInteractionGeneration({
                        id: `pending-gen-${Date.now()}`,
                        projectId: pendingDirectorFallback.projectId,
                        jobs: exec.deferredJobs,
                        scopeLabel: exec.scopeLabel || 'director:interaction',
                        concurrency: exec.concurrency || 2,
                        story: exec.storyAfterUpdates || activeStory,
                      });
                      addToast('Interaction mode: generation is waiting for your confirmation.', 'info');
                    }
                    setPendingDirectorFallback(null);
                    setPendingDirectorFallbackArmed(false);
                  }}
                  className="px-4 py-2 rounded-xl bg-amber-500 text-black text-[11px] font-black uppercase tracking-widest hover:opacity-90"
                >
                  {pendingDirectorFallbackArmed ? 'Confirm Apply' : 'Apply Fallback'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingInteractionGeneration && pendingInteractionGeneration.projectId === activeStory.id && !isPlayingMaster && (
        <div className="fixed inset-0 z-[4600] bg-black/65 backdrop-blur-sm p-6 flex items-center justify-center">
          <div className="w-full max-w-3xl rounded-3xl border border-white/10 bg-white dark:bg-[#050505] shadow-2xl overflow-hidden">
            <div className="h-14 px-5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/60">
              <div className="text-sm font-bold">Interaction Mode Confirmation</div>
              <button
                onClick={() => setPendingInteractionGeneration(null)}
                className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                title="Close"
              >
                <X className="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="text-sm text-zinc-700 dark:text-zinc-200">
                Director has prepared candidates. Before generation, confirm whether you want to generate now or revise/upload references first.
              </div>

              {interactionCandidateSummary?.hasKv && (
                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 p-4">
                  <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">KV Candidate</div>
                  <div className="text-sm text-zinc-700 dark:text-zinc-200">Master KV will be generated for current story intent/style.</div>
                  <div className="mt-1 text-xs text-zinc-500">Reference images: {interactionCandidateSummary.kvRefCount}</div>
                </div>
              )}

              {interactionCandidateSummary?.locations?.length ? (
                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 p-4">
                  <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Scene Candidates</div>
                  <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                    {interactionCandidateSummary.locations.slice(0, 6).map((loc) => (
                      <div key={loc.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-2">
                        <div className="text-sm font-semibold">{loc.name}</div>
                        <div className="text-xs text-zinc-500 line-clamp-2">{loc.desc || 'No description'}</div>
                        <div className="text-[11px] text-zinc-500 mt-1">References: {loc.refs}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {interactionCandidateSummary?.cast?.length ? (
                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 p-4">
                  <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Cast Candidates</div>
                  <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                    {interactionCandidateSummary.cast.slice(0, 6).map((ch) => (
                      <div key={ch.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-2">
                        <div className="text-sm font-semibold">{ch.name}</div>
                        <div className="text-xs text-zinc-500 line-clamp-2">{ch.desc || 'No description'}</div>
                        <div className="text-[11px] text-zinc-500 mt-1">References: {ch.refs}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  onClick={() => {
                    setPendingInteractionGeneration(null);
                    addToast('Generation cancelled. Tell Director what to revise.', 'info');
                  }}
                  className="px-4 py-2 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 text-[11px] font-black uppercase tracking-widest hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  Modify In Chat
                </button>
                <button
                  onClick={() => {
                    setPendingInteractionGeneration(null);
                    addToast('Upload references in Project / Location / Character editor, then ask Director to generate.', 'info');
                  }}
                  className="px-4 py-2 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 text-[11px] font-black uppercase tracking-widest hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  Upload Refs First
                </button>
                <button
                  onClick={confirmInteractionGeneration}
                  className="px-4 py-2 rounded-xl bg-amber-500 text-black text-[11px] font-black uppercase tracking-widest hover:opacity-90"
                >
                  Generate Now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {productionTarget && (
        <StartProductionModal
          target={(() => {
            const seq = activeStory.sequences.find((s) => s.id === productionTarget.sequenceId);
            const shot = seq?.shots.find((s) => s.id === productionTarget.shotId);
            if (!shot) return { label: 'Shot' };
            const loc = activeStory.locations.find((l) => l.id === shot.locationId);
            return { label: `Shot #${shot.sequence}${loc?.name ? ` · ${loc.name}` : ''}`, detail: shot.description };
          })()}
          onConfirm={() => {
            startShotProduction({ sequenceId: productionTarget.sequenceId, shotId: productionTarget.shotId });
            setProductionTarget(null);
          }}
          onClose={() => setProductionTarget(null)}
        />
      )}

      {/* Global Toast Notification */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="bg-zinc-900 text-white px-4 py-3 rounded-lg shadow-2xl border border-zinc-800 flex items-center gap-3 animate-in slide-in-from-right-10 fade-in duration-300"
          >
            {toast.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-500" />
            ) : (
              <Info className="w-4 h-4 text-blue-500" />
            )}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
