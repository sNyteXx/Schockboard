import { parseEuroToCents } from '@/domain/utils'
import { useState } from 'react'

import { formatCurrency, formatDate, formatDateTime } from '@/domain/format'

import { ApiError, type EveningsChart, type HistoryRow, type SessionDetail, type SessionOverview } from '../api'
import { StackedBars } from '../charts/StackedBars'
import { STACK_COLORS } from '../charts/scale'
import { Avatar, Badge, Button, Card, Chips, EmptyState, ErrorView, Money, Page, Segmented, SkeletonChart, SkeletonRows, StatTile } from '../components'
import { Icon } from '../icons'
import {
  BookingRow,
  useQueue,
  DeleteSessionDialog,
  InlineSessionEditor,
  OverrideNotice,
  SessionPendingBadges,
  type SessionRef,
} from '../overrides'
import { Link, navigate, useApi, usePendingOverrides, useApp } from '../state'
import { HistoryList } from './History'

const SEGMENTS = [
  { key: 'loss', label: 'Verluste', color: STACK_COLORS.loss },
  { key: 'beer', label: 'Bierrunden', color: STACK_COLORS.beer },
  { key: 'absence', label: 'Abwesenheit', color: STACK_COLORS.absence },
]

export function EveningsChartCard({ compact = false }: { compact?: boolean }) {
  const [season, setSeason] = useState('all')
  const chart = useApi<EveningsChart>(`/charts/evenings?season=${season}`)
  const evenings = chart.data?.evenings ?? []
  const seasons = chart.data?.seasons ?? []
  const total = evenings.reduce((sum, evening) => sum + evening.totalCents, 0)
  return (
    <Card
      icon="calendar"
      eyebrow={chart.data ? `${evenings.length} beendete Abende · ${formatCurrency(total)}` : 'Abende'}
      title="Summe pro Abend"
      actions={
        seasons.length > 0 ? (
          <Segmented
            label="Saison"
            size="sm"
            value={season}
            onChange={setSeason}
            options={[{ value: 'all', label: 'Gesamt' }, ...seasons.map((value) => ({ value, label: value }))]}
          />
        ) : null
      }
    >
      {chart.error ? <ErrorView error={chart.error} /> : null}
      {chart.data ? (
        <>
          <StackedBars
            ariaLabel="Summe pro beendetem Abend, gestapelt nach Verlusten, Bierrunden und Abwesenheit"
            height={compact ? 220 : 260}
            segments={SEGMENTS}
            columns={evenings.map((evening) => ({
              id: evening.sessionId,
              label: evening.title,
              date: evening.date,
              values: { loss: evening.lossCents, beer: evening.beerCents, absence: evening.absenceCents },
            }))}
            onSelect={(id) => navigate(`/abende/${encodeURIComponent(id)}`)}
          />
          <div className="card-foot">Nur beendete Abende. Balken anklicken öffnet den Abend. Ausstehende Änderungen sind noch nicht enthalten.</div>
        </>
      ) : chart.loading ? (
        <SkeletonChart height={compact ? 220 : 260} />
      ) : null}
    </Card>
  )
}

export function SessionsPage() {
  const sessions = useApi<SessionOverview[]>('/sessions')
  const overrides = usePendingOverrides()
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('all')
  const list = (sessions.data ?? []).filter((session) => filter === 'all' || session.status === filter)
  const max = Math.max(1, ...(sessions.data ?? []).map((session) => session.totalLossCents + session.totalAbsenceCents))
  return (
    <Page title="Abende" icon="calendar" context={sessions.data ? `${sessions.data.length} Spielabende` : undefined}>
      {sessions.error ? <ErrorView error={sessions.error} /> : <EveningsChartCard />}
      {!sessions.error ? (
        <Card
          className="table-card"
          title="Alle Abende"
          actions={
            <Chips
              label="Status"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'Alle', count: sessions.data?.length },
                { value: 'open', label: 'Läuft', count: sessions.data?.filter((session) => session.status === 'open').length },
                { value: 'closed', label: 'Beendet', count: sessions.data?.filter((session) => session.status === 'closed').length },
              ]}
            />
          }
        >
          {!sessions.data ? (
            <SkeletonRows rows={5} />
          ) : list.length === 0 ? (
            <EmptyState icon="calendar" title="Noch keine Spielabende" text="Abende entstehen in der App auf dem Gerät." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Abend</th>
                    <th className="hide-md">Datum</th>
                    <th className="num hide-md">Anwesend</th>
                    <th className="num hide-lg">Einträge</th>
                    <th className="num hide-lg">Abwesenheit</th>
                    <th className="num balance-col">Summe</th>
                    <th className="actions-col">
                      <span className="sr-only">Öffnen</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((session) => {
                    const total = session.totalLossCents + session.totalAbsenceCents
                    return (
                      <tr
                        key={session.id}
                        className={`clickable ${overrides.sessionDeletes.has(session.id) ? 'struck' : ''}`}
                        onClick={(event) => {
                          if (!(event.target as HTMLElement).closest('a')) navigate(`/abende/${encodeURIComponent(session.id)}`)
                        }}
                      >
                        <td>
                          <span className="session-cell">
                            <span className={`session-icon ${session.status === 'open' ? 'live' : ''}`} aria-hidden>
                              <Icon name={session.status === 'open' ? 'pulse' : 'calendar'} size={15} />
                            </span>
                            <span>
                              <Link to={`/abende/${encodeURIComponent(session.id)}`} className="strike row-link">
                                {session.title}
                              </Link>
                              <span className="cell-sub show-md">{formatDate(session.startedAt)}</span>
                            </span>
                            {session.status === 'open' ? <Badge tone="accent">läuft</Badge> : null}
                          </span>
                          <SessionPendingBadges sessionId={session.id} />
                        </td>
                        <td className="hide-md">{formatDate(session.startedAt)}</td>
                        <td className="num hide-md">{session.presentCount}</td>
                        <td className="num hide-lg">{session.lossCount}</td>
                        <td className="num hide-lg">
                          <Money cents={session.totalAbsenceCents} />
                        </td>
                        <td className="num balance-col">
                          <span className="balance-cell">
                            <Money cents={total} className="strike" />
                            <span className="balance-bar" aria-hidden>
                              <span className="balance-fill" style={{ width: `${(total / max) * 100}%` }} />
                            </span>
                          </span>
                        </td>
                        <td className="actions-col">
                          <Icon name="chevron-right" size={16} className="muted" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </Page>
  )
}

type DetailWithRefs = Omit<SessionDetail, 'timeline'> & { timeline: HistoryRow[] }

export function SessionDetailPage({ sessionId }: { sessionId: string }) {
  const { run: queue, busy: booking } = useQueue()
  const { toast } = useApp()
  const [amount, setAmount] = useState('1,00')
  const detail = useApi<DetailWithRefs>(`/sessions/${encodeURIComponent(sessionId)}`)
  const overrides = usePendingOverrides()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const data = detail.data
  const isOpen = data?.session.status === 'open'
  const deleting = overrides.sessionDeletes.has(sessionId)
  const ref: SessionRef | null = data
    ? {
        id: data.session.id,
        title: data.session.title,
        startedAt: data.session.startedAt,
        stakeCents: data.session.stakeCents,
        bookingCount: data.losses.length + data.absences.length,
      }
    : null

  const perPlayer = new Map<string, { id: string; name: string; cents: number; count: number }>()
  for (const loss of data?.losses ?? []) {
    const row = perPlayer.get(loss.playerId) ?? { id: loss.playerId, name: loss.playerName, cents: 0, count: 0 }
    row.cents += loss.amountCents
    row.count += 1
    perPlayer.set(loss.playerId, row)
  }
  for (const absence of data?.absences ?? []) {
    const row = perPlayer.get(absence.playerId) ?? { id: absence.playerId, name: absence.playerName, cents: 0, count: 0 }
    row.cents += absence.amountCents
    perPlayer.set(absence.playerId, row)
  }
  const playerRows = [...perPlayer.values()].sort((a, b) => b.cents - a.cents)
  const playerMax = Math.max(1, ...playerRows.map((row) => row.cents))

  return (
    <Page
      title={data?.session.title ?? 'Abend'}
      icon={isOpen ? 'pulse' : 'calendar'}
      context={
        data ? (
          <>
            {isOpen ? 'läuft seit' : 'gespielt am'} {formatDateTime(data.session.startedAt)}
            {data.session.closedAt ? ` · beendet ${formatDateTime(data.session.closedAt)}` : ''}
            {data.session.notes ? ` · ${data.session.notes}` : ''}
          </>
        ) : undefined
      }
      actions={
        <>
          <Link to={`/erfolge?session=${encodeURIComponent(sessionId)}`} className="btn btn-secondary btn-sm">Rückblick & Erfolge</Link>
          <Link to="/abende" className="btn btn-ghost btn-sm">
            <Icon name="chevron-left" size={15} /> Alle Abende
          </Link>
          {ref ? (
            <>
              <Button variant="secondary" size="sm" icon="pencil" disabled={deleting || editing} onClick={() => setEditing(true)}>
                Bearbeiten
              </Button>
              <Button variant="danger" size="sm" icon="trash" disabled={deleting} onClick={() => setConfirmDelete(true)}>
                Löschen
              </Button>
            </>
          ) : null}
        </>
      }
    >
      {detail.error ? <ErrorView error={detail.error.status === 404 ? new ApiError(404, 'not_found', 'Abend nicht gefunden.') : detail.error} /> : null}
      {!data && detail.loading ? (
        <div className="grid two">
          <Card>
            <SkeletonRows rows={6} avatar />
          </Card>
          <Card>
            <SkeletonRows rows={4} avatar />
          </Card>
        </div>
      ) : null}
      {data && ref ? (
        <>
          {editing ? (
            <Card title="Abend bearbeiten" icon="pencil">
              <InlineSessionEditor session={ref} onClose={() => setEditing(false)} />
            </Card>
          ) : null}
          <SessionPendingBadges sessionId={sessionId} />
          {isOpen ? <Card title="Am Spieltisch buchen" icon="dice">
            <p className="muted">Das führende Gerät bestätigt die Buchungen beim nächsten Abgleich. Bis dahin bleiben sie ausstehend.</p>
            <label className="field">Betrag für Zahlung / Bierrunde (€)<input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></label>
            {data.attendance.filter(player => player.present).map(player => <div className="list-row" key={player.playerId}><strong>{player.playerName}</strong><div className="form-actions">
              <Button size="sm" disabled={booking} onClick={() => void queue('loss.record', { sessionId, playerId: player.playerId }, 'Verlust beauftragt.')}>+ Verlust</Button>
              {(['beerround.record', 'payment.record'] as const).map(type => <Button key={type} size="sm" variant="secondary" disabled={booking} onClick={() => { try { const amountCents = parseEuroToCents(amount); void queue(type, { sessionId, playerId: player.playerId, amountCents }, 'Buchung beauftragt.') } catch (error) { toast((error as Error).message, 'error') } }}>{type === 'payment.record' ? 'Zahlung' : 'Bierrunde'}</Button>)}
            </div></div>)}
          </Card> : null}
          <div className={`stat-grid four ${deleting ? 'struck' : ''}`}>
            <StatTile label="Summe" icon="wallet" tone="accent" value={<span className="strike">{formatCurrency(data.session.totalLossCents + data.session.totalAbsenceCents)}</span>} hint={isOpen ? 'läuft noch' : 'beendet'} />
            <StatTile label="Verluste & Bierrunden" icon="dice" value={<span className="strike">{formatCurrency(data.session.totalLossCents)}</span>} hint={`${data.session.lossCount} Einträge`} />
            <StatTile label="Abwesenheit" icon="person" value={<span className="strike">{formatCurrency(data.session.totalAbsenceCents)}</span>} hint={`${data.absences.length} Gebühren`} />
            <StatTile label="Einsatz" icon="cash" value={formatCurrency(data.session.stakeCents)} hint={`${data.session.presentCount} anwesend`} />
          </div>

          <div className="dash">
            <Card className="span-7" icon="dice" title="Einträge" eyebrow={`${data.losses.length} Buchungen`}>
              {data.losses.length === 0 ? (
                <EmptyState compact icon="dice" title="Keine Einträge" />
              ) : (
                <ul className="list">
                  {data.losses.map((entry) => {
                    const kind = entry.isBeerRound ? 'Bierrunde' : 'Verlust'
                    return (
                      <BookingRow
                        key={entry.id}
                        booking={{ kind: 'loss', id: entry.id, amountCents: entry.amountCents, note: entry.note, description: `${kind} von ${entry.playerName}` }}
                        lead={<Avatar id={entry.playerId} name={entry.playerName} size={30} />}
                        title={entry.playerName}
                        meta={
                          <>
                            <Badge tone={entry.isBeerRound ? 'info' : 'accent'} icon={entry.isBeerRound ? 'beer' : 'dice'}>
                              {kind}
                            </Badge>{' '}
                            {formatDateTime(entry.createdAt)}
                            {entry.note ? ` · ${entry.note}` : ''}
                          </>
                        }
                        amount={<Money cents={entry.amountCents} />}
                      />
                    )
                  })}
                </ul>
              )}
            </Card>

            <div className="span-5 stack">
              <Card icon="people" title="Pro Spieler">
                {playerRows.length === 0 ? (
                  <EmptyState compact icon="people" title="Noch nichts gebucht" />
                ) : (
                  <ol className="evening-bars">
                    {playerRows.map((row) => (
                      <li key={row.id}>
                        <Avatar id={row.id} name={row.name} size={26} />
                        <span className="evening-bar-name">{row.name}</span>
                        <span className="evening-bar-track" aria-hidden>
                          <span style={{ width: `${(row.cents / playerMax) * 100}%`, background: STACK_COLORS.loss }} />
                        </span>
                        <span className="amount">{formatCurrency(row.cents)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
              <Card icon="person" title="Abwesenheitsgebühren">
                {data.absences.length === 0 ? (
                  <EmptyState compact icon="person" title={isOpen ? 'Noch keine' : 'Keine'} text={isOpen ? 'Werden beim Abschluss auf dem Gerät berechnet.' : undefined} />
                ) : (
                  <ul className="list">
                    {data.absences.map((absence) => (
                      <BookingRow
                        key={absence.id}
                        booking={{
                          kind: 'absence',
                          id: absence.id,
                          amountCents: absence.amountCents,
                          note: absence.note,
                          description: `Abwesenheitsgebühr von ${absence.playerName}`,
                        }}
                        lead={<Avatar id={absence.playerId} name={absence.playerName} size={30} muted />}
                        title={absence.playerName}
                        meta={absence.note ?? `Durchschnitt aus ${absence.averagePresentCoreCount} Stammspielern`}
                        amount={<Money cents={absence.amountCents} />}
                      />
                    ))}
                  </ul>
                )}
              </Card>
              <Card icon="check" title="Anwesenheit">
                <div className="attendance">
                  {data.attendance.map((row) => (
                    <span key={row.id} className={`attendee ${row.present ? 'present' : 'absent'}`}>
                      <Avatar id={row.playerId} name={row.playerName} size={24} muted={!row.present} />
                      {row.playerName}
                      {row.isCore ? '' : ' (Gast)'}
                      <span className="sr-only">{row.present ? ' anwesend' : ' abwesend'}</span>
                    </span>
                  ))}
                </div>
              </Card>
            </div>
          </div>

          <OverrideNotice />

          <Card icon="time" title="Verlauf des Abends">
            <HistoryList entries={data.timeline} hideSessionTitle editable />
          </Card>
          {confirmDelete ? <DeleteSessionDialog session={ref} onClose={() => setConfirmDelete(false)} /> : null}
        </>
      ) : null}
    </Page>
  )
}
