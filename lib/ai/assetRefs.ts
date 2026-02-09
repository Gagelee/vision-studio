import type { Character, CharacterLook, Location, Shot, ShotProductionVariant, ShotVersion, Story } from '../../types';

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

// UI helper: preview should reflect the active keyframe ASAP.
// Downstream "reference selection" should still use the stricter `pickActiveImageUrl` rules above.
export const getShotPreviewImageUrl = (shot: Shot | null | undefined): string => {
  if (!shot) return '';
  const versions = Array.isArray((shot as any).versions) ? ((shot as any).versions as ShotVersion[]) : [];
  const thumbUrl = String((shot as any)?.thumbnailUrl || '').trim();
  const active = getShotActiveVersion(shot);

  const isUsable = (v: any) => {
    const type = String(v?.type || '').trim();
    if (type === 'placeholder') return false;
    const url = String(v?.imageUrl || '').trim();
    if (!url) return false;
    return !isLikelyPlaceholderImageUrl(url);
  };

  // Prefer an active, non-placeholder keyframe.
  if (active && isUsable(active)) return String(active.imageUrl).trim();

  // If the active version is still a placeholder (e.g. job queued/running),
  // keep showing the most recent real keyframe to avoid preview "reverting".
  for (let i = versions.length - 1; i >= 0; i--) {
    const v = versions[i];
    if (isUsable(v)) return String(v.imageUrl).trim();
  }

  // Fall back to thumbnail if it's non-placeholder.
  if (thumbUrl && !isLikelyPlaceholderImageUrl(thumbUrl)) return thumbUrl;

  // Final fallback: show whatever we have, even if placeholder.
  const activeUrl = String(active?.imageUrl || '').trim();
  return activeUrl || thumbUrl;
};

const getShotLegacyFallbackVariants = (shot: Shot): ShotProductionVariant[] => {
  const production = (shot as any)?.production;
  const productionVariants = Array.isArray(production?.variants) ? (production.variants as ShotProductionVariant[]) : [];
  if (productionVariants.length) return productionVariants;
  const videoUrl = String(production?.videoUrl || '').trim();
  if (!videoUrl) return [];
  return [
    {
      id: 'pv-legacy',
      videoUrl,
      createdAt: Number(production?.lastCompletedAt || Date.now()),
      durationSeconds: production?.durationSeconds,
      resolution: production?.resolution,
      operationName: production?.operationName,
    },
  ];
};

export const getShotActiveVersion = (shot: Shot | null | undefined): ShotVersion | null => {
  if (!shot) return null;
  const versions = Array.isArray((shot as any).versions) ? ((shot as any).versions as ShotVersion[]) : [];
  if (!versions.length) return null;
  return versions.find((v) => String(v?.id || '') === String((shot as any).activeVersionId || '')) || versions[versions.length - 1] || null;
};

const isVariantBoundToVersion = (variant: ShotProductionVariant, version: ShotVersion | null) => {
  if (!variant || !version) return false;
  const sourceVersionId = String((variant as any)?.metadata?.sourceShotVersionId || '').trim();
  if (sourceVersionId) return sourceVersionId === String(version.id || '').trim();
  const sourceImageUrl = String((variant as any)?.metadata?.sourceImageUrl || '').trim();
  const versionImageUrl = String(version.imageUrl || '').trim();
  if (sourceImageUrl && versionImageUrl) return sourceImageUrl === versionImageUrl;
  return false;
};

export const getShotVideoVariantsForVersion = (
  shot: Shot | null | undefined,
  version: ShotVersion | null,
  opts?: { allowLegacyUnboundFallback?: boolean },
): ShotProductionVariant[] => {
  if (!shot || !version) return [];
  const all = getShotLegacyFallbackVariants(shot);
  if (!all.length) return [];
  const matched = all.filter((v) => isVariantBoundToVersion(v, version));
  if (matched.length) return matched;
  const allowLegacyUnboundFallback = Boolean(opts?.allowLegacyUnboundFallback);
  if (!allowLegacyUnboundFallback) return [];
  const hasAnyExplicitBinding = all.some((v) => {
    const sourceVersionId = String((v as any)?.metadata?.sourceShotVersionId || '').trim();
    const sourceImageUrl = String((v as any)?.metadata?.sourceImageUrl || '').trim();
    return Boolean(sourceVersionId || sourceImageUrl);
  });
  if (hasAnyExplicitBinding) return [];
  return all;
};

export const resolveShotActiveVideo = (
  shot: Shot | null | undefined,
  opts?: { allowLegacyUnboundFallback?: boolean },
): {
  activeVersion: ShotVersion | null;
  variants: ShotProductionVariant[];
  activeVariant: ShotProductionVariant | null;
  videoUrl: string;
} => {
  const activeVersion = getShotActiveVersion(shot);
  const variants = getShotVideoVariantsForVersion(shot, activeVersion, opts);
  const activeVariantId = String((shot as any)?.production?.activeVariantId || '').trim();
  const activeVariant = variants.find((v) => String(v?.id || '') === activeVariantId) || variants[variants.length - 1] || null;
  return {
    activeVersion,
    variants,
    activeVariant,
    videoUrl: String(activeVariant?.videoUrl || '').trim(),
  };
};
