import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-crypto', async () => (await import('./support/memory-sqlite')).cryptoMock)
vi.mock('@/db/client', async () => (await import('./support/memory-sqlite')).clientMock)

import {
  buildBalanceTimeline,
  buildCumulativeLossSeries,
  buildDashboardCharts,
  getDashboardCharts,
  getEveningTotals,
  getSeasonLossSeries,
  getSessionListCharts,
  groupBySession,
  type EveningTotal,
  type MoneyEvent,
} from '@/db/chart-queries'
import { ensureDatabaseReady, resetBootstrapFlag } from '@/db/bootstrap'
import {
  addBeerRoundEntry,
  addLossEntry,
  closeSession,
  createPlayer,
  createSession,
  getCashboxSummary,
  recordPayment,
  toggleAttendance,
  updateAppSettings,
} from '@/db/queries'
import { createMemoryDatabase, memory } from './support/memory-sqlite'

const actor = { accountId: 'acc_test', username: 'Test' }
const label = (iso: string) => iso.slice(5, 10)

function evening(id: string, startedAt: string, lossCents: number, status: 'open' | 'closed' = 'closed', absenceCents = 0): EveningTotal {
  return { sessionId: id, title: id, status, startedAt, closedAt: status === 'closed' ? startedAt.replace('T19', 'T23') : null, presentCount: 3, lossCount: lossCents / 100, lossCents, beerRoundCents: 0, absenceCents }
}

describe('buildBalanceTimeline', () => {
  const events: MoneyEvent[] = [
    { at: '2026-01-01T20:00:00Z', kind: 'charge', amountCents: 500 },
    { at: '2026-01-02T10:00:00Z', kind: 'payment', amountCents: 200 },
    { at: '2026-01-08T20:00:00Z', kind: 'charge', amountCents: 300 },
  ]

  it('samples running cash and open debt at each checkpoint (inclusive)', () => {
    expect(buildBalanceTimeline(events, ['2026-01-01T20:00:00Z', '2026-01-05T00:00:00Z', '2026-01-09T00:00:00Z'])).toEqual([
      { at: '2026-01-01T20:00:00Z', paidCents: 0, openCents: 500 },
      { at: '2026-01-05T00:00:00Z', paidCents: 200, openCents: 300 },
      { at: '2026-01-09T00:00:00Z', paidCents: 200, openCents: 600 },
    ])
  })

  it('is independent of input order and handles no checkpoints', () => {
    expect(buildBalanceTimeline([...events].reverse(), ['2026-01-03T00:00:00Z'])[0]).toMatchObject({ paidCents: 200, openCents: 300 })
    expect(buildBalanceTimeline(events, [])).toEqual([])
  })
})

describe('buildDashboardCharts', () => {
  it('ends every series with the authoritative KPI value and ignores open evenings', () => {
    const evenings = [
      evening('a', '2026-01-01T19:00:00Z', 400),
      evening('b', '2026-01-08T19:00:00Z', 200, 'closed', 150),
      evening('c', '2026-01-15T19:00:00Z', 900, 'open'),
    ]
    const events: MoneyEvent[] = [
      { at: '2026-01-01T20:00:00Z', kind: 'charge', amountCents: 400 },
      { at: '2026-01-05T20:00:00Z', kind: 'payment', amountCents: 100 },
    ]
    const charts = buildDashboardCharts(evenings, events, { paidCents: 100, openCents: 1234 }, label)
    expect(charts.cashSeries).toEqual([0, 100, 100])
    expect(charts.debtSeries).toEqual([400, 300, 1234])
    expect(charts.recentLossSeries).toEqual([400, 200])
    expect(charts.recentLossCents).toBe(600)
    expect(charts.recentEveningCount).toBe(2)
    expect(charts.trend).toEqual({ labels: ['01-01', '01-08'], lossCents: [400, 200], absenceCents: [0, 150] })
  })

  it('keeps only the last five evenings for the loss KPI', () => {
    const evenings = Array.from({ length: 7 }, (_, index) => evening(`e${index}`, `2026-02-0${index + 1}T19:00:00Z`, (index + 1) * 100))
    const charts = buildDashboardCharts(evenings, [], { paidCents: 0, openCents: 0 }, label)
    expect(charts.recentLossSeries).toEqual([300, 400, 500, 600, 700])
  })
})

describe('buildCumulativeLossSeries', () => {
  it('accumulates per player and keeps the top N', () => {
    const series = buildCumulativeLossSeries(
      ['s1', 's2', 's3'],
      [
        { sessionId: 's1', playerId: 'a', lossCount: 2, lossCents: 200 },
        { sessionId: 's3', playerId: 'a', lossCount: 1, lossCents: 100 },
        { sessionId: 's2', playerId: 'b', lossCount: 5, lossCents: 500 },
        { sessionId: 'other', playerId: 'c', lossCount: 9, lossCents: 900 },
      ],
      [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Cem' }],
      2
    )
    expect(series).toEqual([
      { playerId: 'b', playerName: 'Ben', points: [0, 500, 500], totalCents: 500 },
      { playerId: 'a', playerName: 'Anna', points: [200, 200, 300], totalCents: 300 },
    ])
  })
})

describe('groupBySession', () => {
  it('sorts players by amount within an evening', () => {
    const grouped = groupBySession([
      { sessionId: 's', playerId: 'a', playerName: 'A', lossCount: 1, totalCents: 100 },
      { sessionId: 's', playerId: 'b', playerName: 'B', lossCount: 3, totalCents: 300 },
    ])
    expect(grouped.get('s')!.map((row) => row.playerId)).toEqual(['b', 'a'])
  })
})

describe('chart SQL', () => {
  it('reads evening totals, breakdowns and season series from a real database', () => {
    memory.current = createMemoryDatabase()
    resetBootstrapFlag()
    ensureDatabaseReady()
    memory.current.runSync(
      "INSERT INTO auth_accounts (id, username, password_hash, password_salt, created_at, updated_at) VALUES ('acc_test', 'Test', '-', '-', '2026-01-01', '2026-01-01')"
    )
    updateAppSettings({ actor, defaultStakeCents: 100, cashboxLabel: 'Kasse', absencePenaltyMode: 'full_average' })
    const [anna, ben, cem] = ['Anna', 'Ben', 'Cem'].map((name) => createPlayer({ actor, name, isCore: true }))

    const first = createSession({ actor, title: 'Eins', notes: null, stakeCents: 100 })
    toggleAttendance({ actor, sessionId: first, playerId: cem })
    addLossEntry({ actor, sessionId: first, playerId: anna, note: null })
    addLossEntry({ actor, sessionId: first, playerId: anna, note: null })
    addLossEntry({ actor, sessionId: first, playerId: ben, note: null })
    addBeerRoundEntry({ actor, sessionId: first, playerId: ben, amountCents: 500, note: null })
    closeSession({ actor, sessionId: first })
    recordPayment({ actor, playerId: anna, amountCents: 200, note: null, sessionId: null })

    const second = createSession({ actor, title: 'Zwei', notes: null, stakeCents: 100 })
    addLossEntry({ actor, sessionId: second, playerId: cem, note: null })

    const evenings = getEveningTotals()
    expect(evenings.map((row) => [row.title, row.status, row.lossCount, row.lossCents, row.beerRoundCents])).toEqual([
      ['Eins', 'closed', 3, 300, 500],
      ['Zwei', 'open', 1, 100, 0],
    ])
    // Cem was absent: average of the present regulars (300 / 2).
    expect(evenings[0].absenceCents).toBe(150)
    expect(evenings[0].presentCount).toBe(2)

    const list = getSessionListCharts()
    expect(list.breakdown.get(first)!.map((row) => [row.playerName, row.lossCount, row.totalCents])).toEqual([
      ['Ben', 1, 600],
      ['Anna', 2, 200],
    ])
    expect(list.totals).toEqual([800])

    const cashbox = getCashboxSummary()
    const dashboard = getDashboardCharts({ paidCents: cashbox.totalPaymentsCents, openCents: cashbox.totalOutstandingCents }, label)
    expect(dashboard.cashSeries[dashboard.cashSeries.length - 1]).toBe(200)
    expect(dashboard.debtSeries[dashboard.debtSeries.length - 1]).toBe(cashbox.totalOutstandingCents)
    expect(dashboard.recentLossSeries).toEqual([300])

    const season = getSeasonLossSeries(null, label)
    expect(season.labels).toHaveLength(1)
    expect(season.series.map((row) => [row.playerName, row.points])).toEqual([
      ['Anna', [200]],
      ['Ben', [100]],
    ])
    expect(getSeasonLossSeries('1999', label).series).toEqual([])
  })
})

describe('chart labels', () => {
  it('numbers evenings that share a date', async () => {
    const { disambiguateLabels } = await import('@/db/chart-queries')
    expect(disambiguateLabels(['15.03.', '15.03.', '15.03.', '22.03.'])).toEqual(['15.03.', '15.03. #2', '15.03. #3', '22.03.'])
  })
})
