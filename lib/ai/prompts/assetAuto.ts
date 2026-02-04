import type { Character, CharacterLook, Location } from '../../../types';

const baseRules = () => `No text. No watermark. No logos. Cinematic, high-quality.`;

const styleBlock = (styleGuide?: string) => {
  const s = String(styleGuide || '').trim();
  if (!s) return '';
  return `StyleGuide (apply to rendering, palette, lighting, camera feel):\n${s}\n`;
};

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

export const buildLocationPreviewPrompt = (loc: Location, styleGuide?: string) => {
  return (
    `Cinematic environment concept art. ${baseRules()}\n` +
    styleBlock(styleGuide) +
    `Name: ${loc.name}\n` +
    `Description: ${loc.description}\n` +
    `VisualStyle: ${loc.visualStyle}\n`
  );
};

export const buildCharacterAvatarPrompt = (ch: Character, styleGuide?: string) => {
  return (
    `Character reference sheet (clean, standard, consistent). ${baseRules()}\n` +
    styleBlock(styleGuide) +
    `Format: 2x2 model sheet on a plain light/neutral background, consistent scale.\n` +
    `Views: front face (neutral), 3/4 face, profile, full-body front. Same exact person across all views.\n` +
    `Identity: lock facial proportions, age, ethnicity, eye shape, jawline, hairline, and unique identifying details.\n` +
    `Outfit: simple neutral outfit (unless explicitly required), avoid accessories that obscure face.\n` +
    `Lighting: soft studio lighting, true-to-life colors, sharp focus. No dramatic stylization.\n` +
    `Framing: leave margins; ensure face and body are not cropped.\n` +
    `Name: ${ch.name}\n` +
    `CharacterDescription: ${ch.description}\n`
  );
};

export const buildCharacterLookPrompt = (ch: Character, look: CharacterLook, styleGuide?: string) => {
  return (
    `Character look reference sheet (clean, consistent identity). ${baseRules()}\n` +
    styleBlock(styleGuide) +
    `Format: full-body front (preferred), neutral background, sharp focus.\n` +
    `Identity: MUST match the provided base avatar reference exactly (same person, same face).\n` +
    `Do NOT change facial structure, age, ethnicity, eye/hair color unless explicitly required by LookDescription.\n` +
    `Character: ${ch.name}\n` +
    `CharacterDescription: ${ch.description}\n` +
    `LookName: ${look.name}\n` +
    `LookDescription: ${look.description}\n`
  );
};
