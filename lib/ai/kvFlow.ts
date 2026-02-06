import type { Story } from '../../types';

export const normalizeStyleGuideText = (raw: string) => {
  const t = String(raw || '').trim();
  if (!t) return '';
  const noPreface = t
    .replace(/^```[\s\S]*?\n/, '')
    .replace(/```$/g, '')
    .replace(/^I\s+(have\s+)?(synthesized|created|generated|prepared)[^.]*\.\s*/i, '')
    .replace(/^Here\s+is\s+(the\s+)?(style\s+guide|proposal)[^:]*:\s*/i, '')
    .trim();
  const lines = noPreface
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((line) => !/^\-\s*core visual direction:\s*i\s+(have|am|will)\b/i.test(line))
    .filter((line) => !/^i\s+(have|am|will|can)\b/i.test(line));
  if (lines.length >= 4) return lines.join('\n');
  const sentenceLines = noPreface
    .split(/[.;]\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith('-') ? s : `- ${s.replace(/[.]+$/, '')}.`));
  if (sentenceLines.length >= 3) return sentenceLines.join('\n');
  return '';
};

export const extractStyleGuideCandidate = (args: {
  response: any;
  story: Story;
}) => {
  const { response, story } = args;
  const fromAction = (Array.isArray(response?.actions) ? response.actions : [])
    .map((a: any) => (a?.type === 'UPDATE_STORY' ? a?.payload?.patch?.styleGuide || a?.payload?.styleGuide : ''))
    .find((x: any) => typeof x === 'string' && String(x).trim());
  const normalizedAction = normalizeStyleGuideText(String(fromAction || ''));
  if (normalizedAction) return normalizedAction;
  const normalizedReply = normalizeStyleGuideText(String(response?.reply || ''));
  if (normalizedReply) return normalizedReply;
  const currentStyle = String((story as any)?.styleGuide || '').trim();
  if (currentStyle) return currentStyle;
  return [
    `- Core visual direction should stay consistent with current story intent.`,
    `- Preserve stable rendering medium, palette, and lighting logic across assets.`,
    `- Maintain character and environment continuity; avoid abrupt style drift.`,
    `- Negative constraints: no logos, no watermarks, no text artifacts.`,
  ].join('\n');
};

export const mergeKvPromptWithReferenceHints = (basePrompt: string, distilledHints: string) => {
  const base = String(basePrompt || '').trim();
  const hints = String(distilledHints || '').trim();
  if (!hints) return base;
  return `${base}\nComposition hints from uploaded references (must obey StyleGuide above):\n${hints}\n`;
};

export const buildStyleGuideSynthesisMessage = (promptUsed: string) =>
  [
    'Produce a concise production-ready style guide aligned with the active Master KV.',
    'Use the KV prompt as primary source of truth; do not invent a different rendering medium.',
    'If there is any conflict, keep rendering medium/texture/palette constraints from KV prompt.',
    'Respond with exactly one UPDATE_STORY action that only sets patch.styleGuide.',
    `KV Prompt:\n${String(promptUsed || '').trim()}`,
  ].join('\n');
