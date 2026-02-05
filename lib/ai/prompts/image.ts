import type { Shot } from '../../../types';

export const buildShotImagePrompt = (shot: Shot) => {
  const shotBrief = [
    `Description: ${shot.description}`,
    shot.timeOfDay ? `Time: ${shot.timeOfDay}` : '',
    shot.elements?.CAMERA?.prompt ? `Camera intent: ${shot.elements.CAMERA.prompt}` : '',
    shot.elements?.LIGHTING?.prompt ? `Lighting intent: ${shot.elements.LIGHTING.prompt}` : '',
    shot.elements?.AUDIO?.prompt ? `Audio intent: ${shot.elements.AUDIO.prompt}` : '',
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  const craft = [
    'Cinematography & composition requirements:',
    '- Strong film composition: rule of thirds, leading lines, clear subject, layered depth (foreground/mid/background).',
    '- Cinematic framing: proper headroom, avoid awkward crops, avoid dead-center boring staging unless intentional.',
    '- Natural acting: avoid stiff front-facing poses; characters should NOT look directly into camera unless explicitly required.',
    '- Use photographic language: specify shot size + focal length + aperture + depth of field (e.g. 35mm/50mm/85mm, f/1.8–f/4).',
    '- Lighting should feel motivated and cinematic; preserve texture, avoid flat lighting, keep contrast controlled.',
  ].join('\n');

  return ['Shot brief:', ...shotBrief, '', craft].filter(Boolean).join('\n');
};
