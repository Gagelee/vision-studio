import type { Character, CharacterLook, Location, Story } from '../../types';

export const pickActiveImageUrl = (args: {
  entity: any;
  versionsKey: string;
  activeIdKey: string;
  fallbackUrl?: string;
}): string => {
  const versions = Array.isArray(args.entity?.[args.versionsKey]) ? args.entity[args.versionsKey] : [];
  const activeId = String(args.entity?.[args.activeIdKey] || '').trim();
  if (activeId) {
    const hit = versions.find((v: any) => String(v?.id || '') === activeId);
    const url = String(hit?.imageUrl || '').trim();
    if (url) return url;
  }
  // Prefer most-recent non-placeholder if present.
  for (let i = versions.length - 1; i >= 0; i--) {
    const v = versions[i];
    if (String(v?.type || '') === 'placeholder') continue;
    const url = String(v?.imageUrl || '').trim();
    if (url) return url;
  }
  const last = versions[versions.length - 1];
  const lastUrl = String(last?.imageUrl || '').trim();
  if (lastUrl) return lastUrl;
  const fallback = String(args.fallbackUrl || '').trim();
  if (fallback) return fallback;
  return '';
};

export const getStoryActiveKvUrl = (story: Story | null | undefined) => {
  if (!story) return '';
  return pickActiveImageUrl({
    entity: story,
    versionsKey: 'keyVisualVersions',
    activeIdKey: 'activeKeyVisualVersionId',
    fallbackUrl: story.keyVisualUrl,
  });
};

export const getLocationActivePreviewUrl = (loc: Location | null | undefined) => {
  if (!loc) return '';
  return pickActiveImageUrl({
    entity: loc,
    versionsKey: 'previewVersions',
    activeIdKey: 'activePreviewVersionId',
    fallbackUrl: loc.previewUrl,
  });
};

export const getCharacterActiveAvatarUrl = (ch: Character | null | undefined) => {
  if (!ch) return '';
  return pickActiveImageUrl({
    entity: ch,
    versionsKey: 'avatarVersions',
    activeIdKey: 'activeAvatarVersionId',
    fallbackUrl: ch.avatarUrl,
  });
};

export const getLookActivePreviewUrl = (lk: CharacterLook | null | undefined) => {
  if (!lk) return '';
  return pickActiveImageUrl({
    entity: lk,
    versionsKey: 'previewVersions',
    activeIdKey: 'activePreviewVersionId',
    fallbackUrl: lk.previewUrl,
  });
};

