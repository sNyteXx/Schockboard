import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-crypto', async () => (await import('./support/memory-sqlite')).cryptoMock)
vi.mock('@/db/client', async () => (await import('./support/memory-sqlite')).clientMock)

import { ensureDatabaseReady, resetBootstrapFlag } from '@/db/bootstrap'
import { getAppSettings, getDebtSummaries, listPlayers } from '@/db/queries'
import { createMemoryDatabase, memory } from './support/memory-sqlite'

/** Mimics the 1.0.0 (March 2026) database: migrations "done", columns missing. */
function seedEarlyBuildDatabase() {
  memory.current = createMemoryDatabase()
  resetBootstrapFlag()
  ensureDatabaseReady()
  const db = memory.current
  db.execSync(`
    INSERT INTO auth_accounts VALUES ('acc', 'Dieses Gerät', '-', '-', 'x', 'x', NULL);
    INSERT INTO players (id, name, slug, is_core, is_archived, created_at, updated_at) VALUES ('p1', 'Mike', 'mike', 1, 0, 'x', 'x');
    INSERT INTO sessions (id, title, status, stake_cents, started_at, created_by_account_id, created_at, updated_at)
      VALUES ('s1', 'Schockabend', 'closed', 100, 'x', 'acc', 'x', 'x');
    INSERT INTO loss_entries (id, session_id, player_id, amount_cents, created_by_account_id, created_at)
      VALUES ('l1', 's1', 'p1', 100, 'acc', 'x'), ('l2', 's1', 'p1', 100, 'acc', 'x');
    INSERT INTO payments (id, player_id, amount_cents, created_by_account_id, created_at) VALUES ('pay', 'p1', 50, 'acc', 'x');
    DROP VIEW v_player_debts; DROP VIEW v_session_totals; DROP VIEW v_cashbox;
    ALTER TABLE app_settings DROP COLUMN view_mode;
    ALTER TABLE app_settings DROP COLUMN theme_id;
    ALTER TABLE loss_entries DROP COLUMN is_beer_round;
    DROP TABLE remote_inbox;
  `)
  resetBootstrapFlag()
}

describe('schema repair for early builds', () => {
  it('adds missing columns, tables and views without touching data', () => {
    seedEarlyBuildDatabase()
    expect(() => getAppSettings()).not.toThrow()

    expect(getAppSettings().viewMode).toBe('basic')
    expect(listPlayers().map((player) => player.name)).toEqual(['Mike'])
    expect(getDebtSummaries().find((row) => row.playerId === 'p1')!.openDebtCents).toBe(150)

    const repairs = memory.current.getFirstSync<{ payload_json: string }>("SELECT payload_json FROM audit_events WHERE event_type = 'schema.repaired'")
    expect(JSON.parse(repairs!.payload_json).repairs).toEqual(
      expect.arrayContaining(['column app_settings.view_mode', 'column loss_entries.is_beer_round', 'table remote_inbox'])
    )
  })

  it('is a no-op on an up-to-date database', () => {
    memory.current = createMemoryDatabase()
    resetBootstrapFlag()
    ensureDatabaseReady()
    expect(memory.current.getFirstSync<{ n: number }>("SELECT COUNT(*) AS n FROM audit_events WHERE event_type = 'schema.repaired'")!.n).toBe(0)
  })
})
