import { useMemo, useState } from 'react'

import { formatCurrency, formatDate, formatDateTime } from '@/domain/format'

import { useActions } from '../actions'
import type { CashboxChart, DashboardSnapshot, EveningsChart, HistoryRow, PlayerChartRow, SessionDetail, SessionOverview } from '../api'
import { Donut } from '../charts/Donut'
import { LineChart } from '../charts/LineChart'
import { RankingBars } from '../charts/RankingBars'
import { CASH_COLORS, CHART, STACK_COLORS } from '../charts/scale'
import { balanceTotals, cropSeries, playerDebtSeries } from '../charts/series'
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorView,
  KpiTile,
  Notice,
  Page,
  PendingHints,
  relativeTime,
  Segmented,
  SkeletonChart,
  SkeletonRows,
  StatusBadge,
} from '../components'
import { KIND_ICONS, KIND_TONES, presentHistory } from '../history-format'
import { Icon } from '../icons'
import { RenamePendingBadges, useUndo } from '../overrides'
import { COMMAND_LABELS, describeCommand, Link, navigate, pendingForPlayer, useApi, useApp } from '../state'

type Dashboard = Omit<DashboardSnapshot, 'recentHistory'> & { recentHistory: HistoryRow[] }
type Range = 'season' | 'all' | 'last10'

// ---- debt over time ------------------------------------------------------------

function DebtChartCard({ players, evenings }: { players: PlayerChartRow[] | null; evenings: EveningsChart | null }) {
  const [range, setRange] = useState<Range>('all')
  const lines = useMemo(() => (players ? playerDebtSeries(players) : null), [players])
  const from = useMemo(() => {
    const list = evenings?.evenings ?? []
    if (range === 'season') {
      const season = evenings?.seasons[0] ?? String(new Date().getFullYear())
      return new Date(`${season}-01-01T00:00:00`).getTime()
    }
    if (range === 'last10' && list.length > 10) return new Date(list[list.length - 10].date).getTime()
    return null
  }, [range, evenings])
  const series = lines ? cropSeries(lines.series, from) : []
  const seasonLabel = evenings?.seasons[0] ? `Saison ${evenings.seasons[0]}` : 'Saison'

  return (
    <Card
      className="span-8"
      icon="trending-up"
      eyebrow="Verlauf"
      title="Offene Schulden pro Spieler"
      actions={
        <Segmented
          label="Zeitraum"
          size="sm"
          value={range}
          onChange={setRange}
          options={[
            { value: 'season', label: seasonLabel },
            { value: 'all', label: 'Gesamt' },
            { value: 'last10', label: 'Letzte 10' },
          ]}
        />
      }
    >
      {lines ? (
        <LineChart
          key={lines.hidden.join(',')}
          ariaLabel="Offene Schulden pro Spieler im Zeitverlauf. Pfeiltasten links/rechts zeigen die Werte."
          series={series}
          initiallyHidden={lines.hidden}
          startAtZero={from === null}
          height={300}
          emptyText="Noch keine Buchungen."
        />
      ) : (
        <SkeletonChart height={330} />
      )}
      <div className="card-foot">Stand nach jedem Abend, jeder Zahlung und Korrektur. Legende antippen blendet Spieler ein oder aus.</div>
    </Card>
  )
}

// ---- live / last evening -------------------------------------------------------

type PlayerBar = { id: string; name: string; loss: number; beer: number; absence: number }

function EveningBars({ rows }: { rows: PlayerBar[] }) {
  const max = Math.max(1, ...rows.map((row) => row.loss + row.beer + row.absence))
  if (rows.length === 0) return <EmptyState compact icon="dice" title="Noch keine Einträge" text="Sobald Verluste gebucht sind, erscheinen sie hier." />
  return (
    <ol className="evening-bars">
      {rows.map((row) => {
        const total = row.loss + row.beer + row.absence
        return (
          <li key={row.id}>
            <Avatar id={row.id} name={row.name} size={26} />
            <span className="evening-bar-name">{row.name}</span>
            <span className="evening-bar-track" aria-hidden>
              {[
                { key: 'loss', value: row.loss, color: STACK_COLORS.loss },
                { key: 'beer', value: row.beer, color: STACK_COLORS.beer },
                { key: 'absence', value: row.absence, color: STACK_COLORS.absence },
              ]
                .filter((part) => part.value > 0)
                .map((part) => (
                  <span key={part.key} style={{ width: `${(part.value / max) * 100}%`, background: part.color }} />
                ))}
            </span>
            <span className="amount">{formatCurrency(total)}</span>
          </li>
        )
      })}
    </ol>
  )
}

function EveningCard({ openSession, evenings }: { openSession: SessionOverview | null; evenings: EveningsChart | null }) {
  const detail = useApi<SessionDetail>(openSession ? `/sessions/${encodeURIComponent(openSession.id)}` : null)
  const last = evenings?.evenings[evenings.evenings.length - 1] ?? null

  if (openSession) {
    const byPlayer = new Map<string, PlayerBar>()
    for (const loss of detail.data?.losses ?? []) {
      const row = byPlayer.get(loss.playerId) ?? { id: loss.playerId, name: loss.playerName, loss: 0, beer: 0, absence: 0 }
      if (loss.isBeerRound) row.beer += loss.amountCents
      else row.loss += loss.amountCents
      byPlayer.set(loss.playerId, row)
    }
    const rows = [...byPlayer.values()].sort((a, b) => b.loss + b.beer - (a.loss + a.beer))
    return (
      <Card
        className="span-4 live-card"
        icon="pulse"
        eyebrow="Live"
        title={openSession.title}
        actions={
          <Link to={`/abende/${encodeURIComponent(openSession.id)}`} className="btn btn-ghost btn-sm">
            Öffnen <Icon name="chevron-right" size={14} />
          </Link>
        }
      >
        <div className="evening-summary">
          <Badge tone="accent" icon="pulse">
            läuft seit {formatDateTime(openSession.startedAt)}
          </Badge>
          <span className="evening-total amount">{formatCurrency(openSession.totalLossCents)}</span>
        </div>
        <div className="evening-meta">
          {openSession.presentCount} anwesend · {openSession.lossCount} Einträge · Einsatz {formatCurrency(openSession.stakeCents)}
        </div>
        {detail.data ? <EveningBars rows={rows} /> : <SkeletonRows rows={3} avatar />}
      </Card>
    )
  }

  return (
    <Card
      className="span-4"
      icon="calendar"
      eyebrow="Letzter Abend"
      title={last ? last.title : 'Kein Abend'}
      actions={
        last ? (
          <Link to={`/abende/${encodeURIComponent(last.sessionId)}`} className="btn btn-ghost btn-sm">
            Öffnen <Icon name="chevron-right" size={14} />
          </Link>
        ) : null
      }
    >
      {!evenings ? (
        <SkeletonRows rows={4} avatar />
      ) : last ? (
        <>
          <div className="evening-summary">
            <Badge icon="check">{formatDate(last.date)}</Badge>
            <span className="evening-total amount">{formatCurrency(last.totalCents)}</span>
          </div>
          <div className="evening-legend">
            <span><i style={{ background: STACK_COLORS.loss }} /> Verluste</span>
            <span><i style={{ background: STACK_COLORS.beer }} /> Bierrunden</span>
            <span><i style={{ background: STACK_COLORS.absence }} /> Abwesenheit</span>
          </div>
          <EveningBars
            rows={last.players
              .map((row) => ({ id: row.playerId, name: row.playerName, loss: row.lossCents, beer: row.beerCents, absence: row.absenceCents }))
              .sort((a, b) => b.loss + b.beer + b.absence - (a.loss + a.beer + a.absence))}
          />
        </>
      ) : (
        <EmptyState compact icon="calendar" title="Noch kein beendeter Abend" text="Gerade läuft auch keiner." />
      )}
    </Card>
  )
}

// ---- pending commands ----------------------------------------------------------

function PendingPanel({ names, sessions }: { names: Map<string, string>; sessions: Map<string, string> }) {
  const { pending, selectedDevice } = useApp()
  const { undo, busy } = useUndo()
  return (
    <Card
      className="span-4"
      icon="layers"
      eyebrow={selectedDevice ? `Warteschlange · ${selectedDevice.label}` : 'Warteschlange'}
      title={
        <>
          Ausstehende Aufträge {pending.length > 0 ? <span className="count">{pending.length}</span> : null}
        </>
      }
      actions={
        <Link to="/auftraege" className="btn btn-ghost btn-sm">
          Alle <Icon name="chevron-right" size={14} />
        </Link>
      }
    >
      {pending.length === 0 ? (
        <EmptyState compact icon="check" title="Alles übernommen" text="Keine Aufträge warten auf das Gerät." />
      ) : (
        <ul className="list compact">
          {pending.slice(0, 6).map((command) => (
            <li key={command.id} className="list-row">
              <div className="list-row-main">
                <span className="list-lead tone-pending">
                  <Icon name="time" size={16} />
                </span>
                <div className="list-text">
                  <div className="list-title">{COMMAND_LABELS[command.type]}</div>
                  <div className="list-meta">{describeCommand(command, names, sessions)}</div>
                  <div className="list-meta subtle-text">
                    {relativeTime(command.createdAt)}
                    {command.fetchedAt ? ' · vom Gerät abgeholt' : ''}
                  </div>
                </div>
                <Button variant="ghost" size="sm" icon="undo" disabled={busy === command.id} onClick={() => void undo(command)}>
                  zurücknehmen
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {pending.length > 6 ? <div className="card-foot">+ {pending.length - 6} weitere</div> : null}
    </Card>
  )
}

// ---- activity feed ---------------------------------------------------------------

function ActivityFeed({ entries }: { entries: HistoryRow[] }) {
  if (entries.length === 0) return <EmptyState compact icon="time" title="Noch nichts passiert" />
  return (
    <ol className="feed">
      {entries.map((entry) => {
        const view = presentHistory(entry)
        return (
          <li key={`${entry.kind}-${entry.id}`} className="feed-item">
            <span className={`feed-icon tone-${KIND_TONES[entry.kind]}`} aria-hidden>
              {entry.playerId && entry.playerName ? <Avatar id={entry.playerId} name={entry.playerName} size={28} /> : <Icon name={KIND_ICONS[entry.kind]} size={15} />}
            </span>
            <div className="feed-text">
              <div className="feed-title">{view.title}</div>
              <div className="feed-meta">
                {view.detail}
                {entry.sessionTitle && entry.sessionId ? (
                  <>
                    {' · '}
                    <Link to={`/abende/${encodeURIComponent(entry.sessionId)}`}>{entry.sessionTitle}</Link>
                  </>
                ) : null}
              </div>
            </div>
            <div className="feed-end">
              <span className={`amount ${view.amountClass}`}>{view.amount}</span>
              <time className="feed-time" dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)}>
                {relativeTime(entry.createdAt)}
              </time>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ---- page -----------------------------------------------------------------------

export function DashboardPage() {
  const { pending, selectedDevice, status } = useApp()
  const { openBooking } = useActions()
  const dashboard = useApi<Dashboard>('/dashboard')
  const sessions = useApi<SessionOverview[]>('/sessions')
  const players = useApi<PlayerChartRow[]>('/charts/players')
  const cashbox = useApi<CashboxChart>('/charts/cashbox')
  const evenings = useApi<EveningsChart>('/charts/evenings?season=all')

  const data = dashboard.data
  const totals = useMemo(() => (players.data ? balanceTotals(players.data) : null), [players.data])
  const lastEvenings = (evenings.data?.evenings ?? []).slice(-10)
  const lastEvening = lastEvenings[lastEvenings.length - 1]
  const average = lastEvenings.length > 0 ? Math.round(lastEvenings.reduce((sum, evening) => sum + evening.totalCents, 0) / lastEvenings.length) : 0
  const names = new Map((data?.debtors ?? []).map((debtor) => [debtor.playerId, debtor.playerName]))
  const sessionNames = new Map((sessions.data ?? []).map((session) => [session.id, session.title]))

  const context = selectedDevice ? (
    <>
      {selectedDevice.label} · Stand {status ? relativeTime(status.lastSnapshotAt) : '…'}
      {data ? ` · ${data.settings.cashboxLabel}` : ''}
    </>
  ) : (
    'Kein Gerät verbunden'
  )

  if (dashboard.error) {
    return (
      <Page title="Kommandozentrale" icon="grid" context={context} wide>
        <ErrorView error={dashboard.error} />
      </Page>
    )
  }

  const cash = data?.cashbox
  return (
    <Page
      title="Kommandozentrale"
      icon="grid"
      context={context}
      wide
      actions={
        <>
          <Button variant="secondary" size="sm" icon="swap-vertical" onClick={() => openBooking('correction')}>
            Korrektur
          </Button>
          <Button variant="secondary" size="sm" icon="person-add" onClick={() => openBooking('player')}>
            Spieler
          </Button>
        </>
      }
    >
      {status?.snapshotFromPreviousDevice ? (
        <Notice tone="warning">Angezeigt wird noch ein übernommener Stand eines früheren Geräts. Dieses Gerät ersetzt ihn beim nächsten Hochladen.</Notice>
      ) : null}
      <div className="dash">
        <div className="span-3">
          <KpiTile
            tone="hero"
            icon="wallet"
            label={data ? `Kassenstand · ${data.settings.cashboxLabel}` : 'Kassenstand'}
            value={cash?.cashOnHandCents ?? null}
            sparkline={cashbox.data ? [0, ...cashbox.data.events.map((event) => event.cashOnHandCents)] : undefined}
            hint={
              cash
                ? cash.totalWithdrawalsCents > 0
                  ? `Eingezahlt ${formatCurrency(cash.totalPaymentsCents)} · entnommen ${formatCurrency(cash.totalWithdrawalsCents)}`
                  : 'Bereits eingezahlt'
                : undefined
            }
            onClick={() => navigate('/buchen')}
          />
        </div>
        <div className="span-3">
          <KpiTile
            icon="alert"
            label="Offene Schulden"
            value={cash?.totalOutstandingCents ?? null}
            valueTone={cash && cash.totalOutstandingCents > 0 ? 'danger' : 'success'}
            sparkline={totals?.outstanding}
            sparkColor={CHART.danger}
            hint={data ? `${data.debtors.filter((debtor) => debtor.openDebtCents > 0).length} Spieler im Minus` : undefined}
            onClick={() => navigate('/spieler')}
          />
        </div>
        <div className="span-3">
          <KpiTile
            icon="trending-down"
            label="Guthaben"
            value={cash?.totalCreditCents ?? null}
            valueTone={cash && cash.totalCreditCents > 0 ? 'success' : 'default'}
            sparkline={totals?.credit}
            sparkColor={CHART.success}
            hint={data ? `${data.debtors.filter((debtor) => debtor.openDebtCents < 0).length} Spieler im Plus` : undefined}
          />
        </div>
        <div className="span-3">
          <KpiTile
            icon="dice"
            label="Verluste letzter Abend"
            value={evenings.data ? (lastEvening?.totalCents ?? 0) : null}
            sparkline={lastEvenings.map((evening) => evening.totalCents)}
            hint={lastEvening ? `„${lastEvening.title}“ · Ø ${formatCurrency(average)} (letzte ${lastEvenings.length})` : 'Noch kein beendeter Abend'}
            onClick={() => navigate('/abende')}
          />
        </div>

        <DebtChartCard players={players.data} evenings={evenings.data} />

        <Card className="span-4" icon="wallet" eyebrow="Kasse" title="Wohin das Geld geht">
          {cash ? (
            cash.totalPaymentsCents + cash.totalOutstandingCents > 0 ? (
              <Donut
                centerLabel="Kassenstand"
                centerValue={formatCurrency(cash.cashOnHandCents)}
                slices={[
                  { label: 'In der Kasse', value: cash.cashOnHandCents, color: CASH_COLORS.cash, hint: 'eingezahlt − entnommen' },
                  { label: 'Entnommen', value: cash.totalWithdrawalsCents, color: CASH_COLORS.withdrawn, hint: 'Einkäufe' },
                  { label: 'Noch offen', value: Math.max(0, cash.totalOutstandingCents), color: CASH_COLORS.open, hint: 'Schulden der Spieler' },
                ]}
              />
            ) : (
              <EmptyState compact icon="wallet" title="Noch keine Buchungen in der Kasse" />
            )
          ) : (
            <SkeletonRows rows={3} />
          )}
          <div className="card-buttons">
            <Button variant="secondary" size="sm" icon="cash-in" onClick={() => openBooking('payment')}>
              Zahlung buchen
            </Button>
            <Button variant="secondary" size="sm" icon="cash-out" onClick={() => openBooking('withdrawal')}>
              Entnahme buchen
            </Button>
          </div>
        </Card>

        <Card
          className="span-4"
          icon="people"
          eyebrow="Rangliste"
          title="Wer schuldet am meisten"
          actions={
            <Link to="/spieler" className="btn btn-ghost btn-sm">
              Alle <Icon name="chevron-right" size={14} />
            </Link>
          }
        >
          {data ? (
            <RankingBars
              emptyText="Keine Spieler."
              limit={8}
              rows={[...data.debtors]
                .filter((debtor) => !debtor.isArchived || debtor.openDebtCents !== 0)
                .sort((a, b) => b.openDebtCents - a.openDebtCents)
                .map((debtor) => ({
                  id: debtor.playerId,
                  value: debtor.openDebtCents,
                  avatar: { id: debtor.playerId, name: debtor.playerName, muted: debtor.isArchived },
                  label: (
                    <>
                      {debtor.playerName} {debtor.isCore ? null : <Badge>Gast</Badge>}
                    </>
                  ),
                  onClick: () => navigate(`/spieler?spieler=${encodeURIComponent(debtor.playerId)}`),
                  extra: (
                    <>
                      <PendingHints commands={pendingForPlayer(pending, debtor.playerId).filter((command) => command.type !== 'player.rename')} />
                      <RenamePendingBadges playerId={debtor.playerId} />
                    </>
                  ),
                }))}
            />
          ) : (
            <SkeletonRows rows={5} avatar />
          )}
        </Card>

        <EveningCard openSession={data?.openSession ?? null} evenings={evenings.data} />

        <PendingPanel names={names} sessions={sessionNames} />

        <Card
          className="span-8"
          icon="time"
          eyebrow="Aktivität"
          title="Zuletzt passiert"
          actions={
            <Link to="/historie" className="btn btn-ghost btn-sm">
              Ganze Historie <Icon name="chevron-right" size={14} />
            </Link>
          }
        >
          {data ? <ActivityFeed entries={data.recentHistory.filter((entry) => entry.kind !== 'audit').slice(0, 10)} /> : <SkeletonRows rows={6} avatar />}
        </Card>

        <Card className="span-4" icon="receipt" eyebrow="Kasse" title="Letzte Kassenbewegungen">
          {cashbox.data ? (
            cashbox.data.events.length === 0 ? (
              <EmptyState compact icon="cash" title="Keine Bewegungen" />
            ) : (
              <ul className="list compact">
                {[...cashbox.data.events]
                  .reverse()
                  .slice(0, 6)
                  .map((event) => (
                    <li key={event.id} className="list-row">
                      <div className="list-row-main">
                        <span className={`list-lead tone-${event.kind === 'payment' ? 'success' : 'danger'}`}>
                          {event.playerId && event.playerName ? <Avatar id={event.playerId} name={event.playerName} size={28} /> : <Icon name="cash-out" size={16} />}
                        </span>
                        <div className="list-text">
                          <div className="list-title">{event.kind === 'payment' ? event.playerName : event.note}</div>
                          <div className="list-meta">
                            {event.kind === 'payment' ? 'Zahlung' : 'Entnahme'} · {relativeTime(event.at)}
                          </div>
                        </div>
                        <div className="list-end">
                          <span className={`amount ${event.kind === 'payment' ? 'credit' : 'withdrawal'}`}>
                            {event.kind === 'payment' ? '+' : '−'}
                            {formatCurrency(event.amountCents)}
                          </span>
                          <span className="list-meta subtle-text">→ {formatCurrency(event.cashOnHandCents)}</span>
                        </div>
                      </div>
                    </li>
                  ))}
              </ul>
            )
          ) : (
            <SkeletonRows rows={4} avatar />
          )}
        </Card>
      </div>
      <StatusFootnote />
    </Page>
  )
}

function StatusFootnote() {
  const { pending } = useApp()
  if (pending.length === 0) return null
  return (
    <div className="footnote">
      <StatusBadge status="pending" /> Beauftragte Änderungen sind in den Zahlen noch nicht enthalten – sie erscheinen nach dem nächsten Sync des Geräts.
    </div>
  )
}
