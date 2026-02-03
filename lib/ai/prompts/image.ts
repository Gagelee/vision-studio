import type { Shot } from '../../../types';

export const buildShotImagePrompt = (shot: Shot) => {
  const parts = [
    shot.description,
    `Time: ${shot.timeOfDay}`,
    `Camera: ${shot.elements?.CAMERA?.prompt || ''}`,
    `Lighting: ${shot.elements?.LIGHTING?.prompt || ''}`,
    `Audio: ${shot.elements?.AUDIO?.prompt || ''}`,
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  return parts.join('\n');
};
