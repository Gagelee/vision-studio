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

const sanitizeBeatText = (text: string): string =>
  String(text || '')
    .replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/g, '')
    .replace(/^\s*(?:beat\s*\d+\s*[:.)-]?\s*|[\d]+[.)、]\s*|[-*#]+\s*)/i, '')
    .replace(/\s+/g, ' ')
    .trim();

const isMeaningfulBeat = (text: string): boolean => {
  const t = sanitizeBeatText(text);
  if (!t || t.length < 3) return false;
  if (!/[A-Za-z0-9\u4e00-\u9fa5]/.test(t)) return false;
  if (/^(INT|EXT)\.?$/i.test(t)) return false;
  if (/^(INT|EXT)\b/i.test(t)) return false;
  if (/^(DAY|NIGHT|MORNING|EVENING|DUSK|DAWN)\b/i.test(t)) return false;
  if (/^[A-Z][A-Z0-9 _-]{1,24}:/.test(t)) return false;
  return true;
};

const extractScriptDialogueTurns = (text: string, max = 6): string[] => {
  const src = String(text || '');
  const out: string[] = [];
  for (const m of src.matchAll(/(?:^|\n)\s*([A-Za-z\u4e00-\u9fa5][A-Za-z0-9_\-\u4e00-\u9fa5 ]{0,32})\s*:\s*([^\n]{2,180})/g)) {
    const speaker = String(m[1] || '').trim();
    const line = String(m[2] || '').trim();
    if (!speaker || !line) continue;
    out.push(`${speaker.toUpperCase()}: "${line}"`);
  }
  if (!out.length) {
    for (const m of src.matchAll(/"([^"]{2,180})"/g)) out.push(`LINE: "${String(m[1]).trim()}"`);
    for (const m of src.matchAll(/“([^”]{2,180})”/g)) out.push(`LINE: "${String(m[1]).trim()}"`);
  }
  return uniq(out).slice(0, max);
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
    .map((s) => sanitizeBeatText(s))
    .filter((s) => isMeaningfulBeat(s))
    .slice(0, max);
};

const motionCueForAmplitude = (amp: 'micro' | 'medium' | 'large') => {
  if (amp === 'large') return 'full-body displacement with acceleration and clear follow-through';
  if (amp === 'medium') return 'visible torso shift, step timing, and committed arm path';
  return 'micro-expression, breath rhythm, and subtle gaze/finger tension';
};

const pacingCueForIndex = (idx: number, total: number) => {
  if (idx === 0) return 'opening setup, establish intention before movement';
  if (idx >= total - 1) return 'release/resolve, hold reaction for a readable tail';
  return 'escalation beat, make cause and effect legible';
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
  sourceKind?: VideoSourceKind;
  referenceFrames?: VideoSourceFrame[];
}): string => {
  const frameBeats = (Array.isArray(args.referenceFrames) ? args.referenceFrames : [])
    .map((f) => sanitizeBeatText(String(f?.description || '').trim()))
    .filter((s) => isMeaningfulBeat(s))
    .slice(0, 9);
  const textBeats = splitPerformanceBeats(args.script || args.shotDescription || args.frameDescription, 6);
  const beats = uniq([...(args.sourceKind === 'stack' ? frameBeats : []), ...textBeats]).slice(0, 6);
  const dialogueTurns = uniq([
    ...extractScriptDialogueTurns(args.script, 6),
    ...(Array.isArray(args.dialogue) ? args.dialogue.map((x) => `LINE: "${String(x || '').trim()}"`) : []),
  ]).slice(0, 6);
  const lines: string[] = [];
  if (!beats.length) {
    lines.push(
      'Beat 1:\nAction: establish intent through controlled stillness and focused eye-line.\nPerformance: restrained breathing pattern, latent tension, minimal gesture.',
    );
    lines.push(
      'Beat 2:\nAction: clear trigger followed by decisive body-weight transfer.\nPerformance: committed gesture path and readable emotional escalation.',
    );
    lines.push(
      'Beat 3:\nAction: reaction tail and controlled settle.\nPerformance: residual tension remains visible in posture and gaze.',
    );
    if (dialogueTurns.length) lines.push(`Dialogue Beat: ${dialogueTurns[0]}`);
  } else {
    beats.forEach((beat, idx) => {
      const amp = inferActingAmplitude(beat);
      const emotion = inferEmotionCue(beat);
      const motionCue = motionCueForAmplitude(amp);
      const pacingCue = pacingCueForIndex(idx, beats.length);
      const dialogueCue = String(dialogueTurns[idx] || dialogueTurns[0] || '').trim();
      lines.push(
        `Beat ${idx + 1}:\nAction: ${clamp(sanitizeBeatText(beat), 180)}\nPerformance: intent=${emotion}; motion=${motionCue}; pacing=${pacingCue}${dialogueCue ? `\nDialogue: ${dialogueCue}` : '\nDialogue: (silent beat)'}`,
      );
    });
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
  const styleLockHint = uniq(
    [String(args.style || '').trim(), String(args.styleTranslation || '').trim()]
      .filter(Boolean)
      .map((s) => clamp(s, 180)),
  )
    .slice(0, 1)
    .join(' ');

  const gridRhythm = (() => {
    if (args.sourceKind !== 'stack') return '';
    const frames = Array.isArray(args.referenceFrames) ? args.referenceFrames : [];
    if (!frames.length) return '';
    const inferGridFallbackBeats = (max = 9): string[] => {
      const fromFrame = splitPerformanceBeats(String(args.frameDescription || '').trim(), max);
      if (fromFrame.length > 1) return fromFrame;
      const acting = String(args.actingDirection || '').trim();
      if (!acting && fromFrame.length) return fromFrame;
      if (!acting) return [];
      const out: string[] = [];
      for (const m of acting.matchAll(/Beat\s+\d+:\s*([\s\S]*?)(?=\nBeat\s+\d+:|$)/g)) {
        const block = String(m[1] || '').trim();
        const actionLine =
          String(block.match(/(?:^|\n)\s*Action:\s*([^\n]+)/i)?.[1] || '').trim() ||
          String(block.split('\n').find((x) => isMeaningfulBeat(x)) || '').trim();
        const beat = sanitizeBeatText(actionLine);
        if (!isMeaningfulBeat(beat)) continue;
        out.push(beat);
        if (out.length >= max) break;
      }
      const cleaned = uniq(out);
      return cleaned.length ? cleaned : fromFrame;
    };
    const fallbackBeats = inferGridFallbackBeats(9);
    const makeFallback = (idx: number, total: number): string => {
      const phase =
        idx === 0
          ? 'establish subject placement and intent with stable screen direction'
          : idx >= total - 1
            ? 'resolve action with clear reaction and stable spatial continuity'
            : 'escalate action while preserving left-right continuity and environment lock';
      const seed = sanitizeBeatText(String(fallbackBeats[idx] || fallbackBeats[fallbackBeats.length - 1] || args.frameDescription || ''));
      if (!isMeaningfulBeat(seed)) return phase;
      return `${seed}; ${phase}`;
    };
    const lines = frames.slice(0, 9).map((f, i) => {
      const idx = Number.isFinite(Number(f?.panelIndex)) ? Number(f.panelIndex) + 1 : i + 1;
      const d = clamp(sanitizeBeatText(String(f?.description || '').trim()), 160);
      const fb = clamp(makeFallback(i, frames.length), 160);
      return `Beat ${idx}: ${d || fb}`;
    });
    return lines.join('\n');
  })();

  const cameraGridAware = (() => {
    const base = clamp(String(args.cameraPrompt || '').trim(), 700);
    if (!base) return '';
    if (args.sourceKind !== 'stack') return base;
    return `${base}\nUse grid frame progression as primary staging reference; do not force a single static shot plan across all beats.`;
  })();

  const sections: Array<{ id: string; title: string; body: string; required: boolean }> = [
    { id: 'acting', title: 'Action & Performance Beats', body: clamp(String(args.actingDirection || '').trim(), 1800), required: true },
    {
      id: 'frame',
      title: 'Current Frame',
      body: args.sourceKind === 'single' ? clamp(String(args.frameDescription || '').trim() || 'N/A', 520) : '',
      required: false,
    },
    { id: 'grid', title: 'Grid Beat Continuity', body: gridRhythm, required: false },
    { id: 'camera', title: 'Camera Movement Plan', body: cameraGridAware, required: true },
    { id: 'lighting', title: 'Lighting Continuity', body: clamp(String(args.lightingPrompt || '').trim(), 280), required: false },
    {
      id: 'style_lock',
      title: 'Look Lock (Minimal)',
      body: styleLockHint
        ? `Use source image look as lock; do not restyle. Optional tone hint: ${styleLockHint}`
        : 'Use source image look as lock; do not restyle.',
      required: false,
    },
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
  const dropOrder = ['lighting', 'style_lock', 'grid', 'frame'];
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
