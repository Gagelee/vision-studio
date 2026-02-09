import { describe, expect, it } from 'vitest';
import { getShotPreviewImageUrl } from './assetRefs';

const UNSPLASH_PLACEHOLDER =
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1964&auto=format&fit=crop&sig=123';

describe('assetRefs.getShotPreviewImageUrl', () => {
  it('prefers the latest real keyframe when active is placeholder', () => {
    const shot: any = {
      thumbnailUrl: UNSPLASH_PLACEHOLDER,
      activeVersionId: 'v-placeholder',
      versions: [
        { id: 'v-placeholder', imageUrl: UNSPLASH_PLACEHOLDER, createdAt: 1, type: 'placeholder' },
        { id: 'v-real', imageUrl: '/__generated__/real.png', createdAt: 2, type: 'base' },
      ],
    };
    expect(getShotPreviewImageUrl(shot)).toBe('/__generated__/real.png');
  });

  it('uses active keyframe when it is real', () => {
    const shot: any = {
      thumbnailUrl: UNSPLASH_PLACEHOLDER,
      activeVersionId: 'v-real',
      versions: [
        { id: 'v-placeholder', imageUrl: UNSPLASH_PLACEHOLDER, createdAt: 1, type: 'placeholder' },
        { id: 'v-real', imageUrl: '/__generated__/real.png', createdAt: 2, type: 'base' },
      ],
    };
    expect(getShotPreviewImageUrl(shot)).toBe('/__generated__/real.png');
  });

  it('falls back to thumbnail when no real keyframe exists', () => {
    const shot: any = {
      thumbnailUrl: '/__generated__/thumb.png',
      activeVersionId: 'v-placeholder',
      versions: [{ id: 'v-placeholder', imageUrl: UNSPLASH_PLACEHOLDER, createdAt: 1, type: 'placeholder' }],
    };
    expect(getShotPreviewImageUrl(shot)).toBe('/__generated__/thumb.png');
  });
});

