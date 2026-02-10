import type { Scene, Sequence, Shot, Story } from '../../types';

const toSceneId = (seqId: string, idx: number) => `${seqId}-scene-${idx + 1}`;

const normalizeSceneShots = (shots: Shot[]): Shot[] =>
  (Array.isArray(shots) ? shots : []).map((shot, idx) => ({
    ...shot,
    sequence: idx + 1,
  }));

const inferSceneTitle = (rawTitle: string, idx: number, shots: Shot[]) => {
  const title = String(rawTitle || '').trim();
  const generic = !title || /^scene\s*\d+$/i.test(title);
  if (!generic) return title;
  const first = Array.isArray(shots) ? shots[0] : null;
  const desc = String(first?.description || '').trim().replace(/\s+/g, ' ');
  if (!desc) return `Scene ${idx + 1}`;
  const brief = desc.split(' ').slice(0, 6).join(' ').trim();
  return brief ? `${brief}${desc.length > brief.length ? '...' : ''}` : `Scene ${idx + 1}`;
};

const normalizeSequence = (seq: Sequence): Sequence => {
  const rawScenes = Array.isArray((seq as any).scenes) ? ((seq as any).scenes as Scene[]) : [];
  const rawShots = Array.isArray((seq as any).shots) ? ((seq as any).shots as Shot[]) : [];
  const scenes: Scene[] = rawScenes.length
    ? rawScenes.map((sc, idx) => ({
        id: String(sc?.id || toSceneId(seq.id, idx)),
        title: inferSceneTitle(String(sc?.title || ''), idx, normalizeSceneShots(Array.isArray(sc?.shots) ? sc.shots : [])),
        summary: sc?.summary ? String(sc.summary) : undefined,
        shots: normalizeSceneShots(Array.isArray(sc?.shots) ? sc.shots : []),
      }))
    : [
        {
          id: toSceneId(seq.id, 0),
          title: 'Scene 1',
          shots: normalizeSceneShots(rawShots),
        },
      ];
  // Prefer latest shot fields from flattened shots cache when IDs overlap.
  const rawFlat = normalizeSceneShots(rawShots);
  const byRawId = new Map(rawFlat.map((s) => [String(s.id), s]));
  const assigned = new Set<string>();
  const mergedScenes = scenes.map((sc) => ({
    ...sc,
    shots: (sc.shots || []).map((s) => {
      const id = String(s?.id || '');
      const hit = id ? byRawId.get(id) : null;
      if (id) assigned.add(id);
      return hit || s;
    }),
  }));
  const remaining = rawFlat.filter((s) => !assigned.has(String(s.id)));
  if (remaining.length) {
    const last = mergedScenes[mergedScenes.length - 1];
    if (last) last.shots = [...(last.shots || []), ...remaining];
  }
  const flatShots = normalizeSceneShots(mergedScenes.flatMap((sc) => sc.shots || []));
  const byFlatId = new Map(flatShots.map((s) => [String(s.id), s]));
  const syncedScenes = mergedScenes.map((sc) => ({
    ...sc,
    shots: (sc.shots || []).map((s) => byFlatId.get(String(s?.id || '')) || s).filter(Boolean),
  }));
  return {
    ...seq,
    scenes: syncedScenes,
    shots: flatShots,
  };
};

export const normalizeStorySceneModel = (story: Story): Story => ({
  ...story,
  sequences: (story.sequences || []).map((seq) => normalizeSequence(seq as Sequence)),
});
