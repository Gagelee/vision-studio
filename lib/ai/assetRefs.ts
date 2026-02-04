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
    // Never treat placeholders as "active" for downstream reference selection.
    if (String(hit?.type || '') !== 'placeholder') {
      const url = String(hit?.imageUrl || '').trim();
      if (url) return url;
    }
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

export const isLikelyPlaceholderImageUrl = (url: string) => {
  const s = String(url || '').trim();
  if (!s) return true;
  if (s.startsWith('/__generated__/')) return false;
  if (s.startsWith('data:image/')) return false;
  try {
    const parsed = new URL(s);
    // Current mock/placeholder strategy uses Unsplash URLs.
    if (/images\.unsplash\.com$/i.test(parsed.hostname)) return true;
  } catch {
    // Non-URL strings are treated as placeholders to avoid passing unusable refs (e.g., blob: URLs).
    return true;
  }
  return false;
};
