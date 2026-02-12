import { INITIAL_STORY } from '../constants';
import { Story, WorkspaceState } from '../types';
import { normalizeStorySceneModel } from './story/sceneModel';
import { getOrCreateVisionUserId, normalizeVisionUserId } from './userSession';

const WORKSPACE_STORAGE_KEY_LEGACY = 'vision-studio.workspace.v1';
const WORKSPACE_STORAGE_KEY_PREFIX = 'vision-studio.workspace.v2';
const WORKSPACE_STORAGE_WARN_BYTES = 3.5 * 1024 * 1024;
const WORKSPACE_STORAGE_DANGER_BYTES = 4.5 * 1024 * 1024;

const cloneStory = (story: Story): Story => JSON.parse(JSON.stringify(story)) as Story;

export type WorkspaceSaveWarningLevel = 'warn' | 'danger';

export interface WorkspaceSaveResult {
  ok: boolean;
  key: string;
  sizeBytes: number;
  level?: WorkspaceSaveWarningLevel;
  warning?: string;
  error?: string;
}

export const getEmptyWorkspace = (): WorkspaceState => ({
  version: 1,
  projects: [],
  activeProjectId: undefined,
});

const getWorkspaceStorageKey = (userId?: string) => {
  const normalized = normalizeVisionUserId(userId || getOrCreateVisionUserId()) || 'anon';
  return `${WORKSPACE_STORAGE_KEY_PREFIX}:${normalized}`;
};

export const loadWorkspace = (userId?: string): WorkspaceState => {
  try {
    const key = getWorkspaceStorageKey(userId);
    const raw = localStorage.getItem(key) || localStorage.getItem(WORKSPACE_STORAGE_KEY_LEGACY);
    if (!raw) return getEmptyWorkspace();
    const parsed = JSON.parse(raw) as WorkspaceState;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.projects)) return getEmptyWorkspace();
    return {
      ...parsed,
      projects: parsed.projects.map((p) => normalizeStorySceneModel(p)),
    };
  } catch {
    return getEmptyWorkspace();
  }
};

const estimatePayloadBytes = (payload: string) => {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(payload).byteLength;
  return payload.length * 2;
};

const describeSizeWarning = (bytes: number): { level?: WorkspaceSaveWarningLevel; warning?: string } => {
  if (bytes >= WORKSPACE_STORAGE_DANGER_BYTES) {
    return {
      level: 'danger',
      warning: `Workspace snapshot is very large (${(bytes / 1024 / 1024).toFixed(2)} MB). localStorage quota risk is high.`,
    };
  }
  if (bytes >= WORKSPACE_STORAGE_WARN_BYTES) {
    return {
      level: 'warn',
      warning: `Workspace snapshot is large (${(bytes / 1024 / 1024).toFixed(2)} MB). localStorage quota may be reached soon.`,
    };
  }
  return {};
};

const normalizeStorageError = (err: unknown) => {
  const message = (err as any)?.message;
  return String(message || err || 'unknown localStorage error');
};

export const saveWorkspace = (workspace: WorkspaceState): WorkspaceSaveResult => {
  const key = getWorkspaceStorageKey();
  const serialized = JSON.stringify(workspace);
  const sizeBytes = estimatePayloadBytes(serialized);
  const warningMeta = describeSizeWarning(sizeBytes);
  try {
    localStorage.setItem(key, serialized);
    return { ok: true, key, sizeBytes, ...warningMeta };
  } catch (err) {
    // Never let persistence errors crash the app UI (e.g. QuotaExceededError).
    console.warn('[workspaceStorage] save failed; workspace kept in-memory only', err);
    return {
      ok: false,
      key,
      sizeBytes,
      ...warningMeta,
      error: normalizeStorageError(err),
    };
  }
};

export const createDemoProject = (userId?: string): Story => {
  const now = Date.now();
  const demo = cloneStory(INITIAL_STORY);
  return normalizeStorySceneModel({
    ...demo,
    id: `demo-${normalizeVisionUserId(userId || getOrCreateVisionUserId()) || 'anon'}-${now}`,
    ownerUserId: normalizeVisionUserId(userId || getOrCreateVisionUserId()) || 'anon',
    source: { type: 'local' },
    title: `${demo.title} (Demo)`,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  });
};
