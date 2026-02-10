import { describe, expect, it } from 'vitest';
import { computeGridPanelBBoxes } from './gridSplit';

describe('computeGridPanelBBoxes', () => {
  it('returns 4 panels for 2x2', () => {
    const panels = computeGridPanelBBoxes({ panelCount: 4, insetPct: 0 });
    expect(panels).toHaveLength(4);
    expect(panels[0].bbox).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5, unit: 'norm' });
    expect(panels[3].bbox).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5, unit: 'norm' });
  });

  it('returns 9 panels for 3x3', () => {
    const panels = computeGridPanelBBoxes({ panelCount: 9, insetPct: 0 });
    expect(panels).toHaveLength(9);
    expect(panels[0].bbox).toEqual({ x: 0, y: 0, w: 1 / 3, h: 1 / 3, unit: 'norm' });
    expect(panels[8].bbox).toEqual({ x: 2 / 3, y: 2 / 3, w: 1 / 3, h: 1 / 3, unit: 'norm' });
  });

  it('applies inset', () => {
    const inset = 0.06;
    const panels = computeGridPanelBBoxes({ panelCount: 4, insetPct: inset });
    expect(panels[0].bbox.x).toBeCloseTo(0.5 * inset, 6);
    expect(panels[0].bbox.y).toBeCloseTo(0.5 * inset, 6);
    expect(panels[0].bbox.w).toBeCloseTo(0.5 - 2 * 0.5 * inset, 6);
    expect(panels[0].bbox.h).toBeCloseTo(0.5 - 2 * 0.5 * inset, 6);
  });
});

