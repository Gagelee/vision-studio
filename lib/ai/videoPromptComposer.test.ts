import { describe, expect, it } from 'vitest';
import { composeStructuredVideoPrompt, resolveVideoSourceBundle } from './videoPromptComposer';

describe('videoPromptComposer.resolveVideoSourceBundle', () => {
  it('prefers refine description over shot description for single frame', () => {
    const shot: any = { description: 'fallback scene description' };
    const activeVersion: any = {
      type: 'grid_panel',
      imageUrl: '/__generated__/frame.png',
      metadata: {
        refine: { describe: { description: 'refined frame description' } },
      },
    };
    const out = resolveVideoSourceBundle(shot, activeVersion);
    expect(out.sourceKind).toBe('single');
    expect(out.frameDescription).toBe('refined frame description');
    expect(out.sourceImageUrl).toBe('/__generated__/frame.png');
  });
});

describe('videoPromptComposer.composeStructuredVideoPrompt', () => {
  it('keeps section order stable and deduplicates repeated content', () => {
    const out = composeStructuredVideoPrompt({
      sourceKind: 'single',
      frameDescription: 'A woman sits by the window, rain outside.',
      storyContext: 'A woman sits by the window, rain outside.',
      actingDirection: 'Beat 1: subtle inhale, held gaze, restrained sorrow.',
      cameraPrompt: 'Slow push-in to close-up.',
      lightingPrompt: 'Soft window backlight, cool shadows.',
      style: 'Cinematic live-action realism.',
      styleTranslation: 'Cinematic live-action realism.',
      dialogue: ['I am still here.'],
      constraints: ['No watermark.'],
      maxChars: 5000,
    });
    expect(out.prompt.indexOf('Objective:')).toBeLessThan(out.prompt.indexOf('Current Frame:'));
    expect(out.prompt.indexOf('Current Frame:')).toBeLessThan(out.prompt.indexOf('Acting Direction:'));
    expect(out.sectionsUsed.includes('style')).toBe(true);
    expect(out.prompt.includes('No watermark.')).toBe(true);
  });

  it('drops optional sections before trimming when over budget', () => {
    const long = 'x'.repeat(1200);
    const out = composeStructuredVideoPrompt({
      sourceKind: 'stack',
      referenceFrames: [
        { url: '/a.png', description: long, panelIndex: 0 },
        { url: '/b.png', description: long, panelIndex: 1 },
      ],
      frameDescription: long,
      storyContext: long,
      actingDirection: long,
      cameraPrompt: long,
      lightingPrompt: long,
      audioPrompt: long,
      style: long,
      styleTranslation: long,
      dialogue: [long, long],
      directorNotes: long,
      maxChars: 2400,
    });
    expect(out.prompt.length).toBeLessThanOrEqual(2400);
    expect(out.droppedSections.length).toBeGreaterThan(0);
  });
});

