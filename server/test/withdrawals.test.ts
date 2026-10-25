import fs from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { buildDemoSnapshot } from '../scripts/demo-data'
import { createTestServer, tempFile } from './helpers'

let server: Awaited<ReturnType<typeof createTestServer>>

afterEach(() => server?.cleanup())

/** Demo data with withdrawals: payments 200 + 500 + 600, withdrawals 450 + 120 → 730 cash on hand. */
async function setup(options: { withdrawals?: boolean } = { withdrawals: true }) {
  server = await createTestServer()
  const { token } = await server.pair()
  const file = tempFile('snap.sqlite')
  const ids = buildDemoSnapshot(file, options)
  const response = await server.device(token, '/api/device/snapshot', {
    method: 'PUT',
    body: fs.readFileSync(file),
    headers: { 'Content-Type': 'application/vnd.sqlite3', 'X-Schockboard-Schema': '9' },
  })
  expect(response.status).toBe(200)
  return { token, ids }
}

function queue(type: string, payload: unknown) {
  return server.admin('/api/admin/commands', { method: 'POST', body: JSON.stringify({ type, payload }) })
}

const get = async (path: string) => (await server.admin(path)).json()

describe('cashbox withdrawals', () => {
  it('reports cash on hand = payments − withdrawals in summary, dashboard and device strip', async () => {
    await setup()
    const summary = await get('/api/admin/cashbox')
    expect(summary).toMatchObject({ totalPaymentsCents: 1300, totalWithdrawalsCents: 570, cashOnHandCents: 730 })
    const dashboard = await get('/api/admin/dashboard')
    expect(dashboard.cashbox.cashOnHandCents).toBe(730)
    const strip = await get('/api/admin/devices/cashbox')
    expect(strip[0].cashbox).toMatchObject({ cashOnHandCents: 730 })
    expect(strip[0].openSession).toMatchObject({ title: 'Samstag', status: 'open' })
  })

  it('exposes withdrawals in the cashbox chart with a running cash on hand', async () => {
    await setup()
    const chart = await get('/api/admin/charts/cashbox')
    expect(chart).toMatchObject({ totalPaymentsCents: 1300, totalWithdrawalsCents: 570, cashOnHandCents: 730 })
    // same timestamp in the demo → compare unordered
    expect(chart.withdrawals.map((row: { amountCents: number; note: string }) => `${row.amountCents} ${row.note}`).sort()).toEqual([
      '120 Kreide & Deckel',
      '450 Kasten Bier',
    ])
    expect(chart.withdrawals.at(-1).cumulativeCents).toBe(570)
    expect(chart.events).toHaveLength(5)
    expect(chart.events.at(-1).cashOnHandCents).toBe(730)
    for (const event of chart.events) expect(event.cashOnHandCents).toBeGreaterThanOrEqual(0)
    // legacy shape stays payment-only
    expect(chart.payments.at(-1).cumulativeCents).toBe(1300)
  })

  it('lists withdrawals in the history with their booking address', async () => {
    await setup()
    const rows = await get('/api/admin/history?kind=withdrawal')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ kind: 'withdrawal', entryKind: 'withdrawal', playerId: null })
    expect(rows.map((row: { note: string }) => row.note).sort()).toEqual(['Kasten Bier', 'Kreide & Deckel'])
    const all = await get('/api/admin/history')
    expect(all.filter((row: { kind: string }) => row.kind === 'withdrawal')).toHaveLength(2)
  })

  it('validates cashbox.withdraw against the cash on hand incl. queued withdrawals', async () => {
    await setup()
    // schema: positive amount, note required
    expect((await queue('cashbox.withdraw', { amountCents: 0, note: 'Bier' })).status).toBe(400)
    expect((await queue('cashbox.withdraw', { amountCents: -100, note: 'Bier' })).status).toBe(400)
    expect((await queue('cashbox.withdraw', { amountCents: 100, note: '   ' })).status).toBe(400)
    expect((await queue('cashbox.withdraw', { amountCents: 100 })).status).toBe(400)

    const tooMuch = await queue('cashbox.withdraw', { amountCents: 731, note: 'Grillabend' })
    expect(tooMuch.status).toBe(422)
    expect((await tooMuch.json()).message).toContain('7,30')

    expect((await queue('cashbox.withdraw', { amountCents: 500, note: 'Grillabend' })).status).toBe(201)
    // 230 left after the queued 500
    expect((await queue('cashbox.withdraw', { amountCents: 231, note: 'Kreide' })).status).toBe(422)
    const exact = await queue('cashbox.withdraw', { amountCents: 230, note: 'Kreide' })
    expect(exact.status).toBe(201)
    expect(await exact.json()).toMatchObject({ type: 'cashbox.withdraw', payload: { amountCents: 230, note: 'Kreide' } })
    expect((await queue('cashbox.withdraw', { amountCents: 1, note: 'Rest' })).status).toBe(422)
  })

  it('rejects withdrawals from an empty cashbox', async () => {
    await setup({ withdrawals: false })
    // plain demo: 200 paid, nothing withdrawn
    expect((await queue('cashbox.withdraw', { amountCents: 201, note: 'Bier' })).status).toBe(422)
    expect((await queue('cashbox.withdraw', { amountCents: 200, note: 'Bier' })).status).toBe(201)
    const empty = await queue('cashbox.withdraw', { amountCents: 1, note: 'Bier' })
    expect(empty.status).toBe(422)
    expect((await empty.json()).message).toContain('leer')
  })

  it('validates entry.update and entry.delete for withdrawals', async () => {
    const { ids } = await setup()
    const [beer, chalk] = ids.withdrawalIds

    // must exist, under the right kind
    expect((await queue('entry.delete', { kind: 'withdrawal', entryId: 'withdrawal_missing' })).status).toBe(422)
    expect((await queue('entry.update', { kind: 'withdrawal', entryId: 'withdrawal_missing', amountCents: 10 })).status).toBe(422)
    expect((await queue('entry.delete', { kind: 'payment', entryId: beer })).status).toBe(422)

    // amount > 0, note required
    expect((await queue('entry.update', { kind: 'withdrawal', entryId: beer, amountCents: 0 })).status).toBe(422)
    expect((await queue('entry.update', { kind: 'withdrawal', entryId: beer, note: '' })).status).toBe(422)
    expect((await queue('entry.update', { kind: 'withdrawal', entryId: beer, note: null })).status).toBe(422)

    // raising it is bounded by the cash on hand (730): 450 → 1180 ok, 1181 not
    expect((await queue('entry.update', { kind: 'withdrawal', entryId: beer, amountCents: 1181 })).status).toBe(422)
    expect((await queue('entry.update', { kind: 'withdrawal', entryId: beer, amountCents: 1180 })).status).toBe(201)
    // lowering is always fine
    expect((await queue('entry.update', { kind: 'withdrawal', entryId: chalk, amountCents: 100, note: 'Kreide' })).status).toBe(201)

    expect((await queue('entry.delete', { kind: 'withdrawal', entryId: chalk })).status).toBe(201)
    expect((await queue('entry.delete', { kind: 'withdrawal', entryId: chalk })).status).toBe(422)
    expect((await queue('entry.update', { kind: 'withdrawal', entryId: chalk, note: 'x' })).status).toBe(422)
  })
})
