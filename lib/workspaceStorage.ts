import { INITIAL_STORY } from '../constants';
import { Story, WorkspaceState } from '../types';
import { normalizeStorySceneModel } from './story/sceneModel';

const WORKSPACE_STORAGE_KEY = 'vision-studio.workspace.v1';

const cloneStory = (story: Story): Story => JSON.parse(JSON.stringify(story)) as Story;

export const getEmptyWorkspace = (): WorkspaceState => ({
  version: 1,
  projects: [],
  activeProjectId: undefined,
});

export const loadWorkspace = (): WorkspaceState => {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
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
  localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
};

export const createDemoProject = (): Story => {
  const now = Date.now();
  const demo = cloneStory(INITIAL_STORY);
  return normalizeStorySceneModel({
    ...demo,
    id: `demo-${now}`,
    title: `${demo.title} (Demo)`,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  });
};
