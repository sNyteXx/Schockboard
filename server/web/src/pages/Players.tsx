import { useMemo, useState } from 'react'

import { formatDate, formatSignedCurrency } from '@/domain/format'
import { playerColor } from '@/theme/tokens'

import { useActions } from '../actions'
import { queueCommand, ApiError, type Player, type PlayerChartRow, type PlayerDebtSummary } from '../api'
import { LineChart } from '../charts/LineChart'
import {
  Avatar,
  Badge,
  BalanceBar,
  Button,
  Card,
  Chips,
  EmptyState,
  ErrorView,
  IconButton,
  Money,
  Page,
  PendingHints,
  SkeletonChart,
  SkeletonRows,
  StatTile,
  SyncHint,
} from '../components'
import { ConfirmDialog } from '../dialog'
import { Icon, type IconName } from '../icons'
import { Drawer, RenameDialog, RenamePendingBadges } from '../overrides'
import { Link, pendingForPlayer, replaceUrl, useApi, useApp, useSearch } from '../state'

const EVENT_META = {
  evening: { label: 'Abend', icon: 'dice', tone: 'accent' },
  payment: { label: 'Zahlung', icon: 'cash-in', tone: 'success' },
  correction: { label: 'Korrektur', icon: 'swap-vertical', tone: 'default' },
} as const satisfies Record<string, { label: string; icon: IconName; tone: string }>

function PlayerDrawer({ playerId, player, onClose, onRename }: { playerId: string; player: Player | undefined; onClose: () => void; onRename: () => void }) {
  const { pending } = useApp()
  const { openBooking } = useActions()
  const chart = useApi<PlayerChartRow[]>('/charts/players')
  const row = chart.data?.find((entry) => entry.playerId === playerId)
  const totals = row?.totals
  const name = row?.playerName ?? player?.name ?? 'Spieler'
  return (
    <Drawer
      title={name}
      leading={<Avatar id={playerId} name={name} size={40} muted={row?.isArchived} />}
      subtitle={
        row ? (
          <span className="row-inline">
            {row.isCore ? <Badge tone="accent" icon="star">Stamm</Badge> : <Badge>Gast</Badge>}
            {row.isArchived ? <Badge icon="archive">Archiviert</Badge> : null}
            <span>
              {row.eveningsAttended} Abende dabei · {row.eveningsMissed} verpasst
            </span>
          </span>
        ) : undefined
      }
      onClose={onClose}
    >
      {chart.error ? <ErrorView error={chart.error} /> : null}
      {!row && chart.loading ? (
        <>
          <SkeletonRows rows={2} />
          <SkeletonChart height={200} />
        </>
      ) : null}
      {row && totals ? (
        <div className="drawer-stack">
          <div className="drawer-actions">
            <Button variant="primary" size="sm" icon="cash-in" onClick={() => openBooking('payment', { playerId })}>
              Zahlung
            </Button>
            <Button variant="secondary" size="sm" icon="swap-vertical" onClick={() => openBooking('correction', { playerId })}>
              Korrektur
            </Button>
            <Button variant="ghost" size="sm" icon="pencil" onClick={onRename}>
              Umbenennen
            </Button>
          </div>
          <RenamePendingBadges playerId={playerId} />
          <PendingHints commands={pendingForPlayer(pending, playerId).filter((command) => command.type !== 'player.rename')} />
          <div className="stat-grid">
            <StatTile
              label="Saldo"
              icon="wallet"
              tone={totals.openDebtCents > 0 ? 'danger' : 'success'}
              value={<Money cents={totals.openDebtCents} debt />}
              hint={totals.openDebtCents > 0 ? 'offen' : totals.openDebtCents < 0 ? 'Guthaben' : 'ausgeglichen'}
            />
            <StatTile label="Gezahlt" icon="cash-in" value={<Money cents={totals.paymentCents} />} />
            <StatTile label="Verluste" icon="dice" value={<Money cents={totals.lossCents} />} hint={`+ ${formatSignedCurrency(totals.beerCents).replace('+', '')} Bierrunden`} />
            <StatTile label="Abwesenheit" icon="person" value={<Money cents={totals.absenceCents} />} hint={`Korrekturen ${formatSignedCurrency(totals.correctionCents)}`} />
          </div>
          <div>
            <div className="overline">Saldo im Zeitverlauf</div>
            <LineChart
              ariaLabel={`Offene Schulden von ${row.playerName} im Zeitverlauf`}
              height={200}
              series={[
                {
                  id: row.playerId,
                  label: row.playerName,
                  color: playerColor(row.playerId),
                  points: row.timeline.map((point) => ({ t: new Date(point.at).getTime(), v: point.debtCents, note: `${EVENT_META[point.kind].label}: ${point.label}` })),
                },
              ]}
              emptyText="Noch keine Buchungen."
            />
          </div>
          {row.timeline.length > 0 ? (
            <div>
              <div className="overline">Verlauf</div>
              <ol className="timeline">
                {[...row.timeline]
                  .reverse()
                  .slice(0, 25)
                  .map((point, index) => {
                    const meta = EVENT_META[point.kind]
                    return (
                      <li key={`${point.at}-${index}`} className={`timeline-item tone-${meta.tone}`}>
                        <span className="timeline-dot" aria-hidden>
                          <Icon name={meta.icon} size={13} />
                        </span>
                        <div className="timeline-text">
                          <div className="timeline-title">
                            {meta.label}
                            {point.open ? (
                              <Badge tone="accent" icon="pulse">
                                läuft
                              </Badge>
                            ) : null}
                          </div>
                          <div className="timeline-meta">
                            {formatDate(point.at)} ·{' '}
                            {point.sessionId && point.kind === 'evening' ? <Link to={`/abende/${encodeURIComponent(point.sessionId)}`}>{point.label}</Link> : point.label}
                          </div>
                        </div>
                        <div className="timeline-end">
                          <span className={`amount ${point.deltaCents > 0 ? 'debt' : 'credit'}`}>{formatSignedCurrency(point.deltaCents)}</span>
                          <span className="subtle-text">
                            → <Money cents={point.debtCents} />
                          </span>
                        </div>
                      </li>
                    )
                  })}
              </ol>
              {row.timeline.length > 25 ? <div className="card-foot">… und {row.timeline.length - 25} ältere</div> : null}
            </div>
          ) : null}
          <Link to={`/historie?spieler=${encodeURIComponent(playerId)}`} className="btn btn-ghost btn-sm">
            Alle Buchungen in der Historie <Icon name="chevron-right" size={14} />
          </Link>
        </div>
      ) : null}
    </Drawer>
  )
}

type Filter = 'active' | 'core' | 'guest' | 'archived'
type Sort = 'name' | 'balance'

export function PlayersPage() {
  const { pending, refresh, toast } = useApp()
  const { openBooking } = useActions()
  const search = useSearch()
  const players = useApi<Player[]>('/players')
  const debts = useApi<PlayerDebtSummary[]>('/debts')
  const [busy, setBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('active')
  const [sort, setSort] = useState<Sort>('balance')
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<Player | null>(null)
  const [archiving, setArchiving] = useState<Player | null>(null)
  const openPlayer = new URLSearchParams(search).get('spieler')

  function setOpenPlayer(id: string | null) {
    replaceUrl(id ? `/spieler?spieler=${encodeURIComponent(id)}` : '/spieler')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const debtById = new Map((debts.data ?? []).map((row) => [row.playerId, row]))
  const pendingCreates = pending.filter((command) => command.type === 'player.create')
  const all = players.data ?? []
  const counts = {
    active: all.filter((player) => !player.isArchived).length,
    core: all.filter((player) => !player.isArchived && player.isCore).length,
    guest: all.filter((player) => !player.isArchived && !player.isCore).length,
    archived: all.filter((player) => player.isArchived).length,
  }
  const maxBalance = Math.max(1, ...(debts.data ?? []).map((row) => Math.abs(row.openDebtCents)))

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('de')
    return all
      .filter((player) =>
        filter === 'archived' ? player.isArchived : !player.isArchived && (filter === 'active' || (filter === 'core' ? player.isCore : !player.isCore))
      )
      .filter((player) => !q || player.name.toLocaleLowerCase('de').includes(q))
      .sort((a, b) =>
        sort === 'name'
          ? a.name.localeCompare(b.name, 'de')
          : (debtById.get(b.id)?.openDebtCents ?? 0) - (debtById.get(a.id)?.openDebtCents ?? 0) || a.name.localeCompare(b.name, 'de')
      )
  }, [all, filter, query, sort, debts.data])

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

  const toggle = (player: Player, change: { isCore?: boolean; isArchived?: boolean }) =>
    run(player.id, () => queueCommand('player.update', { playerId: player.id, ...change }), 'Änderung beauftragt.')

  const sortHeader = (key: Sort, label: string, className?: string) => (
    <th className={className} aria-sort={sort === key ? (key === 'name' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="th-sort" onClick={() => setSort(key)}>
        {label}
        {sort === key ? <Icon name="chevron-down" size={13} /> : null}
      </button>
    </th>
  )

  return (
    <Page
      title="Spieler"
      icon="people"
      context={players.data ? `${counts.active} aktiv · ${counts.archived} archiviert` : undefined}
      actions={
        <Button variant="primary" size="sm" icon="person-add" onClick={() => openBooking('player')}>
          Spieler anlegen
        </Button>
      }
    >
      {pendingCreates.length > 0 ? (
        <div className="pending-note">
          {pendingCreates.map((command) => (
            <Badge key={command.id} tone="pending" icon="time">
              wird angelegt: {String(command.payload.name)} ({command.payload.isCore ? 'Stamm' : 'Gast'})
            </Badge>
          ))}
        </div>
      ) : null}
      {players.error ? <ErrorView error={players.error} /> : null}
      {!players.error ? (
        <Card className="table-card">
          <div className="toolbar">
            <label className="search-field">
              <Icon name="search" size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Spieler suchen" aria-label="Spieler suchen" />
            </label>
            <Chips
              label="Filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'active', label: 'Alle aktiven', count: counts.active },
                { value: 'core', label: 'Stamm', count: counts.core, icon: 'star' },
                { value: 'guest', label: 'Gäste', count: counts.guest },
                { value: 'archived', label: 'Archiviert', count: counts.archived, icon: 'archive' },
              ]}
            />
          </div>
          {!players.data ? (
            <SkeletonRows rows={6} avatar />
          ) : visible.length === 0 ? (
            <EmptyState icon="people" title={query ? 'Kein Treffer' : 'Keine Spieler'} text={query ? `Niemand heißt „${query}“.` : 'In dieser Ansicht gibt es keine Spieler.'} />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {sortHeader('name', 'Spieler')}
                    <th className="num hide-md">Verluste</th>
                    <th className="num hide-md">Abwesenheit</th>
                    <th className="num hide-lg">Korrekturen</th>
                    <th className="num hide-md">Gezahlt</th>
                    {sortHeader('balance', 'Saldo', 'num balance-col')}
                    <th className="actions-col">
                      <span className="sr-only">Aktionen</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((player) => {
                    const debt = debtById.get(player.id)
                    const playerPending = pendingForPlayer(pending, player.id)
                    const updatePending = playerPending.some((command) => command.type === 'player.update')
                    return (
                      <tr key={player.id} className={openPlayer === player.id ? 'selected' : ''}>
                        <td>
                          <button type="button" className="player-cell" onClick={() => setOpenPlayer(player.id)}>
                            <Avatar id={player.id} name={player.name} size={32} muted={player.isArchived} />
                            <span className="player-cell-text">
                              <span className="player-cell-name">{player.name}</span>
                              <span className="player-cell-badges">
                                {player.isCore ? <Badge tone="accent" icon="star">Stamm</Badge> : <Badge>Gast</Badge>}
                                {player.isArchived ? <Badge icon="archive">Archiviert</Badge> : null}
                              </span>
                            </span>
                          </button>
                          <PendingHints commands={playerPending.filter((command) => command.type !== 'player.rename')} />
                          <RenamePendingBadges playerId={player.id} />
                        </td>
                        <td className="num hide-md">{debt ? <Money cents={debt.lossCents} /> : '—'}</td>
                        <td className="num hide-md">{debt ? <Money cents={debt.absenceCents} /> : '—'}</td>
                        <td className="num hide-lg">{debt ? <Money cents={debt.correctionCents} signed /> : '—'}</td>
                        <td className="num hide-md">{debt ? <Money cents={debt.paymentCents} /> : '—'}</td>
                        <td className="num balance-col">
                          {debt ? (
                            <span className="balance-cell">
                              <Money cents={debt.openDebtCents} debt />
                              <BalanceBar cents={debt.openDebtCents} max={maxBalance} />
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="actions-col">
                          <div className="row-actions">
                            <IconButton icon="cash-in" label={`Zahlung von ${player.name}`} onClick={() => openBooking('payment', { playerId: player.id })} />
                            <IconButton icon="pencil" label={`${player.name} umbenennen`} onClick={() => setRenaming(player)} />
                            <IconButton
                              icon="star"
                              label={player.isCore ? `${player.name} zum Gast machen` : `${player.name} zum Stammspieler machen`}
                              className={player.isCore ? 'on' : ''}
                              disabled={busy === player.id || updatePending}
                              onClick={() => toggle(player, { isCore: !player.isCore })}
                            />
                            <IconButton
                              icon={player.isArchived ? 'refresh' : 'archive'}
                              label={player.isArchived ? `${player.name} reaktivieren` : `${player.name} archivieren`}
                              tone={player.isArchived ? undefined : 'danger'}
                              disabled={busy === player.id || updatePending}
                              onClick={() => (player.isArchived ? toggle(player, { isArchived: false }) : setArchiving(player))}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="card-foot">
            <Badge tone="pending" icon="time">
              ausstehend
            </Badge>{' '}
            = beauftragt, aber noch nicht vom Gerät übernommen; die Beträge enthalten das noch nicht.
          </div>
        </Card>
      ) : null}
      <SyncHint />
      {openPlayer ? (
        <PlayerDrawer
          playerId={openPlayer}
          player={all.find((entry) => entry.id === openPlayer)}
          onClose={() => setOpenPlayer(null)}
          onRename={() => {
            const player = all.find((entry) => entry.id === openPlayer)
            if (player) setRenaming(player)
          }}
        />
      ) : null}
      {renaming ? <RenameDialog player={renaming} onClose={() => setRenaming(null)} /> : null}
      {archiving ? (
        <ConfirmDialog
          title={`${archiving.name} archivieren?`}
          icon="archive"
          tone="danger"
          confirmLabel="Archivieren beauftragen"
          busy={busy === archiving.id}
          onClose={() => setArchiving(null)}
          onConfirm={async () => {
            await toggle(archiving, { isArchived: true })
            setArchiving(null)
          }}
        >
          <p>Archivierte Spieler erscheinen nicht mehr in neuen Abenden. Buchungen und Saldo bleiben erhalten; Reaktivieren ist jederzeit möglich.</p>
        </ConfirmDialog>
      ) : null}
    </Page>
  )
}
