import { useState } from 'react'

import { formatCurrency, formatDate, formatDateTime } from '@/domain/format'

import { ApiError, type EveningsChart, type HistoryRow, type SessionDetail, type SessionOverview } from '../api'
import { StackedBars } from '../charts/StackedBars'
import { STACK_COLORS } from '../charts/scale'
import { Card, ErrorView, Loading, Money, Page } from '../components'
import { EntryActions, EntryPendingBadges, OverrideNotice, SessionActions, SessionPendingBadges, useEntryPending } from '../overrides'
import { Link, navigate, useApi, usePendingOverrides } from '../state'
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
  return (
    <Card
      title="Summe pro Abend"
      actions={
        seasons.length > 0 ? (
          <div className="segmented" role="group" aria-label="Saison">
            {['all', ...seasons].map((value) => (
              <button key={value} className={season === value ? 'active' : ''} onClick={() => setSeason(value)}>
                {value === 'all' ? 'Alle' : value}
              </button>
            ))}
          </div>
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
          {evenings.length > 0 ? (
            <details className="table-toggle">
              <summary>Als Tabelle</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Abend</th>
                      <th className="num">Verluste</th>
                      <th className="num">Bierrunden</th>
                      <th className="num">Abwesenheit</th>
                      <th className="num">Gesamt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...evenings].reverse().map((evening) => (
                      <tr key={evening.sessionId}>
                        <td>
                          <Link to={`/abende/${encodeURIComponent(evening.sessionId)}`}>{evening.title}</Link>
                          <div className="muted small">{formatDate(evening.date)}</div>
                        </td>
                        <td className="num">
                          <Money cents={evening.lossCents} />
                        </td>
                        <td className="num">
                          <Money cents={evening.beerCents} />
                        </td>
                        <td className="num">
                          <Money cents={evening.absenceCents} />
                        </td>
                        <td className="num">
                          <Money cents={evening.totalCents} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
          <div className="muted small" style={{ marginTop: 8 }}>
            Nur beendete Abende. Ausstehende Änderungen sind noch nicht enthalten.
          </div>
        </>
      ) : chart.loading ? (
        <div className="skeleton" />
      ) : null}
    </Card>
  )
}

export function SessionsPage() {
  const sessions = useApi<SessionOverview[]>('/sessions')
  const overrides = usePendingOverrides()
  return (
    <Page eyebrow="Spielabende" title="Abende">
      {sessions.error ? <ErrorView error={sessions.error} /> : null}
      {!sessions.error ? <EveningsChartCard /> : null}
      {!sessions.data && sessions.loading ? <Loading /> : null}
      {sessions.data && sessions.data.length === 0 ? <div className="empty">Noch keine Spielabende.</div> : null}
      <div className="grid cols-3">
        {(sessions.data ?? []).map((session) => (
          <Link
            key={session.id}
            to={`/abende/${encodeURIComponent(session.id)}`}
            className={`card link ${overrides.sessionDeletes.has(session.id) ? 'struck' : ''}`}
          >
            <div className="spread">
              <h3 className="strike" style={{ margin: 0 }}>
                {session.title}
              </h3>
              {session.status === 'open' ? <span className="badge yellow">läuft</span> : <span className="badge">beendet</span>}
            </div>
            <div className="muted small">{formatDate(session.startedAt)}</div>
            <div className="stat-value strike" style={{ fontSize: 30 }}>
              {formatCurrency(session.totalLossCents + session.totalAbsenceCents)}
            </div>
            <div className="row small muted" style={{ marginTop: 6 }}>
              <span>{session.presentCount} anwesend</span>·<span>{session.lossCount} Einträge</span>
              {session.totalAbsenceCents > 0 ? (
                <>
                  ·<span>{formatCurrency(session.totalAbsenceCents)} Abwesenheit</span>
                </>
              ) : null}
            </div>
            <SessionPendingBadges sessionId={session.id} />
          </Link>
        ))}
      </div>
    </Page>
  )
}

type DetailWithRefs = Omit<SessionDetail, 'timeline'> & { timeline: HistoryRow[] }

function LossRow({ entry }: { entry: SessionDetail['losses'][number] }) {
  const { deletion } = useEntryPending('loss', entry.id)
  const kind = entry.isBeerRound ? 'Bierrunde' : 'Verlust'
  return (
    <div className={`list-item ${deletion ? 'struck' : ''}`}>
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className={`badge ${entry.isBeerRound ? 'info' : 'yellow'}`}>{entry.isBeerRound ? '🍺 Bierrunde' : 'Verlust'}</span>
          <span className="title strike">{entry.playerName}</span>
        </div>
        <div className="sub">
          {formatDateTime(entry.createdAt)}
          {entry.note ? ` · ${entry.note}` : ''}
        </div>
        <EntryPendingBadges kind="loss" id={entry.id} />
      </div>
      <div className="item-end">
        <span className="strike">
          <Money cents={entry.amountCents} />
        </span>
        <EntryActions
          booking={{ kind: 'loss', id: entry.id, amountCents: entry.amountCents, note: entry.note, description: `${kind} von ${entry.playerName}` }}
        />
      </div>
    </div>
  )
}

function AbsenceRow({ absence }: { absence: SessionDetail['absences'][number] }) {
  const { deletion } = useEntryPending('absence', absence.id)
  return (
    <div className={`list-item ${deletion ? 'struck' : ''}`}>
      <div style={{ minWidth: 0 }}>
        <div className="title strike">{absence.playerName}</div>
        <div className="sub">{absence.note ?? `Durchschnitt aus ${absence.averagePresentCoreCount} Stammspielern`}</div>
        <EntryPendingBadges kind="absence" id={absence.id} />
      </div>
      <div className="item-end">
        <span className="strike">
          <Money cents={absence.amountCents} />
        </span>
        <EntryActions
          booking={{
            kind: 'absence',
            id: absence.id,
            amountCents: absence.amountCents,
            note: absence.note,
            description: `Abwesenheitsgebühr von ${absence.playerName}`,
          }}
        />
      </div>
    </div>
  )
}

export function SessionDetailPage({ sessionId }: { sessionId: string }) {
  const detail = useApi<DetailWithRefs>(`/sessions/${encodeURIComponent(sessionId)}`)
  const overrides = usePendingOverrides()
  const data = detail.data
  const isOpen = data?.session.status === 'open'
  const deleting = overrides.sessionDeletes.has(sessionId)

  return (
    <Page
      eyebrow="Spielabend"
      title={data?.session.title ?? 'Abend'}
      actions={
        <>
          {data ? (
            <SessionActions
              session={{
                id: data.session.id,
                title: data.session.title,
                startedAt: data.session.startedAt,
                stakeCents: data.session.stakeCents,
                bookingCount: data.losses.length + data.absences.length,
              }}
            />
          ) : null}
          <Link to="/abende" className="btn ghost">
            Alle Abende
          </Link>
        </>
      }
    >
      {detail.error ? <ErrorView error={detail.error.status === 404 ? new ApiError(404, 'not_found', 'Abend nicht gefunden.') : detail.error} /> : null}
      {!data && detail.loading ? <Loading /> : null}
      {data ? (
        <>
          <SessionPendingBadges sessionId={sessionId} />
          <div className={`grid cols-3 ${deleting ? 'struck' : ''}`}>
            <section className={`card ${isOpen ? 'accent' : ''}`}>
              <div className="stat-label">{isOpen ? 'Läuft seit' : 'Gespielt am'}</div>
              <div className="stat-value" style={{ fontSize: 26 }}>
                {formatDateTime(data.session.startedAt)}
              </div>
              <div className="muted small">
                {data.session.closedAt ? `beendet ${formatDateTime(data.session.closedAt)}` : 'noch offen'}
                {data.session.notes ? ` · ${data.session.notes}` : ''}
              </div>
            </section>
            <section className="card">
              <div className="stat-label muted">Verluste & Bierrunden</div>
              <div className="stat-value strike">{formatCurrency(data.session.totalLossCents)}</div>
              <div className="muted small">
                {data.session.lossCount} Einträge · Einsatz {formatCurrency(data.session.stakeCents)}
              </div>
            </section>
            <section className="card">
              <div className="stat-label muted">Abwesenheit</div>
              <div className="stat-value strike">{formatCurrency(data.session.totalAbsenceCents)}</div>
              <div className="muted small">{data.session.presentCount} anwesend</div>
            </section>
          </div>

          <OverrideNotice />

          <div className="grid cols-2" style={{ alignItems: 'start' }}>
            <Card title="Einträge">
              {data.losses.length === 0 ? <div className="empty">Keine Einträge.</div> : null}
              <div className="list">
                {data.losses.map((entry) => (
                  <LossRow key={entry.id} entry={entry} />
                ))}
              </div>
            </Card>

            <div className="stack" style={{ gap: 18 }}>
              <Card title="Abwesenheitsgebühren">
                {data.absences.length === 0 ? (
                  <div className="empty">{isOpen ? 'Werden beim Abschluss auf dem Gerät berechnet.' : 'Keine.'}</div>
                ) : null}
                <div className="list">
                  {data.absences.map((absence) => (
                    <AbsenceRow key={absence.id} absence={absence} />
                  ))}
                </div>
              </Card>
              <Card title="Anwesenheit">
                <div className="row" style={{ gap: 6 }}>
                  {data.attendance.map((row) => (
                    <span key={row.id} className={`badge ${row.present ? 'success' : ''}`}>
                      {row.playerName}
                      {row.isCore ? '' : ' (Gast)'}
                      {row.present ? '' : ' – abwesend'}
                    </span>
                  ))}
                </div>
              </Card>
            </div>
          </div>

          <Card title="Verlauf">
            <HistoryList entries={data.timeline} hideSessionTitle editable />
          </Card>
        </>
      ) : null}
    </Page>
  )
}
