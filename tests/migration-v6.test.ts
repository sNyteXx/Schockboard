import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-crypto', async () => (await import('./support/memory-sqlite')).cryptoMock)
vi.mock('@/db/client', async () => (await import('./support/memory-sqlite')).clientMock)

import { ensureDatabaseReady, resetBootstrapFlag } from '@/db/bootstrap'
import { createMemoryDatabase, memory } from './support/memory-sqlite'

function seedVersion5Database() {
  memory.current = createMemoryDatabase()
  resetBootstrapFlag()
  ensureDatabaseReady()
  const db = memory.current
  db.execSync(`
    DELETE FROM schema_migrations WHERE version >= 6;
    DROP TABLE remote_inbox;
    INSERT INTO auth_accounts VALUES ('acc', 'Test', '-', '-', 'x', 'x', NULL);
    INSERT INTO players (id, name, slug, is_core, is_archived, created_at, updated_at) VALUES ('p1', 'Anna', 'anna', 1, 0, 'x', 'x');
    INSERT INTO corrections VALUES ('c_auto', 'p1', NULL, -100, 'Storniert: Verlust', 'acc', 'x');
    INSERT INTO corrections VALUES ('c_manual', 'p1', NULL, -50, 'Manuell', 'acc', 'x');
    INSERT INTO audit_events VALUES ('a1', 'acc', 'loss.deleted', 'loss', 'l1', NULL, '{"correctionId":"c_auto"}', 'x');
    INSERT INTO audit_events VALUES ('a2', 'acc', 'loss.deleted', 'loss', 'l2', NULL, 'not json', 'x');
  `)
  resetBootstrapFlag()
}

describe('migration v6', () => {
  it('neutralizes only automatic storno corrections and logs each one', () => {
    seedVersion5Database()
    ensureDatabaseReady()
    const db = memory.current

    const amounts = Object.fromEntries(
      db.getAllSync<{ id: string; amount_cents: number }>('SELECT id, amount_cents FROM corrections').map((row) => [row.id, row.amount_cents])
    )
    expect(amounts).toEqual({ c_auto: 0, c_manual: -50 })

    const trail = db.getAllSync<{ entity_id: string; payload_json: string }>(
      "SELECT entity_id, payload_json FROM audit_events WHERE event_type = 'migration.correction_neutralized'"
    )
    expect(trail).toHaveLength(1)
    expect(trail[0].entity_id).toBe('c_auto')
    expect(JSON.parse(trail[0].payload_json)).toMatchObject({ previousAmountCents: -100, playerId: 'p1' })
  })
})
