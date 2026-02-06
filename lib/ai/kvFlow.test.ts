import { describe, expect, it } from 'vitest';
import {
  buildStyleGuideSynthesisMessage,
  extractStyleGuideCandidate,
  mergeKvPromptWithReferenceHints,
  normalizeStyleGuideText,
} from './kvFlow';

const baseStory = {
  id: 'p1',
  title: 't',
  logline: 'l',
  intent: '梁山伯与祝英台',
  styleGuide:
    'Genre: Historical Romance / Folklore.\nVisual Style: Traditional Chinese Ink Wash painting aesthetic, watercolor textures.\nConstraints: No modern elements.',
  aspectRatio: '16:9',
  status: 'ready',
  locations: [],
  characters: [],
  sequences: [],
} as any;

describe('kvFlow.normalizeStyleGuideText', () => {
  it('normalizes markdown wrapper and keeps meaningful lines', () => {
    const raw = '```text\nHere is the style guide:\n- Line A\n- Line B\n- Line C\n- Line D\n```';
    const out = normalizeStyleGuideText(raw);
    expect(out).toContain('- Line A');
    expect(out).toContain('- Line D');
  });
});

describe('kvFlow.mergeKvPromptWithReferenceHints', () => {
  it('keeps base prompt and appends hints instead of replacing', () => {
    const base = 'Master Key Visual...\nStyleGuide: ink wash.';
    const merged = mergeKvPromptWithReferenceHints(base, 'Subject: two lovers under lantern.');
    expect(merged).toContain('StyleGuide: ink wash.');
    expect(merged).toContain('Composition hints');
    expect(merged).toContain('two lovers');
  });
});

describe('kvFlow.extractStyleGuideCandidate', () => {
  it('prefers UPDATE_STORY.patch.styleGuide from actions', () => {
    const res = {
      actions: [{ type: 'UPDATE_STORY', payload: { patch: { styleGuide: '- A\n- B\n- C\n- D' } } }],
      reply: 'ignore',
    };
    const out = extractStyleGuideCandidate({ response: res, story: baseStory });
    expect(out).toBe('- A\n- B\n- C\n- D');
  });

  it('falls back to current story styleGuide and never returns cyberpunk default', () => {
    const res = { reply: 'ok', actions: [] };
    const out = extractStyleGuideCandidate({ response: res, story: baseStory });
    expect(out).toContain('Traditional Chinese Ink Wash');
    expect(out.toLowerCase()).not.toContain('cyberpunk');
  });
});

describe('kvFlow.buildStyleGuideSynthesisMessage', () => {
  it('pins synthesis to KV prompt source of truth', () => {
    const msg = buildStyleGuideSynthesisMessage('KV Prompt: ink wash + watercolor');
    expect(msg).toContain('primary source of truth');
    expect(msg).toContain('KV Prompt:');
    expect(msg).toContain('ink wash');
  });
});
