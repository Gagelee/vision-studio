const USER_ID_STORAGE_KEY = 'vision-studio.user.id.v1';
const USER_ID_HEADER = 'x-vision-user-id';

const USER_ID_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/i;

const randomHex = (bytes = 8): string => {
  try {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr)
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return Math.random().toString(16).slice(2, 2 + bytes * 2).padEnd(bytes * 2, '0');
  }
};

export const normalizeVisionUserId = (raw: unknown): string => {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  const cleaned = s.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (!cleaned) return '';
  return USER_ID_RE.test(cleaned) ? cleaned : '';
};

const buildFallbackUserId = () => `local-${randomHex(8)}`;

export const getOrCreateVisionUserId = (): string => {
  if (typeof window === 'undefined' || !window.localStorage) return 'server';
  const existing = normalizeVisionUserId(window.localStorage.getItem(USER_ID_STORAGE_KEY));
  if (existing) return existing;
  const next = buildFallbackUserId();
  window.localStorage.setItem(USER_ID_STORAGE_KEY, next);
  return next;
};

export const getVisionUserRequestHeaders = (headers?: HeadersInit): HeadersInit => {
  const out = new Headers(headers || {});
  const existing = normalizeVisionUserId(out.get(USER_ID_HEADER));
  if (existing) return out;
  out.set(USER_ID_HEADER, getOrCreateVisionUserId());
  return out;
};

export const getVisionUserHeaderName = () => USER_ID_HEADER;
