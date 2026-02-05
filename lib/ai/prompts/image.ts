import type { Shot } from '../../../types';

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
    'Compose like a real film still: clear subject, intentional framing, strong depth (foreground/mid/background), avoid awkward crops and dead-center staging.',
    'Natural acting: avoid stiff front-facing poses; characters should not look directly into camera unless explicitly required by the shot.',
    'Use concrete cinematography terms (shot size, lens focal length, aperture, depth of field). If not specified, choose an appropriate setup (35–85mm, f/2–f/4, cinematic DOF) that fits the scene.',
  ].filter(Boolean);

  const constraints = [
    styleGuide ? `Style guide (must follow): ${styleGuide}` : '',
    'This must look like a keyframe from a movie scene (mid-action), not a poster, not concept art, not a posed lineup.',
    'Follow reference images strictly for identity + environment consistency.',
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
