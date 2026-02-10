import { INITIAL_STORY } from '../constants';
import { Story, WorkspaceState } from '../types';
import { normalizeStorySceneModel } from './story/sceneModel';
import { getOrCreateVisionUserId, normalizeVisionUserId } from './userSession';

const WORKSPACE_STORAGE_KEY_LEGACY = 'vision-studio.workspace.v1';
const WORKSPACE_STORAGE_KEY_PREFIX = 'vision-studio.workspace.v2';

const cloneStory = (story: Story): Story => JSON.parse(JSON.stringify(story)) as Story;

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

export const saveWorkspace = (workspace: WorkspaceState) => {
  localStorage.setItem(getWorkspaceStorageKey(), JSON.stringify(workspace));
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
