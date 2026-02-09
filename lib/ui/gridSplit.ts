export type GridPanelCount = 4 | 9;

export type NormalizedBBox = { x: number; y: number; w: number; h: number; unit: 'norm' };

export type GridPanel = {
  index: number; // row-major
  row: number;
  col: number;
  bbox: NormalizedBBox;
};

export const gridDims = (panelCount: GridPanelCount) => {
  return panelCount === 9 ? { rows: 3, cols: 3 } : { rows: 2, cols: 2 };
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// Deterministic bbox computation for splitting a strict 2x2 or 3x3 contact sheet.
// `insetPct` trims each cell inward to avoid gutters/borders (e.g. 0.03 => 3% per side).
export const computeGridPanelBBoxes = (args: {
  panelCount: GridPanelCount;
  insetPct?: number;
}): GridPanel[] => {
  const { rows, cols } = gridDims(args.panelCount);
  const insetPct = Number.isFinite(Number(args.insetPct)) ? clamp01(Number(args.insetPct)) : 0.03;
  const cellW = 1 / cols;
  const cellH = 1 / rows;
  const insetX = cellW * insetPct;
  const insetY = cellH * insetPct;

  const out: GridPanel[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const index = r * cols + c;
      const x = clamp01(c * cellW + insetX);
      const y = clamp01(r * cellH + insetY);
      const w = clamp01(cellW - 2 * insetX);
      const h = clamp01(cellH - 2 * insetY);
      out.push({ index, row: r, col: c, bbox: { x, y, w, h, unit: 'norm' } });
    }
  }
  return out;
};

