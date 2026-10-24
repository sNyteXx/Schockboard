import { useState } from 'react'

import { formatCurrency, formatDate, formatDateTime } from '@/domain/format'

import { ApiError, queueCommand, type SessionDetail, type SessionOverview } from '../api'
import { Card, ErrorView, Loading, Money, Page, SyncHint } from '../components'
import { Link, useApi, useApp } from '../state'
import { HistoryList } from './History'

export function SessionsPage() {
  const sessions = useApi<SessionOverview[]>('/sessions')
  return (
    <Page eyebrow="Spielabende" title="Abende">
      {sessions.error ? <ErrorView error={sessions.error} /> : null}
      {!sessions.data && sessions.loading ? <Loading /> : null}
      {sessions.data && sessions.data.length === 0 ? <div className="empty">Noch keine Spielabende.</div> : null}
      <div className="grid cols-3">
        {(sessions.data ?? []).map((session) => (
          <Link key={session.id} to={`/abende/${encodeURIComponent(session.id)}`} className="card link">
            <div className="spread">
              <h3 style={{ margin: 0 }}>{session.title}</h3>
              {session.status === 'open' ? <span className="badge yellow">läuft</span> : <span className="badge">beendet</span>}
            </div>
            <div className="muted small">{formatDate(session.startedAt)}</div>
            <div className="stat-value" style={{ fontSize: 30 }}>
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
          </Link>
        ))}
      </div>
    </Page>
  )
}

export function SessionDetailPage({ sessionId }: { sessionId: string }) {
  const { pending, refresh, toast } = useApp()
  const detail = useApi<SessionDetail>(`/sessions/${encodeURIComponent(sessionId)}`)
  const [busy, setBusy] = useState<string | null>(null)
  const data = detail.data
  const isOpen = data?.session.status === 'open'
  const pendingVoids = new Set(pending.filter((command) => command.type === 'loss.void').map((command) => String(command.payload.entryId)))

  async function voidEntry(entry: SessionDetail['losses'][number]) {
    const kind = entry.isBeerRound ? 'Bierrunde' : 'Verlust'
    if (!window.confirm(`${kind} von ${entry.playerName} (${formatCurrency(entry.amountCents)}) stornieren?`)) return
    setBusy(entry.id)
    try {
      await queueCommand('loss.void', { sessionId, playerId: entry.playerId, entryId: entry.id })
      toast('Stornierung beauftragt.')
      await refresh()
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Fehler beim Speichern.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Page
      eyebrow="Spielabend"
      title={data?.session.title ?? 'Abend'}
      actions={
        <Link to="/abende" className="btn ghost">
          Alle Abende
        </Link>
      }
    >
      {detail.error ? <ErrorView error={detail.error.status === 404 ? new ApiError(404, 'not_found', 'Abend nicht gefunden.') : detail.error} /> : null}
      {!data && detail.loading ? <Loading /> : null}
      {data ? (
        <>
          <div className="grid cols-3">
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
              <div className="stat-value">{formatCurrency(data.session.totalLossCents)}</div>
              <div className="muted small">
                {data.session.lossCount} Einträge · Einsatz {formatCurrency(data.session.stakeCents)}
              </div>
            </section>
            <section className="card">
              <div className="stat-label muted">Abwesenheit</div>
              <div className="stat-value">{formatCurrency(data.session.totalAbsenceCents)}</div>
              <div className="muted small">{data.session.presentCount} anwesend</div>
            </section>
          </div>

          {isOpen ? <SyncHint /> : null}

          <div className="grid cols-2" style={{ alignItems: 'start' }}>
            <Card title="Einträge">
              {data.losses.length === 0 ? <div className="empty">Keine Einträge.</div> : null}
              <div className="list">
                {data.losses.map((entry) => (
                  <div key={entry.id} className="list-item">
                    <div>
                      <div className="row" style={{ gap: 8 }}>
                        <span className={`badge ${entry.isBeerRound ? 'info' : 'yellow'}`}>{entry.isBeerRound ? '🍺 Bierrunde' : 'Verlust'}</span>
                        <span className="title">{entry.playerName}</span>
                      </div>
                      <div className="sub">
                        {formatDateTime(entry.createdAt)}
                        {entry.note ? ` · ${entry.note}` : ''}
                      </div>
                      {pendingVoids.has(entry.id) ? (
                        <div className="pending-note">
                          <span className="badge pending">ausstehend: Stornierung</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="row" style={{ gap: 10 }}>
                      <Money cents={entry.amountCents} />
                      {isOpen ? (
                        <button
                          className="btn danger small"
                          disabled={busy === entry.id || pendingVoids.has(entry.id)}
                          onClick={() => voidEntry(entry)}
                        >
                          Stornieren
                        </button>
                      ) : null}
                    </div>
                  </div>
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
                    <div key={absence.id} className="list-item">
                      <div>
                        <div className="title">{absence.playerName}</div>
                        <div className="sub">{absence.note ?? `Durchschnitt aus ${absence.averagePresentCoreCount} Stammspielern`}</div>
                      </div>
                      <Money cents={absence.amountCents} />
                    </div>
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
            <HistoryList entries={data.timeline} hideSessionTitle />
          </Card>
        </>
      ) : null}
    </Page>
  )
}
