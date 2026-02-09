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

const uniqueList = (items: string[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = clampText(raw, 180);
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

export const buildShotKeyframePrompt = (args: {
  shot: Shot;
  styleGuide?: string;
  environmentName?: string;
  environmentStyle?: string;
  castNames?: string[];
  panelHints?: string[];
}) => {
  const shot = args.shot;
  const styleGuide = String(args.styleGuide || '').trim();
  const envName = String(args.environmentName || '').trim();
  const envStyle = String(args.environmentStyle || '').trim();
  const castNames = Array.isArray(args.castNames) ? args.castNames.map((s) => String(s || '').trim()).filter(Boolean) : [];
  const panelCount = selectContactSheetPanelCount(Number(shot.duration || 0));
  const gridLabel = panelCount === 9 ? '3x3' : '2x2';
  const panelHints = collectPanelHints(shot, panelCount, args.panelHints);

  const camera = String(shot.elements?.CAMERA?.prompt || '').trim();
  const lighting = String(shot.elements?.LIGHTING?.prompt || '').trim();
  const script = String((shot.elements as any)?.SCRIPT?.prompt || '').trim();
  const audio = String((shot.elements as any)?.AUDIO?.prompt || '').trim();

  const styleTranslation = buildStylePromptTranslation({
    texts: [styleGuide, String(shot.description || ''), camera, lighting],
    maxItems: 6,
  });

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
  ]
    .filter(Boolean)
    .join('\n- ');

  const panelGuidance =
    panelHints.length > 0
      ? panelHints.map((b, i) => `${i + 1}. ${b}`).join('\n')
      : 'No fixed micro-beats provided. Freely design a coherent progression that matches the scene input.';

  return (
    `You are a professional cinematographer + storyboard artist.\n\n` +
    `INPUTS\n` +
    `- REFERENCE IMAGE(S): character/subject reference(s). Preserve identity exactly (face, body, proportions, costume, hair, accessories, materials, colors).\n` +
    `- SCENE INPUT (text): scene description, setting, mood, actions, and any required props.\n\n` +
    `TASK\n` +
    `Create ONE photorealistic cinematic contact sheet as a strict ${gridLabel} grid (${panelCount} panels total) in 16:9 aspect ratio.\n` +
    `All panels must feature the SAME key subjects in the SAME environment, with consistent wardrobe and cinematic lighting/color grade.\n` +
    `Panels must form a coherent micro-sequence. Keep time-of-day and lighting direction stable.\n\n` +
    `STEP 1 — ANALYZE\n` +
    `Identify and lock all key subjects from references + scene input:\n` +
    `- People/creatures: count, roles, defining features, clothing.\n` +
    `- Vehicles/objects: type, distinguishing marks, materials, textures.\n` +
    `- Spatial relationships: near/far, interaction, primary/secondary subjects.\n` +
    `Do NOT introduce new key subjects. Do NOT remove key subjects.\n\n` +
    `STEP 2 — CONTINUITY RULES (STRICT)\n` +
    `- Same identities across all panels (no face/outfit/accessory changes).\n` +
    `- Same environment and same time-of-day/weather.\n` +
    `- Same cinematic lighting direction and same LUT/color grade (minor realistic shifts only).\n` +
    `- Distinct composition per panel (no duplicated framing).\n` +
    `- Realistic depth of field changes by shot scale.\n` +
    `- Keep group continuity if subjects are a pair/group.\n` +
    `- No text, subtitles, watermarks, logos, UI overlays, or panel labels.\n\n` +
    `STEP 3 — PANEL MICRO-BEATS (OPTIONAL GUIDANCE)\n` +
    `${panelGuidance}\n` +
    `Use these beats when present. If guidance is sparse, infer cinematic transitions naturally.\n\n` +
    `STEP 4 — GRID OUTPUT\n` +
    `Render a clean ${gridLabel} contact sheet with uniform gutters/borders. Each panel is a photoreal film still (not illustration).\n\n` +
    `CAMERA / FILM LOOK (CONSISTENT)\n` +
    `- Photoreal cinematic still, filmic contrast, controlled highlights, natural texture.\n` +
    `- Use realistic lens logic per framing (wide/mid/close) and plausible aperture.\n` +
    `- Keep white balance and grade coherent across all panels.\n` +
    `- Imply motion naturally; avoid excessive blur unless needed by action.\n\n` +
    `COMPOSITION NOTES\n` +
    `- Preserve left-right orientation and spatial continuity.\n` +
    `- Ensure required key subjects stay present in every panel.\n` +
    `- Avoid awkward cropping; use intentional LS/CU/ECU framing.\n\n` +
    `PROJECT STYLE LOCK\n` +
    `- Style guide (hard lock when provided): ${styleGuide || 'N/A'}\n` +
    `- Style translation hints: ${styleTranslation || 'N/A'}\n` +
    `- Avoid generic CGI/3D-render aesthetics unless explicitly required by the style guide.\n\n` +
    `SCENE INPUT:\n` +
    `- ${sceneInput}\n\n` +
    `OUTPUT\n` +
    `Generate the final image only: one ${gridLabel} storyboard/contact sheet image.`
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
  const envName = String(args.environmentName || '').trim();
  const envStyle = String(args.environmentStyle || '').trim();
  const castNames = Array.isArray(args.castNames) ? args.castNames.map((s) => String(s || '').trim()).filter(Boolean) : [];
  const focusBeat = String(args.focusBeat || '').trim();

  const camera = String(shot.elements?.CAMERA?.prompt || '').trim();
  const lighting = String(shot.elements?.LIGHTING?.prompt || '').trim();
  const script = String((shot.elements as any)?.SCRIPT?.prompt || '').trim();
  const audio = String((shot.elements as any)?.AUDIO?.prompt || '').trim();

  const styleTranslation = buildStylePromptTranslation({
    texts: [styleGuide, String(shot.description || ''), camera, lighting],
    maxItems: 6,
  });

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
    `- Style guide (hard lock when provided): ${styleGuide || 'N/A'}\n` +
    `- Style translation hints: ${styleTranslation || 'N/A'}\n\n` +
    `SCENE INPUT:\n` +
    `- ${sceneInput}\n\n` +
    `OUTPUT\n` +
    `Generate the final image only: one single-frame cinematic still.`
  );
};

export const buildShotImagePrompt = (shot: Shot) => {
  return buildShotKeyframePrompt({ shot });
};
