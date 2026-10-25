/**
 * Fits the live-board tiles into a fixed area (tablets, no page scroll).
 * Pure – unit-tested in tests/board-fit.test.ts.
 */
export type BoardFit = {
  columns: number
  rows: number
  tileWidth: number
  tileHeight: number
  /** false: even the best grid is below the minimum tile size → scroll inside the board. */
  fits: boolean
}

export const MIN_FIT_TILE_WIDTH = 150
/** Name row + counter + 64 dp buttons + padding. */
export const MIN_FIT_TILE_HEIGHT = 208

export function fitBoardGrid(input: {
  count: number
  width: number
  height: number
  gap: number
  minTileWidth?: number
  minTileHeight?: number
  maxColumns?: number
  /** Tiles never get taller than width × this (few players → no towers). */
  maxAspect?: number
}): BoardFit {
  const { count, width, height, gap } = input
  const minW = input.minTileWidth ?? MIN_FIT_TILE_WIDTH
  const minH = input.minTileHeight ?? MIN_FIT_TILE_HEIGHT
  const maxColumns = Math.max(1, Math.min(input.maxColumns ?? 6, count || 1))
  const maxAspect = input.maxAspect ?? 1.1
  let best: (BoardFit & { score: number }) | null = null

  for (let columns = 1; columns <= maxColumns; columns++) {
    const rows = Math.ceil(Math.max(count, 1) / columns)
    const tileWidth = Math.floor((width - gap * (columns - 1)) / columns)
    const rawHeight = Math.floor((height - gap * (rows - 1)) / rows)
    const tileHeight = Math.min(rawHeight, Math.floor(tileWidth * maxAspect))
    if (tileWidth < minW || tileHeight < minH) continue
    // Prefer the biggest, roughly landscape tile; ties → fewer columns.
    const score = Math.min(tileWidth, tileHeight * 1.25)
    if (!best || score > best.score) best = { columns, rows, tileWidth, tileHeight, fits: true, score }
  }

  if (best) {
    const { score: _score, ...fit } = best
    return fit
  }
  // Fallback: as many columns as the width allows, minimum height, inner scroll.
  const columns = Math.max(1, Math.min(maxColumns, Math.floor((width + gap) / (minW + gap))))
  return {
    columns,
    rows: Math.ceil(Math.max(count, 1) / columns),
    tileWidth: Math.floor((width - gap * (columns - 1)) / columns),
    tileHeight: minH,
    fits: false,
  }
}

/** Counter font and button height for a fitted tile (+ stays ≥ 64 dp). */
export function fittedTileMetrics(tileHeight: number) {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
  const buttonHeight = clamp(Math.round(tileHeight * 0.3), 64, 112)
  const countSize = clamp(Math.round(tileHeight * 0.2), 34, 104)
  return {
    buttonHeight,
    countSize,
    countLineHeight: Math.round(countSize * 1.04),
    padding: tileHeight < 240 ? 12 : 16,
    avatarSize: clamp(Math.round(tileHeight * 0.16), 32, 52),
    plusIcon: clamp(Math.round(buttonHeight * 0.55), 30, 56),
    minusIcon: clamp(Math.round(buttonHeight * 0.4), 22, 40),
  }
}
