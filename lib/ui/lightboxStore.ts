export interface LightboxImage {
  url: string;
  title?: string;
}

let current: LightboxImage | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const fn of listeners) fn();
};

export const getLightboxImage = () => current;

export const subscribeLightbox = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const openLightbox = (img: LightboxImage) => {
  current = img;
  notify();
};

export const closeLightbox = () => {
  current = null;
  notify();
};

