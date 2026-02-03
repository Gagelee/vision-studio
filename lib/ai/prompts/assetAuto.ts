import type { Character, CharacterLook, Location } from '../../../types';

const baseRules = () => `No text. No watermark. No logos. Cinematic, high-quality.`;

export const buildLocationPreviewPrompt = (loc: Location) => {
  return (
    `Cinematic environment concept art. ${baseRules()}\n` +
    `Name: ${loc.name}\n` +
    `Description: ${loc.description}\n` +
    `VisualStyle: ${loc.visualStyle}\n`
  );
};

export const buildCharacterAvatarPrompt = (ch: Character) => {
  return (
    `Cinematic character portrait (headshot). ${baseRules()}\n` +
    `Name: ${ch.name}\n` +
    `Description: ${ch.description}\n`
  );
};

export const buildCharacterLookPrompt = (ch: Character, look: CharacterLook) => {
  return (
    `Cinematic character look reference. ${baseRules()}\n` +
    `Character: ${ch.name}\n` +
    `CharacterDescription: ${ch.description}\n` +
    `LookName: ${look.name}\n` +
    `LookDescription: ${look.description}\n`
  );
};
