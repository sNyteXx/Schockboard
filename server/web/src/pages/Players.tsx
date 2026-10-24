import { useState, type FormEvent } from 'react'

import { formatDate, formatSignedCurrency } from '@/domain/format'

import { queueCommand, ApiError, type Player, type PlayerChartRow, type PlayerDebtSummary } from '../api'
import { LineChart } from '../charts/LineChart'
import { ACCENT } from '../charts/scale'
import { Card, ErrorView, Loading, Money, Page, PendingHints, SyncHint } from '../components'
import { Drawer, RenameDialog, RenamePendingBadges } from '../overrides'
import { Link, pendingForPlayer, useApi, useApp } from '../state'

const EVENT_LABELS = { evening: 'Abend', payment: 'Zahlung', correction: 'Korrektur' } as const

function PlayerDrawer({ playerId, onClose, onRename }: { playerId: string; onClose: () => void; onRename: () => void }) {
  const { pending } = useApp()
  const chart = useApi<PlayerChartRow[]>('/charts/players')
  const row = chart.data?.find((entry) => entry.playerId === playerId)
  const totals = row?.totals
  return (
    <Drawer title={row?.playerName ?? 'Spieler'} onClose={onClose}>
      {chart.error ? <ErrorView error={chart.error} /> : null}
      {!row && chart.loading ? <div className="skeleton" /> : null}
      {row && totals ? (
        <div className="stack" style={{ gap: 18 }}>
          <div className="row" style={{ gap: 6 }}>
            {row.isCore ? <span className="badge yellow">Stamm</span> : <span className="badge">Gast</span>}
            {row.isArchived ? <span className="badge">Archiviert</span> : null}
            <button type="button" className="btn ghost small" onClick={onRename}>
              Umbenennen
            </button>
          </div>
          <RenamePendingBadges playerId={playerId} />
          <PendingHints commands={pendingForPlayer(pending, playerId).filter((command) => command.type !== 'player.rename')} />
          <div className="drawer-kpi">
            <div className="stat-label muted">Offen</div>
            <div className="stat-value" style={{ color: totals.openDebtCents > 0 ? 'var(--accent)' : 'var(--success)' }}>
              <Money cents={totals.openDebtCents} />
            </div>
            <div className="muted small">
              {row.eveningsAttended} Abende dabei · {row.eveningsMissed} verpasst (beendete Abende)
            </div>
          </div>
          <LineChart
            ariaLabel={`Offene Schulden von ${row.playerName} im Zeitverlauf`}
            height={220}
            series={[
              {
                id: row.playerId,
                label: row.playerName,
                color: ACCENT,
                points: row.timeline.map((point) => ({ t: new Date(point.at).getTime(), v: point.debtCents, note: `${EVENT_LABELS[point.kind]}: ${point.label}` })),
              },
            ]}
            emptyText="Noch keine Buchungen."
          />
          <dl className="totals">
            <dt>Verluste</dt>
            <dd><Money cents={totals.lossCents} /></dd>
            <dt>Bierrunden</dt>
            <dd><Money cents={totals.beerCents} /></dd>
            <dt>Abwesenheit</dt>
            <dd><Money cents={totals.absenceCents} /></dd>
            <dt>Korrekturen</dt>
            <dd><Money cents={totals.correctionCents} /></dd>
            <dt>Gezahlt</dt>
            <dd><Money cents={totals.paymentCents} /></dd>
            <dt className="strong">Offen</dt>
            <dd className="strong"><Money cents={totals.openDebtCents} debt /></dd>
          </dl>
          {row.timeline.length > 0 ? (
            <div>
              <h3>Letzte Veränderungen</h3>
              <div className="list">
                {[...row.timeline].reverse().slice(0, 12).map((point, index) => (
                  <div key={`${point.at}-${index}`} className="list-item">
                    <div style={{ minWidth: 0 }}>
                      <div className="title">
                        {EVENT_LABELS[point.kind]}
                        {point.open ? <span className="badge yellow" style={{ marginLeft: 6 }}>läuft</span> : null}
                      </div>
                      <div className="sub">
                        {formatDate(point.at)} ·{' '}
                        {point.sessionId && point.kind === 'evening' ? <Link to={`/abende/${encodeURIComponent(point.sessionId)}`}>{point.label}</Link> : point.label}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="amount">{formatSignedCurrency(point.deltaCents)}</div>
                      <div className="sub">→ <Money cents={point.debtCents} /></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <Link to={`/historie`} className="small">
            Alle Buchungen in der Historie
          </Link>
        </div>
      ) : null}
    </Drawer>
  )
}

export function PlayersPage() {
  const { pending, refresh, toast } = useApp()
  const players = useApi<Player[]>('/players')
  const debts = useApi<PlayerDebtSummary[]>('/debts')
  const [name, setName] = useState('')
  const [isCore, setIsCore] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [openPlayer, setOpenPlayerState] = useState<string | null>(() => new URLSearchParams(window.location.search).get('spieler'))
  const [renaming, setRenaming] = useState<Player | null>(null)

  function setOpenPlayer(id: string | null) {
    setOpenPlayerState(id)
    window.history.replaceState(null, '', id ? `/spieler?spieler=${encodeURIComponent(id)}` : '/spieler')
  }

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
              enthalten das noch nicht. Umbenennen geschieht still, ohne Eintrag im Protokoll der App.
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
                        <button type="button" className="name-btn" onClick={() => setOpenPlayer(player.id)}>
                          {player.name}
                        </button>
                        <div className="row" style={{ gap: 6, marginTop: 4 }}>
                          {player.isCore ? <span className="badge yellow">Stamm</span> : <span className="badge">Gast</span>}
                          {player.isArchived ? <span className="badge">Archiviert</span> : null}
                        </div>
                        <PendingHints commands={playerPending.filter((command) => command.type !== 'player.rename')} />
                        <RenamePendingBadges playerId={player.id} />
                      </td>
                      <td className="num hide-mobile">{debt ? <Money cents={debt.lossCents} /> : '—'}</td>
                      <td className="num hide-mobile">{debt ? <Money cents={debt.absenceCents} /> : '—'}</td>
                      <td className="num hide-mobile">{debt ? <Money cents={debt.correctionCents} /> : '—'}</td>
                      <td className="num hide-mobile">{debt ? <Money cents={debt.paymentCents} /> : '—'}</td>
                      <td className="num">{debt ? <Money cents={debt.openDebtCents} debt /> : '—'}</td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <button className="btn ghost small" onClick={() => setRenaming(player)}>
                            Umbenennen
                          </button>
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
      {openPlayer ? (
        <PlayerDrawer
          playerId={openPlayer}
          onClose={() => setOpenPlayer(null)}
          onRename={() => {
            const player = (players.data ?? []).find((entry) => entry.id === openPlayer)
            if (player) setRenaming(player)
          }}
        />
      ) : null}
      {renaming ? <RenameDialog player={renaming} onClose={() => setRenaming(null)} /> : null}
    </Page>
  )
}
