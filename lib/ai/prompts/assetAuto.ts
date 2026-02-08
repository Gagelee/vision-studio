import type { Character, CharacterLook, Location } from '../../../types';

const baseRulesCinematic = () =>
  `No text. No watermark. No logos. High-quality single key visual. Follow the declared rendering medium/style strictly. Do not drift to generic photoreal/CGI unless requested.`;
const baseRulesReference = () => `No text. No watermark. No logos. Clean studio reference. Sharp focus. High-quality.`;

const styleBlock = (styleGuide?: string) => {
  const s = String(styleGuide || '').trim();
  if (!s) return '';
  return `StyleGuide (apply to rendering, palette, lighting, camera feel):\n${s}\n`;
};

const normalizeStyleGuideForReference = (styleGuide?: string) => {
  const raw = String(styleGuide || '').trim();
  if (!raw) return '';
  const lines = raw
    .split('\n')
    .map((x) => x.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean);
  const keep = lines.filter((line) =>
    /(render|style|medium|palette|color|tone|texture|contrast|grain|brush|realistic|photoreal|anime|ink|oil|watercolor)/i.test(line),
  );
  const picked = (keep.length ? keep : lines).slice(0, 6);
  if (!picked.length) return '';
  return picked.join('; ');
};

export const buildMasterKeyVisualPrompt = (args: { intent?: string; logline?: string }) => {
  const intent = String(args.intent || '').trim();
  const logline = String(args.logline || '').trim();
  const styleGuide = String((args as any)?.styleGuide || '').trim();
  return (
    `Master Key Visual (KV) for a film project. ${baseRulesCinematic()}\n` +
    `High-level goal: a single iconic, consistent visual constitution that all assets should follow.\n` +
    (styleGuide ? styleBlock(styleGuide) : '') +
    `Medium lock: preserve declared medium/texture language. Avoid glossy 3D-render look unless explicitly requested.\n` +
    `Style requirements: cohesive palette, consistent visual language, stable medium/texture/lighting intent. Avoid drastic style shifts.\n` +
    (intent ? `Intent: ${intent}\n` : '') +
    (logline ? `Logline: ${logline}\n` : '')
  );
};

export const buildLocationPreviewPrompt = (loc: Location, styleGuide?: string) => {
  return (
    `Environment keyframe still for production continuity. ${baseRulesCinematic()}\n` +
    styleBlock(styleGuide) +
    `Name: ${loc.name}\n` +
    `Description: ${loc.description}\n` +
    `VisualStyle: ${loc.visualStyle}\n`
  );
};

export const buildCharacterAvatarPrompt = (ch: Character, styleGuide?: string) => {
  const refStyle = normalizeStyleGuideForReference(styleGuide);
  return (
    `Character reference sheet (clean, standard, consistent). ${baseRulesReference()}\n` +
    (refStyle ? `Style adaptation for reference sheet (use only rendering medium/palette/texture; keep neutral studio setup): ${refStyle}\n` : '') +
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
  const refStyle = normalizeStyleGuideForReference(styleGuide);
  return (
    `Character LOOK reference sheet (wardrobe/state), clean identity lock. ${baseRulesReference()}\n` +
    (refStyle ? `Style adaptation for look sheet (apply ONLY rendering medium/palette/texture; keep neutral studio lighting): ${refStyle}\n` : '') +
    `Format: 2x2 model sheet on a plain light/neutral background, consistent scale.\n` +
    `Views: full-body front, full-body 3/4, profile, head-and-shoulders close-up.\n` +
    `Identity lock: MUST match the provided base avatar reference exactly (same person, same face).\n` +
    `This LOOK must be a meaningful visual state change: wardrobe/hair/makeup/accessories and/or facial/physical state (e.g., injured, tired, beard, wet hair). Not a change of location or time-of-day.\n` +
    `Avoid atmosphere: no dramatic lighting, no environment, no cinematic staging. This is for accurate reference.\n` +
    `Do NOT change facial structure, age, ethnicity, eye/hair color unless explicitly required by LookDescription.\n` +
    `Character: ${ch.name}\n` +
    `CharacterDescription: ${ch.description}\n` +
    `LookName: ${look.name}\n` +
    `LookDescription: ${look.description}\n`
  );
};
