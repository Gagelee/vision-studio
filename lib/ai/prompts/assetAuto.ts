import type { Character, CharacterLook, Location } from '../../../types';

const baseRules = () => `No text. No watermark. No logos. Cinematic, high-quality.`;

export const buildMasterKeyVisualPrompt = (args: { intent?: string; logline?: string }) => {
  const intent = String(args.intent || '').trim();
  const logline = String(args.logline || '').trim();
  return (
    `Master Key Visual (KV) for a film project. ${baseRules()}\n` +
    `High-level goal: a single iconic, consistent visual constitution that all assets should follow.\n` +
    `Style requirements: cohesive palette, consistent lens language, cinematic lighting. Avoid drastic style shifts.\n` +
    (intent ? `Intent: ${intent}\n` : '') +
    (logline ? `Logline: ${logline}\n` : '')
  );
};

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
    `Character reference sheet (clean, standard, consistent). ${baseRules()}\n` +
    `Format: 2x2 model sheet on a plain light/neutral background, consistent scale.\n` +
    `Views: front face (neutral), 3/4 face, profile, full-body front. Same outfit across views.\n` +
    `Lighting: soft studio lighting, true-to-life colors, sharp focus. No dramatic stylization.\n` +
    `Framing: leave margins; ensure face and body are not cropped.\n` +
    `Name: ${ch.name}\n` +
    `CharacterDescription: ${ch.description}\n`
  );
};

export const buildCharacterLookPrompt = (ch: Character, look: CharacterLook) => {
  return (
    `Character look reference sheet (clean, consistent identity). ${baseRules()}\n` +
    `Format: full-body front (preferred), neutral background, sharp focus.\n` +
    `Identity: must match the provided base avatar reference exactly.\n` +
    `Character: ${ch.name}\n` +
    `CharacterDescription: ${ch.description}\n` +
    `LookName: ${look.name}\n` +
    `LookDescription: ${look.description}\n`
  );
};
