import fs from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { buildDemoSnapshot } from '../scripts/demo-data'
import { createTestServer, tempFile } from './helpers'

let server: Awaited<ReturnType<typeof createTestServer>>

afterEach(() => server?.cleanup())

async function setup() {
  server = await createTestServer()
  const { token } = await server.pair()
  const file = tempFile('snap.sqlite')
  const ids = buildDemoSnapshot(file)
  const response = await server.device(token, '/api/device/snapshot', {
    method: 'PUT',
    body: fs.readFileSync(file),
    headers: { 'Content-Type': 'application/vnd.sqlite3', 'X-Schockboard-Schema': '6' },
  })
  expect(response.status).toBe(200)
  return ids
}

const get = async (path: string) => (await server.admin(path)).json()

describe('chart endpoints', () => {
  it('need a snapshot', async () => {
    server = await createTestServer()
    expect((await server.admin('/api/admin/charts/players')).status).toBe(409)
  })

  it('lists closed evenings with stacked totals and per-player losses', async () => {
    const ids = await setup()
    const season = String(new Date().getFullYear())
    const all = await get('/api/admin/charts/evenings?season=all')
    expect(all.seasons).toEqual([season])
    expect(all.evenings).toHaveLength(1)
    const [evening] = all.evenings
    const overview = (await get('/api/admin/sessions')).find((session: { id: string }) => session.id === ids.closedSessionId)
    expect(evening).toMatchObject({ sessionId: ids.closedSessionId, title: 'Freitag', lossCents: 300, beerCents: 600 })
    expect(evening.absenceCents).toBe(overview.totalAbsenceCents)
    expect(evening.totalCents).toBe(overview.totalLossCents + overview.totalAbsenceCents)
    const anna = evening.players.find((row: { playerId: string }) => row.playerId === ids.players.anna)
    expect(anna).toMatchObject({ lossCents: 200, beerCents: 0 })
    // the open evening never counts for season stats
    expect(all.evenings.some((row: { sessionId: string }) => row.sessionId === ids.openSessionId)).toBe(false)

    expect((await get(`/api/admin/charts/evenings?season=${season}`)).evenings).toHaveLength(1)
    expect((await get('/api/admin/charts/evenings?season=1999')).evenings).toEqual([])
    expect((await server.admin('/api/admin/charts/evenings?season=abc')).status).toBe(400)
  })

  it('builds per-player debt timelines that end at the app’s open debt', async () => {
    const ids = await setup()
    const players = await get('/api/admin/charts/players')
    const debts = await get('/api/admin/debts')
    expect(players).toHaveLength(4)
    for (const debt of debts) {
      const row = players.find((player: { playerId: string }) => player.playerId === debt.playerId)
      expect(row.totals.openDebtCents).toBe(debt.openDebtCents)
      expect(row.totals.paymentCents).toBe(debt.paymentCents)
      expect(row.totals.correctionCents).toBe(debt.correctionCents)
      expect(row.totals.absenceCents).toBe(debt.absenceCents)
      expect(row.totals.lossCents + row.totals.beerCents).toBe(debt.lossCents)
      expect(row.timeline.at(-1)?.debtCents ?? 0).toBe(debt.openDebtCents)
    }
    const anna = players.find((player: { playerId: string }) => player.playerId === ids.players.anna)
    expect(anna.timeline.map((point: { kind: string; deltaCents: number }) => [point.kind, point.deltaCents])).toEqual([
      ['evening', 200],
      ['payment', -200],
    ])
    expect(anna).toMatchObject({ eveningsAttended: 1, eveningsMissed: 0 })
    const dana = players.find((player: { playerId: string }) => player.playerId === ids.players.dana)
    expect(dana).toMatchObject({ eveningsAttended: 0, eveningsMissed: 1 })
    expect(dana.timeline.at(-1)).toMatchObject({ kind: 'evening', open: true, sessionId: ids.openSessionId })
    const cem = players.find((player: { playerId: string }) => player.playerId === ids.players.cem)
    expect(cem.totals.beerCents).toBe(600)
  })

  it('returns cumulative payments and the open debt for the cashbox', async () => {
    await setup()
    const cashbox = await get('/api/admin/charts/cashbox')
    const summary = await get('/api/admin/cashbox')
    expect(cashbox.totalPaymentsCents).toBe(summary.totalPaymentsCents)
    expect(cashbox.openDebtCents).toBe(summary.totalOutstandingCents)
    expect(cashbox.payments).toHaveLength(1)
    expect(cashbox.payments[0]).toMatchObject({ amountCents: 200, cumulativeCents: 200, playerName: 'Anna' })
  })
})
