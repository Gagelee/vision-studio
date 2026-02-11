import { describe, expect, it } from 'vitest';
import { buildActingDirection, composeStructuredVideoPrompt, resolveVideoSourceBundle } from './videoPromptComposer';

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
    expect(out.prompt.indexOf('Action & Performance Beats:')).toBeLessThan(out.prompt.indexOf('Current Frame:'));
    expect(out.sectionsUsed.includes('style_lock')).toBe(true);
    expect(out.prompt.includes('Story Context:')).toBe(false);
    expect(out.prompt.includes('Dialogue:')).toBe(false);
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

  it('dummy case emphasizes action beats and keeps style minimal', () => {
    const out = composeStructuredVideoPrompt({
      sourceKind: 'single',
      frameDescription: 'A detective stands in a rain-soaked alley, hand hovering near coat pocket.',
      storyContext: 'He spots the suspect behind a flickering neon sign and decides whether to approach.',
      actingDirection:
        'Beat 1: pause, shallow inhale, eyes lock on suspect. Beat 2: left foot slides forward, shoulders tighten, right hand opens coat. Beat 3: brief hesitation, jaw clenches, then decisive step into light.',
      cameraPrompt: 'Start over-shoulder medium shot, then slow lateral move to reveal suspect profile, end in close-up on detective reaction.',
      lightingPrompt: 'Preserve wet pavement reflections and neon spill; no dramatic relight.',
      style: 'Neo-noir cinematic',
      styleTranslation: 'high-contrast city night',
      dialogue: ['Stop right there.'],
      constraints: ['No unrealistic speed changes.', 'Preserve costume continuity.'],
      maxChars: 5000,
    });
    expect(out.prompt.includes('Action & Performance Beats:')).toBe(true);
    expect(out.prompt.includes('Look Lock (Minimal):')).toBe(true);
    expect(out.prompt.includes('Story Context:')).toBe(false);
    expect(out.prompt.includes('Dialogue:')).toBe(false);
    expect(out.prompt.includes('Audio Cues:')).toBe(false);
    expect(out.prompt.includes('Style Translation Hints:')).toBe(false);
    expect(out.prompt.includes('Visual style:')).toBe(false);
  });

  it('stack/grid mode promotes grid continuity over single frame restatement', () => {
    const out = composeStructuredVideoPrompt({
      sourceKind: 'stack',
      referenceFrames: [
        { panelIndex: 0, url: '/f1.png', description: 'Kaelen scans the terminal and freezes.' },
        { panelIndex: 1, url: '/f2.png', description: 'He pivots left and reaches for sidearm.' },
        { panelIndex: 2, url: '/f3.png', description: 'He commits to a forward step into hard blue light.' },
      ],
      frameDescription: 'Single frame fallback',
      actingDirection: 'Beat 1: scan. Beat 2: pivot. Beat 3: step.',
      cameraPrompt: 'Low angle with aggressive parallax move.',
      style: 'Sterile tech-noir',
      constraints: ['Preserve identity continuity.'],
    });
    expect(out.prompt.includes('Grid Beat Continuity:')).toBe(true);
    expect(out.prompt.includes('Current Frame:')).toBe(false);
    expect(out.prompt.indexOf('Action & Performance Beats:')).toBeLessThan(out.prompt.indexOf('Grid Beat Continuity:'));
  });

  it('does not emit generic frame fallback text for stack continuity', () => {
    const out = composeStructuredVideoPrompt({
      sourceKind: 'stack',
      referenceFrames: [
        { panelIndex: 0, url: '/f1.png', description: '' },
        { panelIndex: 1, url: '/f2.png', description: '' },
        { panelIndex: 2, url: '/f3.png', description: '' },
      ],
      frameDescription: 'Chen fires three shots while Lina escapes into fog.',
      actingDirection:
        'Beat 1: muzzle flashes cut through heavy rain. Intent: focused dramatic tension.\n' +
        'Beat 2: Chen fires three shots. Intent: focused dramatic tension.\n' +
        'Beat 3: The enforcer absorbs impact as Lina flees into fog. Intent: focused dramatic tension.',
      cameraPrompt: 'Static high-contrast shot',
    });
    expect(out.prompt.includes('follow visual continuity from this frame.')).toBe(false);
  });
});

describe('videoPromptComposer.buildActingDirection', () => {
  it('formats acting direction in screenplay-like beats with dialogue cues', () => {
    const out = buildActingDirection({
      frameDescription: 'Rainy alley stand-off.',
      script: 'LINA: Don\'t die, Detective!\nChen raises his pistol.',
      shotDescription: 'Chen confronts the enforcer.',
      sequenceContext: '',
      dialogue: ['Don\'t die, Detective!'],
      sourceKind: 'stack',
      referenceFrames: [{ panelIndex: 0, url: '/f1.png', description: 'Chen raises pistol under neon rain.' }],
    });
    expect(out.includes('Action:')).toBe(true);
    expect(out.includes('Performance:')).toBe(true);
    expect(out.includes('Dialogue:')).toBe(true);
    expect(out.includes('LINA: "Don\'t die, Detective!"')).toBe(true);
  });
});
