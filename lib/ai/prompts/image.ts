import type { Shot } from '../../../types';
import { buildStylePromptTranslation } from '../styleIntent';

export const selectContactSheetPanelCount = (duration: number): 4 | 9 => {
  const d = Number(duration || 0);
  return d >= 8 ? 9 : 4;
};

const clampText = (s: string, n = 220) => {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  return t.length > n ? `${t.slice(0, n - 1)}...` : t;
};

const enforcePromptBudget = (s: string, maxChars = 5600) => {
  const t = String(s || '').trim();
  if (!t) return '';
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 64)).trim()}\n\n[Extra guidance trimmed to fit prompt length.]`;
};

const uniqueList = (items: string[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = clampText(raw, 140);
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
};

const splitIntoBeats = (text: string) => {
  const src = String(text || '').trim();
  if (!src) return [];
  return src
    .split(/\n|[.;!?。！？；]/g)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && !/^[A-Z][A-Z0-9 _-]{1,24}:/.test(s));
};

const collectPanelHints = (shot: Shot, panelCount: 4 | 9, explicitHints?: string[]) => {
  const cameraMeta = ((shot.elements as any)?.CAMERA?.metadata || {}) as Record<string, any>;
  const metadataHintsRaw = Array.isArray(cameraMeta?.panelBeats)
    ? cameraMeta.panelBeats
    : Array.isArray(cameraMeta?.keyframePanelHints)
      ? cameraMeta.keyframePanelHints
      : Array.isArray((shot as any)?.keyframePlan?.panelGuidance)
        ? (shot as any).keyframePlan.panelGuidance
        : [];
  const metadataHints = metadataHintsRaw.map((x: any) => String(x || '').trim()).filter(Boolean);
  const providedHints = Array.isArray(explicitHints) ? explicitHints.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const scriptBeats = splitIntoBeats(String((shot.elements as any)?.SCRIPT?.prompt || ''));
  const descBeats = splitIntoBeats(String(shot.description || ''));
  return uniqueList([...providedHints, ...metadataHints, ...scriptBeats, ...descBeats]).slice(0, panelCount);
};

const compressVisualStyleLock = (raw: string, maxItems = 4) => {
  const text = String(raw || '').trim();
  if (!text) return '';
  const parts = text
    .split(/\n|[.;!?。！？；]/g)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  const visualHint =
    /(style|visual|look|palette|color|grade|lighting|camera|lens|texture|material|contrast|tone|cinematic|film|realism|photoreal|medium|构图|镜头|光|色|风格|质感|材质|写实|电影|景深|调色)/i;
  const narrativeNoise =
    /(logline|intent|story|plot|synopsis|sequence|scene|shot|character|dialogue|剧情|故事|角色|对白|台词|分镜|序列|场景)/i;
  const picked = parts
    .filter((x) => visualHint.test(x) && !narrativeNoise.test(x))
    .slice(0, Math.max(1, Math.min(6, Number(maxItems || 4))));
  const fallback = parts
    .filter((x) => !narrativeNoise.test(x))
    .slice(0, 1);
  const out = uniqueList((picked.length ? picked : fallback).map((x) => clampText(x, 88))).slice(0, maxItems);
  return out.join('; ');
};

const buildStructuredStyleLock = (args: {
  styleGuide: string;
  compactStyleGuide: string;
  styleTranslation: string;
  environmentStyle: string;
  camera: string;
  lighting: string;
}) => {
  const styleSummary =
    clampText(
      [args.compactStyleGuide, args.styleTranslation, args.styleGuide]
        .map((x) => String(x || '').trim())
        .find(Boolean) || '',
      420,
    ) || '';
  const visuals = clampText(String(args.environmentStyle || '').trim(), 260);
  const cameraLine = clampText(
    uniqueList([String(args.camera || '').trim(), String(args.lighting || '').trim()]).join('; '),
    260,
  );
  const composition = 'cinematic framing with clear foreground/mid/background separation';
  const finish = 'filmic contrast and disciplined highlight rolloff; story-first staging';

  const lines = [
    styleSummary ? `- Visuals: ${styleSummary}` : '',
    visuals ? `- Environment: ${visuals}` : '',
    cameraLine ? `- Camera: ${cameraLine}` : '',
    `- Composition: ${composition}`,
    `- Finish: ${finish}`,
  ].filter(Boolean);

  return lines.length ? lines.join('\n') : '- Visuals: cinematic realism\n- Finish: controlled contrast, natural texture';
};

export const buildShotKeyframePrompt = (args: {
  shot: Shot;
  styleGuide?: string;
  environmentName?: string;
  environmentStyle?: string;
  castNames?: string[];
  panelHints?: string[];
}) => {
  const shot = args.shot;
  const styleGuide = clampText(String(args.styleGuide || '').trim(), 900);
  const compactStyleGuide = compressVisualStyleLock(styleGuide, 4);
  const envName = clampText(String(args.environmentName || '').trim(), 96);
  const envStyle = clampText(String(args.environmentStyle || '').trim(), 320);
  const panelCount = selectContactSheetPanelCount(Number(shot.duration || 0));
  const gridLabel = panelCount === 9 ? '3x3' : '2x2';
  const panelHints = collectPanelHints(shot, panelCount, args.panelHints);

  const camera = clampText(String(shot.elements?.CAMERA?.prompt || '').trim(), 260);
  const lighting = clampText(String(shot.elements?.LIGHTING?.prompt || '').trim(), 240);
  const script = clampText(String((shot.elements as any)?.SCRIPT?.prompt || '').trim(), 420);
  const styleTranslation = buildStylePromptTranslation({
    texts: [compactStyleGuide || styleGuide, envStyle, camera, lighting],
    maxItems: 3,
  });
  const structuredStyleLock = buildStructuredStyleLock({
    styleGuide,
    compactStyleGuide,
    styleTranslation,
    environmentStyle: envStyle,
    camera,
    lighting,
  });

  const sceneInput = [
    `Scene: ${clampText(String(shot.description || '').trim(), 420) || 'N/A'}`,
    shot.timeOfDay ? `Time of day: ${shot.timeOfDay}` : '',
    envName ? `Setting: ${envName}` : '',
    envStyle ? `Environment style: ${envStyle}` : '',
    camera ? `Camera direction: ${camera}` : '',
    lighting ? `Lighting direction: ${lighting}` : '',
    script ? `Script beat: ${script}` : '',
  ]
    .filter(Boolean)
    .join('\n- ');

  const panelGuidance =
    panelHints.length > 0
      ? panelHints.map((b, i) => `${i + 1}. ${b}`).join('\n')
      : 'No fixed micro-beats provided. Build a coherent progression from the scene input.';

  return enforcePromptBudget(
    `You are a professional cinematographer and storyboard artist.\n\n` +
      `TASK\n` +
      `Create ONE photorealistic cinematic contact sheet as a strict ${gridLabel} grid (${panelCount} panels), 16:9.\n` +
      `All panels must depict the SAME key subjects in the SAME environment with stable identity and style continuity.\n\n` +
      `ANALYZE FIRST\n` +
      `Lock key subjects from references and scene text before rendering:\n` +
      `- Preserve identity anchors: face, body proportions, wardrobe, accessories, material/color cues.\n` +
      `- Preserve environment anchors: location structure, mood, time-of-day, weather logic.\n` +
      `- Do not add/remove major subjects unless the scene explicitly requests it.\n\n` +
      `CONTINUITY RULES (STRICT)\n` +
      `1) Identity consistency across all panels (no face/outfit drift).\n` +
      `2) Environment continuity across all panels (same location/time/weather).\n` +
      `3) Lighting direction and color grade continuity (minor cinematic variation allowed).\n` +
      `4) Composition progression required: each panel should be distinct and narratively connected.\n` +
      `5) Preserve left-right spatial continuity and interaction logic.\n` +
      `6) No text/subtitles/watermarks/logos/UI/panel labels.\n\n` +
      `CAMERA / FILM LOOK\n` +
      `- Photoreal cinematic stills, filmic contrast, controlled highlights, natural texture.\n` +
      `- Use plausible lens language across shot scales (wide / medium / close).\n` +
      `- Depth-of-field and motion implication should be realistic, not stylized gimmicks.\n\n` +
      `PANEL MICRO-BEATS\n` +
      `${panelGuidance}\n` +
      `Follow these beats when present; otherwise infer a coherent visual progression from the scene.\n\n` +
      `PROJECT STYLE LOCK\n` +
      `- Keep references as the primary lock. Supplemental visual lock:\n` +
      `${structuredStyleLock}\n` +
      `- Avoid accidental style drift into generic CGI look unless explicitly requested.\n\n` +
      `SCENE INPUT\n` +
      `- ${sceneInput}\n\n` +
      `OUTPUT\n` +
      `Return only the final ${gridLabel} storyboard/contact-sheet image.`,
  );
};

export const buildShotSingleFramePrompt = (args: {
  shot: Shot;
  styleGuide?: string;
  environmentName?: string;
  environmentStyle?: string;
  castNames?: string[];
  focusBeat?: string;
}) => {
  const shot = args.shot;
  const styleGuide = String(args.styleGuide || '').trim();
  const compactStyleGuide = compressVisualStyleLock(styleGuide, 4);
  const envName = String(args.environmentName || '').trim();
  const envStyle = String(args.environmentStyle || '').trim();
  const castNames = Array.isArray(args.castNames) ? args.castNames.map((s) => String(s || '').trim()).filter(Boolean) : [];
  const focusBeat = String(args.focusBeat || '').trim();

  const camera = String(shot.elements?.CAMERA?.prompt || '').trim();
  const lighting = String(shot.elements?.LIGHTING?.prompt || '').trim();
  const script = String((shot.elements as any)?.SCRIPT?.prompt || '').trim();
  const audio = String((shot.elements as any)?.AUDIO?.prompt || '').trim();

  const styleTranslation = buildStylePromptTranslation({
    texts: [compactStyleGuide || styleGuide, envStyle, camera, lighting],
    maxItems: 3,
  });
  const compactStyleLock = uniqueList([compactStyleGuide, styleTranslation].filter(Boolean)).join('; ');

  const sceneInput = [
    `Scene: ${String(shot.description || '').trim() || 'N/A'}`,
    shot.timeOfDay ? `Time of day: ${shot.timeOfDay}` : '',
    envName ? `Setting: ${envName}` : '',
    envStyle ? `Environment style: ${envStyle}` : '',
    castNames.length ? `Key subjects: ${castNames.join(', ')}` : '',
    camera ? `Camera direction: ${camera}` : '',
    lighting ? `Lighting direction: ${lighting}` : '',
    script ? `Script beat: ${script}` : '',
    audio ? `Audio mood cue: ${audio}` : '',
    focusBeat ? `Focus beat (from contact sheet panel): ${focusBeat}` : '',
  ]
    .filter(Boolean)
    .join('\n- ');

	return (
	  `You are a professional cinematographer.\n\n` +
	  `INPUTS\n` +
	  `- REFERENCE IMAGE(S): preserve identity exactly (face, body, proportions, costume, hair, accessories, materials, colors).\n` +
	  `- If a reference is a "frame" to refine: treat it as the primary source of composition.\n` +
	  `- SCENE INPUT (text): scene description, setting, mood, and actions.\n\n` +
	  `TASK\n` +
	  `Create ONE photorealistic cinematic still frame in 16:9 aspect ratio.\n` +
	  `This is NOT a grid/contact-sheet. Output a single full-frame image only.\n` +
	  `No text, subtitles, watermarks, logos, UI overlays, or panel borders.\n\n` +
	  `CONTINUITY RULES (STRICT)\n` +
	  `- The frame reference overrides text if they conflict. Do not change camera angle or composition.\n` +
	  `- Do not introduce new key subjects.\n` +
	  `- Keep wardrobe and identity consistent with references.\n` +
	  `- Keep environment/time-of-day consistent.\n\n` +
	  `- If a frame reference is provided: preserve framing, camera angle, subject poses, and spatial layout. Improve clarity/detail without drifting.\n\n` +
	  `FILM LOOK\n` +
	  `- Photoreal cinematic still, filmic contrast, controlled highlights, natural texture.\n` +
    `- Plausible lens choice and depth of field.\n\n` +
    `PROJECT STYLE LOCK\n` +
    `- Keep references as the primary lock. Supplemental visual lock: ${compactStyleLock || 'cinematic realism; controlled contrast; natural texture'}\n\n` +
    `SCENE INPUT:\n` +
    `- ${sceneInput}\n\n` +
    `OUTPUT\n` +
    `Generate the final image only: one single-frame cinematic still.`
  );
};

export const buildRefineFromDescribePrompt = (args: {
  describe: {
    description: string;
    keySubjects?: string[];
    environment?: string;
    composition?: string;
    camera?: string;
    lighting?: string;
    style?: string;
    constraints?: string[];
  };
  styleGuide?: string;
  styleTranslation?: string;
  extraConstraints?: string[];
}) => {
  const d = args.describe || ({} as any);
  const styleGuide = String(args.styleGuide || '').trim();
  const styleTranslation = String(args.styleTranslation || '').trim();
  const keySubjects = Array.isArray(d.keySubjects) ? d.keySubjects.map((s: any) => String(s || '').trim()).filter(Boolean) : [];
  const constraints = [
    'Output a single full-frame still image (NOT a grid/contact sheet).',
    'Use the provided frame reference as the ground truth for composition and camera angle.',
    'Preserve subject identity, wardrobe, and environment continuity from references.',
    'Improve clarity/detail and fix artifacts; do not drift.',
    ...(Array.isArray(d.constraints) ? d.constraints.map((s: any) => String(s || '').trim()).filter(Boolean) : []),
    ...(Array.isArray(args.extraConstraints) ? args.extraConstraints.map((s) => String(s || '').trim()).filter(Boolean) : []),
  ].filter(Boolean);

  return (
    `You are refining a keyframe from an existing frame reference.\n\n` +
    `INPUTS\n` +
    `- FRAME REFERENCE (image): must be preserved in composition and camera angle.\n` +
    `- IDENTITY/ENV REFERENCES (images): preserve identity and environment.\n` +
    `- STYLE GUIDE (text): apply grade, materials, and art direction.\n\n` +
    `FRAME DESCRIPTION (vision)\n` +
    `- ${String(d.description || '').trim() || 'N/A'}\n` +
    (keySubjects.length ? `- Key subjects: ${keySubjects.join(', ')}\n` : '') +
    (d.environment ? `- Environment: ${String(d.environment).trim()}\n` : '') +
    (d.composition ? `- Composition: ${String(d.composition).trim()}\n` : '') +
    (d.camera ? `- Camera: ${String(d.camera).trim()}\n` : '') +
    (d.lighting ? `- Lighting: ${String(d.lighting).trim()}\n` : '') +
    (d.style ? `- Visual cues: ${String(d.style).trim()}\n` : '') +
    `\n` +
    `STYLE\n` +
    `- Style guide: ${styleGuide || 'N/A'}\n` +
    `- Style translation hints: ${styleTranslation || 'N/A'}\n\n` +
    `CONSTRAINTS (STRICT)\n` +
    constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')
  );
};

export const buildShotImagePrompt = (shot: Shot) => {
  return buildShotKeyframePrompt({ shot });
};
