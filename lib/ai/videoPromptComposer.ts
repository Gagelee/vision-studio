import type { Shot } from '../../types';

export type VideoSourceKind = 'single' | 'stack';

export interface VideoSourceFrame {
  panelIndex?: number;
  url: string;
  description?: string;
}

export interface VideoSourceBundle {
  sourceImageUrl: string;
  referenceFrames: VideoSourceFrame[];
  referenceImageUrls: string[];
  frameDescription: string;
  sourceKind: VideoSourceKind;
}

const uniq = (items: string[]) => Array.from(new Set(items.map((x) => String(x || '').trim()).filter(Boolean)));

const norm = (s: string) =>
  String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\u4e00-\u9fa5 ]+/g, '')
    .trim();

const clamp = (s: string, max: number) => {
  const t = String(s || '').trim();
  if (!t) return '';
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 3)).trim()}...`;
};

export const extractDialogueLines = (text: string, max = 4): string[] => {
  const src = String(text || '');
  const lines: string[] = [];
  for (const m of src.matchAll(/"([^"]{2,180})"/g)) lines.push(String(m[1]).trim());
  for (const m of src.matchAll(/“([^”]{2,180})”/g)) lines.push(String(m[1]).trim());
  for (const m of src.matchAll(/(?:^|\n)\s*[A-Za-z\u4e00-\u9fa5][A-Za-z0-9_\-\u4e00-\u9fa5 ]{0,32}\s*:\s*([^\n]{2,180})/g)) {
    lines.push(String(m[1]).trim());
  }
  return uniq(lines).slice(0, max);
};

const splitPerformanceBeats = (text: string, max = 6): string[] => {
  const src = String(text || '').trim();
  if (!src) return [];
  return src
    .split(/\n|[.;!?。！？；]/g)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, max);
};

const inferActingAmplitude = (beat: string): 'micro' | 'medium' | 'large' => {
  const t = String(beat || '').toLowerCase();
  if (/(run|rush|slam|fight|strike|sprint|jump|fall|explode|冲|猛|扑|砸|跳|跌|撞)/i.test(t)) return 'large';
  if (/(walk|turn|step|approach|reach|sit|stand|look|nod|open|close|走|转|靠近|抬|坐|站|看|点头)/i.test(t)) return 'medium';
  return 'micro';
};

const inferEmotionCue = (beat: string): string => {
  const t = String(beat || '').toLowerCase();
  if (/(angry|rage|furious|threat|hostile|愤怒|暴怒|威胁)/i.test(t)) return 'anger under control';
  if (/(sad|cry|grief|loss|heartbreak|悲伤|哭|失落)/i.test(t)) return 'suppressed sadness';
  if (/(fear|panic|shock|terror|紧张|害怕|惊慌|震惊)/i.test(t)) return 'fear with restraint';
  if (/(love|tender|care|relief|温柔|爱|释然)/i.test(t)) return 'tender restraint';
  if (/(conflict|hesitate|doubt|纠结|犹豫|迟疑)/i.test(t)) return 'inner conflict';
  return 'focused dramatic tension';
};

export const buildActingDirection = (args: {
  frameDescription: string;
  script: string;
  shotDescription: string;
  sequenceContext: string;
  dialogue: string[];
}): string => {
  const beats = splitPerformanceBeats(args.script || args.shotDescription || args.frameDescription, 4);
  const lines: string[] = [];
  lines.push('Acting objective: make emotional transitions explicit through behavior, not abstract adjectives.');
  if (args.sequenceContext) lines.push(`Narrative pressure: ${clamp(String(args.sequenceContext), 240)}`);
  if (!beats.length) {
    lines.push('Beat 1: Start contained. Escalate through breath rhythm, eye focus, and micro-expression.');
  } else {
    beats.forEach((beat, idx) => {
      const amp = inferActingAmplitude(beat);
      const emotion = inferEmotionCue(beat);
      lines.push(
        `Beat ${idx + 1}: ${clamp(beat, 180)}. Movement amplitude: ${amp}. Emotion target: ${emotion}. Body cue: timed weight-shift and gesture commitment.`,
      );
    });
  }
  if (args.dialogue.length) {
    lines.push(`Dialogue delivery: ${args.dialogue.map((d, i) => `${i + 1}) "${clamp(d, 120)}"`).join(' ')}`);
    lines.push('Per line: intention before speech, lip-sync timing, and post-line reaction beat.');
  } else {
    lines.push('Non-verbal performance: use gaze, breathing, hand tension, and stillness breaks to carry the arc.');
  }
  return lines.join('\n');
};

export const resolveVideoSourceBundle = (shot: Shot, activeVersion: any): VideoSourceBundle => {
  const type = String(activeVersion?.type || '').trim();
  const baseUrl = String(activeVersion?.imageUrl || '').trim();
  if (type === 'panel_group') {
    const panels = Array.isArray(activeVersion?.metadata?.panelGroup?.panels) ? activeVersion.metadata.panelGroup.panels : [];
    const refs = panels
      .map((p: any) => ({
        panelIndex: Number.isFinite(Number(p?.index)) ? Number(p.index) : undefined,
        url: String(p?.refinedImageUrl || p?.imageUrl || '').trim(),
        description: String(p?.refine?.describe?.description || '').trim(),
      }))
      .filter((x: any) => x.url);
    const sourceImageUrl = String(refs[0]?.url || baseUrl || '').trim();
    return {
      sourceImageUrl,
      referenceFrames: refs,
      referenceImageUrls: uniq(refs.map((r: any) => String(r.url || '').trim())),
      frameDescription: String(shot.description || '').trim(),
      sourceKind: 'stack',
    };
  }
  const frameDescription =
    String(activeVersion?.metadata?.refine?.describe?.description || '').trim() ||
    String(activeVersion?.metadata?.source?.refine?.describe?.description || '').trim() ||
    String(activeVersion?.metadata?.source?.sourceDescription || '').trim() ||
    String(shot.description || '').trim();
  const refFrames = baseUrl ? [{ panelIndex: Number(activeVersion?.metadata?.source?.panelIndex), url: baseUrl, description: frameDescription }] : [];
  return {
    sourceImageUrl: baseUrl,
    referenceFrames: refFrames,
    referenceImageUrls: baseUrl ? [baseUrl] : [],
    frameDescription,
    sourceKind: 'single',
  };
};

export const composeStructuredVideoPrompt = (args: {
  sourceKind: VideoSourceKind;
  referenceFrames?: VideoSourceFrame[];
  frameDescription?: string;
  storyContext?: string;
  actingDirection?: string;
  cameraPrompt?: string;
  lightingPrompt?: string;
  audioPrompt?: string;
  style?: string;
  styleTranslation?: string;
  dialogue?: string[];
  directorNotes?: string;
  constraints?: string[];
  maxChars?: number;
}) => {
  const sections: Array<{ id: string; title: string; body: string; required: boolean }> = [
    {
      id: 'objective',
      title: 'Objective',
      body: 'Image-to-video. Keep identity and environment continuity from the source frame.',
      required: true,
    },
    {
      id: 'frame',
      title: 'Current Frame',
      body: clamp(String(args.frameDescription || '').trim() || 'N/A', 520),
      required: true,
    },
    {
      id: 'references',
      title: 'Reference Bundle',
      body:
        args.sourceKind === 'stack'
          ? clamp(
              `${(args.referenceFrames || []).length} grouped frames as continuity context: ` +
                (args.referenceFrames || [])
                  .slice(0, 8)
                  .map((f, i) => {
                    const idx = Number.isFinite(Number(f?.panelIndex)) ? `#${Number(f.panelIndex) + 1}` : `#${i + 1}`;
                    const d = String(f?.description || '').trim();
                    return d ? `${idx} ${clamp(d, 120)}` : idx;
                  })
                  .join(' | '),
              1200,
            )
          : '',
      required: false,
    },
    { id: 'story', title: 'Story Context', body: clamp(String(args.storyContext || '').trim(), 700), required: false },
    { id: 'acting', title: 'Acting Direction', body: clamp(String(args.actingDirection || '').trim(), 1400), required: true },
    { id: 'camera', title: 'Cameraman Direction', body: clamp(String(args.cameraPrompt || '').trim(), 500), required: true },
    { id: 'lighting', title: 'Lighting Direction', body: clamp(String(args.lightingPrompt || '').trim(), 420), required: false },
    { id: 'audio', title: 'Audio / Mood', body: clamp(String(args.audioPrompt || '').trim(), 320), required: false },
    { id: 'style', title: 'Style', body: clamp(String(args.style || '').trim(), 700), required: true },
    { id: 'style_hints', title: 'Style Translation Hints', body: clamp(String(args.styleTranslation || '').trim(), 400), required: false },
    {
      id: 'dialogue',
      title: 'Dialogue',
      body: Array.isArray(args.dialogue) && args.dialogue.length ? args.dialogue.map((d, i) => `${i + 1}. "${clamp(String(d || ''), 140)}"`).join('\n') : '',
      required: false,
    },
    { id: 'director_notes', title: 'Director Notes', body: clamp(String(args.directorNotes || '').trim(), 700), required: false },
    {
      id: 'quality',
      title: 'Quality Constraints',
      body:
        uniq([...(Array.isArray(args.constraints) ? args.constraints : []), 'Avoid jitter/flicker/style drift.', 'No text overlays, subtitles, logos, or watermark.'])
          .map((x, i) => `${i + 1}. ${clamp(x, 180)}`)
          .join('\n'),
      required: true,
    },
  ];

  const used: string[] = [];
  const seenBodies = new Set<string>();
  const active = sections.filter((s) => {
    const body = String(s.body || '').trim();
    if (!body) return false;
    const key = norm(body);
    if (key && seenBodies.has(key)) return false;
    if (key) seenBodies.add(key);
    used.push(s.id);
    return true;
  });

  const render = (items: Array<{ title: string; body: string }>) => items.map((s) => `${s.title}:\n${s.body}`).join('\n\n');
  const maxChars = Math.max(1800, Number(args.maxChars || 7200));
  let prompt = render(active);
  const dropped: string[] = [];
  const dropOrder = ['director_notes', 'audio', 'lighting', 'story', 'style_hints', 'references', 'dialogue'];
  for (const id of dropOrder) {
    if (prompt.length <= maxChars) break;
    const idx = active.findIndex((s) => s.id === id && !s.required);
    if (idx < 0) continue;
    dropped.push(active[idx].id);
    active.splice(idx, 1);
    prompt = render(active);
  }
  if (prompt.length > maxChars) {
    prompt = `${prompt.slice(0, Math.max(0, maxChars - 40)).trim()}\n\n[Prompt trimmed]`;
  }
  return { prompt, sectionsUsed: active.map((s) => s.id), droppedSections: dropped };
};

