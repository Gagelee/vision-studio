import type { Character, CharacterLook, Location, Story } from '../../types';

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

export const pickActiveImageUrl = (args: {
  entity: any;
  versionsKey: string;
  activeIdKey: string;
  fallbackUrl?: string;
  activeOnly?: boolean;
}): string => {
  const versions = Array.isArray(args.entity?.[args.versionsKey]) ? args.entity[args.versionsKey] : [];
  const activeId = String(args.entity?.[args.activeIdKey] || '').trim();
  if (activeId) {
    const hit = versions.find((v: any) => String(v?.id || '') === activeId);
    // Never treat placeholders as "active" for downstream reference selection.
    if (String(hit?.type || '') !== 'placeholder') {
      const url = String(hit?.imageUrl || '').trim();
      if (url && !isLikelyPlaceholderImageUrl(url)) return url;
    }
  }
  if (args.activeOnly) return '';
  // Prefer most-recent non-placeholder if present.
  for (let i = versions.length - 1; i >= 0; i--) {
    const v = versions[i];
    if (String(v?.type || '') === 'placeholder') continue;
    const url = String(v?.imageUrl || '').trim();
    if (url && !isLikelyPlaceholderImageUrl(url)) return url;
  }
  const last = versions[versions.length - 1];
  const lastUrl = String(last?.imageUrl || '').trim();
  if (lastUrl && !isLikelyPlaceholderImageUrl(lastUrl) && String(last?.type || '') !== 'placeholder') return lastUrl;
  const fallback = String(args.fallbackUrl || '').trim();
  if (fallback && !isLikelyPlaceholderImageUrl(fallback)) return fallback;
  return '';
};

export const getStoryActiveKvUrl = (story: Story | null | undefined, opts?: { activeOnly?: boolean }) => {
  if (!story) return '';
  return pickActiveImageUrl({
    entity: story,
    versionsKey: 'keyVisualVersions',
    activeIdKey: 'activeKeyVisualVersionId',
    fallbackUrl: story.keyVisualUrl,
    activeOnly: opts?.activeOnly,
  });
};

export const getLocationActivePreviewUrl = (loc: Location | null | undefined, opts?: { activeOnly?: boolean }) => {
  if (!loc) return '';
  return pickActiveImageUrl({
    entity: loc,
    versionsKey: 'previewVersions',
    activeIdKey: 'activePreviewVersionId',
    fallbackUrl: loc.previewUrl,
    activeOnly: opts?.activeOnly,
  });
};

export const getCharacterActiveAvatarUrl = (ch: Character | null | undefined, opts?: { activeOnly?: boolean }) => {
  if (!ch) return '';
  return pickActiveImageUrl({
    entity: ch,
    versionsKey: 'avatarVersions',
    activeIdKey: 'activeAvatarVersionId',
    fallbackUrl: ch.avatarUrl,
    activeOnly: opts?.activeOnly,
  });
};

export const getLookActivePreviewUrl = (lk: CharacterLook | null | undefined, opts?: { activeOnly?: boolean }) => {
  if (!lk) return '';
  return pickActiveImageUrl({
    entity: lk,
    versionsKey: 'previewVersions',
    activeIdKey: 'activePreviewVersionId',
    fallbackUrl: lk.previewUrl,
    activeOnly: opts?.activeOnly,
  });
};
