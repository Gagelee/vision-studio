import type { Shot } from '../../../types';
import { buildStylePromptTranslation } from '../styleIntent';

export const buildShotKeyframePrompt = (args: {
  shot: Shot;
  styleGuide?: string;
  environmentName?: string;
  environmentStyle?: string;
  castNames?: string[];
}) => {
  const shot = args.shot;
  const styleGuide = String(args.styleGuide || '').trim();
  const envName = String(args.environmentName || '').trim();
  const envStyle = String(args.environmentStyle || '').trim();
  const castNames = Array.isArray(args.castNames) ? args.castNames.map((s) => String(s || '').trim()).filter(Boolean) : [];

  const camera = String(shot.elements?.CAMERA?.prompt || '').trim();
  const lighting = String(shot.elements?.LIGHTING?.prompt || '').trim();

  const sceneBits = [
    String(shot.description || '').trim(),
    shot.timeOfDay ? `Time: ${shot.timeOfDay}` : '',
    envName ? `Setting: ${envName}` : '',
    envStyle ? `Environment style: ${envStyle}` : '',
    castNames.length ? `Cast in frame: ${castNames.join(', ')}` : '',
  ].filter(Boolean);

  const cinematographyBits = [
    camera ? `Camera: ${camera}` : '',
    lighting ? `Lighting: ${lighting}` : '',
    'Compose like a narrative frame: clear subject, intentional framing, strong depth (foreground/mid/background), avoid awkward crops and dead-center staging.',
    'Natural acting: avoid stiff front-facing poses; characters should not look directly into camera unless explicitly required by the shot.',
    'Use concrete framing/camera intent. Prefer neutral, style-consistent lens behavior by default; only use shallow DOF/bokeh cues when explicitly requested.',
  ].filter(Boolean);

  const constraints = [
    styleGuide ? `Style guide (must follow): ${styleGuide}` : '',
    (() => {
      const inferred = buildStylePromptTranslation({
        texts: [styleGuide, String(shot.description || ''), camera, lighting],
        maxItems: 5,
      });
      return inferred ? `Style translation hints: ${inferred}.` : '';
    })(),
    'This must look like a keyframe from a movie scene (mid-action), not a poster, not concept art, not a posed lineup.',
    'Follow reference images strictly for identity + environment consistency.',
    'Output format must be a single narrative frame. Even if references are model sheets/contact sheets/multi-panel boards (e.g., 2x2), extract identity cues only and DO NOT reproduce collage, split panels, grids, or tiled layouts.',
    'Do not introduce generic CGI/3D-render aesthetics unless the style guide explicitly asks for it.',
    'No text, subtitles, watermarks, or logos.',
  ].filter(Boolean);

  const sceneLine = sceneBits.join(' ');
  const cineLine = cinematographyBits.join(' ');
  const constraintLine = constraints.join(' ');

  return [sceneLine, cineLine, constraintLine].map((s) => String(s || '').trim()).filter(Boolean).join('\n\n');
};

export const buildShotImagePrompt = (shot: Shot) => {
  return buildShotKeyframePrompt({ shot });
};
