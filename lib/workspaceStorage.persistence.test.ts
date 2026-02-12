import { describe, expect, it, beforeEach } from 'vitest';
import type { WorkspaceState } from '../types';
import { loadWorkspace, saveWorkspace, getEmptyWorkspace } from './workspaceStorage';

const USER_ID_KEY = 'vision-studio.user.id.v1';

class MemoryStorage {
  private data = new Map<string, string>();
  throwOnSet = false;

  getItem(key: string) {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  setItem(key: string, value: string) {
    if (this.throwOnSet) throw new Error('QuotaExceededError');
    this.data.set(String(key), String(value));
  }

  removeItem(key: string) {
    this.data.delete(key);
  }

  clear() {
    this.data.clear();
  }
}

const buildWorkspaceFixture = (): WorkspaceState => ({
  version: 1,
  activeProjectId: 'story-1',
  projects: [
    {
      id: 'story-1',
      title: 'fixture',
      logline: 'fixture',
      aspectRatio: '16:9',
      status: 'ready',
      styleGuide: 'Live-action cinematic film. Visuals: Traditional Chinese wedding red, gold embroidery.',
      keyVisualUrl: '/__generated__/kv.png',
      keyVisualVersions: [
        { id: 'kv-v1', imageUrl: '/__generated__/kv.png', createdAt: 1, type: 'base', metadata: { prompt: 'kv' } },
      ],
      activeKeyVisualVersionId: 'kv-v1',
      locations: [
        {
          id: 'loc-1',
          name: 'Lotus',
          description: 'bridge',
          visualStyle: 'mist',
          previewUrl: '/__generated__/loc.png',
          previewVersions: [
            { id: 'loc-v1', imageUrl: '/__generated__/loc.png', createdAt: 2, type: 'base', metadata: { prompt: 'loc' } },
          ],
          activePreviewVersionId: 'loc-v1',
          status: 'draft',
          referenceImages: [{ id: 'loc-ref-1', url: '/__generated__/loc-ref.png', name: 'loc ref' }],
          referenceMode: 'auto',
        },
      ],
      characters: [
        {
          id: 'char-1',
          name: "Tian'yu",
          description: 'guardian',
          avatarUrl: '/__generated__/avatar.png',
          avatarVersions: [
            { id: 'avatar-v1', imageUrl: '/__generated__/avatar.png', createdAt: 3, type: 'base', metadata: { prompt: 'avatar' } },
          ],
          activeAvatarVersionId: 'avatar-v1',
          looks: [
            {
              id: 'look-1',
              name: 'The Radiant Groom',
              description: 'wedding look',
              previewUrl: '/__generated__/look.png',
              previewVersions: [
                {
                  id: 'look-v1',
                  imageUrl: '/__generated__/look.png',
                  createdAt: 4,
                  type: 'base',
                  metadata: { prompt: 'look', sourceAvatarVersionId: 'avatar-v1' },
                },
              ],
              activePreviewVersionId: 'look-v1',
            },
          ],
          referenceImages: [
            { id: 'char-ref-1', url: 'data:image/jpeg;base64,AAA', name: 'ref1' },
            { id: 'char-ref-2', url: 'data:image/jpeg;base64,BBB', name: 'ref2' },
          ],
          referenceMode: 'auto',
        },
      ],
      sequences: [
        {
          id: 'seq-1',
          title: 'Part 1',
          context: '',
          scenes: [
            {
              id: 'seq-1-scene-1',
              title: 'Scene 1',
              shots: [
                {
                  id: 'shot-1',
                  sequence: 1,
                  locationId: 'loc-1',
                  timeOfDay: 'Day',
                  description: 'shot',
                  duration: 6,
                  thumbnailUrl: '/__generated__/shot-thumb.png',
                  activeVersionId: 'shot-v1',
                  versions: [
                    {
                      id: 'shot-v1',
                      imageUrl: '/__generated__/shot-v1.png',
                      createdAt: 5,
                      type: 'panel_group',
                      metadata: {
                        prompt: 'shot',
                        references: [{ url: '/__generated__/avatar.png', label: 'character' }],
                        panelGroup: {
                          kind: 'stack',
                          activeIndex: 0,
                          panels: [{ index: 0, imageUrl: '/__generated__/panel-1.png' }],
                        },
                      },
                    },
                  ],
                  elements: {
                    SCRIPT: { type: 'SCRIPT', prompt: '', status: 'auto' },
                    CASTING: { type: 'CASTING', prompt: '', status: 'auto', metadata: { characters: [{ id: 'char-1', activeLookId: 'look-1' }] } },
                    CAMERA: { type: 'CAMERA', prompt: '', status: 'auto' },
                    LIGHTING: { type: 'LIGHTING', prompt: '', status: 'auto' },
                    AUDIO: { type: 'AUDIO', prompt: '', status: 'auto' },
                  },
                  production: {
                    status: 'done',
                    videoUrl: '/__generated__/shot-v1.mp4',
                    variants: [
                      {
                        id: 'vid-v1',
                        videoUrl: '/__generated__/shot-v1.mp4',
                        createdAt: 6,
                        metadata: { sourceShotVersionId: 'shot-v1', referenceImageUrls: ['/__generated__/avatar.png'] },
                      },
                    ],
                    activeVariantId: 'vid-v1',
                  },
                },
              ],
            },
          ],
          shots: [],
        },
      ],
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: 1,
    } as any,
  ],
});

describe('workspace persistence audit', () => {
  const storage = new MemoryStorage();

  beforeEach(() => {
    storage.clear();
    storage.throwOnSet = false;
    (globalThis as any).localStorage = storage;
    (globalThis as any).window = { localStorage: storage };
    storage.setItem(USER_ID_KEY, 'local-test-user');
  });

  it('round-trips all key asset variants across refresh load', () => {
    const workspace = buildWorkspaceFixture();
    saveWorkspace(workspace);
    const loaded = loadWorkspace('local-test-user');

    const story = loaded.projects[0] as any;
    expect(story?.keyVisualVersions?.length).toBe(1);
    expect(story?.locations?.[0]?.previewVersions?.length).toBe(1);
    expect(story?.characters?.[0]?.avatarVersions?.length).toBe(1);
    expect(story?.characters?.[0]?.looks?.[0]?.previewVersions?.length).toBe(1);
    expect(story?.sequences?.[0]?.shots?.[0]?.versions?.length).toBe(1);
    expect(story?.sequences?.[0]?.shots?.[0]?.production?.variants?.length).toBe(1);
  });

  it('can reproduce refresh-loss when save throws quota error', () => {
    const oldWorkspace = buildWorkspaceFixture();
    saveWorkspace(oldWorkspace);

    const nextWorkspace = buildWorkspaceFixture();
    const nextStory = nextWorkspace.projects[0] as any;
    nextStory.characters[0].avatarVersions.push({
      id: 'avatar-v2',
      imageUrl: '/__generated__/avatar-v2.png',
      createdAt: 7,
      type: 'variation',
    });
    nextStory.characters[0].activeAvatarVersionId = 'avatar-v2';

    storage.throwOnSet = true;
    expect(() => saveWorkspace(nextWorkspace)).not.toThrow();
    storage.throwOnSet = false;

    const loadedAfterRefresh = loadWorkspace('local-test-user') as any;
    const loadedStory = loadedAfterRefresh.projects[0] as any;
    const avatarIds = (loadedStory.characters[0].avatarVersions || []).map((v: any) => String(v.id));
    expect(avatarIds).toContain('avatar-v1');
    expect(avatarIds).not.toContain('avatar-v2');
  });

  it('loads empty workspace for different user key (user-id drift)', () => {
    saveWorkspace(buildWorkspaceFixture());
    const other = loadWorkspace('local-other-user');
    expect(other).toEqual(getEmptyWorkspace());
  });
});

