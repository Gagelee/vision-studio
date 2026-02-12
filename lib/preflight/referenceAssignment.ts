import type { Story } from '../../types';

export type PreflightAttachmentBinding = {
  id: string;
  url: string;
  name?: string;
  createdAt?: number;
  assignedTo: string;
};

const toComparableToken = (value: string): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

const nameMatches = (assignedName: string, entityName: string): boolean => {
  const assignedToken = toComparableToken(assignedName);
  const entityToken = toComparableToken(entityName);
  if (!assignedToken || !entityToken) return false;
  return entityToken.includes(assignedToken) || assignedToken.includes(entityToken);
};

export const applyPreflightReferenceAssignments = (
  story: Story,
  attachments: PreflightAttachmentBinding[],
): Story => {
  const normalized = (attachments || []).map((a) => ({
    id: a.id,
    url: a.url,
    name: a.name,
    createdAt: a.createdAt,
    assignedTo: String(a.assignedTo || 'unassigned'),
  }));
  const globalRefs = normalized.filter((a) => a.assignedTo === 'global').map(({ assignedTo, ...x }) => x);
  const charRefs = normalized.filter((a) => a.assignedTo.startsWith('character:'));
  const locRefs = normalized.filter((a) => a.assignedTo.startsWith('location:'));

  return {
    ...story,
    referenceImages: globalRefs as any,
    referenceMode: globalRefs.length ? 'auto' : (story as any).referenceMode,
    characters: (story.characters || []).map((c) => {
      const next = charRefs
        .filter((r) => {
          const assignedName = String(r.assignedTo.split(':').slice(1).join(':') || '').trim();
          return nameMatches(assignedName, String(c.name || ''));
        })
        .map(({ assignedTo, ...x }) => x);
      if (!next.length) return c;
      return {
        ...c,
        referenceImages: ([...(Array.isArray((c as any).referenceImages) ? (c as any).referenceImages : []), ...next].slice(-4) as any),
        referenceMode: 'auto',
      } as any;
    }),
    locations: (story.locations || []).map((l) => {
      const next = locRefs
        .filter((r) => {
          const assignedName = String(r.assignedTo.split(':').slice(1).join(':') || '').trim();
          return nameMatches(assignedName, String(l.name || ''));
        })
        .map(({ assignedTo, ...x }) => x);
      if (!next.length) return l;
      return {
        ...l,
        referenceImages: ([...(Array.isArray((l as any).referenceImages) ? (l as any).referenceImages : []), ...next].slice(-4) as any),
        referenceMode: 'auto',
      } as any;
    }),
  } as Story;
};

