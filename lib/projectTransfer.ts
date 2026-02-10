import type { Story } from '../types';
import { normalizeStorySceneModel } from './story/sceneModel';
import { normalizeVisionUserId } from './userSession';

export interface ProjectExportEnvelope {
  version: 1;
  kind: 'vision-project';
  exportedAt: number;
  exportedByUserId: string;
  project: Story;
}

export interface ProjectTransferLogEntry {
  id: string;
  kind: 'import' | 'export';
  at: number;
  projectId: string;
  projectTitle: string;
  fileName?: string;
  exportedByUserId?: string;
  importedByUserId?: string;
}

const TRANSFER_LOG_KEY_PREFIX = 'vision-studio.transfer-log.v1';

const cloneStory = (story: Story): Story => JSON.parse(JSON.stringify(story)) as Story;

const transferLogKey = (userId: string) => `${TRANSFER_LOG_KEY_PREFIX}:${normalizeVisionUserId(userId) || 'anon'}`;

export const appendProjectTransferLog = (userId: string, entry: ProjectTransferLogEntry) => {
  try {
    const key = transferLogKey(userId);
    const raw = localStorage.getItem(key);
    const prev = raw ? (JSON.parse(raw) as ProjectTransferLogEntry[]) : [];
    const next = [entry, ...(Array.isArray(prev) ? prev : [])].slice(0, 200);
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // ignore log persistence errors
  }
};

export const buildProjectExportEnvelope = (project: Story, userId: string): ProjectExportEnvelope => ({
  version: 1,
  kind: 'vision-project',
  exportedAt: Date.now(),
  exportedByUserId: normalizeVisionUserId(userId) || 'anon',
  project: cloneStory(project),
});

const normalizeImportedStory = (story: Story, currentUserId: string, opts?: { sourceFileName?: string; exportedByUserId?: string }) => {
  const now = Date.now();
  const safeCurrentUser = normalizeVisionUserId(currentUserId) || 'anon';
  const imported = normalizeStorySceneModel(cloneStory(story));
  const next: Story = {
    ...imported,
    id: imported.id || `proj-${now}-${Math.random().toString(16).slice(2, 8)}`,
    ownerUserId: safeCurrentUser,
    source: {
      type: 'imported',
      importedAt: now,
      importedByUserId: safeCurrentUser,
      exportedByUserId: normalizeVisionUserId(opts?.exportedByUserId || (imported as any)?.ownerUserId || '') || undefined,
      sourceFileName: opts?.sourceFileName || undefined,
    },
    updatedAt: now,
    lastOpenedAt: now,
  } as Story;
  return next;
};

export const parseProjectImportText = (text: string, args: { currentUserId: string; sourceFileName?: string }): Story[] => {
  const raw = JSON.parse(String(text || 'null')) as any;
  const out: Story[] = [];

  const pushStory = (value: any, meta?: { exportedByUserId?: string }) => {
    if (!value || typeof value !== 'object') return;
    if (!value.id || !Array.isArray(value.sequences) || !Array.isArray(value.locations) || !Array.isArray(value.characters)) return;
    out.push(normalizeImportedStory(value as Story, args.currentUserId, { sourceFileName: args.sourceFileName, exportedByUserId: meta?.exportedByUserId }));
  };

  if (raw && raw.kind === 'vision-project' && raw.version === 1 && raw.project) {
    pushStory(raw.project, { exportedByUserId: raw.exportedByUserId });
    return out;
  }

  if (raw && raw.kind === 'vision-workspace' && Array.isArray(raw.projects)) {
    for (const p of raw.projects) pushStory(p, { exportedByUserId: raw.exportedByUserId });
    return out;
  }

  if (raw && Array.isArray(raw.projects)) {
    for (const p of raw.projects) pushStory(p);
    return out;
  }

  pushStory(raw);
  return out;
};
