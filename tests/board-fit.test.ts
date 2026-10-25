import { describe, expect, it } from 'vitest'

import { MIN_FIT_TILE_HEIGHT, fitBoardGrid, fittedTileMetrics } from '@/components/board-fit'

describe('fitted live board (tablets, no page scroll)', () => {
  it('fits 12 players on a 14" landscape centre column', () => {
    const fit = fitBoardGrid({ count: 12, width: 890, height: 840, gap: 12 })
    expect(fit.fits).toBe(true)
    expect(fit.columns * fit.rows).toBeGreaterThanOrEqual(12)
    expect(fit.rows * fit.tileHeight + (fit.rows - 1) * 12).toBeLessThanOrEqual(840)
    expect(fit.columns * fit.tileWidth + (fit.columns - 1) * 12).toBeLessThanOrEqual(890)
  })

  it('fits 12 players in portrait', () => {
    const fit = fitBoardGrid({ count: 12, width: 540, height: 1450, gap: 12 })
    expect(fit.fits).toBe(true)
    expect(fit.columns).toBe(2)
  })

  it('keeps few players from becoming towers', () => {
    const fit = fitBoardGrid({ count: 2, width: 900, height: 900, gap: 12 })
    expect(fit.tileHeight).toBeLessThanOrEqual(Math.floor(fit.tileWidth * 1.1))
  })

  it('falls back to inner scrolling when too many players', () => {
    const fit = fitBoardGrid({ count: 30, width: 600, height: 500, gap: 12 })
    expect(fit.fits).toBe(false)
    expect(fit.tileHeight).toBe(MIN_FIT_TILE_HEIGHT)
    expect(fit.columns).toBe(3)
  })

  it('keeps the + button at least 64 dp', () => {
    expect(fittedTileMetrics(208).buttonHeight).toBe(64)
    expect(fittedTileMetrics(400).buttonHeight).toBe(112)
    const small = fittedTileMetrics(MIN_FIT_TILE_HEIGHT)
    // padding + name row + counter + label + buttons must fit the minimum tile.
    expect(small.padding * 2 + 40 + small.countLineHeight + 14 + small.buttonHeight + 16).toBeLessThanOrEqual(MIN_FIT_TILE_HEIGHT)
  })
})
