import { useState, type FormEvent } from 'react'

import { queueCommand, ApiError, type Player, type PlayerDebtSummary } from '../api'
import { Card, ErrorView, Loading, Money, Page, PendingHints, SyncHint } from '../components'
import { pendingForPlayer, useApi, useApp } from '../state'

export function PlayersPage() {
  const { pending, refresh, toast } = useApp()
  const players = useApi<Player[]>('/players')
  const debts = useApi<PlayerDebtSummary[]>('/debts')
  const [name, setName] = useState('')
  const [isCore, setIsCore] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const debtById = new Map((debts.data ?? []).map((row) => [row.playerId, row]))
  const pendingCreates = pending.filter((command) => command.type === 'player.create')
  const visible = (players.data ?? []).filter((player) => showArchived || !player.isArchived)
  const archivedCount = (players.data ?? []).filter((player) => player.isArchived).length

  async function run(key: string, task: () => Promise<unknown>, message: string) {
    setBusy(key)
    try {
      await task()
      toast(message)
      await refresh()
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Fehler beim Speichern.', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    await run('create', () => queueCommand('player.create', { name: trimmed, isCore }), `„${trimmed}“ wird beim nächsten Sync angelegt.`)
    setName('')
  }

  const toggle = (player: Player, change: { isCore?: boolean; isArchived?: boolean }) =>
    run(player.id, () => queueCommand('player.update', { playerId: player.id, ...change }), 'Änderung beauftragt.')

  return (
    <Page eyebrow="Die Mannschaft" title="Spieler">
      <SyncHint />
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card title="Spieler anlegen">
          <form className="stack" onSubmit={create}>
            <label className="field">
              Name
              <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="z. B. Marco" />
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={isCore} onChange={(event) => setIsCore(event.target.checked)} />
              Stammspieler (sonst Gast)
            </label>
            <div>
              <button className="btn" disabled={!name.trim() || busy === 'create'}>
                Anlegen beauftragen
              </button>
            </div>
          </form>
          {pendingCreates.length > 0 ? (
            <div className="pending-note" style={{ marginTop: 14 }}>
              {pendingCreates.map((command) => (
                <span key={command.id} className="badge pending">
                  ausstehend: {String(command.payload.name)} ({command.payload.isCore ? 'Stammspieler' : 'Gast'})
                </span>
              ))}
            </div>
          ) : null}
        </Card>
        <Card title="Legende">
          <div className="stack small muted">
            <div>
              <span className="badge yellow">Stamm</span> Stammspieler zählen für Abwesenheitsgebühren.
            </div>
            <div>
              <span className="badge">Archiviert</span> Archivierte Spieler erscheinen nicht mehr in neuen Abenden.
            </div>
            <div>
              <span className="badge pending">ausstehend</span> Beauftragt, aber noch nicht vom Gerät übernommen – die Beträge
              enthalten das noch nicht.
            </div>
          </div>
        </Card>
      </div>

      {players.error ? <ErrorView error={players.error} /> : null}
      {!players.data && players.loading ? <Loading /> : null}
      {players.data ? (
        <Card
          title={`${visible.length} Spieler`}
          actions={
            archivedCount > 0 ? (
              <label className="checkbox small">
                <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
                Archivierte zeigen ({archivedCount})
              </label>
            ) : null
          }
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="num hide-mobile">Verluste</th>
                  <th className="num hide-mobile">Abwesenheit</th>
                  <th className="num hide-mobile">Korrekturen</th>
                  <th className="num hide-mobile">Gezahlt</th>
                  <th className="num">Offen</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((player) => {
                  const debt = debtById.get(player.id)
                  const playerPending = pendingForPlayer(pending, player.id)
                  const updatePending = playerPending.some((command) => command.type === 'player.update')
                  return (
                    <tr key={player.id}>
                      <td>
                        <div style={{ fontWeight: 800 }}>{player.name}</div>
                        <div className="row" style={{ gap: 6, marginTop: 4 }}>
                          {player.isCore ? <span className="badge yellow">Stamm</span> : <span className="badge">Gast</span>}
                          {player.isArchived ? <span className="badge">Archiviert</span> : null}
                        </div>
                        <PendingHints commands={playerPending} />
                      </td>
                      <td className="num hide-mobile">{debt ? <Money cents={debt.lossCents} /> : '—'}</td>
                      <td className="num hide-mobile">{debt ? <Money cents={debt.absenceCents} /> : '—'}</td>
                      <td className="num hide-mobile">{debt ? <Money cents={debt.correctionCents} /> : '—'}</td>
                      <td className="num hide-mobile">{debt ? <Money cents={debt.paymentCents} /> : '—'}</td>
                      <td className="num">{debt ? <Money cents={debt.openDebtCents} debt /> : '—'}</td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <button
                            className="btn ghost small"
                            disabled={busy === player.id || updatePending}
                            onClick={() => toggle(player, { isCore: !player.isCore })}
                          >
                            {player.isCore ? 'Zum Gast' : 'Zum Stamm'}
                          </button>
                          <button
                            className={`btn small ${player.isArchived ? 'ghost' : 'danger'}`}
                            disabled={busy === player.id || updatePending}
                            onClick={() => toggle(player, { isArchived: !player.isArchived })}
                          >
                            {player.isArchived ? 'Reaktivieren' : 'Archivieren'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </Page>
  )
}
