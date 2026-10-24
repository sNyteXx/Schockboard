import { formatCurrency, formatDate, formatDateTime } from '@/domain/format'

import type { DashboardSnapshot, SessionOverview } from '../api'
import { Card, ErrorView, Loading, Money, Page, PendingHints, SyncHint, SyncStatus } from '../components'
import { Link, pendingForPlayer, useApi, useApp } from '../state'
import { HistoryList } from './History'

export function DashboardPage() {
  const { pending } = useApp()
  const dashboard = useApi<DashboardSnapshot>('/dashboard')
  const sessions = useApi<SessionOverview[]>('/sessions')

  const data = dashboard.data
  const recentSessions = (sessions.data ?? []).filter((session) => session.status === 'closed').slice(0, 3)

  return (
    <Page eyebrow="Echte Liebe" title="Übersicht">
      <Card title="Sync-Status">
        <div className="grid cols-2" style={{ alignItems: 'center' }}>
          <SyncStatus />
          <SyncHint />
        </div>
        {pending.length > 0 ? (
          <div className="row" style={{ marginTop: 12 }}>
            <span className="badge pending">{pending.length} Auftrag/Aufträge ausstehend</span>
            <Link to="/auftraege">Zur Auftragsliste</Link>
          </div>
        ) : null}
      </Card>

      {dashboard.error ? <ErrorView error={dashboard.error} /> : null}
      {!data && dashboard.loading ? <Loading /> : null}

      {data ? (
        <>
          <div className="grid cols-3">
            <section className="card accent">
              <div className="stat-label">{data.settings.cashboxLabel}</div>
              <div className="stat-value">{formatCurrency(data.cashbox.totalPaymentsCents)}</div>
              <div className="muted small">eingezahlt</div>
            </section>
            <section className="card">
              <div className="stat-label muted">Offene Schulden</div>
              <div className="stat-value" style={{ color: 'var(--accent)' }}>
                {formatCurrency(data.cashbox.totalOutstandingCents)}
              </div>
              <div className="muted small">über alle Spieler</div>
            </section>
            <section className="card">
              <div className="stat-label muted">Einsatz</div>
              <div className="stat-value">{formatCurrency(data.settings.defaultStakeCents)}</div>
              <div className="muted small">pro Verlust (Standard)</div>
            </section>
          </div>

          <div className="grid cols-2">
            <Card title="Aktiver Abend">
              {data.openSession ? (
                <Link to={`/abende/${encodeURIComponent(data.openSession.id)}`} className="card link" >
                  <div className="spread">
                    <h3 style={{ margin: 0 }}>{data.openSession.title}</h3>
                    <span className="badge yellow">läuft</span>
                  </div>
                  <div className="muted small">seit {formatDateTime(data.openSession.startedAt)}</div>
                  <div className="row" style={{ marginTop: 10 }}>
                    <span className="badge">{data.openSession.presentCount} anwesend</span>
                    <span className="badge">{data.openSession.lossCount} Einträge</span>
                    <span className="badge yellow">{formatCurrency(data.openSession.totalLossCents)}</span>
                  </div>
                </Link>
              ) : (
                <div className="empty">Gerade läuft kein Spielabend.</div>
              )}
              {recentSessions.length > 0 ? (
                <div className="list" style={{ marginTop: 12 }}>
                  <div className="muted small" style={{ fontWeight: 700 }}>
                    Letzte Abende
                  </div>
                  {recentSessions.map((session) => (
                    <Link key={session.id} to={`/abende/${encodeURIComponent(session.id)}`} className="list-item" >
                      <div>
                        <div className="title">{session.title}</div>
                        <div className="sub">
                          {formatDate(session.startedAt)} · {session.presentCount} anwesend
                        </div>
                      </div>
                      <Money cents={session.totalLossCents + session.totalAbsenceCents} />
                    </Link>
                  ))}
                </div>
              ) : null}
            </Card>

            <Card title="Offene Schulden" actions={<Link to="/spieler">Alle Spieler</Link>}>
              {data.debtors.length === 0 ? <div className="empty">Keine Spieler.</div> : null}
              <div className="list">
                {data.debtors.map((debtor) => (
                  <div key={debtor.playerId} className="list-item">
                    <div>
                      <div className="title">
                        {debtor.playerName} {debtor.isCore ? null : <span className="badge">Gast</span>}
                      </div>
                      <PendingHints commands={pendingForPlayer(pending, debtor.playerId)} />
                    </div>
                    <Money cents={debtor.openDebtCents} debt />
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card title="Zuletzt passiert" actions={<Link to="/historie">Ganze Historie</Link>}>
            <HistoryList entries={data.recentHistory} />
          </Card>
        </>
      ) : null}
    </Page>
  )
}
